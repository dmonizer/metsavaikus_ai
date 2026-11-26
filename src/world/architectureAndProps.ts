import { prepareGeometry } from './geometryPreparation';
import { PointSpatialIndex } from './pointSpatialIndex';
import { createSeededRandom } from './seededRandom';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  clamp,
  distToRoadDetail,
  getActiveBlueprint,
  getDistanceToNearestVillage,
  getNearestSwampIsland,
  getSwampFactor,
  getTerrainHeight,
  roadCenterX,
  SWAMP_WATER_Y,
  WORLD_HALF,
} from './terrainMath';
import { HutDecayState } from './worldBlueprint';
import { WorldTextures } from './proceduralTextures';
import { SoundEngine } from './soundEngine';
import { SkyFrameState, WeatherId } from './weatherAndSky';
import { createReflectiveBogWater } from './waterSurface';
import { CampfireFireVisual, createCampfireFireVisual } from './campfireFire';
import { sphereIntersectsFrustum } from './forestFrustumCuller';
import { MUSHROOM_SPECIES_INFO, MushroomSpecies } from '../game/gameLogic';
import { ITEM_CATALOG, ItemId, MUSHROOM_TO_ITEM_ID } from '../game/itemCatalog';
import { ShelterQuality } from '../game/survivalEngine';
import { BoxCollider } from './spatialPhysics';
export type { BoxCollider } from './spatialPhysics';
import { ShelterGeometry, containsFootprint } from './shelterGeometry';
import { buildPantry } from './pantry';
import { getItemName, getMushroomCopy, t } from '../i18n/i18n';

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

const seededRand = (seed: number) => createSeededRandom(seed, 0x517cc1b7);

function prepNonIndexed(
  geo: THREE.BufferGeometry,
  color?: THREE.Color
): THREE.BufferGeometry {
  return prepareGeometry(geo, { colors: color ? { mode: 'solid', color } : undefined });
}

function makeBoxPart(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return prepNonIndexed(g);
}

function makeCylPart(
  rt: number,
  rb: number,
  len: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, len, segs, 1);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return prepNonIndexed(g);
}

/**
 * Applies soft vertical ambient-occlusion darkening at the bottom (ground contact)
 * and top (under roof eaves) of architectural wall geometry.
 */
