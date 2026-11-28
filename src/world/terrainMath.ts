import {
  BuildingPadBlueprint,
  createWorldBlueprint,
  evalMainRoadX,
  LakeBlueprint,
  StreamBlueprint,
  SwampIslandBlueprint,
  UniformSpatialGrid,
  VillageBlueprint,
  WorldBlueprint,
} from './worldBlueprint';
import {
  clamp01,
  evaluateBaseDryLandFromNoise,
  evaluateBogPoolMask,
  evaluateRawBogMask,
  fbm,
  hash2D,
  MIN_BOG_ISLAND_HUT_RADIUS,
  smoothNoise,
  smoothstep,
  SWAMP_WATER_Y,
  WORLD_HALF,
  WORLD_SIZE,
} from './terrainRelief';

export {
  clamp01,
  fbm,
  hash2D,
  MIN_BOG_ISLAND_HUT_RADIUS,
  smoothNoise,
  smoothstep,
  SWAMP_WATER_Y,
  WORLD_HALF,
  WORLD_SIZE,
};

export const hash2i = hash2D;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const CHUNK_SIZE = 48;
export const ACTIVE_GRID = 11;
export const CHUNK_COUNT = ACTIVE_GRID * ACTIVE_GRID;
export const TOTAL_CHUNK_GRID = Math.ceil(WORLD_SIZE / CHUNK_SIZE);

export function worldToVirtualChunk(x: number, z: number): { vcx: number; vcz: number } {
  return {
    vcx: Math.floor(x / CHUNK_SIZE),
    vcz: Math.floor(z / CHUNK_SIZE),
  };
}

export const DEFAULT_WORLD_SEED = 2026;

let activeBlueprint: WorldBlueprint = createWorldBlueprint(DEFAULT_WORLD_SEED);

export function setActiveWorldSeed(seed: number): WorldBlueprint {
  activeBlueprint = createWorldBlueprint(seed);
  return activeBlueprint;
}

export function getActiveBlueprint(): WorldBlueprint {
  return activeBlueprint;
}

export function roadCenterX(z: number, bp: WorldBlueprint = activeBlueprint): number {
  return evalMainRoadX(z, bp);
}

function pointToSegmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

function getGridCell(grid: UniformSpatialGrid, x: number, z: number): Int32Array | null {
  const col = Math.floor((x - grid.originX) / grid.cellSize);
  const row = Math.floor((z - grid.originZ) / grid.cellSize);
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return null;
  return grid.cells[row * grid.cols + col];
}

export interface RoadDistanceInfo {
  dist: number;
  isTrail: boolean;
}

/**
 * O(1) spatial-grid accelerated road & trail distance query.
 * Exact within ~18m of trails and ~24m of gravel roads; returns { dist: 999, isTrail: false } elsewhere.
 */
export function distToRoadDetail(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): RoadDistanceInfo {
  const cell = getGridCell(bp.roadGrid, x, z);
  if (!cell || cell.length === 0) {
    return { dist: 999, isTrail: false };
  }

  let minMain = 999;
  let minTrail = 999;
  const segs = bp.roadSegments;

  for (let i = 0; i < cell.length; i++) {
    const seg = segs[cell[i]];
    if (seg.isTrail) {
      if (
        x < seg.minX - minTrail ||
        x > seg.maxX + minTrail ||
        z < seg.minZ - minTrail ||
        z > seg.maxZ + minTrail
      ) {
        continue;
      }
      const d = pointToSegmentDistance(x, z, seg.ax, seg.az, seg.bx, seg.bz);
      if (d < minTrail) minTrail = d;
    } else {
      if (
        x < seg.minX - minMain ||
        x > seg.maxX + minMain ||
        z < seg.minZ - minMain ||
        z > seg.maxZ + minMain
      ) {
        continue;
      }
      const d = pointToSegmentDistance(x, z, seg.ax, seg.az, seg.bx, seg.bz);
      if (d < minMain) minMain = d;
    }
  }

  if (minMain <= minTrail + 0.5) {
    return { dist: minMain, isTrail: false };
  }
  return { dist: minTrail, isTrail: true };
}

export function distToRoad(x: number, z: number, bp: WorldBlueprint = activeBlueprint): number {
  return distToRoadDetail(x, z, bp).dist;
}

