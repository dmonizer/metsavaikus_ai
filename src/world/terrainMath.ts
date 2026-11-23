import {
  generateWorldBlueprint,
  SwampIslandBlueprint,
  VillageBlueprint,
  WorldBlueprint,
} from './worldBlueprint';

export const WORLD_SIZE = 1200;
export const WORLD_HALF = WORLD_SIZE / 2; // 600
export const WORLD_RADIUS = 600;
export const CHUNK_SIZE = 48; // 48m per streamed chunk
export const ACTIVE_GRID = 11; // 11x11 sliding window centered on player
export const CHUNK_GRID = ACTIVE_GRID;
export const CHUNK_COUNT = ACTIVE_GRID * ACTIVE_GRID; // 121 streamed slots
export const TOTAL_CHUNK_GRID = Math.round(WORLD_SIZE / CHUNK_SIZE); // 25x25 = 625 world chunks
export const SWAMP_WATER_Y = -1.22;

let activeBlueprint: WorldBlueprint = generateWorldBlueprint(2026);

export function setActiveWorldSeed(seed: number): WorldBlueprint {
  activeBlueprint = generateWorldBlueprint(seed);
  return activeBlueprint;
}

export function setActiveBlueprint(bp: WorldBlueprint): void {
  activeBlueprint = bp;
}

export function getActiveBlueprint(): WorldBlueprint {
  return activeBlueprint;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Deterministic 32-bit integer hash returning [0, 1).
 * Matches the WebAssembly noise kernel bit-for-bit.
 */
export function hash2i(ix: number, iz: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h * 2.3283064365386963e-10;
}

export function smoothNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2i(ix, iz);
  const b = hash2i(ix + 1, iz);
  const c = hash2i(ix, iz + 1);
  const d = hash2i(ix + 1, iz + 1);
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

export function roadCenterX(z: number, bp: WorldBlueprint = activeBlueprint): number {
  return (
    Math.sin(z * 0.018 + bp.mainRoadPhase) * bp.mainRoadAmp -
    Math.max(0, z) * bp.mainRoadSlope +
    Math.sin(z * 0.0055) * 16
  );
}

export function distToRoadDetail(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): { dist: number; isTrail: boolean } {
  let minDist = Math.abs(x - roadCenterX(z, bp));
  let isTrail = false;

  const segs = bp.roadSegments;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const abx = s.bx - s.ax;
    const abz = s.bz - s.az;
    const lenSq = abx * abx + abz * abz;
    if (lenSq < 0.001) continue;
    const t = clamp(((x - s.ax) * abx + (z - s.az) * abz) / lenSq, 0, 1);
    const d = Math.hypot(x - (s.ax + t * abx), z - (s.az + t * abz));
    const effective = s.isTrail ? d * (2.6 / s.halfWidth) : d;
    if (effective < minDist) {
      minDist = effective;
      isTrail = s.isTrail;
    }
  }
  return { dist: minDist, isTrail };
}

export function distToRoad(x: number, z: number): number {
  return distToRoadDetail(x, z).dist;
}

export function getSwampFactor(
  x: number,
  z: number,
  detailNoise?: number,
  bp: WorldBlueprint = activeBlueprint
): number {
  const d = Math.hypot(x - bp.bogCenterX, z - bp.bogCenterZ);
  const wobble =
    (detailNoise !== undefined ? detailNoise : fbm(x * 0.03, z * 0.03, 2)) * 18;
  return clamp(1 - (d + wobble - (bp.bogRadius - 32)) / 36, 0, 1);
}

export function getNearestSwampIsland(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): { island: SwampIslandBlueprint | null; dist: number; islandMask: number } {
  let best: SwampIslandBlueprint | null = null;
  let bestDist = Infinity;
  let maxMask = 0;
  for (let i = 0; i < bp.swampIslands.length; i++) {
    const isl = bp.swampIslands[i];
    const d = Math.hypot(x - isl.x, z - isl.z);
    if (d < bestDist) {
      bestDist = d;
      best = isl;
    }
    const m = clamp(1 - (d - isl.radius * 0.56) / (isl.radius * 0.62), 0, 1);
    if (m > maxMask) maxMask = m;
  }
  return { island: best, dist: bestDist, islandMask: maxMask };
}

