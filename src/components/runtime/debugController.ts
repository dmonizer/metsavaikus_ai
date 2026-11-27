import * as THREE from 'three';
import {
  buildSpawnCatalog,
  DebugActions,
  DebugEventEntry,
  DebugEventSource,
  DebugPerfPoint,
  DebugPerfSnapshot,
  DebugSnapshot,
  DebugTargetHit,
  TeleportLocation,
} from '../../game/debugTypes';
import {
  addItemToInventory,
  cloneInventory,
  getNavigationMode,
  hasFlashlight,
  InventoryState,
  isWearingRainJacket,
  ITEM_CATALOG,
  ItemId,
  NavigationMode,
  removeStackItem,
} from '../../game/itemCatalog';
import { classifyBottleneck, FpsDropLogger, FramePerfSample } from '../../game/perfLogger';
import {
  classifyHypothermia,
  createPoisonEffect,
  DEFAULT_WEIGHT_THRESHOLDS,
  DiscoveryTracker,
  formatGameHour,
  PlayerSurvivalState,
  WeightTierThresholds,
} from '../../game/survivalEngine';
import { getLocalizedBiomeLabel, t } from '../../i18n/i18n';
import type { DiagnosticsSnapshot, PersistedSoundscapeState, ValidationIssue } from '../../soundscape/types';
import type {
  CampfireInfo,
  CircleCollider,
  InteractiveEntry,
  SleepSpotInfo,
  TentInfo,
  WorldPropsContext,
} from '../../world/architectureAndProps';
import type { DynamicFloraKind, WorldVegetationSystem } from '../../world/foliageFactory';
import type { FogOfWarMap, MinimapRenderer } from '../../world/minimapMath';
import type { SoundEngine, SpatialAmbienceStats, SpatialAudioEvent, SpatialClipKind } from '../../world/soundEngine';
import { saveSoundscapeSnapshotToStorage, SimulatorSoundscape } from '../../world/soundscapeAdapter';
import type { TerrainChunkManager } from '../../world/terrainChunkManager';
import {
  distToRoadDetail,
  getActiveBlueprint,
  getBiomeInfo,
  getDistanceToNearestVillage,
  getNearestSwampIsland,
  getSwampFactor,
  getTerrainHeight,
  getThicketFactor,
  SWAMP_WATER_Y,
  WORLD_HALF,
} from '../../world/terrainMath';
import type { WeatherAndSkySystem, WeatherId } from '../../world/weatherAndSky';
import type { GamePhase, WorldActions, WorldCallbacks } from '../worldRuntimeContracts';
import type { HudBridge } from './hudBridge';
import { getEntryName, InteractionController } from './interactionController';
import type { PlayerController } from './playerController';

export interface MetsavaikusDebugApi {
  getState: () => {
    survival: PlayerSurvivalState;
    inventory: InventoryState;
    navigationMode: NavigationMode;
    phase: GamePhase;
    hour: number;
    exploredPercent: number;
    fogVersion: number;
    seatedInTent: boolean;
    wearingRainJacket: boolean;
  };
  movePlayerForTest: (x: number, z: number) => {
    x: number;
    z: number;
    exploredPercent: number;
    fogVersion: number;
  };
  openPrimaryCampfire: () => void;
  openCampfireById: (id: string) => void;
  kickNearestStump: () => { broken: boolean; woodPiecesNear: number };
  kickNearestDeadfallReal: () => {
    hoveredTitle: string | null;
    broken: boolean;
    woodPiecesNear: number;
  };
  pickNearestBirchFirewoodReal: () => {
    hoveredTitle: string | null;
    picked: boolean;
    totalWood: number;
    packKg: number;
  };
  gatherNearbyWood: (maxCount?: number) => { collected: number; totalWood: number; packKg: number };
  placeCampfire: () => CampfireInfo | null;
  pitchTentForTest: () => TentInfo | null;
  openTentSleepForTest: () => boolean;
  sitInTentForTest: () => boolean;
  standUpFromTentForTest: () => void;
  packUpTentForTest: () => boolean;
  toggleRainJacketForTest: () => boolean;
  triggerSpatialSoundForTest: (kind: SpatialClipKind) => SpatialAudioEvent | null;
  getSpatialAudioStats: () => SpatialAmbienceStats;
  setWeatherForTest: (w: WeatherId) => void;
  setWindForTest: (wind: number | null) => void;
  getWaterStateForTest: () => {
    x: number;
    y: number;
    z: number;
    cameraY: number;
    waterY: number;
    eyeAboveWater: number;
    waterDepth: number;
    isSwimming: boolean;
    isSwampWading: boolean;
    onBoardwalk: boolean;
    windStrength: number;
  };
  setHourForTest: (hour: number) => void;
  triggerLethalCollapse: (cause?: string) => void;
  setVitalsForTest: (patch: Partial<PlayerSurvivalState>) => void;
  getSoundscapeDiagnostics: () => DiagnosticsSnapshot;
  triggerSoundscapeEvent: (type: string, intensity?: number) => void;
  auditionSoundscapeSound: (soundId: string) => boolean;
  stopSoundscapeAudition: () => number;
  resetSoundscapeQuotas: () => void;
  reloadSoundscapeConfigJson: (json: string) => {
    ok: boolean;
    issues: ValidationIssue[];
    diffSummary?: string;
  };
  exportSoundscapeSnapshot: () => PersistedSoundscapeState;
  importSoundscapeSnapshot: (snap: PersistedSoundscapeState) => void;
}

export interface DebugControllerDeps {
  worldSeed: number;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  weatherSky: WeatherAndSkySystem;
  sound: SoundEngine;
  soundscape: SimulatorSoundscape;
  player: PlayerController;
  interaction: InteractionController;
  hudBridge: HudBridge;
  discovery: DiscoveryTracker;
  fogOfWar: FogOfWarMap;
  perfLogger: FpsDropLogger;
  perfSample: FramePerfSample;
  getHasLivePerfSample: () => boolean;
  getPhase: () => GamePhase;
  setUiModalOpen: (open: boolean) => void;
  getSimDay: () => number;
  getSimClockMs: () => number;
  setSimClockAndPrevHour: (simClockMs: number, prevHour: number) => void;
  getLastWindStrength: () => number;
  getLastFogCullDist: () => number;
  getCurrentDpr: () => number;
  getSurvival: () => PlayerSurvivalState;
  getInventory: () => InventoryState;
  getPropsCtx: () => WorldPropsContext | null;
  getTerrainMgr: () => TerrainChunkManager | null;
  getVegetation: () => WorldVegetationSystem | null;
  getMinimap: () => MinimapRenderer | null;
  onUpdatePropCircleColliders: (colliders: CircleCollider[]) => void;
  onFinishInventoryChange: (beforePublish?: () => void) => void;
  onSyncHudAndSnapshot: () => void;
  onPushSurvivalSnapshot: () => void;
  onSetObservedWeather: (w: WeatherId) => void;
  onSetLastFogReveal: (x: number, z: number) => void;
  onTurnOffFlashlight: () => void;
  onBeginCollapse: () => void;
  getCallbacks: () => WorldCallbacks;
  getActions: () => WorldActions | null;
  keysHeld: Set<string>;
  keysJustPressed: Set<string>;
}

