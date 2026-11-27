import * as THREE from 'three';
import type { MushroomSpecies } from '../../game/gameLogic';
import type { ItemId } from '../../game/itemCatalog';
import type { ShelterQuality } from '../../game/survivalEngine';
import type { CampfireFireVisual } from '../campfireFire';
import type { PointSpatialIndex } from '../pointSpatialIndex';
import type { WorldTextures } from '../proceduralTextures';
import type { ShelterGeometry } from '../shelterGeometry';
import type { SoundEngine } from '../soundEngine';
import type { BoxCollider } from '../spatialPhysics';
import type { SkyFrameState } from '../weatherAndSky';
import type { HutDecayState } from '../worldBlueprint';
import type { WorldResources } from '../worldResources';

export type { BoxCollider } from '../spatialPhysics';

export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

export interface BoardwalkZone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  /** Optional oriented plank segment center & local frame for gap-free diagonal coverage. */
  cx?: number;
  cz?: number;
  cosYaw?: number;
  sinYaw?: number;
  halfW?: number;
  halfL?: number;
}

export function isPointOnBoardwalkZone(zone: BoardwalkZone, x: number, z: number): boolean {
  if (x < zone.minX || x > zone.maxX || z < zone.minZ || z > zone.maxZ) return false;
  if (
    zone.cx !== undefined &&
    zone.cz !== undefined &&
    zone.cosYaw !== undefined &&
    zone.sinYaw !== undefined &&
    zone.halfW !== undefined &&
    zone.halfL !== undefined
  ) {
    const dx = x - zone.cx;
    const dz = z - zone.cz;
    const localX = dx * zone.cosYaw - dz * zone.sinYaw;
    const localZ = dx * zone.sinYaw + dz * zone.cosYaw;
    return Math.abs(localX) <= zone.halfW && Math.abs(localZ) <= zone.halfL;
  }
  return true;
}

export interface InteractiveEntry {
  mesh: THREE.Object3D;
  name: string;
  desc: string;
  getName?: () => string;
  getDesc?: () => string;
  getPickupLabel?: () => string;
  getSecondaryActionLabel?: () => string | undefined;
  gatherable: boolean;
  species?: MushroomSpecies;
  gathered?: boolean;
  pickupItemId?: ItemId;
  pickupLabel?: string;
  carryable: boolean;
  kickable: boolean;
  breakable?: boolean;
  onKick?: () => void;
  onSecondaryAction?: () => void;
  onTouch?: () => void;
  onUse?: () => void;
  radius: number;
  mass: number;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  isDynamic: boolean;
  resting: boolean;
  onGroundYOffset: number;
  materialType?: 'wood' | 'metal' | 'stone' | 'glass';
  ownCollider?: BoxCollider;
}

export interface SleepSpotInfo {
  kind: 'bed' | 'campfire' | 'tent' | 'sleeping_bag';
  label: string;
  x: number;
  y: number;
  z: number;
  shelter: ShelterQuality;
  campfireId?: string;
  tentId?: string;
}

export interface CampfireInfo {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  lit: boolean;
}

