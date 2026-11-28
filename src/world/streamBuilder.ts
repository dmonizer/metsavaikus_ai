import * as THREE from 'three';
import { createSeededRandom } from './seededRandom';
import { getTerrainHeight } from './terrainMath';
import { smoothstep } from './terrainRelief';
import { StreamBlueprint } from './worldBlueprint';

export interface StreamVisualBuildResult {
  meshes: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

export interface StreamShaderUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uTime: { value: number };
  uWindStrength: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSkyTop: { value: THREE.Color };
  uSkyHorizon: { value: THREE.Color };
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
}

interface DenseStreamSample {
  x: number;
  z: number;
  waterY: number;
  halfWidth: number;
  leftHalfW: number;
  rightHalfW: number;
  depth: number;
  slope: number;
  flowX: number;
  flowZ: number;
  perpX: number;
  perpZ: number;
  accumDist: number;
  distFromEnd: number;
  progress: number;
}

function lateralOffset(s: DenseStreamSample, frac: number): number {
  return frac < 0 ? frac * s.leftHalfW : frac * s.rightHalfW;
}

interface RockWakeSource {
  accumDist: number;
  /** Signed lateral position normalized by stream halfWidth (-1..+1 inside channel). */
  crossFrac: number;
  radius: number;
  slope: number;
  protrusion: number;
}

interface InstanceTransform {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
  r: number;
  g: number;
  b: number;
}

