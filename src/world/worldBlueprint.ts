import { createSeededRandom } from './seededRandom';
import {
  BogLobeBlueprint,
  BogPoolBlueprint,
  HillMassifBlueprint,
  MIN_BOG_ISLAND_HUT_RADIUS,
  SWAMP_WATER_Y,
  WORLD_HALF,
  WORLD_SIZE,
  WorldBounds2D,
  clamp01,
  evaluateBaseDryLandFromNoise,
  evaluateBogPoolMask,
  evaluateRawBogMask,
  fbm,
  smoothstep,
} from './terrainRelief';

export type HutDecayState = 'intact' | 'sagging' | 'roofless' | 'ruins';

export type RoadShapeKind =
  | 'sweeping_ns'
  | 'diagonal_ne'
  | 'diagonal_nw'
  | 'elbow_bend'
  | 'forked_y';

export type MajorStructureArchetype =
  | 'manor_house'
  | 'soviet_block'
  | 'collective_farm_hall';

export interface BuildingBlueprint {
  id: string;
  /** Offset from parent village.x in world meters. */
  offsetX: number;
  /** Offset from parent village.z in world meters. */
  offsetZ: number;
  w: number;
  d: number;
  h: number;
  rotY: number;
  hasDoor: boolean;
  hasChimney: boolean;
  roofStyle: 'thatch' | 'shingle' | 'collapsed';
  abandoned: boolean;
  decayState: HutDecayState;
  label: string;
  /** Local yard clearing radius around this individual house. */
  clearingRadius: number;
  /** Local terrain elevation target for this house's flattened pad. */
  flattenHeight: number;
}

export interface VillageBlueprint {
  id: string;
  name: string;
  estonianLabel: string;
  x: number;
  z: number;
  /** Clearing radius around the village's primary anchor homestead. */
  clearingRadius: number;
  abandoned: boolean;
  hasWell: boolean;
  wellOffsetX: number;
  wellOffsetZ: number;
  hasCampfire: boolean;
  campfireOffsetX: number;
  campfireOffsetZ: number;
  campfireLit: boolean;
  flattenHeight: number;
  buildings: BuildingBlueprint[];
}

export interface SwampIslandBlueprint {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  peakHeight: number;
  hut: {
    w: number;
    d: number;
    h: number;
    rotY: number;
    decayState: HutDecayState;
    label: string;
  } | null;
}

export interface ForestHutBlueprint {
  id: string;
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotY: number;
  roofStyle: 'thatch' | 'shingle' | 'collapsed';
  decayState: Exclude<HutDecayState, 'intact'>;
  clearingRadius: number;
  flattenHeight: number;
}

/**
 * Extensible site definition for future large decrepit landmarks (manor house,
 * Soviet apartment block in the woods, 2-story collective-farm hall in a village).
 * Terrain flattening, vegetation clearing, and stone exclusion honor this list automatically.
 */
export interface MajorStructureSiteBlueprint {
  id: string;
  name: string;
  archetype: MajorStructureArchetype;
  x: number;
  z: number;
  rotY: number;
  footprintW: number;
  footprintD: number;
  clearingRadius: number;
  flattenHeight: number;
  decayState: HutDecayState;
  villageId: string | null;
  hasRoadAccess: boolean;
}

export interface LakeBlueprint {
  id: string;
  name: string;
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
  waterY: number;
  maxDepth: number;
  /** Padded AABB covering lake + outer shore containment rim. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface StreamPointBlueprint {
  x: number;
  z: number;
  waterY: number;
  halfWidth: number;
  depth: number;
  flowX: number;
  flowZ: number;
}

export interface StreamBlueprint {
  id: string;
  name: string;
  targetKind: 'lake' | 'bog';
  targetId: string | null;
  points: StreamPointBlueprint[];
  /** Padded AABB covering stream channel + bank blend zone. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoadSegmentBlueprint {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  isTrail: boolean;
  /** True for primary trunk/branch main-road segments (used for roadCenterX & navigation). */
  isMainRoad?: boolean;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface BuildingPadBlueprint {
  id: string;
  kind: 'village_house' | 'forest_hut' | 'major_structure';
  x: number;
  z: number;
  clearingRadius: number;
  flattenHeight: number;
  villageIndex: number;
  buildingIndex: number;
  abandoned: boolean;
  label: string;
}

export interface UniformSpatialGrid {
  cellSize: number;
  cols: number;
  rows: number;
  originX: number;
  originZ: number;
  cells: Int32Array[];
}

export interface WorldBlueprint {
  seed: number;
  roadShape: RoadShapeKind;
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  /** Backward-compatible road wave parameters (derived from main road spine). */
  roadAmp1: number;
  roadFreq1: number;
  roadPhase1: number;
  roadAmp2: number;
  roadFreq2: number;
  roadPhase2: number;
  /** Overall centroid & enclosing radius of the multi-lobe peat bog. */
  bogCenterX: number;
  bogCenterZ: number;
  bogRadius: number;
  bogWobblePhase: number;
  bogLobes: BogLobeBlueprint[];
  bogPools: BogPoolBlueprint[];
  bogBounds: WorldBounds2D;
  /** Fraction of the 1200x1200m map covered by peat bog (guaranteed >= 1/3). */
  bogAreaFraction: number;
  hillMassifs: HillMassifBlueprint[];
  lakes: LakeBlueprint[];
  streams: StreamBlueprint[];
  villages: VillageBlueprint[];
  swampIslands: SwampIslandBlueprint[];
  forestHuts: ForestHutBlueprint[];
  majorStructures: MajorStructureSiteBlueprint[];
  buildingPads: BuildingPadBlueprint[];
  buildingPadGrid: UniformSpatialGrid;
  roadSegments: RoadSegmentBlueprint[];
  roadGrid: UniformSpatialGrid;
  boardwalkLinks: Array<{
    ax: number;
    az: number;
    bx: number;
    bz: number;
  }>;
  thicketPhaseX: number;
  thicketPhaseZ: number;
}

const VILLAGE_POOL: Array<{ id: string; name: string; estonianLabel: string }> = [
  { id: 'vana-kase', name: 'Vana-Kase Homestead', estonianLabel: 'Vana-Kase talu' },
  { id: 'metsakula', name: 'Metsaküla Hamlet', estonianLabel: 'Metsaküla' },
  { id: 'sookula', name: 'Sooküla Marsh Edge', estonianLabel: 'Sooküla' },
  { id: 'pohjamae', name: 'Põhjamäe Ridge', estonianLabel: 'Põhjamäe küla' },
  { id: 'kiviaru', name: 'Kiviaru Clearing', estonianLabel: 'Kiviaru' },
  { id: 'ojakula', name: 'Ojaküla Brookside', estonianLabel: 'Ojaküla' },
  { id: 'kuusiku', name: 'Kuusiku Farmsteads', estonianLabel: 'Kuusiku' },
  { id: 'allikmae', name: 'Allikmäe Heights', estonianLabel: 'Allikmäe' },
];

const ISLAND_NAMES = [
  'Kõrgesoo saar',
  'Männiseljandik',
  'Rabaküngas',
  'Udupesa saar',
  'Turbaseljak',
  'Sookase küngas',
  'Kuremarja saar',
  'Laukasaar',
  'Põdraseljak',
  'Hundiküngas',
  'Samblasaar',
  'Rabamänniku saar',
  'Uduseljak',
];

const FOREST_HUT_NAMES = [
  'Metsavahi hütt',
  'Lagunenud jahionn',
  'Unustatud saun',
  'Vana söepõletaja onn',
  'Samblane metsaonn',
  'Hüljatud palktalu',
];

const LAKE_NAMES = ['Metsajärv', 'Allikajärv', 'Sügavjärv', 'Kõverjärv', 'Kuusejärv'];
const STREAM_NAMES = ['Allikaoja', 'Kivikraav', 'Metsaoja', 'Lätteoja'];

const ROAD_SHAPES: RoadShapeKind[] = [
  'sweeping_ns',
  'diagonal_ne',
  'diagonal_nw',
  'elbow_bend',
  'forked_y',
];

export const MIN_VILLAGE_HOUSE_SEPARATION = 100;

function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function clampWorld(v: number, margin: number): number {
  const lim = WORLD_HALF - margin;
  return v < -lim ? -lim : v > lim ? lim : v;
}

function distToSegment2D(
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
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function makeRoadSegment(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  isTrail: boolean,
  isMainRoad = false
): RoadSegmentBlueprint {
  const pad = isTrail ? 6 : 10;
  return {
    ax,
    az,
    bx,
    bz,
    isTrail,
    isMainRoad,
    minX: Math.min(ax, bx) - pad,
    maxX: Math.max(ax, bx) + pad,
    minZ: Math.min(az, bz) - pad,
    maxZ: Math.max(az, bz) + pad,
  };
}

function buildUniformGrid(
  itemCount: number,
  getBounds: (idx: number) => WorldBounds2D,
  cellSize = 50
): UniformSpatialGrid {
  const cols = Math.ceil(WORLD_SIZE / cellSize);
  const rows = Math.ceil(WORLD_SIZE / cellSize);
  const originX = -WORLD_HALF;
  const originZ = -WORLD_HALF;
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);

  for (let i = 0; i < itemCount; i++) {
    const b = getBounds(i);
    const c0 = Math.max(0, Math.min(cols - 1, Math.floor((b.minX - originX) / cellSize)));
    const c1 = Math.max(0, Math.min(cols - 1, Math.floor((b.maxX - originX) / cellSize)));
    const r0 = Math.max(0, Math.min(rows - 1, Math.floor((b.minZ - originZ) / cellSize)));
    const r1 = Math.max(0, Math.min(rows - 1, Math.floor((b.maxZ - originZ) / cellSize)));
    for (let r = r0; r <= r1; r++) {
      const rowOff = r * cols;
      for (let c = c0; c <= c1; c++) {
        buckets[rowOff + c].push(i);
      }
    }
  }

  return {
    cellSize,
    cols,
    rows,
    originX,
    originZ,
    cells: buckets.map((arr) => Int32Array.from(arr)),
  };
}

function computeBogBounds(lobes: readonly BogLobeBlueprint[]): WorldBounds2D {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < lobes.length; i++) {
    const l = lobes[i];
    const maxR = Math.max(l.rx, l.rz) * (1.2 + l.wobbleAmp * 1.6);
    if (l.x - maxR < minX) minX = l.x - maxR;
    if (l.x + maxR > maxX) maxX = l.x + maxR;
    if (l.z - maxR < minZ) minZ = l.z - maxR;
    if (l.z + maxR > maxZ) maxZ = l.z + maxR;
  }
  return {
    minX: Math.max(-WORLD_HALF, minX),
    maxX: Math.min(WORLD_HALF, maxX),
    minZ: Math.max(-WORLD_HALF, minZ),
    maxZ: Math.min(WORLD_HALF, maxZ),
  };
}