export interface TentInfo {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface WorldInteractionHandlers {
  onOpenSleep?: (spot: SleepSpotInfo) => void;
  onOpenCampfire?: (campfire: CampfireInfo) => void;
  onPackUpTent?: (tentId: string) => void;
  onRefillWell?: (source: 'clean_well' | 'stale_well', label: string) => void;
  onLootCrate?: (
    crateId: string,
    label: string,
    loot: Array<{ itemId: ItemId; qty: number }>
  ) => void;
  onDoorToggle?: (info: {
    doorId: string;
    buildingId: string;
    open: boolean;
    abandoned: boolean;
    x: number;
    y: number;
    z: number;
  }) => void;
  onStumpKick?: (info: {
    broken: boolean;
    material: 'wood';
    x: number;
    y: number;
    z: number;
  }) => void;
  hasFirewoodInPack?: () => boolean;
  onThrowFirewoodAtCampfire?: (campfire: CampfireInfo) => void;
  onCampfireLogImpact?: (campfire: CampfireInfo, lit: boolean, x: number, y: number, z: number) => void;
  onCampfireLogCaughtFire?: (campfire: CampfireInfo) => void;
}

export interface WorldEnvironmentAtPoint {
  shelter: ShelterQuality;
  shelterLabel: string | null;
  nearLitCampfireFactor: number;
  nearestCampfire: CampfireInfo | null;
}

export interface StructureAcousticsInfo {
  id: string | null;
  quality: ShelterQuality;
  profileId: string;
  enclosure: number;
  roofCoverage: number;
  hasRoof: boolean;
  roofMaterial: string;
  wallMaterial: string;
  condition: 'intact' | 'weathered' | 'sagging' | 'decrepit' | 'ruins';
  portalOpenness: number;
  abandoned: boolean;
  floorMaterial: 'wooden_floor' | 'decrepit_wooden_floor' | 'forest_floor';
  nearestShelterDistanceM: number;
  roofDrainagePoint?: { x: number; y: number; z: number };
}

export interface WorldPropsContext {
  shelters: ShelterGeometry;
  needsLightShadowUpdate: () => boolean;
  invalidateLightShadows: () => void;
  circleColliders: CircleCollider[];
  boxColliders: BoxCollider[];
  boardwalkZones: BoardwalkZone[];
  interactiveObjects: InteractiveEntry[];
  queryInteractiveObjects: (x: number, z: number, radius: number, out: InteractiveEntry[]) => void;
  updateInteractivePosition: (entry: InteractiveEntry) => void;
  interactiveMeshes: THREE.Object3D[];
  dynamicObjects: InteractiveEntry[];
  mushroomCountTotal: number;
  heroMushroomPos: { x: number; z: number } | null;
  primaryCampfirePos: { x: number; y: number; z: number };
  updateDynamicProps: (
    elapsed: number,
    camX: number,
    camZ: number,
    skyState?: SkyFrameState,
    frustumPlanes?: Float32Array,
    maxRenderDist?: number,
    weather?: string,
    mushroomDist?: number
  ) => void;
  gatherMushroom: (entry: InteractiveEntry) => MushroomSpecies | null;
  collectPickupItem: (entry: InteractiveEntry) => ItemId | null;
  shatterWoodAt: (x: number, y: number, z: number, yaw: number, pieceCount?: number) => number;
  placePlayerCampfire: (x: number, z: number) => { ok: boolean; campfire?: CampfireInfo; message: string };
  placePlayerTent: (
    x: number,
    z: number,
    yaw: number
  ) => { ok: boolean; tent?: TentInfo; message: string };
  packUpPlayerTent: (tentId: string) => boolean;
  getTents: () => TentInfo[];
  getBreakableStumps: () => Array<{ x: number; z: number; entry: InteractiveEntry }>;
  getPickupItems: () => Array<{ x: number; z: number; entry: InteractiveEntry }>;
  getEnvironmentStateAt: (x: number, z: number) => WorldEnvironmentAtPoint;
  getStructureAcousticsAt: (x: number, z: number) => StructureAcousticsInfo;
  setCampfireLit: (id: string, lit: boolean) => boolean;
  getCampfireInfo: (id: string) => CampfireInfo | null;
  getCampfires: () => CampfireInfo[];
  throwFirewoodAtCampfire: (
    campfireId: string,
    startX: number,
    startY: number,
    startZ: number
  ) => { ok: boolean; campfire?: CampfireInfo };
  feedCampfireWithLog: (campfireId: string) => { ok: boolean; lit: boolean; campfire?: CampfireInfo };
  feedDynamicFirewoodIntoCampfires: () => Array<{
    campfire: CampfireInfo;
    lit: boolean;
    x: number;
    y: number;
    z: number;
  }>;
  isWaterVisible: () => boolean;
  isMistVisible: () => boolean;
  getBogShoreDepthInfo: () => {
    texture: THREE.DataTexture;
    centerX: number;
    centerZ: number;
    radius: number;
  };
  renderWaterReflection: (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera
  ) => void;
  spawnMushroomAt: (
    x: number,
    z: number,
    species: MushroomSpecies
  ) => { x: number; y: number; z: number; species: MushroomSpecies };
  spawnHutAt: (
    x: number,
    z: number,
    rotY?: number,
    decayState?: HutDecayState,
    name?: string
  ) => { x: number; y: number; z: number; decayState: HutDecayState };
  spawnCampfireAt: (x: number, z: number, lit?: boolean) => CampfireInfo;
  spawnPickupItemAt: (
    x: number,
    z: number,
    itemId: ItemId
  ) => { x: number; y: number; z: number; itemId: ItemId };
  getInspectableMeshes: () => THREE.Object3D[];
  dispose: () => void;
}

export interface CampfireEntry {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  lit: boolean;
  fire: CampfireFireVisual;
  pitGroup: THREE.Group;
}

export interface TentEntry {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  group: THREE.Group;
  interactiveEntry: InteractiveEntry;
  geometries: THREE.BufferGeometry[];
  colliders: BoxCollider[];
}

export interface StructureAcousticMeta {
  id: string;
  x: number;
  z: number;
  yaw: number;
  halfW: number;
  halfD: number;
  abandoned: boolean;
  decay: HutDecayState;
  roofMaterial: string;
  wallMaterial: string;
  hasDoor: boolean;
  getDoorOpen: () => boolean;
  roofDrainagePoint?: { x: number; y: number; z: number };
}

export interface VirtualPointLight {
  anchor: THREE.Object3D;
  yOffset: number;
  colorHex: number;
  baseIntensity: number;
  distance: number;
  decay: number;
  flicker: boolean;
  isLit: () => boolean;
}

export interface StructureNode {
  obj: THREE.Object3D;
  x: number;
  z: number;
  maxDistSq: number;
}

export type RegisterInteractiveFn = (
  mesh: THREE.Object3D,
  opts: Partial<InteractiveEntry> & { name: string; desc: string }
) => InteractiveEntry;

export interface PropBuildContext {
  resources: WorldResources;
  textures: WorldTextures;
  sound: SoundEngine;
  showToast: (msg: string) => void;
  handlers?: WorldInteractionHandlers;
  rand: () => number;
  shadows: boolean;
  shelters: ShelterGeometry;
  circleColliders: CircleCollider[];
  boxColliders: BoxCollider[];
  boardwalkZones: BoardwalkZone[];
  interactiveObjects: InteractiveEntry[];
  interactiveMeshes: THREE.Object3D[];
  dynamicObjects: InteractiveEntry[];
  interactiveIndex: PointSpatialIndex<InteractiveEntry>;
  structureNodes: StructureNode[];
  structureMetas: StructureAcousticMeta[];
  virtualPointLights: VirtualPointLight[];
  markLightShadowsDirty: () => void;
  addBoxCollider: (
    cx: number,
    cz: number,
    w: number,
    d: number,
    groundY: number,
    heightAboveGround: number,
    jumpable?: boolean
  ) => BoxCollider;
  addLocalOrientedBoxCollider: (
    groupX: number,
    groupY: number,
    groupZ: number,
    groupYaw: number,
    lx: number,
    ly: number,
    lz: number,
    w: number,
    h: number,
    d: number,
    rx?: number,
    ry?: number,
    rz?: number,
    overhead?: boolean
  ) => BoxCollider;
  registerInteractive: RegisterInteractiveFn;
  updateInteractivePosition: (entry: InteractiveEntry) => void;
}