/**
 * Raw bog basin mask in [0, 1] across the entire multi-lobe peat bog
 * (does NOT subtract bog islands — use for stone exclusion & basin checks).
 */
export function getRawBogMask(x: number, z: number, bp: WorldBlueprint = activeBlueprint): number {
  return evaluateRawBogMask(x, z, bp.bogLobes, bp.bogBounds);
}

/**
 * True anywhere inside the peat bog basin (including bog floor, bog pools, and bog islands).
 */
export function isInBogBasin(x: number, z: number, bp: WorldBlueprint = activeBlueprint): boolean {
  return evaluateRawBogMask(x, z, bp.bogLobes, bp.bogBounds) > 0.02;
}

export function getNearestSwampIsland(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): { island: SwampIslandBlueprint | null; dist: number; islandMask: number } {
  const bounds = bp.bogBounds;
  if (x < bounds.minX - 60 || x > bounds.maxX + 60 || z < bounds.minZ - 60 || z > bounds.maxZ + 60) {
    return { island: null, dist: 999, islandMask: 0 };
  }

  let best: SwampIslandBlueprint | null = null;
  let bestDist = 999;
  let bestMask = 0;

  for (let i = 0; i < bp.swampIslands.length; i++) {
    const isl = bp.swampIslands[i];
    const dx = x - isl.x;
    const dz = z - isl.z;
    const maxCheck = isl.radius * 1.45;
    const dSq = dx * dx + dz * dz;
    if (dSq > maxCheck * maxCheck && best !== null && dSq > bestDist * bestDist) continue;

    const d = Math.sqrt(dSq);
    if (d < bestDist) {
      bestDist = d;
      best = isl;
    }
    if (d < maxCheck) {
      const ang = Math.atan2(dz, dx);
      const rWobble = isl.radius * (1 + 0.14 * Math.sin(ang * 3 + i * 1.9));
      const m = 1 - smoothstep(rWobble * 0.52, rWobble * 1.15, d);
      if (m > bestMask) {
        bestMask = m;
        best = isl;
        bestDist = d;
      }
    }
  }
  return { island: best, dist: bestDist, islandMask: bestMask };
}

/**
 * Peat bog factor in [0, 1]. Returns 0 on dry land and suppresses cleanly on bog islands.
 */
export function getSwampFactor(x: number, z: number, bp: WorldBlueprint = activeBlueprint): number {
  const raw = evaluateRawBogMask(x, z, bp.bogLobes, bp.bogBounds);
  if (raw <= 0.001) return 0;
  const isl = getNearestSwampIsland(x, z, bp);
  return raw * (1 - isl.islandMask * 0.96);
}

export interface LakeSample {
  lake: LakeBlueprint;
  /** < 1.0 inside lake shoreline, 1.0..1.52 in outer shore containment rim. */
  normDist: number;
}

export function getLakeSampleAt(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): LakeSample | null {
  for (let i = 0; i < bp.lakes.length; i++) {
    const lk = bp.lakes[i];
    if (x < lk.minX || x > lk.maxX || z < lk.minZ || z > lk.maxZ) continue;
    const dx = x - lk.x;
    const dz = z - lk.z;
    const lx = dx * lk.cosRot + dz * lk.sinRot;
    const lz = -dx * lk.sinRot + dz * lk.cosRot;
    const nx = lx / lk.rx;
    const nz = lz / lk.rz;
    const r = Math.hypot(nx, nz);
    if (r > 1.75) continue;
    const ang = Math.atan2(nz, nx);
    const wobble =
      1 +
      Math.sin(ang * 2 + lk.wobblePhase1) * lk.wobbleAmp +
      Math.cos(ang * 3 + lk.wobblePhase2) * (lk.wobbleAmp * 0.6);
    const normDist = r / wobble;
    if (normDist < 1.56) {
      return { lake: lk, normDist };
    }
  }
  return null;
}

export interface StreamSample {
  stream: StreamBlueprint;
  dist: number;
  waterY: number;
  halfWidth: number;
  depth: number;
  slope: number;
  flowX: number;
  flowZ: number;
  /** Parameter t in [0, 1] along the stream from spring (0) to mouth (1). */
  progress: number;
}

