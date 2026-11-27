import * as THREE from 'three';
import { ShelterGeometry, containsFootprint, excludeShelterVegetation } from './shelterGeometry';
import {
  ACTIVE_GRID,
  CHUNK_COUNT,
  CHUNK_SIZE,
  getTerrainHeight,
} from './terrainMath';
import { ActiveChunkSlot } from './terrainChunkManager';
import { WorldTextures } from './proceduralTextures';
import type { CircleCollider } from './architectureAndProps';
import {
  classifySphereFrustum,
  commitCompactedInstancedMesh,
  FrustumCullStatus,
  sphereIntersectsFrustum,
} from './forestFrustumCuller';
import { computeTreeLodFadeBands } from '../game/qualityGovernor';
import {
  buildBirchGeometries,
  buildBogPineGeometries,
  buildConnectedTube,
  buildErraticBoulderGeo,
  buildLoneSpruceGeometries,
  buildPineGeometries,
  buildSpruceGeometries,
  buildSpruceSaplingGeometries,
  ConnectedTubeSegment,
  createBogPineSegments,
  TreeTopologyReport,
} from './botanicalGeometry';
import {
  BakedSlab,
  CAP_BOG_PINE,
  CAP_BOULDER,
  CAP_DEADFALL,
  CAP_FERN,
  CAP_HAZEL,
  CAP_JUNIPER,
  CAP_LOD0,
  CAP_LOD1,
  CAP_LOD2,
  CAP_MOSS,
  CAP_REED,
  CAP_SAPLING,
  CAP_SHRUB,
  ChunkBucketBaked,
  COLLIDER_CELL_SIZE,
  DeadfallLogTarget,
  DynamicFloraKind,
  GRASS_BLADE_CAP,
  GRASS_TILE_RADIUS,
  GRASS_TILE_SIZE,
  GrassTileBaked,
  MAX_CHUNK_CACHE,
  MAX_GRASS_TILE_CACHE,
  MOSS_CARPET_CAP,
  SHORT_GRASS_CAP,
  TALL_UNDERGROWTH_CAP,
  VegetationQualityOptions,
  VegetationStats,
} from './vegetation/vegetationTypes';
import {
  buildBilberrySubShrubGeo,
  buildFallenLogGeo,
  buildGrassTuftGeo,
  buildHazelBushGeometries,
  buildJuniperBushGeo,
  buildMossCarpetGeo,
  buildMossHummockGeo,
  buildOpaqueReedClumpGeo,
  buildPhotoFernRosetteGeo,
  buildShortGrassGeo,
  buildTallUndergrowthGeo,
} from './vegetation/understoryGeometry';
import {
  addBoulderMossLichenShader,
  addDistanceFade,
  addDualBarkBlend,
  addWindSway,
  FadeUniformPair,
  WindUniformSet,
} from './vegetation/foliageShaders';
import { bakeVegetationChunk } from './vegetation/vegetationChunkBaker';
import { appendShuffledSlab, bakeGrassTile } from './vegetation/grassTileStreamer';

export { buildConnectedTube, createBogPineSegments };
export type {
  ConnectedTubeSegment,
  DeadfallLogTarget,
  DynamicFloraKind,
  TreeTopologyReport,
  VegetationQualityOptions,
  VegetationStats,
};

const _bakeDummy = new THREE.Object3D();

export class WorldVegetationSystem {
  readonly group = new THREE.Group();
  readonly windTimeUniform = { value: 0 };
  readonly windStrengthUniform = { value: 0.9 };
  readonly windDirUniform = { value: new THREE.Vector2(0.86, 0.51) };
  readonly sunDirUniform = { value: new THREE.Vector3(0.5, 0.6, 0.35).normalize() };
  readonly sunColorUniform = { value: new THREE.Color(0xfff1d6) };

  private readonly lod0InFadeUniforms: FadeUniformPair = { start: { value: 50 }, end: { value: 56 } };
  private readonly lod0OutFadeUniforms: FadeUniformPair = { start: { value: 56 }, end: { value: 62 } };
  private readonly lod1InFadeUniforms: FadeUniformPair = { start: { value: 124 }, end: { value: 132 } };
  private readonly lod1OutFadeUniforms: FadeUniformPair = { start: { value: 132 }, end: { value: 140 } };
  private readonly treeFadeUniforms: FadeUniformPair = { start: { value: 184 }, end: { value: 226 } };
  private readonly bogFadeUniforms: FadeUniformPair = { start: { value: 114 }, end: { value: 150 } };
  private readonly bushFadeUniforms: FadeUniformPair = { start: { value: 88 }, end: { value: 124 } };
  private readonly underFadeUniforms: FadeUniformPair = { start: { value: 54 }, end: { value: 86 } };
  private readonly boulderFadeUniforms: FadeUniformPair = { start: { value: 112 }, end: { value: 146 } };
  private readonly grassFadeUniforms: FadeUniformPair = { start: { value: 18 }, end: { value: 30 } };
  private readonly shortGrassFadeUniforms: FadeUniformPair = { start: { value: 14 }, end: { value: 26 } };
  private readonly mossCarpetFadeUniforms: FadeUniformPair = { start: { value: 16 }, end: { value: 28 } };
  private readonly tallGrassFadeUniforms: FadeUniformPair = { start: { value: 22 }, end: { value: 38 } };

  private readonly chunkCache = new Map<string, ChunkBucketBaked>();
  private readonly grassTileCache = new Map<string, GrassTileBaked>();
  private readonly indexedColliderChunks = new Set<string>();
  private readonly colliderGrid = new Map<string, CircleCollider[]>();
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private lastVisibilitySig = '';
  private lastCullCamX = 999999;
  private lastCullCamZ = 999999;
  private lastCullFwdX = 0;
  private lastCullFwdZ = 0;
  private lastFogCullDist = 225;
  private lastQualitySig = '';
  private lastGrassTileX = 999999;
  private lastGrassTileZ = 999999;
  private lastGrassFwdX = 0;
  private lastGrassFwdZ = 0;
  private lastGrassQualitySig = '';
  private grassHasPendingTiles = true;
  private readonly brokenDeadfallIds = new Set<string>();
  private readonly deadfallKicksRemaining = new Map<string, number>();
  private forceVisRebuild = false;

  // Tree LOD InstancedMeshes (paired trunk+crown share identical instanceMatrix & instanceColor buffers)
  private birchTrunk0!: THREE.InstancedMesh;
  private birchCrown0!: THREE.InstancedMesh;
  private birchTrunk1!: THREE.InstancedMesh;
  private birchCrown1!: THREE.InstancedMesh;
  private birchTrunk2!: THREE.InstancedMesh;
  private birchCrown2!: THREE.InstancedMesh;

  private pineTrunk0!: THREE.InstancedMesh;
  private pineCrown0!: THREE.InstancedMesh;
  private pineTrunk1!: THREE.InstancedMesh;
  private pineCrown1!: THREE.InstancedMesh;
  private pineTrunk2!: THREE.InstancedMesh;
  private pineCrown2!: THREE.InstancedMesh;

  private bogPineTrunk!: THREE.InstancedMesh;
  private bogPineCrown!: THREE.InstancedMesh;

  private spruceTrunk0!: THREE.InstancedMesh;
  private spruceCrown0!: THREE.InstancedMesh;
  private spruceTrunk1!: THREE.InstancedMesh;
  private spruceCrown1!: THREE.InstancedMesh;
  private spruceTrunk2!: THREE.InstancedMesh;
  private spruceCrown2!: THREE.InstancedMesh;

  private loneSpruceTrunk0!: THREE.InstancedMesh;
  private loneSpruceCrown0!: THREE.InstancedMesh;
  private loneSpruceTrunk1!: THREE.InstancedMesh;
  private loneSpruceCrown1!: THREE.InstancedMesh;
  private loneSpruceTrunk2!: THREE.InstancedMesh;
  private loneSpruceCrown2!: THREE.InstancedMesh;

  private saplingTrunkMesh!: THREE.InstancedMesh;
  private saplingLeafMesh!: THREE.InstancedMesh;
  private deadfallMesh!: THREE.InstancedMesh;

  // Solid Woodland Bushes
  private hazelStemMesh!: THREE.InstancedMesh;
  private hazelLeafMesh!: THREE.InstancedMesh;
  private juniperMesh!: THREE.InstancedMesh;

  // Ground Coverage + Player-Centered Frustum-Culled Grass, Short Turf, Velvety Moss & Tall Undergrowth
  private grassBladeMesh!: THREE.InstancedMesh;
  private shortGrassMesh!: THREE.InstancedMesh;
  private mossCarpetMesh!: THREE.InstancedMesh;
  private tallUndergrowthMesh!: THREE.InstancedMesh;
  private fernMesh!: THREE.InstancedMesh;
  private shrubMesh!: THREE.InstancedMesh;
  private mossHummockMesh!: THREE.InstancedMesh;
  private reedMesh!: THREE.InstancedMesh;
  private boulderMesh!: THREE.InstancedMesh;
  private boulderOutcropMesh!: THREE.InstancedMesh;

