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

function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

function wrapCoord(v: number, tileSize: number): number {
  let out = v % tileSize;
  if (out < 0) out += tileSize;
  return out >= tileSize ? 0 : out;
}

/** Scratch owned by a synchronous sampler. All coordinates retain JS double precision. */
export function createTileSampleBuffer(count: number) {
  const haltonX = new Float64Array(count);
  const haltonZ = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    haltonX[i] = halton(i + 1, 2);
    haltonZ[i] = halton(i + 1, 3);
  }
  return {
    lx: new Float64Array(count), lz: new Float64Array(count),
    r1: new Float64Array(count), r2: new Float64Array(count),
    r3: new Float64Array(count), r4: new Float64Array(count),
    haltonX, haltonZ,
  };
}

/**
 * Generates organic, isotropic, line-free 2D coordinates inside [0, tileSize)^2.
 * Uses a Cranley-Patterson shifted Halton(2, 3) sequence (eliminating rank-1 lattice
 * diagonal lines present in R2 sequences), perturbed by independent isotropic polar
 * disk jitter and smooth periodic 2D curl-like domain warping.
 * Returned random values (r1..r4) use independent hash streams uncorrelated with jitter.
 */
export function fillTileSamples(
  tileX: number,
  tileZ: number,
  worldSeed: number,
  tileSize: number,
  salt: number,
  buffer: ReturnType<typeof createTileSampleBuffer>,
  sampleCount = buffer.haltonX.length
): void {
  const { haltonX, haltonZ } = buffer;
  const baseSeed = hashUint(
    Math.imul(tileX, 73856093) ^
      Math.imul(tileZ, 19349663) ^
      Math.imul(worldSeed | 0, 83492791) ^
      Math.imul(salt | 0, 2654435761)
  );
  const shiftSeed = hashUint(baseSeed ^ 0x517cc1b7);
  const startOffsetX = (shiftSeed & 0xffff) / 65536;
  const startOffsetZ = ((shiftSeed >>> 16) & 0xffff) / 65536;

  const warpSeed = hashUint(baseSeed ^ 0x2c1b3c6d);
  const phaseX = ((warpSeed & 0xffff) / 65536) * Math.PI * 2;
  const phaseZ = (((warpSeed >>> 16) & 0xffff) / 65536) * Math.PI * 2;

  const cellSpacing = tileSize / Math.sqrt(sampleCount);
  const jitterRadius = cellSpacing * 0.72;
  const warpAmp = cellSpacing * 0.34;
  const tau = Math.PI * 2;

  for (let i = 0; i < sampleCount; i++) {
    // Independent hash streams for spatial jitter vs. returned botanical variation (r1..r4)
    const hJitter = hashUint(baseSeed ^ Math.imul(i + 1, 1597334677));
    const hA = hashUint(baseSeed ^ Math.imul(i + 1, 374761393));
    const hB = hashUint(baseSeed ^ Math.imul(i + 1, 668265263));

    const jAng = ((hJitter & 0xffff) / 65536) * tau;
    const jRad = Math.sqrt(((hJitter >>> 16) & 0xffff) / 65535) * jitterRadius;

    const r1 = (hA & 0xffff) / 65535;
    const r2 = ((hA >>> 16) & 0xffff) / 65535;
    const r3 = (hB & 0xffff) / 65535;
    const r4 = ((hB >>> 16) & 0xffff) / 65535;

    const u = (startOffsetX + haltonX[i]) % 1;
    const v = (startOffsetZ + haltonZ[i]) % 1;

    // Gentle divergence-free periodic warp breaks any residual linear alignment
    const warpX = Math.sin(v * tau + phaseX) * warpAmp;
    const warpZ = Math.cos(u * tau + phaseZ) * warpAmp;

    const lx = wrapCoord(u * tileSize + Math.cos(jAng) * jRad + warpX, tileSize);
    const lz = wrapCoord(v * tileSize + Math.sin(jAng) * jRad + warpZ, tileSize);

    buffer.lx[i] = lx;
    buffer.lz[i] = lz;
    buffer.r1[i] = r1;
    buffer.r2[i] = r2;
    buffer.r3[i] = r3;
    buffer.r4[i] = r4;
  }
}