export function getStreamSampleAt(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): StreamSample | null {
  let best: StreamSample | null = null;
  let bestMargin = Infinity;

  for (let sIdx = 0; sIdx < bp.streams.length; sIdx++) {
    const st = bp.streams[sIdx];
    if (x < st.minX || x > st.maxX || z < st.minZ || z > st.maxZ) continue;
    const pts = st.points;
    const segCount = pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      const t = lenSq > 1e-6 ? clamp01(((x - a.x) * dx + (z - a.z) * dz) / lenSq) : 0;
      const cx = a.x + dx * t;
      const cz = a.z + dz * t;
      const dist = Math.hypot(x - cx, z - cz);
      const halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * t;
      const margin = dist - halfWidth;
      if (margin < 4.5 && margin < bestMargin) {
        bestMargin = margin;
        const depth = a.depth + (b.depth - a.depth) * t;
        const waterY = a.waterY + (b.waterY - a.waterY) * t;
        const slope = a.slope + (b.slope - a.slope) * t;
        let fx = a.flowX + (b.flowX - a.flowX) * t;
        let fz = a.flowZ + (b.flowZ - a.flowZ) * t;
        const fl = Math.hypot(fx, fz) || 1;
        fx /= fl;
        fz /= fl;
        best = {
          stream: st,
          dist,
          waterY,
          halfWidth,
          depth,
          slope,
          flowX: fx,
          flowZ: fz,
          progress: (i + t) / Math.max(1, segCount),
        };
      }
    }
  }
  return best;
}

/**
 * Authoritative rule: stones and boulders NEVER appear in the peat bog (including bog islands & margins)
 * or underwater inside lakes and streams — stones belong exclusively to forest / dry land.
 * (Dedicated mossy stream rocks & pebbles are placed separately along stream channels.)
 */
export function canPlaceStoneAt(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): boolean {
  if (evaluateRawBogMask(x, z, bp.bogLobes, bp.bogBounds) > 0.015) return false;
  const lk = getLakeSampleAt(x, z, bp);
  if (lk && lk.normDist < 1.08) return false;
  const st = getStreamSampleAt(x, z, bp);
  if (st && st.dist < st.halfWidth + 0.95) return false;
  return true;
}

/**
 * O(1) lookup for the closest building clearing pad (village house, abandoned forest hut,
 * or future major structure) within influence radius.
 */
export function getNearestBuildingPad(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): { pad: BuildingPadBlueprint | null; dist: number } {
  const cell = getGridCell(bp.buildingPadGrid, x, z);
  if (!cell || cell.length === 0) {
    return { pad: null, dist: 999 };
  }
  let best: BuildingPadBlueprint | null = null;
  let bestDist = 999;
  const pads = bp.buildingPads;
  for (let i = 0; i < cell.length; i++) {
    const p = pads[cell[i]];
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return { pad: best, dist: bestDist };
}

export function getDistanceToNearestVillage(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): { village: VillageBlueprint | null; dist: number; clearingRadius: number } {
  // Fast check via buildingPadGrid first (covers spread-out village houses at >=100m spacing!)
  const cell = getGridCell(bp.buildingPadGrid, x, z);
  let bestV: VillageBlueprint | null = null;
  let bestDist = 999;
  let bestClearR = 0;

  if (cell && cell.length > 0) {
    const pads = bp.buildingPads;
    for (let i = 0; i < cell.length; i++) {
      const p = pads[cell[i]];
      if (p.villageIndex < 0) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bestDist) {
        bestDist = d;
        bestV = bp.villages[p.villageIndex];
        bestClearR = p.clearingRadius;
      }
    }
  }

  if (bestV) {
    return { village: bestV, dist: bestDist, clearingRadius: bestClearR };
  }

  // Fallback for far-away queries (e.g. discovery / HUD / soundscape village distance)
  for (let i = 0; i < bp.villages.length; i++) {
    const v = bp.villages[i];
    const d = Math.hypot(x - v.x, z - v.z);
    if (d < bestDist) {
      bestDist = d;
      bestV = v;
      bestClearR = v.clearingRadius;
    }
  }
  return { village: bestV, dist: bestDist, clearingRadius: bestClearR };
}