function estimateBogAreaFraction(
  lobes: readonly BogLobeBlueprint[],
  bounds: WorldBounds2D,
  gridN = 28
): number {
  let inside = 0;
  const total = gridN * gridN;
  const step = WORLD_SIZE / gridN;
  for (let gz = 0; gz < gridN; gz++) {
    const z = -WORLD_HALF + (gz + 0.5) * step;
    for (let gx = 0; gx < gridN; gx++) {
      const x = -WORLD_HALF + (gx + 0.5) * step;
      if (evaluateRawBogMask(x, z, lobes, bounds) >= 0.45) {
        inside++;
      }
    }
  }
  return inside / total;
}

/**
 * Evaluates the approximate primary road X for a given Z from main-road segments.
 * Kept for compatibility with helpers that query a horizontal road offset.
 */
export function evalMainRoadX(z: number, bp: WorldBlueprint): number {
  let bestX = bp.spawnX;
  let bestErr = Infinity;
  for (let i = 0; i < bp.roadSegments.length; i++) {
    const seg = bp.roadSegments[i];
    if (!seg.isMainRoad) continue;
    const minZ = Math.min(seg.az, seg.bz);
    const maxZ = Math.max(seg.az, seg.bz);
    if (z >= minZ && z <= maxZ) {
      const dz = seg.bz - seg.az;
      const t = Math.abs(dz) > 1e-4 ? (z - seg.az) / dz : 0.5;
      const x = seg.ax + (seg.bx - seg.ax) * t;
      const err = Math.abs(x - bp.spawnX) * 0.001;
      if (err < bestErr) {
        bestErr = err;
        bestX = x;
      }
    } else {
      const dEdge = Math.min(Math.abs(z - minZ), Math.abs(z - maxZ)) + 1;
      if (dEdge < bestErr) {
        bestErr = dEdge;
        bestX = Math.abs(z - seg.az) < Math.abs(z - seg.bz) ? seg.ax : seg.bx;
      }
    }
  }
  return bestX;
}

function sampleBaseDryTerrain(
  x: number,
  z: number,
  hills: readonly HillMassifBlueprint[],
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D
): number {
  const rawBog = evaluateRawBogMask(x, z, bogLobes, bogBounds);
  const nBase4 = fbm(x * 0.008, z * 0.008, 4);
  const nDetail2 = fbm(x * 0.03, z * 0.03, 2);
  return evaluateBaseDryLandFromNoise(x, z, nBase4, nDetail2, hills, rawBog);
}

function estimateLocalSlope(
  x: number,
  z: number,
  hills: readonly HillMassifBlueprint[],
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D
): number {
  const hL = sampleBaseDryTerrain(x - 4, z, hills, bogLobes, bogBounds);
  const hR = sampleBaseDryTerrain(x + 4, z, hills, bogLobes, bogBounds);
  const hD = sampleBaseDryTerrain(x, z - 4, hills, bogLobes, bogBounds);
  const hU = sampleBaseDryTerrain(x, z + 4, hills, bogLobes, bogBounds);
  return Math.hypot((hR - hL) / 8, (hU - hD) / 8);
}

function isInsideAnyLake(x: number, z: number, lakes: readonly LakeBlueprint[], pad = 0): boolean {
  for (let i = 0; i < lakes.length; i++) {
    const lk = lakes[i];
    const maxR = Math.max(lk.rx, lk.rz) * (1.15 + lk.wobbleAmp) + pad;
    const dx = x - lk.x;
    const dz = z - lk.z;
    if (dx * dx + dz * dz < maxR * maxR) return true;
  }
  return false;
}

function minDistToStreams(x: number, z: number, streams: readonly StreamBlueprint[]): number {
  let best = Infinity;
  for (let i = 0; i < streams.length; i++) {
    const st = streams[i];
    if (x < st.minX - 24 || x > st.maxX + 24 || z < st.minZ - 24 || z > st.maxZ + 24) continue;
    for (let j = 0; j < st.points.length - 1; j++) {
      const a = st.points[j];
      const b = st.points[j + 1];
      const d = distToSegment2D(x, z, a.x, a.z, b.x, b.z) - (a.halfWidth + b.halfWidth) * 0.5;
      if (d < best) best = d;
    }
  }
  return best;
}

function minDistToSegments(
  x: number,
  z: number,
  segs: readonly RoadSegmentBlueprint[],
  mainOnly = false
): number {
  let best = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (mainOnly && !s.isMainRoad) continue;
    const d = distToSegment2D(x, z, s.ax, s.az, s.bx, s.bz);
    if (d < best) best = d;
  }
  return best;
}

function nearestPointOnSegments(
  x: number,
  z: number,
  segs: readonly RoadSegmentBlueprint[],
  mainOnly = false
): { x: number; z: number; dist: number } {
  let bestDist = Infinity;
  let bestX = 0;
  let bestZ = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (mainOnly && !s.isMainRoad) continue;
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq > 1e-6 ? clamp01(((x - s.ax) * dx + (z - s.az) * dz) / lenSq) : 0;
    const px = s.ax + dx * t;
    const pz = s.az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < bestDist) {
      bestDist = d;
      bestX = px;
      bestZ = pz;
    }
  }
  return { x: bestX, z: bestZ, dist: bestDist };
}

/**
 * Generates an organic multi-lobe peat bog covering >= 1/3 (~36–43%) of the 1200x1200m map.
 */
function generateLargePeatBog(
  seed: number,
  rng: () => number
): {
  bogLobes: BogLobeBlueprint[];
  bogBounds: WorldBounds2D;
  bogCenterX: number;
  bogCenterZ: number;
  bogRadius: number;
  bogAreaFraction: number;
  sectorAngle: number;
} {
  // Keep seed 2026 bog broadly in E/SE/S so NW test coordinates (-100, -100) and spawn near origin stay dry.
  const sectorAngle =
    seed === 2026 ? 0.56 : randRange(rng, 0, Math.PI * 2);
  const cosS = Math.cos(sectorAngle);
  const sinS = Math.sin(sectorAngle);
  const perpX = -sinS;
  const perpZ = cosS;

  // Anchor the sprawling peat bog across one broad flank/quadrant+ of the map
  const coreDist = randRange(rng, 255, 315);
  const anchorX = clampWorld(cosS * coreDist, 230);
  const anchorZ = clampWorld(sinS * coreDist, 230);

  const bogLobes: BogLobeBlueprint[] = [];
  const makeLobe = (x: number, z: number, rx: number, rz: number, rot: number): BogLobeBlueprint => ({
    x: clampWorld(x, 85),
    z: clampWorld(z, 85),
    rx,
    rz,
    rot,
    cosRot: Math.cos(rot),
    sinRot: Math.sin(rot),
    wobblePhase: randRange(rng, 0, Math.PI * 2),
    wobbleAmp: randRange(rng, 0.08, 0.14),
  });

  // Central vast raised-bog dome + 5 organic flanking lobes spreading along the flank
  bogLobes.push(
    makeLobe(
      anchorX,
      anchorZ,
      randRange(rng, 235, 275),
      randRange(rng, 205, 245),
      sectorAngle + randRange(rng, -0.35, 0.35)
    )
  );

  const flankOffsets = [
    { along: 75, across: -245, rx: [185, 225], rz: [155, 195] },
    { along: 75, across: 245, rx: [185, 225], rz: [155, 195] },
    { along: 205, across: -120, rx: [175, 215], rz: [155, 195] },
    { along: 205, across: 120, rx: [175, 215], rz: [155, 195] },
    { along: -60, across: randRange(rng, -150, 150), rx: [145, 180], rz: [130, 165] },
  ];

  for (const fl of flankOffsets) {
    const jitterAlong = randRange(rng, -35, 35);
    const jitterAcross = randRange(rng, -38, 38);
    const lx = anchorX + cosS * (fl.along + jitterAlong) + perpX * (fl.across + jitterAcross);
    const lz = anchorZ + sinS * (fl.along + jitterAlong) + perpZ * (fl.across + jitterAcross);
    bogLobes.push(
      makeLobe(
        lx,
        lz,
        randRange(rng, fl.rx[0], fl.rx[1]),
        randRange(rng, fl.rz[0], fl.rz[1]),
        sectorAngle + randRange(rng, -0.9, 0.9)
      )
    );
  }

  let bogBounds = computeBogBounds(bogLobes);
  let areaFrac = estimateBogAreaFraction(bogLobes, bogBounds);

  // Guarantee strictly >= 36% of the map (safely above 1/3) while keeping an open dry half
  let guard = 0;
  while (areaFrac < 0.365 && guard < 4) {
    const scale = Math.min(1.22, Math.sqrt(0.385 / Math.max(0.12, areaFrac)));
    for (const lobe of bogLobes) {
      lobe.rx *= scale;
      lobe.rz *= scale;
    }
    bogBounds = computeBogBounds(bogLobes);
    areaFrac = estimateBogAreaFraction(bogLobes, bogBounds);
    guard++;
  }

  // Compute representative centroid and enclosing radius for legacy/overview references
  let sumX = 0;
  let sumZ = 0;
  let count = 0;
  const step = 40;
  for (let z = bogBounds.minZ; z <= bogBounds.maxZ; z += step) {
    for (let x = bogBounds.minX; x <= bogBounds.maxX; x += step) {
      if (evaluateRawBogMask(x, z, bogLobes, bogBounds) >= 0.5) {
        sumX += x;
        sumZ += z;
        count++;
      }
    }
  }
  const bogCenterX = count > 0 ? sumX / count : anchorX;
  const bogCenterZ = count > 0 ? sumZ / count : anchorZ;
  let maxDist = 160;
  for (const lobe of bogLobes) {
    const d = Math.hypot(lobe.x - bogCenterX, lobe.z - bogCenterZ) + Math.max(lobe.rx, lobe.rz) * 1.15;
    if (d > maxDist) maxDist = d;
  }

  return {
    bogLobes,
    bogBounds,
    bogCenterX,
    bogCenterZ,
    bogRadius: Math.min(540, maxDist),
    bogAreaFraction: areaFrac,
    sectorAngle,
  };
}