export function evaluateTerrainFromNoise(
  x: number,
  z: number,
  nBase4: number,
  nDetail2: number,
  nBog: number,
  bp: WorldBlueprint = activeBlueprint
): { y: number; swamp: number; islandMask: number } {
  const base = nBase4 * 8.2 + nDetail2 * 1.2;
  const swamp = getSwampFactor(x, z, nDetail2, bp);

  let h = base;

  // Village clearings flattened gently for log homesteads
  for (let i = 0; i < bp.villages.length; i++) {
    const v = bp.villages[i];
    const dV = Math.hypot(x - v.x, z - v.z);
    if (dV < v.clearingRadius + 24) {
      const flat = clamp(1 - (dV - v.clearingRadius * 0.72) / 22, 0, 1);
      h = lerp(h, v.flattenHeight, flat * 0.88);
    }
  }

  // Peat bog depression with organic sphagnum hummocks
  const bogPools = nBog;
  const swampH = -1.68 + bogPools * 0.92;
  h = lerp(h, swampH, swamp);

  // Elevated Swamp Islands (rabasaared) rising out of the bog
  let islandMask = 0;
  let targetIslandH = h;
  for (let i = 0; i < bp.swampIslands.length; i++) {
    const isl = bp.swampIslands[i];
    const d = Math.hypot(x - isl.x, z - isl.z);
    if (d < isl.radius * 1.25) {
      const smooth = clamp(1 - (d - isl.radius * 0.45) / (isl.radius * 0.72), 0, 1);
      const shaped = smooth * smooth * (3 - 2 * smooth);
      if (shaped > islandMask) {
        islandMask = shaped;
        targetIslandH = isl.peakHeight + nBog * 0.28;
      }
    }
  }
  if (islandMask > 0.001) {
    h = lerp(h, targetIslandH, islandMask);
  }

  // Gentle grading along main road & connecting trails
  const dRoad = distToRoadDetail(x, z, bp).dist;
  if (dRoad < 6.2) {
    const roadMix = clamp(1 - (dRoad - 2.4) / 3.8, 0, 1);
    const smoothRoadH = Math.max(-0.55, nBase4 * 5.2);
    h = lerp(h, smoothRoadH, roadMix * 0.62);
  }

  // Natural rolling perimeter hills near map edge (never bare empty walls)
  const edge = Math.hypot(x, z);
  if (edge > WORLD_RADIUS - 65) {
    h += (edge - (WORLD_RADIUS - 65)) * 0.24;
  }

  return { y: h, swamp, islandMask };
}

export function getTerrainHeight(x: number, z: number): number {
  const nBase4 = fbm(x * 0.008, z * 0.008, 4);
  const nDetail2 = fbm(x * 0.03, z * 0.03, 2);
  const nBog = smoothNoise(x * 0.09, z * 0.09);
  return evaluateTerrainFromNoise(x, z, nBase4, nDetail2, nBog).y;
}

export function getDistanceToNearestVillage(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): { village: VillageBlueprint | null; dist: number } {
  let best: VillageBlueprint | null = null;
  let minDist = Infinity;
  for (let i = 0; i < bp.villages.length; i++) {
    const v = bp.villages[i];
    const d = Math.hypot(x - v.x, z - v.z);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return { village: best, dist: minDist };
}

/**
 * Returns 0..1 thicket density factor. Values > 0.62 mark near-impenetrable woodland thickets.
 */
export function getThicketFactor(x: number, z: number): number {
  const seedShift = (activeBlueprint.seed % 97) * 0.73;
  const n1 = smoothNoise(x * 0.022 + seedShift, z * 0.022 - seedShift);
  const n2 = smoothNoise(x * 0.065 - seedShift * 0.5, z * 0.065 + 11.3);
  return clamp(n1 * 0.72 + n2 * 0.28, 0, 1);
}

export interface BiomeInfo {
  id: 'village' | 'abandoned' | 'island' | 'swamp' | 'road' | 'thicket' | 'forest';
  label: string;
}

export function getBiomeInfo(x: number, z: number): BiomeInfo {
  const { village, dist } = getDistanceToNearestVillage(x, z);
  if (village && dist < village.clearingRadius + 10) {
    return {
      id: village.abandoned ? 'abandoned' : 'village',
      label: village.estonianLabel,
    };
  }

  const islCheck = getNearestSwampIsland(x, z);
  if (islCheck.island && islCheck.islandMask > 0.42) {
    return {
      id: 'island',
      label: islCheck.island.name,
    };
  }

  if (getSwampFactor(x, z) > 0.42) {
    return { id: 'swamp', label: 'Kõrgesoo raba (Peat Bog)' };
  }

  const roadInfo = distToRoadDetail(x, z);
  if (roadInfo.dist < 3.4) {
    return {
      id: 'road',
      label: roadInfo.isTrail
        ? 'Metsarada (Woodland Trail)'
        : 'Kruusatee (Gravel Country Road)',
    };
  }

  if (getThicketFactor(x, z) > 0.68) {
    return { id: 'thicket', label: 'Põlistihnik (Dense Forest Thicket)' };
  }

  return { id: 'forest', label: 'Eesti mets (Birch & Pine Forest)' };
}

export function worldToVirtualChunk(x: number, z: number): { vcx: number; vcz: number } {
  return {
    vcx: Math.floor(x / CHUNK_SIZE),
    vcz: Math.floor(z / CHUNK_SIZE),
  };
}

export function worldToChunkIndex(x: number, z: number): number {
  const gx = clamp(Math.floor((x + WORLD_HALF) / CHUNK_SIZE), 0, TOTAL_CHUNK_GRID - 1);
  const gz = clamp(Math.floor((z + WORLD_HALF) / CHUNK_SIZE), 0, TOTAL_CHUNK_GRID - 1);
  return gz * TOTAL_CHUNK_GRID + gx;
}

export function chunkIndexToBounds(idx: number): {
  gx: number;
  gz: number;
  minX: number;
  minZ: number;
  centerX: number;
  centerZ: number;
} {
  const gz = Math.floor(idx / TOTAL_CHUNK_GRID);
  const gx = idx % TOTAL_CHUNK_GRID;
  const minX = -WORLD_HALF + gx * CHUNK_SIZE;
  const minZ = -WORLD_HALF + gz * CHUNK_SIZE;
  return {
    gx,
    gz,
    minX,
    minZ,
    centerX: minX + CHUNK_SIZE * 0.5,
    centerZ: minZ + CHUNK_SIZE * 0.5,
  };
}