export function getThicketFactor(x: number, z: number, bp: WorldBlueprint = activeBlueprint): number {
  const n = smoothNoise(x * 0.015 + bp.thicketPhaseX, z * 0.015 + bp.thicketPhaseZ);
  return smoothstep(0.56, 0.82, n);
}

/**
 * Shapes authentic Estonian peat bog lake (laukad) edges:
 * crisp raised sphagnum bank rim dropping steeply within ~1-2m into deep tea-brown water
 * rather than a shallow sandy-beach ramp.
 */
export function applyBogShoreDropOff(h: number, swamp: number, distToRoadM: number): number {
  if (swamp <= 0.2 || distToRoadM < 4.5) return h;

  const bankMask = smoothstep(0.2, 0.55, swamp) * smoothstep(4.5, 8.5, distToRoadM);
  const rel = h - SWAMP_WATER_Y;

  if (rel >= 0.0 && rel < 0.34) {
    // Crisp raised sphagnum peat bank rim (~20-26cm lip right along the bog pool edge)
    const rimT = smoothstep(0.0, 0.055, rel) * (1 - smoothstep(0.18, 0.34, rel));
    return h + rimT * 0.24 * bankMask;
  }

  if (rel < 0.0 && rel > -0.36) {
    // Steep near-vertical peat wall dropping immediately into deep tea-brown water
    const depthT = smoothstep(0.0, -0.13, rel);
    const steepTarget = SWAMP_WATER_Y - 0.24 - depthT * 1.32;
    return h + (steepTarget - h) * bankMask;
  }

  if (rel <= -0.36) {
    const deepFloor = Math.min(h, SWAMP_WATER_Y - 1.56 + (rel + 0.36) * 0.72);
    return h + (deepFloor - h) * bankMask;
  }

  return h;
}

/**
 * Authoritative deterministic terrain height evaluation from precomputed noise channels.
 * Used identically by both getTerrainHeight() (JS) and fillTerrainChunk() (WASM/JS).
 */