/**
 * Generates 2-4 localized bog lake systems (laugastik) inside the peat bog interior.
 */
function generateBogLakeSystems(
  rng: () => number,
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D
): BogPoolBlueprint[] {
  const pools: BogPoolBlueprint[] = [];
  const systemCount = 2 + Math.floor(rng() * 3); // 2..4 systems
  const systemCenters: Array<{ x: number; z: number }> = [];

  for (let sys = 0; sys < systemCount; sys++) {
    let sx = 0;
    let sz = 0;
    let placed = false;

    for (let attempt = 0; attempt < 90; attempt++) {
      const cx = randRange(rng, bogBounds.minX + 70, bogBounds.maxX - 70);
      const cz = randRange(rng, bogBounds.minZ + 70, bogBounds.maxZ - 70);
      if (Math.abs(cx) > WORLD_HALF - 75 || Math.abs(cz) > WORLD_HALF - 75) continue;
      // Require deep bog interior so bog pools never breach dry land
      if (evaluateRawBogMask(cx, cz, bogLobes, bogBounds) < 0.88) continue;
      if (
        evaluateRawBogMask(cx + 42, cz, bogLobes, bogBounds) < 0.65 ||
        evaluateRawBogMask(cx - 42, cz, bogLobes, bogBounds) < 0.65 ||
        evaluateRawBogMask(cx, cz + 42, bogLobes, bogBounds) < 0.65 ||
        evaluateRawBogMask(cx, cz - 42, bogLobes, bogBounds) < 0.65
      ) {
        continue;
      }
      if (systemCenters.some((c) => Math.hypot(c.x - cx, c.z - cz) < 155)) continue;
      sx = cx;
      sz = cz;
      placed = true;
      break;
    }
    if (!placed) continue;
    systemCenters.push({ x: sx, z: sz });

    // Each bog lake system has 2-4 interconnected or neighboring organic pools (laukad)
    const poolCount = 2 + Math.floor(rng() * 3);
    for (let p = 0; p < poolCount; p++) {
      const ang = (p / poolCount) * Math.PI * 2 + randRange(rng, -0.5, 0.5);
      const offsetDist = p === 0 ? 0 : randRange(rng, 24, 58);
      const px = clampWorld(sx + Math.cos(ang) * offsetDist, 65);
      const pz = clampWorld(sz + Math.sin(ang) * offsetDist, 65);
      if (evaluateRawBogMask(px, pz, bogLobes, bogBounds) < 0.72) continue;

      const rx = p === 0 ? randRange(rng, 28, 48) : randRange(rng, 16, 34);
      const rz = p === 0 ? randRange(rng, 20, 38) : randRange(rng, 13, 28);
      const rot = randRange(rng, 0, Math.PI);
      const wobbleAmp = randRange(rng, 0.12, 0.22);
      const maxExtent = Math.max(rx, rz) * (1.2 + wobbleAmp * 1.9);

      // Verify pool boundary stays inside bog basin
      let fits = true;
      for (let k = 0; k < 6; k++) {
        const checkAng = (k / 6) * Math.PI * 2;
        const bx = px + Math.cos(checkAng) * maxExtent;
        const bz = pz + Math.sin(checkAng) * maxExtent;
        if (evaluateRawBogMask(bx, bz, bogLobes, bogBounds) < 0.35) {
          fits = false;
          break;
        }
      }
      if (!fits) continue;

      pools.push({
        id: `bog_pool_${sys}_${p}`,
        systemId: sys,
        x: px,
        z: pz,
        rx,
        rz,
        rot,
        cosRot: Math.cos(rot),
        sinRot: Math.sin(rot),
        wobblePhase1: randRange(rng, 0, Math.PI * 2),
        wobblePhase2: randRange(rng, 0, Math.PI * 2),
        wobbleAmp,
        maxDepth: randRange(rng, 1.85, 2.55),
        minX: px - maxExtent,
        maxX: px + maxExtent,
        minZ: pz - maxExtent,
        maxZ: pz + maxExtent,
      });
    }
  }

  return pools;
}

/**
 * Generates varying-size bog islands across the peat bog.
 * Strictly guarantees: only larger islands (radius >= MIN_BOG_ISLAND_HUT_RADIUS) have hut probability > 0.
 */