const inspectNdc = new THREE.Vector2();
const inspectMat4 = new THREE.Matrix4();
const inspectScale = new THREE.Vector3();
const inspectPos = new THREE.Vector3();
const inspectQuat = new THREE.Quaternion();

export function createInitialPerfSample(
  gpu: { isSoftwareGl: boolean; isLowPowerGpu: boolean; gpuRenderer: string },
  currentDpr: number
): FramePerfSample {
  return {
    nowMs: 0,
    rawDtMs: 0,
    fpsEma: 60,
    fpsInstant: 60,
    playerMs: 0,
    propsMs: 0,
    skyMs: 0,
    terrainMs: 0,
    vegMs: 0,
    minimapMs: 0,
    renderMs: 0,
    tickCpuMs: 0,
    externalWaitMs: 0,
    pos: [0, 0, 0],
    chunk: [0, 0],
    biome: '',
    heading: '',
    timeOfDay: '09:15',
    weather: 'clear',
    wind: 0,
    flashlightOn: false,
    sunCastShadow: false,
    isSoftwareGl: gpu.isSoftwareGl,
    calls: 0,
    triangles: 0,
    points: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    visibleChunks: 0,
    lodCounts: [0, 0, 0],
    treesRendered: 0,
    foliageRendered: 0,
    terrainCacheSize: 0,
    terrainBuilds: 0,
    terrainEvictions: 0,
    terrainRecenters: 0,
    foliageCacheSize: 0,
    foliageBakes: 0,
    foliageEvictions: 0,
    foliageVisRebuilds: 0,
    grassRebuilds: 0,
    grassCount: 0,
    colliderCells: 0,
    jsHeapMB: null,
    gpuRenderer: gpu.gpuRenderer,
    pixelRatio: currentDpr,
    backbufferPx: [0, 0],
    antialias: false,
    shadowUpdates: 0,
    fogCullDist: 225,
    culledInstances: 0,
    candidateInstances: 0,
    overlays: 'none',
    lowPowerGpu: gpu.isLowPowerGpu,
    programsDelta: 0,
    drsMs: 0,
  };
}

export class DebugController {
  debugOverlayEnabled = false;
  debugSimPaused = false;
  godMode = false;
  noClip = false;
  moveSpeedMult = 1.0;
  clockSpeedMult = 1.0;
  pickTargetActive = false;
  autoSpawnOnPick = false;
  readonly spawnCatalog = buildSpawnCatalog();
  selectedSpawnId: string;
  weatherOverride: WeatherId | null = null;
  windOverride: number | null = null;
  weightThresholds: WeightTierThresholds = { ...DEFAULT_WEIGHT_THRESHOLDS };
  centerHit: DebugTargetHit | null = null;
  pickedHit: DebugTargetHit | null = null;
  readonly debugEvents: DebugEventEntry[] = [];
  readonly perfHistory: DebugPerfPoint[] = [];

  private nextDebugEventId = 1;
  private readonly inspectRaycaster = new THREE.Raycaster();
  readonly actions: DebugActions;

  constructor(private readonly deps: DebugControllerDeps) {
    this.selectedSpawnId = this.spawnCatalog[0]?.id ?? 'mushroom:kukeseen';
    this.inspectRaycaster.far = 140;
    this.actions = this.buildDebugActions();
  }

  pushDebugEvent(
    source: DebugEventSource,
    type: string,
    summary: string,
    payload?: Record<string, unknown>
  ): void {
    this.debugEvents.push({
      id: this.nextDebugEventId++,
      timestampMs: Date.now(),
      simTimeStr: formatGameHour(this.deps.weatherSky.timeOfDay),
      source,
      type,
      summary,
      payload,
    });
    if (this.debugEvents.length > 250) {
      this.debugEvents.splice(0, this.debugEvents.length - 250);
    }
  }

  private computeBiomeWeightsAt(
    x: number,
    z: number
  ): Array<{ id: string; label: string; weight: number }> {
    const { village, dist: vDist } = getDistanceToNearestVillage(x, z);
    const vWeight =
      village && vDist < village.clearingRadius + 16
        ? THREE.MathUtils.clamp(1 - (vDist - village.clearingRadius * 0.5) / 26, 0, 1)
        : 0;
    const isl = getNearestSwampIsland(x, z);
    const islWeight = isl.island ? isl.islandMask : 0;
    const swampWeight = getSwampFactor(x, z);
    const roadInfo = distToRoadDetail(x, z);
    const roadWeight = THREE.MathUtils.clamp(1 - roadInfo.dist / 6.0, 0, 1);
    const thicketWeight = THREE.MathUtils.clamp((getThicketFactor(x, z) - 0.52) / 0.35, 0, 1);
    const raw: Array<{ id: string; label: string; weight: number }> = [];
    if (vWeight > 0.02 && village) {
      raw.push({
        id: village.abandoned ? 'abandoned' : 'village',
        label: village.abandoned ? 'Abandoned' : 'Village',
        weight: vWeight,
      });
    }
    if (islWeight > 0.02 && isl.island) {
      raw.push({ id: 'island', label: 'Bog Island', weight: islWeight });
    }
    if (swampWeight > 0.02) raw.push({ id: 'swamp', label: 'Peat Bog', weight: swampWeight });
    if (roadWeight > 0.02) {
      raw.push({
        id: 'road',
        label: roadInfo.isTrail ? 'Trail' : 'Gravel Road',
        weight: roadWeight,
      });
    }
    if (thicketWeight > 0.02) raw.push({ id: 'thicket', label: 'Thicket', weight: thicketWeight });
    const nonForestSum = raw.reduce((acc, r) => acc + r.weight, 0);
    const forestWeight = Math.max(0.05, 1 - Math.min(0.95, nonForestSum * 0.8));
    raw.push({ id: 'forest', label: 'Forest', weight: forestWeight });
    const total = raw.reduce((acc, r) => acc + r.weight, 0) || 1;
    return raw
      .map((r) => ({ ...r, weight: r.weight / total }))
      .sort((a, b) => b.weight - a.weight);
  }