export function evaluateTerrainFromNoise(
  x: number,
  z: number,
  nBase4: number,
  nDetail2: number,
  nBog: number,
  bp: WorldBlueprint = activeBlueprint
): { y: number; swamp: number; islandMask: number } {
  const rawBog = evaluateRawBogMask(x, z, bp.bogLobes, bp.bogBounds);
  let swamp = 0;
  let islandMask = 0;

  // 1. Dry-land rolling forest + Estonian moraine hills (20-40m relief)
  let h = evaluateBaseDryLandFromNoise(x, z, nBase4, nDetail2, bp.hillMassifs, rawBog);

  // Fast O(1) road cell lookup without heap allocation when cell is empty
  let roadDist = 999;
  let roadIsTrail = false;
  const roadCell = getGridCell(bp.roadGrid, x, z);
  if (roadCell && roadCell.length > 0) {
    const roadInfo = distToRoadDetail(x, z, bp);
    roadDist = roadInfo.dist;
    roadIsTrail = roadInfo.isTrail;
  }

  // 2. Large flat peat bog plain + localized bog lake systems (laugastik) + varying-size bog islands
  if (rawBog > 0.001) {
    const isl = getNearestSwampIsland(x, z, bp);
    islandMask = isl.islandMask;
    swamp = rawBog * (1 - islandMask * 0.96);

    // Flatter sphagnum peat bog floor sitting slightly above SWAMP_WATER_Y
    let bogH = SWAMP_WATER_Y + 0.25 + (nBog - 0.5) * 0.24 + nDetail2 * 0.09;

    // Carve localized bog lake systems (deep organic pools) inside the peat plain
    const pool = evaluateBogPoolMask(x, z, bp.bogPools);
    if (pool.mask > 0.001 && islandMask < 0.25) {
      const poolWeight = pool.mask * (1 - smoothstep(0.05, 0.25, islandMask));
      const poolBedH = SWAMP_WATER_Y - 0.15 - pool.maxDepth * Math.pow(poolWeight, 0.85);
      // Smoothly transition peat edge into bog pool rim before steep peat-bank drop-off
      const rimCarve = smoothstep(0.08, 0.58, poolWeight);
      bogH = bogH * (1 - rimCarve) + poolBedH * rimCarve;
    }

    const bogBlend = smoothstep(0.0, 0.68, swamp);
    h = h * (1 - bogBlend) + bogH * bogBlend;

    // Raise wooded bog islands above the flat bog plain (larger islands have gently domed crowns)
    if (isl.island && islandMask > 0.001) {
      const islandCrownH =
        SWAMP_WATER_Y +
        0.55 +
        isl.island.peakHeight * Math.pow(islandMask, 0.78) +
        nDetail2 * 0.22;
      // Flatten central crown slightly when a large island carries a hut
      const targetIslandH =
        isl.island.hut && islandMask > 0.72
          ? SWAMP_WATER_Y + 0.55 + isl.island.peakHeight * 0.86
          : islandCrownH;
      const islBlend = smoothstep(0.02, 0.72, islandMask);
      h = h * (1 - islBlend) + Math.max(h, targetIslandH) * islBlend;
    }

    // Crisp dark peat-bank drop-off along bog lake pool shorelines
    h = applyBogShoreDropOff(h, swamp, roadDist);
  }

  // 3. Non-bog freshwater lakes (natural valley bowls with rim containment so water never spills)
  let lakeSampleAtPos: { lake: LakeBlueprint; normDist: number } | null = null;
  if (rawBog < 0.08 && bp.lakes.length > 0) {
    lakeSampleAtPos = getLakeSampleAt(x, z, bp);
    if (lakeSampleAtPos) {
      const { lake, normDist } = lakeSampleAtPos;
      if (normDist < 1.0) {
        // Organic sloped lake shore -> deep clear basin
        const depthProfile = Math.pow(1 - normDist * normDist, 0.82);
        const bedH = lake.waterY - 0.08 - lake.maxDepth * depthProfile;
        const shoreBlend = smoothstep(1.0, 0.86, normDist);
        const rimBase = Math.max(h, lake.waterY + 0.38);
        h = rimBase * (1 - shoreBlend) + bedH * shoreBlend;
      } else if (normDist < 1.54) {
        // Gentle rim containment band keeps shore bank cleanly above lake.waterY
        const rimT = 1 - smoothstep(1.0, 1.54, normDist);
        const minShoreH = lake.waterY + 0.42 + (normDist - 1.0) * 0.55;
        if (h < minShoreH) {
          h = h + (minShoreH - h) * rimT;
        }
      }
    }
  }

  // 4. Narrow, shallow downhill streams (gentle natural swale that cuts cleanly into lake/bog mouths
  //    and passes beneath roads/trails via culverts without carving across the road deck)
  if (bp.streams.length > 0) {
    const st = getStreamSampleAt(x, z, bp);
    if (st) {
      const bankSpan = 3.8;
      const bankOuter = st.halfWidth + bankSpan;
      if (st.dist < bankOuter) {
        // Protect road & trail decks whenever a stream crosses under them through a drainage pipe
        const roadDeckHalf = roadIsTrail ? 2.15 : 3.55;
        const roadShoulderOuter = roadDeckHalf + 1.95;
        const culvertMask =
          roadDist < roadShoulderOuter ? 1 - smoothstep(roadDeckHalf, roadShoulderOuter, roadDist) : 0;
        const carveWeight = 1 - culvertMask;

        if (carveWeight > 0.005) {
          const nearTargetLake =
            lakeSampleAtPos !== null && lakeSampleAtPos.normDist < 1.22 && st.progress > 0.82;
          const mouthT = st.progress > 0.88 ? smoothstep(0.88, 1.0, st.progress) : 0;
          // Underlying coarse-terrain trough (>=1.05m half-width) ensures ~2.5m terrain triangles always dip
          // smoothly beneath the narrow <=1m 3D streambed ribbon even on steep ravines (zero terrain overhang!).
          const channelCarveW = Math.max(st.halfWidth * 1.65, 1.05);
          if (st.dist <= channelCarveW) {
            const u = st.dist / Math.max(0.18, channelCarveW);
            const bedDip = st.depth + 0.14 + mouthT * 0.16;
            const channelBed = st.waterY - bedDip * (1 - u * u * 0.72);
            // Always cut cleanly through lake rim so there is NEVER a dry earth dam across the mouth
            if (h > channelBed) {
              h = h + (channelBed - h) * carveWeight;
            } else if (!nearTargetLake && st.progress < 0.88 && rawBog < 0.18) {
              h = h + (channelBed - h) * (0.75 * carveWeight);
            }
          } else {
            const bankT = (st.dist - channelCarveW) / Math.max(0.5, bankOuter - channelCarveW);
            const smoothBank = bankT * bankT * (3 - 2 * bankT);
            // Flat-ground brooks stay almost flush with forest floor; steeper runs get a smooth mossy swale
            const slopeFactor = smoothstep(0.018, 0.08, st.slope);
            const bankRise = 0.04 + slopeFactor * 0.14 + smoothBank * (0.48 + slopeFactor * 0.52);
            const bankTarget = st.waterY + bankRise;
            const blend = (1 - smoothBank) * (nearTargetLake ? 0.65 : 0.88) * carveWeight;
            if (h > bankTarget) {
              h = h + (bankTarget - h) * blend;
            }
            // Keep dry banks slightly above waterY outside the lake mouth / bog so water stays confined
            const minBankY = st.waterY + 0.07 + smoothBank * 0.18;
            if (!nearTargetLake && st.progress < 0.86 && rawBog < 0.16 && h < minBankY) {
              h = h + (minBankY - h) * (1 - smoothBank) * 0.82 * carveWeight;
            }
          }
        }

        // Maintain dry earth/gravel embankment cover above the drainage pipe across the road deck
        if (culvertMask > 0.02 && st.dist < st.halfWidth + 2.4) {
          const alongRoadCover = 1 - smoothstep(st.halfWidth + 0.4, st.halfWidth + 2.4, st.dist);
          const minCoverY = st.waterY + (roadIsTrail ? 0.56 : 0.78);
          if (h < minCoverY) {
            h = h + (minCoverY - h) * culvertMask * alongRoadCover;
          }
        }
      }
    }
  }

  // 5. Smooth local flattening for individual village houses, abandoned forest huts, and major structures
  const padCell = getGridCell(bp.buildingPadGrid, x, z);
  if (padCell && padCell.length > 0) {
    let bestPad: BuildingPadBlueprint | null = null;
    let bestPadDistSq = Infinity;
    const pads = bp.buildingPads;
    for (let i = 0; i < padCell.length; i++) {
      const p = pads[padCell[i]];
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestPadDistSq) {
        bestPadDistSq = dSq;
        bestPad = p;
      }
    }
    if (bestPad) {
      const flatOuter = bestPad.clearingRadius + 10;
      if (bestPadDistSq < flatOuter * flatOuter) {
        const t = 1 - smoothstep(bestPad.clearingRadius * 0.48, flatOuter, Math.sqrt(bestPadDistSq));
        h = h * (1 - t) + bestPad.flattenHeight * t;
      }
    }
  }

  // 6. Gentle road crown smoothing (never lets gravel road drown in low spots)
  if (!roadIsTrail && roadDist < 8.5) {
    const tRoad = 1 - smoothstep(2.6, 8.5, roadDist);
    const minRoadY = SWAMP_WATER_Y + 0.75;
    if (h < minRoadY) {
      h = h * (1 - tRoad) + minRoadY * tRoad;
    }
  }

  return { y: h, swamp, islandMask };
}