function applyWallAoColors(geo: THREE.BufferGeometry, baseY: number, topY: number): void {
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const span = Math.max(0.2, topY - baseY);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp((pos.getY(i) - baseY) / span, 0, 1);
    const groundAo = 0.64 + 0.36 * Math.min(1, t / 0.28);
    const eaveAo = 0.44 + 0.56 * Math.min(1, (1 - t) / 0.28);
    const v = Math.min(groundAo, eaveAo);
    cols[i * 3] = v;
    cols[i * 3 + 1] = v * 0.99;
    cols[i * 3 + 2] = v * 0.96;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

export function buildArchitectureAndProps(
  scene: THREE.Scene,
  textures: WorldTextures,
  sound: SoundEngine,
  showToast: (msg: string) => void,
  isSoftwareGl: boolean,
  handlers?: WorldInteractionHandlers,
  isLowPowerGpu = false
): WorldPropsContext {
  const bp = getActiveBlueprint();
  const rand = seededRand(bp.seed + 1337);
  const circleColliders: CircleCollider[] = [];
  const boxColliders: BoxCollider[] = [];
  const shelters = new ShelterGeometry();
  let lightShadowsDirty = true;
  const boardwalkZones: BoardwalkZone[] = [];
  const interactiveObjects: InteractiveEntry[] = [];
  const interactiveMeshes: THREE.Object3D[] = [];
  const dynamicObjects: InteractiveEntry[] = [];
  const interactiveIndex = new PointSpatialIndex<InteractiveEntry>();
  const mushroomIndex = new PointSpatialIndex<InteractiveEntry>();
  const nearbyMushrooms: InteractiveEntry[] = [];
  const visibleMushrooms: InteractiveEntry[] = [];
  const interactiveWorldPosition = new THREE.Vector3();
  const structureNodes: Array<{ obj: THREE.Object3D; x: number; z: number; maxDistSq: number }> = [];
  const disposables: Array<{ dispose: () => void }> = [];

  interface CampfireEntry {
    id: string;
    label: string;
    x: number;
    y: number;
    z: number;
    lit: boolean;
    fire: CampfireFireVisual;
    pitGroup: THREE.Group;
  }
  interface TentEntry {
    id: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    group: THREE.Group;
    interactiveEntry: InteractiveEntry;
    geometries: THREE.BufferGeometry[];
  }
  interface StructureAcousticMeta {
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
  const structureMetas: StructureAcousticMeta[] = [];
  const campfires: CampfireEntry[] = [];
  const tents: TentEntry[] = [];
  let tentCounter = 0;
  let crateCounter = 0;

  const shadows = !isSoftwareGl;

  function addBoxCollider(
    cx: number,
    cz: number,
    w: number,
    d: number,
    groundY: number,
    heightAboveGround: number,
    jumpable = false
  ): BoxCollider {
    const box: BoxCollider = {
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
      groundY,
      heightAboveGround,
      jumpable,
      active: true,
    };
    boxColliders.push(box);
    return box;
  }

  function updateInteractivePosition(entry: InteractiveEntry): void {
    if (entry.gathered) { interactiveIndex.delete(entry); return; }
    entry.mesh.getWorldPosition(interactiveWorldPosition);
    interactiveIndex.set(entry, interactiveWorldPosition.x, interactiveWorldPosition.z);
  }

  function registerInteractive(
    mesh: THREE.Object3D,
    opts: Partial<InteractiveEntry> & { name: string; desc: string }
  ): InteractiveEntry {
    const entry: InteractiveEntry = {
      mesh,
      name: opts.name,
      desc: opts.desc,
      getName: opts.getName,
      getDesc: opts.getDesc,
      getPickupLabel: opts.getPickupLabel,
      getSecondaryActionLabel: opts.getSecondaryActionLabel,
      gatherable: !!opts.gatherable,
      species: opts.species,
      gathered: false,
      pickupItemId: opts.pickupItemId,
      pickupLabel: opts.pickupLabel,
      carryable: !!opts.carryable && !opts.gatherable && !opts.pickupItemId,
      kickable: !!opts.kickable && !opts.gatherable,
      breakable: !!opts.breakable,
      onKick: opts.onKick,
      onSecondaryAction: opts.onSecondaryAction,
      onTouch: opts.onTouch,
      onUse: opts.onUse ? () => {
        opts.onUse!();
        updateInteractivePosition(entry);
      } : undefined,
      radius: opts.radius ?? 0.35,
      mass: opts.mass ?? 1.0,
      vel: new THREE.Vector3(),
      angVel: new THREE.Vector3(),
      isDynamic: !!opts.isDynamic && !opts.gatherable,
      resting: false,
      onGroundYOffset: opts.onGroundYOffset ?? (opts.radius ?? 0.35),
      materialType: opts.materialType,
    };
    mesh.updateMatrixWorld(true);
    mesh.userData.interactive = entry;
    mesh.traverse((child) => {
      child.userData.interactive = entry;
      if (child instanceof THREE.Mesh) child.receiveShadow = true;
    });
    updateInteractivePosition(entry);
    interactiveObjects.push(entry);
    interactiveMeshes.push(mesh);
    if (entry.isDynamic) dynamicObjects.push(entry);
    return entry;
  }

  // ============================================================================
  // Wind-Responsive Planar-Reflective Peat-Bog Water & Morning Mist Layers
  // ============================================================================
  const waterRadius = bp.bogRadius + 28;
  const bogWater = createReflectiveBogWater(
    bp.bogCenterX,
    bp.bogCenterZ,
    waterRadius,
    isSoftwareGl,
    isLowPowerGpu
  );
  const swampWater = bogWater.mesh;
  swampWater.userData.debugLayer = 'water';
  swampWater.userData.debugName = 'Rabajärv (Bog Lake Water)';
  swampWater.userData.debugMeta = { waterY: SWAMP_WATER_Y, radius: waterRadius };
  scene.add(swampWater);
  disposables.push(bogWater);

  const mistGeo = new THREE.PlaneGeometry(12, 12);
  mistGeo.rotateX(-Math.PI / 2);
  const mistMat = new THREE.MeshBasicMaterial({
    map: textures.bogMistTex,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  const mistInst = new THREE.InstancedMesh(mistGeo, mistMat, 6);
  const mistDummy = new THREE.Object3D();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.45;
    const rad = 20 + rand() * (bp.bogRadius * 0.68);
    mistDummy.position.set(
      bp.bogCenterX + Math.cos(a) * rad,
      SWAMP_WATER_Y + 0.36 + rand() * 0.42,
      bp.bogCenterZ + Math.sin(a) * rad
    );
    mistDummy.rotation.set(0, rand() * Math.PI, 0);
    mistDummy.scale.set(0.85 + rand() * 0.4, 1, 0.85 + rand() * 0.4);
    mistDummy.updateMatrix();
    mistInst.setMatrixAt(i, mistDummy.matrix);
  }
  mistInst.instanceMatrix.needsUpdate = true;
  scene.add(mistInst);
  disposables.push(mistGeo, mistMat);

  // ============================================================================
  // Photo-Matched PBR Estonian Heritage Log Buildings (Sobel Normal Maps + AO!)
  // ============================================================================
  const weatheredLogMat = new THREE.MeshStandardMaterial({
    map: textures.logWallWeathered,
    normalMap: textures.logWallNormal,
    normalScale: new THREE.Vector2(1.9, 1.9),
    roughness: 0.93,
    metalness: 0.0,
    envMapIntensity: 0.24,
    vertexColors: true,
  });
  const warmLogMat = new THREE.MeshStandardMaterial({
    map: textures.logWallWarm,
    normalMap: textures.logWallNormal,
    normalScale: new THREE.Vector2(1.9, 1.9),
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.26,
    vertexColors: true,
  });
  const thatchMat = new THREE.MeshStandardMaterial({
    map: textures.thatchRoofMossy,
    normalMap: textures.thatchNormal,
    normalScale: new THREE.Vector2(2.2, 2.2),
    color: 0xd8d2c4,
    roughness: 0.97,
    metalness: 0.0,
    envMapIntensity: 0.18,
  });
  const shingleMat = new THREE.MeshStandardMaterial({
    map: textures.roofShingle,
    normalMap: textures.shingleNormal,
    normalScale: new THREE.Vector2(2.0, 2.0),
    color: 0xc8c2b8,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.22,
  });
  const stonePlinthMat = new THREE.MeshStandardMaterial({
    map: textures.fieldstone,
    normalMap: textures.fieldstoneNormal,
    normalScale: new THREE.Vector2(2.2, 2.2),
    roughness: 0.9,
    metalness: 0.02,
    envMapIntensity: 0.3,
  });
  const timberTrimMat = new THREE.MeshStandardMaterial({
    map: textures.plankWood,
    normalMap: textures.plankNormal,
    normalScale: new THREE.Vector2(1.5, 1.5),
    color: 0x867c6e,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.24,
  });
  const gableMat = new THREE.MeshStandardMaterial({
    map: textures.gableBoards,
    normalMap: textures.plankNormal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    color: 0xbeb5a6,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.24,
  });
  const darkInteriorMat = new THREE.MeshStandardMaterial({
    color: 0x1a130e,
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.15,
  });
  const chimneyWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xcbc6bc,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });
  // Realistic heritage glass: dark sky-reflective in daytime, warm hearth glow at dusk/night!
  const activeWinMat = new THREE.MeshStandardMaterial({
    color: 0x141e24,
    emissive: 0xffa64d,
    emissiveIntensity: 0.04,
    roughness: 0.1,
    metalness: 0.18,
    envMapIntensity: 1.55,
  });
  const darkWinMat = new THREE.MeshStandardMaterial({
    color: 0x101413,
    roughness: 0.16,
    metalness: 0.12,
    envMapIntensity: 1.15,
  });
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadowTex,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const bedWoolMat = new THREE.MeshStandardMaterial({
    color: 0x6f4b3e,
    roughness: 0.94,
    metalness: 0.0,
    envMapIntensity: 0.2,
  });
  const bedLinenMat = new THREE.MeshStandardMaterial({
    color: 0xd6cdb9,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.25,
  });
  const staleWellWaterMat = new THREE.MeshStandardMaterial({
    color: 0x2c3b20,
    roughness: 0.28,
    metalness: 0.05,
    envMapIntensity: 0.65,
  });
  const cleanWellWaterMat = new THREE.MeshStandardMaterial({
    color: 0x1a3846,
    roughness: 0.14,
    metalness: 0.08,
    envMapIntensity: 0.9,
  });
  const crateWoodMat = new THREE.MeshStandardMaterial({
    map: textures.plankWood,
    normalMap: textures.plankNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    color: 0x9b7952,
    roughness: 0.88,
    metalness: 0.0,
    envMapIntensity: 0.3,
  });

  disposables.push(
    weatheredLogMat,
    warmLogMat,
    thatchMat,
    shingleMat,
    stonePlinthMat,
    timberTrimMat,
    gableMat,
    darkInteriorMat,
    chimneyWhiteMat,
    activeWinMat,
    darkWinMat,
    contactShadowMat,
    bedWoolMat,
    bedLinenMat,
    staleWellWaterMat,
    cleanWellWaterMat,
    crateWoodMat
  );

  function addBatchedMesh(
    parent: THREE.Group,
    parts: THREE.BufferGeometry[],
    mat: THREE.Material,
    castShadow: boolean,
    wallAo?: { baseY: number; topY: number }
  ): void {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts)!;
    if (wallAo) {
      applyWallAoColors(merged, wallAo.baseY, wallAo.topY);
    }
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    parent.add(m);
    disposables.push(merged);
  }

  function buildEstonianLogHouse(
    x: number,
    z: number,
    rotY: number,
    opts: {
      w?: number;
      d?: number;
      h?: number;
      roofStyle?: 'thatch' | 'shingle';
      warmWood?: boolean;
      abandoned?: boolean;
      decayState?: HutDecayState;
      porch?: boolean;
      name?: string;
      pantry?: boolean;
    } = {}
  ): void {
    const w = opts.w ?? 8.4;
    const d = opts.d ?? 5.6;
    const h = opts.h ?? 2.75;
    const roofStyle = opts.roofStyle ?? 'thatch';
    const roofOverhang = 0.84;
    const roofH = roofStyle === 'thatch' ? 2.95 : 2.55;
    const wallMat = opts.warmWood ? warmLogMat : weatheredLogMat;
    const abandoned = !!opts.abandoned;
    const decay: HutDecayState = opts.decayState ?? 'intact';
    const name = opts.name ?? 'Rehemaja';

    const y = getTerrainHeight(x, z);
    const buildingId = `house_${x}_${z}`;
    let doorOpenRef = false;
    shelters.add({
      id: buildingId, x, z, yaw: rotY, halfW: w / 2, halfD: d / 2, floorY: y + 0.43,
      shelter: decay === 'intact' || decay === 'sagging' ? {
        quality: !abandoned && decay === 'intact' ? 'warm_house' : 'drafty_hut', label: name,
      } : undefined,
      roof: decay === 'intact' ? {
        eaveY: y + 0.4 + h - 0.16 + roofH * roofOverhang / (d / 2 + roofOverhang),
        rise: roofH * (d / 2) / (d / 2 + roofOverhang), axis: 'z',
      } : undefined,
    });
    const drainageX = x + Math.cos(rotY) * (w / 2 + 0.4);
    const drainageZ = z - Math.sin(rotY) * (w / 2 + 0.4);
    structureMetas.push({
      id: buildingId,
      x,
      z,
      yaw: rotY,
      halfW: w / 2,
      halfD: d / 2,
      abandoned,
      decay,
      roofMaterial: roofStyle,
      wallMaterial: 'wood',
      hasDoor: decay !== 'ruins',
      getDoorOpen: () => doorOpenRef,
      roofDrainagePoint:
        decay === 'intact' || decay === 'sagging'
          ? { x: drainageX, y: y + 2.4, z: drainageZ }
          : undefined,
    });
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = rotY;
    group.userData.debugLayer = 'structure';
    group.userData.debugName = name;
    group.userData.debugMeta = { buildingId, decay, abandoned, roofStyle };
    scene.add(group);
    structureNodes.push({ obj: group, x, z, maxDistSq: 255 * 255 });

    // Soft ambient-occlusion grounding skirt beneath each building
    const shadowGeo = new THREE.PlaneGeometry(w + 2.4, d + 2.4);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowQuad = new THREE.Mesh(shadowGeo, contactShadowMat);
    shadowQuad.position.y = 0.03;
    group.add(shadowQuad);
    disposables.push(shadowGeo);

    const plinthParts: THREE.BufferGeometry[] = [];
    const wallParts: THREE.BufferGeometry[] = [];
    const roofParts: THREE.BufferGeometry[] = [];
    const gableParts: THREE.BufferGeometry[] = [];
    const trimParts: THREE.BufferGeometry[] = [];
    const interiorParts: THREE.BufferGeometry[] = [];
    const winParts: THREE.BufferGeometry[] = [];
    const chimneyParts: THREE.BufferGeometry[] = [];

    // 1. Fieldstone foundation plinth + perimeter glacial sill boulders (matching large_house2 photo!)
    plinthParts.push(makeBoxPart(w + 0.22, 0.46, d + 0.22, 0, 0.16, 0));
    const frontStoneCount = Math.max(5, Math.floor(w / 1.15));
    for (let i = 0; i <= frontStoneCount; i++) {
      const sx = -w * 0.5 + (i / frontStoneCount) * w;
      for (const sz of [-d * 0.5 - 0.06, d * 0.5 + 0.06]) {
        const sr = 0.2 + (i % 3) * 0.04;
        const sb = new THREE.DodecahedronGeometry(sr, 0);
        sb.scale(1.25, 0.72, 0.95);
        sb.rotateY(i * 1.1);
        sb.translate(sx, 0.12, sz);
        plinthParts.push(prepNonIndexed(sb));
      }
    }
    const sideStoneCount = Math.max(3, Math.floor(d / 1.15));
    for (let i = 1; i < sideStoneCount; i++) {
      const sz = -d * 0.5 + (i / sideStoneCount) * d;
      for (const sx of [-w * 0.5 - 0.06, w * 0.5 + 0.06]) {
        const sr = 0.2 + (i % 2) * 0.05;
        const sb = new THREE.DodecahedronGeometry(sr, 0);
        sb.scale(0.95, 0.72, 1.25);
        sb.rotateY(i * 0.9);
        sb.translate(sx, 0.12, sz);
        plinthParts.push(prepNonIndexed(sb));
      }
    }

    // Floor slab
    interiorParts.push(makeBoxPart(w - 0.2, 0.14, d - 0.2, 0, 0.36, 0));

    // 2. Stacked log walls adjusted by decayState
    const wallThick = 0.28;
    const doorWidth = 1.25;
    const sideSegW = (w - doorWidth) / 2;

    const hBack = decay === 'ruins' ? h * 0.52 : decay === 'roofless' ? h * 0.88 : h;
    const hLeft = decay === 'ruins' ? h * 0.72 : h;
    const hRight = decay === 'ruins' ? h * 0.42 : decay === 'roofless' ? h * 0.84 : h;
    const hFrontL = decay === 'ruins' ? h * 0.62 : h;
    const hFrontR = decay === 'ruins' ? h * 0.55 : h;

    wallParts.push(makeBoxPart(w, hBack, wallThick, 0, 0.4 + hBack / 2, -d / 2 + wallThick / 2));
    wallParts.push(makeBoxPart(wallThick, hLeft, d, -w / 2 + wallThick / 2, 0.4 + hLeft / 2, 0));
    wallParts.push(makeBoxPart(wallThick, hRight, d, w / 2 - wallThick / 2, 0.4 + hRight / 2, 0));
    wallParts.push(
      makeBoxPart(sideSegW, hFrontL, wallThick, -w / 2 + sideSegW / 2, 0.4 + hFrontL / 2, d / 2 - wallThick / 2)
    );
    wallParts.push(
      makeBoxPart(sideSegW, hFrontR, wallThick, w / 2 - sideSegW / 2, 0.4 + hFrontR / 2, d / 2 - wallThick / 2)
    );

    if (decay !== 'ruins') {
      wallParts.push(makeBoxPart(doorWidth, 0.62, wallThick, 0, 0.4 + h - 0.31, d / 2 - wallThick / 2));
    }

    // Interlocking saddle-notched corner log ends (ristpalk!)
    const maxWallH = decay === 'ruins' ? h * 0.55 : h;
    const logCourses = decay === 'ruins' ? 4 : 8;
    for (let c = 0; c < logCourses; c++) {
      const ly = 0.52 + (c / logCourses) * (maxWallH - 0.16);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          wallParts.push(
            makeCylPart(
              0.11,
              0.115,
              0.46,
              7,
              sx * (w / 2 + 0.11),
              ly,
              sz * (d / 2 - wallThick / 2),
              0,
              0,
              Math.PI / 2
            )
          );
          wallParts.push(
            makeCylPart(
              0.11,
              0.115,
              0.46,
              7,
              sx * (w / 2 - wallThick / 2),
              ly + 0.085,
              sz * (d / 2 + 0.11),
              Math.PI / 2,
              0,
              0
            )
          );
        }
      }
    }

    // 3. Deep overhanging heritage Estonian roof & exposed eaves rafters
    const slopeRun = d / 2 + roofOverhang;
    const slopeLen = Math.hypot(slopeRun, roofH);
    const slopeAngle = Math.atan2(roofH, slopeRun);
    const roofThick = roofStyle === 'thatch' ? 0.34 : 0.18;

    if (decay === 'intact' || decay === 'sagging') {
      const sagAngle = decay === 'sagging' ? 0.09 : 0;
      const frontRoofW = w + roofOverhang * 1.95;
      roofParts.push(
        makeBoxPart(
          frontRoofW,
          roofThick,
          slopeLen,
          0,
          0.4 + h + roofH / 2 - 0.16,
          slopeRun / 2,
          slopeAngle,
          0,
          sagAngle
        )
      );
      const backW = decay === 'sagging' ? frontRoofW * 0.58 : frontRoofW;
      const backShiftX = decay === 'sagging' ? -frontRoofW * 0.2 : 0;
      roofParts.push(
        makeBoxPart(
          backW,
          roofThick,
          slopeLen,
          backShiftX,
          0.4 + h + roofH / 2 - 0.16,
          -slopeRun / 2,
          -slopeAngle,
          0,
          -sagAngle * 0.8
        )
      );

      // Exposed dark eave rafter tails beneath the deep overhang
      const eaveCount = Math.max(5, Math.floor(w / 1.35));
      for (let i = 0; i < eaveCount; i++) {
        const ex = -w * 0.46 + (i / (eaveCount - 1)) * w * 0.92;
        trimParts.push(
          makeBoxPart(0.11, 0.12, 0.95, ex, 0.4 + h - 0.04, d / 2 + 0.32, 0.24, 0, 0)
        );
        trimParts.push(
          makeBoxPart(0.11, 0.12, 0.95, ex, 0.4 + h - 0.04, -d / 2 - 0.32, -0.24, 0, 0)
        );
      }

      const gableShape = new THREE.Shape();
      gableShape.moveTo(-d / 2, 0);
      gableShape.lineTo(d / 2, 0);
      gableShape.lineTo(0, roofH * 0.88);
      gableShape.closePath();

      const makeGableGeo = (xPos: number) => {
        const geo = new THREE.ExtrudeGeometry(gableShape, { depth: 0.22, bevelEnabled: false });
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) * 0.34, uv.getY(i) * 0.34);
        }
        geo.rotateY(Math.PI / 2);
        geo.translate(xPos, 0.4 + h, 0);
        return prepNonIndexed(geo);
      };
      gableParts.push(makeGableGeo(-w / 2));
      if (decay === 'intact') {
        gableParts.push(makeGableGeo(w / 2 - 0.22));
      }

      if (roofStyle === 'thatch') {
        // Crossed ridge saddle poles (harimalgad) & reed hold-down poles matching large_house.jpg!
        const poleCount = Math.max(6, Math.floor(w / 0.85));
        const nx = Math.sin(slopeAngle) * 0.22;
        const ny = Math.cos(slopeAngle) * 0.22;
        for (let i = 0; i < poleCount; i++) {
          if (decay === 'sagging' && i > poleCount * 0.6) continue;
          const px = -w * 0.46 + (i / (poleCount - 1)) * w * 0.92;
          // Full slope wind-poles crossing slightly above the ridge
          trimParts.push(
            makeCylPart(
              0.036,
              0.048,
              slopeLen + 0.62,
              5,
              px - 0.045,
              0.4 + h + roofH * 0.56 + ny,
              slopeRun * 0.44 + nx,
              Math.PI * 0.5 + slopeAngle,
              0,
              0
            )
          );
          trimParts.push(
            makeCylPart(
              0.036,
              0.048,
              slopeLen + 0.62,
              5,
              px + 0.045,
              0.4 + h + roofH * 0.56 + ny,
              -(slopeRun * 0.44 + nx),
              Math.PI * 0.5 - slopeAngle,
              0,
              0
            )
          );
        }
        // Horizontal ridge weight pole
        trimParts.push(
          makeCylPart(0.06, 0.06, frontRoofW * 0.94, 6, 0, 0.4 + h + roofH + 0.06, 0, 0, 0, Math.PI / 2)
        );
      } else if (decay === 'intact') {
        chimneyParts.push(makeBoxPart(0.72, 1.55, 0.72, -w * 0.22, 0.4 + h + roofH - 0.16, -0.35));
        // Brick chimney cap rim
        trimParts.push(makeBoxPart(0.84, 0.14, 0.84, -w * 0.22, 0.4 + h + roofH + 0.62, -0.35));
      }
    } else if (decay === 'roofless') {
      trimParts.push(makeCylPart(0.08, 0.09, w * 0.86, 5, -w * 0.04, 0.4 + h + 0.04, 0, 0, 0, Math.PI / 2 + 0.04));
      const rafterCount = 4;
      for (let i = 0; i < rafterCount; i++) {
        const rxPos = -w * 0.35 + (i / (rafterCount - 1)) * w * 0.7;
        trimParts.push(
          makeCylPart(
            0.055,
            0.065,
            slopeLen * (0.45 + (i % 2) * 0.25),
            5,
            rxPos,
            0.4 + h + 0.55,
            d * 0.26,
            Math.PI * 0.5 + slopeAngle - (i % 2) * 0.14,
            0,
            0.08 * (i % 2 ? 1 : -1)
          )
        );
        if (i !== 2) {
          trimParts.push(
            makeCylPart(
              0.055,
              0.065,
              slopeLen * 0.52,
              5,
              rxPos,
              0.4 + h + 0.5,
              -d * 0.26,
              Math.PI * 0.5 - slopeAngle,
              0,
              -0.06
            )
          );
        }
      }
      trimParts.push(makeCylPart(0.08, 0.095, w * 0.75, 5, 0.15, 0.62, -0.35, 0.18, 0.42, Math.PI / 2 - 0.14));
    } else if (decay === 'ruins') {
      trimParts.push(makeCylPart(0.09, 0.1, w * 0.72, 5, -0.2, 0.58, 0.2, 0.1, -0.35, Math.PI / 2 - 0.08));
      trimParts.push(makeCylPart(0.08, 0.09, d * 0.85, 5, 0.65, 0.64, -0.1, Math.PI / 2 - 0.12, 0.4, 0));
    }

    // Timber door jamb & deeply recessed heritage mullioned windows
    if (decay !== 'ruins') {
      const doorFz = d / 2 - wallThick / 2 + 0.04;
      trimParts.push(makeBoxPart(0.11, h - 0.65, 0.32, -doorWidth / 2 - 0.05, 0.4 + (h - 0.65) / 2, doorFz));
      trimParts.push(makeBoxPart(0.11, h - 0.65, 0.32, doorWidth / 2 + 0.05, 0.4 + (h - 0.65) / 2, doorFz));
      trimParts.push(makeBoxPart(doorWidth + 0.22, 0.11, 0.32, 0, 0.4 + h - 0.66, doorFz));

      for (const wx of [-w * 0.28, w * 0.28]) {
        const wy = 0.4 + 1.42;
        const wz = d / 2 - wallThick / 2;
        winParts.push(makeBoxPart(0.86, 0.86, 0.24, wx, wy, wz - 0.02));
        trimParts.push(makeBoxPart(1.04, 0.09, 0.36, wx, wy + 0.45, wz + 0.02));
        trimParts.push(makeBoxPart(1.08, 0.1, 0.4, wx, wy - 0.45, wz + 0.04)); // sloped windowsill
        trimParts.push(makeBoxPart(0.09, 0.9, 0.36, wx - 0.46, wy, wz + 0.02));
        trimParts.push(makeBoxPart(0.09, 0.9, 0.36, wx + 0.46, wy, wz + 0.02));
        trimParts.push(makeBoxPart(0.05, 0.86, 0.32, wx, wy, wz + 0.02));
        trimParts.push(makeBoxPart(0.86, 0.05, 0.32, wx, wy, wz + 0.02));
      }

      if (opts.porch) {
        trimParts.push(makeBoxPart(w * 0.68, 0.16, 1.2, 0, 0.32, d / 2 + 0.58));
        trimParts.push(makeBoxPart(1.9, 0.1, 0.38, -w * 0.16, 0.72, d / 2 + 0.54));
        trimParts.push(makeBoxPart(1.18, 0.12, 0.32, 0, 0.16, d / 2 + 1.15));
      }

      interiorParts.push(makeBoxPart(1.4, 0.76, 0.82, 0, 0.4 + 0.38, -0.5));
    }

    addBatchedMesh(group, plinthParts, stonePlinthMat, true);
    addBatchedMesh(group, wallParts, wallMat, true, { baseY: 0.4, topY: 0.4 + h });
    addBatchedMesh(group, roofParts, roofStyle === 'thatch' ? thatchMat : shingleMat, true);
    addBatchedMesh(group, gableParts, gableMat, true);
    addBatchedMesh(group, trimParts, timberTrimMat, shadows);
    addBatchedMesh(group, interiorParts, darkInteriorMat, true);
    addBatchedMesh(group, winParts, abandoned ? darkWinMat : activeWinMat, false);
    addBatchedMesh(group, chimneyParts, chimneyWhiteMat, shadows);

    // Interactive door
    let doorCollider: BoxCollider | null = null;
    if (decay !== 'ruins') {
      const doorPivot = new THREE.Group();
      doorPivot.position.set(-doorWidth / 2, 0.4, d / 2 - wallThick / 2);
      const doorMat = new THREE.MeshStandardMaterial({
        map: textures.plankWood,
        normalMap: textures.plankNormal,
        normalScale: new THREE.Vector2(0.9, 0.9),
        color: abandoned ? 0x544c42 : 0x6f5438,
        roughness: 0.9,
        metalness: 0.0,
        envMapIntensity: 0.45,
      });
      disposables.push(doorMat);
      const doorMesh = new THREE.Mesh(
        new THREE.BoxGeometry(doorWidth - 0.04, h - 0.72, 0.1),
        doorMat
      );
      doorMesh.position.set(doorWidth / 2, (h - 0.72) / 2, 0);
      doorMesh.castShadow = true;
      doorMesh.receiveShadow = true;
      doorPivot.add(doorMesh);
      group.add(doorPivot);

      let doorOpen = abandoned && rand() > 0.3;
      doorOpenRef = doorOpen;
      doorPivot.rotation.y = doorOpen ? -Math.PI * 0.58 : 0;

      const c = Math.cos(rotY);
      const s = Math.sin(rotY);
      const lx = 0;
      const lz = d / 2 - wallThick / 2;
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      const ww = Math.abs(doorWidth * c) + Math.abs(wallThick * s);
      const wd = Math.abs(doorWidth * s) + Math.abs(wallThick * c);
      doorCollider = addBoxCollider(wx, wz, ww, wd, y + 0.4, h - 0.72, false);
      doorCollider.frame = { x: wx, z: wz, yaw: rotY, halfW: doorWidth / 2, halfD: wallThick / 2 };
      doorCollider.active = !doorOpen;

      const doorId = `door_${buildingId}`;
      doorMesh.userData.debugLayer = 'door';
      doorMesh.userData.debugName = abandoned ? 'Old Cabin Door' : `${name} Door`;
      doorMesh.userData.debugMeta = { doorId, buildingId, abandoned };
      registerInteractive(doorMesh, {
        name: abandoned ? t('prop.oldCabinDoor') : t('prop.namedDoor', { name }),
        desc: abandoned ? t('prop.doorDescAbandoned') : t('prop.doorDescIntact'),
        getName: () => (abandoned ? t('prop.oldCabinDoor') : t('prop.namedDoor', { name })),
        getDesc: () => (abandoned ? t('prop.doorDescAbandoned') : t('prop.doorDescIntact')),
        onUse: () => {
          doorOpen = !doorOpen;
          doorOpenRef = doorOpen;
          lightShadowsDirty = true;
          if (doorCollider) doorCollider.active = !doorOpen;
          doorPivot.rotation.y = doorOpen ? -Math.PI * 0.58 : 0;
          if (handlers?.onDoorToggle) {
            handlers.onDoorToggle({
              doorId,
              buildingId,
              open: doorOpen,
              abandoned,
              x: wx,
              y: y + 1.25,
              z: wz,
            });
          } else {
            sound.playImpact(0.7);
          }
          showToast(doorOpen ? t('prop.doorOpened') : t('prop.doorClosed'));
        },
        onTouch: () =>
          showToast(abandoned ? t('prop.doorTouchAbandoned') : t('prop.doorTouchIntact')),
      });
    }

    if (opts.pantry && !abandoned && decay === 'intact') {
      buildPantry(group, w, d, registerInteractive, disposables);
    }

    // Interactive Bed inside roofed usable houses & intact bog huts
    if (decay === 'intact' || decay === 'sagging') {
      const bedShelter: ShelterQuality =
        !abandoned && decay === 'intact' ? 'warm_house' : 'drafty_hut';
      const bedGroup = new THREE.Group();
      const bedLx = -w * 0.28;
      const bedLz = -d * 0.12;
      bedGroup.position.set(bedLx, 0.43, bedLz);

      const frameGeo = new THREE.BoxGeometry(1.05, 0.34, 1.95);
      const blanketGeo = new THREE.BoxGeometry(0.98, 0.16, 1.52);
      const pillowGeo = new THREE.BoxGeometry(0.76, 0.14, 0.36);
      disposables.push(frameGeo, blanketGeo, pillowGeo);

      const frameMesh = new THREE.Mesh(frameGeo, timberTrimMat);
      frameMesh.position.y = 0.17;
      const blanketMesh = new THREE.Mesh(blanketGeo, bedWoolMat);
      blanketMesh.position.set(0, 0.39, 0.18);
      const pillowMesh = new THREE.Mesh(pillowGeo, bedLinenMat);
      pillowMesh.position.set(0, 0.42, -0.72);
      bedGroup.add(frameMesh, blanketMesh, pillowMesh);
      group.add(bedGroup);

      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const bedWorldX = x + bedLx * cosR + bedLz * sinR;
      const bedWorldZ = z - bedLx * sinR + bedLz * cosR;

      registerInteractive(bedGroup, {
        name: abandoned ? t('prop.bunkName', { name }) : t('prop.bedName', { name }),
        desc: bedShelter === 'warm_house' ? t('prop.bedDescWarm') : t('prop.bedDescDrafty'),
        getName: () => (abandoned ? t('prop.bunkName', { name }) : t('prop.bedName', { name })),
        getDesc: () =>
          bedShelter === 'warm_house' ? t('prop.bedDescWarm') : t('prop.bedDescDrafty'),
        onUse: () => {
          handlers?.onOpenSleep?.({
            kind: 'bed',
            label: abandoned ? t('prop.bunkName', { name }) : t('prop.bedSpotLabel', { name }),
            x: bedWorldX,
            y: y + 0.85,
            z: bedWorldZ,
            shelter: bedShelter,
          });
        },
        onTouch: () =>
          showToast(bedShelter === 'warm_house' ? t('prop.bedTouchWarm') : t('prop.bedTouchDrafty')),
      });

      // Village / cabin provision pantry crate (lootable once for rations, batteries & matches)
      if (!abandoned || decay === 'intact') {
        const crateId = `crate_${crateCounter++}`;
        const crateLx = w * 0.27;
        const crateLz = -d * 0.24;
        const crateGeo = new THREE.BoxGeometry(0.74, 0.56, 0.54);
        disposables.push(crateGeo);
        const crateMesh = new THREE.Mesh(crateGeo, crateWoodMat);
        crateMesh.position.set(crateLx, 0.43 + 0.28, crateLz);
        group.add(crateMesh);

        const lootPool: Array<Array<{ itemId: ItemId; qty: number }>> = [
          [
            { itemId: 'rye_bread', qty: 1 },
            { itemId: 'smoked_sausage', qty: 1 },
            { itemId: 'matches', qty: 1 },
          ],
          [
            { itemId: 'raw_steak', qty: 1 },
            { itemId: 'chocolate_bar', qty: 1 },
            { itemId: 'extra_battery', qty: 1 },
          ],
          [
            { itemId: 'dried_berries', qty: 1 },
            { itemId: 'chocolate_bar', qty: 1 },
            { itemId: 'matches', qty: 1 },
          ],
          [
            { itemId: 'smoked_sausage', qty: 1 },
            { itemId: 'extra_battery', qty: 1 },
          ],
        ];
        const crateLoot = lootPool[crateCounter % lootPool.length];
        let looted = false;

        registerInteractive(crateMesh, {
          name: abandoned ? t('prop.oldSupplyBox') : t('prop.pantryCrate', { name }),
          desc: t('prop.crateDesc'),
          getName: () => (abandoned ? t('prop.oldSupplyBox') : t('prop.pantryCrate', { name })),
          getDesc: () => t('prop.crateDesc'),
          onUse: () => {
            if (looted) {
              showToast(t('prop.crateEmpty'));
              return;
            }
            looted = true;
            crateMesh.scale.y = 0.72;
            crateMesh.position.y = 0.43 + 0.2;
            sound.playImpact(0.5);
            handlers?.onLootCrate?.(
              crateId,
              abandoned ? t('prop.oldSupplyBox') : t('prop.pantryCrate', { name }),
              crateLoot
            );
          },
          onTouch: () =>
            showToast(looted ? t('prop.crateTouchEmpty') : t('prop.crateTouchFull')),
        });
      }
    }

    function addLocalWallCollider(lx: number, lz: number, lw: number, ld: number, wallHeight: number, bottom = 0.4): void {
      const c = Math.cos(rotY);
      const s = Math.sin(rotY);
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      const ww = Math.abs(lw * c) + Math.abs(ld * s);
      const wd = Math.abs(lw * s) + Math.abs(ld * c);
      const collider = addBoxCollider(wx, wz, ww, wd, y + bottom, wallHeight, false);
      collider.frame = { x: wx, z: wz, yaw: rotY, halfW: lw / 2, halfD: ld / 2 };
    }

    addLocalWallCollider(0, -d / 2 + wallThick / 2, w, wallThick, hBack);
    addLocalWallCollider(-w / 2 + wallThick / 2, 0, wallThick, d, hLeft);
    addLocalWallCollider(w / 2 - wallThick / 2, 0, wallThick, d, hRight);
    addLocalWallCollider(-w / 2 + sideSegW / 2, d / 2 - wallThick / 2, sideSegW, wallThick, hFrontL);
    addLocalWallCollider(w / 2 - sideSegW / 2, d / 2 - wallThick / 2, sideSegW, wallThick, hFrontR);
    if (decay !== 'ruins') addLocalWallCollider(0, d / 2 - wallThick / 2, doorWidth, wallThick, 0.62, 0.4 + h - 0.62);
  }

  // Split-Pole Slanted Estonian Fence (roigasaed — SOLID horizontal collision, JUMPABLE over 0.92m!)
  function buildSplitPoleFence(x0: number, z0: number, x1: number, z1: number): void {
    const parts: THREE.BufferGeometry[] = [];
    const totalLen = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / totalLen;
    const dz = (z1 - z0) / totalLen;
    const yaw = Math.atan2(dx, dz);
    const bays = Math.max(2, Math.floor(totalLen / 1.9));

    for (let i = 0; i <= bays; i++) {
      const px = x0 + dx * (i / bays) * totalLen;
      const pz = z0 + dz * (i / bays) * totalLen;
      const py = getTerrainHeight(px, pz);
      for (const side of [-0.07, 0.07]) {
        const sx = px - dz * side;
        const sz = pz + dx * side;
        parts.push(makeCylPart(0.036, 0.044, 1.18, 5, sx, py + 0.54, sz, 0, 0, 0));
      }
      if (i < bays) {
        const nx = x0 + dx * ((i + 0.5) / bays) * totalLen;
        const nz = z0 + dz * ((i + 0.5) / bays) * totalLen;
        const ny = getTerrainHeight(nx, nz);
        for (let r = 0; r < 3; r++) {
          const g = new THREE.CylinderGeometry(0.025, 0.032, 2.45, 5, 1);
          g.rotateX(Math.PI * 0.5 - 0.22);
          g.rotateY(yaw);
          g.translate(nx, ny + 0.32 + r * 0.25, nz);
          parts.push(prepNonIndexed(g));
        }

        const segLen = totalLen / bays;
        const bw = Math.abs(dx * segLen) + Math.abs(dz * 0.34);
        const bd = Math.abs(dz * segLen) + Math.abs(dx * 0.34);
        addBoxCollider(nx, nz, bw, bd, ny, 0.92, true);
      }
    }

    const fenceGeo = mergeGeometries(parts)!;
    const fenceMesh = new THREE.Mesh(fenceGeo, timberTrimMat);
    fenceMesh.castShadow = shadows;
    fenceMesh.receiveShadow = true;
    scene.add(fenceMesh);
    structureNodes.push({
      obj: fenceMesh,
      x: (x0 + x1) * 0.5,
      z: (z0 + z1) * 0.5,
      maxDistSq: 220 * 220,
    });
    disposables.push(fenceGeo);
  }

  function buildWaterWell(
    wx: number,
    wz: number,
    label: string,
    stale: boolean
  ): void {
    const wy = getTerrainHeight(wx, wz);
    const wellGroup = new THREE.Group();
    wellGroup.position.set(wx, wy, wz);
    wellGroup.userData.debugLayer = 'well';
    wellGroup.userData.debugName = stale ? `Decrepit Well (${label})` : `Spring Well (${label})`;
    wellGroup.userData.debugMeta = { stale, label };

    const wellShadowGeo = new THREE.PlaneGeometry(3.2, 3.2);
    wellShadowGeo.rotateX(-Math.PI / 2);
    const wellShadow = new THREE.Mesh(wellShadowGeo, contactShadowMat);
    wellShadow.position.y = 0.03;
    wellGroup.add(wellShadow);
    disposables.push(wellShadowGeo);

    const stoneGeo = new THREE.CylinderGeometry(0.92, 1.04, stale ? 0.84 : 1.0, 12);
    const stoneCyl = new THREE.Mesh(stoneGeo, stonePlinthMat);
    stoneCyl.position.y = stale ? 0.42 : 0.5;
    if (stale) stoneCyl.rotation.z = 0.07;
    stoneCyl.castShadow = shadows;
    stoneCyl.receiveShadow = true;
    wellGroup.add(stoneCyl);
    disposables.push(stoneGeo);

    const waterDiscGeo = new THREE.CircleGeometry(0.76, 12);
    waterDiscGeo.rotateX(-Math.PI / 2);
    const waterDisc = new THREE.Mesh(
      waterDiscGeo,
      stale ? staleWellWaterMat : cleanWellWaterMat
    );
    waterDisc.position.y = stale ? 0.72 : 0.84;
    wellGroup.add(waterDisc);
    disposables.push(waterDiscGeo);

    if (!stale) {
      const postGeo = new THREE.BoxGeometry(0.14, 2.0, 0.14);
      const roofGeo = new THREE.ConeGeometry(1.42, 0.96, 4);
      disposables.push(postGeo, roofGeo);
      [-0.85, 0.85].forEach((px) => {
        const post = new THREE.Mesh(postGeo, timberTrimMat);
        post.position.set(px, 1.5, 0);
        post.castShadow = shadows;
        wellGroup.add(post);
      });
      const wellRoof = new THREE.Mesh(roofGeo, shingleMat);
      wellRoof.position.y = 2.85;
      wellRoof.rotation.y = Math.PI / 4;
      wellRoof.castShadow = shadows;
      wellGroup.add(wellRoof);
    } else {
      // Broken crooked well post on decrepit abandoned hut well
      const brokenPostGeo = new THREE.BoxGeometry(0.13, 1.25, 0.13);
      disposables.push(brokenPostGeo);
      const post = new THREE.Mesh(brokenPostGeo, timberTrimMat);
      post.position.set(-0.82, 1.0, 0);
      post.rotation.z = 0.22;
      wellGroup.add(post);
    }

    scene.add(wellGroup);
    structureNodes.push({ obj: wellGroup, x: wx, z: wz, maxDistSq: 220 * 220 });
    circleColliders.push({ x: wx, z: wz, r: 1.1 });

    registerInteractive(stoneCyl, {
      name: stale
        ? t('prop.wellDecrepitName', { label })
        : t('prop.wellCleanName', { label }),
      desc: stale ? t('prop.wellDecrepitDesc') : t('prop.wellCleanDesc'),
      getName: () =>
        stale
          ? t('prop.wellDecrepitName', { label })
          : t('prop.wellCleanName', { label }),
      getDesc: () => (stale ? t('prop.wellDecrepitDesc') : t('prop.wellCleanDesc')),
      onUse: () => {
        sound.playFootstep('water');
        if (handlers?.onRefillWell) {
          handlers.onRefillWell(stale ? 'stale_well' : 'clean_well', label);
        } else {
          showToast(stale ? t('prop.wellDecrepitUse') : t('prop.wellCleanUse'));
        }
      },
      onTouch: () => showToast(stale ? t('prop.wellDecrepitTouch') : t('prop.wellCleanTouch')),
    });
  }

  // Build all 4 Procedural Villages
  for (let vi = 0; vi < bp.villages.length; vi++) {
    const v = bp.villages[vi];
    for (const b of v.buildings) {
      buildEstonianLogHouse(v.x + b.offsetX, v.z + b.offsetZ, b.rotY, {
        w: b.w,
        d: b.d,
        h: b.h,
        roofStyle: b.roofStyle,
        warmWood: b.warmWood,
        porch: b.porch,
        abandoned: b.abandoned,
        decayState: b.decayState,
        name: b.name,
        pantry: b === v.buildings[0],
      });
    }
    for (const f of v.fences) {
      buildSplitPoleFence(f.x0, f.z0, f.x1, f.z1);
    }

    // Every village has a usable clean spring well
    buildWaterWell(v.x - 4.5, v.z + 9.5, v.name, false);
  }

  // Build Abandoned Decay Huts on Elevated Swamp Islands + Usable or Decrepit Wells
  for (const isl of bp.swampIslands) {
    if (!isl.hut) continue;
    buildEstonianLogHouse(isl.x, isl.z, isl.hut.rotY, {
      w: isl.hut.w,
      d: isl.hut.d,
      h: isl.hut.h,
      roofStyle: isl.hut.roofStyle,
      abandoned: true,
      decayState: isl.hut.decayState,
      porch: isl.hut.decayState === 'intact',
      name: `${isl.name} — ${isl.hut.name}`,
    });

    // Intact huts have a clean spring well; decrepit/sagging/roofless/ruined huts have stale contaminated wells!
    const wellX = isl.x + Math.cos(isl.hut.rotY + 0.7) * (isl.hut.w * 0.5 + 3.2);
    const wellZ = isl.z + Math.sin(isl.hut.rotY + 0.7) * (isl.hut.d * 0.5 + 3.2);
    if (getTerrainHeight(wellX, wellZ) > SWAMP_WATER_Y + 0.08) {
      const isDecrepit = isl.hut.decayState !== 'intact';
      buildWaterWell(wellX, wellZ, isl.name, isDecrepit);
    }
  }

  // Pooled 2-slot dynamic PointLight system: replaces 8-9 global PointLights (#define NUM_POINT_LIGHTS 9 -> 2)
  // slashing forward lighting loops ~4.5x on EVERY terrain, tree, grass, and canopy pixel with zero visual loss!
  interface VirtualPointLight {
    anchor: THREE.Object3D;
    yOffset: number;
    colorHex: number;
    baseIntensity: number;
    distance: number;
    decay: number;
    flicker: boolean;
    isLit: () => boolean;
  }
  const virtualPointLights: VirtualPointLight[] = [];
  const pooledPointLights: [THREE.PointLight, THREE.PointLight] = [
    new THREE.PointLight(0xff8c36, 0, 22, 1.6),
    new THREE.PointLight(0xffaa44, 0, 16, 1.5),
  ];
  for (const light of pooledPointLights) {
    light.castShadow = true;
    light.shadow.mapSize.set(isSoftwareGl ? 256 : 512, isSoftwareGl ? 256 : 512);
    light.shadow.camera.near = 0.05;
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.015;
    light.shadow.autoUpdate = false;
  }
  pooledPointLights[0].visible = true;
  pooledPointLights[1].visible = true;
  scene.add(pooledPointLights[0], pooledPointLights[1]);

  const campfireHitProxyGeo = new THREE.CylinderGeometry(0.86, 0.92, 0.95, 10);
  const campfireHitProxyMat = new THREE.MeshBasicMaterial({ visible: false });
  disposables.push(campfireHitProxyGeo, campfireHitProxyMat);

  function buildCampfirePit(
    id: string,
    label: string,
    fx: number,
    fz: number,
    initiallyLit: boolean
  ): CampfireEntry {
    const fy = getTerrainHeight(fx, fz);
    const pit = new THREE.Group();
    pit.position.set(fx, fy, fz);
    pit.userData.debugLayer = 'campfire';
    pit.userData.debugName = `Campfire (${label})`;
    pit.userData.debugMeta = { id, initiallyLit };
    const stoneParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const sg = new THREE.DodecahedronGeometry(0.22, 0);
      sg.translate(Math.cos(a) * 0.72, 0.12, Math.sin(a) * 0.72);
      stoneParts.push(prepNonIndexed(sg));
    }
    const ringGeo = mergeGeometries(stoneParts)!;
    const ringMesh = new THREE.Mesh(ringGeo, stonePlinthMat);
    ringMesh.castShadow = shadows;
    pit.add(ringMesh);
    disposables.push(ringGeo);

    const ashBedGeo = new THREE.CircleGeometry(0.95, 16);
    ashBedGeo.rotateX(-Math.PI / 2);
    const ashBedMat = new THREE.MeshStandardMaterial({
      color: 0x26211c,
      roughness: 0.98,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const ashBed = new THREE.Mesh(ashBedGeo, ashBedMat);
    ashBed.position.y = 0.03;
    ashBed.receiveShadow = true;
    pit.add(ashBed);
    disposables.push(ashBedGeo, ashBedMat);

    // Invisible raycast volume over the fire flames so aiming at flames selects the campfire cleanly
    const hitProxy = new THREE.Mesh(campfireHitProxyGeo, campfireHitProxyMat);
    hitProxy.position.y = 0.48;
    pit.add(hitProxy);

    const fireSeed =
      (Math.round(fx * 37) * 73856093) ^ (Math.round(fz * 91) * 19349663) ^ campfires.length;
    const fire = createCampfireFireVisual(fireSeed, initiallyLit);
    pit.add(fire.group);
    disposables.push(fire);
    scene.add(pit);

    // Register a circular foliage-clearing zone so grass, moss, ferns, and bushes never grow through the fire
    shelters.add({
      id: `clearing_${id}`,
      x: fx,
      z: fz,
      yaw: 0,
      halfW: 1.75,
      halfD: 1.75,
      floorY: fy,
      temporary: !id.startsWith('fire_v'),
      clearingOnly: true,
      shape: 'circle',
      vegetationMargin: 0.0,
    });

    const entry: CampfireEntry = {
      id,
      label,
      x: fx,
      y: fy,
      z: fz,
      lit: initiallyLit,
      fire,
      pitGroup: pit,
    };
    campfires.push(entry);

    virtualPointLights.push({
      anchor: pit,
      yOffset: 0.8,
      colorHex: 0xff7d2b,
      baseIntensity: 2.8,
      distance: 22,
      decay: 1.6,
      flicker: true,
      isLit: () => entry.lit,
    });

    const getCampfireLabel = () =>
      entry.label === 'Wilderness' ? t('prop.campfireWilderness') : entry.label;
    const toCampfireInfo = (): CampfireInfo => ({
      id: entry.id,
      label: entry.label,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      lit: entry.lit,
    });
    registerInteractive(pit, {
      name: t('prop.campfireName', { label: getCampfireLabel() }),
      desc: t('prop.campfireDesc'),
      getName: () => t('prop.campfireName', { label: getCampfireLabel() }),
      getDesc: () => t('prop.campfireDesc'),
      getSecondaryActionLabel: () =>
        handlers?.hasFirewoodInPack?.() ? t('prop.campfireThrowLogAction') : undefined,
      onUse: () => {
        if (handlers?.onOpenCampfire) {
          handlers.onOpenCampfire(toCampfireInfo());
        } else {
          entry.lit = !entry.lit;
          entry.fire.setLit(entry.lit);
          sound.playImpact(0.5);
          showToast(entry.lit ? t('prop.campfireStoke') : t('prop.campfireBank'));
        }
      },
      onSecondaryAction: () => {
        handlers?.onThrowFirewoodAtCampfire?.(toCampfireInfo());
      },
      onTouch: () =>
        showToast(entry.lit ? t('prop.campfireTouchLit') : t('prop.campfireTouchCold')),
    });

    return entry;
  }

  // Starting homestead campfire starts lit; secondary village campfires can be ignited with Lighter/Matches
  const primaryFire = buildCampfirePit(
    'fire_v0',
    bp.villages[0].name,
    bp.villages[0].x + 1.5,
    bp.villages[0].z + 10.5,
    true
  );
  for (let vi = 1; vi < bp.villages.length; vi++) {
    const v = bp.villages[vi];
    buildCampfirePit(`fire_v${vi}`, v.name, v.x + 2.0, v.z + 10.2, false);
  }

  // Procedural Signposts
  function createSignpost(
    x: number,
    z: number,
    rotY: number,
    getTitle: () => string,
    getMessage: () => string
  ): void {
    const y = getTerrainHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.8, 0.14), timberTrimMat);
    post.position.y = 0.9;
    post.castShadow = shadows;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.44, 0.08), timberTrimMat);
    board.position.y = 1.55;
    board.castShadow = shadows;
    g.add(post, board);
    scene.add(g);
    circleColliders.push({ x, z, r: 0.22 });

    registerInteractive(board, {
      name: getTitle(),
      desc: t('prop.signpostDesc'),
      getName: getTitle,
      getDesc: () => t('prop.signpostDesc'),
      onUse: () => showToast(getMessage()),
      onTouch: () => showToast(getMessage()),
    });
  }

  createSignpost(
    -3.8,
    -5.5,
    0.3,
    () => t('prop.signpostMainTitle'),
    () => t('prop.signpostMainMsg', { village: bp.villages[0].name })
  );

  // ============================================================================
  // Extended Twin-Plank Swamp Boardwalk Linking Bog Trailhead -> Swamp Islands
  // ============================================================================
  {
    const trailStart = {
      x: bp.bogCenterX - bp.bogRadius * 0.72,
      z: bp.bogCenterZ - bp.bogRadius * 0.44,
    };
    createSignpost(
      trailStart.x - 2.5,
      trailStart.z - 2.0,
      -0.7,
      () => t('prop.signpostBogTitle'),
      () => t('prop.signpostBogMsg')
    );

    const plankMat = new THREE.MeshStandardMaterial({
      map: textures.plankWood,
      normalMap: textures.plankNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      color: 0xb2aa9c,
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.5,
    });
    const sleeperMat = new THREE.MeshStandardMaterial({
      map: textures.plankWood,
      normalMap: textures.plankNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: 0x72695c,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.42,
    });

    interface BoardwalkSeg {
      px: number;
      pz: number;
      angle: number;
      deckY: number;
      segLen: number;
    }
    const allSegs: BoardwalkSeg[] = [];

    function appendBoardwalkPath(ax: number, az: number, bx: number, bz: number): void {
      const dxTotal = bx - ax;
      const dzTotal = bz - az;
      const totalLen = Math.hypot(dxTotal, dzTotal);
      if (totalLen < 2) return;
      const steps = Math.max(4, Math.round(totalLen / 1.85));
      const segLen = totalLen / steps + 0.06;

      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const sway = Math.sin(t * Math.PI * 1.4) * Math.min(2.8, totalLen * 0.04);
        const px = ax + dxTotal * t - (dzTotal / totalLen) * sway;
        const pz = az + dzTotal * t + (dxTotal / totalLen) * sway;

        const tNext = Math.min(1, (i + 1.5) / steps);
        const swayNext = Math.sin(tNext * Math.PI * 1.4) * Math.min(2.8, totalLen * 0.04);
        const nx = ax + dxTotal * tNext - (dzTotal / totalLen) * swayNext;
        const nz = az + dzTotal * tNext + (dxTotal / totalLen) * swayNext;

        const angle = Math.atan2(nx - px, nz - pz);
        const groundY = getTerrainHeight(px, pz);
        const deckY = Math.max(SWAMP_WATER_Y + 0.32, groundY + 0.16);
        allSegs.push({ px, pz, angle, deckY, segLen });

        const halfW = 0.88;
        const halfL = segLen * 0.5 + 0.36;
        const cosYaw = Math.cos(angle);
        const sinYaw = Math.sin(angle);
        const extX = Math.abs(cosYaw) * halfW + Math.abs(sinYaw) * halfL;
        const extZ = Math.abs(sinYaw) * halfW + Math.abs(cosYaw) * halfL;
        boardwalkZones.push({
          minX: px - extX,
          maxX: px + extX,
          minZ: pz - extZ,
          maxZ: pz + extZ,
          y: deckY + 0.04,
          cx: px,
          cz: pz,
          cosYaw,
          sinYaw,
          halfW,
          halfL,
        });
      }
    }

    const linkedIslands = bp.swampIslands.filter((isl) => isl.linkedByBoardwalk);
    let curX = trailStart.x;
    let curZ = trailStart.z;
    for (const isl of linkedIslands) {
      const dirX = isl.x - curX;
      const dirZ = isl.z - curZ;
      const dist = Math.hypot(dirX, dirZ);
      const stopR = Math.max(4, isl.radius * 0.62);
      const tx = dist > stopR ? isl.x - (dirX / dist) * stopR : isl.x;
      const tz = dist > stopR ? isl.z - (dirZ / dist) * stopR : isl.z;
      appendBoardwalkPath(curX, curZ, tx, tz);
      curX = tx;
      curZ = tz;
    }

    if (allSegs.length > 0) {
      const avgLen = allSegs[0].segLen;
      const twinPlankGeo = mergeGeometries([
        makeBoxPart(0.46, 0.07, avgLen + 0.25, -0.26, 0, 0),
        makeBoxPart(0.46, 0.07, avgLen + 0.25, 0.26, 0, 0),
      ])!;
      const sleeperGeo = new THREE.BoxGeometry(1.55, 0.09, 0.16);
      const plankInst = new THREE.InstancedMesh(twinPlankGeo, plankMat, allSegs.length);
      const sleeperInst = new THREE.InstancedMesh(sleeperGeo, sleeperMat, allSegs.length);
      plankInst.userData.debugLayer = 'boardwalk';
      plankInst.userData.debugName = 'Swamp Boardwalk Planks';
      sleeperInst.userData.debugLayer = 'boardwalk';
      sleeperInst.userData.debugName = 'Swamp Boardwalk Sleepers';
      plankInst.receiveShadow = true;
      plankInst.castShadow = shadows;
      sleeperInst.receiveShadow = true;

      const dummy = new THREE.Object3D();
      for (let i = 0; i < allSegs.length; i++) {
        const s = allSegs[i];
        dummy.position.set(s.px, s.deckY, s.pz);
        dummy.rotation.set(0, s.angle, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        plankInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(s.px, s.deckY - 0.075, s.pz);
        dummy.updateMatrix();
        sleeperInst.setMatrixAt(i, dummy.matrix);
      }
      plankInst.instanceMatrix.needsUpdate = true;
      sleeperInst.instanceMatrix.needsUpdate = true;
      scene.add(plankInst, sleeperInst);
      structureNodes.push({ obj: plankInst, x: bp.bogCenterX, z: bp.bogCenterZ, maxDistSq: 450 * 450 });
      disposables.push(twinPlankGeo, sleeperGeo, plankMat, sleeperMat);
    }
  }

  // ============================================================================
  // Dynamic Physics Props + Matte-Black Storm Lanterns
  // ============================================================================
  const crateMat = new THREE.MeshStandardMaterial({
    map: textures.plankWood,
    normalMap: textures.plankNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    color: 0x856a49,
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.48,
  });
  const barrelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.95, 14);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x5c372a, roughness: 0.58, metalness: 0.45 });
  const logGeo = new THREE.CylinderGeometry(0.11, 0.12, 0.65, 8);
  const logMat = new THREE.MeshStandardMaterial({
    map: textures.birchBark,
    normalMap: textures.birchNormal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.88,
    metalness: 0.0,
  });
  const stonePropMat = new THREE.MeshStandardMaterial({
    map: textures.boulderGranite,
    normalMap: textures.fieldstoneNormal,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughness: 0.86,
    metalness: 0.02,
  });
  const lanternMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1a1c1e,
    metalness: 0.78,
    roughness: 0.38,
    envMapIntensity: 1.1,
  });
  const lanternGlassMat = new THREE.MeshStandardMaterial({
    color: 0xdce4e6,
    roughness: 0.08,
    metalness: 0.12,
    envMapIntensity: 1.4,
    transparent: true,
    opacity: 0.45,
  });
  disposables.push(
    crateMat,
    barrelGeo,
    barrelMat,
    logGeo,
    logMat,
    stonePropMat,
    lanternMetalMat,
    lanternGlassMat
  );

  const lanternMetalGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(makeCylPart(0.115, 0.135, 0.075, 14, 0, -0.145, 0));
    parts.push(makeCylPart(0.08, 0.115, 0.035, 14, 0, -0.09, 0));
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.11, -0.1, 0),
        new THREE.Vector3(side * 0.14, 0.02, 0),
        new THREE.Vector3(side * 0.11, 0.15, 0),
        new THREE.Vector3(side * 0.045, 0.19, 0),
      ]);
      parts.push(prepNonIndexed(new THREE.TubeGeometry(curve, 8, 0.012, 5, false)));
    }
    const wireRing1 = new THREE.TorusGeometry(0.095, 0.004, 4, 14);
    wireRing1.rotateX(Math.PI / 2);
    wireRing1.translate(0, 0.02, 0);
    parts.push(prepNonIndexed(wireRing1));
    parts.push(makeCylPart(0.06, 0.085, 0.055, 12, 0, 0.145, 0));
    parts.push(makeCylPart(0.045, 0.065, 0.04, 12, 0, 0.185, 0));
    parts.push(makeCylPart(0.09, 0.09, 0.012, 12, 0, 0.21, 0));
    const bailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.125, 0.06, 0),
      new THREE.Vector3(-0.12, 0.29, 0),
      new THREE.Vector3(0, 0.36, 0),
      new THREE.Vector3(0.12, 0.29, 0),
      new THREE.Vector3(0.125, 0.06, 0),
    ]);
    parts.push(prepNonIndexed(new THREE.TubeGeometry(bailCurve, 12, 0.005, 4, false)));
    return mergeGeometries(parts)!;
  })();
  const lanternGlobeGeo = new THREE.CylinderGeometry(0.072, 0.086, 0.17, 12);
  const lanternFlameGeo = new THREE.ConeGeometry(0.024, 0.065, 6);
  disposables.push(lanternMetalGeo, lanternGlobeGeo, lanternFlameGeo);

  function spawnCrate(x: number, z: number, size = 0.72): void {
    const y = getTerrainHeight(x, z) + size / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), crateMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    registerInteractive(mesh, {
      name: t('prop.woodenCrate'),
      desc: t('prop.woodenCrateDesc'),
      getName: () => t('prop.woodenCrate'),
      getDesc: () => t('prop.woodenCrateDesc'),
      carryable: true,
      kickable: true,
      breakable: true,
      isDynamic: true,
      materialType: 'wood',
      radius: size * 0.55,
      mass: 1.8,
      onGroundYOffset: size * 0.5,
    });
  }

  function spawnBarrel(x: number, z: number): void {
    const y = getTerrainHeight(x, z) + 0.95 / 2;
    const mesh = new THREE.Mesh(barrelGeo, barrelMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    registerInteractive(mesh, {
      name: t('prop.oilDrum'),
      desc: t('prop.oilDrumDesc'),
      getName: () => t('prop.oilDrum'),
      getDesc: () => t('prop.oilDrumDesc'),
      carryable: false,
      kickable: true,
      isDynamic: true,
      materialType: 'metal',
      radius: 0.42,
      mass: 2.5,
      onGroundYOffset: 0.95 / 2,
    });
  }

  function spawnLantern(x: number, z: number, initiallyLit = true): void {
    const y = getTerrainHeight(x, z) + 0.19;
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const chassis = new THREE.Mesh(lanternMetalGeo, lanternMetalMat);
    chassis.castShadow = shadows;
    const globe = new THREE.Mesh(lanternGlobeGeo, lanternGlassMat);
    globe.position.y = 0.02;

    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffba49 });
    disposables.push(flameMat);
    const flame = new THREE.Mesh(lanternFlameGeo, flameMat);
    flame.position.y = -0.02;
    flame.visible = initiallyLit;

    group.add(chassis, globe, flame);
    scene.add(group);

    let lit = initiallyLit;
    virtualPointLights.push({
      anchor: group,
      yOffset: 0.04,
      colorHex: 0xffaa44,
      baseIntensity: 1.85,
      distance: 16,
      decay: 1.5,
      flicker: false,
      isLit: () => lit,
    });

    registerInteractive(group, {
      name: t('prop.lanternName'),
      desc: t('prop.lanternDesc'),
      getName: () => t('prop.lanternName'),
      getDesc: () => t('prop.lanternDesc'),
      carryable: true,
      kickable: true,
      isDynamic: true,
      radius: 0.22,
      mass: 0.7,
      onGroundYOffset: 0.18,
      onTouch: () => {
        lit = !lit;
        flame.visible = lit;
        showToast(lit ? t('prop.lanternLit') : t('prop.lanternDimmed'));
      },
    });
  }

  const splitWoodMat = new THREE.MeshStandardMaterial({
    map: textures.birchBark,
    color: 0xd9c29c,
    roughness: 0.78,
  });
  const deadwoodBarkMat = new THREE.MeshStandardMaterial({
    map: textures.spruceBark,
    color: 0x76624e,
    roughness: 0.93,
  });
  const stumpMossMat = new THREE.MeshStandardMaterial({
    color: 0x4d6b38,
    roughness: 0.92,
  });
  const splitPieceGeo = new THREE.CylinderGeometry(0.068, 0.082, 0.56, 6);
  const barkCapGeo = new THREE.BoxGeometry(0.52, 0.04, 0.12);
  const chipGeo = new THREE.BoxGeometry(0.11, 0.035, 0.22);
  const woodHitProxyGeo = new THREE.SphereGeometry(0.42, 6, 6);
  const woodHitProxyMat = new THREE.MeshBasicMaterial({ visible: false });
  disposables.push(
    splitWoodMat,
    deadwoodBarkMat,
    stumpMossMat,
    splitPieceGeo,
    barkCapGeo,
    chipGeo,
    woodHitProxyGeo,
    woodHitProxyMat
  );

  const breakableStumps: Array<{ x: number; z: number; entry: InteractiveEntry }> = [];
  const pickupItems: Array<{ x: number; z: number; entry: InteractiveEntry }> = [];

  function spawnSplitWoodPiece(
    x: number,
    y: number,
    z: number,
    vx = 0,
    vy = 0,
    vz = 0
  ): InteractiveEntry {
    const piece = new THREE.Group();
    const core = new THREE.Mesh(splitPieceGeo, splitWoodMat);
    core.rotation.z = Math.PI / 2;
    core.castShadow = shadows;
    core.receiveShadow = true;
    const barkCap = new THREE.Mesh(barkCapGeo, deadwoodBarkMat);
    barkCap.position.y = 0.065;
    const hitProxy = new THREE.Mesh(woodHitProxyGeo, woodHitProxyMat);
    hitProxy.position.y = 0.05;
    piece.add(core, barkCap, hitProxy);
    piece.position.set(x, y, z);
    piece.rotation.y = rand() * Math.PI * 2;
    scene.add(piece);

    const entry = registerInteractive(piece, {
      name: t('prop.splitFirewoodName'),
      desc: t('prop.splitFirewoodDesc'),
      getName: () => t('prop.splitFirewoodName'),
      getDesc: () => t('prop.splitFirewoodDesc'),
      pickupItemId: 'firewood',
      pickupLabel: t('prompt.takeWood'),
      getPickupLabel: () => t('prompt.takeWood'),
      carryable: false,
      kickable: true,
      isDynamic: true,
      radius: 0.16,
      mass: 0.75,
      onGroundYOffset: 0.09,
    });
    entry.vel.set(vx, vy, vz);
    entry.angVel.set((rand() - 0.5) * 6, (rand() - 0.5) * 6, (rand() - 0.5) * 6);
    entry.resting = vx === 0 && vy === 0 && vz === 0;
    pickupItems.push({ x, z, entry });
    return entry;
  }

  function shatterWoodAt(
    x: number,
    _y: number,
    z: number,
    yaw: number,
    pieceCount?: number
  ): number {
    const count = pieceCount ?? 3 + (rand() > 0.45 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const ang = yaw + (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      const dist = 0.28 + rand() * 0.55;
      const px = x + Math.cos(ang) * dist;
      const pz = z + Math.sin(ang) * dist;
      const py = getTerrainHeight(px, pz) + 0.24;
      spawnSplitWoodPiece(
        px,
        py,
        pz,
        Math.cos(ang) * (1.7 + rand() * 1.3),
        1.7 + rand() * 1.0,
        Math.sin(ang) * (1.7 + rand() * 1.3)
      );
    }

    // Leave a few small wood splinters on the ground where the timber broke
    for (let c = 0; c < 4; c++) {
      const chip = new THREE.Mesh(chipGeo, c % 2 === 0 ? splitWoodMat : deadwoodBarkMat);
      const ca = rand() * Math.PI * 2;
      const cd = 0.15 + rand() * 0.72;
      const cx = x + Math.cos(ca) * cd;
      const cz = z + Math.sin(ca) * cd;
      chip.position.set(cx, getTerrainHeight(cx, cz) + 0.025, cz);
      chip.rotation.y = rand() * Math.PI;
      scene.add(chip);
    }
    return count;
  }

  function spawnLyingStump(x: number, z: number): void {
    const y = getTerrainHeight(x, z);
    if (y <= SWAMP_WATER_Y + 0.14) return;
    const yaw = rand() * Math.PI * 2;
    const scale = 0.88 + rand() * 0.34;

    // Composite 5-part fallen weathered treestump (trunk + root flare + broken limb + moss patch + heartwood end)
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;

    const trunkLen = 1.65 * scale;
    const trunkR = 0.23 * scale;
    const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.82, trunkR * 1.12, trunkLen, 8);
    const trunk = new THREE.Mesh(trunkGeo, deadwoodBarkMat);
    trunk.rotation.z = Math.PI / 2;
    trunk.position.set(0, trunkR * 0.82, 0);
    trunk.castShadow = shadows;
    trunk.receiveShadow = true;

    const heartGeo = new THREE.CylinderGeometry(trunkR * 0.74, trunkR * 0.74, 0.04, 8);
    const heartEnd = new THREE.Mesh(heartGeo, splitWoodMat);
    heartEnd.rotation.z = Math.PI / 2;
    heartEnd.position.set(trunkLen * 0.5 + 0.01, trunkR * 0.82, 0);

    const rootGeo = new THREE.ConeGeometry(trunkR * 0.52, 0.62 * scale, 5);
    const rootA = new THREE.Mesh(rootGeo, deadwoodBarkMat);
    rootA.position.set(-trunkLen * 0.52, trunkR * 1.1, 0.22 * scale);
    rootA.rotation.set(0.55, 0, 1.05);
    const rootB = new THREE.Mesh(rootGeo, deadwoodBarkMat);
    rootB.position.set(-trunkLen * 0.52, trunkR * 0.75, -0.24 * scale);
    rootB.rotation.set(-0.6, 0, 1.25);

    const stubGeo = new THREE.CylinderGeometry(0.055 * scale, 0.085 * scale, 0.48 * scale, 6);
    const stub = new THREE.Mesh(stubGeo, deadwoodBarkMat);
    stub.position.set(0.2 * scale, trunkR * 1.45, 0.12 * scale);
    stub.rotation.set(0.35, 0, -0.55);

    const mossGeo = new THREE.BoxGeometry(0.68 * scale, 0.05, 0.24 * scale);
    const moss = new THREE.Mesh(mossGeo, stumpMossMat);
    moss.position.set(-0.12 * scale, trunkR * 1.62, 0);

    g.add(trunk, heartEnd, rootA, rootB, stub, moss);
    scene.add(g);
    disposables.push(trunkGeo, heartGeo, rootGeo, stubGeo, mossGeo);

    let kicksRemaining = 2;
    const stumpEntry = registerInteractive(g, {
      name: t('prop.lyingStumpName'),
      desc: t('prop.lyingStumpDesc'),
      getName: () => t('prop.lyingStumpName'),
      getDesc: () => t('prop.lyingStumpDesc'),
      kickable: true,
      breakable: true,
      radius: 0.65 * scale,
      mass: 4.5,
      onTouch: () => showToast(t('prop.lyingStumpTouch')),
    });

    stumpEntry.onKick = () => {
      if (stumpEntry.gathered) return;
      kicksRemaining--;
      if (kicksRemaining > 0) {
        // First kick cracks & jolts the lying treestump
        g.rotation.z += 0.12;
        g.rotation.y += 0.09;
        g.updateMatrixWorld(true);
        if (handlers?.onStumpKick) {
          handlers.onStumpKick({ broken: false, material: 'wood', x, y: y + 0.25, z });
        } else {
          sound.playImpact(1.1);
        }
        showToast(t('prop.stumpCracked'));
        return;
      }

      // Second kick shatters the stump into 3-4 physical Split Firewood pieces + ground splinters
      stumpEntry.gathered = true;
      interactiveIndex.delete(stumpEntry);
      g.visible = false;
      if (handlers?.onStumpKick) {
        handlers.onStumpKick({ broken: true, material: 'wood', x, y: y + 0.25, z });
      } else {
        sound.playImpact(1.45);
      }
      const pieceCount = shatterWoodAt(x, y, z, yaw);
      showToast(t('prop.stumpShattered', { count: pieceCount }));
    };

    breakableStumps.push({ x, z, entry: stumpEntry });
  }

  function spawnFirewoodLog(x: number, z: number, yOverride?: number): InteractiveEntry {
    const y = yOverride ?? getTerrainHeight(x, z) + 0.12;
    const logGroup = new THREE.Group();
    logGroup.position.set(x, y, z);
    logGroup.rotation.y = rand() * Math.PI;
    const mesh = new THREE.Mesh(logGeo, logMat);
    mesh.rotation.z = Math.PI / 2;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    const hitProxy = new THREE.Mesh(woodHitProxyGeo, woodHitProxyMat);
    hitProxy.position.y = 0.04;
    logGroup.add(mesh, hitProxy);
    scene.add(logGroup);
    const entry = registerInteractive(logGroup, {
      name: t('prop.birchFirewoodName'),
      desc: t('prop.birchFirewoodDesc'),
      getName: () => t('prop.birchFirewoodName'),
      getDesc: () => t('prop.birchFirewoodDesc'),
      pickupItemId: 'firewood',
      pickupLabel: t('prompt.takeWood'),
      getPickupLabel: () => t('prompt.takeWood'),
      carryable: false,
      kickable: true,
      isDynamic: true,
      radius: 0.2,
      mass: 0.9,
      onGroundYOffset: 0.12,
    });
    pickupItems.push({ x, z, entry });
    return entry;
  }

  function spawnStone(x: number, z: number): void {
    const r = 0.18 + rand() * 0.12;
    const y = getTerrainHeight(x, z) + r;
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stonePropMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    registerInteractive(mesh, {
      name: t('prop.fieldstoneName'),
      desc: t('prop.fieldstoneDesc'),
      getName: () => t('prop.fieldstoneName'),
      getDesc: () => t('prop.fieldstoneDesc'),
      carryable: true,
      kickable: true,
      isDynamic: true,
      radius: r,
      mass: 1.2,
      onGroundYOffset: r,
    });
  }

  for (let vi = 0; vi < bp.villages.length; vi++) {
    const v = bp.villages[vi];
    spawnLantern(v.x + 1.8, v.z + 11.2, !v.abandoned);
    spawnCrate(v.x - 1.2, v.z + 5.2);
    spawnCrate(v.x - 2.0, v.z + 5.6, 0.58);
    spawnBarrel(v.x - 6.2, v.z + 4.8);
    for (let k = 0; k < 3; k++) {
      spawnFirewoodLog(v.x + 3.2 + (rand() - 0.5) * 1.4, v.z + 7.2 + (rand() - 0.5) * 1.4);
    }
    // 2 lying treestumps near each village forest edge
    spawnLyingStump(v.x - 9.5, v.z + 15.0);
    spawnLyingStump(v.x + 11.5, v.z + 13.5);
  }
  // Guaranteed easy-to-spot lying treestump right beside the starting road edge
  spawnLyingStump(roadCenterX(0) - 4.4, -0.8);
  spawnLyingStump(roadCenterX(-8) + 4.8, -8.5);

  for (const isl of bp.swampIslands) {
    if (isl.hut) {
      spawnCrate(isl.x + 3.4, isl.z + 1.8, 0.58);
      if (isl.hut.decayState !== 'ruins') {
        spawnLantern(isl.x - 2.8, isl.z + 2.2, false);
      }
      spawnLyingStump(isl.x - 3.6, isl.z - 2.8);
    }
  }
  for (let i = 0; i < 55; i++) {
    const lx = (rand() - 0.5) * 920;
    const lz = (rand() - 0.5) * 920;
    if (getSwampFactor(lx, lz) < 0.32 && distToRoadDetail(lx, lz).dist > 4.2) {
      spawnLyingStump(lx, lz);
    }
  }
  for (let i = 0; i < 42; i++) {
    const sx = (rand() - 0.5) * 900;
    const sz = (rand() - 0.5) * 900;
    if (getSwampFactor(sx, sz) < 0.3 && distToRoadDetail(sx, sz).dist > 3.5) {
      spawnStone(sx, sz);
    }
  }

  // ============================================================================
  // Photorealistic Gatherable Estonian Mushrooms — All 7 Species!
  // Hero botanical craftsmanship on Punane kärbseseen & Valge kärbseseen
  // ============================================================================
  const chanterelleMat = new THREE.MeshStandardMaterial({
    map: textures.chanterelleTex,
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.0,
    envMapIntensity: 0.72,
  });
  const saffronCapMat = new THREE.MeshStandardMaterial({
    map: textures.saffronCapTex,
    roughness: 0.34,
    metalness: 0.0,
    envMapIntensity: 0.78,
  });
  const porciniCapMat = new THREE.MeshStandardMaterial({
    map: textures.boleteCap,
    normalMap: textures.boleteNormal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    color: 0xd4966c,
    roughness: 0.3,
    metalness: 0.0,
    envMapIntensity: 0.85,
  });
  const porciniStemMat = new THREE.MeshStandardMaterial({
    map: textures.boleteStem,
    roughness: 0.74,
    metalness: 0.0,
    envMapIntensity: 0.5,
  });
  const birchBoleteCapMat = new THREE.MeshStandardMaterial({
    map: textures.boleteCap,
    normalMap: textures.boleteNormal,
    normalScale: new THREE.Vector2(0.65, 0.65),
    color: 0xbda38a,
    roughness: 0.36,
    metalness: 0.0,
    envMapIntensity: 0.75,
  });
  const birchBoleteStemMat = new THREE.MeshStandardMaterial({
    map: textures.birchBoleteStem,
    roughness: 0.78,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });
  const boletePoreMat = new THREE.MeshStandardMaterial({
    color: 0xdccda4,
    roughness: 0.88,
    metalness: 0.0,
  });
  const bitterCapMat = new THREE.MeshStandardMaterial({
    map: textures.boleteCap,
    normalMap: textures.boleteNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    color: 0x9c8260,
    roughness: 0.38,
    metalness: 0.0,
  });
  const bitterPoreMat = new THREE.MeshStandardMaterial({
    color: 0xdca0a4,
    roughness: 0.84,
    metalness: 0.0,
  });

  // Hero Species: Punane kärbseseen (Amanita muscaria) — glossy wet scarlet-orange cuticle + sculpted warts
  const flyAgaricCapMat = new THREE.MeshStandardMaterial({
    map: textures.flyAgaricCap,
    normalMap: textures.flyAgaricNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.24,
    metalness: 0.02,
    envMapIntensity: 1.0,
  });
  // Hero Species: Valge kärbseseen (Amanita virosa / Destroying Angel) — porcelain-ivory silky sheen
  const destroyingAngelCapMat = new THREE.MeshStandardMaterial({
    map: textures.destroyingAngelCap,
    roughness: 0.22,
    metalness: 0.02,
    envMapIntensity: 0.95,
  });
  const amanitaGillsMat = new THREE.MeshStandardMaterial({
    map: textures.amanitaGills,
    roughness: 0.72,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const amanitaStemMat = new THREE.MeshStandardMaterial({
    color: 0xf6f3ea,
    roughness: 0.68,
    metalness: 0.0,
    envMapIntensity: 0.55,
  });
  const amanitaWartMat = new THREE.MeshStandardMaterial({
    color: 0xf2ead6,
    roughness: 0.82,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });

  const mushShadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadowTex,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const hitProxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitProxyGeo = new THREE.SphereGeometry(0.32, 6, 6);
  const mushShadowGeo = new THREE.PlaneGeometry(0.46, 0.46);
  mushShadowGeo.rotateX(-Math.PI / 2);
  mushShadowGeo.translate(0, 0.012, 0);

  disposables.push(
    chanterelleMat,
    saffronCapMat,
    porciniCapMat,
    porciniStemMat,
    birchBoleteCapMat,
    birchBoleteStemMat,
    boletePoreMat,
    bitterCapMat,
    bitterPoreMat,
    flyAgaricCapMat,
    destroyingAngelCapMat,
    amanitaGillsMat,
    amanitaStemMat,
    amanitaWartMat,
    mushShadowMat,
    hitProxyMat,
    hitProxyGeo,
    mushShadowGeo
  );

  // Ruffled golden Chanterelle funnel
  const chanterelleBodyGeo = (() => {
    const funnelPts = [
      new THREE.Vector2(0.0, 0.02),
      new THREE.Vector2(0.017, 0.0),
      new THREE.Vector2(0.023, 0.058),
      new THREE.Vector2(0.056, 0.115),
      new THREE.Vector2(0.098, 0.142),
      new THREE.Vector2(0.082, 0.148),
      new THREE.Vector2(0.032, 0.12),
      new THREE.Vector2(0.0, 0.106),
    ];
    const g = prepNonIndexed(new THREE.LatheGeometry(funnelPts, 16));
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const stemCol = new THREE.Color(0xf4d478);
    const rimCol = new THREE.Color(0xee9c1a);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const r = Math.hypot(px, pz);
      if (r > 0.038 && py > 0.095) {
        const ang = Math.atan2(pz, px);
        const wave = Math.sin(ang * 5.0) * 0.018 + Math.cos(ang * 3.0) * 0.01;
        pos.setY(i, py + wave * (r / 0.098));
      }
      const t = clamp((py - 0.015) / 0.13, 0, 1);
      cols[i * 3] = stemCol.r + (rimCol.r - stemCol.r) * t;
      cols[i * 3 + 1] = stemCol.g + (rimCol.g - stemCol.g) * t;
      cols[i * 3 + 2] = stemCol.b + (rimCol.b - stemCol.b) * t;
    }
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  })();

  // Kuuseriisikas (Saffron Milk Cap) concentric saucer cap with planar top UV
  const saffronBodyGeo = (() => {
    const pts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.024, 0.0),
      new THREE.Vector2(0.026, 0.092),
      new THREE.Vector2(0.114, 0.104),
      new THREE.Vector2(0.128, 0.126),
      new THREE.Vector2(0.064, 0.132),
      new THREE.Vector2(0.0, 0.114),
    ];
    const g = prepNonIndexed(new THREE.LatheGeometry(pts, 16));
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = clamp(pos.getX(i) / 0.26 + 0.5, 0, 1);
      uvs[i * 2 + 1] = clamp(pos.getZ(i) / 0.26 + 0.5, 0, 1);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return g;
  })();

  // Kivipuravik (Boletus edulis) plump club stem + thick domed cap + pale olive spongy pores
  const porciniStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.056, 0.0),
      new THREE.Vector2(0.078, 0.055),
      new THREE.Vector2(0.06, 0.118),
      new THREE.Vector2(0.046, 0.158),
      new THREE.Vector2(0.0, 0.158),
    ],
    16
  );
  const porciniCapGeo = (() => {
    const g = new THREE.SphereGeometry(0.138, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
    g.scale(1.0, 0.78, 1.0);
    g.translate(0, 0.136, 0);
    return g;
  })();
  const porciniPoreGeo = (() => {
    const g = new THREE.SphereGeometry(0.132, 16, 6, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48);
    g.scale(1.0, 0.18, 1.0);
    g.translate(0, 0.136, 0);
    return g;
  })();

  const birchBoleteStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.038, 0.0),
      new THREE.Vector2(0.032, 0.09),
      new THREE.Vector2(0.024, 0.185),
      new THREE.Vector2(0.0, 0.185),
    ],
    14
  );
  const birchBoleteCapGeo = (() => {
    const g = new THREE.SphereGeometry(0.108, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58);
    g.scale(1.0, 0.82, 1.0);
    g.translate(0, 0.165, 0);
    return g;
  })();
  const birchBoletePoreGeo = (() => {
    const g = new THREE.CircleGeometry(0.104, 14);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.164, 0);
    return g;
  })();

  // ---- HERO 1: Punane kärbseseen (Amanita muscaria) ----
  // Concentric scaly bulbous volva + sturdy white stipe + drooping striated skirt annulus
  const flyAgaricStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.052, 0.0),
      new THREE.Vector2(0.064, 0.028), // bulbous scaly volva base
      new THREE.Vector2(0.056, 0.048),
      new THREE.Vector2(0.044, 0.056), // volva collar ridge
      new THREE.Vector2(0.032, 0.078),
      new THREE.Vector2(0.027, 0.148),
      new THREE.Vector2(0.054, 0.136), // drooping flared annulus skirt!
      new THREE.Vector2(0.048, 0.158),
      new THREE.Vector2(0.025, 0.172),
      new THREE.Vector2(0.024, 0.232),
      new THREE.Vector2(0.0, 0.232),
    ],
    16
  );

  // Broad domed scarlet cap with planar radial top UVs matching flyAgaricCap texture
  const flyAgaricCapGeo = (() => {
    const g = prepNonIndexed(
      new THREE.SphereGeometry(0.138, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.54)
    );
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      // Gentle natural organic wave at the cap margin
      const ang = Math.atan2(pz, px);
      const rFrac = Math.hypot(px, pz) / 0.138;
      const rimWave = Math.sin(ang * 4.0 + 0.5) * 0.0045 * rFrac * rFrac;
      pos.setY(i, py * 0.62 + 0.214 + rimWave);
      uvs[i * 2] = clamp(px / (0.138 * 2.02) + 0.5, 0.01, 0.99);
      uvs[i * 2 + 1] = clamp(pz / (0.138 * 2.02) + 0.5, 0.01, 0.99);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  })();

  const flyAgaricGillsGeo = (() => {
    const g = new THREE.CircleGeometry(0.134, 20);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.213, 0);
    return g;
  })();

  // Sculpted organic flattened pebble-warts hugging the dome curvature (NO cubes!)
  const flyAgaricWartsGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const wr = seededRand(777);
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const nVec = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      const phi = Math.acos(1 - ((i + 0.45) / 24) * 0.78);
      const theta = i * 2.39996 + wr() * 0.28;
      const rad = 0.138;
      const wx = Math.sin(phi) * Math.cos(theta) * rad;
      const wy = Math.cos(phi) * rad * 0.62 + 0.214;
      const wz = Math.sin(phi) * Math.sin(theta) * rad;
      nVec.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi) / 0.62, Math.sin(phi) * Math.sin(theta)).normalize();
      q.setFromUnitVectors(up, nVec);

      const sz = (0.008 + wr() * 0.007) * (1.15 - phi * 0.35);
      const pebble = new THREE.IcosahedronGeometry(sz, 0);
      pebble.scale(1.15 + wr() * 0.45, 0.44 + wr() * 0.18, 0.95 + wr() * 0.4);
      pebble.applyQuaternion(q);
      pebble.translate(wx, wy, wz);
      parts.push(prepNonIndexed(pebble));
    }
    return mergeGeometries(parts)!;
  })();

  // Young scarlet Fly Agaric egg-button bursting from its white universal veil!
  const flyAgaricButtonCapGeo = (() => {
    const g = prepNonIndexed(new THREE.SphereGeometry(0.068, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.74));
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      pos.setY(i, py * 0.95 + 0.088);
      uvs[i * 2] = clamp(px / 0.15 + 0.5, 0.02, 0.98);
      uvs[i * 2 + 1] = clamp(pz / 0.15 + 0.5, 0.02, 0.98);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  })();
  const flyAgaricButtonStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.056, 0.0),
      new THREE.Vector2(0.062, 0.042),
      new THREE.Vector2(0.052, 0.072),
      new THREE.Vector2(0.036, 0.095),
      new THREE.Vector2(0.0, 0.095),
    ],
    14
  );

  // ---- HERO 2: Valge kärbseseen (Amanita virosa — Destroying Angel) ----
  // Tall slender shaggy-floccose stem + prominent papery cup-like volva sac + delicate ragged skirt ring
  const destroyingAngelStemGeo = (() => {
    const g = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.046, 0.0),
        new THREE.Vector2(0.056, 0.036), // swollen papery cup volva sac!
        new THREE.Vector2(0.058, 0.076), // open papery volva rim
        new THREE.Vector2(0.042, 0.072),
        new THREE.Vector2(0.026, 0.056),
        new THREE.Vector2(0.022, 0.175),
        new THREE.Vector2(0.044, 0.168), // delicate ragged drooping skirt ring
        new THREE.Vector2(0.038, 0.194),
        new THREE.Vector2(0.018, 0.205),
        new THREE.Vector2(0.017, 0.278),
        new THREE.Vector2(0.0, 0.278),
      ],
      22
    );
    // Subtle organic shaggy floccose irregularity along the tall white stem
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      if (py > 0.078 && py < 0.265) {
        const px = pos.getX(i);
        const pz = pos.getZ(i);
        const ang = Math.atan2(pz, px);
        const shag = 1.0 + Math.sin(py * 95.0 + ang * 3.0) * 0.05;
        pos.setX(i, px * shag);
        pos.setZ(i, pz * shag);
      }
    }
    g.computeVertexNormals();
    return g;
  })();

  // Signature tall conical-bell umbonate porcelain-white Destroying Angel cap!
  const destroyingAngelCapGeo = (() => {
    const pts = [
      new THREE.Vector2(0.112, 0.236),
      new THREE.Vector2(0.106, 0.252),
      new THREE.Vector2(0.088, 0.285),
      new THREE.Vector2(0.062, 0.326),
      new THREE.Vector2(0.034, 0.354),
      new THREE.Vector2(0.012, 0.368),
      new THREE.Vector2(0.0, 0.371),
    ];
    const g = new THREE.LatheGeometry(pts, 28);
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      // Slight asymmetrical tilt typical of Amanita virosa bells
      const ang = Math.atan2(pz, px);
      const rFrac = Math.hypot(px, pz) / 0.112;
      const tilt = Math.sin(ang + 0.8) * 0.01 * rFrac;
      const lobe = Math.cos(ang * 3.0) * 0.005 * rFrac * rFrac;
      pos.setY(i, py + tilt + lobe);
      uvs[i * 2] = clamp(px / 0.23 + 0.5, 0.01, 0.99);
      uvs[i * 2 + 1] = clamp(pz / 0.23 + 0.5, 0.01, 0.99);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  })();

  const destroyingAngelGillsGeo = (() => {
    const g = new THREE.CircleGeometry(0.109, 18);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.242, 0);
    return g;
  })();

  disposables.push(
    chanterelleBodyGeo,
    saffronBodyGeo,
    porciniStemGeo,
    porciniCapGeo,
    porciniPoreGeo,
    birchBoleteStemGeo,
    birchBoleteCapGeo,
    birchBoletePoreGeo,
    flyAgaricStemGeo,
    flyAgaricCapGeo,
    flyAgaricGillsGeo,
    flyAgaricWartsGeo,
    flyAgaricButtonCapGeo,
    flyAgaricButtonStemGeo,
    destroyingAngelStemGeo,
    destroyingAngelCapGeo,
    destroyingAngelGillsGeo
  );

  let mushroomCountTotal = 0;

  function spawnMushroom(x: number, z: number, species: MushroomSpecies): void {
    const y = getTerrainHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);

    const padMesh = new THREE.Mesh(mushShadowGeo, mushShadowMat);
    g.add(padMesh);

    if (species === 'kukeseen' || species === 'kuuseriisikas') {
      const baseGeo = species === 'kukeseen' ? chanterelleBodyGeo : saffronBodyGeo;
      const mat = species === 'kukeseen' ? chanterelleMat : saffronCapMat;
      const count = species === 'kukeseen' ? 6 : 3;
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < count; i++) {
        const clone = baseGeo.clone();
        const s = i === 0 ? 1.18 : 0.68 + rand() * 0.42;
        const ang = (i / count) * Math.PI * 2 + rand() * 0.6;
        const off = i === 0 ? 0 : 0.08 + rand() * 0.11;
        clone.scale(s, s, s);
        clone.rotateX((rand() - 0.5) * 0.16);
        clone.rotateZ((rand() - 0.5) * 0.16);
        clone.rotateY(rand() * Math.PI * 2);
        clone.translate(Math.cos(ang) * off, 0, Math.sin(ang) * off);
        parts.push(clone);
      }
      const clusterGeo = mergeGeometries(parts)!;
      disposables.push(clusterGeo);
      const m = new THREE.Mesh(clusterGeo, mat);
      m.castShadow = shadows;
      m.receiveShadow = true;
      g.add(m);
    } else if (species === 'punakarbseseen') {
      // Photorealistic 3-stage Amanita muscaria cluster: mature umbrella + convex mid + young egg-button
      const stemParts: THREE.BufferGeometry[] = [];
      const capParts: THREE.BufferGeometry[] = [];
      const gillParts: THREE.BufferGeometry[] = [];
      const wartParts: THREE.BufferGeometry[] = [];

      const specs = [
        { s: 1.22, off: 0, ang: 0, isButton: false },
        { s: 0.84, off: 0.17, ang: rand() * Math.PI * 2, isButton: false },
        { s: 0.95, off: 0.14, ang: rand() * Math.PI * 2 + 2.2, isButton: true },
      ];
      for (const sp of specs) {
        const rx = (rand() - 0.5) * 0.1;
        const ry = rand() * Math.PI * 2;
        const rz = (rand() - 0.5) * 0.1;
        const dx = Math.cos(sp.ang) * sp.off;
        const dz = Math.sin(sp.ang) * sp.off;
        const xf = (src: THREE.BufferGeometry) => {
          const c = prepNonIndexed(src.clone());
          c.scale(sp.s, sp.s, sp.s);
          c.rotateX(rx);
          c.rotateZ(rz);
          c.rotateY(ry);
          c.translate(dx, 0, dz);
          return c;
        };
        if (sp.isButton) {
          stemParts.push(xf(flyAgaricButtonStemGeo));
          capParts.push(xf(flyAgaricButtonCapGeo));
        } else {
          stemParts.push(xf(flyAgaricStemGeo));
          capParts.push(xf(flyAgaricCapGeo));
          gillParts.push(xf(flyAgaricGillsGeo));
          wartParts.push(xf(flyAgaricWartsGeo));
        }
      }
      const mStem = mergeGeometries(stemParts)!;
      const mCap = mergeGeometries(capParts)!;
      const mGills = mergeGeometries(gillParts)!;
      const mWarts = mergeGeometries(wartParts)!;
      disposables.push(mStem, mCap, mGills, mWarts);
      const capMesh = new THREE.Mesh(mCap, flyAgaricCapMat);
      capMesh.castShadow = shadows;
      capMesh.receiveShadow = true;
      g.add(
        new THREE.Mesh(mStem, amanitaStemMat),
        capMesh,
        new THREE.Mesh(mGills, amanitaGillsMat),
        new THREE.Mesh(mWarts, amanitaWartMat)
      );
    } else if (species === 'valgekarbseseen') {
      // Photorealistic 2-stage Amanita virosa (Destroying Angel): tall conical bell + young bud
      const stemParts: THREE.BufferGeometry[] = [];
      const capParts: THREE.BufferGeometry[] = [];
      const gillParts: THREE.BufferGeometry[] = [];

      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1.16 : 0.76 + rand() * 0.18;
        const ang = rand() * Math.PI * 2;
        const off = i === 0 ? 0 : 0.14 + rand() * 0.06;
        const rx = (rand() - 0.5) * 0.11;
        const ry = rand() * Math.PI * 2;
        const rz = (rand() - 0.5) * 0.11;
        const dx = Math.cos(ang) * off;
        const dz = Math.sin(ang) * off;
        const xf = (src: THREE.BufferGeometry) => {
          const c = prepNonIndexed(src.clone());
          c.scale(s, s, s);
          c.rotateX(rx);
          c.rotateZ(rz);
          c.rotateY(ry);
          c.translate(dx, 0, dz);
          return c;
        };
        stemParts.push(xf(destroyingAngelStemGeo));
        capParts.push(xf(destroyingAngelCapGeo));
        gillParts.push(xf(destroyingAngelGillsGeo));
      }
      const mStem = mergeGeometries(stemParts)!;
      const mCap = mergeGeometries(capParts)!;
      const mGills = mergeGeometries(gillParts)!;
      disposables.push(mStem, mCap, mGills);
      const capMesh = new THREE.Mesh(mCap, destroyingAngelCapMat);
      capMesh.castShadow = shadows;
      capMesh.receiveShadow = true;
      g.add(
        new THREE.Mesh(mStem, amanitaStemMat),
        capMesh,
        new THREE.Mesh(mGills, amanitaGillsMat)
      );
    } else {
      // Bolete family: kivipuravik, kasepuravik, sapipuravik
      const isBirch = species === 'kasepuravik';
      const isBitter = species === 'sapipuravik';
      const stemGeo = isBirch ? birchBoleteStemGeo : porciniStemGeo;
      const capGeo = isBirch ? birchBoleteCapGeo : porciniCapGeo;
      const poreGeo = isBirch ? birchBoletePoreGeo : porciniPoreGeo;
      const stemMat = isBirch ? birchBoleteStemMat : porciniStemMat;
      const capMat = isBitter ? bitterCapMat : isBirch ? birchBoleteCapMat : porciniCapMat;
      const poreMat = isBitter ? bitterPoreMat : boletePoreMat;

      const stemParts: THREE.BufferGeometry[] = [];
      const capParts: THREE.BufferGeometry[] = [];
      const poreParts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1.18 : 0.68 + rand() * 0.24;
        const ang = rand() * Math.PI * 2;
        const off = i === 0 ? 0 : 0.12 + rand() * 0.06;
        const rx = (rand() - 0.5) * 0.12;
        const ry = rand() * Math.PI * 2;
        const rz = (rand() - 0.5) * 0.12;
        const dx = Math.cos(ang) * off;
        const dz = Math.sin(ang) * off;
        const xf = (src: THREE.BufferGeometry) => {
          const c = prepNonIndexed(src.clone());
          c.scale(s, s, s);
          c.rotateX(rx);
          c.rotateZ(rz);
          c.rotateY(ry);
          c.translate(dx, 0, dz);
          return c;
        };
        stemParts.push(xf(stemGeo));
        capParts.push(xf(capGeo));
        poreParts.push(xf(poreGeo));
      }
      const mStem = mergeGeometries(stemParts)!;
      const mCap = mergeGeometries(capParts)!;
      const mPore = mergeGeometries(poreParts)!;
      disposables.push(mStem, mCap, mPore);
      const capMesh = new THREE.Mesh(mCap, capMat);
      capMesh.castShadow = shadows;
      capMesh.receiveShadow = true;
      g.add(new THREE.Mesh(mStem, stemMat), capMesh, new THREE.Mesh(mPore, poreMat));
    }

    const hitProxy = new THREE.Mesh(hitProxyGeo, hitProxyMat);
    hitProxy.position.y = 0.16;
    g.add(hitProxy);

    scene.add(g);
    mushroomCountTotal++;

    const info = MUSHROOM_SPECIES_INFO[species];
    const getMushroomTitle = () => {
      const copy = getMushroomCopy(species);
      const tag =
        info.edibility === 'poisonous'
          ? t('prop.mushroomTagPoison')
          : info.edibility === 'inedible'
            ? t('prop.mushroomTagInedible')
            : '';
      return `${copy.name}${tag}`;
    };
    const entry = registerInteractive(g, {
      name: getMushroomTitle(),
      desc: getMushroomCopy(species).note,
      getName: getMushroomTitle,
      getDesc: () => getMushroomCopy(species).note,
      gatherable: true,
      species,
      carryable: false,
      kickable: false,
      radius: 0.18,
      onTouch: () => {
        const copy = getMushroomCopy(species);
        showToast(`${copy.name}: ${copy.note}`);
      },
    });
    g.userData.debugLayer = 'mushroom';
    g.userData.debugName = MUSHROOM_SPECIES_INFO[species].estonian;
    g.userData.debugMeta = { species, edibility: MUSHROOM_SPECIES_INFO[species].edibility };
    g.visible = false;
    mushroomIndex.set(entry, x, z);
  }

  function spawnPickupItemAt(
    x: number,
    z: number,
    itemId: ItemId
  ): { x: number; y: number; z: number; itemId: ItemId } {
    for (const [sp, mItemId] of Object.entries(MUSHROOM_TO_ITEM_ID) as Array<[MushroomSpecies, ItemId]>) {
      if (mItemId === itemId) {
        spawnMushroom(x, z, sp);
        return { x, y: getTerrainHeight(x, z), z, itemId };
      }
    }
    if (itemId === 'firewood') {
      spawnFirewoodLog(x, z);
      return { x, y: getTerrainHeight(x, z) + 0.12, z, itemId };
    }

    const def = ITEM_CATALOG[itemId];
    const y = getTerrainHeight(x, z) + 0.16;
    const itemGroup = new THREE.Group();
    itemGroup.position.set(x, y, z);
    itemGroup.rotation.y = rand() * Math.PI * 2;
    itemGroup.userData.debugLayer = 'pickup';
    itemGroup.userData.debugName = def.name;
    itemGroup.userData.debugMeta = { itemId, category: def.category, weightKg: def.weightKg };

    const catColor =
      def.category === 'water'
        ? 0x3b7699
        : def.category === 'food'
          ? 0x9c6538
          : def.category === 'clothing'
            ? 0x3c5942
            : def.category === 'camp'
              ? 0x5c6d45
              : def.category === 'navigation'
                ? 0xb58d46
                : 0x4f565d;
    const mat = new THREE.MeshStandardMaterial({
      color: catColor,
      roughness: def.category === 'water' ? 0.35 : 0.78,
      metalness: def.category === 'water' || def.category === 'gear' ? 0.25 : 0.04,
    });
    const bodyGeo =
      def.category === 'water'
        ? new THREE.CylinderGeometry(0.085, 0.085, 0.28, 12)
        : def.category === 'camp'
          ? new THREE.CylinderGeometry(0.14, 0.14, 0.42, 10)
          : new THREE.BoxGeometry(0.28, 0.16, 0.22);
    if (def.category === 'camp') {
      bodyGeo.rotateZ(Math.PI / 2);
    }
    const bodyMesh = new THREE.Mesh(bodyGeo, mat);
    bodyMesh.castShadow = shadows;
    bodyMesh.receiveShadow = true;
    const hitProxy = new THREE.Mesh(woodHitProxyGeo, woodHitProxyMat);
    itemGroup.add(bodyMesh, hitProxy);
    scene.add(itemGroup);
    disposables.push(mat, bodyGeo);

    const entry = registerInteractive(itemGroup, {
      name: getItemName(itemId),
      desc: def.description,
      getName: () => getItemName(itemId),
      getDesc: () => def.description,
      pickupItemId: itemId,
      pickupLabel: getItemName(itemId),
      getPickupLabel: () => getItemName(itemId),
      carryable: false,
      kickable: true,
      isDynamic: true,
      radius: 0.2,
      mass: Math.max(0.3, def.weightKg),
      onGroundYOffset: 0.14,
    });
    entry.resting = true;
    pickupItems.push({ x, z, entry });
    lightShadowsDirty = true;
    return { x, y, z, itemId };
  }

  const allSpecies: MushroomSpecies[] = [
    'kukeseen',
    'kivipuravik',
    'kasepuravik',
    'kuuseriisikas',
    'sapipuravik',
    'punakarbseseen',
    'valgekarbseseen',
  ];

  const pickWeightedSpecies = (): MushroomSpecies => {
    const r = rand();
    if (r < 0.24) return 'kukeseen';
    if (r < 0.42) return 'kivipuravik';
    if (r < 0.57) return 'kasepuravik';
    if (r < 0.72) return 'kuuseriisikas';
    if (r < 0.83) return 'sapipuravik';
    if (r < 0.93) return 'punakarbseseen';
    return 'valgekarbseseen';
  };

  // Swamp Island mushrooms (3 per island)
  for (const isl of bp.swampIslands) {
    for (let k = 0; k < 3; k++) {
      const a = rand() * Math.PI * 2;
      const rad = 4.2 + rand() * Math.max(2, isl.radius - 5.5);
      const mx = isl.x + Math.cos(a) * rad;
      const mz = isl.z + Math.sin(a) * rad;
      if (getTerrainHeight(mx, mz) > SWAMP_WATER_Y + 0.18) {
        spawnMushroom(mx, mz, pickWeightedSpecies());
      }
    }
  }

  // Woodland-edge mossy forest glade guaranteed off-road & away from villages so players discover
  // all iconic Estonian species (including Punane kärbseseen & Valge kärbseseen) naturally!
  let heroMushroomPos: { x: number; z: number } | null = null;
  const gladeZ = 24.5;
  const gladeBaseX = roadCenterX(gladeZ) - 11.5;
  const starterOffsets: Array<[number, number, MushroomSpecies]> = [
    [gladeBaseX, gladeZ, 'punakarbseseen'],
    [gladeBaseX + 0.68, gladeZ - 0.35, 'valgekarbseseen'],
    [gladeBaseX - 0.72, gladeZ - 0.48, 'kivipuravik'],
    [gladeBaseX + 0.25, gladeZ - 0.95, 'kukeseen'],
    [gladeBaseX - 1.35, gladeZ + 0.4, 'kuuseriisikas'],
  ];
  for (const [ox, oz, sp] of starterOffsets) {
    if (getDistanceToNearestVillage(ox, oz).dist >= 28 && distToRoadDetail(ox, oz).dist > 3.5) {
      spawnMushroom(ox, oz, sp);
      if (sp === 'punakarbseseen') {
        heroMushroomPos = { x: ox, z: oz };
      }
    }
  }

  // Widely dispersed 240 forest clusters across the entire 1200x1200m world (scarcest near villages)
  let placed = 0;
  let attempts = 0;
  while (placed < 240 && attempts < 1400) {
    attempts++;
    const mx = (rand() - 0.5) * (WORLD_HALF * 1.9);
    const mz = (rand() - 0.5) * (WORLD_HALF * 1.9);
    const nearV = getDistanceToNearestVillage(mx, mz);
    if (nearV.dist < 36 && rand() < 0.96) continue;
    const isl = getNearestSwampIsland(mx, mz);
    if (getSwampFactor(mx, mz) > 0.28 && isl.islandMask < 0.4) continue;
    if (distToRoadDetail(mx, mz).dist < 3.6) continue;
    if (getTerrainHeight(mx, mz) < SWAMP_WATER_Y + 0.16) continue;

    spawnMushroom(mx, mz, placed < 7 ? allSpecies[placed] : pickWeightedSpecies());
    placed++;
  }

  function gatherMushroom(entry: InteractiveEntry): MushroomSpecies | null {
    if (!entry.gatherable || entry.gathered || !entry.species) return null;
    entry.gathered = true;
    interactiveIndex.delete(entry);
    mushroomIndex.delete(entry);
    entry.mesh.visible = false;
    const idx = interactiveMeshes.indexOf(entry.mesh);
    if (idx !== -1) interactiveMeshes.splice(idx, 1);
    sound.playGatherMushroom();
    return entry.species;
  }

  function getEnvironmentStateAt(px: number, pz: number): WorldEnvironmentAtPoint {
    let shelter: ShelterQuality = 'outdoor';
    let shelterLabel: string | null = null;
    for (const area of shelters.footprints) {
      if (area.shelter && containsFootprint(area, px, pz, -0.1)) {
        shelter = area.shelter.quality;
        shelterLabel = area.shelter.label;
        break;
      }
    }

    let nearLitCampfireFactor = 0;
    let nearestCampfire: CampfireInfo | null = null;
    let nearestDistSq = 100; // within 10m
    for (let i = 0; i < campfires.length; i++) {
      const cf = campfires[i];
      const dx = px - cf.x;
      const dz = pz - cf.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearestCampfire = {
          id: cf.id,
          label: cf.label,
          x: cf.x,
          y: cf.y,
          z: cf.z,
          lit: cf.lit,
        };
      }
      if (cf.lit && dSq < 9.5 * 9.5) {
        const d = Math.sqrt(dSq);
        const factor = clamp(1 - (d - 1.5) / 7.5, 0, 1);
        if (factor > nearLitCampfireFactor) nearLitCampfireFactor = factor;
      }
    }

    return { shelter, shelterLabel, nearLitCampfireFactor, nearestCampfire };
  }

  function getStructureAcousticsAt(px: number, pz: number): StructureAcousticsInfo {
    let nearestShelterDist = Infinity;
    let nearestRoofedDrainage: { x: number; y: number; z: number } | undefined;
    let nearestHasRoof = false;

    for (const s of structureMetas) {
      const dx = px - s.x;
      const dz = pz - s.z;
      const dEdge = Math.max(0, Math.hypot(dx, dz) - Math.max(s.halfW, s.halfD));
      if (dEdge < nearestShelterDist) {
        nearestShelterDist = dEdge;
        if (s.roofDrainagePoint) {
          nearestRoofedDrainage = s.roofDrainagePoint;
          nearestHasRoof = true;
        }
      }
    }

    for (const area of shelters.footprints) {
      const distApprox = Math.max(0, Math.hypot(px - area.x, pz - area.z) - Math.max(area.halfW, area.halfD));
      if (distApprox < nearestShelterDist) {
        nearestShelterDist = distApprox;
      }

      if (containsFootprint(area, px, pz, -0.05)) {
        if (area.shelter?.quality === 'tent') {
          return {
            id: area.id,
            quality: 'tent',
            profileId: 'tent',
            enclosure: 0.58,
            roofCoverage: 1.0,
            hasRoof: true,
            roofMaterial: 'canvas',
            wallMaterial: 'canvas',
            condition: 'intact',
            portalOpenness: 0.28,
            abandoned: false,
            floorMaterial: 'forest_floor',
            nearestShelterDistanceM: 0,
            roofDrainagePoint: { x: area.x + 1.1, y: area.floorY + 0.8, z: area.z },
          };
        }

        const meta = structureMetas.find((m) => m.id === area.id);
        if (meta) {
          const doorOpen = meta.hasDoor && meta.getDoorOpen();
          const decay = meta.decay;
          const profileId =
            decay === 'ruins'
              ? 'outdoor'
              : decay === 'roofless'
                ? 'decrepit_missing_roof'
                : meta.abandoned || decay === 'sagging'
                  ? 'drafty_hut'
                  : 'wooden_house';
          const enclosure =
            decay === 'ruins' ? 0.35 : decay === 'roofless' ? 0.5 : decay === 'sagging' ? 0.68 : 0.92;
          const roofCoverage =
            decay === 'ruins' ? 0 : decay === 'roofless' ? 0.15 : decay === 'sagging' ? 0.72 : 1.0;
          const portalOpenness = !meta.hasDoor ? 0.85 : doorOpen ? 0.68 : 0.08;
          return {
            id: meta.id,
            quality: meta.abandoned || decay !== 'intact' ? 'drafty_hut' : 'warm_house',
            profileId,
            enclosure,
            roofCoverage,
            hasRoof: roofCoverage > 0.3,
            roofMaterial: meta.roofMaterial,
            wallMaterial: meta.wallMaterial,
            condition:
              decay === 'ruins'
                ? 'ruins'
                : meta.abandoned
                  ? 'decrepit'
                  : decay === 'sagging'
                    ? 'sagging'
                    : 'intact',
            portalOpenness,
            abandoned: meta.abandoned,
            floorMaterial: meta.abandoned || decay !== 'intact' ? 'decrepit_wooden_floor' : 'wooden_floor',
            nearestShelterDistanceM: 0,
            roofDrainagePoint: meta.roofDrainagePoint ?? nearestRoofedDrainage,
          };
        }
      }
    }

    return {
      id: null,
      quality: 'outdoor',
      profileId: 'outdoor',
      enclosure: 0,
      roofCoverage: 0,
      hasRoof: nearestShelterDist <= 30 && nearestHasRoof,
      roofMaterial: 'none',
      wallMaterial: 'none',
      condition: 'intact',
      portalOpenness: 1,
      abandoned: false,
      floorMaterial: 'forest_floor',
      nearestShelterDistanceM: nearestShelterDist,
      roofDrainagePoint: nearestRoofedDrainage,
    };
  }

  function setCampfireLit(id: string, lit: boolean): boolean {
    const cf = campfires.find((c) => c.id === id);
    if (!cf) return false;
    cf.lit = lit;
    cf.fire.setLit(lit);
    return true;
  }

  function getCampfireInfo(id: string): CampfireInfo | null {
    const cf = campfires.find((c) => c.id === id);
    if (!cf) return null;
    return { id: cf.id, label: cf.label, x: cf.x, y: cf.y, z: cf.z, lit: cf.lit };
  }

  let prevPropsElapsed: number | null = null;

  function throwFirewoodAtCampfire(
    campfireId: string,
    startX: number,
    startY: number,
    startZ: number
  ): { ok: boolean; campfire?: CampfireInfo } {
    const cf = campfires.find((c) => c.id === campfireId);
    if (!cf) return { ok: false };
    const info: CampfireInfo = {
      id: cf.id,
      label: cf.label,
      x: cf.x,
      y: cf.y,
      z: cf.z,
      lit: cf.lit,
    };

    const entry = spawnFirewoodLog(startX, startZ, startY);
    const tx = cf.x + (rand() - 0.5) * 0.28;
    const ty = cf.y + 0.18;
    const tz = cf.z + (rand() - 0.5) * 0.28;
    const dx = tx - startX;
    const dz = tz - startZ;
    const horizDist = Math.hypot(dx, dz);
    const flightTime = clamp(horizDist / 9.2, 0.28, 0.58);
    const gravity = 15.0;

    entry.resting = false;
    entry.vel.set(
      dx / flightTime,
      (ty - startY + 0.5 * gravity * flightTime * flightTime) / flightTime,
      dz / flightTime
    );
    entry.angVel.set((rand() - 0.5) * 9, (rand() - 0.5) * 7, (rand() - 0.5) * 9);
    return { ok: true, campfire: info };
  }

  function feedCampfireWithLog(
    campfireId: string
  ): { ok: boolean; lit: boolean; campfire?: CampfireInfo } {
    const cf = campfires.find((c) => c.id === campfireId);
    if (!cf) return { ok: false, lit: false };
    const info: CampfireInfo = {
      id: cf.id,
      label: cf.label,
      x: cf.x,
      y: cf.y,
      z: cf.z,
      lit: cf.lit,
    };
    const localX = (rand() - 0.5) * 0.34;
    const localZ = (rand() - 0.5) * 0.34;
    cf.fire.addFuelLog(localX, 0.16, localZ, rand() * Math.PI);
    if (cf.lit) {
      sound.playFireSparkBurst();
    } else {
      sound.playImpact(0.55);
    }
    handlers?.onCampfireLogImpact?.(info, cf.lit, cf.x + localX, cf.y + 0.18, cf.z + localZ);
    return { ok: true, lit: cf.lit, campfire: info };
  }

  function feedDynamicFirewoodIntoCampfires(): Array<{
    campfire: CampfireInfo;
    lit: boolean;
    x: number;
    y: number;
    z: number;
  }> {
    const hits: Array<{
      campfire: CampfireInfo;
      lit: boolean;
      x: number;
      y: number;
      z: number;
    }> = [];
    if (campfires.length === 0) return hits;

    for (let i = 0; i < dynamicObjects.length; i++) {
      const obj = dynamicObjects[i];
      if (obj.gathered || obj.resting || obj.pickupItemId !== 'firewood') continue;
      const px = obj.mesh.position.x;
      const py = obj.mesh.position.y;
      const pz = obj.mesh.position.z;

      for (let c = 0; c < campfires.length; c++) {
        const cf = campfires[c];
        const dx = px - cf.x;
        const dz = pz - cf.z;
        if (dx * dx + dz * dz <= 0.88 * 0.88 && py <= cf.y + 0.72 && py >= cf.y - 0.35) {
          obj.gathered = true;
          obj.resting = true;
          obj.mesh.visible = false;
          interactiveIndex.delete(obj);
          lightShadowsDirty = true;

          cf.fire.addFuelLog(dx, Math.max(0.12, py - cf.y), dz, obj.mesh.rotation.y);
          const cfInfo: CampfireInfo = {
            id: cf.id,
            label: cf.label,
            x: cf.x,
            y: cf.y,
            z: cf.z,
            lit: cf.lit,
          };
          if (cf.lit) {
            sound.playFireSparkBurst();
          } else {
            sound.playImpact(0.55);
          }
          handlers?.onCampfireLogImpact?.(cfInfo, cf.lit, px, py, pz);
          hits.push({ campfire: cfInfo, lit: cf.lit, x: px, y: py, z: pz });
          break;
        }
      }
    }
    return hits;
  }

  // Shared PBR materials for player-pitched 3D waterproof trekking tents
  const tentRainflyMat = new THREE.MeshStandardMaterial({
    color: 0x4b6e47,
    emissive: 0x1b2b1a,
    emissiveIntensity: 0.65,
    roughness: 0.78,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const tentInnerMat = new THREE.MeshStandardMaterial({
    color: 0x202b22,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const tentGroundsheetMat = new THREE.MeshStandardMaterial({
    color: 0x2a312c,
    roughness: 0.68,
    metalness: 0.06,
  });
  const tentPadMat = new THREE.MeshStandardMaterial({
    color: 0xc27b3c,
    roughness: 0.86,
    metalness: 0.0,
  });
  const tentPoleMat = new THREE.MeshStandardMaterial({
    color: 0xbac4c9,
    roughness: 0.28,
    metalness: 0.78,
  });
  const tentGuyLineMat = new THREE.MeshStandardMaterial({
    color: 0xd6c79c,
    roughness: 0.82,
    metalness: 0.05,
  });
  disposables.push(
    tentRainflyMat,
    tentInnerMat,
    tentGroundsheetMat,
    tentPadMat,
    tentPoleMat,
    tentGuyLineMat
  );

  function packUpPlayerTent(tentId: string): boolean {
    const idx = tents.findIndex((tt) => tt.id === tentId);
    if (idx < 0) return false;
    const target = tents[idx];
    tents.splice(idx, 1);
    shelters.remove(tentId);
    lightShadowsDirty = true;

    target.interactiveEntry.gathered = true;
    interactiveIndex.delete(target.interactiveEntry);
    scene.remove(target.group);

    const ioIdx = interactiveObjects.indexOf(target.interactiveEntry);
    if (ioIdx >= 0) interactiveObjects.splice(ioIdx, 1);
    const imIdx = interactiveMeshes.indexOf(target.group);
    if (imIdx >= 0) interactiveMeshes.splice(imIdx, 1);

    for (const geo of target.geometries) {
      geo.dispose();
    }
    return true;
  }

  function placePlayerTent(
    x: number,
    z: number,
    yaw: number
  ): { ok: boolean; tent?: TentInfo; message: string } {
    const groundY = getTerrainHeight(x, z);
    if (groundY <= SWAMP_WATER_Y + 0.14) {
      return { ok: false, message: t('prop.tentTooWet') };
    }
    if (shelters.footprints.some(area => containsFootprint(area, x, z, 2.1))) {
      return { ok: false, message: t('prop.tentBlocked') };
    }
    // Check overlap with solid buildings, wells, campfires, or existing tents
    for (let i = 0; i < boxColliders.length; i++) {
      const b = boxColliders[i];
      if (!b.active) continue;
      if (x >= b.minX - 1.15 && x <= b.maxX + 1.15 && z >= b.minZ - 1.15 && z <= b.maxZ + 1.15) {
        return { ok: false, message: t('prop.tentBlocked') };
      }
    }
    for (let i = 0; i < circleColliders.length; i++) {
      const c = circleColliders[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const minR = c.r + 1.05;
      if (dx * dx + dz * dz < minR * minR) {
        return { ok: false, message: t('prop.tentBlocked') };
      }
    }
    for (let i = 0; i < campfires.length; i++) {
      const dx = x - campfires[i].x;
      const dz = z - campfires[i].z;
      if (dx * dx + dz * dz < 2.2 * 2.2) {
        return { ok: false, message: t('prop.tentBlocked') };
      }
    }
    for (let i = 0; i < tents.length; i++) {
      const dx = x - tents[i].x;
      const dz = z - tents[i].z;
      if (dx * dx + dz * dz < 3.0 * 3.0) {
        return { ok: false, message: t('prop.tentBlocked') };
      }
    }

    const id = `tent_player_${++tentCounter}`;
    shelters.add({ id, x, z, yaw, temporary: true, halfW: 1.06, halfD: 1.33, floorY: groundY + 0.08,
      shelter: { quality: 'tent', label: t('prop.tentSpotLabel') },
      roof: { eaveY: groundY + 0.08, rise: 1.3, axis: 'x' } });
    const tentGroup = new THREE.Group();
    tentGroup.position.set(x, groundY, z);
    tentGroup.rotation.y = yaw;
    const geos: THREE.BufferGeometry[] = [];

    // 1. Soft ground contact shadow under footprint
    const shadowGeo = new THREE.PlaneGeometry(3.2, 3.6);
    shadowGeo.rotateX(-Math.PI / 2);
    geos.push(shadowGeo);
    const shadowMesh = new THREE.Mesh(shadowGeo, contactShadowMat);
    shadowMesh.position.y = 0.025;
    tentGroup.add(shadowMesh);

    // 2. Waterproof bathtub groundsheet (grounded at bottom-center pivot y = 0)
    const floorGeo = new THREE.BoxGeometry(1.92, 0.08, 2.48);
    geos.push(floorGeo);
    const floorMesh = new THREE.Mesh(floorGeo, tentGroundsheetMat);
    floorMesh.position.set(0, 0.04, 0);
    floorMesh.receiveShadow = true;
    tentGroup.add(floorMesh);

    // 3. Insulated sleeping pad inside tent floor
    const padGeo = new THREE.BoxGeometry(0.84, 0.055, 1.92);
    geos.push(padGeo);
    const padMesh = new THREE.Mesh(padGeo, tentPadMat);
    padMesh.position.set(-0.18, 0.1, -0.05);
    padMesh.receiveShadow = true;
    tentGroup.add(padMesh);

    // 4 & 5. Sloped waterproof A-frame rainfly roof panels (left & right eaves)
    const ridgeH = 1.38;
    const halfSpan = 1.06;
    const slopeLen = Math.hypot(halfSpan, ridgeH - 0.08);
    const slopeAngle = Math.atan2(halfSpan, ridgeH - 0.08);
    const flyLen = 2.66;

    const panelGeo = new THREE.BoxGeometry(slopeLen, 0.035, flyLen);
    geos.push(panelGeo);
    const leftFly = new THREE.Mesh(panelGeo, tentRainflyMat);
    leftFly.position.set(-halfSpan * 0.5, 0.08 + (ridgeH - 0.08) * 0.5, 0);
    leftFly.rotation.z = Math.PI * 0.5 - slopeAngle;
    leftFly.castShadow = shadows;
    leftFly.receiveShadow = true;

    const rightFly = new THREE.Mesh(panelGeo, tentRainflyMat);
    rightFly.position.set(halfSpan * 0.5, 0.08 + (ridgeH - 0.08) * 0.5, 0);
    rightFly.rotation.z = -(Math.PI * 0.5 - slopeAngle);
    rightFly.castShadow = shadows;
    rightFly.receiveShadow = true;
    tentGroup.add(leftFly, rightFly);

    // 6. Rear closed gable triangle wall + dark interior vestibule backing
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-0.98, 0.06);
    gableShape.lineTo(0.98, 0.06);
    gableShape.lineTo(0, ridgeH - 0.02);
    gableShape.closePath();
    const gableGeo = new THREE.ShapeGeometry(gableShape);
    geos.push(gableGeo);

    const rearGable = new THREE.Mesh(gableGeo, tentRainflyMat);
    rearGable.position.set(0, 0, -1.24);
    rearGable.castShadow = shadows;
    rearGable.receiveShadow = true;
    tentGroup.add(rearGable);

    const innerBack = new THREE.Mesh(gableGeo, tentInnerMat);
    innerBack.position.set(0, 0, -1.2);
    tentGroup.add(innerBack);

    // 7. Front portal gable frame with open triangular doorway
    const frontPortalShape = new THREE.Shape();
    frontPortalShape.moveTo(-0.98, 0.06);
    frontPortalShape.lineTo(0.98, 0.06);
    frontPortalShape.lineTo(0, ridgeH - 0.02);
    frontPortalShape.closePath();
    const doorHole = new THREE.Path();
    doorHole.moveTo(-0.56, 0.08);
    doorHole.lineTo(0.56, 0.08);
    doorHole.lineTo(0, ridgeH - 0.24);
    doorHole.closePath();
    frontPortalShape.holes.push(doorHole);
    const frontPortalGeo = new THREE.ShapeGeometry(frontPortalShape);
    geos.push(frontPortalGeo);
    const frontPortal = new THREE.Mesh(frontPortalGeo, tentRainflyMat);
    frontPortal.position.set(0, 0, 1.24);
    frontPortal.castShadow = shadows;
    tentGroup.add(frontPortal);

    // 8. Rolled-back canvas doorway flap tied along right portal edge
    const flapGeo = new THREE.CylinderGeometry(0.065, 0.075, 1.18, 8);
    geos.push(flapGeo);
    const rolledFlap = new THREE.Mesh(flapGeo, tentRainflyMat);
    rolledFlap.position.set(0.32, 0.64, 1.27);
    rolledFlap.rotation.z = 0.48;
    tentGroup.add(rolledFlap);

    // 9. Brushed aluminum ridge pole & end support poles
    const ridgePoleGeo = new THREE.CylinderGeometry(0.024, 0.024, flyLen + 0.08, 8);
    ridgePoleGeo.rotateX(Math.PI / 2);
    geos.push(ridgePoleGeo);
    const ridgePole = new THREE.Mesh(ridgePoleGeo, tentPoleMat);
    ridgePole.position.set(0, ridgeH + 0.01, 0);
    tentGroup.add(ridgePole);

    const endPoleGeo = new THREE.CylinderGeometry(0.02, 0.022, ridgeH, 8);
    const doorPoleLen = Math.hypot(0.56, ridgeH - 0.16);
    const doorPoleGeo = new THREE.CylinderGeometry(0.017, 0.019, doorPoleLen, 8);
    geos.push(endPoleGeo, doorPoleGeo);
    const frontLeftPole = new THREE.Mesh(doorPoleGeo, tentPoleMat);
    frontLeftPole.position.set(-0.3, (ridgeH - 0.04) * 0.5, 1.27);
    frontLeftPole.rotation.z = -Math.atan2(0.56, ridgeH - 0.16);
    const frontRightPole = new THREE.Mesh(doorPoleGeo, tentPoleMat);
    frontRightPole.position.set(0.3, (ridgeH - 0.04) * 0.5, 1.27);
    frontRightPole.rotation.z = Math.atan2(0.56, ridgeH - 0.16);
    const rearPole = new THREE.Mesh(endPoleGeo, tentPoleMat);
    rearPole.position.set(0, ridgeH * 0.5, -1.29);
    tentGroup.add(frontLeftPole, frontRightPole, rearPole);

    // 10. Four taut guy-lines & metallic stakes anchored into the ground
    const stakeGeo = new THREE.CylinderGeometry(0.015, 0.01, 0.24, 6);
    const guyGeo = new THREE.CylinderGeometry(0.008, 0.008, 1.18, 5);
    geos.push(stakeGeo, guyGeo);
    const corners: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [sx, sz] of corners) {
      const stake = new THREE.Mesh(stakeGeo, tentPoleMat);
      stake.position.set(sx * 1.48, 0.08, sz * 1.12);
      stake.rotation.z = sx * 0.28;
      tentGroup.add(stake);

      const guy = new THREE.Mesh(guyGeo, tentGuyLineMat);
      guy.position.set(sx * 1.12, 0.44, sz * 1.12);
      guy.rotation.z = sx * 0.72;
      tentGroup.add(guy);
    }

    scene.add(tentGroup);
    lightShadowsDirty = true;

    const interactiveEntry = registerInteractive(tentGroup, {
      name: t('prop.tentName'),
      desc: t('prop.tentDesc'),
      getName: () => t('prop.tentName'),
      getDesc: () => t('prop.tentDesc'),
      getPickupLabel: () => t('prop.tentSleepAction'),
      getSecondaryActionLabel: () => t('prop.tentPackUpAction'),
      onUse: () => {
        if (handlers?.onOpenSleep) {
          handlers.onOpenSleep({
            kind: 'tent',
            label: t('prop.tentSpotLabel'),
            x,
            y: groundY + 0.15,
            z,
            shelter: 'tent',
            tentId: id,
          });
        }
      },
      onKick: () => {
        if (packUpPlayerTent(id)) {
          handlers?.onPackUpTent?.(id);
        }
      },
      onTouch: () => showToast(t('prop.tentTouch')),
    });

    tents.push({
      id,
      x,
      y: groundY,
      z,
      yaw,
      group: tentGroup,
      interactiveEntry,
      geometries: geos,
    });

    sound.playImpact(0.65);
    return {
      ok: true,
      tent: { id, x, y: groundY, z, yaw },
      message: t('prop.tentPitched'),
    };
  }

  return {
    shelters,
    invalidateLightShadows: () => { lightShadowsDirty = true; },
    needsLightShadowUpdate: () => pooledPointLights.some(light => light.castShadow && light.intensity > 0 && light.shadow.needsUpdate),
    circleColliders,
    boxColliders,
    boardwalkZones,
    interactiveObjects,
    queryInteractiveObjects: (x, z, radius, out) => {
      interactiveIndex.queryRadius(x, z, radius, out);
      let count = 0;
      for (let i = 0; i < out.length; i++) {
        const entry = out[i];
        if (!entry.gathered && entry.mesh.visible) out[count++] = entry;
      }
      out.length = count;
    },
    updateInteractivePosition,
    interactiveMeshes,
    dynamicObjects,
    mushroomCountTotal,
    heroMushroomPos,
    primaryCampfirePos: { x: primaryFire.x, y: primaryFire.y, z: primaryFire.z },
    updateDynamicProps: (
      elapsed: number,
      camX: number,
      camZ: number,
      skyState?: SkyFrameState,
      frustumPlanes?: Float32Array,
      maxRenderDist = 225,
      weather?: string,
      mushroomDist = 38
    ) => {
      const propsDt =
        prevPropsElapsed !== null ? clamp(elapsed - prevPropsElapsed, 0, 0.1) : 1 / 60;
      prevPropsElapsed = elapsed;

      let chosenBoost = 0;
      for (let i = 0; i < campfires.length; i++) {
        const cf = campfires[i];
        if (cf.lit) {
          const cfDx = cf.x - camX;
          const cfDz = cf.z - camZ;
          // Animate active fires within render distance + immediate hearth vicinity
          if (cfDx * cfDx + cfDz * cfDz <= (maxRenderDist + 20) * (maxRenderDist + 20)) {
            cf.fire.update(elapsed, propsDt, () => {
              sound.playFireLogCatch();
              handlers?.onCampfireLogCaughtFire?.({
                id: cf.id,
                label: cf.label,
                x: cf.x,
                y: cf.y,
                z: cf.z,
                lit: cf.lit,
              });
            });
          }
        }
      }

      // Bind the 2 pooled PointLights to the 2 nearest lit campfires/lanterns within 38m (zero GC, constant NUM_POINT_LIGHTS=2)
      let best0 = -1;
      let best0Sq = 38 * 38;
      let best1 = -1;
      let best1Sq = 38 * 38;
      for (let i = 0; i < virtualPointLights.length; i++) {
        const src = virtualPointLights[i];
        if (!src.isLit()) continue;
        const dx = src.anchor.position.x - camX;
        const dz = src.anchor.position.z - camZ;
        const dSq = dx * dx + dz * dz;
        if (dSq < best0Sq) {
          best1 = best0;
          best1Sq = best0Sq;
          best0 = i;
          best0Sq = dSq;
        } else if (dSq < best1Sq) {
          best1 = i;
          best1Sq = dSq;
        }
      }
      const chosen0 = best0 >= 0 ? virtualPointLights[best0] : null;
      const chosen1 = best1 >= 0 ? virtualPointLights[best1] : null;
      const flickerDelta =
        Math.sin(elapsed * 13.7) * 0.24 +
        Math.sin(elapsed * 23.3 + 1.1) * 0.16 +
        Math.sin(elapsed * 5.9) * 0.20;
      for (let slot = 0; slot < 2; slot++) {
        const pl = pooledPointLights[slot];
        const src = slot === 0 ? chosen0 : chosen1;
        if (src) {
          chosenBoost = 0;
          if (src.flicker) {
            const matchedCf = campfires.find((c) => c.pitGroup === src.anchor);
            if (matchedCf) chosenBoost = matchedCf.fire.getIntensityBoost() * 1.4;
          }
          const nextPosition = src.anchor.position.clone();
          nextPosition.y += src.yOffset;
          if (lightShadowsDirty || pl.position.distanceToSquared(nextPosition) > 0.000001 || pl.intensity === 0) {
            pl.shadow.needsUpdate = true;
          }
          pl.position.set(
            src.anchor.position.x,
            src.anchor.position.y + src.yOffset,
            src.anchor.position.z
          );
          pl.color.setHex(src.colorHex);
          pl.distance = src.distance + chosenBoost * 3.0;
          pl.decay = src.decay;
          pl.intensity = src.flicker ? 2.55 + flickerDelta + chosenBoost : src.baseIntensity;
        } else {
          pl.intensity = 0;
        }
      }

      lightShadowsDirty = false;

      // Distance + frustum cull bog water & mist so they never shade off-screen from village/forest
      const bogDx = camX - bp.bogCenterX;
      const bogDz = camZ - bp.bogCenterZ;
      const bogDistSq = bogDx * bogDx + bogDz * bogDz;
      const bogVisLimit = waterRadius + maxRenderDist + 16;
      let nearBog = bogDistSq <= bogVisLimit * bogVisLimit;
      if (nearBog && frustumPlanes && bogDistSq > (waterRadius + 10) * (waterRadius + 10)) {
        nearBog = sphereIntersectsFrustum(
          frustumPlanes,
          bp.bogCenterX,
          SWAMP_WATER_Y,
          bp.bogCenterZ,
          waterRadius + 6
        );
      }
      swampWater.visible = nearBog;
      // Heavy rain/storm beats down low ground mist & already uses dense FogExp2 — avoids stacking transparent sheets over rain!
      const isPrecip = weather === 'rain' || weather === 'storm';
      mistInst.visible =
        !isPrecip && nearBog && bogDistSq <= (bp.bogRadius + 75) * (bp.bogRadius + 75);

      // Sync wind-responsive reflective bog water & day/night cottage window glow with live sky state
      if (nearBog) {
        bogWater.updateUniforms(elapsed, skyState, weather as WeatherId | undefined);
      }
      if (skyState) {
        // Dark reflective glass during bright daytime; warm amber hearth light at golden hour, dusk & night!
        const duskGlow = THREE.MathUtils.clamp((0.86 - skyState.dayFactor) / 0.36, 0, 1);
        activeWinMat.emissiveIntensity = 0.02 + duskGlow * 1.65;
      }

      const maxMushSq = mushroomDist * mushroomDist;
      const mushFadeStart = Math.max(8, mushroomDist - 10);
      const mushFadeStartSq = mushFadeStart * mushFadeStart;
      const mushFadeSpan = Math.max(1, mushroomDist - mushFadeStart);
      const fogCapSq = (maxRenderDist + 16) * (maxRenderDist + 16);
      for (const entry of visibleMushrooms) entry.mesh.visible = false;
      visibleMushrooms.length = 0;
      mushroomIndex.queryRadius(camX, camZ, mushroomDist, nearbyMushrooms);
      for (let i = 0; i < nearbyMushrooms.length; i++) {
        const m = nearbyMushrooms[i];
        const dx = m.mesh.position.x - camX;
        const dz = m.mesh.position.z - camZ;
        const dSq = dx * dx + dz * dz;
        if (dSq >= maxMushSq) {
          m.mesh.visible = false;
        } else {
          const isVis =
            frustumPlanes && dSq > 25
              ? sphereIntersectsFrustum(
                  frustumPlanes,
                  m.mesh.position.x,
                  m.mesh.position.y + 0.25,
                  m.mesh.position.z,
                  1.2
                )
              : true;
          m.mesh.visible = isVis;
          if (isVis) {
            visibleMushrooms.push(m);
            if (dSq <= mushFadeStartSq) {
              m.mesh.scale.setScalar(1.0);
            } else {
              const t = Math.min(1, Math.max(0, (mushroomDist - Math.sqrt(dSq)) / mushFadeSpan));
              m.mesh.scale.setScalar(0.05 + 0.95 * t * t * (3 - 2 * t));
            }
          }
        }
      }
      for (let i = 0; i < structureNodes.length; i++) {
        const s = structureNodes[i];
        const dx = s.x - camX;
        const dz = s.z - camZ;
        const dSq = dx * dx + dz * dz;
        const capSq = s.maxDistSq < fogCapSq ? s.maxDistSq : fogCapSq;
        if (dSq >= capSq) {
          s.obj.visible = false;
        } else if (frustumPlanes && dSq > 26 * 26) {
          s.obj.visible = sphereIntersectsFrustum(
            frustumPlanes,
            s.x,
            s.obj.position.y + 4.5,
            s.z,
            18.0
          );
        } else {
          s.obj.visible = true;
        }
      }
    },
    gatherMushroom,
    collectPickupItem: (entry: InteractiveEntry): ItemId | null => {
      if (!entry.pickupItemId || entry.gathered) return null;
      entry.gathered = true;
      interactiveIndex.delete(entry);
      lightShadowsDirty = true;
      entry.resting = true;
      entry.mesh.visible = false;
      sound.playImpact(0.42);
      return entry.pickupItemId;
    },
    shatterWoodAt,
    placePlayerCampfire: (
      x: number,
      z: number
    ): { ok: boolean; campfire?: CampfireInfo; message: string } => {
      const nearbyTent = tents.filter(tt => Math.hypot(x - tt.x, z - tt.z) < 7)
        .sort((a, b) => Math.hypot(x - a.x, z - a.z) - Math.hypot(x - b.x, z - b.z))[0];
      if (nearbyTent) {
        x = nearbyTent.x + Math.sin(nearbyTent.yaw) * 3.8;
        z = nearbyTent.z + Math.cos(nearbyTent.yaw) * 3.8;
      }
      if (
        shelters.footprints.some((area) => !area.clearingOnly && containsFootprint(area, x, z, 0.9)) ||
        circleColliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.9)
      ) {
        return { ok: false, message: t('prop.campfireBlocked') };
      }
      const groundY = getTerrainHeight(x, z);
      if (groundY <= SWAMP_WATER_Y + 0.08) {
        return {
          ok: false,
          message: t('prop.campfireTooWet'),
        };
      }
      for (let i = 0; i < campfires.length; i++) {
        const dx = campfires[i].x - x;
        const dz = campfires[i].z - z;
        if (dx * dx + dz * dz < 3.2 * 3.2) {
          return {
            ok: false,
            message: t('prop.campfireTooClose'),
          };
        }
      }
      const id = `fire_player_${campfires.length + 1}`;
      const created = buildCampfirePit(id, 'Wilderness', x, z, false);
      sound.playImpact(0.75);
      return {
        ok: true,
        campfire: {
          id: created.id,
          label: created.label,
          x: created.x,
          y: created.y,
          z: created.z,
          lit: created.lit,
        },
        message: t('prop.campfireStacked'),
      };
    },
    getBreakableStumps: () => breakableStumps.filter((s) => !s.entry.gathered),
    placePlayerTent,
    packUpPlayerTent,
    getTents: () =>
      tents.map((tt) => ({
        id: tt.id,
        x: tt.x,
        y: tt.y,
        z: tt.z,
        yaw: tt.yaw,
      })),
    getPickupItems: () =>
      pickupItems
        .filter((p) => !p.entry.gathered)
        .map((p) => ({ x: p.entry.mesh.position.x, z: p.entry.mesh.position.z, entry: p.entry })),
    getEnvironmentStateAt,
    getStructureAcousticsAt,
    setCampfireLit,
    getCampfireInfo,
    getCampfires: () =>
      campfires.map((c) => ({
        id: c.id,
        label: c.label,
        x: c.x,
        y: c.y,
        z: c.z,
        lit: c.lit,
      })),
    throwFirewoodAtCampfire,
    feedCampfireWithLog,
    feedDynamicFirewoodIntoCampfires,
    isWaterVisible: () => swampWater.visible,
    isMistVisible: () => mistInst.visible,
    getBogShoreDepthInfo: () => ({
      texture: bogWater.smoothDepthTex,
      centerX: bogWater.centerX,
      centerZ: bogWater.centerZ,
      radius: bogWater.radius,
    }),
    renderWaterReflection: (renderer, renderScene, cam) => {
      bogWater.renderReflection(renderer, renderScene, cam);
    },
    spawnMushroomAt: (x: number, z: number, species: MushroomSpecies) => {
      spawnMushroom(x, z, species);
      lightShadowsDirty = true;
      return { x, y: getTerrainHeight(x, z), z, species };
    },
    spawnHutAt: (
      x: number,
      z: number,
      rotY = 0,
      decayState: HutDecayState = 'intact',
      name?: string
    ) => {
      buildEstonianLogHouse(x, z, rotY, {
        w: 6.4,
        d: 4.8,
        h: 2.55,
        roofStyle: decayState === 'intact' ? 'shingle' : 'thatch',
        warmWood: decayState === 'intact',
        abandoned: decayState !== 'intact',
        decayState,
        porch: decayState === 'intact',
        name: name ?? `Debug Hut (${decayState})`,
      });
      lightShadowsDirty = true;
      return { x, y: getTerrainHeight(x, z), z, decayState };
    },
    spawnCampfireAt: (x: number, z: number, lit = true) => {
      const id = `fire_debug_${campfires.length + 1}`;
      const created = buildCampfirePit(id, 'Debug', x, z, lit);
      lightShadowsDirty = true;
      return {
        id: created.id,
        label: created.label,
        x: created.x,
        y: created.y,
        z: created.z,
        lit: created.lit,
      };
    },
    spawnPickupItemAt,
    getInspectableMeshes: () => {
      const out: THREE.Object3D[] = [swampWater];
      const seen = new Set<THREE.Object3D>(out);
      for (let i = 0; i < structureNodes.length; i++) {
        const obj = structureNodes[i].obj;
        if (obj.visible && !seen.has(obj)) {
          seen.add(obj);
          out.push(obj);
        }
      }
      for (let i = 0; i < interactiveObjects.length; i++) {
        const entry = interactiveObjects[i];
        if (entry.gathered || !entry.mesh.visible) continue;
        if (!seen.has(entry.mesh)) {
          seen.add(entry.mesh);
          out.push(entry.mesh);
        }
      }
      return out;
    },
    dispose: () => {
      interactiveIndex.clear();
      mushroomIndex.clear();
      nearbyMushrooms.length = 0;
      visibleMushrooms.length = 0;
      shelters.dispose();
      for (const light of pooledPointLights) { light.dispose(); scene.remove(light); }
      for (const tt of tents) {
        for (const geo of tt.geometries) geo.dispose();
      }
      for (const d of disposables) d.dispose();
    },
  };
}