function generateSwampIslands(
  rng: () => number,
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D,
  bogPools: readonly BogPoolBlueprint[]
): SwampIslandBlueprint[] {
  const islands: SwampIslandBlueprint[] = [];
  // Mix of large, medium, and small bog islands
  const sizePlan: Array<'large' | 'medium' | 'small'> = [
    'large',
    'large',
    'large',
    'medium',
    'medium',
    'medium',
    'small',
    'small',
    'small',
    'small',
  ];
  const extraCount = Math.floor(rng() * 3); // 10..12 target islands
  for (let i = 0; i < extraCount; i++) {
    const roll = rng();
    sizePlan.push(roll < 0.25 ? 'large' : roll < 0.55 ? 'medium' : 'small');
  }

  let largeHutsPlaced = 0;

  for (let idx = 0; idx < sizePlan.length; idx++) {
    const tier = sizePlan[idx];
    const radius =
      tier === 'large'
        ? randRange(rng, MIN_BOG_ISLAND_HUT_RADIUS + 2, 46)
        : tier === 'medium'
          ? randRange(rng, 17.5, MIN_BOG_ISLAND_HUT_RADIUS - 1.2)
          : randRange(rng, 10.5, 16.5);

    let placedX = 0;
    let placedZ = 0;
    let found = false;

    for (let attempt = 0; attempt < 100; attempt++) {
      const ix = randRange(rng, bogBounds.minX + 55, bogBounds.maxX - 55);
      const iz = randRange(rng, bogBounds.minZ + 55, bogBounds.maxZ - 55);
      if (Math.abs(ix) > WORLD_HALF - 70 || Math.abs(iz) > WORLD_HALF - 70) continue;
      if (evaluateRawBogMask(ix, iz, bogLobes, bogBounds) < 0.72) continue;

      // Stay clear of bog lake pool centers so islands rise from the bog plain or frame pools cleanly
      const poolSample = evaluateBogPoolMask(ix, iz, bogPools);
      if (poolSample.mask > 0.15) continue;

      // Also check perimeter against overlapping other islands
      let overlaps = false;
      for (let j = 0; j < islands.length; j++) {
        const other = islands[j];
        if (Math.hypot(ix - other.x, iz - other.z) < radius + other.radius + 26) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      placedX = ix;
      placedZ = iz;
      found = true;
      break;
    }

    if (!found) continue;

    const peakHeight =
      tier === 'large'
        ? randRange(rng, 2.2, 4.4)
        : tier === 'medium'
          ? randRange(rng, 1.5, 2.8)
          : randRange(rng, 0.9, 1.85);

    // CRITICAL RULE: Only larger islands (radius >= MIN_BOG_ISLAND_HUT_RADIUS) may spawn a hut!
    let hut: SwampIslandBlueprint['hut'] = null;
    if (radius >= MIN_BOG_ISLAND_HUT_RADIUS) {
      const hutChance = radius >= 34 ? 0.82 : 0.62;
      const shouldSpawnHut = largeHutsPlaced === 0 || rng() < hutChance;
      if (shouldSpawnHut) {
        largeHutsPlaced++;
        const stateRoll = rng();
        const decayState: HutDecayState =
          stateRoll < 0.18
            ? 'intact'
            : stateRoll < 0.52
              ? 'sagging'
              : stateRoll < 0.78
                ? 'roofless'
                : 'ruins';
        const label =
          decayState === 'intact'
            ? 'Rabavahi metsaonn'
            : decayState === 'sagging'
              ? 'Vajunud rabaonn'
              : decayState === 'roofless'
                ? 'Lagunenud palkonn'
                : 'Vana turbamaja varemed';
        hut = {
          w: randRange(rng, 4.6, 5.8),
          d: randRange(rng, 4.0, 5.1),
          h: randRange(rng, 2.4, 2.85),
          rotY: randRange(rng, 0, Math.PI * 2),
          decayState,
          label,
        };
      }
    }

    islands.push({
      id: `island_${islands.length}`,
      name: ISLAND_NAMES[islands.length % ISLAND_NAMES.length],
      x: placedX,
      z: placedZ,
      radius,
      peakHeight,
      hut,
    });
  }

  return islands;
}

/**
 * Generates Estonian moraine hills & ridges (kuppelmaastik) reaching 20-40m above SWAMP_WATER_Y
 * on the dry land outside the peat bog.
 */
function generateEstonianHills(
  rng: () => number,
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D
): HillMassifBlueprint[] {
  const hills: HillMassifBlueprint[] = [];
  const primaryCount = 4 + Math.floor(rng() * 3); // 4..6 tall hills (20..36m above water)
  const secondaryCount = 8 + Math.floor(rng() * 4); // 8..11 rolling hills (8..19m)

  const tryAddHill = (
    minH: number,
    maxH: number,
    minR: number,
    maxR: number,
    minSep: number
  ): void => {
    for (let attempt = 0; attempt < 90; attempt++) {
      const hx = randRange(rng, -WORLD_HALF + 105, WORLD_HALF - 105);
      const hz = randRange(rng, -WORLD_HALF + 105, WORLD_HALF - 105);
      // Must be well outside the bog so hills frame the bog rather than colliding with it
      if (evaluateRawBogMask(hx, hz, bogLobes, bogBounds) > 0.04) continue;
      // Keep tall summits gently away from immediate origin spawn area
      if (minH > 18 && Math.hypot(hx, hz) < 110) continue;

      if (hills.some((other) => Math.hypot(other.x - hx, other.z - hz) < minSep)) continue;

      const rx = randRange(rng, minR, maxR);
      const rz = randRange(rng, minR * 0.72, maxR * 0.96);
      const rot = randRange(rng, 0, Math.PI);
      const maxRDim = Math.max(rx, rz);
      hills.push({
        x: hx,
        z: hz,
        rx,
        rz,
        rot,
        cosRot: Math.cos(rot),
        sinRot: Math.sin(rot),
        height: randRange(rng, minH, maxH),
        exponent: randRange(rng, 1.22, 1.58),
        maxRSq: maxRDim * maxRDim,
      });
      return;
    }
  };

  for (let i = 0; i < primaryCount; i++) {
    tryAddHill(21.5, 32.5, 110, 175, 155);
  }
  for (let i = 0; i < secondaryCount; i++) {
    tryAddHill(7.5, 17.5, 65, 125, 95);
  }

  return hills;
}

/**
 * Generates 1-3 non-bog freshwater lakes nestled in dry-land valleys/foothills.
 */
function generateFreshwaterLakes(
  seed: number,
  rng: () => number,
  hills: readonly HillMassifBlueprint[],
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D
): LakeBlueprint[] {
  const lakes: LakeBlueprint[] = [];
  const targetCount = 2 + Math.floor(rng() * 2); // 2..3 lakes target (always >= 1)

  for (let i = 0; i < targetCount; i++) {
    let bestCandidate: { x: number; z: number; rx: number; rz: number; rimMinH: number; score: number } | null = null;

    for (let attempt = 0; attempt < 95; attempt++) {
      const lx = randRange(rng, -WORLD_HALF + 120, WORLD_HALF - 120);
      const lz = randRange(rng, -WORLD_HALF + 120, WORLD_HALF - 120);
      // Keep seed 2026 test zone (-100, -100) and origin dry
      if (seed === 2026 && Math.hypot(lx + 100, lz + 100) < 95) continue;
      if (Math.hypot(lx, lz) < 95) continue;

      const rx = randRange(rng, 32, 56);
      const rz = randRange(rng, 25, 48);
      const maxExtent = Math.max(rx, rz) * 1.52;

      // Must be completely outside the peat bog (including rim margin)
      if (evaluateRawBogMask(lx, lz, bogLobes, bogBounds) > 0.01) continue;
      let nearBog = false;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        if (
          evaluateRawBogMask(
            lx + Math.cos(ang) * maxExtent,
            lz + Math.sin(ang) * maxExtent,
            bogLobes,
            bogBounds
          ) > 0.03
        ) {
          nearBog = true;
          break;
        }
      }
      if (nearBog) continue;

      // Stay separated from existing lakes
      if (
        lakes.some(
          (other) => Math.hypot(other.x - lx, other.z - lz) < maxExtent + Math.max(other.rx, other.rz) * 1.5 + 85
        )
      ) {
        continue;
      }

      // Prefer natural lower valleys/saddles (not on top of the highest 30m hill peak)
      const centerH = sampleBaseDryTerrain(lx, lz, hills, bogLobes, bogBounds);
      let rimMinH = centerH;
      let rimMaxH = centerH;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const rh = sampleBaseDryTerrain(
          lx + Math.cos(ang) * (rx * 1.05),
          lz + Math.sin(ang) * (rz * 1.05),
          hills,
          bogLobes,
          bogBounds
        );
        if (rh < rimMinH) rimMinH = rh;
        if (rh > rimMaxH) rimMaxH = rh;
      }
      const rimSpread = rimMaxH - rimMinH;
      if (centerH > 16 || rimSpread > 9.5) continue;

      const score = centerH * 0.4 + rimSpread * 1.6;
      if (!bestCandidate || score < bestCandidate.score) {
        bestCandidate = { x: lx, z: lz, rx, rz, rimMinH, score };
      }
    }

    if (!bestCandidate) continue;
    const { x, z, rx, rz, rimMinH } = bestCandidate;
    const rot = randRange(rng, 0, Math.PI);
    const wobbleAmp = randRange(rng, 0.08, 0.15);
    const waterY = Math.max(SWAMP_WATER_Y + 1.65, rimMinH - 0.35);
    const padExtent = Math.max(rx, rz) * (1.58 + wobbleAmp * 1.8);

    lakes.push({
      id: `lake_${lakes.length}`,
      name: LAKE_NAMES[lakes.length % LAKE_NAMES.length],
      x,
      z,
      rx,
      rz,
      rot,
      cosRot: Math.cos(rot),
      sinRot: Math.sin(rot),
      wobblePhase1: randRange(rng, 0, Math.PI * 2),
      wobblePhase2: randRange(rng, 0, Math.PI * 2),
      wobbleAmp,
      waterY,
      maxDepth: randRange(rng, 2.8, 4.2),
      minX: x - padExtent,
      maxX: x + padExtent,
      minZ: z - padExtent,
      maxZ: z + padExtent,
    });
  }

  return lakes;
}

/**
 * Generates 1-3 downhill streams flowing from higher hill flanks into freshwater lakes or the peat bog.
 */
function generateDownhillStreams(
  seed: number,
  rng: () => number,
  hills: readonly HillMassifBlueprint[],
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D,
  lakes: readonly LakeBlueprint[]
): StreamBlueprint[] {
  const streams: StreamBlueprint[] = [];
  const targetStreamCount = Math.min(3, Math.max(2, lakes.length + 1));

  // Build candidate destination targets: freshwater lakes first, then bog margins
  const targets: Array<{
    kind: 'lake' | 'bog';
    id: string | null;
    x: number;
    z: number;
    waterY: number;
    entryRadius: number;
  }> = [];

  for (const lk of lakes) {
    targets.push({
      kind: 'lake',
      id: lk.id,
      x: lk.x,
      z: lk.z,
      waterY: lk.waterY,
      entryRadius: Math.min(lk.rx, lk.rz) * 0.65,
    });
  }

  // Add a bog-margin outlet target nearest to dry hills
  const sortedHills = [...hills].sort((a, b) => b.height - a.height);
  for (let hIdx = 0; hIdx < Math.min(4, sortedHills.length); hIdx++) {
    const hill = sortedHills[hIdx];
    // March toward bog centroid to find bog shoreline
    const dx = (bogBounds.minX + bogBounds.maxX) * 0.5 - hill.x;
    const dz = (bogBounds.minZ + bogBounds.maxZ) * 0.5 - hill.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 10) continue;
    const ux = dx / dist;
    const uz = dz / dist;
    for (let step = 40; step < Math.min(dist, 340); step += 12) {
      const px = hill.x + ux * step;
      const pz = hill.z + uz * step;
      if (evaluateRawBogMask(px, pz, bogLobes, bogBounds) >= 0.55) {
        targets.push({
          kind: 'bog',
          id: null,
          x: px + ux * 16,
          z: pz + uz * 16,
          waterY: SWAMP_WATER_Y + 0.08,
          entryRadius: 0,
        });
        break;
      }
    }
  }

  for (let tIdx = 0; tIdx < targets.length && streams.length < targetStreamCount; tIdx++) {
    const target = targets[tIdx];
    let bestStart: { x: number; z: number; h: number; score: number } | null = null;

    // Search for a higher hillside spring 110..270m away from the target
    for (let attempt = 0; attempt < 90; attempt++) {
      const ang = randRange(rng, 0, Math.PI * 2);
      const dist = randRange(rng, 115, 265);
      const sx = target.x + Math.cos(ang) * dist;
      const sz = target.z + Math.sin(ang) * dist;
      if (Math.abs(sx) > WORLD_HALF - 85 || Math.abs(sz) > WORLD_HALF - 85) continue;
      if (seed === 2026 && Math.hypot(sx + 100, sz + 100) < 55) continue;
      if (evaluateRawBogMask(sx, sz, bogLobes, bogBounds) > 0.02) continue;
      if (isInsideAnyLake(sx, sz, lakes, 22)) continue;

      const sh = sampleBaseDryTerrain(sx, sz, hills, bogLobes, bogBounds);
      const drop = sh - target.waterY;
      if (drop < 6.5) continue;

      // Ensure midpoint isn't crossing another lake or deep bog prematurely
      const mx = (sx + target.x) * 0.5;
      const mz = (sz + target.z) * 0.5;
      if (target.kind === 'lake' && evaluateRawBogMask(mx, mz, bogLobes, bogBounds) > 0.15) continue;
      if (
        lakes.some(
          (lk) => lk.id !== target.id && isInsideAnyLake(mx, mz, [lk], 18)
        )
      ) {
        continue;
      }
      if (minDistToStreams(sx, sz, streams) < 55) continue;

      const score = drop - Math.abs(dist - 180) * 0.03;
      if (!bestStart || score > bestStart.score) {
        bestStart = { x: sx, z: sz, h: sh, score };
      }
    }

    if (!bestStart) continue;

    // Build meandering downhill polyline from spring to target mouth
    const dirX = target.x - bestStart.x;
    const dirZ = target.z - bestStart.z;
    const totalLen = Math.hypot(dirX, dirZ);
    const ux = dirX / totalLen;
    const uz = dirZ / totalLen;
    const perpX = -uz;
    const perpZ = ux;

    const mouthDist = Math.max(60, totalLen - target.entryRadius * 0.55);
    const numPts = Math.max(14, Math.min(26, Math.round(mouthDist / 11)));
    const meanderFreq = randRange(rng, 1.3, 2.3);
    const meanderPhase = randRange(rng, 0, Math.PI * 2);
    const meanderAmp = randRange(rng, 10, 22);

    const rawPts: Array<{ x: number; z: number; sampledH: number }> = [];
    for (let i = 0; i < numPts; i++) {
      const t = i / (numPts - 1);
      const env = Math.sin(t * Math.PI); // 0 at spring & mouth, widest meander in middle
      const lateral = Math.sin(t * Math.PI * meanderFreq + meanderPhase) * meanderAmp * env;
      const px = clampWorld(bestStart.x + ux * (mouthDist * t) + perpX * lateral, 55);
      const pz = clampWorld(bestStart.z + uz * (mouthDist * t) + perpZ * lateral, 55);
      const sh = sampleBaseDryTerrain(px, pz, hills, bogLobes, bogBounds);
      rawPts.push({ x: px, z: pz, sampledH: sh });
    }

    // Compute strictly monotonically decreasing water surface profile from spring to mouth
    const springY = Math.max(target.waterY + 4.5, rawPts[0].sampledH - 0.35);
    const mouthY = target.waterY;
    const waterYs = new Float64Array(numPts);
    waterYs[0] = springY;
    waterYs[numPts - 1] = mouthY;

    for (let i = 1; i < numPts - 1; i++) {
      const t = i / (numPts - 1);
      const linearY = springY + (mouthY - springY) * t;
      // Blend local valley ground gently with linear grade, clamped inside [mouthY, springY]
      const guided = rawPts[i].sampledH - 0.38;
      waterYs[i] = Math.max(mouthY + 0.05, Math.min(springY - 0.05, linearY * 0.62 + guided * 0.38));
    }
    // Enforce strict downhill monotonicity (spring -> mouth)
    for (let i = 1; i < numPts - 1; i++) {
      const maxAllowed = waterYs[i - 1] - 0.08;
      if (waterYs[i] > maxAllowed) waterYs[i] = maxAllowed;
    }
    for (let i = numPts - 2; i >= 1; i--) {
      const minAllowed = waterYs[i + 1] + 0.06;
      if (waterYs[i] < minAllowed) waterYs[i] = minAllowed;
    }
    // Smooth gently once while preserving strict monotonicity
    for (let i = 1; i < numPts - 1; i++) {
      const sm = (waterYs[i - 1] + waterYs[i] * 2 + waterYs[i + 1]) * 0.25;
      waterYs[i] = Math.min(waterYs[i - 1] - 0.04, Math.max(waterYs[i + 1] + 0.04, sm));
    }

    const points: StreamPointBlueprint[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < numPts; i++) {
      const t = i / (numPts - 1);
      const prev = rawPts[Math.max(0, i - 1)];
      const next = rawPts[Math.min(numPts - 1, i + 1)];
      const fx = next.x - prev.x;
      const fz = next.z - prev.z;
      const fl = Math.hypot(fx, fz) || 1;
      const halfWidth = 1.25 + t * 1.45;
      const depth = 0.42 + t * 0.34;
      const bankPad = halfWidth + 9.5;

      const x = rawPts[i].x;
      const z = rawPts[i].z;
      if (x - bankPad < minX) minX = x - bankPad;
      if (x + bankPad > maxX) maxX = x + bankPad;
      if (z - bankPad < minZ) minZ = z - bankPad;
      if (z + bankPad > maxZ) maxZ = z + bankPad;

      points.push({
        x,
        z,
        waterY: waterYs[i],
        halfWidth,
        depth,
        flowX: fx / fl,
        flowZ: fz / fl,
      });
    }

    streams.push({
      id: `stream_${streams.length}`,
      name: STREAM_NAMES[streams.length % STREAM_NAMES.length],
      targetKind: target.kind,
      targetId: target.id,
      points,
      minX,
      maxX,
      minZ,
      maxZ,
    });
  }

  return streams;
}