export function sampleTerrainSurface(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): { y: number; swamp: number; islandMask: number } {
  const nBase4 = fbm(x * 0.008, z * 0.008, 4);
  const nDetail2 = fbm(x * 0.03, z * 0.03, 2);
  const nBog = smoothNoise(x * 0.09, z * 0.09);
  return evaluateTerrainFromNoise(x, z, nBase4, nDetail2, nBog, bp);
}

export function getTerrainHeight(x: number, z: number, bp: WorldBlueprint = activeBlueprint): number {
  const nBase4 = fbm(x * 0.008, z * 0.008, 4);
  const nDetail2 = fbm(x * 0.03, z * 0.03, 2);
  const nBog = smoothNoise(x * 0.09, z * 0.09);
  return evaluateTerrainFromNoise(x, z, nBase4, nDetail2, nBog, bp).y;
}

export interface WaterSurfaceSample {
  hasWater: boolean;
  waterY: number;
  depth: number;
  kind: 'bog' | 'lake' | 'stream' | 'none';
  flowX: number;
  flowZ: number;
}

/**
 * Authoritative unified water surface query across bog lake pools, non-bog freshwater lakes,
 * and downhill streams. Used by player swimming/wading, bottle refills, planting, and audio.
 */
export function getWaterSurfaceAt(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint,
  precomputedGroundY?: number
): WaterSurfaceSample {
  const groundY = precomputedGroundY !== undefined ? precomputedGroundY : getTerrainHeight(x, z, bp);

  // 1. Non-bog freshwater lakes
  if (bp.lakes.length > 0) {
    const lk = getLakeSampleAt(x, z, bp);
    if (lk && lk.normDist < 1.03) {
      const depth = lk.lake.waterY - groundY;
      if (depth > 0.005) {
        return {
          hasWater: true,
          waterY: lk.lake.waterY,
          depth,
          kind: 'lake',
          flowX: 0,
          flowZ: 0,
        };
      }
    }
  }

  // 2. Downhill streams
  if (bp.streams.length > 0) {
    const st = getStreamSampleAt(x, z, bp);
    if (st && st.dist <= st.halfWidth * 1.15) {
      const depth = st.waterY - groundY;
      if (depth > 0.005) {
        return {
          hasWater: true,
          waterY: st.waterY,
          depth,
          kind: 'stream',
          flowX: st.flowX,
          flowZ: st.flowZ,
        };
      }
    }
  }

  // 3. Peat bog water pools
  if (evaluateRawBogMask(x, z, bp.bogLobes, bp.bogBounds) > 0.05) {
    const depth = SWAMP_WATER_Y - groundY;
    if (depth > 0.005) {
      return {
        hasWater: true,
        waterY: SWAMP_WATER_Y,
        depth,
        kind: 'bog',
        flowX: 0,
        flowZ: 0,
      };
    }
  }

  return {
    hasWater: false,
    waterY: SWAMP_WATER_Y,
    depth: 0,
    kind: 'none',
    flowX: 0,
    flowZ: 0,
  };
}

