export interface TileSamplePoint {
  lx: number;
  lz: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
}

export interface RoadVergeResult {
  keep: boolean;
  heightScale: number;
}

function hashUint(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Generates organic, non-grid 2D coordinates inside [0, tileSize)^2 using a
 * tile-seeded 2D R2 quasi-random sequence perturbed by independent per-point jitter.
 * Eliminates axis-aligned rows/lines caused by grid-cell iteration.
 */
export function generateR2TileSamples(
  tileX: number,
  tileZ: number,
  worldSeed: number,
  tileSize: number,
  sampleCount: number,
  salt = 0
): TileSamplePoint[] {
  const out: TileSamplePoint[] = [];
  if (sampleCount <= 0 || tileSize <= 0) return out;

  const baseSeed =
    hashUint(Math.imul(tileX, 73856093) ^ Math.imul(tileZ, 19349663) ^ Math.imul(worldSeed | 0, 83492791) ^ salt);
  const startOffsetX = ((baseSeed & 0xffff) / 65536);
  const startOffsetZ = (((baseSeed >>> 16) & 0xffff) / 65536);

  // R2 golden-ratio 2D low-discrepancy constants (Roberts 2018)
  const g1 = 0.7548776662466927;
  const g2 = 0.5698402909980532;
  const jitterSpan = (tileSize / Math.sqrt(sampleCount)) * 0.78;

  for (let i = 0; i < sampleCount; i++) {
    const hA = hashUint(baseSeed ^ Math.imul(i + 1, 374761393));
    const hB = hashUint(baseSeed ^ Math.imul(i + 1, 668265263));
    const r1 = (hA & 0xffff) / 65535;
    const r2 = ((hA >>> 16) & 0xffff) / 65535;
    const r3 = (hB & 0xffff) / 65535;
    const r4 = ((hB >>> 16) & 0xffff) / 65535;

    const u = (startOffsetX + (i + 1) * g1) % 1;
    const v = (startOffsetZ + (i + 1) * g2) % 1;

    let lx = u * tileSize + (r1 - 0.5) * jitterSpan;
    let lz = v * tileSize + (r2 - 0.5) * jitterSpan;
    if (lx < 0) lx += tileSize;
    else if (lx >= tileSize) lx -= tileSize;
    if (lz < 0) lz += tileSize;
    else if (lz >= tileSize) lz -= tileSize;

    out.push({ lx, lz, r1, r2, r3, r4 });
  }
  return out;
}

/**
 * Deterministic Fisher-Yates permutation so outer grass rings can take any
 * contiguous prefix `0..Math.floor(n / step)` without introducing row/column stripes.
 */
export function buildDeterministicShuffle(count: number, seed: number): Uint32Array {
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  let s = (seed | 0) ^ 0x9e3779b9;
  for (let i = count - 1; i > 0; i--) {
    s = hashUint(s + i);
    const j = s % (i + 1);
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order;
}

/**
 * Computes organic feathered grass & undergrowth acceptance along road/trail verges
 * instead of a sharp razor-straight cutoff line.
 */
export function computeRoadVergeCoverage(
  distToRoad: number,
  isTrail: boolean,
  edgeJitterSigned: number,
  randRoll: number,
  tallLayer = false
): RoadVergeResult {
  const inner = (isTrail ? 1.2 : 1.95) + edgeJitterSigned * 0.42;
  const outer = (isTrail ? 2.25 : 3.55) + edgeJitterSigned * 0.52;
  if (distToRoad < inner) {
    return { keep: false, heightScale: 0 };
  }
  if (distToRoad >= outer) {
    return { keep: true, heightScale: 1 };
  }
  const t = (distToRoad - inner) / Math.max(0.1, outer - inner);
  const smooth = t * t * (3 - 2 * t);
  const prob = tallLayer ? smooth * 0.62 : 0.14 + smooth * 0.86;
  if (randRoll > prob) {
    return { keep: false, heightScale: 0 };
  }
  return {
    keep: true,
    heightScale: tallLayer ? 0.55 + smooth * 0.45 : 0.44 + smooth * 0.56,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * Computes 0..1 canopy openness factor:
 * - 1.0 in open village/homestead clearings, sunlit gravel roadside verges, and open bogs
 * - 0.0 under closed forest canopy (with small smooth transitions at forest edges/glades)
 */
export function computeOpennessFactor(
  villageDist: number,
  villageClearingRadius: number,
  roadDist: number,
  isTrail: boolean,
  swampFactor: number,
  islandMask: number,
  gladeNoise = 0
): number {
  let openness = 0;

  if (villageClearingRadius > 0 && villageDist < villageClearingRadius * 1.18) {
    const t = 1 - (villageDist - villageClearingRadius * 0.72) / Math.max(1, villageClearingRadius * 0.46);
    openness = Math.max(openness, smoothstep01(t));
  }

  if (isTrail) {
    if (roadDist < 5.2) {
      const t = 1 - (roadDist - 2.6) / 2.6;
      openness = Math.max(openness, smoothstep01(t) * 0.72);
    }
  } else if (roadDist < 10.2) {
    const t = 1 - (roadDist - 5.6) / 4.6;
    openness = Math.max(openness, smoothstep01(t));
  }

  if (swampFactor > 0.25) {
    openness = Math.max(openness, smoothstep01((swampFactor - 0.25) / 0.35));
  }

  if (islandMask > 0.48) {
    openness = Math.max(openness, smoothstep01((islandMask - 0.48) / 0.35) * 0.55);
  }

  if (gladeNoise > 0.78) {
    openness = Math.max(openness, smoothstep01((gladeNoise - 0.78) / 0.16) * 0.75);
  }

  return clamp01(openness);
}

/**
 * Controls tall undergrowth placement density: full lush patches in open meadows/clearings,
 * thinned to scattered wild long tufts inside closed forest.
 */
export function shouldKeepTallUndergrowth(
  openness: number,
  driftNoise: number,
  r1: number,
  r4: number
): boolean {
  const openKeep = driftNoise >= 0.45 || r1 <= 0.14;
  if (openness >= 0.65) return openKeep;
  const forestKeep = (driftNoise > 0.66 && r4 > 0.55) || r4 > 0.87;
  if (openness <= 0.18) return forestKeep;
  const blend = (openness - 0.18) / 0.47;
  return forestKeep || (openKeep && r1 < blend * 0.75);
}

/**
 * Computes natural randomized width & height scales for covering ground grass:
 * - Open areas (openness=1): full tall meadow height
 * - Forest (openness=0): ~half shorter floor carpet with ~15% scattered long tufts
 */
export function computeGrassClumpScale(
  swampFactor: number,
  patchNoise: number,
  r1: number,
  r2: number,
  r3: number,
  vergeHeightScale: number,
  openness = 1
): { sxz: number; sy: number } {
  const isSwamp = swampFactor > 0.35;
  const tuftMix = Math.pow(r3, 1.35);
  const baseH = isSwamp
    ? 0.62 + tuftMix * 0.86
    : 0.64 + tuftMix * 1.12 + patchNoise * 0.24;

  const isForestLongTuft = r3 >= 0.86 || (patchNoise > 0.74 && r1 > 0.68);
  const forestHeightMult = isForestLongTuft ? 0.88 + r1 * 0.22 : 0.47 + r1 * 0.08;
  const effectiveOpenness = clamp01(openness);
  const heightMult = isSwamp ? 1 : lerpNum(forestHeightMult, 1, effectiveOpenness);
  const minSy = isSwamp ? 0.36 : lerpNum(0.2, 0.36, effectiveOpenness);

  const sy = Math.max(minSy, baseH * heightMult * vergeHeightScale);
  const widthFactor = isSwamp ? 1 : lerpNum(isForestLongTuft ? 1.04 : 0.92, 1, effectiveOpenness);
  const sxz = (1.02 + r2 * 0.68) * widthFactor * (0.78 + vergeHeightScale * 0.22);
  return { sxz, sy };
}

export function computeTallUndergrowthScale(
  patchNoise: number,
  r1: number,
  r2: number,
  r3: number,
  vergeHeightScale: number,
  openness = 1
): { sxz: number; sy: number } {
  const effectiveOpenness = clamp01(openness);
  const baseSy = 0.72 + Math.pow(r3, 0.9) * 0.9 + patchNoise * 0.22;
  const forestTuftMult = 0.76 + r3 * 0.24;
  const heightMult = lerpNum(forestTuftMult, 1, effectiveOpenness);
  const sy = Math.max(0.45, baseSy * heightMult * vergeHeightScale);
  const sxz = (0.84 + r2 * 0.62 + r1 * 0.14) * lerpNum(0.88, 1, effectiveOpenness);
  return { sxz, sy };
}