  inspectAtNdc(
    ndcX: number,
    ndcY: number,
    source: 'center' | 'cursor'
  ): DebugTargetHit | null {
    const terrainMgr = this.deps.getTerrainMgr();
    const propsCtx = this.deps.getPropsCtx();
    const vegetation = this.deps.getVegetation();
    const targets: THREE.Object3D[] = [];
    if (terrainMgr) targets.push(terrainMgr.group);
    if (propsCtx) targets.push(...propsCtx.getInspectableMeshes());
    if (vegetation) targets.push(...vegetation.inspectableMeshes);
    if (targets.length === 0) return null;

    inspectNdc.set(ndcX, ndcY);
    this.inspectRaycaster.setFromCamera(inspectNdc, this.deps.camera);
    const hits = this.inspectRaycaster.intersectObjects(targets, true);
    if (hits.length === 0) return null;

    let best = hits[0];
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (!h.object.visible) continue;
      best = h;
      break;
    }

    const pt = best.point;
    const terrainY = getTerrainHeight(pt.x, pt.z);
    const hX = getTerrainHeight(pt.x + 0.35, pt.z) - getTerrainHeight(pt.x - 0.35, pt.z);
    const hZ = getTerrainHeight(pt.x, pt.z + 0.35) - getTerrainHeight(pt.x, pt.z - 0.35);
    const grad = Math.hypot(hX / 0.7, hZ / 0.7);
    const slopeDeg = (Math.atan(grad) * 180) / Math.PI;

    const bp = getActiveBlueprint();
    const inWaterBasin =
      Math.hypot(pt.x - bp.bogCenterX, pt.z - bp.bogCenterZ) <= bp.bogRadius + 28;
    const waterDepthM = inWaterBasin ? Math.max(0, SWAMP_WATER_Y - terrainY) : 0;
    const onBw = this.deps.player.isOnBoardwalk(pt.x, pt.z);
    const swamp = getSwampFactor(pt.x, pt.z);
    const roadDist = distToRoadDetail(pt.x, pt.z).dist;
    const envAt = propsCtx?.getEnvironmentStateAt(pt.x, pt.z);

    let layer = 'world';
    let name = best.object.name || 'World Geometry';
    const meta: Record<string, string | number | boolean> = {};

    let node: THREE.Object3D | null = best.object;
    while (node) {
      const ud = node.userData as Record<string, unknown>;
      if (ud) {
        if (typeof ud.debugLayer === 'string' && layer === 'world') {
          layer = ud.debugLayer;
        }
        if (typeof ud.debugName === 'string' && name === (best.object.name || 'World Geometry')) {
          name = ud.debugName;
        }
        if (ud.debugMeta && typeof ud.debugMeta === 'object') {
          for (const [k, v] of Object.entries(ud.debugMeta as Record<string, unknown>)) {
            if (
              meta[k] === undefined &&
              (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
            ) {
              meta[k] = v;
            }
          }
        }
        if (ud.interactive && typeof ud.interactive === 'object') {
          const inter = ud.interactive as InteractiveEntry;
          if (layer === 'world') {
            layer = inter.gatherable ? 'mushroom' : inter.pickupItemId ? 'item' : 'prop';
          }
          name = getEntryName(inter);
          if (inter.species) meta.species = inter.species;
          if (inter.pickupItemId) meta.itemId = inter.pickupItemId;
          if (inter.materialType) meta.material = inter.materialType;
        }
      }
      node = node.parent;
    }

    if (best.instanceId !== undefined && best.object instanceof THREE.InstancedMesh) {
      meta.instanceId = best.instanceId;
      best.object.getMatrixAt(best.instanceId, inspectMat4);
      inspectMat4.decompose(inspectPos, inspectQuat, inspectScale);
      meta.instanceScale = Number(inspectScale.x.toFixed(2));
    }

    let surfaceMaterial: string = this.deps.player.resolveSurfaceMaterialAt(
      pt.x,
      pt.z,
      onBw,
      waterDepthM > 0.02 && !onBw,
      swamp > 0.42 && !onBw && waterDepthM <= 0.02
    );
    if (layer === 'water') surfaceMaterial = 'water';
    else if (meta.material === 'stone' || layer === 'boulder') surfaceMaterial = 'stone';
    else if (layer === 'boardwalk') surfaceMaterial = 'wooden_boardwalk';

    const biomeInfo = getBiomeInfo(pt.x, pt.z);
    const biomeWeights = this.computeBiomeWeightsAt(pt.x, pt.z);

    return {
      layer,
      name,
      point: { x: pt.x, y: pt.y, z: pt.z },
      distanceM: best.distance,
      biomeLabel: getLocalizedBiomeLabel(biomeInfo.id, biomeInfo.label),
      biomeWeights,
      terrainY,
      slopeDeg,
      surfaceMaterial,
      waterDepthM,
      inWaterBasin,
      shelterQuality: envAt?.shelter ?? 'outdoor',
      shelterLabel: envAt?.shelterLabel ?? null,
      nearCampfireFactor: envAt?.nearLitCampfireFactor ?? 0,
      roadDistanceM: roadDist,
      meta,
      capturedAtMs: Date.now(),
      source,
    };
  }