/**
 * Returns approximate horizontal distance in meters to the nearest open water body
 * (bog pool, freshwater lake, or downhill stream) and whether a stream is nearby.
 */
export function getNearestWaterFeatureDistances(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): { waterM: number; streamM: number; lakeM: number; bogPoolM: number } {
  let waterM = 999;
  let streamM = 999;
  let lakeM = 999;
  let bogPoolM = 999;

  for (let i = 0; i < bp.lakes.length; i++) {
    const lk = bp.lakes[i];
    const approxR = (lk.rx + lk.rz) * 0.5;
    const d = Math.max(0, Math.hypot(x - lk.x, z - lk.z) - approxR);
    if (d < lakeM) lakeM = d;
    if (d < waterM) waterM = d;
  }

  for (let i = 0; i < bp.streams.length; i++) {
    const st = bp.streams[i];
    if (
      x < st.minX - Math.min(waterM, streamM) - 40 ||
      x > st.maxX + Math.min(waterM, streamM) + 40 ||
      z < st.minZ - Math.min(waterM, streamM) - 40 ||
      z > st.maxZ + Math.min(waterM, streamM) + 40
    ) {
      continue;
    }
    for (let j = 0; j < st.points.length - 1; j++) {
      const a = st.points[j];
      const b = st.points[j + 1];
      const d = Math.max(0, pointToSegmentDistance(x, z, a.x, a.z, b.x, b.z) - (a.halfWidth + b.halfWidth) * 0.5);
      if (d < streamM) streamM = d;
      if (d < waterM) waterM = d;
    }
  }

  for (let i = 0; i < bp.bogPools.length; i++) {
    const p = bp.bogPools[i];
    const approxR = (p.rx + p.rz) * 0.5;
    const d = Math.max(0, Math.hypot(x - p.x, z - p.z) - approxR);
    if (d < bogPoolM) bogPoolM = d;
    if (d < waterM) waterM = d;
  }

  return { waterM, streamM, lakeM, bogPoolM };
}

/**
 * Authoritative dry-ground check for trees, saplings, bushes, stumps, mushrooms, and firewood.
 * Prevents trunks or shrubs from spawning in bog pools, freshwater lakes, streams, or steep submerged banks.
 */
