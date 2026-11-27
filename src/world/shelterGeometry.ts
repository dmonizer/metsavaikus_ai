import * as THREE from 'three';
import { WORLD_HALF, WORLD_SIZE } from './terrainMath';
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
  /** When true, blocks rain/droplets without acting as floor, shelter, or vegetation exclusion. */
  roofOnly?: boolean;
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

const CELL_SIZE = 16;
const GRID_SIZE = Math.ceil(WORLD_SIZE / CELL_SIZE);
const PLANT_MARGIN = 1.2;

/** Authoritative floor/cover footprints, including runtime placements. Shared CPU and GPU queries. */
export class ShelterGeometry {
  private readonly areas: Footprint[] = [];

  // Each cell stores the [first, end) interval of potentially intersecting footprint rows.
  private readonly cellRanges = new Float32Array(GRID_SIZE * GRID_SIZE * 2);

  get footprints(): readonly Footprint[] {
    return this.areas;
  }
  readonly uniforms = {
    uShelterData: {
      value: new THREE.DataTexture(new Float32Array(12), 3, 1, THREE.RGBAFormat, THREE.FloatType),
    },
    uShelterCount: { value: 0 },
    uShelterCells: {
      value: new THREE.DataTexture(this.cellRanges, GRID_SIZE, GRID_SIZE, THREE.RGFormat, THREE.FloatType),
    },
  };
  add(area: Footprint) {
    this.areas.push(area);
    this.sync();
  }
  remove(id: string) {
    let removed = false;
    for (let i = this.areas.length - 1; i >= 0; i--) {
      if (this.areas[i].id === id) {
        this.areas.splice(i, 1);
        removed = true;
      }
    }
    if (removed) {
      this.sync();
    }
  }
  excludesVegetation(x: number, z: number, margin = 1.2): boolean {
    return this.footprints.some(
      (a) =>
        !a.roofOnly &&
        containsFootprint(a, x, z, a.vegetationMargin !== undefined ? a.vegetationMargin : margin)
    );
  }
  floorHeight(x: number, z: number, base: number): number {
    for (const a of this.footprints) {
      if (a.clearingOnly || a.roofOnly) continue;
      if (containsFootprint(a, x, z)) base = Math.max(base, a.floorY);
    }
    return base;
  }
  blocksRain(x: number, y: number, z: number): boolean {
    return this.footprints.some((a) => {
      if (!a.roof || !containsFootprint(a, x, z)) return false;
      const p = localPoint(a, x, z);
      const slope =
        a.shape === 'circle'
          ? Math.hypot(p.x, p.z) / Math.max(0.001, a.halfW)
          : Math.abs(p[a.roof.axis]) / (a.roof.axis === 'x' ? a.halfW : a.halfD);
      return y <= a.roof.eaveY + a.roof.rise * (1 - slope);
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
          a.roofOnly ? -2 : a.vegetationMargin !== undefined ? a.vegetationMargin : -1,
        ],
        i * 12
      )
    );
    this.cellRanges.fill(0);
    for (const [i, area] of this.areas.entries()) {
      // Circumscribe the rotated, expanded box (also conservative for circles and rain).
      const margin = Math.max(PLANT_MARGIN, area.vegetationMargin ?? 0);
      const radius = Math.hypot(area.halfW + margin, area.halfD + margin) + 0.001;
      const cell = (v: number) => Math.floor((v + WORLD_HALF) / CELL_SIZE);
      const x0 = Math.max(0, cell(area.x - radius));
      const x1 = Math.min(GRID_SIZE - 1, cell(area.x + radius));
      const z1 = Math.min(GRID_SIZE - 1, cell(area.z + radius));
      for (let z = Math.max(0, cell(area.z - radius)); z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const off = (z * GRID_SIZE + x) * 2;
          if (this.cellRanges[off + 1] === 0) this.cellRanges[off] = i;
          this.cellRanges[off + 1] = i + 1;
        }
      }
    }
    this.uniforms.uShelterCells.value.needsUpdate = true;
    this.uniforms.uShelterData.value.dispose();
    const tex = new THREE.DataTexture(data, 3, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    this.uniforms.uShelterData.value = tex;
    this.uniforms.uShelterCount.value = this.footprints.length;
  }
  dispose() {
    this.uniforms.uShelterCells.value.dispose();
    this.uniforms.uShelterData.value.dispose();
  }
}

/** Same inverse transform and containment as the CPU queries above. */
export const shelterShader = `
uniform sampler2D uShelterData;
uniform int uShelterCount;
uniform highp sampler2D uShelterCells;
bool shelterContains(vec3 point, float margin, bool rain) {
  if (uShelterCount == 0) return false;
  ivec2 range = ivec2(0, uShelterCount);
  ivec2 cell = ivec2(floor((point.xz + ${WORLD_HALF.toFixed(1)}) / ${CELL_SIZE.toFixed(1)}));
  if (margin <= ${PLANT_MARGIN.toFixed(1)} && all(greaterThanEqual(cell, ivec2(0))) && all(lessThan(cell, ivec2(${GRID_SIZE})))) {
    range = ivec2(texelFetch(uShelterCells, cell, 0).rg);
  }
  for (int i = range.x; i < range.y; i++) {
    float row = (float(i) + 0.5) / float(max(uShelterCount, 1));
    vec4 bounds = texture2D(uShelterData, vec2(1.0 / 6.0, row));
    vec4 frame = texture2D(uShelterData, vec2(0.5, row));
    vec4 roof = texture2D(uShelterData, vec2(5.0 / 6.0, row));
    if (!rain && roof.w < -1.5) continue;
    vec2 delta = point.xz - bounds.xy;
    vec2 local = vec2(delta.x * frame.x - delta.y * frame.y, delta.x * frame.y + delta.y * frame.x);
    float effMargin = (!rain && roof.w >= -0.5) ? roof.w : margin;
    bool inside = roof.z > 0.5
      ? (length(local) <= bounds.z + effMargin)
      : all(lessThanEqual(abs(local), bounds.zw + vec2(effMargin)));
    if (inside) {
      if (!rain) return true;
      float slope = roof.z > 0.5
        ? length(local) / max(0.001, bounds.z)
        : (roof.x > 0.5 ? abs(local.x) / bounds.z : abs(local.y) / bounds.w);
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
      vShelterExcluded = shelterContains(plantOrigin, ${PLANT_MARGIN.toFixed(1)}, false) ? 1.0 : 0.0;
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