  teleportPlayer(x: number, z: number, label?: string): void {
    const { player, camera, discovery, fogOfWar, hudBridge } = this.deps;
    if (player.seatedTent) player.exitTentSeat(true);
    const limit = WORLD_HALF - 18;
    const cx = THREE.MathUtils.clamp(x, -limit, limit);
    const cz = THREE.MathUtils.clamp(z, -limit, limit);
    const sy = player.getSurfaceHeightAt(cx, cz);
    player.pos.set(cx, this.noClip ? Math.max(player.pos.y, sy + 0.5) : sy, cz);
    player.vel.set(0, 0, 0);
    player.fallPeakY = player.pos.y;
    player.waterFallEmitted = false;
    player.climbingOutOfWater = false;
    camera.position.set(player.pos.x, player.pos.y + player.currentEye, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
    discovery.markAroundWorldPos(cx, cz, 1);
    fogOfWar.revealAt(cx, cz);
    this.deps.onSetLastFogReveal(cx, cz);
    hudBridge.drawMinimapImmediate(
      this.deps.getMinimap(),
      this.deps.getInventory(),
      fogOfWar,
      cx,
      cz,
      player.yaw,
      true
    );
    this.pushDebugEvent(
      'game',
      'debug.teleport',
      `Teleported to ${label ?? `${cx.toFixed(1)}, ${cz.toFixed(1)}`}`,
      { x: cx, z: cz }
    );
    this.deps.onSyncHudAndSnapshot();
  }

  private getTeleportLocations(): TeleportLocation[] {
    const bp = getActiveBlueprint();
    const { player } = this.deps;
    const propsCtx = this.deps.getPropsCtx();
    const locs: TeleportLocation[] = [
      { id: 'homestead', label: 'Start Homestead Road', kind: 'homestead', x: player.spawnX, z: player.spawnZ },
      { id: 'bog_lake', label: 'Kõrgesoo Bog Lake Center', kind: 'bog', x: bp.bogCenterX, z: bp.bogCenterZ },
    ];
    bp.villages.forEach((v, idx) => {
      locs.push({
        id: `village_${idx}`,
        label: v.estonianLabel,
        kind: 'village',
        x: v.x,
        z: v.z,
      });
    });
    bp.swampIslands.forEach((isl, idx) => {
      locs.push({
        id: `island_${idx}`,
        label: isl.name,
        kind: 'island',
        x: isl.x,
        z: isl.z,
      });
    });
    if (propsCtx?.heroMushroomPos) {
      locs.push({
        id: 'hero_shroom',
        label: 'Hero Chanterelle Clearing',
        kind: 'mushroom',
        x: propsCtx.heroMushroomPos.x,
        z: propsCtx.heroMushroomPos.z,
      });
    }
    if (this.pickedHit) {
      locs.push({
        id: 'picked_hit',
        label: `Picked Target (${this.pickedHit.name})`,
        kind: 'picked',
        x: this.pickedHit.point.x,
        z: this.pickedHit.point.z,
      });
    }
    return locs;
  }

  private buildPerfSnapshot(): DebugPerfSnapshot | null {
    if (!this.deps.getHasLivePerfSample()) return null;
    const s = this.deps.perfSample;
    return {
      fpsEma: s.fpsEma,
      fpsInstant: s.fpsInstant,
      rawDtMs: s.rawDtMs,
      tickCpuMs: s.tickCpuMs,
      externalWaitMs: s.externalWaitMs,
      renderMs: s.renderMs,
      terrainMs: s.terrainMs,
      vegMs: s.vegMs,
      skyMs: s.skyMs,
      propsMs: s.propsMs,
      playerMs: s.playerMs,
      minimapMs: s.minimapMs,
      bottleneck: classifyBottleneck(s),
      calls: s.calls,
      triangles: s.triangles,
      geometries: s.geometries,
      textures: s.textures,
      programs: s.programs,
      visibleChunks: s.visibleChunks,
      lodCounts: [...s.lodCounts],
      treesRendered: s.treesRendered,
      foliageRendered: s.foliageRendered,
      culledInstances: s.culledInstances ?? 0,
      candidateInstances: s.candidateInstances ?? 0,
      grassCount: s.grassCount,
      pixelRatio: s.pixelRatio ?? this.deps.getCurrentDpr(),
      backbufferPx: [
        s.backbufferPx?.[0] ?? this.deps.renderer.domElement.width,
        s.backbufferPx?.[1] ?? this.deps.renderer.domElement.height,
      ],
      fogCullDist: s.fogCullDist ?? this.deps.getLastFogCullDist(),
      jsHeapMB: s.jsHeapMB,
      overlays: s.overlays ?? 'none',
      history: this.perfHistory.slice(),
    };
  }

  buildDebugSnapshot(): DebugSnapshot {
    const survival = this.deps.getSurvival();
    const { player, weatherSky, fogOfWar } = this.deps;
    return {
      simDay: this.deps.getSimDay(),
      hourOfDay: weatherSky.timeOfDay,
      simTimeStr: formatGameHour(weatherSky.timeOfDay),
      clockSpeedMultiplier: this.clockSpeedMult,
      simPaused: this.debugSimPaused,
      godMode: this.godMode,
      noClip: this.noClip,
      moveSpeedMultiplier: this.moveSpeedMult,
      overlayEnabled: this.debugOverlayEnabled,
      pickTargetActive: this.pickTargetActive,
      autoSpawnOnPick: this.autoSpawnOnPick,
      selectedSpawnId: this.selectedSpawnId,
      weather: weatherSky.currentWeather,
      weatherOverride: this.weatherOverride,
      windStrength: this.deps.getLastWindStrength(),
      windOverride: this.windOverride,
      weightThresholds: { ...this.weightThresholds },
      playerPos: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
      playerYaw: player.yaw,
      playerPitch: player.pitch,
      isSwimming: player.lastIsSwimming,
      onBoardwalk: player.lastOnBoardwalk,
      waterDepthM: player.lastWaterDepthM,
      discoveredPercent: fogOfWar.getExploredPercent(),
      survival: {
        ...survival,
        poisons: survival.poisons.map((p) => ({ ...p })),
        deathFactors: [...survival.deathFactors],
      },
      inventory: cloneInventory(this.deps.getInventory()),
      centerHit: this.centerHit,
      pickedHit: this.pickedHit,
      events: this.debugEvents.slice(),
      perf: this.buildPerfSnapshot(),
      teleportLocations: this.getTeleportLocations(),
    };
  }

  private buildDebugActions(): DebugActions {
    return {
      setSimPaused: (paused: boolean) => {
        this.debugSimPaused = paused;
        if (paused) {
          this.deps.soundscape.engine.stopMovementLoops(false);
        }
        this.pushDebugEvent('debug', 'debug.sim_pause', paused ? 'Simulation paused' : 'Simulation resumed');
      },
      setGodMode: (enabled: boolean) => {
        this.godMode = enabled;
        if (enabled) {
          const survival = this.deps.getSurvival();
          survival.deathCause = null;
          survival.deathFactors = [];
        }
        this.pushDebugEvent('debug', 'debug.god_mode', `God Mode ${enabled ? 'ENABLED' : 'disabled'}`);
      },
      setNoClip: (enabled: boolean) => {
        this.noClip = enabled;
        if (!enabled) {
          const { player } = this.deps;
          const sy = player.getSurfaceHeightAt(player.pos.x, player.pos.z);
          if (player.pos.y < sy) player.pos.y = sy;
          player.vel.set(0, 0, 0);
        }
        this.pushDebugEvent('debug', 'debug.noclip', `No-Clip ${enabled ? 'ENABLED' : 'disabled'}`);
      },
      setMoveSpeedMultiplier: (mult: number) => {
        this.moveSpeedMult = THREE.MathUtils.clamp(mult, 0.25, 6);
      },
      setOverlayEnabled: (enabled: boolean) => {
        this.debugOverlayEnabled = enabled;
        if (enabled && !this.centerHit) {
          this.centerHit = this.inspectAtNdc(0, 0, 'center');
        }
      },
      setPickTargetActive: (active: boolean) => {
        this.pickTargetActive = active;
        if (active && document.pointerLockElement) {
          document.exitPointerLock?.();
        }
      },
      setAutoSpawnOnPick: (enabled: boolean) => {
        this.autoSpawnOnPick = enabled;
      },
      setSelectedSpawnId: (spawnId: string) => {
        this.selectedSpawnId = spawnId;
      },
      setClockSpeedMultiplier: (mult: number) => {
        this.clockSpeedMult = THREE.MathUtils.clamp(mult, 0, 300);
        this.pushDebugEvent('debug', 'debug.clock_speed', `Clock speed ${this.clockSpeedMult}x`);
      },
      setTimeOfDayHour: (hour: number) => {
        this.deps.weatherSky.setTimeOfDay(hour);
        const curH = this.deps.weatherSky.timeOfDay;
        const simClockMs = ((this.deps.getSimDay() - 1) * 24 + curH) * 3_600_000;
        this.deps.setSimClockAndPrevHour(simClockMs, curH);
        this.pushDebugEvent('game', 'debug.time_set', `Time jumped to ${formatGameHour(curH)}`);
        this.deps.onPushSurvivalSnapshot();
      },
      setWeatherOverride: (w: WeatherId | null) => {
        this.weatherOverride = w;
        if (w !== null) {
          this.deps.weatherSky.setWeather(w, true);
          this.deps.onSetObservedWeather(w);
        }
        this.pushDebugEvent('game', 'debug.weather', `Weather override: ${w ?? 'Auto'}`);
        this.deps.onPushSurvivalSnapshot();
      },
      setWindOverride: (w: number | null) => {
        this.windOverride = w !== null ? THREE.MathUtils.clamp(w, 0, 2) : null;
        this.deps.weatherSky.windOverride = this.windOverride;
        this.pushDebugEvent(
          'game',
          'debug.wind',
          `Wind override: ${this.windOverride !== null ? this.windOverride.toFixed(2) : 'Auto'}`
        );
      },
      setVitalsPatch: (patch) => {
        const survival = this.deps.getSurvival();
        const inventory = this.deps.getInventory();
        if (patch.health !== undefined) survival.health = THREE.MathUtils.clamp(patch.health, 0, 100);
        if (patch.energy !== undefined) survival.energy = THREE.MathUtils.clamp(patch.energy, 0, 100);
        if (patch.hydration !== undefined) survival.hydration = THREE.MathUtils.clamp(patch.hydration, 0, 100);
        if (patch.stomachFullness !== undefined) {
          survival.stomachFullness = THREE.MathUtils.clamp(patch.stomachFullness, 0, 100);
        }
        if (patch.physicalTiredness !== undefined) {
          survival.physicalTiredness = THREE.MathUtils.clamp(patch.physicalTiredness, 0, 100);
        }
        if (patch.bodyTempC !== undefined) {
          survival.bodyTempC = THREE.MathUtils.clamp(patch.bodyTempC, 30, 38.5);
          survival.hypothermiaStage = classifyHypothermia(survival.bodyTempC);
        }
        if (patch.wetness !== undefined) survival.wetness = THREE.MathUtils.clamp(patch.wetness, 0, 100);
        if (patch.nausea !== undefined) survival.nausea = THREE.MathUtils.clamp(patch.nausea, 0, 100);
        if (patch.awakeHours !== undefined) survival.awakeHours = THREE.MathUtils.clamp(patch.awakeHours, 0, 48);
        if (patch.digestionBurnRate !== undefined) {
          survival.digestionBurnRate = THREE.MathUtils.clamp(patch.digestionBurnRate, 0.3, 3.0);
        }
        if (patch.waterStomachLoadL !== undefined) {
          survival.waterStomachLoadL = THREE.MathUtils.clamp(patch.waterStomachLoadL, 0, 2.5);
        }
        if (patch.flashlightBattery !== undefined) {
          inventory.flashlightBattery = THREE.MathUtils.clamp(patch.flashlightBattery, 0, 100);
        }
        this.deps.onFinishInventoryChange();
      },
      applyStatePreset: (preset) => {
        const survival = this.deps.getSurvival();
        switch (preset) {
          case 'soaked':
            survival.wetness = 95;
            break;
          case 'hypothermic':
            survival.bodyTempC = 33.5;
            survival.wetness = Math.max(survival.wetness, 65);
            survival.hypothermiaStage = classifyHypothermia(33.5);
            break;
          case 'exhausted':
            survival.energy = 8;
            survival.physicalTiredness = 92;
            survival.awakeHours = 26;
            break;
          case 'starving':
            survival.stomachFullness = 0;
            break;
          case 'dehydrated':
            survival.hydration = 0;
            break;
          case 'poisoned':
            survival.poisons.push(createPoisonEffect('fly_agaric', 1.0));
            survival.nausea = Math.max(survival.nausea, 48);
            break;
          case 'cleanse':
            survival.health = 100;
            survival.energy = 100;
            survival.hydration = 100;
            survival.stomachFullness = 100;
            survival.physicalTiredness = 0;
            survival.bodyTempC = 37.0;
            survival.hypothermiaStage = 'normal';
            survival.wetness = 0;
            survival.nausea = 0;
            survival.awakeHours = 4;
            survival.waterStomachLoadL = 0;
            survival.poisons = [];
            survival.deathCause = null;
            survival.deathFactors = [];
            break;
        }
        this.pushDebugEvent('survival', `debug.preset.${preset}`, `Applied state preset: ${preset}`);
        this.deps.onFinishInventoryChange();
      },
      adjustInventoryItem: (itemId: ItemId, delta: number) => {
        const inventory = this.deps.getInventory();
        if (delta > 0) {
          addItemToInventory(inventory, itemId, delta);
        } else if (delta < 0) {
          const def = ITEM_CATALOG[itemId];
          if (def.waterContainer) {
            for (let i = 0; i < Math.abs(delta); i++) {
              const idx = inventory.bottles.map((b) => b.itemId as ItemId).lastIndexOf(itemId);
              if (idx >= 0) inventory.bottles.splice(idx, 1);
            }
          } else {
            removeStackItem(inventory, itemId, Math.abs(delta));
            if (itemId === 'flashlight' && !hasFlashlight(inventory)) {
              this.deps.onTurnOffFlashlight();
            }
          }
        }
        this.deps.hudBridge.resetMinimapCache();
        this.pushDebugEvent('debug', 'debug.inventory', `${delta >= 0 ? '+' : ''}${delta} ${itemId}`);
        this.deps.onFinishInventoryChange();
      },
      setBottleState: (uid, patch) => {
        const b = this.deps.getInventory().bottles.find((item) => item.uid === uid);
        if (!b) return;
        if (patch.waterLiters !== undefined) {
          b.waterLiters = THREE.MathUtils.clamp(patch.waterLiters, 0, b.capacityLiters);
        }
        if (patch.waterQuality !== undefined) b.waterQuality = patch.waterQuality;
        if (patch.waterTempC !== undefined) b.waterTempC = patch.waterTempC;
        this.deps.onFinishInventoryChange();
      },
      adjustDebugBallastKg: (deltaKg: number) => {
        const inventory = this.deps.getInventory();
        const next = Math.round(((inventory.debugBallastKg ?? 0) + deltaKg) * 100) / 100;
        inventory.debugBallastKg = Math.abs(next) < 0.005 ? 0 : next;
        this.pushDebugEvent('debug', 'debug.ballast', `Ballast adjusted to ${inventory.debugBallastKg.toFixed(2)} kg`);
        this.deps.onFinishInventoryChange();
      },
      setDebugBallastKg: (kg: number) => {
        const inventory = this.deps.getInventory();
        const rounded = Math.round(kg * 100) / 100;
        inventory.debugBallastKg = Math.abs(rounded) < 0.005 ? 0 : rounded;
        this.pushDebugEvent('debug', 'debug.ballast', `Ballast set to ${inventory.debugBallastKg.toFixed(2)} kg`);
        this.deps.onFinishInventoryChange();
      },
      setWeightThresholds: (patch) => {
        const moderateKg = Math.max(0.5, patch.moderateKg ?? this.weightThresholds.moderateKg);
        const heavyKg = Math.max(moderateKg + 0.5, patch.heavyKg ?? this.weightThresholds.heavyKg);
        const overburdenedKg = Math.max(
          heavyKg + 0.5,
          patch.overburdenedKg ?? this.weightThresholds.overburdenedKg
        );
        this.weightThresholds = { moderateKg, heavyKg, overburdenedKg };
        this.pushDebugEvent(
          'debug',
          'debug.weight_thresholds',
          `Thresholds: mod=${moderateKg}kg, heavy=${heavyKg}kg, over=${overburdenedKg}kg`
        );
        this.deps.onFinishInventoryChange();
      },
      spawnEntry: (spawnId, target, opts) => {
        const entry = this.spawnCatalog.find((e) => e.id === spawnId);
        if (!entry) return { ok: false, message: `Unknown spawn ID: ${spawnId}` };
        const { player } = this.deps;
        const propsCtx = this.deps.getPropsCtx();
        const vegetation = this.deps.getVegetation();
        let tx = player.pos.x - Math.sin(player.yaw) * 3.5;
        let tz = player.pos.z - Math.cos(player.yaw) * 3.5;
        if (target === 'picked') {
          const hit = this.pickedHit ?? this.centerHit;
          if (hit) {
            tx = hit.point.x;
            tz = hit.point.z;
          }
        } else if (target === 'coords' && opts?.x !== undefined && opts?.z !== undefined) {
          tx = opts.x;
          tz = opts.z;
        }
        const limit = WORLD_HALF - 15;
        tx = THREE.MathUtils.clamp(tx, -limit, limit);
        tz = THREE.MathUtils.clamp(tz, -limit, limit);

        if (entry.category === 'mushroom' && entry.mushroomSpecies && propsCtx) {
          propsCtx.spawnMushroomAt(tx, tz, entry.mushroomSpecies);
        } else if (entry.category === 'flora' && entry.floraKind && vegetation) {
          vegetation.spawnDynamicProp(entry.floraKind as DynamicFloraKind, tx, tz, opts?.scale);
        } else if (entry.category === 'structure' && propsCtx) {
          if (entry.hutDecay) {
            propsCtx.spawnHutAt(tx, tz, player.yaw + Math.PI, entry.hutDecay, entry.label);
            this.deps.weatherSky.setShelterGeometry(propsCtx.shelters);
            this.deps.soundscape.spatialQuery.setBoxColliders(propsCtx.boxColliders);
            this.deps.onUpdatePropCircleColliders(propsCtx.circleColliders);
            this.deps.renderer.shadowMap.needsUpdate = true;
          } else if (entry.campfireLit !== undefined) {
            propsCtx.spawnCampfireAt(tx, tz, entry.campfireLit);
            this.deps.renderer.shadowMap.needsUpdate = true;
          }
        } else if (entry.category === 'item' && entry.itemId && propsCtx) {
          propsCtx.spawnPickupItemAt(tx, tz, entry.itemId);
        } else {
          return { ok: false, message: 'World systems still initializing.' };
        }

        const msg = `Spawned ${entry.label} at (${tx.toFixed(1)}, ${tz.toFixed(1)})`;
        this.pushDebugEvent('debug', 'debug.spawn', msg, { spawnId, x: tx, z: tz });
        return { ok: true, message: msg };
      },
      revealFullMap: () => {
        this.deps.fogOfWar.revealAll();
        this.deps.discovery.revealAll();
        this.deps.hudBridge.drawMinimapImmediate(
          this.deps.getMinimap(),
          this.deps.getInventory(),
          this.deps.fogOfWar,
          this.deps.player.pos.x,
          this.deps.player.pos.z,
          this.deps.player.yaw
        );
        this.pushDebugEvent('game', 'debug.reveal_map', 'Revealed 100% of countryside fog-of-war map');
        this.deps.onPushSurvivalSnapshot();
      },
      teleportTo: (x, z, label) => {
        this.teleportPlayer(x, z, label);
      },
      clearEvents: () => {
        this.debugEvents.length = 0;
      },
      emitDebugEvent: (type, payload, intensity = 1) => {
        this.deps.sound.init();
        this.deps.sound.resume();
        const { player } = this.deps;
        this.deps.soundscape.engine.emitEvent({
          type,
          origin: 'player',
          simulationTimestamp: this.deps.getSimClockMs(),
          position: { x: player.pos.x, y: player.pos.y + 0.5, z: player.pos.z },
          intensity,
          payload: payload ?? {},
        });
      },
      dumpPerfText: () => {
        return this.deps.perfLogger.dumpText(
          this.deps.getHasLivePerfSample() ? this.deps.perfSample : undefined
        );
      },
    };
  }

  createInstanceDebugApi(): MetsavaikusDebugApi {
    return {
      getState: () => ({
        survival: { ...this.deps.getSurvival() },
        inventory: cloneInventory(this.deps.getInventory()),
        navigationMode: getNavigationMode(this.deps.getInventory()),
        phase: this.deps.getPhase(),
        hour: this.deps.weatherSky.timeOfDay,
        exploredPercent: this.deps.fogOfWar.getExploredPercent(),
        fogVersion: this.deps.fogOfWar.version,
        seatedInTent: this.deps.player.seatedTent !== null,
        wearingRainJacket: isWearingRainJacket(this.deps.getInventory()),
      }),
      movePlayerForTest: (x: number, z: number) => {
        const { player, discovery, fogOfWar, hudBridge } = this.deps;
        const cx = THREE.MathUtils.clamp(x, -WORLD_HALF + 20, WORLD_HALF - 20);
        const cz = THREE.MathUtils.clamp(z, -WORLD_HALF + 20, WORLD_HALF - 20);
        player.pos.set(cx, getTerrainHeight(cx, cz), cz);
        discovery.markAroundWorldPos(cx, cz, 1);
        fogOfWar.revealAt(cx, cz);
        this.deps.onSetLastFogReveal(cx, cz);
        hudBridge.drawMinimapImmediate(
          this.deps.getMinimap(),
          this.deps.getInventory(),
          fogOfWar,
          cx,
          cz,
          player.yaw,
          true
        );
        this.deps.onPushSurvivalSnapshot();
        return {
          x: cx,
          z: cz,
          exploredPercent: fogOfWar.getExploredPercent(),
          fogVersion: fogOfWar.version,
        };
      },
      openPrimaryCampfire: () => {
        const info = this.deps.getPropsCtx()?.getCampfireInfo('fire_v0');
        if (info) {
          this.deps.setUiModalOpen(true);
          this.deps.player.resetIdleMotionFlags();
          this.deps.getCallbacks().onOpenCampfireModal(info);
        }
      },
      openCampfireById: (id: string) => {
        const info = this.deps.getPropsCtx()?.getCampfireInfo(id);
        if (info) {
          this.deps.setUiModalOpen(true);
          this.deps.player.resetIdleMotionFlags();
          this.deps.getCallbacks().onOpenCampfireModal(info);
        }
      },
      kickNearestStump: () => {
        const propsCtx = this.deps.getPropsCtx();
        if (!propsCtx) return { broken: false, woodPiecesNear: 0 };
        const stumps = propsCtx.getBreakableStumps();
        if (stumps.length === 0) return { broken: false, woodPiecesNear: 0 };
        const { player, camera, interaction } = this.deps;
        let nearest = stumps[0];
        let bestSq = Infinity;
        for (const s of stumps) {
          const dSq = (s.x - player.pos.x) ** 2 + (s.z - player.pos.z) ** 2;
          if (dSq < bestSq) {
            bestSq = dSq;
            nearest = s;
          }
        }
        const tx = nearest.x;
        const tz = nearest.z;
        const ty = getTerrainHeight(tx, tz) + 0.28;
        player.pos.set(tx + 1.9, getTerrainHeight(tx + 1.9, tz + 1.4), tz + 1.4);
        const dx = tx - player.pos.x;
        const dz = tz - player.pos.z;
        const dy = ty - (player.pos.y + player.currentEye);
        player.yaw = Math.atan2(-dx, -dz);
        player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        camera.position.set(player.pos.x, player.pos.y + player.currentEye, player.pos.z);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        camera.updateMatrixWorld();
        interaction.updateInteractionHover();
        interaction.handleInteractF();
        return {
          broken: !!nearest.entry.gathered,
          woodPiecesNear: propsCtx.getPickupItems().length,
        };
      },
      kickNearestDeadfallReal: () => {
        const propsCtx = this.deps.getPropsCtx();
        const vegetation = this.deps.getVegetation();
        if (!vegetation || !propsCtx) {
          return { hoveredTitle: null, broken: false, woodPiecesNear: 0 };
        }
        const { player, camera, interaction } = this.deps;
        const log = vegetation.getNearestDeadfall(player.pos.x, player.pos.z);
        if (!log) return { hoveredTitle: null, broken: false, woodPiecesNear: 0 };
        const px = log.x + 2.0;
        const pz = log.z + 1.2;
        player.pos.set(px, getTerrainHeight(px, pz), pz);
        const dx = log.x - player.pos.x;
        const dz = log.z - player.pos.z;
        const dy = log.y + 0.2 * log.scale - (player.pos.y + player.currentEye);
        player.yaw = Math.atan2(-dx, -dz);
        player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        camera.position.set(player.pos.x, player.pos.y + player.currentEye, player.pos.z);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        camera.updateMatrixWorld();
        interaction.updateInteractionHover();
        const hoveredTitle = interaction.hoveredDeadfall
          ? 'Fallen Log (Lamav palk)'
          : interaction.hoveredObj?.name ?? null;
        interaction.handleInteractF();
        return {
          hoveredTitle,
          broken: log.broken,
          woodPiecesNear: propsCtx.getPickupItems().length,
        };
      },
      pickNearestBirchFirewoodReal: () => {
        const propsCtx = this.deps.getPropsCtx();
        const survival = this.deps.getSurvival();
        const inventory = this.deps.getInventory();
        if (!propsCtx) {
          return { hoveredTitle: null, picked: false, totalWood: 0, packKg: survival.backpackWeightKg };
        }
        const birchLogs = propsCtx
          .getPickupItems()
          .filter(
            (p) =>
              p.entry.pickupItemId === 'firewood' &&
              (getEntryName(p.entry).includes('Birch') || getEntryName(p.entry).includes('Kasehalg'))
          );
        if (birchLogs.length === 0) {
          return {
            hoveredTitle: null,
            picked: false,
            totalWood: inventory.stacks.firewood ?? 0,
            packKg: survival.backpackWeightKg,
          };
        }
        const { player, camera, interaction } = this.deps;
        const target = birchLogs[0];
        const tx = target.x;
        const tz = target.z;
        const ty = target.entry.mesh.position.y;
        const px = tx + 1.3;
        const pz = tz + 1.1;
        player.pos.set(px, getTerrainHeight(px, pz), pz);
        const dx = tx - player.pos.x;
        const dz = tz - player.pos.z;
        const dy = ty - (player.pos.y + player.currentEye);
        player.yaw = Math.atan2(-dx, -dz);
        player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        camera.position.set(player.pos.x, player.pos.y + player.currentEye, player.pos.z);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        camera.updateMatrixWorld();
        interaction.updateInteractionHover();
        const hoveredTitle = interaction.hoveredObj?.name ?? null;
        const before = inventory.stacks.firewood ?? 0;
        interaction.handleInteractE();
        const after = inventory.stacks.firewood ?? 0;
        return {
          hoveredTitle,
          picked: after > before,
          totalWood: after,
          packKg: survival.backpackWeightKg,
        };
      },
      gatherNearbyWood: (maxCount = 3) => {
        const propsCtx = this.deps.getPropsCtx();
        const survival = this.deps.getSurvival();
        const inventory = this.deps.getInventory();
        if (!propsCtx) return { collected: 0, totalWood: 0, packKg: survival.backpackWeightKg };
        const { player } = this.deps;
        const items = propsCtx
          .getPickupItems()
          .sort(
            (a, b) =>
              (a.x - player.pos.x) ** 2 +
              (a.z - player.pos.z) ** 2 -
              ((b.x - player.pos.x) ** 2 + (b.z - player.pos.z) ** 2)
          );
        let collected = 0;
        for (const item of items) {
          if (collected >= maxCount) break;
          const id = propsCtx.collectPickupItem(item.entry);
          if (id) {
            addItemToInventory(inventory, id, 1);
            collected++;
          }
        }
        if (collected > 0) this.deps.onFinishInventoryChange();
        return {
          collected,
          totalWood: inventory.stacks.firewood ?? 0,
          packKg: survival.backpackWeightKg,
        };
      },
      placeCampfire: () => {
        return this.deps.getActions()?.placeCampfireFromWood() ?? null;
      },
      pitchTentForTest: () => {
        return this.deps.getActions()?.pitchTent() ?? null;
      },
      openTentSleepForTest: () => {
        const list = this.deps.getPropsCtx()?.getTents() ?? [];
        if (list.length === 0) return false;
        const tt = list[0];
        this.deps.setUiModalOpen(true);
        this.deps.player.resetIdleMotionFlags();
        if (document.pointerLockElement) document.exitPointerLock?.();
        this.deps.onPushSurvivalSnapshot();
        this.deps.getCallbacks().onOpenSleepModal({
          kind: 'tent',
          label: t('prop.tentSpotLabel'),
          x: tt.x,
          y: tt.y + 0.15,
          z: tt.z,
          shelter: 'tent',
          tentId: tt.id,
        });
        return true;
      },
      sitInTentForTest: () => {
        return this.deps.getActions()?.sitInTent() ?? false;
      },
      standUpFromTentForTest: () => {
        this.deps.getActions()?.standUpFromTent();
      },
      packUpTentForTest: () => {
        const propsCtx = this.deps.getPropsCtx();
        const list = propsCtx?.getTents() ?? [];
        if (list.length === 0 || !propsCtx) return false;
        const tt = list[0];
        if (this.deps.player.seatedTent?.id === tt.id) this.deps.player.exitTentSeat(true);
        if (!propsCtx.packUpPlayerTent(tt.id)) return false;
        addItemToInventory(this.deps.getInventory(), 'tent', 1);
        this.deps.getCallbacks().onToast(t('prop.tentPackedUp'));
        this.deps.onFinishInventoryChange();
        return true;
      },
      toggleRainJacketForTest: () => {
        this.deps.getActions()?.toggleWearItem('rain_jacket');
        return isWearingRainJacket(this.deps.getInventory());
      },
      triggerSpatialSoundForTest: (kind: SpatialClipKind) => {
        this.deps.sound.init();
        this.deps.sound.resume();
        const angle = Math.PI * 0.25;
        const dist = kind === 'insect' ? 2.4 : kind === 'cricket' ? 8.0 : 12.0;
        const dy = kind === 'bird' ? 5.0 : kind === 'cricket' ? -1.1 : 0.0;
        return this.deps.sound.triggerSpatialClip(
          kind,
          this.deps.camera.position.x + Math.cos(angle) * dist,
          this.deps.camera.position.y + dy,
          this.deps.camera.position.z + Math.sin(angle) * dist,
          1.0,
          {
            biome: getBiomeInfo(this.deps.player.pos.x, this.deps.player.pos.z).id,
            weather: this.deps.weatherSky.currentWeather,
            hourOfDay: this.deps.weatherSky.timeOfDay,
          }
        );
      },
      getSpatialAudioStats: () => this.deps.sound.getSpatialAmbienceStats(),
      setWeatherForTest: (w: WeatherId) => {
        this.deps.weatherSky.setWeather(w, true);
        this.deps.onSetObservedWeather(w);
        this.deps.onPushSurvivalSnapshot();
      },
      setWindForTest: (wind: number | null) => {
        this.deps.weatherSky.windOverride = wind;
      },
      getWaterStateForTest: () => ({
        x: this.deps.player.pos.x,
        y: this.deps.player.pos.y,
        z: this.deps.player.pos.z,
        cameraY: this.deps.camera.position.y,
        waterY: SWAMP_WATER_Y,
        eyeAboveWater: this.deps.camera.position.y - SWAMP_WATER_Y,
        waterDepth: this.deps.player.lastWaterDepthM,
        isSwimming: this.deps.player.lastIsSwimming,
        isSwampWading: this.deps.player.lastIsSwampWading,
        onBoardwalk: this.deps.player.lastOnBoardwalk,
        windStrength: this.deps.getLastWindStrength(),
      }),
      setHourForTest: (hour: number) => {
        this.deps.weatherSky.timeOfDay = ((hour % 24) + 24) % 24;
        this.deps.onPushSurvivalSnapshot();
      },
      triggerLethalCollapse: (cause = 'Fatal Valge kärbseseen (Amatoxin)') => {
        const survival = this.deps.getSurvival();
        survival.health = 0;
        survival.deathCause = cause;
        survival.deathFactors = ['Empty stomach', 'Hypothermia (34.4°C)'];
        this.deps.onBeginCollapse();
      },
      setVitalsForTest: (patch) => {
        Object.assign(this.deps.getSurvival(), patch);
        this.deps.onSyncHudAndSnapshot();
      },
      getSoundscapeDiagnostics: () => this.deps.soundscape.engine.getDiagnosticsSnapshot(),
      triggerSoundscapeEvent: (type: string, intensity = 1) => {
        this.deps.sound.init();
        this.deps.sound.resume();
        const { player } = this.deps;
        this.deps.soundscape.engine.emitEvent({
          type,
          origin: 'player',
          simulationTimestamp: this.deps.getSimClockMs(),
          position: { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z },
          intensity,
          payload: { material: 'wood', source: 'debug' },
        });
      },
      auditionSoundscapeSound: (soundId: string) => {
        this.deps.sound.init();
        this.deps.sound.resume();
        return this.deps.soundscape.engine.auditionSound(soundId);
      },
      stopSoundscapeAudition: () => this.deps.soundscape.engine.stopAuditionSounds(),
      resetSoundscapeQuotas: () => {
        this.deps.soundscape.engine.resetQuotasAndCooldowns();
        saveSoundscapeSnapshotToStorage(this.deps.worldSeed, this.deps.soundscape.engine);
      },
      reloadSoundscapeConfigJson: (json: string) => this.deps.soundscape.engine.reloadConfigFromJson(json),
      exportSoundscapeSnapshot: () => this.deps.soundscape.engine.exportSnapshot(),
      importSoundscapeSnapshot: (snap: PersistedSoundscapeState) => {
        this.deps.soundscape.engine.importSnapshot(snap);
      },
    };
  }
}