export function isDryLandForPlanting(
  x: number,
  z: number,
  minClearance = 0.24,
  sampleRadius = 1.2,
  bp: WorldBlueprint = activeBlueprint
): boolean {
  const centerH = getTerrainHeight(x, z, bp);
  if (centerH <= SWAMP_WATER_Y + minClearance) return false;

  // Reject inside or immediately on the wet shore of any freshwater lake
  const lk = getLakeSampleAt(x, z, bp);
  if (lk && lk.normDist < 1.07) return false;

  // Reject inside or immediately on the wet edge of any downhill stream so big trunks sit neatly on mossy banks
  const st = getStreamSampleAt(x, z, bp);
  if (st && st.dist < st.halfWidth + 1.55) return false;

  // Check if center or surrounding ring dips into bog water
  const rawBog = evaluateRawBogMask(x, z, bp.bogLobes, bp.bogBounds);
  if (rawBog > 0.05) {
    const pool = evaluateBogPoolMask(x, z, bp.bogPools);
    if (pool.mask > 0.08) return false;
    const edgeClear = Math.max(0.06, minClearance * 0.55);
    const r = Math.min(1.15, sampleRadius);
    if (
      getTerrainHeight(x + r, z, bp) <= SWAMP_WATER_Y + edgeClear ||
      getTerrainHeight(x - r, z, bp) <= SWAMP_WATER_Y + edgeClear ||
      getTerrainHeight(x, z + r, bp) <= SWAMP_WATER_Y + edgeClear ||
      getTerrainHeight(x, z - r, bp) <= SWAMP_WATER_Y + edgeClear
    ) {
      return false;
    }
  } else {
    const edgeClear = Math.max(0.14, minClearance * 0.72);
    const r = sampleRadius;
    if (
      getTerrainHeight(x + r, z, bp) <= SWAMP_WATER_Y + edgeClear ||
      getTerrainHeight(x - r, z, bp) <= SWAMP_WATER_Y + edgeClear ||
      getTerrainHeight(x, z + r, bp) <= SWAMP_WATER_Y + edgeClear ||
      getTerrainHeight(x, z - r, bp) <= SWAMP_WATER_Y + edgeClear
    ) {
      return false;
    }
  }

  return true;
}

export type BiomeId = 'village' | 'abandoned' | 'swamp' | 'island' | 'road' | 'thicket' | 'forest';

export function getBiomeInfo(
  x: number,
  z: number,
  bp: WorldBlueprint = activeBlueprint
): { id: BiomeId; label: string } {
  // Check nearest village house or forest hut pad first
  const padInfo = getNearestBuildingPad(x, z, bp);
  if (padInfo.pad && padInfo.dist < padInfo.pad.clearingRadius + 10) {
    const p = padInfo.pad;
    if (p.kind === 'forest_hut') {
      return { id: 'abandoned', label: p.label };
    }
    if (p.villageIndex >= 0) {
      const v = bp.villages[p.villageIndex];
      return {
        id: v.abandoned || p.abandoned ? 'abandoned' : 'village',
        label: v.estonianLabel,
      };
    }
    return {
      id: p.abandoned ? 'abandoned' : 'village',
      label: p.label,
    };
  }

  const isl = getNearestSwampIsland(x, z, bp);
  if (isl.island && isl.islandMask > 0.42) {
    return { id: 'island', label: isl.island.name };
  }

  const swamp = getSwampFactor(x, z, bp);
  if (swamp > 0.42) return { id: 'swamp', label: 'Kõrgesoo raba' };

  const roadInfo = distToRoadDetail(x, z, bp);
  if (roadInfo.dist < 4.5) {
    return { id: 'road', label: roadInfo.isTrail ? 'Metsarada' : 'Kruusatee' };
  }

  const lake = getLakeSampleAt(x, z, bp);
  if (lake && lake.normDist < 1.18) {
    return { id: 'forest', label: lake.lake.name };
  }

  const stream = getStreamSampleAt(x, z, bp);
  if (stream && stream.dist < stream.halfWidth + 8) {
    return { id: 'forest', label: stream.stream.name };
  }

  if (getThicketFactor(x, z, bp) > 0.52) return { id: 'thicket', label: 'Tihe kuusik' };
  return { id: 'forest', label: 'Metsavaikus' };
}