const STREAM_VERTEX = /* glsl */ `
attribute float aSlope;
attribute float aRockWake;
attribute float aWaterDepth;
attribute float aMouthFade;

varying vec3 vWorldPos;
varying vec2 vUv;
varying float vSlope;
varying float vRockWake;
varying float vWaterDepth;
varying float vMouthFade;
varying float vFogDepth;

void main() {
  vUv = uv;
  vSlope = aSlope;
  vRockWake = aRockWake;
  vWaterDepth = aWaterDepth;
  vMouthFade = aMouthFade;
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
varying float vRockWake;
varying float vWaterDepth;
varying float vMouthFade;
varying float vFogDepth;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  if (vMouthFade <= 0.004) discard;

  // vUv.x = across stream [0..1], vUv.y = downstream distance in meters
  float edgeDist = min(vUv.x, 1.0 - vUv.x);
  float edgeMask = smoothstep(0.0, 0.14, edgeDist);

  // Calm down flow speed & turbulence smoothly as water enters the lake
  float activeSlope = vSlope * vMouthFade;
  float activeWake = vRockWake * vMouthFade;
  float flowSpeed = mix(0.42, 0.90 + clamp(activeSlope * 15.0, 0.0, 2.5), vMouthFade);
  float distFlow = vUv.y - uTime * flowSpeed;

  // Multi-scale organic flow ripples + fine bubbling micro-ripples around rocks
  vec2 flowCoord1 = vec2(vUv.x * 3.8, distFlow * 2.2);
  vec2 flowCoord2 = vec2(vUv.x * 8.4 + 1.7, distFlow * 5.4 - uTime * 0.6);
  float n1 = vnoise(flowCoord1);
  float n2 = vnoise(flowCoord2);
  float n3 = vnoise(vec2(vUv.x * 16.5, distFlow * 11.2));
  float nLace = vnoise(vec2(vUv.x * 6.0 + n1 * 1.4, distFlow * 3.6 + n2 * 0.9));

  // Cross-channel chevron ripples around obstacles and banks
  float chevron = sin(distFlow * 5.8 + abs(vUv.x - 0.5) * 8.2) * 0.5 + 0.5;
  float riffle = n1 * 0.42 + n2 * 0.36 + n3 * 0.22;

  // Normal perturbation: glassy sky-mirroring ripples on flat brooks, lively chop over steep rocks
  float chopAmt = (0.018 + clamp(activeSlope * 0.65, 0.0, 0.082) + activeWake * 0.075) * edgeMask;
  float nx = ((n1 - 0.5) * 1.4 + (n2 - 0.5) * 0.9 + (chevron - 0.5) * 0.5) * chopAmt * 2.4;
  float nz = ((n2 - 0.5) * 1.3 - (n3 - 0.5) * 0.9) * chopAmt * 2.4;
  vec3 N = normalize(vec3(nx, 1.0, nz));

  vec3 V = normalize(cameraPosition - vWorldPos);
  float NoV = max(dot(N, V), 0.03);
  float fresnel = clamp(0.045 + 0.955 * pow(1.0 - NoV, 3.6), 0.0, 0.92);

  // Physically grounded shallow woodland brook tint:
  // Flat clear shallows show warm sunlit olive-amber tint; moderate runs show dark clear tannin;
  // Steep plunge pools show rich cool forest-teal; lake mouth cross-fades to FRESHWATER_LAKE shallowCol.
  float depthT = clamp(vWaterDepth / 0.24, 0.0, 1.0);
  float steepT = smoothstep(0.025, 0.11, activeSlope);
  vec3 clearShallow = vec3(0.088, 0.106, 0.062);
  vec3 tanninPool = vec3(0.028, 0.042, 0.036);
  vec3 cascadePool = vec3(0.024, 0.062, 0.074);
  vec3 lakeShallow = vec3(0.065, 0.115, 0.095);

  vec3 streamTint = mix(clearShallow, mix(tanninPool, cascadePool, steepT), depthT * 0.68 + steepT * 0.30);
  vec3 waterBody = mix(lakeShallow, streamTint, vMouthFade);

  // Sky & forest canopy reflection (produces realistic sky reflection patches like Photo 3)
  vec3 R = reflect(-V, N);
  float skyMix = smoothstep(-0.04, 0.50, max(R.y, 0.0));
  vec3 skyRefl = mix(uSkyHorizon, uSkyTop, skyMix);
  skyRefl *= mix(0.68, 0.96, smoothstep(0.0, 0.34, max(R.y, 0.0)));

  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float specPow = mix(115.0, 58.0, clamp(activeSlope * 7.0 + activeWake * 0.5, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), specPow) * max(L.y, 0.0) * 1.15;
  vec3 sunSpec = uSunColor * spec;

  // Broken, lacy, bubbly whitewater foam (NEVER a solid uniform white stripe!):
  // - Flat brook (slope < 0.022): crystal clear, nearly zero foam
  // - Moderate brook (0.022..0.06): silky white trailing wakes & bubble collars around protruding mossy rocks
  // - Steep cascade (> 0.06): frothy white streaks & tumbling aerated plumes alternating with dark clear pools
  float bubbleCells = smoothstep(0.38, 0.80, n2 * 0.52 + n3 * 0.48);
  float lacyVeins = pow(smoothstep(0.44, 0.86, nLace * 0.60 + n1 * 0.40), 1.45);
  float dropPulse = smoothstep(0.36, 0.82, sin(vUv.y * 1.45 + n1 * 2.4) * 0.5 + 0.5);

  // Crisp bubbling white collar & silky downstream wake wrapping around every protruding rock
  float wakeSlopeScale = 0.24 + smoothstep(0.015, 0.085, activeSlope) * 0.85;
  float rockFoam = activeWake * wakeSlopeScale * (0.38 + 0.62 * bubbleCells);

  // Broken frothy ribbons on steep drops (always leaves 45-65% dark clear water showing between foam streaks!)
  float cascadeFactor = smoothstep(0.050, 0.145, activeSlope);
  float cascadeFoam = cascadeFactor * (lacyVeins * 0.72 + dropPulse * bubbleCells * 0.42) * (0.45 + 0.55 * chevron);

  // Subtle bank splash foam only on lively stretches
  float edgeFoam = smoothstep(0.18, 0.03, edgeDist) * smoothstep(0.0, 0.05, edgeDist) *
    smoothstep(0.030, 0.10, activeSlope) * bubbleCells * 0.38;

  float totalFoam = clamp(rockFoam * 1.08 + cascadeFoam * 0.78 + edgeFoam, 0.0, 0.92) * edgeMask;

  // Day/night-aware natural aerated foam color (slightly cool sunlit white, never flat chalk)
  float dayLight = clamp(L.y * 2.1 + 0.22, 0.08, 1.0);
  vec3 foamColor = mix(uSkyHorizon * 1.12, vec3(0.92, 0.95, 0.96) * uSunColor, 0.58) * (0.82 * dayLight + 0.16);

  vec3 col = mix(waterBody, skyRefl, fresnel * 0.78) + sunSpec;
  col = mix(col, foamColor, totalFoam);

  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

  // Translucent shallow water so submerged pebbles, cobbles, sand, and twigs show clearly through!
  // Alpha rises naturally at grazing angles (Fresnel) and inside frothy whitewater bubbles.
  float clarityAlpha = mix(0.15, 0.36, depthT) + steepT * 0.10;
  float alpha = edgeMask * clamp(clarityAlpha + fresnel * 0.52 + totalFoam * 0.62, 0.0, 0.94);
  alpha *= vMouthFade;

  gl_FragColor = vec4(col, alpha);
}
`;

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function tileNoise(u: number, v: number, freq: number): number {
  const x = u * freq;
  const y = v * freq;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const i0 = ((ix % freq) + freq) % freq;
  const j0 = ((iy % freq) + freq) % freq;
  const i1 = (i0 + 1) % freq;
  const j1 = (j0 + 1) % freq;
  const a = hash2(i0, j0);
  const b = hash2(i1, j0);
  const c = hash2(i0, j1);
  const d = hash2(i1, j1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/**
 * Generates a deterministic seamless 256x256 DataTexture of a wet Estonian woodland streambed:
 * ochre sand/gravel, dark wet silt, rounded multi-tone river pebbles, and scattered leaf/twig detritus.
 */
function createStreambedTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const rng = createSeededRandom(918273);

  // 1. Base sandy gravel + dark wet silt mottled floor
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const nLow = tileNoise(u, v, 6);
      const nMid = tileNoise(u, v, 16);
      const nHi = tileNoise(u, v, 42);
      const grit = hash2(x * 1.7, y * 1.7);

      const silt = nLow * 0.55 + nMid * 0.45;
      const r = 74 + silt * 72 + (nHi - 0.5) * 28 + (grit - 0.5) * 14;
      const g = 65 + silt * 60 + (nHi - 0.5) * 24 + (grit - 0.5) * 12;
      const b = 44 + silt * 38 + (nHi - 0.5) * 18 + (grit - 0.5) * 10;

      const idx = (y * size + x) * 4;
      data[idx] = Math.max(0, Math.min(255, Math.round(r)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[idx + 3] = 255;
    }
  }

  // 2. Paint ~400 rounded multi-tone pebbles & small stones
  const pebblePalette: Array<[number, number, number]> = [
    [146, 132, 106], // warm ochre sandstone
    [164, 156, 140], // pale Estonian limestone pebble
    [108, 106, 100], // wet grey granite
    [78, 76, 70],    // dark basalt cobble
    [124, 104, 76],  // amber iron-stained pebble
    [94, 108, 74],   // algae/moss-tinted stone
  ];

  for (let p = 0; p < 400; p++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const rx = 2.0 + rng() * 6.5;
    const ry = rx * (0.58 + rng() * 0.42);
    const ang = rng() * Math.PI * 2;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const col = pebblePalette[Math.floor(rng() * pebblePalette.length)];
    const shade = 0.78 + rng() * 0.36;
    const pr = col[0] * shade;
    const pg = col[1] * shade;
    const pb = col[2] * shade;

    const bound = Math.ceil(Math.max(rx, ry)) + 2;
    for (let dy = -bound; dy <= bound; dy++) {
      for (let dx = -bound; dx <= bound; dx++) {
        const lx = dx * cosA + dy * sinA;
        const ly = -dx * sinA + dy * cosA;
        const nd = Math.hypot(lx / rx, ly / ry);
        if (nd > 1.15) continue;

        const px = ((Math.floor(cx + dx) % size) + size) % size;
        const py = ((Math.floor(cy + dy) % size) + size) % size;
        const idx = (py * size + px) * 4;

        if (nd > 0.94) {
          const ao = 1 - (1 - (nd - 0.94) / 0.21) * 0.34;
          data[idx] = Math.round(data[idx] * ao);
          data[idx + 1] = Math.round(data[idx + 1] * ao);
          data[idx + 2] = Math.round(data[idx + 2] * ao);
        } else {
          const dome = Math.sqrt(Math.max(0, 1 - nd * nd));
          const lit = 0.66 + dome * 0.44 + (lx / rx) * 0.08 - (ly / ry) * 0.1;
          const blend = smoothstep(0.95, 0.72, nd);
          data[idx] = Math.max(0, Math.min(255, Math.round(data[idx] * (1 - blend) + pr * lit * blend)));
          data[idx + 1] = Math.max(0, Math.min(255, Math.round(data[idx + 1] * (1 - blend) + pg * lit * blend)));
          data[idx + 2] = Math.max(0, Math.min(255, Math.round(data[idx + 2] * (1 - blend) + pb * lit * blend)));
        }
      }
    }
  }

  // 3. Paint ~150 dark submerged twigs, pine needles & fallen leaf flecks
  for (let d = 0; d < 150; d++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const isTwig = rng() < 0.48;
    const len = isTwig ? 6 + rng() * 14 : 2.5 + rng() * 4.5;
    const thick = isTwig ? 0.8 + rng() * 0.7 : 1.5 + rng() * 2.2;
    const ang = rng() * Math.PI * 2;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const dr = isTwig ? 48 + rng() * 26 : 82 + rng() * 44;
    const dg = isTwig ? 34 + rng() * 18 : 54 + rng() * 28;
    const db = isTwig ? 20 + rng() * 12 : 22 + rng() * 14;

    const steps = Math.ceil(len * 1.5);
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps) - 0.5;
      const sx = cx + cosA * t * len;
      const sy = cy + sinA * t * len;
      const rPx = Math.ceil(thick);
      for (let oy = -rPx; oy <= rPx; oy++) {
        for (let ox = -rPx; ox <= rPx; ox++) {
          if (ox * ox + oy * oy > thick * thick + 0.5) continue;
          const px = ((Math.floor(sx + ox) % size) + size) % size;
          const py = ((Math.floor(sy + oy) % size) + size) % size;
          const idx = (py * size + px) * 4;
          data[idx] = Math.round(data[idx] * 0.35 + dr * 0.65);
          data[idx + 1] = Math.round(data[idx + 1] * 0.35 + dg * 0.65);
          data[idx + 2] = Math.round(data[idx + 2] * 0.35 + db * 0.65);
        }
      }
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a realistic speckled wet glacial-granite & lichen detail DataTexture
 * that multiplies with per-vertex moss/wetness colors on stream boulders & cobbles.
 */
function createGraniteStoneTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n1 = tileNoise(u, v, 5);
      const n2 = tileNoise(u, v, 14);
      const n3 = tileNoise(u, v, 36);
      const grain = hash2(x * 2.3 + 5, y * 2.3 - 3);
      // Subtle granite mineral flecking + crevice darkening (centered near ~215 so vertexColors govern hue)
      const val = 172 + n1 * 38 + (n2 - 0.5) * 42 + (n3 - 0.5) * 28 + (grain - 0.5) * 30;
      const crack = n2 < 0.22 ? 0.72 : 1.0;
      const r = Math.max(60, Math.min(255, Math.round(val * crack * (0.98 + n1 * 0.04))));
      const g = Math.max(60, Math.min(255, Math.round(val * crack * (0.97 + n2 * 0.05))));
      const b = Math.max(55, Math.min(255, Math.round(val * crack * (0.93 + n3 * 0.05))));
      const idx = (y * size + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates weathered wet bark furrow detail DataTexture for fallen mossy stream logs.
 */
function createMossyBarkTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Longitudinal bark ridges along U (log length)
      const furrow = tileNoise(u * 0.5, v * 3.0, 12);
      const fine = tileNoise(u, v, 28);
      const grit = hash2(x * 1.9, y * 3.1);
      const vShade = 148 + furrow * 64 + (fine - 0.5) * 36 + (grit - 0.5) * 22;
      const idx = (y * size + x) * 4;
      data[idx] = Math.max(45, Math.min(255, Math.round(vShade * 1.02)));
      data[idx + 1] = Math.max(45, Math.min(255, Math.round(vShade * 0.99)));
      data[idx + 2] = Math.max(40, Math.min(255, Math.round(vShade * 0.90)));
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Resamples a coarse StreamBlueprint polyline into a smooth ~0.44m-step centerline
 * while strictly preserving monotonic downhill waterY.
 */
function resampleStreamCenterline(stream: StreamBlueprint, streamIndex: number): DenseStreamSample[] {
  const src = stream.points;
  const n = src.length;
  const raw: Array<{
    x: number;
    z: number;
    waterY: number;
    halfWidth: number;
    depth: number;
    progress: number;
  }> = [];

  for (let i = 0; i < n - 1; i++) {
    const p0 = src[Math.max(0, i - 1)];
    const p1 = src[i];
    const p2 = src[i + 1];
    const p3 = src[Math.min(n - 1, i + 2)];
    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const subSteps = Math.max(4, Math.min(28, Math.round(segLen / 0.44)));

    for (let s = 0; s < subSteps; s++) {
      const t = s / subSteps;
      const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
      const z = catmullRom(p0.z, p1.z, p2.z, p3.z, t);
      const waterY = p1.waterY + (p2.waterY - p1.waterY) * t;
      const halfWidth = p1.halfWidth + (p2.halfWidth - p1.halfWidth) * t;
      const depth = p1.depth + (p2.depth - p1.depth) * t;
      const progress = (i + t) / (n - 1);
      raw.push({ x, z, waterY, halfWidth, depth, progress });
    }
  }
  const last = src[n - 1];
  raw.push({
    x: last.x,
    z: last.z,
    waterY: last.waterY,
    halfWidth: last.halfWidth,
    depth: last.depth,
    progress: 1,
  });

  const dists = new Float64Array(raw.length);
  for (let i = 1; i < raw.length; i++) {
    dists[i] = dists[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z);
  }
  const totalDist = dists[raw.length - 1];
  const phaseL = streamIndex * 2.17 + 0.65;
  const phaseR = streamIndex * 3.41 + 2.30;

  const out: DenseStreamSample[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const prev = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const dl = Math.hypot(dx, dz) || 1;
    const flowX = dx / dl;
    const flowZ = dz / dl;

    const iBack = Math.max(0, i - 3);
    const iFwd = Math.min(raw.length - 1, i + 3);
    const spanDist = Math.max(0.4, dists[iFwd] - dists[iBack]);
    const slope = Math.max(0, (raw[iBack].waterY - raw[iFwd].waterY) / spanDist);

    const distFromEnd = totalDist - dists[i];
    // Organic asymmetric bank width variation (pinched rocky narrows + widened natural pools),
    // tapering cleanly to symmetric 1.0 over the final 8m before the lake/bog mouth.
    const wobbleEnv = smoothstep(2.0, 9.5, distFromEnd) * smoothstep(0.0, 2.5, dists[i]);
    const dist = dists[i];
    const leftWobble =
      1 +
      wobbleEnv *
        (Math.sin(dist * 0.42 + phaseL) * 0.14 + Math.sin(dist * 1.07 + phaseL * 1.9) * 0.07);
    const rightWobble =
      1 +
      wobbleEnv *
        (Math.sin(dist * 0.37 + phaseR) * 0.14 + Math.cos(dist * 0.94 + phaseR * 1.5) * 0.07);

    out[i] = {
      x: raw[i].x,
      z: raw[i].z,
      waterY: raw[i].waterY,
      halfWidth: raw[i].halfWidth,
      leftHalfW: raw[i].halfWidth * leftWobble,
      rightHalfW: raw[i].halfWidth * rightWobble,
      depth: raw[i].depth,
      slope,
      flowX,
      flowZ,
      perpX: -flowZ,
      perpZ: flowX,
      accumDist: dist,
      distFromEnd,
      progress: raw[i].progress,
    };
  }

  return out;
}

/**
 * Builds a smooth, organic indexed glacial-granite stream boulder geometry (unit radius)
 * with realistic wet dark lower granite, textured sides, and rich natural velvet moss on top.
 */
function createMossyStreamBoulderGeometry(): THREE.BufferGeometry {
  // Indexed SphereGeometry ensures buttery-smooth vertex normals (zero PS1 flat-shaded facets!)
  const geo = new THREE.SphereGeometry(1.0, 16, 12);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Smooth organic water-worn river boulder displacement
    const n1 = Math.sin(v.x * 2.5 + v.z * 2.1) * Math.cos(v.y * 2.3 - v.x * 1.7);
    const n2 = Math.sin(v.x * 4.8 - v.y * 4.1 + v.z * 3.9);
    const n3 = Math.cos(v.x * 7.2 + v.y * 5.8 - v.z * 6.4);
    const r = 1.0 + n1 * 0.14 + n2 * 0.055 + n3 * 0.025;
    let y = v.y * r;
    // Gently flatten underside so boulders sit naturally embedded in the streambed
    if (y < -0.18) y = -0.18 + (y + 0.18) * 0.52;
    pos.setXYZ(i, v.x * r, y, v.z * r);
  }
  geo.computeVertexNormals();

  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const ny = norm.getY(i);

    const speckle = 0.86 + 0.28 * hash2(px * 17.3 + pz * 9.1, py * 13.7);
    // Wet darkened waterline base -> natural cool Estonian granite grey-brown above
    const wetT = smoothstep(-0.34, 0.26, py);
    let r = (0.095 + 0.195 * wetT) * speckle;
    let g = (0.095 + 0.188 * wetT) * speckle;
    let b = (0.088 + 0.165 * wetT) * speckle;

    // Deep rich natural forest cushion moss cap on upper surfaces (organic irregular edge)
    const mossEdge = Math.sin(px * 4.2 + pz * 3.8) * 0.16 + Math.cos(px * 7.5 - pz * 6.2) * 0.08;
    const mossT = smoothstep(0.40, 0.74, ny + mossEdge) * smoothstep(0.08, 0.44, py);
    const mossTone = 0.85 + 0.30 * hash2(px * 23.1, pz * 19.7);
    const mossR = 0.068 * mossTone;
    const mossG = 0.185 * mossTone;
    const mossB = 0.028 * mossTone;

    r = r * (1 - mossT) + mossR * mossT;
    g = g * (1 - mossT) + mossG * mossT;
    b = b * (1 - mossT) + mossB * mossT;

    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Smooth flattened river cobble/pebble geometry for submerged streambed stones.
 */
function createSubmergedPebbleGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1.0, 10, 7);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const jitter = 0.92 + 0.14 * Math.sin(x * 3.8 + z * 3.2);
    pos.setXYZ(i, x * jitter, y * 0.42 * jitter, z * 0.84 * jitter);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Slender waterlogged twig/branch geometry for streambed detritus.
 */
function createStreamTwigGeometry(): THREE.BufferGeometry {
  const rings = 5;
  const sides = 5;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const cx = (t - 0.5) * 1.0;
    const cy = Math.sin(t * Math.PI) * 0.032;
    const cz = Math.sin(t * Math.PI * 1.6) * 0.068;
    const rad = 0.020 * (1.0 - t * 0.45);
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      positions.push(cx, cy + Math.cos(ang) * rad, cz + Math.sin(ang) * rad);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const nextS = (s + 1) % sides;
      const a = r * sides + s;
      const b = r * sides + nextS;
      const c = (r + 1) * sides + s;
      const d = (r + 1) * sides + nextS;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Fallen mossy woodland log geometry (aligned along X axis, length 1, radius 0.13)
 * with weathered wet bark below and natural velvet moss on top.
 */
function createFallenMossyLogGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.105, 0.138, 1.0, 12, 6, false);
  geo.rotateZ(Math.PI * 0.5);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const bendY = Math.sin((x + 0.5) * Math.PI) * 0.022;
    const bendZ = Math.sin((x + 0.5) * Math.PI * 1.4) * 0.028;
    const ridge = 1 + 0.055 * Math.sin(Math.atan2(z, y) * 7 + x * 9);
    pos.setXYZ(i, x, y * ridge + bendY, z * ridge + bendZ);
  }
  geo.computeVertexNormals();

  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const ny = norm.getY(i);
    const barkVar = 0.85 + 0.3 * hash2(x * 17.1, ny * 9.3);
    let r = 0.135 * barkVar;
    let g = 0.095 * barkVar;
    let b = 0.062 * barkVar;
    const moss = smoothstep(0.32, 0.74, ny + Math.sin(x * 8.5) * 0.14);
    r = r * (1 - moss) + 0.072 * barkVar * moss;
    g = g * (1 - moss) + 0.195 * barkVar * moss;
    b = b * (1 - moss) + 0.032 * barkVar * moss;

    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds the high-resolution 7-column 3D streambed ribbon mesh with upward-facing (+Y)
 * normals, textured pebble/sand bed, and smooth ground-hugging outer banks.
 */
function buildStreambedGeometry(
  samples: readonly DenseStreamSample[],
  stream: StreamBlueprint
): THREE.BufferGeometry {
  const cols = 7;
  const uFracs = [-2.55, -1.42, -0.82, 0.0, 0.82, 1.42, 2.55];
  const rowCount = samples.length;
  const vertCount = rowCount * cols;

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let i = 0; i < rowCount; i++) {
    const s = samples[i];
    const mouthSink = 1 - smoothstep(0.0, 7.5, s.distFromEnd);
    const flatBright = 1 - smoothstep(0.018, 0.075, s.slope);

    for (let c = 0; c < cols; c++) {
      const frac = uFracs[c];
      const lat = lateralOffset(s, frac);
      const wx = s.x + s.perpX * lat;
      const wz = s.z + s.perpZ * lat;
      const absFrac = Math.abs(frac);

      let wy: number;
      if (absFrac < 0.05) {
        const undul = (hash2(wx * 1.9, wz * 1.9) - 0.5) * 0.022;
        wy = s.waterY - s.depth + undul - mouthSink * 0.22;
      } else if (absFrac < 0.95) {
        wy = s.waterY - s.depth * 0.36 - mouthSink * 0.20;
      } else if (absFrac < 1.8) {
        // Cozy mossy bank lip sitting cleanly at waterline and smoothly meeting surrounding ground
        const groundY = getTerrainHeight(wx, wz);
        const clampedLip = Math.min(Math.max(groundY + 0.03, s.waterY + 0.04), s.waterY + 0.14);
        const mouthLipY = Math.min(groundY - 0.04, s.waterY - 0.18);
        wy = clampedLip * (1 - mouthSink) + mouthLipY * mouthSink;
      } else {
        // Wide outer mossy skirt tucked seamlessly beneath surrounding carved hillside terrain
        const groundY = getTerrainHeight(wx, wz);
        wy = groundY - 0.06 - mouthSink * 0.14;
      }

      const vIdx = i * cols + c;
      positions[vIdx * 3] = wx;
      positions[vIdx * 3 + 1] = wy;
      positions[vIdx * 3 + 2] = wz;

      // Tile UV cleanly at ~1.25m per repeat so pebbles read at natural 3-10cm scale
      uvs[vIdx * 2] = (frac + 2.55) * 0.36;
      uvs[vIdx * 2 + 1] = s.accumDist * 0.80;

      // Linear RGB vertex color: warm sunlit ochre pebble bed in flat shallows, rich wet silt in cascades, mossy edges
      const bedR = 0.52 + flatBright * 0.36;
      const bedG = 0.48 + flatBright * 0.32;
      const bedB = 0.35 + flatBright * 0.20;

      const wetR = 0.22;
      const wetG = 0.21;
      const wetB = 0.14;

      const mossR = 0.13;
      const mossG = 0.24;
      const mossB = 0.068;

      let cr: number;
      let cg: number;
      let cb: number;
      if (absFrac < 0.95) {
        const edgeDark = absFrac * 0.32;
        cr = bedR * (1 - edgeDark) + wetR * edgeDark;
        cg = bedG * (1 - edgeDark) + wetG * edgeDark;
        cb = bedB * (1 - edgeDark) + wetB * edgeDark;
      } else if (absFrac < 1.8) {
        cr = mossR * (1 - mouthSink) + bedR * 0.72 * mouthSink;
        cg = mossG * (1 - mouthSink) + bedG * 0.72 * mouthSink;
        cb = mossB * (1 - mouthSink) + bedB * 0.72 * mouthSink;
      } else {
        cr = mossR * 0.90;
        cg = mossG * 0.90;
        cb = mossB * 0.90;
      }

      if (stream.regime === 'cascade' && absFrac < 0.85) {
        cr *= 0.84;
        cg *= 0.88;
        cb *= 0.94;
      }

      colors[vIdx * 3] = cr;
      colors[vIdx * 3 + 1] = cg;
      colors[vIdx * 3 + 2] = cb;
    }

    if (i < rowCount - 1) {
      const rowA = i * cols;
      const rowB = (i + 1) * cols;
      for (let c = 0; c < cols - 1; c++) {
        const a = rowA + c;
        const b = a + 1;
        const cIdx = rowB + c;
        const d = cIdx + 1;
        // Counter-clockwise when viewed from above so (b-a) x (cIdx-a) = (+perp) x (+flow) = +Y!
        indices.push(a, b, cIdx, b, d, cIdx);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Deterministically populates protruding mossy boulders, submerged pebbles, submerged twigs,
 * and fallen mossy logs along a single stream, returning rock wake sources for the water shader.
 */
function populateStreamProps(
  streamIndex: number,
  _stream: StreamBlueprint,
  samples: readonly DenseStreamSample[],
  boulders: InstanceTransform[],
  pebbles: InstanceTransform[],
  twigs: InstanceTransform[],
  logs: InstanceTransform[]
): RockWakeSource[] {
  const rng = createSeededRandom(440921 + streamIndex * 7919);
  const wakes: RockWakeSource[] = [];
  const totalDist = samples[samples.length - 1].accumDist;

  let cursor = 0;
  const sampleAtDist = (dist: number): DenseStreamSample => {
    if (dist < samples[cursor].accumDist) cursor = 0;
    while (cursor < samples.length - 2 && samples[cursor + 1].accumDist < dist) {
      cursor++;
    }
    return samples[cursor];
  };

  // 1. Protruding Moss-Capped Boulders (well-proportioned so bubbling water flows visibly around & over them!)
  let d = 1.4 + rng() * 1.0;
  while (d < totalDist - 5.2) {
    const s = sampleAtDist(d);
    const slope = s.slope;
    const isSteep = slope >= 0.050;
    const isModerate = slope >= 0.020 && slope < 0.050;

    const stepM = isSteep
      ? 0.60 + rng() * 0.52
      : isModerate
        ? 1.15 + rng() * 1.25
        : 2.30 + rng() * 2.20;

    const clusterCount = isSteep
      ? 2 + Math.floor(rng() * 2.2)
      : isModerate
        ? 1 + (rng() < 0.42 ? 1 : 0)
        : rng() < 0.70
          ? 1
          : 0;

    for (let k = 0; k < clusterCount; k++) {
      const inChannelProb = isSteep ? 0.40 : isModerate ? 0.50 : 0.34;
      const inChannel = rng() < inChannelProb;

      let crossFrac: number;
      if (inChannel) {
        crossFrac = (rng() * 2 - 1) * 0.72;
      } else {
        const side = rng() < 0.5 ? -1 : 1;
        crossFrac = side * (0.90 + rng() * 0.62);
      }

      const jitterAlong = (rng() - 0.5) * 0.55;
      const lat = lateralOffset(s, crossFrac);
      const wx = s.x + s.perpX * lat + s.flowX * jitterAlong;
      const wz = s.z + s.perpZ * lat + s.flowZ * jitterAlong;

      // In-channel rocks stay compact (11-23cm radius) so the narrow <=1m stream stays clearly visible around them;
      // outer bank boulders can be larger (20-38cm) like Photo 1's mossy framing rocks!
      const baseR = inChannel
        ? isSteep
          ? 0.12 + rng() * 0.12
          : isModerate
            ? 0.11 + rng() * 0.11
            : 0.08 + rng() * 0.09
        : isSteep
          ? 0.18 + rng() * 0.22
          : isModerate
            ? 0.14 + rng() * 0.16
            : 0.10 + rng() * 0.12;

      const sx = baseR * (0.88 + rng() * 0.34);
      const sz = baseR * (0.82 + rng() * 0.32);
      const sy = baseR * (isSteep ? 0.58 + rng() * 0.28 : 0.46 + rng() * 0.24);

      const bedY = s.waterY - s.depth * Math.max(0.18, 1 - crossFrac * crossFrac * 0.75);
      let py: number;
      let protrusion: number;
      if (inChannel) {
        protrusion = isSteep
          ? 0.05 + rng() * 0.14
          : isModerate
            ? 0.035 + rng() * 0.10
            : 0.02 + rng() * 0.05;
        py = Math.max(bedY + sy * 0.28, s.waterY + protrusion - sy * 0.88);
      } else {
        const gY = getTerrainHeight(wx, wz);
        const bankBase = Math.max(s.waterY - 0.02, Math.min(gY, s.waterY + 0.20));
        py = bankBase + sy * 0.16;
        protrusion = Math.max(0.05, py + sy * 0.85 - s.waterY);
      }

      const tone = 0.84 + rng() * 0.28;
      boulders.push({
        px: wx,
        py,
        pz: wz,
        rx: (rng() - 0.5) * 0.22,
        ry: rng() * Math.PI * 2,
        rz: (rng() - 0.5) * 0.22,
        sx,
        sy,
        sz,
        r: tone,
        g: tone * (0.97 + rng() * 0.06),
        b: tone * (0.93 + rng() * 0.06),
      });

      if (Math.abs(crossFrac) < 1.05 && py + sy * 0.9 > s.waterY - 0.03) {
        wakes.push({
          accumDist: d + jitterAlong,
          crossFrac,
          radius: Math.max(sx, sz),
          slope,
          protrusion,
        });
      }
    }

    d += stepM;
  }

  // 2. Submerged Small Rocks & River Pebbles (clearly visible right through the shallow water!)
  cursor = 0;
  let dp = 0.6 + rng() * 0.5;
  while (dp < totalDist - 3.6) {
    const s = sampleAtDist(dp);
    const isFlat = s.slope < 0.028;
    const count = isFlat ? 2 + Math.floor(rng() * 2.5) : 1 + Math.floor(rng() * 2.0);
    for (let k = 0; k < count; k++) {
      const crossFrac = (rng() * 2 - 1) * 0.92;
      const alongJit = (rng() - 0.5) * 0.65;
      const lat = lateralOffset(s, crossFrac);
      const wx = s.x + s.perpX * lat + s.flowX * alongJit;
      const wz = s.z + s.perpZ * lat + s.flowZ * alongJit;

      const rad = 0.045 + rng() * 0.095;
      const sy = rad * (0.52 + rng() * 0.42);
      const bedY = s.waterY - s.depth * Math.max(0.28, 1 - crossFrac * crossFrac * 0.62);
      const py = Math.min(s.waterY - 0.015, bedY + sy * 0.28);

      const pick = rng();
      let cr: number;
      let cg: number;
      let cb: number;
      if (pick < 0.36) {
        cr = 0.48 + rng() * 0.16;
        cg = 0.39 + rng() * 0.14;
        cb = 0.22 + rng() * 0.09;
      } else if (pick < 0.66) {
        const v = 0.45 + rng() * 0.18;
        cr = v * 1.02;
        cg = v * 0.98;
        cb = v * 0.88;
      } else {
        cr = 0.21 + rng() * 0.12;
        cg = 0.23 + rng() * 0.13;
        cb = 0.16 + rng() * 0.09;
      }

      pebbles.push({
        px: wx,
        py,
        pz: wz,
        rx: (rng() - 0.5) * 0.32,
        ry: rng() * Math.PI * 2,
        rz: (rng() - 0.5) * 0.32,
        sx: rad * (0.85 + rng() * 0.35),
        sy,
        sz: rad * (0.80 + rng() * 0.35),
        r: cr,
        g: cg,
        b: cb,
      });
    }
    dp += isFlat ? 0.54 + rng() * 0.40 : 0.78 + rng() * 0.60;
  }

  // 3. Submerged Twigs, Sticks & Forest Detritus visible through the water
  cursor = 0;
  let dt = 1.0 + rng() * 1.0;
  while (dt < totalDist - 4.2) {
    const s = sampleAtDist(dt);
    const crossFrac = (rng() * 2 - 1) * 0.88;
    const lat = lateralOffset(s, crossFrac);
    const wx = s.x + s.perpX * lat;
    const wz = s.z + s.perpZ * lat;
    const bedY = s.waterY - s.depth * Math.max(0.25, 1 - crossFrac * crossFrac * 0.65);
    const py = Math.min(s.waterY - 0.012, bedY + 0.016);

    const flowYaw = Math.atan2(s.flowZ, s.flowX);
    const len = 0.28 + rng() * 0.52;
    const thick = 0.65 + rng() * 0.75;
    const shade = 0.72 + rng() * 0.38;

    twigs.push({
      px: wx,
      py,
      pz: wz,
      rx: (rng() - 0.5) * 0.12,
      ry: -flowYaw + (rng() - 0.5) * 1.25,
      rz: (rng() - 0.5) * 0.12,
      sx: len,
      sy: thick,
      sz: thick,
      r: 0.22 * shade,
      g: 0.15 * shade,
      b: 0.085 * shade,
    });

    dt += 0.90 + rng() * 1.35;
  }

  // 4. Occasional Fallen Mossy Logs
  cursor = 0;
  let dl = 8.5 + rng() * 10.5;
  while (dl < totalDist - 14.0) {
    const s = sampleAtDist(dl);
    const flowYaw = Math.atan2(s.flowZ, s.flowX);
    const bridgeAcross = s.slope >= 0.032 ? rng() < 0.62 : rng() < 0.28;

    if (bridgeAcross) {
      const len = s.halfWidth * 2.6 + 0.9 + rng() * 1.2;
      const radScale = 0.68 + rng() * 0.58;
      const py = s.waterY + 0.14 + rng() * 0.24;
      const crossAngle = -flowYaw + Math.PI * 0.5 + (rng() - 0.5) * 0.55;
      const tone = 0.86 + rng() * 0.24;
      logs.push({
        px: s.x + (rng() - 0.5) * 0.25,
        py,
        pz: s.z + (rng() - 0.5) * 0.25,
        rx: (rng() - 0.5) * 0.10,
        ry: crossAngle,
        rz: (rng() - 0.5) * 0.14,
        sx: len,
        sy: radScale,
        sz: radScale,
        r: tone,
        g: tone,
        b: tone,
      });
    } else {
      const side = rng() < 0.5 ? -1 : 1;
      const lat = lateralOffset(s, side * 0.98);
      const wx = s.x + s.perpX * lat;
      const wz = s.z + s.perpZ * lat;
      const len = 1.4 + rng() * 1.4;
      const radScale = 0.62 + rng() * 0.42;
      const py = s.waterY + 0.02 + rng() * 0.05;
      const bankAngle = -flowYaw + (rng() - 0.5) * 0.36;
      const tone = 0.86 + rng() * 0.24;
      logs.push({
        px: wx,
        py,
        pz: wz,
        rx: (rng() - 0.5) * 0.08,
        ry: bankAngle,
        rz: (rng() - 0.5) * 0.08,
        sx: len,
        sy: radScale,
        sz: radScale,
        r: tone,
        g: tone,
        b: tone,
      });
    }

    dl += 15.0 + rng() * 18.0;
  }

  return wakes;
}

/**
 * Builds a 5-column high-resolution translucent stream water ribbon with upward-facing (+Y)
 * normals and baked per-vertex slope, rock-wake foam field, local water depth, and lake mouth fade.
 */
function buildStreamWaterGeometry(
  samples: readonly DenseStreamSample[],
  wakes: readonly RockWakeSource[]
): THREE.BufferGeometry {
  const cols = 5;
  const crossFracs = [-1.06, -0.54, 0.0, 0.54, 1.06];
  const uVals = [0.0, 0.24, 0.5, 0.76, 1.0];
  const rowCount = samples.length;
  const vertCount = rowCount * cols;

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const slopes = new Float32Array(vertCount);
  const rockWakes = new Float32Array(vertCount);
  const waterDepths = new Float32Array(vertCount);
  const mouthFades = new Float32Array(vertCount);
  const indices: number[] = [];

  let wakeStart = 0;

  for (let i = 0; i < rowCount; i++) {
    const s = samples[i];
    const mouthFade = smoothstep(0.0, 5.5, s.distFromEnd);

    while (wakeStart < wakes.length && wakes[wakeStart].accumDist < s.accumDist - 2.6) {
      wakeStart++;
    }

    for (let c = 0; c < cols; c++) {
      const frac = crossFracs[c];
      const lat = lateralOffset(s, frac);
      const wx = s.x + s.perpX * lat;
      const wz = s.z + s.perpZ * lat;

      let wakeSum = 0;
      let pillowY = 0;
      for (let wIdx = wakeStart; wIdx < wakes.length; wIdx++) {
        const wk = wakes[wIdx];
        const ds = s.accumDist - wk.accumDist;
        if (ds < -0.95) break;
        const tailLen = wk.radius * (4.2 + Math.min(0.14, wk.slope) * 32.0);
        if (ds > tailLen) continue;

        const latDist = Math.abs(lat - lateralOffset(s, wk.crossFrac));
        const spread = wk.radius * (1.35 + Math.max(0, ds) * 0.45);
        if (latDist > spread) continue;

        const latFalloff = 1 - smoothstep(0, spread, latDist);
        let longFalloff: number;
        if (ds < 0) {
          longFalloff = 1 - smoothstep(0, wk.radius * 1.45, -ds);
          pillowY += longFalloff * latFalloff * Math.min(0.022, wk.slope * 0.25);
        } else {
          longFalloff = 1 - smoothstep(0, tailLen, ds);
        }
        wakeSum += latFalloff * longFalloff * (0.80 + wk.protrusion * 2.5);
      }

      const clampedWake = Math.min(1.0, wakeSum);
      const localDepth = s.depth * Math.max(0.08, 1 - frac * frac * 0.82);

      const vIdx = i * cols + c;
      positions[vIdx * 3] = wx;
      positions[vIdx * 3 + 1] = s.waterY + pillowY * mouthFade;
      positions[vIdx * 3 + 2] = wz;

      uvs[vIdx * 2] = uVals[c];
      uvs[vIdx * 2 + 1] = s.accumDist;

      slopes[vIdx] = s.slope;
      rockWakes[vIdx] = clampedWake;
      waterDepths[vIdx] = localDepth;
      mouthFades[vIdx] = mouthFade;
    }

    if (i < rowCount - 1) {
      const rowA = i * cols;
      const rowB = (i + 1) * cols;
      for (let c = 0; c < cols - 1; c++) {
        const a = rowA + c;
        const b = a + 1;
        const cIdx = rowB + c;
        const d = cIdx + 1;
        // Counter-clockwise from above (+Y normals)
        indices.push(a, b, cIdx, b, d, cIdx);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aSlope', new THREE.BufferAttribute(slopes, 1));
  geo.setAttribute('aRockWake', new THREE.BufferAttribute(rockWakes, 1));
  geo.setAttribute('aWaterDepth', new THREE.BufferAttribute(waterDepths, 1));
  geo.setAttribute('aMouthFade', new THREE.BufferAttribute(mouthFades, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function buildInstancedBatch(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: readonly InstanceTransform[],
  castShadow = false,
  receiveShadow = true
): THREE.InstancedMesh | null {
  if (items.length === 0) return null;
  const inst = new THREE.InstancedMesh(geometry, material, items.length);
  inst.name = name;
  inst.castShadow = castShadow;
  inst.receiveShadow = receiveShadow;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    dummy.position.set(it.px, it.py, it.pz);
    dummy.rotation.set(it.rx, it.ry, it.rz);
    dummy.scale.set(it.sx, it.sy, it.sz);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    color.setRGB(it.r, it.g, it.b);
    inst.setColorAt(i, color);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.computeBoundingSphere();
  return inst;
}

/**
 * Builds all narrow woodland stream visuals:
 * - High-resolution textured 3D streambed ribbons (crisp <=1m channels, +Y normals)
 * - Translucent bubbling water ribbons with rock-wake foam & seamless lake mouth dissolve
 * - 4 batched InstancedMeshes shared across all streams (smooth mossy granite boulders,
 *   submerged pebbles, submerged twigs, fallen mossy bark logs)
 */
export function buildAllStreamVisuals(
  streams: readonly StreamBlueprint[],
  sharedUniforms: StreamShaderUniforms
): StreamVisualBuildResult {
  const meshes: THREE.Mesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  if (streams.length === 0) {
    return { meshes, geometries, materials, textures };
  }

  const bedTex = createStreambedTexture();
  const stoneTex = createGraniteStoneTexture();
  const barkTex = createMossyBarkTexture();
  textures.push(bedTex, stoneTex, barkTex);

  const bedMat = new THREE.MeshStandardMaterial({
    map: bedTex,
    vertexColors: true,
    roughness: 0.74,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  materials.push(bedMat);

  const streamWaterMat = new THREE.ShaderMaterial({
    vertexShader: STREAM_VERTEX,
    fragmentShader: STREAM_FRAGMENT,
    uniforms: sharedUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  materials.push(streamWaterMat);

  const boulders: InstanceTransform[] = [];
  const pebbles: InstanceTransform[] = [];
  const twigs: InstanceTransform[] = [];
  const logs: InstanceTransform[] = [];

  for (let sIdx = 0; sIdx < streams.length; sIdx++) {
    const stream = streams[sIdx];
    if (stream.points.length < 2) continue;

    const samples = resampleStreamCenterline(stream, sIdx);
    const wakes = populateStreamProps(sIdx, stream, samples, boulders, pebbles, twigs, logs);

    const bedGeo = buildStreambedGeometry(samples, stream);
    geometries.push(bedGeo);
    const bedMesh = new THREE.Mesh(bedGeo, bedMat);
    bedMesh.name = `${stream.name}_bed`;
    bedMesh.receiveShadow = true;
    bedMesh.castShadow = false;
    bedMesh.userData = {
      debugLayer: 'terrain',
      debugName: `${stream.name} (Streambed)`,
    };
    meshes.push(bedMesh);

    const waterGeo = buildStreamWaterGeometry(samples, wakes);
    geometries.push(waterGeo);
    const waterMesh = new THREE.Mesh(waterGeo, streamWaterMat);
    waterMesh.renderOrder = 3;
    waterMesh.name = stream.name;
    waterMesh.userData = {
      debugLayer: 'water',
      debugName: `${stream.name} (Stream, ${stream.regime})`,
      debugMeta: { kind: 'stream', regime: stream.regime, targetKind: stream.targetKind },
    };
    meshes.push(waterMesh);
  }

  // 4 batched InstancedMeshes across all streams (only 4 draw calls total!)
  const boulderGeo = createMossyStreamBoulderGeometry();
  const boulderMat = new THREE.MeshStandardMaterial({
    map: stoneTex,
    vertexColors: true,
    roughness: 0.68,
    metalness: 0.04,
  });
  const boulderBatch = buildInstancedBatch('stream_boulders', boulderGeo, boulderMat, boulders, true, true);
  if (boulderBatch) {
    boulderBatch.userData = { debugLayer: 'props', debugName: 'Stream Mossy Boulders' };
    geometries.push(boulderGeo);
    materials.push(boulderMat);
    meshes.push(boulderBatch);
  } else {
    boulderGeo.dispose();
    boulderMat.dispose();
  }

  const pebbleGeo = createSubmergedPebbleGeometry();
  const pebbleMat = new THREE.MeshStandardMaterial({
    map: stoneTex,
    roughness: 0.36,
    metalness: 0.05,
  });
  const pebbleBatch = buildInstancedBatch('stream_pebbles', pebbleGeo, pebbleMat, pebbles, false, true);
  if (pebbleBatch) {
    pebbleBatch.userData = { debugLayer: 'props', debugName: 'Submerged Stream Pebbles' };
    geometries.push(pebbleGeo);
    materials.push(pebbleMat);
    meshes.push(pebbleBatch);
  } else {
    pebbleGeo.dispose();
    pebbleMat.dispose();
  }

  const twigGeo = createStreamTwigGeometry();
  const twigMat = new THREE.MeshStandardMaterial({
    roughness: 0.76,
    metalness: 0.02,
  });
  const twigBatch = buildInstancedBatch('stream_twigs', twigGeo, twigMat, twigs, false, true);
  if (twigBatch) {
    twigBatch.userData = { debugLayer: 'props', debugName: 'Submerged Stream Twigs' };
    geometries.push(twigGeo);
    materials.push(twigMat);
    meshes.push(twigBatch);
  } else {
    twigGeo.dispose();
    twigMat.dispose();
  }

  const logGeo = createFallenMossyLogGeometry();
  const logMat = new THREE.MeshStandardMaterial({
    map: barkTex,
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.02,
  });
  const logBatch = buildInstancedBatch('stream_logs', logGeo, logMat, logs, true, true);
  if (logBatch) {
    logBatch.userData = { debugLayer: 'props', debugName: 'Fallen Mossy Stream Logs' };
    geometries.push(logGeo);
    materials.push(logMat);
    meshes.push(logBatch);
  } else {
    logGeo.dispose();
    logMat.dispose();
  }

  return { meshes, geometries, materials, textures };
}
