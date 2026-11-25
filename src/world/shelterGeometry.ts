import * as THREE from 'three';
import type { ShelterQuality } from '../game/survivalEngine';

export interface Footprint {
  id: string;
  x: number;
  z: number;
  yaw: number;
  halfW: number;
  halfD: number;
  floorY: number;
  temporary?: boolean;
  /** When true, excludes vegetation without acting as an elevated floor or shelter. */
  clearingOnly?: boolean;
  /** 'circle' uses halfW as radius; defaults to oriented 'box'. */
  shape?: 'box' | 'circle';
  /** Optional explicit vegetation exclusion margin override (defaults to caller/shader 1.2m). */
  vegetationMargin?: number;
  shelter?: { quality: ShelterQuality; label: string };
  /** Rain cover: eave height plus rise toward the ridge (local X for tents, Z for houses). */
  roof?: { eaveY: number; rise: number; axis: 'x' | 'z' };
}

export function localPoint(area: Footprint, x: number, z: number) {
  const dx = x - area.x,
    dz = z - area.z;
  const c = Math.cos(area.yaw),
    s = Math.sin(area.yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
export function containsFootprint(area: Footprint, x: number, z: number, margin = 0): boolean {
  const p = localPoint(area, x, z);
  if (area.shape === 'circle') {
    const r = area.halfW + margin;
    return p.x * p.x + p.z * p.z <= r * r;
  }
  return Math.abs(p.x) <= area.halfW + margin && Math.abs(p.z) <= area.halfD + margin;
}

/** Authoritative floor/cover footprints, including runtime placements. Shared CPU and GPU queries. */
export class ShelterGeometry {
  private readonly areas: Footprint[] = [];

  get footprints(): readonly Footprint[] {
    return this.areas;
  }
  readonly uniforms = {
    uShelterData: {
      value: new THREE.DataTexture(new Float32Array(12), 3, 1, THREE.RGBAFormat, THREE.FloatType),
    },
    uShelterCount: { value: 0 },
  };
  add(area: Footprint) {
    this.areas.push(area);
    this.sync();
  }
  remove(id: string) {
    const index = this.footprints.findIndex((a) => a.id === id);
    if (index >= 0) {
      this.areas.splice(index, 1);
      this.sync();
    }
  }
  excludesVegetation(x: number, z: number, margin = 1.2): boolean {
    return this.footprints.some((a) =>
      containsFootprint(a, x, z, a.vegetationMargin !== undefined ? a.vegetationMargin : margin)
    );
  }
  floorHeight(x: number, z: number, base: number): number {
    for (const a of this.footprints) {
      if (a.clearingOnly) continue;
      if (containsFootprint(a, x, z)) base = Math.max(base, a.floorY);
    }
    return base;
  }
  blocksRain(x: number, y: number, z: number): boolean {
    return this.footprints.some((a) => {
      if (!a.roof || !containsFootprint(a, x, z)) return false;
      const p = localPoint(a, x, z),
        axis = a.roof.axis;
      const extent = axis === 'x' ? a.halfW : a.halfD;
      return y <= a.roof.eaveY + a.roof.rise * (1 - Math.abs(p[axis]) / extent);
    });
  }
  private sync() {
    const rows = Math.max(1, this.footprints.length);
    const data = new Float32Array(rows * 12);
    this.footprints.forEach((a, i) =>
      data.set(
        [
          a.x,
          a.z,
          a.halfW,
          a.halfD,
          Math.cos(a.yaw),
          Math.sin(a.yaw),
          a.roof?.eaveY ?? 0,
          a.roof?.rise ?? 0,
          a.roof?.axis === 'x' ? 1 : 0,
          a.roof ? 1 : 0,
          a.shape === 'circle' ? 1 : 0,
          a.vegetationMargin !== undefined ? a.vegetationMargin : -1,
        ],
        i * 12
      )
    );
    this.uniforms.uShelterData.value.dispose();
    const tex = new THREE.DataTexture(data, 3, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    this.uniforms.uShelterData.value = tex;
    this.uniforms.uShelterCount.value = this.footprints.length;
  }
  dispose() {
    this.uniforms.uShelterData.value.dispose();
  }
}

/** Same inverse transform and containment as the CPU queries above. */
export const shelterShader = `
uniform sampler2D uShelterData;
uniform int uShelterCount;
bool shelterContains(vec3 point, float margin, bool rain) {
  for (int i = 0; i < uShelterCount; i++) {
    float row = (float(i) + 0.5) / float(max(uShelterCount, 1));
    vec4 bounds = texture2D(uShelterData, vec2(1.0 / 6.0, row));
    vec4 frame = texture2D(uShelterData, vec2(0.5, row));
    vec4 roof = texture2D(uShelterData, vec2(5.0 / 6.0, row));
    vec2 delta = point.xz - bounds.xy;
    vec2 local = vec2(delta.x * frame.x - delta.y * frame.y, delta.x * frame.y + delta.y * frame.x);
    float effMargin = (!rain && roof.w >= -0.5) ? roof.w : margin;
    bool inside = roof.z > 0.5
      ? (length(local) <= bounds.z + effMargin)
      : all(lessThanEqual(abs(local), bounds.zw + vec2(effMargin)));
    if (inside) {
      if (!rain) return true;
      float slope = roof.x > 0.5 ? abs(local.x) / bounds.z : abs(local.y) / bounds.w;
      if (roof.y > 0.5 && point.y <= frame.z + frame.w * (1.0 - slope)) return true;
    }
  }
  return false;
}`;

export function excludeShelterVegetation(
  material: THREE.Material,
  shelters: ShelterGeometry
): void {
  const original = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    original.call(this, shader, renderer);
    Object.assign(shader.uniforms, shelters.uniforms);
    shader.vertexShader =
      shelterShader + '\nvarying float vShelterExcluded;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vec3 plantOrigin = vec3(0.0);
      #ifdef USE_INSTANCING
        plantOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #endif
      vShelterExcluded = shelterContains(plantOrigin, 1.2, false) ? 1.0 : 0.0;
    `
    );
    shader.fragmentShader = 'varying float vShelterExcluded;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif (vShelterExcluded > 0.5) discard;'
    );
  };
  material.customProgramCacheKey = () => cacheKey + '_shelter_exclusion_v2';
  material.needsUpdate = true;
}