export function generateR2TileSamples(
  tileX: number, tileZ: number, worldSeed: number, tileSize: number, sampleCount: number, salt = 0
): TileSamplePoint[] {
  if (sampleCount <= 0 || tileSize <= 0) return [];
  const buffer = createTileSampleBuffer(Math.ceil(sampleCount));
  fillTileSamples(tileX, tileZ, worldSeed, tileSize, salt, buffer, sampleCount);
  return Array.from({ length: buffer.lx.length }, (_, i) => ({
    lx: buffer.lx[i], lz: buffer.lz[i], r1: buffer.r1[i],
    r2: buffer.r2[i], r3: buffer.r3[i], r4: buffer.r4[i],
  }));
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

/**
 * Softer road/trail verge feathering for short ground-hugging filler grass & creeping moss
 * so shoulders transition organically from gravel into mossy short turf before taller grass begins.
 */
export function computeRoadVergeFillerCoverage(
  distToRoad: number,
  isTrail: boolean,
  edgeJitterSigned: number,
  randRoll: number
): RoadVergeResult {
  const inner = (isTrail ? 0.92 : 1.62) + edgeJitterSigned * 0.48;
  const outer = (isTrail ? 2.15 : 3.35) + edgeJitterSigned * 0.58;
  if (distToRoad < inner) {
    return { keep: false, heightScale: 0 };
  }
  if (distToRoad >= outer) {
    return { keep: true, heightScale: 1 };
  }
  const t = (distToRoad - inner) / Math.max(0.1, outer - inner);
  const smooth = t * t * (3 - 2 * t);
  const prob = 0.18 + smooth * 0.82;
  if (randRoll > prob) {
    return { keep: false, heightScale: 0 };
  }
  return {
    keep: true,
    heightScale: 0.38 + smooth * 0.62,
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
 * Controls lush 3D moss carpet placement filling spaces between grass clumps:
 * - Deep forest floor: dense continuous moss drifts (~75% coverage)
 * - Bog rims & damp hollows: rich sphagnum moss cushions (~80%)
 * - Open meadows & clearings: natural mossy ground patches nestled between grass tufts (~44%)
 */
export function shouldKeepMossCarpet(
  openness: number,
  mossNoise: number,
  swampFactor: number,
  r1: number,
  r4: number
): boolean {
  if (swampFactor > 0.28) {
    return mossNoise > 0.24 || r4 > 0.22;
  }
  const effectiveOpenness = clamp01(openness);
  const forestKeep = mossNoise > 0.28 || r4 > 0.34;
  const openKeep = mossNoise > 0.48 || (mossNoise > 0.34 && r1 < 0.58) || r4 > 0.76;
  if (effectiveOpenness <= 0.2) return forestKeep;
  if (effectiveOpenness >= 0.78) return openKeep;
  const t = (effectiveOpenness - 0.2) / 0.58;
  return r1 < 1 - t ? forestKeep : openKeep;
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

/**
 * Computes broad, ground-hugging scale for dense short filler grass & clover rosettes
 * that knit the open spaces between taller grass tufts and moss cushions.
 */
export function computeShortGrassScale(
  swampFactor: number,
  patchNoise: number,
  r1: number,
  r2: number,
  r3: number,
  vergeHeightScale: number,
  openness = 1
): { sxz: number; sy: number } {
  const isSwamp = swampFactor > 0.35;
  const effectiveOpenness = clamp01(openness);
  const baseSy = isSwamp
    ? 0.65 + r3 * 0.55
    : 0.52 + Math.pow(r3, 1.1) * 0.62 + patchNoise * 0.16;
  const heightMult = isSwamp ? 1 : lerpNum(0.72, 1.0, effectiveOpenness);
  const sy = Math.max(0.32, baseSy * heightMult * vergeHeightScale);
  const sxz = (0.95 + r2 * 0.58 + r1 * 0.14) * (0.82 + vergeHeightScale * 0.18);
  return { sxz, sy };
}

/**
 * Computes organic pillow dimensions for low 3D moss cushions carpeting between grass tufts.
 */
export function computeMossCarpetScale(
  swampFactor: number,
  mossNoise: number,
  r1: number,
  r2: number,
  r3: number,
  vergeHeightScale: number,
  openness = 1
): { sxz: number; sy: number } {
  const effectiveOpenness = clamp01(openness);
  const lushBoost = swampFactor > 0.3 ? 1.16 : lerpNum(1.14, 0.88, effectiveOpenness);
  const sxz = (0.76 + r2 * 0.78 + mossNoise * 0.22) * lushBoost * (0.74 + vergeHeightScale * 0.26);
  const sy = Math.max(
    0.45,
    (0.58 + r3 * 0.68 + r1 * 0.16) * (swampFactor > 0.3 ? 1.15 : lerpNum(1.08, 0.82, effectiveOpenness)) * vergeHeightScale
  );
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
