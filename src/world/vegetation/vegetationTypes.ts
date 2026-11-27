import { createSeededRandom } from '../seededRandom';
import type { CircleCollider } from '../architectureAndProps';

export const seededRand = (seed: number) => createSeededRandom(seed, 0x85ebca6b);

export function hashChunkSeed(worldSeed: number, vcx: number, vcz: number): number {
  let h = Math.imul(worldSeed | 0, 73856093);
  h ^= Math.imul(vcx | 0, 19349663);
  h ^= Math.imul(vcz | 0, 83492791);
  return (h ^ (h >>> 13)) | 0;
}

export interface InstanceRecord {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  r: number;
  g: number;
  b: number;
}

export interface BakedSlab {
  count: number;
  matrices: Float32Array;
  colors: Float32Array;
  // Packed [cx, cy, cz, radius] per instance for exact per-instance frustum culling
  bounds: Float32Array;
}

export const EMPTY_SLAB: BakedSlab = {
  count: 0,
  matrices: new Float32Array(0),
  colors: new Float32Array(0),
  bounds: new Float32Array(0),
};

export interface SubCellBaked {
  cx: number;
  cy: number;
  cz: number;
  r: number;
  birch: BakedSlab;
  pine: BakedSlab;
  bogPine: BakedSlab;
  spruce: BakedSlab;
  loneSpruce: BakedSlab;
  sapling: BakedSlab;
  hazelBush: BakedSlab;
  juniperBush: BakedSlab;
  fern: BakedSlab;
  shrub: BakedSlab;
  mossHummock: BakedSlab;
  reed: BakedSlab;
  boulder: BakedSlab;
  boulderOutcrop: BakedSlab;
  deadfall: BakedSlab;
  totalInstances: number;
}

export interface DeadfallLogTarget {
  id: string;
  vcx: number;
  vcz: number;
  cellIdx: number;
  slabIdx: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  kicksRemaining: number;
  broken: boolean;
}

export interface ChunkBucketBaked {
  cells: SubCellBaked[];
  colliders: CircleCollider[];
  deadfallLogs: DeadfallLogTarget[];
}

export interface GrassTileBaked {
  slab: BakedSlab;
  shortSlab: BakedSlab;
  mossSlab: BakedSlab;
  tallSlab: BakedSlab;
  cx: number;
  cy: number;
  cz: number;
  r: number;
}

export const EMPTY_GRASS_TILE: GrassTileBaked = {
  slab: EMPTY_SLAB,
  shortSlab: EMPTY_SLAB,
  mossSlab: EMPTY_SLAB,
  tallSlab: EMPTY_SLAB,
  cx: 0,
  cy: 0,
  cz: 0,
  r: 0,
};

export type DynamicFloraKind =
  | 'spruce'
  | 'lone_spruce'
  | 'spruce_sapling'
  | 'pine'
  | 'birch'
  | 'bog_pine'
  | 'boulder';

export interface VegetationStats {
  treesRendered: number;
  foliageRendered: number;
  culledInstances?: number;
  candidateInstances?: number;
}

export interface VegetationQualityOptions {
  lod0Dist?: number;
  lod1Dist?: number;
  bushDist?: number;
  understoryDist?: number;
  boulderDist?: number;
  bogDist?: number;
  grassMaxRing?: 1 | 2 | 3 | 4;
  grassRing1Step?: 1 | 2 | 3;
  grassRing2Step?: 1 | 2 | 3;
  grassRing3Step?: 1 | 2 | 3;
  grassRing4Step?: 1 | 2 | 3;
}

export const CAP_LOD0 = 960;
export const CAP_LOD1 = 1850;
export const CAP_LOD2 = 2400;
export const CAP_BOG_PINE = 680;
export const CAP_SAPLING = 1800;
export const CAP_HAZEL = 2400;
export const CAP_JUNIPER = 1600;
export const CAP_FERN = 3600;
export const CAP_SHRUB = 5600;
export const CAP_MOSS = 1800;
export const CAP_REED = 2200;
export const CAP_BOULDER = 650;
export const CAP_DEADFALL = 480;

// Compact curved 3D grass tufts + dense short filler grass + velvety 3D moss pillows
export const GRASS_BLADE_CAP = 16500;
export const SHORT_GRASS_CAP = 22000;
export const MOSS_CARPET_CAP = 12000;
export const TALL_UNDERGROWTH_CAP = 5800;
export const GRASS_TILE_SIZE = 16;
export const GRASS_TILE_RADIUS = 2;
export const MAX_GRASS_TILE_CACHE = 420;
export const GRASS_TILE_SAMPLES = 580;
export const SHORT_GRASS_TILE_SAMPLES = 860;
export const MOSS_TILE_SAMPLES = 420;
export const TALL_TILE_SAMPLES = 200;
export const MAX_CHUNK_CACHE = 450;
export const COLLIDER_CELL_SIZE = 8;