  private primaryChunkMeshes: THREE.InstancedMesh[] = [];
  private pairedFollowers: Array<{ primary: THREE.InstancedMesh; follower: THREE.InstancedMesh }> = [];
  private cachedTreesCount = 0;
  private cachedFoliageCount = 0;
  private cachedCulledCount = 0;
  private cachedCandidateCount = 0;
  private diagChunkBakes = 0;
  private diagChunkEvictions = 0;
  private diagVisRebuilds = 0;
  private diagGrassRebuilds = 0;

  readonly dynamicPropsGroup = new THREE.Group();
  readonly inspectableMeshes: THREE.Object3D[] = [];
  private readonly dynamicPropMaterials = new Map<string, THREE.Material>();
  private dynamicPropCounter = 0;

  private readonly isLowPowerGpu: boolean;
  private readonly isSoftwareGl: boolean;
  private readonly grassCap: number;
  private readonly shortGrassCap: number;
  private readonly mossCarpetCap: number;
  private readonly tallCap: number;
  private lastGrassMaxRing = GRASS_TILE_RADIUS;
  private readonly grassRingSortBuf: Array<{ tx: number; tz: number; dSq: number }> = [];

  constructor(
    textures: WorldTextures,
    isSoftwareGl: boolean,
    isLowPowerGpu: boolean,
    private readonly shelters: ShelterGeometry
  ) {
    this.isLowPowerGpu = isLowPowerGpu;
    this.isSoftwareGl = isSoftwareGl;
    this.grassCap = isSoftwareGl ? 2200 : isLowPowerGpu ? 9500 : GRASS_BLADE_CAP;
    this.shortGrassCap = isSoftwareGl ? 3200 : isLowPowerGpu ? 13000 : SHORT_GRASS_CAP;
    this.mossCarpetCap = isSoftwareGl ? 1800 : isLowPowerGpu ? 7000 : MOSS_CARPET_CAP;
    this.tallCap = isSoftwareGl ? 750 : isLowPowerGpu ? 3400 : TALL_UNDERGROWTH_CAP;
    this.group.userData.debugLayer = 'foliage';
    this.dynamicPropsGroup.userData.debugLayer = 'foliage';
    this.buildInstancedLayers(textures, isSoftwareGl);
    this.group.add(this.dynamicPropsGroup);
    this.tagInspectableLayers();
    this.group.traverse((node) => {
      if (node instanceof THREE.InstancedMesh) node.receiveShadow = true;
    });
    const groundLayers = [
      this.grassBladeMesh,
      this.shortGrassMesh,
      this.mossCarpetMesh,
      this.tallUndergrowthMesh,
      this.fernMesh,
      this.shrubMesh,
      this.mossHummockMesh,
      this.reedMesh,
      this.hazelStemMesh,
      this.hazelLeafMesh,
      this.juniperMesh,
    ];
    for (const mesh of groundLayers) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        excludeShelterVegetation(material, shelters);
      }
    }
  }

  private tagInspectableLayers(): void {
    const tag = (mesh: THREE.Object3D, debugName: string, species: string) => {
      mesh.userData.debugLayer = 'foliage';
      mesh.userData.debugName = debugName;
      mesh.userData.debugMeta = { species };
      this.inspectableMeshes.push(mesh);
    };
    tag(this.birchTrunk0, 'Silver Birch (Arukask)', 'birch');
    tag(this.birchCrown0, 'Silver Birch Canopy', 'birch');
    tag(this.birchTrunk1, 'Silver Birch (LOD1)', 'birch');
    tag(this.birchCrown1, 'Silver Birch Canopy (LOD1)', 'birch');
    tag(this.pineTrunk0, 'Scots Pine (Harilik mänd)', 'pine');
    tag(this.pineCrown0, 'Scots Pine Canopy', 'pine');
    tag(this.pineTrunk1, 'Scots Pine (LOD1)', 'pine');
    tag(this.pineCrown1, 'Scots Pine Canopy (LOD1)', 'pine');
    tag(this.spruceTrunk0, 'Norway Spruce (Kuusk)', 'spruce');
    tag(this.spruceCrown0, 'Norway Spruce Canopy', 'spruce');
    tag(this.spruceTrunk1, 'Norway Spruce (LOD1)', 'spruce');
    tag(this.spruceCrown1, 'Norway Spruce Canopy (LOD1)', 'spruce');
    tag(this.loneSpruceTrunk0, 'Lone Norway Spruce', 'lone_spruce');
    tag(this.loneSpruceCrown0, 'Lone Norway Spruce Canopy', 'lone_spruce');
    tag(this.loneSpruceTrunk1, 'Lone Norway Spruce (LOD1)', 'lone_spruce');
    tag(this.loneSpruceCrown1, 'Lone Norway Spruce Canopy (LOD1)', 'lone_spruce');
    tag(this.bogPineTrunk, 'Bog Pine (Rabamänd)', 'bog_pine');
    tag(this.bogPineCrown, 'Bog Pine Canopy', 'bog_pine');
    tag(this.saplingTrunkMesh, 'Spruce Sapling', 'spruce_sapling');
    tag(this.saplingLeafMesh, 'Spruce Sapling Boughs', 'spruce_sapling');
    tag(this.deadfallMesh, 'Fallen Log (Lamav palk)', 'deadfall');
    tag(this.hazelStemMesh, 'Hazel Bush (Sarapuu)', 'hazel');
    tag(this.hazelLeafMesh, 'Hazel Bush Foliage', 'hazel');
    tag(this.juniperMesh, 'Juniper (Kadakas)', 'juniper');
    tag(this.fernMesh, 'Forest Fern (Sõnajalg)', 'fern');
    tag(this.shrubMesh, 'Bilberry Shrub (Mustikas)', 'shrub');
    tag(this.mossHummockMesh, 'Moss Hummock', 'moss');
    tag(this.reedMesh, 'Bog Reeds (Pilliroog)', 'reed');
    tag(this.boulderMesh, 'Glacial Boulder (Rändrahn)', 'boulder');
    tag(this.boulderOutcropMesh, 'Granite Outcrop', 'boulder');
    this.inspectableMeshes.push(this.dynamicPropsGroup);
  }

  private getOrCloneDynamicMaterial(key: string, src: THREE.Material): THREE.Material {
    const existing = this.dynamicPropMaterials.get(key);
    if (existing) return existing;
    let mat: THREE.Material;
    if (src instanceof THREE.MeshStandardMaterial) {
      mat = new THREE.MeshStandardMaterial({
        map: src.map,
        normalMap: src.normalMap,
        normalScale: src.normalScale.clone(),
        roughness: src.roughness,
        metalness: src.metalness,
        envMapIntensity: src.envMapIntensity,
        vertexColors: src.vertexColors,
        alphaTest: src.alphaTest,
        side: src.side,
      });
    } else if (src instanceof THREE.MeshLambertMaterial) {
      mat = new THREE.MeshLambertMaterial({
        map: src.map,
        alphaTest: src.alphaTest,
        vertexColors: src.vertexColors,
        side: src.side,
      });
    } else {
      mat = src.clone();
    }
    this.dynamicPropMaterials.set(key, mat);
    this.disposables.push(mat);
    return mat;
  }

  spawnDynamicProp(
    kind: DynamicFloraKind,
    x: number,
    z: number,
    scale?: number,
    rotY?: number
  ): { id: string; kind: DynamicFloraKind; x: number; y: number; z: number; radius: number } {
    const id = `dyn_${kind}_${++this.dynamicPropCounter}`;
    const y = getTerrainHeight(x, z) - (kind === 'boulder' ? 0.05 : 0.08);
    const yaw = rotY ?? Math.random() * Math.PI * 2;
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = yaw;
    const shadows = !this.isSoftwareGl;

    let propScale = scale ?? 1;
    let radius = 0.3;
    let label: string = kind;

    if (kind === 'boulder') {
      propScale = scale ?? 0.95;
      radius = propScale * 0.78;
      label = 'Glacial Boulder (Spawned)';
      const mat = this.getOrCloneDynamicMaterial('boulder', this.boulderMesh.material as THREE.Material);
      const mesh = new THREE.Mesh(this.boulderMesh.geometry, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      grp.add(mesh);
    } else {
      let trunkSrc: THREE.InstancedMesh = this.spruceTrunk0;
      let crownSrc: THREE.InstancedMesh = this.spruceCrown0;
      if (kind === 'spruce') {
        propScale = scale ?? 1.0;
        radius = 0.34 * propScale;
        label = 'Norway Spruce (Spawned)';
        trunkSrc = this.spruceTrunk0;
        crownSrc = this.spruceCrown0;
      } else if (kind === 'lone_spruce') {
        propScale = scale ?? 1.0;
        radius = 0.38 * propScale;
        label = 'Lone Norway Spruce (Spawned)';
        trunkSrc = this.loneSpruceTrunk0;
        crownSrc = this.loneSpruceCrown0;
      } else if (kind === 'spruce_sapling') {
        propScale = scale ?? 1.0;
        radius = 0.25 * propScale;
        label = 'Spruce Sapling (Spawned)';
        trunkSrc = this.saplingTrunkMesh;
        crownSrc = this.saplingLeafMesh;
      } else if (kind === 'pine') {
        propScale = scale ?? 1.0;
        radius = 0.34 * propScale;
        label = 'Scots Pine (Spawned)';
        trunkSrc = this.pineTrunk0;
        crownSrc = this.pineCrown0;
      } else if (kind === 'birch') {
        propScale = scale ?? 1.0;
        radius = 0.3 * propScale;
        label = 'Silver Birch (Spawned)';
        trunkSrc = this.birchTrunk0;
        crownSrc = this.birchCrown0;
      } else if (kind === 'bog_pine') {
        propScale = scale ?? 1.0;
        radius = 0.24 * propScale;
        label = 'Bog Pine (Spawned)';
        trunkSrc = this.bogPineTrunk;
        crownSrc = this.bogPineCrown;
      }
      const trunkMat = this.getOrCloneDynamicMaterial(`${kind}_trunk`, trunkSrc.material as THREE.Material);
      const crownMat = this.getOrCloneDynamicMaterial(`${kind}_crown`, crownSrc.material as THREE.Material);
      const trunkMesh = new THREE.Mesh(trunkSrc.geometry, trunkMat);
      trunkMesh.castShadow = shadows;
      trunkMesh.receiveShadow = true;
      const crownMesh = new THREE.Mesh(crownSrc.geometry, crownMat);
      crownMesh.castShadow = false;
      crownMesh.receiveShadow = true;
      grp.add(trunkMesh, crownMesh);
    }

    grp.scale.setScalar(propScale);
    const meta = { id, kind, scale: Math.round(propScale * 100) / 100, spawned: true };
    grp.userData.debugLayer = 'foliage';
    grp.userData.debugName = label;
    grp.userData.debugMeta = meta;
    grp.traverse((child) => {
      child.userData.debugLayer = 'foliage';
      child.userData.debugName = label;
      child.userData.debugMeta = meta;
    });
    this.dynamicPropsGroup.add(grp);
    this.indexChunkColliders([{ x, z, r: radius }]);
    return { id, kind, x, y, z, radius };
  }

  private readonly isInsideBuilding = (x: number, z: number): boolean =>
    this.shelters.footprints.some(
      (area) => !area.temporary && !area.clearingOnly && containsFootprint(area, x, z, 1.2)
    );

  private indexChunkColliders(colliders: CircleCollider[]): void {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const gx = Math.floor(c.x / COLLIDER_CELL_SIZE);
      const gz = Math.floor(c.z / COLLIDER_CELL_SIZE);
      const key = `${gx}_${gz}`;
      let list = this.colliderGrid.get(key);
      if (!list) {
        list = [];
        this.colliderGrid.set(key, list);
      }
      if (!list.some((ex) => Math.abs(ex.x - c.x) < 0.05 && Math.abs(ex.z - c.z) < 0.05)) {
        list.push(c);
      }
    }
  }

  queryNearbyColliders(x: number, z: number, out: CircleCollider[]): void {
    out.length = 0;
    const cx = Math.floor(x / COLLIDER_CELL_SIZE);
    const cz = Math.floor(z / COLLIDER_CELL_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.colliderGrid.get(`${cx + dx}_${cz + dz}`);
        if (list) {
          for (let i = 0; i < list.length; i++) out.push(list[i]);
        }
      }
    }
  }

  private getOrBakeChunk(vcx: number, vcz: number): ChunkBucketBaked {
    const key = `${vcx}_${vcz}`;
    const cached = this.chunkCache.get(key);
    if (cached) {
      this.chunkCache.delete(key);
      this.chunkCache.set(key, cached);
      return cached;
    }

    const baked = bakeVegetationChunk(
      vcx,
      vcz,
      this.isInsideBuilding,
      this.brokenDeadfallIds,
      this.deadfallKicksRemaining
    );

    if (!this.indexedColliderChunks.has(key) && baked.colliders.length > 0) {
      this.indexedColliderChunks.add(key);
      this.indexChunkColliders(baked.colliders);
    }
    this.chunkCache.set(key, baked);
    if (baked.cells.length > 0) this.diagChunkBakes++;
    if (this.chunkCache.size > MAX_CHUNK_CACHE) {
      const oldestKey = this.chunkCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.chunkCache.delete(oldestKey);
        this.diagChunkEvictions++;
      }
    }

    return baked;
  }

  private createInstanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    maxCapacity: number,
    castShadow: boolean,
    receiveShadow = false,
    registerInChunkMeshes = true
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, maxCapacity);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colors = new Float32Array(maxCapacity * 3);
    colors.fill(1);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    if (registerInChunkMeshes) this.primaryChunkMeshes.push(mesh);
    this.disposables.push(geo, mat);
    return mesh;
  }

  private createPairedFollower(
    primary: THREE.InstancedMesh,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    maxCapacity: number,
    castShadow = false,
    receiveShadow = false
  ): THREE.InstancedMesh {
    const follower = new THREE.InstancedMesh(geo, mat, maxCapacity);
    follower.count = 0;
    follower.visible = false;
    follower.frustumCulled = false;
    follower.castShadow = castShadow;
    follower.receiveShadow = receiveShadow;
    follower.instanceMatrix = primary.instanceMatrix;
    follower.instanceColor = primary.instanceColor;
    this.group.add(follower);
    this.pairedFollowers.push({ primary, follower });
    this.disposables.push(geo, mat);
    return follower;
  }

  private buildInstancedLayers(textures: WorldTextures, isSoftwareGl: boolean): void {
    const windUniforms: WindUniformSet = {
      time: this.windTimeUniform,
      strength: this.windStrengthUniform,
      dir: this.windDirUniform,
      sunDir: this.sunDirUniform,
      sunColor: this.sunColorUniform,
    };

    const birch = buildBirchGeometries();
    const pine = buildPineGeometries();
    const bogPine = buildBogPineGeometries();
    const spruce = buildSpruceGeometries();
    const loneSpruce = buildLoneSpruceGeometries();
    const sapling = buildSpruceSaplingGeometries();
    const hazel = buildHazelBushGeometries();
    const juniperGeo = buildJuniperBushGeo();
    const deadfallGeo = buildFallenLogGeo();

    const birchBark0Mat = new THREE.MeshStandardMaterial({
      map: textures.birchBark,
      normalMap: textures.birchNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.86,
      metalness: 0.0,
      envMapIntensity: 0.45,
      vertexColors: true,
    });
    addWindSway(birchBark0Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      fade: this.lod0OutFadeUniforms,
    });
    addDualBarkBlend(birchBark0Mat, textures.birchBarkBase, {
      id: 'birch_base',
      yLow: 0.48,
      yHigh: 1.72,
      noiseAmp: 0.48,
      invert: true,
      uvScaleX: 1.8,
      uvScaleY: 1.8,
    });

    const birchLeaf0Mat = new THREE.MeshLambertMaterial({
      map: textures.birchLeafCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(birchLeaf0Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0.13,
      leafFreq: 3.6,
      sssStrength: 0.48,
      fade: this.lod0OutFadeUniforms,
    });

    const birchLeaf1Mat = new THREE.MeshLambertMaterial({
      map: textures.birchLeafCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(birchLeaf1Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0.12,
      leafFreq: 3.6,
      sssStrength: 0.48,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });

    const birchLeaf2Mat = new THREE.MeshLambertMaterial({
      map: textures.birchLeafCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(birchLeaf2Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0.1,
      leafFreq: 3.4,
      sssStrength: 0.48,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });

    const pineBark0Mat = new THREE.MeshStandardMaterial({
      map: textures.pineBark,
      normalMap: textures.pineNormal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.93,
      metalness: 0.0,
      envMapIntensity: 0.42,
      vertexColors: true,
    });
    addWindSway(pineBark0Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      fade: this.lod0OutFadeUniforms,
    });
    addDualBarkBlend(pineBark0Mat, textures.pineBarkUpper, {
      id: 'pine_upper',
      yLow: 4.5,
      yHigh: 8.6,
      noiseAmp: 1.55,
      invert: false,
      uvScaleX: 1.2,
      uvScaleY: 1.2,
    });

    const pineLeaf0Mat = new THREE.MeshLambertMaterial({
      map: textures.pineNeedleCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(pineLeaf0Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0.08,
      leafFreq: 3.0,
      sssStrength: 0.38,
      fade: this.lod0OutFadeUniforms,
    });

    const pineLeaf1Mat = new THREE.MeshLambertMaterial({
      map: textures.pineNeedleCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(pineLeaf1Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0.08,
      leafFreq: 3.0,
      sssStrength: 0.38,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });

    const pineLeaf2Mat = new THREE.MeshLambertMaterial({
      map: textures.pineNeedleCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(pineLeaf2Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0.07,
      leafFreq: 2.9,
      sssStrength: 0.38,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });

    const bogPineBarkMat = new THREE.MeshStandardMaterial({
      map: textures.pineBark,
      normalMap: textures.pineNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.4,
    });
    addWindSway(bogPineBarkMat, windUniforms, {
      bendStart: 0.2,
      bendSpan: 2.8,
      bendAmp: 0.14,
      leafAmp: 0,
      leafFreq: 0,
      fade: this.bogFadeUniforms,
    });
    const bogPineLeafMat = new THREE.MeshLambertMaterial({
      map: textures.pineNeedleCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(bogPineLeafMat, windUniforms, {
      bendStart: 0.2,
      bendSpan: 2.8,
      bendAmp: 0.14,
      leafAmp: 0.06,
      leafFreq: 3.2,
      sssStrength: 0.42,
      fade: this.bogFadeUniforms,
    });

    const spruceBark0Mat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.spruceNormal,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.4,
      vertexColors: true,
    });
    addWindSway(spruceBark0Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0,
      leafFreq: 0,
      fade: this.lod0OutFadeUniforms,
    });

    const spruceLeaf0Mat = new THREE.MeshLambertMaterial({
      map: textures.spruceBoughCard,
      alphaTest: 0.36,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(spruceLeaf0Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0.075,
      leafFreq: 2.9,
      sssStrength: 0.36,
      fade: this.lod0OutFadeUniforms,
    });

    const spruceLeaf1Mat = new THREE.MeshLambertMaterial({
      map: textures.spruceBoughCard,
      alphaTest: 0.35,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(spruceLeaf1Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0.075,
      leafFreq: 2.9,
      sssStrength: 0.36,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });

    const spruceLeaf2Mat = new THREE.MeshLambertMaterial({
      map: textures.spruceBoughCard,
      alphaTest: 0.34,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(spruceLeaf2Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0.06,
      leafFreq: 2.8,
      sssStrength: 0.36,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });

    const saplingTrunkMat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.spruceNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.36,
      vertexColors: true,
    });
    addWindSway(saplingTrunkMat, windUniforms, {
      bendStart: 0.12,
      bendSpan: 2.4,
      bendAmp: 0.14,
      leafAmp: 0,
      leafFreq: 0,
      fade: this.bushFadeUniforms,
    });
    const saplingLeafMat = new THREE.MeshLambertMaterial({
      map: textures.spruceBoughCard,
      alphaTest: 0.38,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(saplingLeafMat, windUniforms, {
      bendStart: 0.12,
      bendSpan: 2.4,
      bendAmp: 0.14,
      leafAmp: 0.055,
      leafFreq: 3.6,
      sssStrength: 0.52,
      fade: this.bushFadeUniforms,
    });

    const hazelStemMat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.spruceNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.4,
    });
    addWindSway(hazelStemMat, windUniforms, {
      bendStart: 0.08,
      bendSpan: 1.5,
      bendAmp: 0.14,
      leafAmp: 0,
      leafFreq: 0,
      fade: this.bushFadeUniforms,
    });
    const hazelLeafMat = new THREE.MeshLambertMaterial({
      map: textures.bushLeafCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(hazelLeafMat, windUniforms, {
      bendStart: 0.08,
      bendSpan: 1.5,
      bendAmp: 0.14,
      leafAmp: 0.08,
      leafFreq: 4.3,
      sssStrength: 0.5,
      fade: this.bushFadeUniforms,
    });

    const juniperMat = new THREE.MeshLambertMaterial({
      map: textures.pineNeedleCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(juniperMat, windUniforms, {
      bendStart: 0.08,
      bendSpan: 1.35,
      bendAmp: 0.11,
      leafAmp: 0.045,
      leafFreq: 3.4,
      sssStrength: 0.36,
      fade: this.bushFadeUniforms,
    });

    const shadows = !isSoftwareGl;

    const birchBark1Mat = new THREE.MeshLambertMaterial({ map: textures.birchBark, vertexColors: true });
    addWindSway(birchBark1Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });
    addDualBarkBlend(birchBark1Mat, textures.birchBarkBase, {
      id: 'birch_base_l1',
      yLow: 0.48,
      yHigh: 1.72,
      noiseAmp: 0.48,
      invert: true,
      uvScaleX: 1.8,
      uvScaleY: 1.8,
    });
    const birchBark2Mat = new THREE.MeshLambertMaterial({ map: textures.birchBark, vertexColors: true });
    addWindSway(birchBark2Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });
    addDualBarkBlend(birchBark2Mat, textures.birchBarkBase, {
      id: 'birch_base_l2',
      yLow: 0.48,
      yHigh: 1.72,
      noiseAmp: 0.48,
      invert: true,
      uvScaleX: 1.8,
      uvScaleY: 1.8,
    });

    const pineBark1Mat = new THREE.MeshLambertMaterial({ map: textures.pineBark, vertexColors: true });
    addWindSway(pineBark1Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });
    addDualBarkBlend(pineBark1Mat, textures.pineBarkUpper, {
      id: 'pine_upper_l1',
      yLow: 4.5,
      yHigh: 8.6,
      noiseAmp: 1.55,
      invert: false,
      uvScaleX: 1.2,
      uvScaleY: 1.2,
    });
    const pineBark2Mat = new THREE.MeshLambertMaterial({ map: textures.pineBark, vertexColors: true });
    addWindSway(pineBark2Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });
    addDualBarkBlend(pineBark2Mat, textures.pineBarkUpper, {
      id: 'pine_upper_l2',
      yLow: 4.5,
      yHigh: 8.6,
      noiseAmp: 1.55,
      invert: false,
      uvScaleX: 1.2,
      uvScaleY: 1.2,
    });

    const spruceBark1Mat = new THREE.MeshLambertMaterial({ map: textures.spruceBark, vertexColors: true });
    addWindSway(spruceBark1Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });
    const spruceBark2Mat = new THREE.MeshLambertMaterial({ map: textures.spruceBark, vertexColors: true });
    addWindSway(spruceBark2Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });

    this.birchTrunk0 = this.createInstanced(birch.trunkLod0, birchBark0Mat, CAP_LOD0, shadows, true);
    this.birchCrown0 = this.createPairedFollower(this.birchTrunk0, birch.crownLod0, birchLeaf0Mat, CAP_LOD0);
    this.birchTrunk1 = this.createInstanced(birch.trunkLod1, birchBark1Mat, CAP_LOD1, false, false);
    this.birchCrown1 = this.createPairedFollower(this.birchTrunk1, birch.crownLod1, birchLeaf1Mat, CAP_LOD1);
    this.birchTrunk2 = this.createInstanced(birch.trunkLod2, birchBark2Mat, CAP_LOD2, false, false);
    this.birchCrown2 = this.createPairedFollower(this.birchTrunk2, birch.crownLod2, birchLeaf2Mat, CAP_LOD2);

    this.pineTrunk0 = this.createInstanced(pine.trunkLod0, pineBark0Mat, CAP_LOD0, shadows, true);
    this.pineCrown0 = this.createPairedFollower(this.pineTrunk0, pine.crownLod0, pineLeaf0Mat, CAP_LOD0);
    this.pineTrunk1 = this.createInstanced(pine.trunkLod1, pineBark1Mat, CAP_LOD1, false, false);
    this.pineCrown1 = this.createPairedFollower(this.pineTrunk1, pine.crownLod1, pineLeaf1Mat, CAP_LOD1);
    this.pineTrunk2 = this.createInstanced(pine.trunkLod2, pineBark2Mat, CAP_LOD2, false, false);
    this.pineCrown2 = this.createPairedFollower(this.pineTrunk2, pine.crownLod2, pineLeaf2Mat, CAP_LOD2);

    this.bogPineTrunk = this.createInstanced(bogPine.trunk, bogPineBarkMat, CAP_BOG_PINE, shadows, true);
    this.bogPineCrown = this.createPairedFollower(this.bogPineTrunk, bogPine.crown, bogPineLeafMat, CAP_BOG_PINE);

    this.spruceTrunk0 = this.createInstanced(spruce.trunkLod0, spruceBark0Mat, CAP_LOD0, shadows, true);
    this.spruceCrown0 = this.createPairedFollower(this.spruceTrunk0, spruce.crownLod0, spruceLeaf0Mat, CAP_LOD0);
    this.spruceTrunk1 = this.createInstanced(spruce.trunkLod1, spruceBark1Mat, CAP_LOD1, false, false);
    this.spruceCrown1 = this.createPairedFollower(this.spruceTrunk1, spruce.crownLod1, spruceLeaf1Mat, CAP_LOD1);
    this.spruceTrunk2 = this.createInstanced(spruce.trunkLod2, spruceBark2Mat, CAP_LOD2, false, false);
    this.spruceCrown2 = this.createPairedFollower(this.spruceTrunk2, spruce.crownLod2, spruceLeaf2Mat, CAP_LOD2);

    this.loneSpruceTrunk0 = this.createInstanced(loneSpruce.trunkLod0, spruceBark0Mat, CAP_LOD0, shadows, true);
    this.loneSpruceCrown0 = this.createPairedFollower(this.loneSpruceTrunk0, loneSpruce.crownLod0, spruceLeaf0Mat, CAP_LOD0);
    this.loneSpruceTrunk1 = this.createInstanced(loneSpruce.trunkLod1, spruceBark1Mat, CAP_LOD1, false, false);
    this.loneSpruceCrown1 = this.createPairedFollower(this.loneSpruceTrunk1, loneSpruce.crownLod1, spruceLeaf1Mat, CAP_LOD1);
    this.loneSpruceTrunk2 = this.createInstanced(loneSpruce.trunkLod2, spruceBark2Mat, CAP_LOD2, false, false);
    this.loneSpruceCrown2 = this.createPairedFollower(this.loneSpruceTrunk2, loneSpruce.crownLod2, spruceLeaf2Mat, CAP_LOD2);

    this.saplingTrunkMesh = this.createInstanced(sapling.trunk, saplingTrunkMat, CAP_SAPLING, false, true);
    this.saplingLeafMesh = this.createPairedFollower(this.saplingTrunkMesh, sapling.foliage, saplingLeafMat, CAP_SAPLING);

    const deadfallMat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.spruceNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.3,
    });
    addDistanceFade(deadfallMat, this.bushFadeUniforms);
    this.deadfallMesh = this.createInstanced(deadfallGeo, deadfallMat, CAP_DEADFALL, false, true);

    this.hazelStemMesh = this.createInstanced(hazel.stems, hazelStemMat, CAP_HAZEL, false, false);
    this.hazelLeafMesh = this.createPairedFollower(this.hazelStemMesh, hazel.leaves, hazelLeafMat, CAP_HAZEL);
    this.juniperMesh = this.createInstanced(juniperGeo, juniperMat, CAP_JUNIPER, false, false);

    const bladeGeo = buildGrassTuftGeo();
    const bladeMat = new THREE.MeshLambertMaterial({
      map: textures.grassClumpCard,
      alphaTest: 0.38,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(bladeMat, windUniforms, {
      bendStart: 0.02,
      bendSpan: 0.48,
      bendAmp: 0.16,
      leafAmp: 0.05,
      leafFreq: 5.0,
      sssStrength: 0.44,
      fade: this.grassFadeUniforms,
      heightFadeScale: 0.34,
    });
    this.grassBladeMesh = this.createInstanced(bladeGeo, bladeMat, this.grassCap, false, false, false);

    const shortGrassGeo = buildShortGrassGeo();
    const shortGrassMat = new THREE.MeshLambertMaterial({
      map: textures.shortGrassCard,
      alphaTest: 0.36,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(shortGrassMat, windUniforms, {
      bendStart: 0.015,
      bendSpan: 0.24,
      bendAmp: 0.075,
      leafAmp: 0.028,
      leafFreq: 5.4,
      sssStrength: 0.4,
      fade: this.shortGrassFadeUniforms,
      heightFadeScale: 0.3,
    });
    this.shortGrassMesh = this.createInstanced(shortGrassGeo, shortGrassMat, this.shortGrassCap, false, false, false);

    const mossCarpetGeo = buildMossCarpetGeo();
    const mossCarpetMat = new THREE.MeshStandardMaterial({
      map: textures.mossCarpetTex,
      normalMap: textures.mossNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.32,
      vertexColors: true,
    });
    addDistanceFade(mossCarpetMat, this.mossCarpetFadeUniforms);
    this.mossCarpetMesh = this.createInstanced(mossCarpetGeo, mossCarpetMat, this.mossCarpetCap, false, true, false);

    const tallGeo = buildTallUndergrowthGeo();
    const tallMat = new THREE.MeshLambertMaterial({
      map: textures.tallUndergrowthCard,
      alphaTest: 0.4,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(tallMat, windUniforms, {
      bendStart: 0.06,
      bendSpan: 1.05,
      bendAmp: 0.24,
      leafAmp: 0.065,
      leafFreq: 4.3,
      sssStrength: 0.46,
      fade: this.tallGrassFadeUniforms,
      heightFadeScale: 0.36,
    });
    this.tallUndergrowthMesh = this.createInstanced(tallGeo, tallMat, this.tallCap, false, false, false);

    const fernGeo = buildPhotoFernRosetteGeo();
    const fernMat = new THREE.MeshLambertMaterial({
      map: textures.fernFrondCard,
      alphaTest: 0.42,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(fernMat, windUniforms, {
      bendStart: 0.04,
      bendSpan: 0.56,
      bendAmp: 0.11,
      leafAmp: 0.035,
      leafFreq: 3.9,
      sssStrength: 0.52,
      fade: this.underFadeUniforms,
    });
    this.fernMesh = this.createInstanced(fernGeo, fernMat, CAP_FERN, false, false);

    const shrubGeo = buildBilberrySubShrubGeo();
    const shrubMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    addWindSway(shrubMat, windUniforms, {
      bendStart: 0.05,
      bendSpan: 0.48,
      bendAmp: 0.08,
      leafAmp: 0.025,
      leafFreq: 4.2,
      sssStrength: 0.36,
      fade: this.underFadeUniforms,
    });
    this.shrubMesh = this.createInstanced(shrubGeo, shrubMat, CAP_SHRUB, false, false);

    const mossGeo = buildMossHummockGeo();
    const mossMat = new THREE.MeshStandardMaterial({
      map: textures.mossCarpetTex,
      normalMap: textures.mossNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.34,
      vertexColors: true,
    });
    addDistanceFade(mossMat, this.underFadeUniforms);
    this.mossHummockMesh = this.createInstanced(mossGeo, mossMat, CAP_MOSS, false, true);

    const reedGeo = buildOpaqueReedClumpGeo();
    const reedMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    addWindSway(reedMat, windUniforms, {
      bendStart: 0.06,
      bendSpan: 1.15,
      bendAmp: 0.22,
      leafAmp: 0.05,
      leafFreq: 4.1,
      sssStrength: 0.4,
      fade: this.bogFadeUniforms,
    });
    this.reedMesh = this.createInstanced(reedGeo, reedMat, CAP_REED, false, false);

    const boulderGeo0 = buildErraticBoulderGeo(0);
    const boulderGeo1 = buildErraticBoulderGeo(1);
    const boulderMat = new THREE.MeshStandardMaterial({
      map: textures.boulderGranite,
      normalMap: textures.boulderNormal,
      normalScale: new THREE.Vector2(1.25, 1.25),
      roughness: 0.86,
      metalness: 0.02,
      envMapIntensity: 0.42,
      vertexColors: true,
    });
    addDistanceFade(boulderMat, this.boulderFadeUniforms);
    addBoulderMossLichenShader(boulderMat, textures.boulderMossCoat, textures.boulderLichenCoat);
    this.boulderMesh = this.createInstanced(boulderGeo0, boulderMat, CAP_BOULDER, shadows, true);
    this.boulderOutcropMesh = this.createInstanced(boulderGeo1, boulderMat, CAP_BOULDER, shadows, true);
  }

  private updateGrassCarpet(
    camX: number,
    camZ: number,
    frustumPlanes?: Float32Array,
    camForward?: THREE.Vector3,
    bakeBudget = 2,
    maxRenderDist = 225,
    qualityOpts?: VegetationQualityOptions
  ): void {
    const ptx = Math.floor(camX / GRASS_TILE_SIZE);
    const ptz = Math.floor(camZ / GRASS_TILE_SIZE);
    const fallbackRing: 1 | 2 = this.isLowPowerGpu && maxRenderDist < 115 ? 1 : GRASS_TILE_RADIUS;
    const maxRing = qualityOpts?.grassMaxRing ?? fallbackRing;
    const ring1Step = qualityOpts?.grassRing1Step ?? (this.isLowPowerGpu ? 2 : 1);
    const ring2Step = qualityOpts?.grassRing2Step ?? (this.isLowPowerGpu ? 3 : 2);
    const ring3Step = qualityOpts?.grassRing3Step ?? 2;
    const ring4Step = qualityOpts?.grassRing4Step ?? 2;
    const grassEnd = Math.max(14, maxRing * GRASS_TILE_SIZE - 2);
    this.grassFadeUniforms.end.value = grassEnd;
    this.grassFadeUniforms.start.value = Math.max(6, grassEnd * 0.54);
    const shortEnd = Math.max(12, grassEnd * 0.84);
    this.shortGrassFadeUniforms.end.value = shortEnd;
    this.shortGrassFadeUniforms.start.value = Math.max(5, shortEnd * 0.52);
    const mossEnd = Math.max(14, grassEnd * 0.9);
    this.mossCarpetFadeUniforms.end.value = mossEnd;
    this.mossCarpetFadeUniforms.start.value = Math.max(6, mossEnd * 0.56);
    const tallEnd = grassEnd + 10;
    this.tallGrassFadeUniforms.end.value = tallEnd;
    this.tallGrassFadeUniforms.start.value = Math.max(10, tallEnd * 0.56);
    const grassQualitySig = `${maxRing}_${ring1Step}_${ring2Step}_${ring3Step}_${ring4Step}`;

    const tileMoved =
      ptx !== this.lastGrassTileX ||
      ptz !== this.lastGrassTileZ ||
      maxRing !== this.lastGrassMaxRing ||
      grassQualitySig !== this.lastGrassQualitySig;

    let rotChanged = false;
    if (camForward) {
      const fl = Math.hypot(camForward.x, camForward.z) || 1;
      const fx = camForward.x / fl;
      const fz = camForward.z / fl;
      const dot = fx * this.lastGrassFwdX + fz * this.lastGrassFwdZ;
      if (dot < 0.996) {
        rotChanged = true;
        this.lastGrassFwdX = fx;
        this.lastGrassFwdZ = fz;
      }
    }

    if (!tileMoved && !rotChanged && !this.grassHasPendingTiles) return;

    this.lastGrassTileX = ptx;
    this.lastGrassTileZ = ptz;
    this.lastGrassMaxRing = maxRing;
    this.lastGrassQualitySig = grassQualitySig;

    let bakedThisCall = 0;
    let missingTiles = 0;
    const matArr = this.grassBladeMesh.instanceMatrix.array as Float32Array;
    const colArr = this.grassBladeMesh.instanceColor!.array as Float32Array;
    const shortMatArr = this.shortGrassMesh.instanceMatrix.array as Float32Array;
    const shortColArr = this.shortGrassMesh.instanceColor!.array as Float32Array;
    const mossMatArr = this.mossCarpetMesh.instanceMatrix.array as Float32Array;
    const mossColArr = this.mossCarpetMesh.instanceColor!.array as Float32Array;
    const tallMatArr = this.tallUndergrowthMesh.instanceMatrix.array as Float32Array;
    const tallColArr = this.tallUndergrowthMesh.instanceColor!.array as Float32Array;
    const grassCap = this.grassCap;
    const shortGrassCap = this.shortGrassCap;
    const mossCarpetCap = this.mossCarpetCap;
    const tallCap = this.tallCap;
    const sortBuf = this.grassRingSortBuf;
    let count = 0;
    let shortCount = 0;
    let mossCount = 0;
    let tallCount = 0;

    for (let ring = 0; ring <= maxRing; ring++) {
      sortBuf.length = 0;
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const tx = ptx + dx;
          const tz = ptz + dz;
          const tileCx = (tx + 0.5) * GRASS_TILE_SIZE;
          const tileCz = (tz + 0.5) * GRASS_TILE_SIZE;
          const dSq = (tileCx - camX) * (tileCx - camX) + (tileCz - camZ) * (tileCz - camZ);
          sortBuf.push({ tx, tz, dSq });
        }
      }
      if (sortBuf.length > 1) sortBuf.sort((a, b) => a.dSq - b.dSq);

      const ringStep =
        ring === 0
          ? 1
          : ring === 1
            ? ring1Step
            : ring === 2
              ? ring2Step
              : ring === 3
                ? ring3Step
                : ring4Step;
      const fillerStep = ring <= 1 ? ringStep : Math.min(4, ringStep + 1);

      for (let s = 0; s < sortBuf.length; s++) {
        const tx = sortBuf[s].tx;
        const tz = sortBuf[s].tz;
        const tileCx = (tx + 0.5) * GRASS_TILE_SIZE;
        const tileCz = (tz + 0.5) * GRASS_TILE_SIZE;

        if (ring > 0 && frustumPlanes) {
          const cached = this.grassTileCache.get(`${tx}_${tz}`);
          const cy = cached ? cached.cy : getTerrainHeight(tileCx, tileCz) + 0.5;
          const r = (cached ? cached.r : 11.8) + 3.4;
          if (!sphereIntersectsFrustum(frustumPlanes, tileCx, cy, tileCz, r)) continue;
        }

        const key = `${tx}_${tz}`;
        let tile = this.grassTileCache.get(key);
        if (tile) {
          this.grassTileCache.delete(key);
          this.grassTileCache.set(key, tile);
        } else if (bakedThisCall < bakeBudget) {
          tile = bakeGrassTile(tx, tz, this.shelters);
          this.grassTileCache.set(key, tile);
          bakedThisCall++;
          if (this.grassTileCache.size > MAX_GRASS_TILE_CACHE) {
            const oldest = this.grassTileCache.keys().next().value;
            if (oldest !== undefined) this.grassTileCache.delete(oldest);
          }
        } else {
          missingTiles++;
          continue;
        }

        count = appendShuffledSlab(tile.slab, matArr, colArr, count, grassCap, ring, ringStep, camX, camZ, camForward);
        shortCount = appendShuffledSlab(tile.shortSlab, shortMatArr, shortColArr, shortCount, shortGrassCap, ring, fillerStep, camX, camZ, camForward);
        mossCount = appendShuffledSlab(tile.mossSlab, mossMatArr, mossColArr, mossCount, mossCarpetCap, ring, fillerStep, camX, camZ, camForward);
        tallCount = appendShuffledSlab(tile.tallSlab, tallMatArr, tallColArr, tallCount, tallCap, ring, ringStep, camX, camZ, camForward);
      }
    }

    this.grassHasPendingTiles = missingTiles > 0;
    this.diagGrassRebuilds++;
    this.grassBladeMesh.count = count;
    commitCompactedInstancedMesh(this.grassBladeMesh);
    this.shortGrassMesh.count = shortCount;
    commitCompactedInstancedMesh(this.shortGrassMesh);
    this.mossCarpetMesh.count = mossCount;
    commitCompactedInstancedMesh(this.mossCarpetMesh);
    this.tallUndergrowthMesh.count = tallCount;
    commitCompactedInstancedMesh(this.tallUndergrowthMesh);
  }

  private appendSlabBulk(slab: BakedSlab, primary: THREE.InstancedMesh, maxCap: number): number {
    const n = slab.count;
    if (n === 0) return 0;
    const avail = maxCap - primary.count;
    if (avail <= 0) return 0;
    const take = n <= avail ? n : avail;
    const matSrc = take === n ? slab.matrices : slab.matrices.subarray(0, take * 16);
    const colSrc = take === n ? slab.colors : slab.colors.subarray(0, take * 3);

    const matArr = primary.instanceMatrix.array as Float32Array;
    matArr.set(matSrc, primary.count * 16);
    const colArr = primary.instanceColor!.array as Float32Array;
    colArr.set(colSrc, primary.count * 3);
    primary.count += take;
    return take;
  }

  private appendSlabCulled(
    slab: BakedSlab,
    primary: THREE.InstancedMesh,
    maxCap: number,
    frustumPlanes: Float32Array,
    margin = 6.5
  ): number {
    const n = slab.count;
    if (n === 0) return 0;
    let dst = primary.count;
    if (dst >= maxCap) return 0;

    const bounds = slab.bounds;
    const srcMat = slab.matrices;
    const srcCol = slab.colors;
    const dstMat = primary.instanceMatrix.array as Float32Array;
    const dstCol = primary.instanceColor!.array as Float32Array;
    let added = 0;

    for (let i = 0; i < n; i++) {
      const bOff = i * 4;
      if (!sphereIntersectsFrustum(frustumPlanes, bounds[bOff], bounds[bOff + 1], bounds[bOff + 2], bounds[bOff + 3] + margin)) {
        continue;
      }
      const sm = i * 16;
      const dm = dst * 16;
      for (let k = 0; k < 16; k++) dstMat[dm + k] = srcMat[sm + k];

      const sc = i * 3;
      const dc = dst * 3;
      dstCol[dc] = srcCol[sc];
      dstCol[dc + 1] = srcCol[sc + 1];
      dstCol[dc + 2] = srcCol[sc + 2];

      dst++;
      added++;
      if (dst >= maxCap) break;
    }
    primary.count = dst;
    return added;
  }

  private appendSlabSmart(
    slab: BakedSlab,
    primary: THREE.InstancedMesh,
    maxCap: number,
    cellStatus: FrustumCullStatus,
    frustumPlanes?: Float32Array
  ): number {
    if (slab.count === 0) return 0;
    if (cellStatus === FrustumCullStatus.INSIDE || !frustumPlanes) {
      return this.appendSlabBulk(slab, primary, maxCap);
    }
    return this.appendSlabCulled(slab, primary, maxCap, frustumPlanes);
  }

  setShaderCompilePreview(enabled: boolean): void {
    const apply = (mesh: THREE.InstancedMesh) => {
      if (enabled) {
        mesh.userData._prevVis = mesh.visible;
        mesh.userData._prevCount = mesh.count;
        mesh.visible = true;
        if (mesh.count === 0) mesh.count = 1;
      } else {
        mesh.visible = Boolean(mesh.userData._prevVis);
        mesh.count = Number(mesh.userData._prevCount ?? 0);
      }
    };
    for (let i = 0; i < this.primaryChunkMeshes.length; i++) apply(this.primaryChunkMeshes[i]);
    for (let i = 0; i < this.pairedFollowers.length; i++) apply(this.pairedFollowers[i].follower);
    apply(this.grassBladeMesh);
    apply(this.shortGrassMesh);
    apply(this.mossCarpetMesh);
    apply(this.tallUndergrowthMesh);
  }

  prewarmAround(x: number, z: number): void {
    const half = Math.floor(ACTIVE_GRID / 2);
    const pcx = Math.floor(x / CHUNK_SIZE);
    const pcz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.getOrBakeChunk(pcx + dx, pcz + dz);
      }
    }
    this.updateGrassCarpet(x, z, undefined, undefined, 25);
    void half;
  }

  update(
    activeSlots: ActiveChunkSlot[],
    chunkLods: Int32Array,
    chunkSpheres: Float32Array,
    camPos: THREE.Vector3,
    elapsedTime: number,
    windStrength = 0.9,
    stats?: VegetationStats,
    sunDir?: THREE.Vector3,
    sunColor?: THREE.Color,
    frustumPlanes?: Float32Array,
    camForward?: THREE.Vector3,
    maxRenderDist = 225,
    qualityOpts?: VegetationQualityOptions
  ): void {
    this.windTimeUniform.value = elapsedTime;
    this.windStrengthUniform.value = windStrength;
    if (sunDir) this.sunDirUniform.value.copy(sunDir);
    if (sunColor) this.sunColorUniform.value.copy(sunColor);

    void chunkLods;
    const grassBudget = (qualityOpts?.grassMaxRing ?? 2) >= 3 ? 10 : 5;
    this.updateGrassCarpet(camPos.x, camPos.z, frustumPlanes, camForward, grassBudget, maxRenderDist, qualityOpts);

    const fogDist = Math.max(72, Math.min(264, maxRenderDist));
    const fogChunkCutoffSq = (fogDist + 36) * (fogDist + 36);

    const lod0Dist = qualityOpts?.lod0Dist ?? (this.isLowPowerGpu ? 28 : 36);
    const lod1Dist = qualityOpts?.lod1Dist ?? (this.isLowPowerGpu ? 74 : 92);
    const bushDist = Math.min(qualityOpts?.bushDist ?? 124, fogDist);
    const understoryDist = Math.min(qualityOpts?.understoryDist ?? 86, fogDist);
    const boulderDist = Math.min(qualityOpts?.boulderDist ?? 146, fogDist);
    const bogDist = Math.min(qualityOpts?.bogDist ?? 150, fogDist);

    const bands = computeTreeLodFadeBands(lod0Dist, lod1Dist, fogDist);
    this.lod0InFadeUniforms.start.value = bands.lod0InStart;
    this.lod0InFadeUniforms.end.value = bands.lod0InEnd;
    this.lod0OutFadeUniforms.start.value = bands.lod0OutStart;
    this.lod0OutFadeUniforms.end.value = bands.lod0OutEnd;
    this.lod1InFadeUniforms.start.value = bands.lod1InStart;
    this.lod1InFadeUniforms.end.value = bands.lod1InEnd;
    this.lod1OutFadeUniforms.start.value = bands.lod1OutStart;
    this.lod1OutFadeUniforms.end.value = bands.lod1OutEnd;
    this.treeFadeUniforms.start.value = bands.treeFadeStart;
    this.treeFadeUniforms.end.value = bands.treeFadeEnd;

    const treeFadeEnd = bands.treeFadeEnd;
    const bogFadeEnd = Math.min(bogDist, treeFadeEnd);
    this.bogFadeUniforms.end.value = bogFadeEnd;
    this.bogFadeUniforms.start.value = Math.max(24, bogFadeEnd - 36);

    const bushFadeEnd = Math.min(bushDist, treeFadeEnd);
    this.bushFadeUniforms.end.value = bushFadeEnd;
    this.bushFadeUniforms.start.value = Math.max(20, bushFadeEnd - 36);

    const underFadeEnd = Math.min(understoryDist, treeFadeEnd);
    this.underFadeUniforms.end.value = underFadeEnd;
    this.underFadeUniforms.start.value = Math.max(16, underFadeEnd - 32);

    const boulderFadeEnd = Math.min(boulderDist, treeFadeEnd);
    this.boulderFadeUniforms.end.value = boulderFadeEnd;
    this.boulderFadeUniforms.start.value = Math.max(22, boulderFadeEnd - 34);

    const qualitySig = `${Math.round(lod0Dist)}_${Math.round(lod1Dist)}_${Math.round(bushDist)}_${Math.round(understoryDist)}_${Math.round(boulderDist)}_${Math.round(bogDist)}`;

    let sig = '';
    for (let c = 0; c < CHUNK_COUNT; c++) {
      const sb = c * 4;
      if (chunkSpheres[sb + 1] > 9000) continue;
      const dx = chunkSpheres[sb] - camPos.x;
      const dz = chunkSpheres[sb + 2] - camPos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > fogChunkCutoffSq) continue;
      const slot = activeSlots[c];
      sig += `${slot.vcx},${slot.vcz};`;
    }

    let fwdX = this.lastCullFwdX;
    let fwdZ = this.lastCullFwdZ;
    let rotDirty = false;
    if (camForward) {
      const fl = Math.hypot(camForward.x, camForward.z) || 1;
      fwdX = camForward.x / fl;
      fwdZ = camForward.z / fl;
      rotDirty = fwdX * this.lastCullFwdX + fwdZ * this.lastCullFwdZ < 0.9992;
    }
    const moveSq =
      (camPos.x - this.lastCullCamX) * (camPos.x - this.lastCullCamX) +
      (camPos.z - this.lastCullCamZ) * (camPos.z - this.lastCullCamZ);
    const fogDirty = Math.abs(fogDist - this.lastFogCullDist) > 4;
    const qualityDirty = qualitySig !== this.lastQualitySig;

    if (
      !this.forceVisRebuild &&
      sig === this.lastVisibilitySig &&
      moveSq < 0.5 &&
      !rotDirty &&
      !fogDirty &&
      !qualityDirty
    ) {
      if (stats) {
        stats.treesRendered = this.cachedTreesCount;
        stats.foliageRendered =
          this.cachedFoliageCount +
          this.grassBladeMesh.count +
          this.shortGrassMesh.count +
          this.mossCarpetMesh.count +
          this.tallUndergrowthMesh.count;
        stats.culledInstances = this.cachedCulledCount;
        stats.candidateInstances = this.cachedCandidateCount;
      }
      return;
    }

    this.forceVisRebuild = false;
    this.lastVisibilitySig = sig;
    this.lastCullCamX = camPos.x;
    this.lastCullCamZ = camPos.z;
    this.lastCullFwdX = fwdX;
    this.lastCullFwdZ = fwdZ;
    this.lastFogCullDist = fogDist;
    this.lastQualitySig = qualitySig;
    this.diagVisRebuilds++;

    for (let i = 0; i < this.primaryChunkMeshes.length; i++) {
      this.primaryChunkMeshes[i].count = 0;
    }

    const lod0MaxDist = bands.lod0OutEnd + 22;
    const lod0MaxSq = lod0MaxDist * lod0MaxDist;
    const lod1MinDist = Math.max(0, bands.lod0InStart - 22);
    const lod1MinSq = lod1MinDist * lod1MinDist;
    const lod1MaxDist = bands.lod1OutEnd + 22;
    const lod1MaxSq = lod1MaxDist * lod1MaxDist;
    const lod2MinDist = Math.max(0, bands.lod1InStart - 22);
    const lod2MinSq = lod2MinDist * lod2MinDist;

    const fogCellSq = (treeFadeEnd + 22) * (treeFadeEnd + 22);
    const bogDistSq = (bogFadeEnd + 22) * (bogFadeEnd + 22);
    const bushDistSq = (bushFadeEnd + 22) * (bushFadeEnd + 22);
    const underDistSq = (underFadeEnd + 22) * (underFadeEnd + 22);
    const boulderDistSq = (boulderFadeEnd + 22) * (boulderFadeEnd + 22);

    let candidateInstances = 0;
    let renderedInstances = 0;

    for (let c = 0; c < CHUNK_COUNT; c++) {
      const sb = c * 4;
      if (chunkSpheres[sb + 1] > 9000) continue;

      const cdx = chunkSpheres[sb] - camPos.x;
      const cdz = chunkSpheres[sb + 2] - camPos.z;
      if (cdx * cdx + cdz * cdz > fogChunkCutoffSq) continue;

      if (
        frustumPlanes &&
        !sphereIntersectsFrustum(
          frustumPlanes,
          chunkSpheres[sb],
          chunkSpheres[sb + 1] + 6.5,
          chunkSpheres[sb + 2],
          chunkSpheres[sb + 3] + 10.5
        )
      ) {
        continue;
      }

      const slot = activeSlots[c];
      const bucket = this.getOrBakeChunk(slot.vcx, slot.vcz);
      const cells = bucket.cells;

      for (let qi = 0; qi < cells.length; qi++) {
        const cell = cells[qi];
        candidateInstances += cell.totalInstances;

        const dx = cell.cx - camPos.x;
        const dz = cell.cz - camPos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > fogCellSq) continue;

        let cellStatus = FrustumCullStatus.INSIDE;
        if (frustumPlanes) {
          cellStatus = classifySphereFrustum(
            frustumPlanes,
            cell.cx,
            cell.cy,
            cell.cz,
            cell.r + 6.5
          );
          if (cellStatus === FrustumCullStatus.OUTSIDE) continue;
        }

        if (dSq <= lod0MaxSq) {
          renderedInstances += this.appendSlabSmart(cell.birch, this.birchTrunk0, CAP_LOD0, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.pine, this.pineTrunk0, CAP_LOD0, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.spruce, this.spruceTrunk0, CAP_LOD0, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.loneSpruce, this.loneSpruceTrunk0, CAP_LOD0, cellStatus, frustumPlanes);
        }
        if (dSq >= lod1MinSq && dSq <= lod1MaxSq) {
          renderedInstances += this.appendSlabSmart(cell.birch, this.birchTrunk1, CAP_LOD1, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.pine, this.pineTrunk1, CAP_LOD1, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.spruce, this.spruceTrunk1, CAP_LOD1, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.loneSpruce, this.loneSpruceTrunk1, CAP_LOD1, cellStatus, frustumPlanes);
        }
        if (dSq >= lod2MinSq) {
          renderedInstances += this.appendSlabSmart(cell.birch, this.birchTrunk2, CAP_LOD2, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.pine, this.pineTrunk2, CAP_LOD2, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.spruce, this.spruceTrunk2, CAP_LOD2, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.loneSpruce, this.loneSpruceTrunk2, CAP_LOD2, cellStatus, frustumPlanes);
        }

        if (dSq < bogDistSq) {
          renderedInstances += this.appendSlabSmart(cell.bogPine, this.bogPineTrunk, CAP_BOG_PINE, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.reed, this.reedMesh, CAP_REED, cellStatus, frustumPlanes);
        }
        if (dSq < bushDistSq) {
          renderedInstances += this.appendSlabSmart(cell.hazelBush, this.hazelStemMesh, CAP_HAZEL, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.juniperBush, this.juniperMesh, CAP_JUNIPER, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.sapling, this.saplingTrunkMesh, CAP_SAPLING, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.deadfall, this.deadfallMesh, CAP_DEADFALL, cellStatus, frustumPlanes);
        }
        if (dSq < underDistSq) {
          renderedInstances += this.appendSlabSmart(cell.mossHummock, this.mossHummockMesh, CAP_MOSS, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.fern, this.fernMesh, CAP_FERN, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.shrub, this.shrubMesh, CAP_SHRUB, cellStatus, frustumPlanes);
        }
        if (dSq < boulderDistSq) {
          renderedInstances += this.appendSlabSmart(cell.boulder, this.boulderMesh, CAP_BOULDER, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.boulderOutcrop, this.boulderOutcropMesh, CAP_BOULDER, cellStatus, frustumPlanes);
        }
      }
    }

    for (let i = 0; i < this.primaryChunkMeshes.length; i++) {
      commitCompactedInstancedMesh(this.primaryChunkMeshes[i], false);
    }
    for (let i = 0; i < this.pairedFollowers.length; i++) {
      const pair = this.pairedFollowers[i];
      pair.follower.count = pair.primary.count;
      pair.follower.visible = pair.primary.count > 0;
    }

    this.cachedTreesCount =
      this.birchTrunk0.count +
      this.birchTrunk1.count +
      this.birchTrunk2.count +
      this.pineTrunk0.count +
      this.pineTrunk1.count +
      this.pineTrunk2.count +
      this.bogPineTrunk.count +
      this.spruceTrunk0.count +
      this.spruceTrunk1.count +
      this.spruceTrunk2.count +
      this.loneSpruceTrunk0.count +
      this.loneSpruceTrunk1.count +
      this.loneSpruceTrunk2.count +
      this.saplingTrunkMesh.count +
      this.hazelStemMesh.count +
      this.juniperMesh.count;

    this.cachedFoliageCount =
      this.fernMesh.count +
      this.shrubMesh.count +
      this.mossHummockMesh.count +
      this.reedMesh.count +
      this.boulderMesh.count +
      this.boulderOutcropMesh.count +
      this.deadfallMesh.count;

    this.cachedCandidateCount = candidateInstances;
    this.cachedCulledCount = Math.max(0, candidateInstances - renderedInstances);

    if (stats) {
      stats.treesRendered = this.cachedTreesCount;
      stats.foliageRendered =
        this.cachedFoliageCount +
        this.grassBladeMesh.count +
        this.shortGrassMesh.count +
        this.mossCarpetMesh.count +
        this.tallUndergrowthMesh.count;
      stats.culledInstances = this.cachedCulledCount;
      stats.candidateInstances = this.cachedCandidateCount;
    }
  }

  findTargetDeadfall(
    camPos: THREE.Vector3,
    camDir: THREE.Vector3,
    maxDist = 4.8,
    isObstructed?: (hitDist: number) => boolean
  ): DeadfallLogTarget | null {
    const baseVcx = Math.floor(camPos.x / CHUNK_SIZE);
    const baseVcz = Math.floor(camPos.z / CHUNK_SIZE);
    let best: DeadfallLogTarget | null = null;
    let bestProj = maxDist + 1;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.chunkCache.get(`${baseVcx + dx}_${baseVcz + dz}`);
        if (!bucket || bucket.deadfallLogs.length === 0) continue;
        const logs = bucket.deadfallLogs;
        for (let i = 0; i < logs.length; i++) {
          const log = logs[i];
          if (log.broken) continue;
          const approxDx = log.x - camPos.x;
          const approxDz = log.z - camPos.z;
          const reach = maxDist + 2.4 * log.scale;
          if (approxDx * approxDx + approxDz * approxDz > reach * reach) continue;

          const ax = Math.cos(log.rotY) * 2.1 * log.scale;
          const az = -Math.sin(log.rotY) * 2.1 * log.scale;
          const ly = log.y + 0.2 * log.scale;
          const hitRadiusSq = (0.64 * log.scale) * (0.64 * log.scale);

          for (let s = -2; s <= 2; s++) {
            const frac = s * 0.45;
            const px = log.x + ax * frac;
            const pz = log.z + az * frac;
            const vx = px - camPos.x;
            const vy = ly - camPos.y;
            const vz = pz - camPos.z;
            const proj = vx * camDir.x + vy * camDir.y + vz * camDir.z;
            if (proj < 0.25 || proj > maxDist || proj >= bestProj) continue;
            const rx = vx - camDir.x * proj;
            const ry = vy - camDir.y * proj;
            const rz = vz - camDir.z * proj;
            if (rx * rx + ry * ry + rz * rz <= hitRadiusSq) {
              if (isObstructed && isObstructed(proj)) continue;
              bestProj = proj;
              best = log;
            }
          }
        }
      }
    }
    return best;
  }

  getNearestDeadfall(px: number, pz: number): DeadfallLogTarget | null {
    const baseVcx = Math.floor(px / CHUNK_SIZE);
    const baseVcz = Math.floor(pz / CHUNK_SIZE);
    let best: DeadfallLogTarget | null = null;
    let bestSq = Infinity;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const bucket = this.getOrBakeChunk(baseVcx + dx, baseVcz + dz);
        for (let i = 0; i < bucket.deadfallLogs.length; i++) {
          const log = bucket.deadfallLogs[i];
          if (log.broken) continue;
          const dSq = (log.x - px) * (log.x - px) + (log.z - pz) * (log.z - pz);
          if (dSq < bestSq) {
            bestSq = dSq;
            best = log;
          }
        }
      }
    }
    return best;
  }

  kickDeadfall(
    id: string
  ): { hit: boolean; broken: boolean; x: number; y: number; z: number; rotY: number; scale: number } | null {
    const parts = id.split('_');
    if (parts.length < 3) return null;
    const key = `${parts[0]}_${parts[1]}`;
    const bucket = this.chunkCache.get(key);
    if (!bucket) return null;
    const log = bucket.deadfallLogs.find((l) => l.id === id);
    if (!log || log.broken) return null;

    log.kicksRemaining -= 1;
    this.deadfallKicksRemaining.set(id, log.kicksRemaining);
    const slab = bucket.cells[log.cellIdx]?.deadfall;

    if (log.kicksRemaining > 0) {
      log.rotY += 0.12;
      if (slab && log.slabIdx < slab.count) {
        _bakeDummy.position.set(log.x, log.y + 0.03, log.z);
        _bakeDummy.rotation.set(0.06, log.rotY, 0.1);
        _bakeDummy.scale.setScalar(log.scale);
        _bakeDummy.updateMatrix();
        _bakeDummy.matrix.toArray(slab.matrices, log.slabIdx * 16);
      }
      this.forceVisRebuild = true;
      return {
        hit: true,
        broken: false,
        x: log.x,
        y: log.y,
        z: log.z,
        rotY: log.rotY,
        scale: log.scale,
      };
    }

    log.broken = true;
    this.brokenDeadfallIds.add(id);
    this.deadfallKicksRemaining.delete(id);
    if (slab && log.slabIdx < slab.count) {
      const mOff = log.slabIdx * 16;
      for (let k = 0; k < 16; k++) slab.matrices[mOff + k] = 0;
      slab.bounds[log.slabIdx * 4 + 3] = 0;
    }
    this.forceVisRebuild = true;
    return {
      hit: true,
      broken: true,
      x: log.x,
      y: log.y,
      z: log.z,
      rotY: log.rotY,
      scale: log.scale,
    };
  }

  consumeDiagnostics(): {
    chunkCacheSize: number;
    chunkBakes: number;
    chunkEvictions: number;
    visRebuilds: number;
    grassRebuilds: number;
    grassCount: number;
    colliderCells: number;
  } {
    const out = {
      chunkCacheSize: this.chunkCache.size,
      chunkBakes: this.diagChunkBakes,
      chunkEvictions: this.diagChunkEvictions,
      visRebuilds: this.diagVisRebuilds,
      grassRebuilds: this.diagGrassRebuilds,
      grassCount:
        this.grassBladeMesh.count +
        this.shortGrassMesh.count +
        this.mossCarpetMesh.count +
        this.tallUndergrowthMesh.count,
      colliderCells: this.colliderGrid.size,
    };
    this.diagChunkBakes = 0;
    this.diagChunkEvictions = 0;
    this.diagVisRebuilds = 0;
    this.diagGrassRebuilds = 0;
    return out;
  }

  dispose(): void {
    this.chunkCache.clear();
    this.grassTileCache.clear();
    this.colliderGrid.clear();
    for (const d of this.disposables) d.dispose();
  }
}