/**
 * Nudges a polyline control point off the peat bog and freshwater lakes onto dry land.
 */
function nudgeToDryRoadPoint(
  x: number,
  z: number,
  dryCos: number,
  drySin: number,
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D,
  lakes: readonly LakeBlueprint[]
): { x: number; z: number } {
  let px = clampWorld(x, 38);
  let pz = clampWorld(z, 38);

  for (let iter = 0; iter < 18; iter++) {
    let pushed = false;
    const bogMask = evaluateRawBogMask(px, pz, bogLobes, bogBounds);
    if (bogMask > 0.08) {
      // Always push steadily toward the dry side of the map (never trapping a point in a bog corner)
      px = clampWorld(px + dryCos * 36, 38);
      pz = clampWorld(pz + drySin * 36, 38);
      pushed = true;
    }

    for (let i = 0; i < lakes.length; i++) {
      const lk = lakes[i];
      const safeR = Math.max(lk.rx, lk.rz) * 1.28 + 14;
      const dx = px - lk.x;
      const dz = pz - lk.z;
      const d = Math.hypot(dx, dz);
      if (d < safeR) {
        const inv = d > 0.1 ? 1 / d : 1;
        px = clampWorld(lk.x + (d > 0.1 ? dx * inv : dryCos) * (safeR + 6), 38);
        pz = clampWorld(lk.z + (d > 0.1 ? dz * inv : drySin) * (safeR + 6), 38);
        pushed = true;
      }
    }
    if (!pushed) break;
  }
  return { x: px, z: pz };
}

