import * as THREE from 'three';
import { getTerrainHeight } from './terrainMath';
import { LakeBlueprint, StreamBlueprint } from './worldBlueprint';
import { SkyFrameState } from './weatherAndSky';

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

  float shoreFoam = smoothstep(0.28, 0.02, vDepth) * smoothstep(-0.04, 0.04, vDepth) * 0.16;
  vec3 col = mix(waterBody, skyRefl, fresnel * 0.78) + sunSpec + vec3(0.22, 0.25, 0.24) * shoreFoam;

  // Match scene FogExp2 seamlessly
  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

  float alpha = smoothstep(-0.06, 0.22, vDepth);
  alpha = clamp(alpha * (0.76 + 0.22 * depthT + fresnel * 0.18), 0.0, 0.97);
  gl_FragColor = vec4(col, alpha);
}
`;

const STREAM_VERTEX = /* glsl */ `
attribute float aSlope;
varying vec3 vWorldPos;
varying vec2 vUv;
varying float vSlope;
varying float vFogDepth;

void main() {
  vUv = uv;
  vSlope = aSlope;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec4 mvPos = viewMatrix * wp;
  vFogDepth = -mvPos.z;
  gl_Position = projectionMatrix * mvPos;
}
`;

const STREAM_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uWindStrength;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;

varying vec3 vWorldPos;
varying vec2 vUv;
varying float vSlope;
varying float vFogDepth;

void main() {
  // vUv.x = across stream [0..1], vUv.y = downstream distance in meters
  float edgeDist = min(vUv.x, 1.0 - vUv.x);
  float edgeMask = smoothstep(0.0, 0.18, edgeDist);

  float flowSpeed = 1.35 + clamp(vSlope * 9.0, 0.0, 2.2);
  float distFlow = vUv.y - uTime * flowSpeed;

  float streak1 = sin(distFlow * 2.4 + sin(vUv.x * 9.0 + distFlow * 0.7) * 1.4);
  float streak2 = cos(distFlow * 4.3 - vUv.x * 13.0 + uTime * 1.2);
  float riffle = 0.5 + 0.5 * (streak1 * 0.62 + streak2 * 0.38);

  vec3 N = normalize(vec3(
    (streak1 * 0.045 + streak2 * 0.03),
    1.0,
    (streak2 * 0.045 - streak1 * 0.025)
  ));
  vec3 V = normalize(cameraPosition - vWorldPos);
  float NoV = max(dot(N, V), 0.03);
  float fresnel = clamp(0.05 + 0.95 * pow(1.0 - NoV, 3.8), 0.0, 0.88);

  vec3 baseCol = mix(vec3(0.048, 0.092, 0.078), vec3(0.088, 0.135, 0.115), riffle * 0.55);
  vec3 R = reflect(-V, N);
  vec3 skyRefl = mix(uSkyHorizon, uSkyTop, smoothstep(-0.04, 0.5, max(R.y, 0.0))) * 0.86;

  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 85.0) * max(L.y, 0.0) * 1.1;

  // Whitewater foam streaks appear naturally where stream flows faster over steeper grades
  float slopeBoost = clamp(vSlope * 6.5, 0.08, 0.72);
  float foam = smoothstep(0.68, 0.96, riffle) * slopeBoost * (0.45 + 0.55 * edgeMask);
  float bankFoam = smoothstep(0.24, 0.05, edgeDist) * smoothstep(0.0, 0.06, edgeDist) * 0.22;

  vec3 col = mix(baseCol, skyRefl, fresnel * 0.68) + uSunColor * spec + vec3(0.42, 0.45, 0.44) * (foam + bankFoam);

  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

  float alpha = edgeMask * (0.78 + fresnel * 0.16 + foam * 0.12);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.94));
}
`;

function buildLakeGeometry(lake: LakeBlueprint): THREE.BufferGeometry {
  const segs = 28;
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
    depths[i] = lake.waterY - groundY;
  }

  geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function buildStreamRibbonGeometry(stream: StreamBlueprint): THREE.BufferGeometry {
  // Subdivide polyline 2x for smooth vertical & horizontal curves
  const src = stream.points;
  const dense: Array<{
    x: number;
    z: number;
    waterY: number;
    halfWidth: number;
    flowX: number;
    flowZ: number;
  }> = [];

  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i];
    const b = src[i + 1];
    dense.push(a);
    let fx = a.flowX + b.flowX;
    let fz = a.flowZ + b.flowZ;
    const fl = Math.hypot(fx, fz) || 1;
    dense.push({
      x: (a.x + b.x) * 0.5,
      z: (a.z + b.z) * 0.5,
      waterY: (a.waterY + b.waterY) * 0.5,
      halfWidth: (a.halfWidth + b.halfWidth) * 0.5,
      flowX: fx / fl,
      flowZ: fz / fl,
    });
  }
  dense.push(src[src.length - 1]);

  const count = dense.length;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const slopes = new Float32Array(count * 2);
  const indices: number[] = [];

  let accumDist = 0;
  for (let i = 0; i < count; i++) {
    const cur = dense[i];
    if (i > 0) {
      accumDist += Math.hypot(cur.x - dense[i - 1].x, cur.z - dense[i - 1].z);
    }

    const prev = dense[Math.max(0, i - 1)];
    const next = dense[Math.min(count - 1, i + 1)];
    const segLen = Math.max(0.5, Math.hypot(next.x - prev.x, next.z - prev.z));
    const localSlope = Math.max(0, (prev.waterY - next.waterY) / segLen);

    // Tuck ribbon edges ~16% wider than carved channel so water meets banks cleanly with zero gaps
    const perpX = -cur.flowZ;
    const perpZ = cur.flowX;
    const w = cur.halfWidth * 1.18;

    const leftIdx = i * 2;
    const rightIdx = i * 2 + 1;

    positions[leftIdx * 3] = cur.x - perpX * w;
    positions[leftIdx * 3 + 1] = cur.waterY;
    positions[leftIdx * 3 + 2] = cur.z - perpZ * w;

    positions[rightIdx * 3] = cur.x + perpX * w;
    positions[rightIdx * 3 + 1] = cur.waterY;
    positions[rightIdx * 3 + 2] = cur.z + perpZ * w;

    uvs[leftIdx * 2] = 0;
    uvs[leftIdx * 2 + 1] = accumDist;
    uvs[rightIdx * 2] = 1;
    uvs[rightIdx * 2 + 1] = accumDist;

    slopes[leftIdx] = localSlope;
    slopes[rightIdx] = localSlope;

    if (i < count - 1) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aSlope', new THREE.BufferAttribute(slopes, 1));
  geo.setIndex(indices);
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

  const sharedUniforms = {
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

  const streamMat = new THREE.ShaderMaterial({
    vertexShader: STREAM_VERTEX,
    fragmentShader: STREAM_FRAGMENT,
    uniforms: sharedUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const geometries: THREE.BufferGeometry[] = [];
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

  for (const stream of streams) {
    if (stream.points.length < 2) continue;
    const geo = buildStreamRibbonGeometry(stream);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, streamMat);
    mesh.renderOrder = 2;
    mesh.name = stream.name;
    mesh.userData = {
      debugLayer: 'water',
      debugName: `${stream.name} (Stream)`,
      debugMeta: { kind: 'stream', targetKind: stream.targetKind },
    };
    group.add(mesh);
    meshes.push(mesh);
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
      lakeMat.dispose();
      streamMat.dispose();
    },
  };
}
