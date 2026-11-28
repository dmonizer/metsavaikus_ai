import * as THREE from 'three';
import { getStreamSampleAt, getTerrainHeight } from './terrainMath';
import { LakeBlueprint, StreamBlueprint } from './worldBlueprint';
import { SkyFrameState } from './weatherAndSky';
import { buildAllStreamVisuals, StreamShaderUniforms } from './streamBuilder';

export interface FreshwaterSystem {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  updateUniforms: (elapsed: number, skyState?: SkyFrameState) => void;
  dispose: () => void;
}

const FRESHWATER_LAKE_VERTEX = /* glsl */ `
attribute float aDepth;
varying vec3 vWorldPos;
varying float vDepth;
varying float vFogDepth;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vDepth = aDepth;
  vec4 mvPos = viewMatrix * wp;
  vFogDepth = -mvPos.z;
  gl_Position = projectionMatrix * mvPos;
}
`;

const FRESHWATER_LAKE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uWindStrength;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;

varying vec3 vWorldPos;
varying float vDepth;
varying float vFogDepth;

void main() {
  if (vDepth < -0.18) discard;

  vec2 p = vWorldPos.xz;
  float wind = clamp(uWindStrength, 0.08, 1.5);
  float t = uTime * (0.75 + wind * 0.55);

  // Multi-directional gentle freshwater ripples
  float w1 = sin(p.x * 0.62 + p.y * 0.34 + t * 1.45);
  float w2 = cos(p.x * 0.41 - p.y * 0.78 + t * 1.15);
  float w3 = sin((p.x + p.y) * 1.35 - t * 2.05) * 0.45;
  float rippleScale = (0.022 + wind * 0.026) * smoothstep(-0.08, 0.35, vDepth);
  vec3 N = normalize(vec3((w1 + w3) * rippleScale, 1.0, (w2 - w3) * rippleScale));

  vec3 V = normalize(cameraPosition - vWorldPos);
  float NoV = max(dot(N, V), 0.02);
  float fresnel = clamp(0.04 + 0.96 * pow(1.0 - NoV, 4.2), 0.0, 0.92);

  // Estonian forest lake palette: clear greenish-amber shallows -> cool slate-teal depths
  float depthT = smoothstep(0.0, 2.6, max(vDepth, 0.0));
  vec3 shallowCol = vec3(0.065, 0.115, 0.095);
  vec3 deepCol = vec3(0.018, 0.048, 0.062);
  vec3 waterBody = mix(shallowCol, deepCol, depthT);

  vec3 R = reflect(-V, N);
  float skyMix = smoothstep(-0.04, 0.52, max(R.y, 0.0));
  vec3 skyRefl = mix(uSkyHorizon, uSkyTop, skyMix);
  // Subtle pine-tree treeline darkening near lake horizon reflection
  skyRefl *= mix(0.68, 0.95, smoothstep(0.0, 0.32, max(R.y, 0.0)));

  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 110.0) * max(L.y, 0.0) * 1.15;
  vec3 sunSpec = uSunColor * spec;

  float shoreFoam = smoothstep(0.28, 0.02, vDepth) * smoothstep(-0.04, 0.04, vDepth) * 0.14;
  vec3 col = mix(waterBody, skyRefl, fresnel * 0.78) + sunSpec + vec3(0.22, 0.25, 0.24) * shoreFoam;

  // Match scene FogExp2 seamlessly
  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

  float alpha = smoothstep(-0.06, 0.22, vDepth);
  alpha = clamp(alpha * (0.76 + 0.22 * depthT + fresnel * 0.18), 0.0, 0.97);
  gl_FragColor = vec4(col, alpha);
}
`;

function buildLakeGeometry(lake: LakeBlueprint): THREE.BufferGeometry {
  // Higher shoreline grid density (56x56, ~1 draw call) so narrow stream mouths resolve seamlessly
  const segs = 56;
  const maxExtent = Math.max(lake.rx, lake.rz) * (1.22 + lake.wobbleAmp * 1.65);
  const geo = new THREE.PlaneGeometry(2, 2, segs, segs);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const depths = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const v = pos.getY(i);
    const dx = u * Math.sqrt(Math.max(0, 1 - 0.5 * v * v));
    const dz = v * Math.sqrt(Math.max(0, 1 - 0.5 * u * u));
    const lx = dx * maxExtent;
    const lz = -dz * maxExtent;
    pos.setXYZ(i, lx, 0, lz);

    const wx = lake.x + lx;
    const wz = lake.z + lz;
    const groundY = getTerrainHeight(wx, wz);
    let depth = lake.waterY - groundY;

    // Ensure lake water meets any incoming stream mouth continuously with zero clipped shoreline gap
    const st = getStreamSampleAt(wx, wz);
    if (st && st.progress > 0.86 && st.dist < st.halfWidth + 1.4 && Math.abs(st.waterY - lake.waterY) < 0.22) {
      const mouthBlend = 1 - Math.min(1, st.dist / (st.halfWidth + 1.4));
      depth = Math.max(depth, st.depth * mouthBlend);
    }

    depths[i] = depth;
  }

  geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function createFreshwaterSystem(
  lakes: readonly LakeBlueprint[],
  streams: readonly StreamBlueprint[]
): FreshwaterSystem {
  const group = new THREE.Group();
  group.name = 'freshwater_system';

  const sharedUniforms: StreamShaderUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: 0.3 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(0xfff4d6) },
    uSkyTop: { value: new THREE.Color(0x4c79a6) },
    uSkyHorizon: { value: new THREE.Color(0x88a2b2) },
    uFogColor: { value: new THREE.Color(0x88a2b2) },
    uFogDensity: { value: 0.0055 },
  };

  const lakeMat = new THREE.ShaderMaterial({
    vertexShader: FRESHWATER_LAKE_VERTEX,
    fragmentShader: FRESHWATER_LAKE_FRAGMENT,
    uniforms: sharedUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [lakeMat];
  const textures: THREE.Texture[] = [];
  const meshes: THREE.Mesh[] = [];

  for (const lake of lakes) {
    const geo = buildLakeGeometry(lake);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, lakeMat);
    mesh.position.set(lake.x, lake.waterY, lake.z);
    mesh.renderOrder = 2;
    mesh.name = lake.name;
    mesh.userData = {
      debugLayer: 'water',
      debugName: `${lake.name} (Freshwater Lake)`,
      debugMeta: { kind: 'lake', waterY: Number(lake.waterY.toFixed(2)) },
    };
    group.add(mesh);
    meshes.push(mesh);
  }

  const streamVisuals = buildAllStreamVisuals(streams, sharedUniforms);
  geometries.push(...streamVisuals.geometries);
  materials.push(...streamVisuals.materials);
  textures.push(...streamVisuals.textures);
  for (const m of streamVisuals.meshes) {
    group.add(m);
    meshes.push(m);
  }

  return {
    group,
    meshes,
    updateUniforms: (elapsed: number, skyState?: SkyFrameState) => {
      sharedUniforms.uTime.value = elapsed;
      if (skyState) {
        sharedUniforms.uWindStrength.value = skyState.windStrength;
        sharedUniforms.uSunDir.value.copy(skyState.sunDir);
        sharedUniforms.uSunColor.value.copy(skyState.sunColor);
        sharedUniforms.uSkyTop.value.copy(skyState.skyTopColor);
        sharedUniforms.uSkyHorizon.value.copy(skyState.skyHorizonColor);
        sharedUniforms.uFogColor.value.copy(skyState.skyHorizonColor);
        sharedUniforms.uFogDensity.value = skyState.fogDensity;
      }
    },
    dispose: () => {
      for (const geo of geometries) geo.dispose();
      for (const mat of materials) mat.dispose();
      for (const tex of textures) tex.dispose();
    },
  };
}