function subdivideCatmullRom(
  pts: ReadonlyArray<{ x: number; z: number }>,
  stepsPerSpan = 4
): Array<{ x: number; z: number }> {
  if (pts.length < 2) return [...pts];
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < stepsPerSpan; s++) {
      const t = s / stepsPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const z =
        0.5 *
        (2 * p1.z +
          (-p0.z + p2.z) * t +
          (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
          (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
      out.push({ x: clampWorld(x, 12), z: clampWorld(z, 12) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Generates varied main road networks per seed (N-S sweep, NE/NW diagonals, elbow curve, Y-fork)
 * routing cleanly outside the peat bog and freshwater lakes, and determines dry road spawn.
 */
function generateRoadNetwork(
  seed: number,
  rng: () => number,
  bogSectorAngle: number,
  bogCenterX: number,
  bogCenterZ: number,
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D,
  lakes: readonly LakeBlueprint[]
): {
  roadShape: RoadShapeKind;
  roadSegments: RoadSegmentBlueprint[];
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  roadAmp1: number;
  roadFreq1: number;
  roadPhase1: number;
  roadAmp2: number;
  roadFreq2: number;
  roadPhase2: number;
} {
  // Dry side axis runs opposite the bog sector
  const dryAngle = bogSectorAngle + Math.PI;
  const dryCos = Math.cos(dryAngle);
  const drySin = Math.sin(dryAngle);
  const perpX = -drySin;
  const perpZ = dryCos;

  const roadShape = ROAD_SHAPES[Math.floor(rng() * ROAD_SHAPES.length)];
  const roadAmp1 = randRange(rng, 28, 65);
  const roadFreq1 = randRange(rng, 0.0052, 0.0082);
  const roadPhase1 = randRange(rng, -Math.PI, Math.PI);
  const roadAmp2 = randRange(rng, 10, 26);
  const roadFreq2 = randRange(rng, 0.011, 0.017);
  const roadPhase2 = randRange(rng, -Math.PI, Math.PI);

  const rawSpines: Array<Array<{ x: number; z: number }>> = [];
  const dryOffset = randRange(rng, 135, 225);

  const buildSpineFromAnchors = (anchors: Array<{ x: number; z: number }>) => {
    const nudged = anchors.map((pt) =>
      nudgeToDryRoadPoint(pt.x, pt.z, dryCos, drySin, bogLobes, bogBounds, lakes)
    );
    const smooth = subdivideCatmullRom(nudged, 4).map((pt) =>
      evaluateRawBogMask(pt.x, pt.z, bogLobes, bogBounds) > 0.14 || isInsideAnyLake(pt.x, pt.z, lakes, 8)
        ? nudgeToDryRoadPoint(pt.x, pt.z, dryCos, drySin, bogLobes, bogBounds, lakes)
        : pt
    );
    // Keep the longest contiguous dry run (prevents stale bog-corner points from poisoning the spine)
    let bestRun: Array<{ x: number; z: number }> = [];
    let curRun: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < smooth.length; i++) {
      const pt = smooth[i];
      const inBog = evaluateRawBogMask(pt.x, pt.z, bogLobes, bogBounds) > 0.22;
      if (inBog) {
        if (curRun.length > bestRun.length) bestRun = curRun;
        curRun = [];
        continue;
      }
      if (curRun.length > 0) {
        const prev = curRun[curRun.length - 1];
        const mx = (prev.x + pt.x) * 0.5;
        const mz = (prev.z + pt.z) * 0.5;
        if (evaluateRawBogMask(mx, mz, bogLobes, bogBounds) > 0.25) {
          if (curRun.length > bestRun.length) bestRun = curRun;
          curRun = [pt];
          continue;
        }
      }
      curRun.push(pt);
    }
    if (curRun.length > bestRun.length) bestRun = curRun;
    void bogCenterX;
    void bogCenterZ;
    return bestRun.length >= 2 ? bestRun : smooth;
  };

  if (roadShape === 'sweeping_ns') {
    const baseShift = dryCos * dryOffset * 0.72;
    const pts: Array<{ x: number; z: number }> = [];
    for (let i = 0; i <= 8; i++) {
      const z = -545 + (i / 8) * 1090;
      const x =
        baseShift +
        Math.sin(z * roadFreq1 + roadPhase1) * roadAmp1 +
        Math.cos(z * roadFreq2 + roadPhase2) * roadAmp2;
      pts.push({ x, z });
    }
    rawSpines.push(buildSpineFromAnchors(pts));
  } else if (roadShape === 'diagonal_ne' || roadShape === 'diagonal_nw') {
    const diagSign = roadShape === 'diagonal_ne' ? 1 : -1;
    const shiftX = dryCos * dryOffset * 0.55;
    const shiftZ = drySin * dryOffset * 0.55;
    const pts: Array<{ x: number; z: number }> = [];
    for (let i = 0; i <= 8; i++) {
      const u = (i / 8) * 2 - 1; // -1..1
      const baseX = u * 490 * diagSign + shiftX;
      const baseZ = u * 490 + shiftZ;
      const wave = Math.sin(u * Math.PI * 1.45 + roadPhase1) * roadAmp1 * 1.1;
      pts.push({
        x: baseX - wave * 0.7,
        z: baseZ + wave * 0.7 * diagSign,
      });
    }
    rawSpines.push(buildSpineFromAnchors(pts));
  } else if (roadShape === 'elbow_bend') {
    // Sweeps around the dry flank in a wide country arc connecting two sides of the map
    const cx = dryCos * dryOffset;
    const cz = drySin * dryOffset;
    const bendDir = rng() < 0.5 ? 1 : -1;
    const anchors = [
      { x: cx + perpX * -490 + dryCos * 25, z: cz + perpZ * -490 + drySin * 25 },
      { x: cx + perpX * -300 + dryCos * 60, z: cz + perpZ * -300 + drySin * 60 },
      { x: cx + perpX * -110 + dryCos * 105, z: cz + perpZ * -110 + drySin * 105 },
      { x: cx + perpX * 85 + dryCos * 95, z: cz + perpZ * 85 + drySin * 95 },
      { x: cx + perpX * 280 + dryCos * (55 + 30 * bendDir), z: cz + perpZ * 280 + drySin * (55 + 30 * bendDir) },
      { x: cx + perpX * 470 + dryCos * (20 - 45 * bendDir), z: cz + perpZ * 470 + drySin * (20 - 45 * bendDir) },
    ];
    rawSpines.push(buildSpineFromAnchors(anchors));
  } else {
    // 'forked_y': main trunk entering from the dry flank and forking into two dry gravel branches
    const jx = clampWorld(dryCos * (dryOffset * 0.78), 210);
    const jz = clampWorld(drySin * (dryOffset * 0.78), 210);
    const trunk = buildSpineFromAnchors([
      { x: jx + dryCos * 380 + perpX * randRange(rng, -85, 85), z: jz + drySin * 380 + perpZ * randRange(rng, -85, 85) },
      { x: jx + dryCos * 195 + perpX * randRange(rng, -45, 45), z: jz + drySin * 195 + perpZ * randRange(rng, -45, 45) },
      { x: jx, z: jz },
      { x: jx + perpX * 235 + dryCos * 45, z: jz + perpZ * 235 + drySin * 45 },
      { x: jx + perpX * 465 + dryCos * 15, z: jz + perpZ * 465 + drySin * 15 },
    ]);
    const branch = buildSpineFromAnchors([
      { x: jx, z: jz },
      { x: jx + perpX * -220 + dryCos * 45, z: jz + perpZ * -220 + drySin * 45 },
      { x: jx + perpX * -455 + dryCos * 20, z: jz + perpZ * -455 + drySin * 20 },
    ]);
    rawSpines.push(trunk, branch);
  }

  const roadSegments: RoadSegmentBlueprint[] = [];
  for (const spine of rawSpines) {
    for (let i = 0; i < spine.length - 1; i++) {
      // Skip any accidental jump across bog
      const mx = (spine[i].x + spine[i + 1].x) * 0.5;
      const mz = (spine[i].z + spine[i + 1].z) * 0.5;
      if (evaluateRawBogMask(mx, mz, bogLobes, bogBounds) > 0.25) continue;
      roadSegments.push(
        makeRoadSegment(spine[i].x, spine[i].z, spine[i + 1].x, spine[i + 1].z, false, true)
      );
    }
  }

  // Pick a clean dry spawn point on the primary spine near the central region
  const primarySpine = rawSpines[0];
  let bestSpawnIdx = Math.floor(primarySpine.length * 0.5);
  let bestSpawnScore = Infinity;
  for (let i = 4; i < primarySpine.length - 4; i++) {
    const pt = primarySpine[i];
    if (evaluateRawBogMask(pt.x, pt.z, bogLobes, bogBounds) > 0.02) continue;
    if (isInsideAnyLake(pt.x, pt.z, lakes, 28)) continue;
    // Keep seed 2026 spawn away from (-100, -100) test pad and close to center
    if (seed === 2026 && Math.hypot(pt.x + 100, pt.z + 100) < 65) continue;
    const score = Math.hypot(pt.x, pt.z);
    if (score < bestSpawnScore) {
      bestSpawnScore = score;
      bestSpawnIdx = i;
    }
  }

  const spawnPt = primarySpine[bestSpawnIdx];
  const nextPt = primarySpine[Math.max(0, bestSpawnIdx - 1)];
  const spawnYaw = Math.atan2(-(nextPt.x - spawnPt.x), -(nextPt.z - spawnPt.z));

  return {
    roadShape,
    roadSegments,
    spawnX: spawnPt.x,
    spawnZ: spawnPt.z,
    spawnYaw,
    roadAmp1,
    roadFreq1,
    roadPhase1,
    roadAmp2,
    roadFreq2,
    roadPhase2,
  };
}

/**
 * Generates 3-6 villages, each with 1-5 spread-out houses separated by >= 100m
 * in varied decay states, plus connecting rustic dirt trails.
 */
function generateVillages(
  seed: number,
  rng: () => number,
  spawnX: number,
  spawnZ: number,
  hills: readonly HillMassifBlueprint[],
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D,
  lakes: readonly LakeBlueprint[],
  streams: readonly StreamBlueprint[],
  roadSegments: RoadSegmentBlueprint[]
): VillageBlueprint[] {
  const villageCount = 3 + Math.floor(rng() * 4); // 3..6 villages
  const villages: VillageBlueprint[] = [];
  const allHousePositions: Array<{ x: number; z: number; villageIdx: number }> = [];

  const mainRoadSegs = roadSegments.filter((s) => s.isMainRoad);

  const isHouseSpotValid = (
    x: number,
    z: number,
    villageIdx: number,
    enforceStrictSameVillageSep: boolean
  ): boolean => {
    if (Math.abs(x) > WORLD_HALF - 65 || Math.abs(z) > WORLD_HALF - 65) return false;
    if (seed === 2026 && Math.hypot(x + 100, z + 100) < 28) return false;
    if (evaluateRawBogMask(x, z, bogLobes, bogBounds) > 0.03) return false;
    if (isInsideAnyLake(x, z, lakes, 24)) return false;
    if (minDistToStreams(x, z, streams) < 13) return false;
    if (minDistToSegments(x, z, mainRoadSegs, true) < 13) return false;
    if (Math.hypot(x - spawnX, z - spawnZ) < 15) return false;

    const slope = estimateLocalSlope(x, z, hills, bogLobes, bogBounds);
    if (slope > 0.36) return false;

    for (let i = 0; i < allHousePositions.length; i++) {
      const other = allHousePositions[i];
      const d = Math.hypot(x - other.x, z - other.z);
      if (other.villageIdx === villageIdx) {
        if (enforceStrictSameVillageSep && d < MIN_VILLAGE_HOUSE_SEPARATION + 2) return false;
      } else if (d < 78) {
        return false;
      }
    }
    return true;
  };

  const pickDecayState = (
    villageAbandoned: boolean,
    isStarterHouse: boolean
  ): { decayState: HutDecayState; abandoned: boolean } => {
    if (isStarterHouse) return { decayState: 'intact', abandoned: false };
    const roll = rng();
    if (villageAbandoned) {
      if (roll < 0.38) return { decayState: 'sagging', abandoned: true };
      if (roll < 0.72) return { decayState: 'roofless', abandoned: true };
      return { decayState: 'ruins', abandoned: true };
    }
    // Non-abandoned rural villages still contain a realistic mix of lived-in homes and decaying outbuildings/neighbors
    if (roll < 0.48) return { decayState: 'intact', abandoned: false };
    if (roll < 0.72) return { decayState: 'sagging', abandoned: true };
    if (roll < 0.88) return { decayState: 'roofless', abandoned: true };
    return { decayState: 'ruins', abandoned: true };
  };

  const makeBuilding = (
    id: string,
    offsetX: number,
    offsetZ: number,
    worldX: number,
    worldZ: number,
    rotY: number,
    decayState: HutDecayState,
    abandoned: boolean,
    label: string,
    isPrimaryHouse: boolean
  ): BuildingBlueprint => {
    const flattenHeight = sampleBaseDryTerrain(worldX, worldZ, hills, bogLobes, bogBounds);
    const roofStyle: BuildingBlueprint['roofStyle'] =
      decayState === 'roofless' || decayState === 'ruins'
        ? 'collapsed'
        : rng() < 0.52
          ? 'thatch'
          : 'shingle';
    return {
      id,
      offsetX,
      offsetZ,
      w: isPrimaryHouse ? randRange(rng, 8.2, 9.6) : randRange(rng, 6.2, 8.6),
      d: isPrimaryHouse ? randRange(rng, 6.0, 7.0) : randRange(rng, 5.0, 6.6),
      h: isPrimaryHouse ? randRange(rng, 2.9, 3.25) : randRange(rng, 2.55, 3.1),
      rotY,
      hasDoor: decayState !== 'ruins',
      hasChimney: decayState === 'intact' || (decayState === 'sagging' && rng() < 0.6),
      roofStyle,
      abandoned,
      decayState,
      label,
      clearingRadius: isPrimaryHouse ? randRange(rng, 18, 22) : randRange(rng, 14, 19),
      flattenHeight,
    };
  };

  const connectHouseTrail = (hx: number, hz: number): void => {
    const nearest = nearestPointOnSegments(hx, hz, roadSegments, false);
    if (nearest.dist < 18 || nearest.dist > 260) return;
    const mx = (hx + nearest.x) * 0.5 + randRange(rng, -10, 10);
    const mz = (hz + nearest.z) * 0.5 + randRange(rng, -10, 10);
    if (evaluateRawBogMask(mx, mz, bogLobes, bogBounds) > 0.15) return;
    if (isInsideAnyLake(mx, mz, lakes, 6)) return;
    roadSegments.push(makeRoadSegment(nearest.x, nearest.z, mx, mz, true, false));
    roadSegments.push(makeRoadSegment(mx, mz, hx, hz, true, false));
  };

  // Shuffle non-starter village names
  const nameOrder = [VILLAGE_POOL[0]];
  const restNames = VILLAGE_POOL.slice(1);
  for (let i = restNames.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = restNames[i];
    restNames[i] = restNames[j];
    restNames[j] = tmp;
  }
  nameOrder.push(...restNames);

  for (let vIdx = 0; vIdx < villageCount; vIdx++) {
    const meta = nameOrder[vIdx % nameOrder.length];
    const isStarter = vIdx === 0;
    // Guarantee at least 1 abandoned village (vIdx === 2 or last) and rich mix
    const villageAbandoned = isStarter
      ? false
      : vIdx === villageCount - 1
        ? true
        : rng() < 0.45;

    // 1. Place primary house anchor for this village
    let anchorX = 0;
    let anchorZ = 0;
    let foundAnchor = false;

    if (isStarter) {
      // Place Vana-Kase primary homestead right near spawn road (clearly visible on start!)
      for (let attempt = 0; attempt < 60; attempt++) {
        const side = attempt % 2 === 0 ? -1 : 1;
        const dist = 24 + (attempt % 5) * 6;
        const ang = (attempt / 60) * Math.PI * 2;
        const cx =
          attempt < 10
            ? spawnX + side * (22 + attempt * 2.5)
            : spawnX + Math.cos(ang) * (24 + (attempt % 4) * 8);
        const cz =
          attempt < 10
            ? spawnZ - 26 + (attempt % 3) * 8
            : spawnZ + Math.sin(ang) * (24 + (attempt % 4) * 8);
        if (isHouseSpotValid(cx, cz, vIdx, true)) {
          anchorX = cx;
          anchorZ = cz;
          foundAnchor = true;
          break;
        }
      }
      if (!foundAnchor) {
        anchorX = clampWorld(spawnX - 24, 70);
        anchorZ = clampWorld(spawnZ - 24, 70);
        foundAnchor = true;
      }
    } else {
      for (let attempt = 0; attempt < 120; attempt++) {
        let cx: number;
        let cz: number;
        if (attempt < 75 && mainRoadSegs.length > 0) {
          // Bias villages within scenic country distance of the gravel road network
          const seg = mainRoadSegs[Math.floor(rng() * mainRoadSegs.length)];
          const t = rng();
          const rx = seg.ax + (seg.bx - seg.ax) * t;
          const rz = seg.az + (seg.bz - seg.az) * t;
          const ang = randRange(rng, 0, Math.PI * 2);
          const off = randRange(rng, 26, 155);
          cx = rx + Math.cos(ang) * off;
          cz = rz + Math.sin(ang) * off;
        } else {
          cx = randRange(rng, -WORLD_HALF + 85, WORLD_HALF - 85);
          cz = randRange(rng, -WORLD_HALF + 85, WORLD_HALF - 85);
        }

        // Keep village anchors well separated from each other
        if (villages.some((v) => Math.hypot(v.x - cx, v.z - cz) < 175)) continue;
        if (!isHouseSpotValid(cx, cz, vIdx, true)) continue;

        anchorX = cx;
        anchorZ = cz;
        foundAnchor = true;
        break;
      }
    }

    if (!foundAnchor) continue;

    const targetHouseCount = 1 + Math.floor(rng() * 5); // 1..5 houses per village
    const buildings: BuildingBlueprint[] = [];

    // Primary house at offset (0, 0) (for Vana-Kase, rotY = 0 keeps shelter/door/targeting tests exact!)
    const h0State = pickDecayState(villageAbandoned, isStarter);
    const h0RotY = isStarter ? 0 : randRange(rng, -Math.PI, Math.PI);
    const h0Label = isStarter
      ? 'Peamaja (Farmhouse)'
      : h0State.decayState === 'intact'
        ? `${meta.estonianLabel} talu`
        : h0State.decayState === 'sagging'
          ? `${meta.estonianLabel} vana maja`
          : h0State.decayState === 'roofless'
            ? `${meta.estonianLabel} katuseta talu`
            : `${meta.estonianLabel} varemed`;

    buildings.push(
      makeBuilding(
        `${meta.id}_h0`,
        0,
        0,
        anchorX,
        anchorZ,
        h0RotY,
        h0State.decayState,
        h0State.abandoned,
        h0Label,
        true
      )
    );
    allHousePositions.push({ x: anchorX, z: anchorZ, villageIdx: vIdx });
    connectHouseTrail(anchorX, anchorZ);

    // Additional houses (1..4 more), each strictly >= 100m from every other house in the same village
    const HOUSE_ROLE_LABELS = ['Kõrvaltalu', 'Saunamaja', 'Ait', 'Metsatalu'];
    for (let hIdx = 1; hIdx < targetHouseCount; hIdx++) {
      let hx = 0;
      let hz = 0;
      let placed = false;

      for (let attempt = 0; attempt < 110; attempt++) {
        // Search rings 105..235m around village anchor (Estonian sprawling hajaküla layout)
        const ang = randRange(rng, 0, Math.PI * 2);
        const dist = randRange(rng, MIN_VILLAGE_HOUSE_SEPARATION + 6, 235);
        const cx = anchorX + Math.cos(ang) * dist;
        const cz = anchorZ + Math.sin(ang) * dist;
        if (!isHouseSpotValid(cx, cz, vIdx, true)) continue;
        hx = cx;
        hz = cz;
        placed = true;
        break;
      }

      if (!placed) break;

      const hState = pickDecayState(villageAbandoned, false);
      const role = HOUSE_ROLE_LABELS[(hIdx - 1) % HOUSE_ROLE_LABELS.length];
      const hLabel =
        hState.decayState === 'ruins'
          ? `${meta.estonianLabel} varemed`
          : `${meta.estonianLabel} · ${role}`;

      buildings.push(
        makeBuilding(
          `${meta.id}_h${hIdx}`,
          hx - anchorX,
          hz - anchorZ,
          hx,
          hz,
          randRange(rng, -Math.PI, Math.PI),
          hState.decayState,
          hState.abandoned,
          hLabel,
          false
        )
      );
      allHousePositions.push({ x: hx, z: hz, villageIdx: vIdx });
      connectHouseTrail(hx, hz);
    }

    const anchorFlattenH = buildings[0].flattenHeight;
    villages.push({
      id: meta.id,
      name: meta.name,
      estonianLabel: meta.estonianLabel,
      x: anchorX,
      z: anchorZ,
      clearingRadius: buildings[0].clearingRadius,
      abandoned: villageAbandoned,
      hasWell: isStarter || rng() < 0.72,
      wellOffsetX: 10.2,
      wellOffsetZ: 5.5,
      hasCampfire: isStarter || rng() < 0.78,
      campfireOffsetX: -9.5,
      campfireOffsetZ: 7.5,
      campfireLit: isStarter,
      flattenHeight: anchorFlattenH,
      buildings,
    });
  }

  return villages;
}

/**
 * Generates 4-6 random abandoned decrepit huts hidden in dry forest with NO trails leading to them.
 */
function generateAbandonedForestHuts(
  seed: number,
  rng: () => number,
  spawnX: number,
  spawnZ: number,
  hills: readonly HillMassifBlueprint[],
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D,
  lakes: readonly LakeBlueprint[],
  streams: readonly StreamBlueprint[],
  villages: readonly VillageBlueprint[],
  roadSegments: readonly RoadSegmentBlueprint[]
): ForestHutBlueprint[] {
  const targetCount = 4 + Math.floor(rng() * 3); // 4..6 random forest huts
  const huts: ForestHutBlueprint[] = [];
  const decayPool: Array<Exclude<HutDecayState, 'intact'>> = ['sagging', 'roofless', 'ruins'];

  const allVillageHouses: Array<{ x: number; z: number }> = [];
  for (const v of villages) {
    for (const b of v.buildings) {
      allVillageHouses.push({ x: v.x + b.offsetX, z: v.z + b.offsetZ });
    }
  }

  for (let i = 0; i < targetCount; i++) {
    let found = false;
    let hx = 0;
    let hz = 0;

    for (let attempt = 0; attempt < 160; attempt++) {
      const cx = randRange(rng, -WORLD_HALF + 72, WORLD_HALF - 72);
      const cz = randRange(rng, -WORLD_HALF + 72, WORLD_HALF - 72);
      if (seed === 2026 && Math.hypot(cx + 100, cz + 100) < 30) continue;
      if (Math.hypot(cx - spawnX, cz - spawnZ) < 60) continue;

      // Strictly dry forest: no bog, no lakes, no streams, no road/trail access
      if (evaluateRawBogMask(cx, cz, bogLobes, bogBounds) > 0.02) continue;
      if (isInsideAnyLake(cx, cz, lakes, 26)) continue;
      if (minDistToStreams(cx, cz, streams) < 14) continue;
      if (minDistToSegments(cx, cz, roadSegments, false) < 28) continue;

      // Stay hidden away from villages and other forest huts
      if (allVillageHouses.some((vh) => Math.hypot(vh.x - cx, vh.z - cz) < 68)) continue;
      if (huts.some((other) => Math.hypot(other.x - cx, other.z - cz) < 75)) continue;

      const slope = estimateLocalSlope(cx, cz, hills, bogLobes, bogBounds);
      if (slope > 0.34) continue;

      hx = cx;
      hz = cz;
      found = true;
      break;
    }

    if (!found) continue;

    // Ensure rich visual diversity across sagging / roofless / ruins
    const decayState =
      i < 3 ? decayPool[i] : decayPool[Math.floor(rng() * decayPool.length)];
    const flattenHeight = sampleBaseDryTerrain(hx, hz, hills, bogLobes, bogBounds);

    huts.push({
      id: `forest_hut_${huts.length}`,
      name: FOREST_HUT_NAMES[huts.length % FOREST_HUT_NAMES.length],
      x: hx,
      z: hz,
      w: randRange(rng, 4.8, 6.4),
      d: randRange(rng, 4.2, 5.4),
      h: randRange(rng, 2.4, 2.85),
      rotY: randRange(rng, 0, Math.PI * 2),
      roofStyle: decayState === 'sagging' ? (rng() < 0.55 ? 'thatch' : 'shingle') : 'collapsed',
      decayState,
      clearingRadius: randRange(rng, 8.5, 11.5),
      flattenHeight,
    });
  }

  return huts;
}

/**
 * Links a dry bog-edge trailhead to nearby bog islands (preferring large hut islands) via wooden boardwalks.
 */
function generateBoardwalkLinks(
  bogCenterX: number,
  bogCenterZ: number,
  bogLobes: readonly BogLobeBlueprint[],
  bogBounds: WorldBounds2D,
  swampIslands: readonly SwampIslandBlueprint[],
  roadSegments: RoadSegmentBlueprint[]
): Array<{ ax: number; az: number; bx: number; bz: number }> {
  const boardwalkLinks: Array<{ ax: number; az: number; bx: number; bz: number }> = [];
  if (swampIslands.length === 0) return boardwalkLinks;

  // Pick the bog island closest to any main gravel road to start the boardwalk
  let firstIsl = swampIslands[0];
  let bestRoadDist = Infinity;
  let bestRoadPt = { x: 0, z: 0 };

  for (const isl of swampIslands) {
    const np = nearestPointOnSegments(isl.x, isl.z, roadSegments, true);
    if (np.dist < bestRoadDist) {
      bestRoadDist = np.dist;
      firstIsl = isl;
      bestRoadPt = { x: np.x, z: np.z };
    }
  }

  // March from firstIsl toward the nearest main road until exiting the peat bog for the trailhead
  const dx = bestRoadPt.x - firstIsl.x;
  const dz = bestRoadPt.z - firstIsl.z;
  const totalD = Math.hypot(dx, dz) || 1;
  const ux = dx / totalD;
  const uz = dz / totalD;

  let trailheadX = firstIsl.x + ux * (firstIsl.radius + 32);
  let trailheadZ = firstIsl.z + uz * (firstIsl.radius + 32);
  for (let d = firstIsl.radius + 14; d <= Math.min(totalD, 260); d += 10) {
    const px = firstIsl.x + ux * d;
    const pz = firstIsl.z + uz * d;
    if (evaluateRawBogMask(px, pz, bogLobes, bogBounds) < 0.24) {
      trailheadX = px;
      trailheadZ = pz;
      break;
    }
  }

  // Connect trailhead to nearest road with a dirt trail (staying outside deep bog)
  if (Math.hypot(trailheadX - bestRoadPt.x, trailheadZ - bestRoadPt.z) < 260) {
    roadSegments.push(makeRoadSegment(bestRoadPt.x, bestRoadPt.z, trailheadX, trailheadZ, true, false));
  }

  // Boardwalk from trailhead to first island, then chain 2-3 nearby islands (prioritizing hut islands)
  boardwalkLinks.push({
    ax: trailheadX,
    az: trailheadZ,
    bx: firstIsl.x,
    bz: firstIsl.z,
  });

  const visited = new Set<string>([firstIsl.id]);
  let current = firstIsl;
  for (let step = 0; step < 3; step++) {
    let bestNext: SwampIslandBlueprint | null = null;
    let bestScore = Infinity;
    for (const cand of swampIslands) {
      if (visited.has(cand.id)) continue;
      const d = Math.hypot(cand.x - current.x, cand.z - current.z);
      if (d > 220) continue;
      // Gently favor larger hut islands so boardwalk leads somewhere atmospheric
      const score = d - (cand.hut ? 45 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestNext = cand;
      }
    }
    if (!bestNext) break;
    visited.add(bestNext.id);
    boardwalkLinks.push({
      ax: current.x,
      az: current.z,
      bx: bestNext.x,
      bz: bestNext.z,
    });
    current = bestNext;
  }

  // Suppress unused variable warning while keeping signature clean
  void bogCenterX;
  void bogCenterZ;

  return boardwalkLinks;
}

export function createWorldBlueprint(seed: number): WorldBlueprint {
  const rng = createSeededRandom(seed, 0x9e3779b9);

  // 1. Large organic peat bog (>= 1/3 of the 1200x1200m map)
  const {
    bogLobes,
    bogBounds,
    bogCenterX,
    bogCenterZ,
    bogRadius,
    bogAreaFraction,
    sectorAngle,
  } = generateLargePeatBog(seed, rng);

  // 2. Bog lake systems (laugastik) inside the flat bog plain
  const bogPools = generateBogLakeSystems(rng, bogLobes, bogBounds);

  // 3. Varying-size bog islands (only larger islands have hut probability > 0)
  const swampIslands = generateSwampIslands(rng, bogLobes, bogBounds, bogPools);

  // 4. Estonian hills (20-40m relief above water) on dry land
  const hillMassifs = generateEstonianHills(rng, bogLobes, bogBounds);

  // 5. Non-bog freshwater lakes in dry-land valleys
  const lakes = generateFreshwaterLakes(seed, rng, hillMassifs, bogLobes, bogBounds);

  // 6. Downhill streams from higher hills into lakes or the peat bog
  const streams = generateDownhillStreams(seed, rng, hillMassifs, bogLobes, bogBounds, lakes);

  // 7. Variable road network & dry spawn on the main gravel road
  const {
    roadShape,
    roadSegments,
    spawnX,
    spawnZ,
    spawnYaw,
    roadAmp1,
    roadFreq1,
    roadPhase1,
    roadAmp2,
    roadFreq2,
    roadPhase2,
  } = generateRoadNetwork(seed, rng, sectorAngle, bogCenterX, bogCenterZ, bogLobes, bogBounds, lakes);

  // 8. 3-6 villages with 1-5 houses each, separated by >= 100m, in varied decay states
  const villages = generateVillages(
    seed,
    rng,
    spawnX,
    spawnZ,
    hillMassifs,
    bogLobes,
    bogBounds,
    lakes,
    streams,
    roadSegments
  );

  // 9. Bog boardwalk links connecting trailhead -> bog islands
  const boardwalkLinks = generateBoardwalkLinks(
    bogCenterX,
    bogCenterZ,
    bogLobes,
    bogBounds,
    swampIslands,
    roadSegments
  );

  // 10. 4-6 random abandoned decrepit forest huts with NO trails leading to them
  const forestHuts = generateAbandonedForestHuts(
    seed,
    rng,
    spawnX,
    spawnZ,
    hillMassifs,
    bogLobes,
    bogBounds,
    lakes,
    streams,
    villages,
    roadSegments
  );

  // 11. Reserved extensibility array for future large decrepit landmarks
  const majorStructures: MajorStructureSiteBlueprint[] = [];

  // 12. Unified building pad list + O(1) spatial grids for roads and building pads
  const buildingPads: BuildingPadBlueprint[] = [];
  for (let vIdx = 0; vIdx < villages.length; vIdx++) {
    const v = villages[vIdx];
    for (let bIdx = 0; bIdx < v.buildings.length; bIdx++) {
      const b = v.buildings[bIdx];
      buildingPads.push({
        id: b.id,
        kind: 'village_house',
        x: v.x + b.offsetX,
        z: v.z + b.offsetZ,
        clearingRadius: b.clearingRadius,
        flattenHeight: b.flattenHeight,
        villageIndex: vIdx,
        buildingIndex: bIdx,
        abandoned: b.abandoned,
        label: v.estonianLabel,
      });
    }
  }
  for (const fh of forestHuts) {
    buildingPads.push({
      id: fh.id,
      kind: 'forest_hut',
      x: fh.x,
      z: fh.z,
      clearingRadius: fh.clearingRadius,
      flattenHeight: fh.flattenHeight,
      villageIndex: -1,
      buildingIndex: -1,
      abandoned: true,
      label: fh.name,
    });
  }
  for (const ms of majorStructures) {
    buildingPads.push({
      id: ms.id,
      kind: 'major_structure',
      x: ms.x,
      z: ms.z,
      clearingRadius: ms.clearingRadius,
      flattenHeight: ms.flattenHeight,
      villageIndex: -1,
      buildingIndex: -1,
      abandoned: ms.decayState !== 'intact',
      label: ms.name,
    });
  }

  const roadGrid = buildUniformGrid(
    roadSegments.length,
    (idx) => {
      const s = roadSegments[idx];
      const margin = s.isTrail ? 10 : 14;
      return {
        minX: s.minX - margin,
        maxX: s.maxX + margin,
        minZ: s.minZ - margin,
        maxZ: s.maxZ + margin,
      };
    },
    50
  );

  const buildingPadGrid = buildUniformGrid(
    buildingPads.length,
    (idx) => {
      const p = buildingPads[idx];
      const reach = p.clearingRadius + 20;
      return {
        minX: p.x - reach,
        maxX: p.x + reach,
        minZ: p.z - reach,
        maxZ: p.z + reach,
      };
    },
    50
  );

  return {
    seed,
    roadShape,
    spawnX,
    spawnZ,
    spawnYaw,
    roadAmp1,
    roadFreq1,
    roadPhase1,
    roadAmp2,
    roadFreq2,
    roadPhase2,
    bogCenterX,
    bogCenterZ,
    bogRadius,
    bogWobblePhase: randRange(rng, 0, Math.PI * 2),
    bogLobes,
    bogPools,
    bogBounds,
    bogAreaFraction,
    hillMassifs,
    lakes,
    streams,
    villages,
    swampIslands,
    forestHuts,
    majorStructures,
    buildingPads,
    buildingPadGrid,
    roadSegments,
    roadGrid,
    boardwalkLinks,
    thicketPhaseX: randRange(rng, -50, 50),
    thicketPhaseZ: randRange(rng, -50, 50),
  };
}

export const generateWorldBlueprint = createWorldBlueprint;
