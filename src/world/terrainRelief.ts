export const WORLD_SIZE = 1200;
export const WORLD_HALF = WORLD_SIZE / 2;
export const SWAMP_WATER_Y = -1.2;
export const MIN_BOG_ISLAND_HUT_RADIUS = 26;

export interface BogLobeBlueprint {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  cosRot: number;
  sinRot: number;
  wobblePhase: number;
  wobbleAmp: number;
}

export interface BogPoolBlueprint {
  id: string;
  systemId: number;
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  cosRot: number;
  sinRot: number;
  wobblePhase1: number;
  wobblePhase2: number;
  wobbleAmp: number;
  maxDepth: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WorldBounds2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface HillMassifBlueprint {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  cosRot: number;
  sinRot: number;
  /** Peak elevation contribution in meters above base land (~8..35m). */
  height: number;
  /** Profile exponent (1.15..1.75); higher = narrower crown, gentle foot. */
  exponent: number;
  /** Bounding radius squared for O(1) rejection. */
  maxRSq: number;
}

export function hash2D(ix: number, iz: number): number {
  let h = (Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ (0x5bd1e995 | 0)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) * 2.3283064365386963e-10;
}

export function smoothNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x: number, z: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * (smoothNoise(x * freq, z * freq) * 2 - 1);
    freq *= 2.02;
    amp *= 0.5;
  }
  return val;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates the organic multi-lobe peat bog mask in [0, 1] at world (x, z).
 * 0 = dry land outside bog; >0.45 = inside the bog plain.
 * Includes a tight AABB early-out so non-bog points return 0 in nanoseconds.
 */
export function evaluateRawBogMask(
  x: number,
  z: number,
  lobes: readonly BogLobeBlueprint[],
  bounds: WorldBounds2D
): number {
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
    return 0;
  }

  let best = 0;
  for (let i = 0; i < lobes.length; i++) {
    const lobe = lobes[i];
    const dx = x - lobe.x;
    const dz = z - lobe.z;
    const lx = dx * lobe.cosRot + dz * lobe.sinRot;
    const lz = -dx * lobe.sinRot + dz * lobe.cosRot;
    const nx = lx / lobe.rx;
    const nz = lz / lobe.rz;
    const rSq = nx * nx + nz * nz;
    if (rSq > 1.75) continue;
    // Fast-path deep interior: guaranteed normDist < 0.74 without trig
    if (rSq < 0.34) return 1;

    const r = Math.sqrt(rSq);
    const ang = Math.atan2(nz, nx);
    const wobble =
      1 +
      Math.sin(ang * 3 + lobe.wobblePhase) * lobe.wobbleAmp +
      Math.cos(ang * 5 - lobe.wobblePhase * 1.4) * (lobe.wobbleAmp * 0.45);
    const normDist = r / wobble;
    if (normDist < 1.18) {
      const m = 1 - smoothstep(0.74, 1.16, normDist);
      if (m > best) {
        best = m;
        if (best >= 0.999) return 1;
      }
    }
  }
  return best;
}

/**
 * Evaluates the localized bog lake pool (laugastik) depth factor in [0, 1].
 * 0 = flat sphagnum peat plain; 1 = deep open-water bog pool interior.
 */
export function evaluateBogPoolMask(
  x: number,
  z: number,
  pools: readonly BogPoolBlueprint[]
): { mask: number; maxDepth: number } {
  let bestMask = 0;
  let bestDepth = 0;
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i];
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    const dx = x - p.x;
    const dz = z - p.z;
    const lx = dx * p.cosRot + dz * p.sinRot;
    const lz = -dx * p.sinRot + dz * p.cosRot;
    const nx = lx / p.rx;
    const nz = lz / p.rz;
    const rSq = nx * nx + nz * nz;
    if (rSq > 1.65) continue;

    const r = Math.sqrt(rSq);
    const ang = Math.atan2(nz, nx);
    const wobble =
      1 +
      Math.sin(ang * 2 + p.wobblePhase1) * p.wobbleAmp +
      Math.cos(ang * 3 + p.wobblePhase2) * (p.wobbleAmp * 0.65) +
      Math.sin(ang * 5 - p.wobblePhase1) * (p.wobbleAmp * 0.28);
    const normDist = r / wobble;
    if (normDist < 1.14) {
      const m = 1 - smoothstep(0.68, 1.12, normDist);
      if (m > bestMask) {
        bestMask = m;
        bestDepth = p.maxDepth;
      }
    }
  }
  return { mask: bestMask, maxDepth: bestDepth };
}

/**
 * Evaluates smooth Estonian moraine hill relief (kuppelmaastik) in meters.
 * Returns 0 inside the peat bog so the bog remains genuinely flat.
 */
export function evaluateHillRelief(
  x: number,
  z: number,
  hills: readonly HillMassifBlueprint[],
  rawBogMask: number
): number {
  const bogDamp = 1 - smoothstep(0.0, 0.58, rawBogMask);
  if (bogDamp <= 0.001) return 0;

  let h = 0;
  for (let i = 0; i < hills.length; i++) {
    const hill = hills[i];
    const dx = x - hill.x;
    const dz = z - hill.z;
    if (dx * dx + dz * dz >= hill.maxRSq) continue;

    const lx = dx * hill.cosRot + dz * hill.sinRot;
    const lz = -dx * hill.sinRot + dz * hill.cosRot;
    const uSq = (lx / hill.rx) ** 2 + (lz / hill.rz) ** 2;
    if (uSq >= 1) continue;

    // Smooth C2 polynomial drumlin bell (zero slope at summit and perimeter, zero trig/sqrt)
    const oneMinus = 1 - uSq;
    const bell = oneMinus * oneMinus;
    h += hill.height * (hill.exponent === 1 ? bell : Math.pow(bell, hill.exponent * 0.65));
  }
  return h * bogDamp;
}

/**
 * Evaluates dry-land macro + detail height (including Estonian hills and perimeter ridge)
 * prior to bog blending, lakes, streams, and building pad flattening.
 * Shared identically by blueprint generation, JS terrain evaluation, and WASM chunk fill.
 */
export function evaluateBaseDryLandFromNoise(
  x: number,
  z: number,
  nBase4: number,
  nDetail2: number,
  hills: readonly HillMassifBlueprint[],
  rawBogMask: number
): number {
  // Base rolling forest floor sits comfortably above SWAMP_WATER_Y (-1.2)
  // Note: nBase4 and nDetail2 are signed WASM-matching FBM channels centered around 0.
  let h = 1.65 + nBase4 * 3.4 + nDetail2 * 0.85;
  h += evaluateHillRelief(x, z, hills, rawBogMask);

  // Ensure dry non-bog land stays cleanly above SWAMP_WATER_Y unless carved by a lake or stream
  if (rawBogMask < 0.02 && h < SWAMP_WATER_Y + 0.85) {
    const deficit = SWAMP_WATER_Y + 0.85 - h;
    h = SWAMP_WATER_Y + 0.85 - deficit * 0.14;
    if (h < SWAMP_WATER_Y + 0.52) h = SWAMP_WATER_Y + 0.52;
  }

  // Gentle perimeter framing hills around the world boundary (damped inside the bog so bog stays flat)
  const edgeDist = Math.max(Math.abs(x), Math.abs(z));
  if (edgeDist > WORLD_HALF - 70) {
    const edgeT = (edgeDist - (WORLD_HALF - 70)) / 70;
    const bogEdgeDamp = 1 - smoothstep(0.15, 0.7, rawBogMask) * 0.72;
    h += edgeT * edgeT * 11.5 * bogEdgeDamp;
  }

  return h;
}
