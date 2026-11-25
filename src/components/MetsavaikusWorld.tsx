import { moveSphere, pushCharacterOut } from '../world/spatialPhysics';
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

function createOutdoorEnvScene(): THREE.Scene {
  const envScene = new THREE.Scene();
  const skyGeo = new THREE.SphereGeometry(20, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 zenith = vec3(0.22, 0.44, 0.72);
        vec3 horizon = vec3(0.76, 0.86, 0.92);
        vec3 pineBand = vec3(0.16, 0.24, 0.14);
        vec3 ground = vec3(0.12, 0.15, 0.09);

        vec3 col = y >= 0.0
          ? mix(horizon, zenith, smoothstep(0.0, 0.75, y))
          : mix(pineBand, ground, smoothstep(0.0, -0.55, y));

        vec3 sunDir = normalize(vec3(0.55, 0.58, 0.35));
        float sunGlow = pow(max(dot(normalize(vDir), sunDir), 0.0), 16.0);
        col += vec3(1.15, 1.02, 0.82) * sunGlow * 0.9;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  envScene.add(new THREE.Mesh(skyGeo, skyMat));
  return envScene;
}

import {
  buildInteractionPrompt,
  canClearHeightCollider,
  clampMouseLookDelta,
  clampResolutionScale,
  computeAdaptiveDprSteps,
  formatFpsLabel,
  InteractionPromptData,
  MUSHROOM_SPECIES_INFO,
  MushroomBasket,
  MushroomSpecies,
  safeRequestPointerLock,
  smoothFps,
} from '../game/gameLogic';
import {
  AdaptiveQualityGovernor,
  createQualityDistanceState,
  QualityMode,
  QualityProfile,
  QualityTier,
  QualityTierName,
  slewQualityDistanceState,
  snapQualityDistanceState,
} from '../game/qualityGovernor';
import {
  addItemToInventory,
  CAMPFIRE_WOOD_COST,
  cloneInventory,
  computeClothingBonuses,
  computeInventoryWeightKg,
  computeSleepGearBonuses,
  createDefaultPackingSelection,
  createInventoryFromPacking,
  dropBottle,
  getNavigationMode,
  hasFlashlight,
  hasRainJacket,
  hasSleepingBag,
  hasTent,
  InventoryState,
  isWearingRainJacket,
  ITEM_CATALOG,
  ItemId,
  MUSHROOM_TO_ITEM_ID,
  NavigationMode,
  PackingSelection,
  removeStackItem,
  toggleWearClothing,
} from '../game/itemCatalog';
import {
  boilBottleAtCampfire,
  computeWeightBurden,
  cookCampfireRecipe,
  createInitialSurvivalState,
  DiscoveryTracker,
  drinkFromBottle,
  eatFoodItem,
  formatGameHour,
  loadFlashlightBattery,
  LocomotionState,
  PlayerSurvivalState,
  refillBottlesFromSource,
  stepSleepSlice,
  stepSurvivalTick,
  SurvivalTickEvents,
  tryIgniteCampfire,
} from '../game/survivalEngine';
import { FpsDropLogger, FramePerfSample } from '../game/perfLogger';
import {
  buildArchitectureAndProps,
  CampfireInfo,
  CircleCollider,
  InteractiveEntry,
  SleepSpotInfo,
  StructureAcousticsInfo,
  TentInfo,
  WorldPropsContext,
} from '../world/architectureAndProps';
import {
  DeadfallLogTarget,
  VegetationQualityOptions,
  VegetationStats,
  WorldVegetationSystem,
} from '../world/foliageFactory';
import { createWorldTextures, WorldTextures } from '../world/proceduralTextures';
import {
  AmbientShelter,
  FootstepSurface,
  SoundEngine,
  SpatialAmbienceStats,
  SpatialAudioEvent,
  SpatialClipKind,
} from '../world/soundEngine';
import type {
  DiagnosticsSnapshot,
  PersistedSoundscapeState,
  SurfaceMaterial,
  ValidationIssue,
} from '../soundscape/types';
import type { WebAudioHybridBackend } from '../soundscape/audioBackend';
import {
  buildWorldContextFromSimulator,
  createSimulatorSoundscape,
  loadSoundscapeSnapshotFromStorage,
  saveSoundscapeSnapshotToStorage,
} from '../world/soundscapeAdapter';
import {
  ChunkVisibilityStats,
  TerrainChunkManager,
} from '../world/terrainChunkManager';
import {
  distToRoadDetail,
  getActiveBlueprint,
  getBiomeInfo,
  getSwampFactor,
  getTerrainHeight,
  roadCenterX,
  setActiveWorldSeed,
  SWAMP_WATER_Y,
  WORLD_HALF,
  worldToVirtualChunk,
} from '../world/terrainMath';
import {
  createMinimapRenderer,
  FogOfWarMap,
  formatCompassLabel,
  MinimapRenderer,
} from '../world/minimapMath';
import { ComputeEngine } from '../world/wasmCompute';
import { computeFogCullDistance } from '../world/forestFrustumCuller';
import {
  BASE_GAME_HOURS_PER_SEC,
  WeatherAndSkySystem,
  WeatherId,
} from '../world/weatherAndSky';
import {
  getItemName,
  getLocalizedBiomeLabel,
  getMushroomCopy,
  getWeatherLabel,
  subscribeLanguage,
  t,
} from '../i18n/i18n';

export type GamePhase =
  | 'title'
  | 'packing'
  | 'playing'
  | 'paused'
  | 'sleeping'
  | 'collapsing'
  | 'collapsed';

export interface WorldHudRefs {
  fpsEl: React.RefObject<HTMLSpanElement | null>;
  biomeEl: React.RefObject<HTMLDivElement | null>;
  timeWeatherEl: React.RefObject<HTMLDivElement | null>;
  flashEl: React.RefObject<HTMLDivElement | null>;
  minimapCanvasEl: React.RefObject<HTMLCanvasElement | null>;
  compassHeadingEl: React.RefObject<HTMLDivElement | null>;
  healthFillEl: React.RefObject<HTMLDivElement | null>;
  energyFillEl: React.RefObject<HTMLDivElement | null>;
  hydrationFillEl: React.RefObject<HTMLDivElement | null>;
  fullnessFillEl: React.RefObject<HTMLDivElement | null>;
  tirednessFillEl: React.RefObject<HTMLDivElement | null>;
  bodyTempEl: React.RefObject<HTMLSpanElement | null>;
  conditionsEl: React.RefObject<HTMLDivElement | null>;
  frostVignetteEl: React.RefObject<HTMLDivElement | null>;
  nauseaVignetteEl: React.RefObject<HTMLDivElement | null>;
  drowsyVignetteEl: React.RefObject<HTMLDivElement | null>;
}

export interface WorldSurvivalSnapshot {
  survival: PlayerSurvivalState;
  inventory: InventoryState;
  navigationMode: NavigationMode;
  discoveredPercent: number;
  fogVersion: number;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  hourOfDay: number;
  weather: WeatherId;
  windStrength: number;
  shelterLabel: string | null;
  nearLitCampfireFactor: number;
  seatedInTent: boolean;
  wearingRainJacket: boolean;
  sleepProgress: { elapsedHours: number; totalHours: number; spotLabel: string } | null;
  collapseProgress: number;
}

export interface WorldCallbacks {
  onGatherMushroom: (species: MushroomSpecies) => void;
  onPromptChange: (prompt: InteractionPromptData | null) => void;
  onCarryChange: (label: string) => void;
  onToast: (msg: string) => void;
  onPhaseChange: (phase: GamePhase) => void;
  onWorldReady: (info: { wasmActive: boolean; totalMushrooms: number }) => void;
  onDisplayMetrics?: (info: { autoDpr: number; viewportW: number; viewportH: number }) => void;
  onQualityChange?: (info: {
    mode: QualityMode;
    tier: QualityTier;
    tierName: QualityTierName;
    maxRenderDist: number;
  }) => void;
  onSurvivalSnapshot: (snap: WorldSurvivalSnapshot) => void;
  onOpenSleepModal: (spot: SleepSpotInfo) => void;
  onOpenCampfireModal: (campfire: CampfireInfo) => void;
  onToggleBackpack: () => void;
  onToggleFullMap: () => void;
  onCloseModals: () => void;
  onToggleDiagnostics?: () => void;
}

export interface WorldActions {
  startPlaying: (packingSelection: PackingSelection) => void;
  resumePlaying: () => void;
  restartWorld: (packingSelection?: PackingSelection) => void;
  cycleWeather: () => void;
  advanceTime: () => void;
  toggleFlashlight: () => void;
  toggleMute: () => boolean;
  setResolutionScale: (scale: number | null) => void;
  setQualityMode: (mode: QualityMode) => void;
  setUiModalOpen: (open: boolean) => void;
  setDiagnosticsOpen: (open: boolean) => void;
  getSoundscapeDiagnostics: () => DiagnosticsSnapshot | null;
  triggerSoundscapeEvent: (type: string, intensity?: number) => void;
  auditionSoundscapeSound: (soundId: string) => boolean;
  setSoundscapeBusVolume: (busId: string, vol: number) => void;
  setSoundscapeBusMuted: (busId: string, muted: boolean) => void;
  setSoundscapeMusicEnabled: (enabled: boolean) => void;
  setSoundscapeMusicVolume: (vol: number) => void;
  reloadSoundscapeConfigJson: (json: string) => {
    ok: boolean;
    issues: ValidationIssue[];
    diffSummary?: string;
  };
  getSoundscapeConfigJson: () => string;
  eatItem: (itemId: ItemId) => void;
  drinkBottle: (uid: string) => void;
  loadBattery: () => void;
  dropItem: (itemId: ItemId) => void;
  dropBottleByUid: (uid: string) => void;
  igniteCampfire: (campfireId: string) => CampfireInfo | null;
  bankCampfire: (campfireId: string) => CampfireInfo | null;
  placeCampfireFromWood: () => CampfireInfo | null;
  pitchTent: () => TentInfo | null;
  sitInTent: (tentId?: string) => boolean;
  standUpFromTent: () => void;
  openSleepForSeatedTent: () => void;
  toggleWearItem: (itemId: ItemId) => void;
  sleepInSleepingBag: () => void;
  cookAtCampfire: (recipe: 'seared_steak' | 'roasted_mushrooms') => void;
  boilBottle: (uid: string) => void;
  startSleep: (spot: SleepSpotInfo, hours: number) => void;
  wakeEarly: () => void;
  renderFullMap: (canvas: HTMLCanvasElement, zoom: number, panX: number, panZ: number) => void;
}

interface MetsavaikusWorldProps {
  worldSeed: number;
  phase: GamePhase;
  resolutionScale: number | null;
  qualityMode: QualityMode;
  initialPacking: PackingSelection;
  hudRefs: WorldHudRefs;
  callbacks: WorldCallbacks;
  actionsRef: React.MutableRefObject<WorldActions | null>;
  basket: MushroomBasket;
}

function detectGpuInfo(): {
  isSoftwareGl: boolean;
  isLowPowerGpu: boolean;
  gpuRenderer: string;
} {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { isSoftwareGl: true, isLowPowerGpu: true, gpuRenderer: 'NoWebGL' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const raw = String(gl.getParameter(param) || 'unknown').trim();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const gpuRenderer = raw.length > 72 ? `${raw.slice(0, 69)}...` : raw;
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(raw);
    const isLowPowerGpu =
      isSoftwareGl ||
      /Intel.*(UHD|HD Graphics|GT1|GT2|Bay Trail|Cherry|Jasper|Gemini|CFL|KBL|SKL|WHL|CML)|Mesa Intel.*(UHD|HD )/i.test(
        raw
      );
    return { isSoftwareGl, isLowPowerGpu, gpuRenderer };
  } catch {
    return { isSoftwareGl: false, isLowPowerGpu: false, gpuRenderer: 'unknown' };
  }
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _lookDir = new THREE.Vector3();
const _camForward = new THREE.Vector3(0, 0, -1);
const _holdPos = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _rayCenter = new THREE.Vector2(0, 0);
const _nearbyVegColliders: CircleCollider[] = [];

export const MetsavaikusWorld: React.FC<MetsavaikusWorldProps> = ({
  worldSeed,
  phase,
  resolutionScale,
  qualityMode,
  initialPacking,
  hudRefs,
  callbacks,
  actionsRef,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;

  const resolutionScaleRef = useRef<number | null>(resolutionScale);
  resolutionScaleRef.current = resolutionScale;

  const qualityModeRef = useRef<QualityMode>(qualityMode);
  qualityModeRef.current = qualityMode;

  const initialPackingRef = useRef<PackingSelection>(initialPacking);
  initialPackingRef.current = initialPacking;

  const callbacksRef = useRef<WorldCallbacks>(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      actionsRef.current?.setResolutionScale(resolutionScale);
    }, 110);
    return () => window.clearTimeout(timer);
  }, [resolutionScale, actionsRef]);

  useEffect(() => {
    actionsRef.current?.setQualityMode(qualityMode);
  }, [qualityMode, actionsRef]);

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    setActiveWorldSeed(worldSeed);

    let disposed = false;
    let frameId = 0;
    let isTimeoutFrame = false;

    const { isSoftwareGl, isLowPowerGpu, gpuRenderer } = detectGpuInfo();
    let dprSteps = computeAdaptiveDprSteps(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio || 1,
      isSoftwareGl,
      isLowPowerGpu
    );
    let manualResolutionScale: number | null =
      resolutionScaleRef.current !== null
        ? clampResolutionScale(resolutionScaleRef.current)
        : null;
    let dprStepIdx = 0;
    let currentDpr = manualResolutionScale !== null ? manualResolutionScale : dprSteps[0];
    let drsCheckTimer = 0;
    let drsLowFpsStreak = 0;
    let drsHighFpsStreak = 0;
    let lastDrsStepDownMs = -Infinity;

    callbacksRef.current.onDisplayMetrics?.({
      autoDpr: dprSteps[0],
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    });

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(currentDpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.dataset.worldSeed = String(worldSeed);
    mountEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.1,
      460
    );

    let envTarget: THREE.WebGLRenderTarget | null = null;
    if (!isLowPowerGpu) {
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      const outdoorEnv = createOutdoorEnvScene();
      envTarget = pmremGenerator.fromScene(outdoorEnv, 0.03);
      scene.environment = envTarget.texture;
      outdoorEnv.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
      });
      pmremGenerator.dispose();
    }

    // Keep flashlight visible=true forever (intensity=0 when off) so NUM_SPOT_LIGHTS never recompiles
    const flashlight = new THREE.SpotLight(0xfff1cc, 0, 38, Math.PI / 5.5, 0.45, 1.4);
    flashlight.visible = true;
    flashlight.position.set(0, 0, 0);
    camera.add(flashlight);
    camera.add(flashlight.target);
    flashlight.target.position.set(0, -0.05, -5);
    scene.add(camera);

    const sound = new SoundEngine();
    const soundscape = createSimulatorSoundscape({ seed: worldSeed });
    sound.attachSoundscapeEngine(soundscape.engine, soundscape.backend as WebAudioHybridBackend);
    loadSoundscapeSnapshotFromStorage(worldSeed, soundscape.engine);

    const qualityGovernor = new AdaptiveQualityGovernor({
      hardware: { isSoftwareGl, isLowPowerGpu, gpuRenderer },
      initialMode: qualityModeRef.current,
    });
    const smoothedQuality = createQualityDistanceState(qualityGovernor.getProfile());
    const vegQualityOpts: VegetationQualityOptions = {};

    const weatherSky = new WeatherAndSkySystem(scene, isSoftwareGl, currentDpr, isLowPowerGpu);
    const computeAutoTopDpr = (profile: QualityProfile): number => {
      if (isSoftwareGl) return 1;
      const baseTop = dprSteps[0];
      const nativeCap = Math.min(window.devicePixelRatio || 1, profile.dprBoostMax);
      return Math.min(profile.dprBoostMax, Math.max(baseTop, nativeCap));
    };

    let refreshQualitySceneNow: ((profile: QualityProfile) => void) | null = null;
    const applyQualityProfileToScene = (profile: QualityProfile, immediate = true) => {
      if (weatherSky.setShadowExtent(profile.shadowExtent)) {
        renderer.shadowMap.needsUpdate = true;
      }
      if (manualResolutionScale === null && dprStepIdx === 0 && !isSoftwareGl) {
        const targetDpr = computeAutoTopDpr(profile);
        if (Math.abs(targetDpr - currentDpr) > 0.02) {
          currentDpr = targetDpr;
          renderer.setPixelRatio(currentDpr);
          weatherSky.setPixelRatio(currentDpr);
          renderer.domElement.dataset.pixelRatio = currentDpr.toFixed(2);
        }
      }
      renderer.domElement.dataset.qualityTier = profile.name;
      renderer.domElement.dataset.qualityMode = String(qualityGovernor.getMode());
      renderer.domElement.dataset.qualityGrassRing = String(profile.grassMaxRing);
      if (immediate) {
        snapQualityDistanceState(smoothedQuality, profile);
        if (refreshQualitySceneNow) {
          refreshQualitySceneNow(profile);
        } else {
          const estDist = computeFogCullDistance(
            0.0052 * profile.fogDensityScale,
            profile.minRenderDist,
            profile.maxRenderDist
          );
          renderer.domElement.dataset.fogCullDist = estDist.toFixed(1);
        }
      }
      callbacksRef.current.onQualityChange?.({
        mode: qualityGovernor.getMode(),
        tier: profile.tier,
        tierName: profile.name,
        maxRenderDist: profile.maxRenderDist,
      });
    };

    applyQualityProfileToScene(qualityGovernor.getProfile(), true);
    let simClockMs = weatherSky.timeOfDay * 3_600_000;
    let simDay = 1;
    let prevSkyHour = weatherSky.timeOfDay;
    let lastSnapshotSaveSec = 0;

    weatherSky.setOnThunderCallback((tx, ty, tz, intensity) => {
      soundscape.engine.emitEvent({
        type: 'weather.thunder',
        origin: 'environment',
        simulationTimestamp: simClockMs,
        position: { x: tx, y: ty, z: tz },
        intensity,
        correlationId: `thunder_${Math.round(simClockMs)}`,
        dedupeKey: `thunder_${Math.floor(simClockMs / 250)}`,
        dedupeWindowMs: 250,
        payload: { weather: weatherSky.currentWeather },
      });
    });

    let lastShadowX = 9999;
    let lastShadowZ = 9999;
    let lastShadowSunY = -99;
    let shadowFrameSkip = 0;

    let textures: WorldTextures | null = null;
    let vegetation: WorldVegetationSystem | null = null;
    let propsCtx: WorldPropsContext | null = null;
    let propCircleColliders: CircleCollider[] = [];
    let terrainMgr: TerrainChunkManager | null = null;
    let minimap: MinimapRenderer | null = null;
    let computeEngine: ComputeEngine | null = null;

    // Survival, Inventory, Discovery & Sleep/Collapse State
    let inventory: InventoryState = createInventoryFromPacking(
      initialPackingRef.current ?? createDefaultPackingSelection()
    );
    let survival: PlayerSurvivalState = createInitialSurvivalState(
      computeInventoryWeightKg(inventory)
    );
    const discovery = new DiscoveryTracker();
    const fogOfWar = new FogOfWarMap();
    let lastFogRevealX = 999999;
    let lastFogRevealZ = 999999;
    const tickEvents: SurvivalTickEvents = {
      vomited: false,
      vomitSource: null,
      died: false,
      flashlightDepleted: false,
      toastMessage: null,
    };

    let uiModalOpen = false;
    let diagnosticsOpen = false;
    let vomitLurchTimer = 0;
    let collapseTimer = 0;
    let collapseStartMs = 0;
    const COLLAPSE_DURATION_SEC = 3.2;
    let collapseStartPitch = 0;
    let collapseStartEye = 1.7;

    interface SleepSession {
      spot: SleepSpotInfo;
      totalHours: number;
      elapsedHours: number;
      realDurationSec: number;
      orbitAngle: number;
      nearFireFactor: number;
    }
    let sleepSession: SleepSession | null = null;
    let seatedTent: TentInfo | null = null;
    let seatedBaseYaw = 0;
    let seatedBlend = 0;
    const seatedCamPos = new THREE.Vector3();
    const seatedStartPos = new THREE.Vector3();

    function computeTentSeatWorldPos(tent: TentInfo, out: THREE.Vector3): void {
      // Seated squarely on the insulated pad inside the tent, looking out the open triangular front doorway (+Z)
      const lx = -0.04;
      const lz = -0.18;
      const cosY = Math.cos(tent.yaw);
      const sinY = Math.sin(tent.yaw);
      out.set(
        tent.x + lx * cosY + lz * sinY,
        tent.y + 0.56,
        tent.z - lx * sinY + lz * cosY
      );
    }

    function enterTentSeat(tent: TentInfo): void {
      sound.init();
      sound.resume();
      if (player.carrying) dropCarried(0);
      seatedTent = tent;
      seatedBaseYaw = tent.yaw + Math.PI;
      seatedBlend = 0;
      computeTentSeatWorldPos(tent, seatedCamPos);
      // Start subtle settle-in glide from just 0.16m higher inside the tent so the interior frames immediately at any FPS
      seatedStartPos.set(seatedCamPos.x, seatedCamPos.y + 0.16, seatedCamPos.z);
      player.pos.set(tent.x, tent.y, tent.z);
      player.vel.set(0, 0, 0);
      player.yaw = seatedBaseYaw;
      player.pitch = -0.03;
      camera.position.copy(seatedStartPos);
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
      camera.updateMatrixWorld();
      uiModalOpen = false;
      hoveredObj = null;
      hoveredDeadfall = null;
      lastPromptKey = '';
      callbacksRef.current.onPromptChange(null);
      sound.playFabricRustle(true);
      callbacksRef.current.onToast(t('toast.satInTent'));
      syncVitalHudDom();
      pushSurvivalSnapshot();
    }

    function exitTentSeat(silent = false): void {
      if (!seatedTent) return;
      const tent = seatedTent;
      seatedTent = null;
      const exitDist = 2.25;
      const ex = tent.x + Math.sin(tent.yaw) * exitDist;
      const ez = tent.z + Math.cos(tent.yaw) * exitDist;
      const ey = getSurfaceHeightAt(ex, ez);
      player.pos.set(ex, ey, ez);
      player.vel.set(0, 0, 0);
      player.yaw = tent.yaw + Math.PI;
      player.pitch = -0.04;
      player.currentEye = player.eyeHeight;
      resolvePlayerCollisions(player.pos);
      if (!silent) {
        sound.playFabricRustle(false);
        callbacksRef.current.onToast(t('toast.stoodUpTent'));
      }
      syncVitalHudDom();
      pushSurvivalSnapshot();
    }

    const perfLogger = new FpsDropLogger(performance.now());
    let hasLivePerfSample = false;
    (window as unknown as { dumpMetsavaikusPerf?: () => string }).dumpMetsavaikusPerf = () => {
      const dump = perfLogger.dumpText(hasLivePerfSample ? perfSample : undefined);
      console.log(dump);
      return dump;
    };

    let lastObservedWeather = weatherSky.currentWeather;
    let lastObservedChunkKey = '';
    const onWebGlContextLost = (ev: Event) => {
      ev.preventDefault();
      perfLogger.recordEvent('webglcontextlost', performance.now());
    };
    const onWebGlContextRestored = () => {
      perfLogger.recordEvent('webglcontextrestored', performance.now());
    };
    renderer.domElement.addEventListener('webglcontextlost', onWebGlContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onWebGlContextRestored);

    const spawnZ = 6;
    const spawnX = roadCenterX(spawnZ);
    const player = {
      pos: new THREE.Vector3(spawnX, getTerrainHeight(spawnX, spawnZ), spawnZ),
      vel: new THREE.Vector3(),
      yaw: 0.05,
      pitch: -0.04,
      eyeHeight: 1.7,
      crouchEyeHeight: 1.05,
      currentEye: 1.7,
      onGround: true,
      carrying: null as InteractiveEntry | null,
      stepTimer: 0,
      bobPhase: 0,
    };

    discovery.markAroundWorldPos(player.pos.x, player.pos.z, 1);
    fogOfWar.revealAt(player.pos.x, player.pos.z);
    lastFogRevealX = player.pos.x;
    lastFogRevealZ = player.pos.z;

    let flashlightOn = false;
    let isMuted = false;
    let pointerLocked = false;
    let mouseDragging = false;
    let hoveredObj: InteractiveEntry | null = null;
    let hoveredDeadfall: DeadfallLogTarget | null = null;
    let canRefillBogWater = false;
    let lastPromptKey = '';
    let lastLocomotion: LocomotionState = 'idle';
    let lastWindStrength = 0.6;
    let lastShelterLabel: string | null = null;
    let lastNearFire = 0;
    let totalDistanceMoved = 0;
    let playerExertion = 0;
    let prevOnGround = true;
    let playerSpeedMps = 0;
    let lastIsMoving = false;
    let lastWantRun = false;
    let lastCrouching = false;
    let lastIsSwimming = false;
    let lastIsSwampWading = false;
    let lastOnBoardwalk = false;
    let lastWaterDepthM = 0;
    let lastWeatherIntensity = 0;
    let lastFogDensity = 0.006;
    let lastSunDirY = 0.5;

    const keysHeld = new Set<string>();
    const keysJustPressed = new Set<string>();
    const raycaster = new THREE.Raycaster();
    raycaster.far = 4.2;

    const chunkStats: ChunkVisibilityStats = { visibleChunks: 0, lod0: 0, lod1: 0, lod2: 0 };
    const vegStats: VegetationStats = {
      treesRendered: 0,
      foliageRendered: 0,
      culledInstances: 0,
      candidateInstances: 0,
    };

    // Cached DOM values to avoid unnecessary style writes
    let lastBarHealth = -1;
    let lastBarEnergy = -1;
    let lastBarHydration = -1;
    let lastBarFullness = -1;
    let lastBarTiredness = -1;
    let lastTempText = '';
    let lastCondText = '';

    function syncVitalHudDom(): void {
      if (hudRefs.healthFillEl.current && Math.abs(survival.health - lastBarHealth) > 0.25) {
        lastBarHealth = survival.health;
        hudRefs.healthFillEl.current.style.transform = `scaleX(${(survival.health / 100).toFixed(3)})`;
      }
      if (hudRefs.energyFillEl.current && Math.abs(survival.energy - lastBarEnergy) > 0.25) {
        lastBarEnergy = survival.energy;
        hudRefs.energyFillEl.current.style.transform = `scaleX(${(survival.energy / 100).toFixed(3)})`;
      }
      if (hudRefs.hydrationFillEl.current && Math.abs(survival.hydration - lastBarHydration) > 0.25) {
        lastBarHydration = survival.hydration;
        hudRefs.hydrationFillEl.current.style.transform = `scaleX(${(survival.hydration / 100).toFixed(3)})`;
      }
      if (hudRefs.fullnessFillEl.current && Math.abs(survival.stomachFullness - lastBarFullness) > 0.25) {
        lastBarFullness = survival.stomachFullness;
        hudRefs.fullnessFillEl.current.style.transform = `scaleX(${(survival.stomachFullness / 100).toFixed(3)})`;
      }
      if (hudRefs.tirednessFillEl.current && Math.abs(survival.physicalTiredness - lastBarTiredness) > 0.25) {
        lastBarTiredness = survival.physicalTiredness;
        hudRefs.tirednessFillEl.current.style.transform = `scaleX(${(survival.physicalTiredness / 100).toFixed(3)})`;
      }
      if (hudRefs.bodyTempEl.current) {
        const txt = `${survival.bodyTempC.toFixed(1)}°C`;
        if (txt !== lastTempText) {
          lastTempText = txt;
          hudRefs.bodyTempEl.current.textContent = txt;
        }
      }
      if (hudRefs.conditionsEl.current) {
        const conds: string[] = [];
        if (survival.hypothermiaStage === 'severe') conds.push(t('cond.severeHypothermia'));
        else if (survival.hypothermiaStage === 'hypothermia') conds.push(t('cond.hypothermia'));
        else if (survival.hypothermiaStage === 'chilly') conds.push(t('cond.cold'));
        if (survival.wetness > 55) conds.push(t('cond.soaked'));
        else if (survival.wetness > 25) conds.push(t('cond.wet'));
        if (survival.loadTier === 'overburdened') conds.push(t('cond.overburdened'));
        else if (survival.loadTier === 'heavy') conds.push(t('cond.heavy'));
        if (survival.waterStomachLoadL > 0.55) conds.push(t('cond.waterHeavy'));
        if (survival.nausea > 22 || survival.poisons.length > 0) conds.push(t('cond.sick'));
        if (survival.stomachFullness < 18) conds.push(t('cond.hungry'));
        if (survival.hydration < 20) conds.push(t('cond.thirsty'));
        if (survival.energy < 20) conds.push(t('cond.exhausted'));
        if (lastNearFire > 0.25) conds.push(t('cond.warm'));
        if (isWearingRainJacket(inventory)) conds.push(t('cond.rainJacket'));
        const nextCond = conds.slice(0, 4).join(' · ');
        if (nextCond !== lastCondText) {
          lastCondText = nextCond;
          hudRefs.conditionsEl.current.textContent = nextCond;
        }
      }

      if (hudRefs.frostVignetteEl.current) {
        const frost = THREE.MathUtils.clamp((35.8 - survival.bodyTempC) / 2.2, 0, 1) * 0.72;
        hudRefs.frostVignetteEl.current.style.opacity = frost.toFixed(3);
      }
      if (hudRefs.nauseaVignetteEl.current) {
        const nau = THREE.MathUtils.clamp(survival.nausea / 100, 0, 1) * 0.62;
        hudRefs.nauseaVignetteEl.current.style.opacity = nau.toFixed(3);
      }
      if (hudRefs.drowsyVignetteEl.current) {
        const drowsy = THREE.MathUtils.clamp((25 - survival.energy) / 25, 0, 1) * 0.52;
        hudRefs.drowsyVignetteEl.current.style.opacity = drowsy.toFixed(3);
      }
    }

    function pushSurvivalSnapshot(): void {
      const snap: WorldSurvivalSnapshot = {
        survival: {
          ...survival,
          poisons: survival.poisons.map((p) => ({ ...p })),
          deathFactors: [...survival.deathFactors],
        },
        inventory: cloneInventory(inventory),
        navigationMode: getNavigationMode(inventory),
        discoveredPercent: fogOfWar.getExploredPercent(),
        fogVersion: fogOfWar.version,
        playerX: player.pos.x,
        playerZ: player.pos.z,
        playerYaw: player.yaw,
        hourOfDay: weatherSky.timeOfDay,
        weather: weatherSky.currentWeather,
        windStrength: lastWindStrength,
        shelterLabel: seatedTent ? t('prop.tentSpotLabel') : lastShelterLabel,
        nearLitCampfireFactor: lastNearFire,
        seatedInTent: seatedTent !== null,
        wearingRainJacket: isWearingRainJacket(inventory),
        sleepProgress: sleepSession
          ? {
              elapsedHours: sleepSession.elapsedHours,
              totalHours: sleepSession.totalHours,
              spotLabel: sleepSession.spot.label,
            }
          : null,
        collapseProgress: Math.min(1, collapseTimer / COLLAPSE_DURATION_SEC),
      };
      callbacksRef.current.onSurvivalSnapshot(snap);
    }

    function beginCollapse(): void {
      if (phaseRef.current === 'collapsing' || phaseRef.current === 'collapsed') return;
      if (document.pointerLockElement) document.exitPointerLock?.();
      keysHeld.clear();
      keysJustPressed.clear();
      uiModalOpen = false;
      sleepSession = null;
      seatedTent = null;
      collapseTimer = 0;
      collapseStartMs = performance.now();
      collapseStartPitch = player.pitch;
      collapseStartEye = player.currentEye;
      if (flashlightOn) {
        flashlightOn = false;
        flashlight.intensity = 0;
      }
      phaseRef.current = 'collapsing';
      callbacksRef.current.onPhaseChange('collapsing');
      pushSurvivalSnapshot();
    }

    function getSurfaceHeightAt(x: number, z: number): number {
      let h = getTerrainHeight(x, z);
      if (!propsCtx) return h;
      h = propsCtx.shelters.floorHeight(x, z, h);
      for (let i = 0; i < propsCtx.boardwalkZones.length; i++) {
        const b = propsCtx.boardwalkZones[i];
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
          if (b.y > h) h = b.y;
        }
      }
      return h;
    }

    function isOnBoardwalk(x: number, z: number): boolean {
      if (!propsCtx) return false;
      for (let i = 0; i < propsCtx.boardwalkZones.length; i++) {
        const b = propsCtx.boardwalkZones[i];
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return true;
      }
      return false;
    }

    function applyCirclePush(pos: THREE.Vector3, list: CircleCollider[], pR: number): void {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const minD = pR + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD * minD && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          pos.x = c.x + (dx / d) * minD;
          pos.z = c.z + (dz / d) * minD;
        }
      }
    }

    function resolvePlayerCollisions(pos: THREE.Vector3): void {
      const pR = 0.42;
      applyCirclePush(pos, propCircleColliders, pR);

      if (vegetation) {
        vegetation.queryNearbyColliders(pos.x, pos.z, _nearbyVegColliders);
        applyCirclePush(pos, _nearbyVegColliders, pR);
      }

      if (propsCtx) {
        for (let i = 0; i < propsCtx.boxColliders.length; i++) {
          const b = propsCtx.boxColliders[i];
          if (!b.active) continue;
          if (b.jumpable && canClearHeightCollider(pos.y, b.groundY, b.heightAboveGround)) {
            continue;
          }
          pushCharacterOut(pos, pR, player.currentEye + 0.2, b);
        }
      }

      const limit = WORLD_HALF - 10;
      pos.x = THREE.MathUtils.clamp(pos.x, -limit, limit);
      pos.z = THREE.MathUtils.clamp(pos.z, -limit, limit);
    }

    function dropCarried(throwImpulse: number): void {
      if (!player.carrying) return;
      const item = player.carrying;
      player.carrying = null;
      item.resting = false;
      _euler.set(player.pitch, player.yaw, 0, 'YXZ');
      _lookDir.set(0, 0, -1).applyEuler(_euler);
      item.mesh.position.copy(camera.position);
      const releaseOffset = _lookDir.clone().multiplyScalar(1.05);
      if (propsCtx) moveSphere(item.mesh.position, releaseOffset, 1, item.radius, propsCtx.boxColliders, 0);
      item.vel.copy(player.vel).addScaledVector(_lookDir, throwImpulse);
      item.vel.y += throwImpulse * 0.25;
      callbacksRef.current.onCarryChange('');
    }

    const getEntryName = (entry: InteractiveEntry): string =>
      entry.getName ? entry.getName() : entry.name;
    const getEntryDesc = (entry: InteractiveEntry): string =>
      entry.getDesc ? entry.getDesc() : entry.desc;
    const getEntryPickupLabel = (entry: InteractiveEntry): string | undefined =>
      entry.getPickupLabel ? entry.getPickupLabel() : entry.pickupLabel;
    const getEntrySecondaryActionLabel = (entry: InteractiveEntry): string | undefined =>
      entry.getSecondaryActionLabel ? entry.getSecondaryActionLabel() : undefined;

    function handleInteractE(): void {
      if (player.carrying) {
        dropCarried(1.5);
        sound.playImpact(0.4);
        return;
      }
      if (!hoveredObj) {
        if (canRefillBogWater) {
          const res = refillBottlesFromSource(inventory, 'bog_lake');
          sound.playFootstep('water');
          survival.backpackWeightKg = computeInventoryWeightKg(inventory);
          callbacksRef.current.onToast(res.message);
          syncVitalHudDom();
          pushSurvivalSnapshot();
        }
        return;
      }

      if (hoveredObj.gatherable && propsCtx) {
        const gatheredSpecies = propsCtx.gatherMushroom(hoveredObj);
        if (gatheredSpecies) {
          const meta = MUSHROOM_SPECIES_INFO[gatheredSpecies];
          const localizedName = getMushroomCopy(gatheredSpecies).name;
          addItemToInventory(inventory, MUSHROOM_TO_ITEM_ID[gatheredSpecies], 1);
          survival.backpackWeightKg = computeInventoryWeightKg(inventory);
          callbacksRef.current.onGatherMushroom(gatheredSpecies);
          if (meta.edibility === 'poisonous') {
            callbacksRef.current.onToast(t('toast.gatherPoisonous', { name: localizedName }));
          } else if (meta.edibility === 'inedible') {
            callbacksRef.current.onToast(t('toast.gatherInedible', { name: localizedName }));
          } else {
            callbacksRef.current.onToast(t('toast.gatherEdible', { name: localizedName }));
          }
          hoveredObj = null;
          lastPromptKey = '';
          callbacksRef.current.onPromptChange(null);
          pushSurvivalSnapshot();
        }
        return;
      }

      if (hoveredObj.pickupItemId && propsCtx) {
        const pickedId = propsCtx.collectPickupItem(hoveredObj);
        if (pickedId) {
          addItemToInventory(inventory, pickedId, 1);
          survival.backpackWeightKg = computeInventoryWeightKg(inventory);
          const woodCount = inventory.stacks.firewood ?? 0;
          const totalKg = survival.backpackWeightKg.toFixed(2);
          const readyHint =
            pickedId === 'firewood' && woodCount >= CAMPFIRE_WOOD_COST
              ? t('toast.packedWoodReady')
              : pickedId === 'firewood'
                ? t('toast.packedWoodCount', { have: woodCount, need: CAMPFIRE_WOOD_COST })
                : '';
          callbacksRef.current.onToast(
            t('toast.packedItem', {
              name: getItemName(pickedId),
              unitKg: ITEM_CATALOG[pickedId].weightKg.toFixed(2),
              totalKg,
              hint: readyHint,
            })
          );
          hoveredObj = null;
          lastPromptKey = '';
          callbacksRef.current.onPromptChange(null);
          syncVitalHudDom();
          pushSurvivalSnapshot();
        }
        return;
      }

      if (hoveredObj.carryable) {
        player.carrying = hoveredObj;
        callbacksRef.current.onCarryChange(
          t('hud.carrying', { name: getEntryName(hoveredObj) })
        );
        sound.playImpact(0.35);
      } else if (hoveredObj.onUse) {
        hoveredObj.onUse();
      }
    }

    function handleInteractF(): void {
      if (player.carrying) {
        dropCarried(11.5);
        sound.playImpact(1.1);
        soundscape.engine.emitEvent({
          type: 'object.impact',
          origin: 'player',
          simulationTimestamp: simClockMs,
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          intensity: 0.7,
          dedupeKey: `throw_${Math.floor(elapsed * 5)}`,
          dedupeWindowMs: 120,
          payload: { material: 'wood', breakable: false, broken: false },
        });
        return;
      }
      if (!hoveredObj && hoveredDeadfall && vegetation && propsCtx) {
        survival.physicalTiredness = Math.min(100, survival.physicalTiredness + 3.5);
        const res = vegetation.kickDeadfall(hoveredDeadfall.id);
        if (res && res.hit) {
          const corrId = `kick_deadfall_${hoveredDeadfall.id}_${Math.round(simClockMs)}`;
          soundscape.engine.emitEvent({
            type: 'player.kick',
            origin: 'player',
            simulationTimestamp: simClockMs,
            position: { x: res.x, y: res.y, z: res.z },
            intensity: res.broken ? 1.2 : 0.95,
            correlationId: corrId,
            dedupeKey: `kick_${hoveredDeadfall.id}_${Math.floor(elapsed * 5)}`,
            dedupeWindowMs: 120,
            payload: { material: 'wood', broken: res.broken },
          });
          if (!res.broken) {
            sound.playImpact(1.1);
            soundscape.engine.emitEvent({
              type: 'object.impact',
              origin: 'player',
              simulationTimestamp: simClockMs,
              position: { x: res.x, y: res.y, z: res.z },
              intensity: 0.95,
              correlationId: corrId,
              dedupeKey: `impact_${hoveredDeadfall.id}_${Math.floor(elapsed * 5)}`,
              dedupeWindowMs: 120,
              payload: { material: 'wood', breakable: true, broken: false },
            });
            callbacksRef.current.onToast(t('toast.deadfallCracked'));
          } else {
            sound.playImpact(1.45);
            soundscape.engine.emitEvent({
              type: 'object.break',
              origin: 'player',
              simulationTimestamp: simClockMs,
              position: { x: res.x, y: res.y, z: res.z },
              intensity: 1.25,
              correlationId: corrId,
              dedupeKey: `break_${hoveredDeadfall.id}_${Math.floor(elapsed * 5)}`,
              dedupeWindowMs: 120,
              payload: { material: 'wood', breakable: true, broken: true },
            });
            const pieces = propsCtx.shatterWoodAt(res.x, res.y, res.z, res.rotY, 4);
            hoveredDeadfall = null;
            lastPromptKey = '';
            callbacksRef.current.onPromptChange(null);
            callbacksRef.current.onToast(t('toast.deadfallShattered', { count: pieces }));
          }
          syncVitalHudDom();
          pushSurvivalSnapshot();
        }
        return;
      }
      if (!hoveredObj) return;
      if (hoveredObj.gatherable) {
        callbacksRef.current.onToast(t('toast.gatherGently'));
        return;
      }
      if (hoveredObj.onKick) {
        survival.physicalTiredness = Math.min(100, survival.physicalTiredness + 3.5);
        hoveredObj.onKick();
        if (hoveredObj.gathered) {
          hoveredObj = null;
          lastPromptKey = '';
          callbacksRef.current.onPromptChange(null);
        }
        syncVitalHudDom();
        pushSurvivalSnapshot();
        return;
      }
      if (hoveredObj.kickable) {
        _euler.set(player.pitch, player.yaw, 0, 'YXZ');
        _lookDir.set(0, 0, -1).applyEuler(_euler);
        _lookDir.y = 0.28;
        _lookDir.normalize();
        const force = 9.5 / Math.sqrt(hoveredObj.mass);
        hoveredObj.vel.addScaledVector(_lookDir, force);
        hoveredObj.angVel.set(
          (Math.random() - 0.5) * 9,
          (Math.random() - 0.5) * 9,
          (Math.random() - 0.5) * 9
        );
        hoveredObj.resting = false;
        sound.playImpact(1.2);
        soundscape.engine.emitEvent({
          type: 'object.impact',
          origin: 'player',
          simulationTimestamp: simClockMs,
          position: {
            x: hoveredObj.mesh.position.x,
            y: hoveredObj.mesh.position.y,
            z: hoveredObj.mesh.position.z,
          },
          intensity: 1.0,
          dedupeKey: `kickprop_${hoveredObj.name}_${Math.floor(elapsed * 5)}`,
          dedupeWindowMs: 120,
          payload: {
            material: hoveredObj.materialType ?? 'wood',
            breakable: Boolean(hoveredObj.breakable),
            broken: false,
          },
        });
      } else {
        sound.playImpact(0.8);
        soundscape.engine.emitEvent({
          type: 'object.impact',
          origin: 'player',
          simulationTimestamp: simClockMs,
          position: {
            x: hoveredObj.mesh.position.x,
            y: hoveredObj.mesh.position.y,
            z: hoveredObj.mesh.position.z,
          },
          intensity: 0.75,
          dedupeKey: `solid_${hoveredObj.name}_${Math.floor(elapsed * 5)}`,
          dedupeWindowMs: 120,
          payload: {
            material: hoveredObj.materialType ?? 'wood',
            breakable: false,
            broken: false,
          },
        });
        callbacksRef.current.onToast(t('toast.wontBudge', { name: getEntryName(hoveredObj) }));
      }
    }

    function handleInteractR(): void {
      if (hoveredObj) {
        if (hoveredObj.onTouch) hoveredObj.onTouch();
        else {
          callbacksRef.current.onToast(
            `${getEntryName(hoveredObj)}: ${getEntryDesc(hoveredObj)}`
          );
        }
        return;
      }
      if (hoveredDeadfall) {
        callbacksRef.current.onToast(t('toast.deadfallInspect'));
      }
    }

    function finishSleep(early: boolean): void {
      if (!sleepSession) return;
      const doneHrs = sleepSession.elapsedHours;
      sleepSession = null;
      callbacksRef.current.onPhaseChange('playing');
      const wakeStr = formatGameHour(weatherSky.timeOfDay);
      callbacksRef.current.onToast(
        early
          ? t('toast.wokeEarly', {
              time: wakeStr,
              hours: doneHrs.toFixed(1),
              energy: Math.round(survival.energy),
            })
          : t('toast.wokeNormal', {
              time: wakeStr,
              hours: doneHrs.toFixed(0),
              energy: Math.round(survival.energy),
            })
      );
      syncVitalHudDom();
      pushSurvivalSnapshot();
    }

    actionsRef.current = {
      startPlaying: (packingSelection: PackingSelection) => {
        sound.init();
        sound.resume();
        inventory = createInventoryFromPacking(packingSelection);
        survival = createInitialSurvivalState(computeInventoryWeightKg(inventory));
        discovery.reset();
        discovery.markAroundWorldPos(player.pos.x, player.pos.z, 1);
        fogOfWar.reset();
        fogOfWar.revealAt(player.pos.x, player.pos.z);
        lastFogRevealX = player.pos.x;
        lastFogRevealZ = player.pos.z;
        flashlightOn = false;
        flashlight.intensity = 0;
        uiModalOpen = false;
        sleepSession = null;
        seatedTent = null;
        collapseTimer = 0;
        lastBarHealth = -1;
        lastMinimapCanvas = null;
        lastMinimapFogVersion = -1;
        keysHeld.clear();
        keysJustPressed.clear();
        callbacksRef.current.onPhaseChange('playing');
        syncVitalHudDom();
        pushSurvivalSnapshot();
        window.requestAnimationFrame(() => {
          if (hudRefs.biomeEl.current) {
            const b = getBiomeInfo(player.pos.x, player.pos.z);
            hudRefs.biomeEl.current.textContent = getLocalizedBiomeLabel(b.id, b.label);
          }
          if (hudRefs.timeWeatherEl.current) {
            hudRefs.timeWeatherEl.current.textContent = `${formatGameHour(weatherSky.timeOfDay)} · ${getWeatherLabel(weatherSky.currentWeather)}`;
          }
          const mmCanvas = hudRefs.minimapCanvasEl.current;
          const navMode = getNavigationMode(inventory);
          if (mmCanvas && minimap && navMode !== 'none') {
            lastMinimapCanvas = mmCanvas;
            lastMinimapMode = navMode;
            lastMinimapYaw = player.yaw;
            lastMinimapFogVersion = fogOfWar.version;
            minimap.draw(mmCanvas, player.pos.x, player.pos.z, player.yaw, navMode);
            if (hudRefs.compassHeadingEl.current && (navMode === 'compass' || navMode === 'both')) {
              hudRefs.compassHeadingEl.current.textContent = formatCompassLabel(player.yaw);
            }
          }
        });
      },
      resumePlaying: () => {
        sound.init();
        sound.resume();
        uiModalOpen = false;
        keysHeld.clear();
        keysJustPressed.clear();
        callbacksRef.current.onPhaseChange('playing');
      },
      restartWorld: (packingSelection?: PackingSelection) => {
        player.pos.set(spawnX, getTerrainHeight(spawnX, spawnZ), spawnZ);
        player.vel.set(0, 0, 0);
        player.yaw = 0.05;
        player.pitch = -0.04;
        player.currentEye = player.eyeHeight;
        if (player.carrying) dropCarried(0);
        inventory = createInventoryFromPacking(
          packingSelection ?? initialPackingRef.current ?? createDefaultPackingSelection()
        );
        survival = createInitialSurvivalState(computeInventoryWeightKg(inventory));
        discovery.reset();
        discovery.markAroundWorldPos(player.pos.x, player.pos.z, 1);
        fogOfWar.reset();
        fogOfWar.revealAt(player.pos.x, player.pos.z);
        lastFogRevealX = player.pos.x;
        lastFogRevealZ = player.pos.z;
        flashlightOn = false;
        flashlight.intensity = 0;
        uiModalOpen = false;
        sleepSession = null;
        seatedTent = null;
        collapseTimer = 0;
        lastBarHealth = -1;
        lastMinimapCanvas = null;
        lastMinimapFogVersion = -1;
        totalDistanceMoved = 0;
        playerExertion = 0;
        prevOnGround = true;
        keysHeld.clear();
        keysJustPressed.clear();
        sound.resume();
        callbacksRef.current.onPhaseChange('playing');
        syncVitalHudDom();
        pushSurvivalSnapshot();
      },
      cycleWeather: () => {
        const w = weatherSky.cycleWeather();
        lastObservedWeather = w;
        perfLogger.recordEvent(`keyWeather->${w}`, performance.now());
        callbacksRef.current.onToast(t('toast.weatherChanged', { weather: getWeatherLabel(w) }));
        pushSurvivalSnapshot();
      },
      advanceTime: () => {
        weatherSky.advanceTime(2);
        perfLogger.recordEvent(`keyTime->${weatherSky.timeOfDay.toFixed(1)}h`, performance.now());
        callbacksRef.current.onToast(t('toast.timeAdvanced'));
        pushSurvivalSnapshot();
      },
      toggleFlashlight: () => {
        if (!hasFlashlight(inventory)) {
          callbacksRef.current.onToast(t('toast.noFlashlight'));
          return;
        }
        if (!flashlightOn && inventory.flashlightBattery <= 0.5) {
          callbacksRef.current.onToast(t('toast.batteryDead'));
          return;
        }
        flashlightOn = !flashlightOn;
        flashlight.intensity = flashlightOn ? 3.5 : 0;
        perfLogger.recordEvent(`flashlight->${flashlightOn ? 'on' : 'off'}`, performance.now());
        sound.playImpact(0.3);
      },
      toggleMute: () => {
        isMuted = !isMuted;
        sound.setMuted(isMuted);
        return isMuted;
      },
      setResolutionScale: (scale: number | null) => {
        manualResolutionScale = scale !== null ? clampResolutionScale(scale) : null;
        dprStepIdx = 0;
        drsLowFpsStreak = 0;
        drsHighFpsStreak = 0;
        const nextDpr =
          manualResolutionScale !== null
            ? manualResolutionScale
            : computeAutoTopDpr(qualityGovernor.getProfile());
        if (Math.abs(nextDpr - currentDpr) > 0.001) {
          currentDpr = nextDpr;
          const td0 = performance.now();
          renderer.setPixelRatio(currentDpr);
          weatherSky.setPixelRatio(currentDpr);
          const resizeMs = performance.now() - td0;
          if (resizeMs > drsMsWindow) drsMsWindow = resizeMs;
          renderer.domElement.dataset.pixelRatio = currentDpr.toFixed(2);
          perfLogger.recordEvent(
            `res->${currentDpr.toFixed(2)}x${manualResolutionScale === null ? '(auto)' : ''}`,
            td0
          );
        }
      },
      setQualityMode: (mode: QualityMode) => {
        const prevMode = qualityGovernor.getMode();
        const transition = qualityGovernor.setMode(mode);
        const profile = qualityGovernor.getProfile();
        if (transition || prevMode !== mode) {
          applyQualityProfileToScene(profile, true);
          perfLogger.recordEvent(
            `qualityMode->${mode}(${profile.name})`,
            performance.now()
          );
        }
      },
      setUiModalOpen: (open: boolean) => {
        uiModalOpen = open;
        if (open) {
          keysHeld.clear();
          keysJustPressed.clear();
          mouseDragging = false;
          if (document.pointerLockElement) document.exitPointerLock?.();
          pushSurvivalSnapshot();
        }
      },
      setDiagnosticsOpen: (open: boolean) => {
        diagnosticsOpen = open;
        if (open) {
          if (document.pointerLockElement) document.exitPointerLock?.();
          mouseDragging = false;
        }
      },
      getSoundscapeDiagnostics: () => soundscape.engine.getDiagnosticsSnapshot(),
      triggerSoundscapeEvent: (type: string, intensity = 1) => {
        sound.init();
        sound.resume();
        soundscape.engine.emitEvent({
          type,
          origin: 'player',
          simulationTimestamp: simClockMs,
          position: { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z },
          intensity,
          payload: { material: 'wood', source: 'diagnostics' },
        });
      },
      auditionSoundscapeSound: (soundId: string) => {
        sound.init();
        sound.resume();
        return soundscape.engine.auditionSound(soundId);
      },
      setSoundscapeBusVolume: (busId: string, vol: number) => {
        soundscape.engine.setBusVolume(busId, vol);
      },
      setSoundscapeBusMuted: (busId: string, muted: boolean) => {
        soundscape.engine.setBusMuted(busId, muted);
      },
      setSoundscapeMusicEnabled: (enabled: boolean) => {
        soundscape.engine.setMusicEnabled(enabled);
      },
      setSoundscapeMusicVolume: (vol: number) => {
        soundscape.engine.setMusicVolume(vol);
      },
      reloadSoundscapeConfigJson: (json: string) => {
        return soundscape.engine.reloadConfigFromJson(json);
      },
      getSoundscapeConfigJson: () => {
        return JSON.stringify(soundscape.engine.getRawConfig(), null, 2);
      },
      eatItem: (itemId: ItemId) => {
        const res = eatFoodItem(survival, inventory, itemId);
        if (res.ok) {
          sound.playEatCrunch();
          if (res.poisoned) vomitLurchTimer = 0.6;
        }
        callbacksRef.current.onToast(res.message);
        syncVitalHudDom();
        pushSurvivalSnapshot();
      },
      drinkBottle: (uid: string) => {
        const res = drinkFromBottle(survival, inventory, uid);
        if (res.ok) {
          sound.playDrinkSip();
          if (res.poisoned) vomitLurchTimer = 0.7;
        }
        callbacksRef.current.onToast(res.message);
        syncVitalHudDom();
        pushSurvivalSnapshot();
      },
      loadBattery: () => {
        const res = loadFlashlightBattery(inventory);
        if (res.ok) sound.playImpact(0.35);
        callbacksRef.current.onToast(res.message);
        pushSurvivalSnapshot();
      },
      dropItem: (itemId: ItemId) => {
        if (removeStackItem(inventory, itemId, 1)) {
          if (itemId === 'flashlight' && !hasFlashlight(inventory) && flashlightOn) {
            flashlightOn = false;
            flashlight.intensity = 0;
          }
          survival.backpackWeightKg = computeInventoryWeightKg(inventory);
          lastMinimapCanvas = null;
          callbacksRef.current.onToast(t('toast.droppedItem', { name: getItemName(itemId) }));
          syncVitalHudDom();
          pushSurvivalSnapshot();
        }
      },
      dropBottleByUid: (uid: string) => {
        if (dropBottle(inventory, uid)) {
          survival.backpackWeightKg = computeInventoryWeightKg(inventory);
          callbacksRef.current.onToast(t('toast.droppedBottle'));
          syncVitalHudDom();
          pushSurvivalSnapshot();
        }
      },
      igniteCampfire: (campfireId: string) => {
        const res = tryIgniteCampfire(inventory, weatherSky.currentWeather, survival.wetness);
        sound.playFireIgnite(res.ok);
        if (res.ok && propsCtx) {
          propsCtx.setCampfireLit(campfireId, true);
        }
        callbacksRef.current.onToast(res.message);
        pushSurvivalSnapshot();
        return propsCtx ? propsCtx.getCampfireInfo(campfireId) : null;
      },
      bankCampfire: (campfireId: string) => {
        if (propsCtx) {
          propsCtx.setCampfireLit(campfireId, false);
        }
        sound.playImpact(0.45);
        callbacksRef.current.onToast(t('toast.bankedFire'));
        pushSurvivalSnapshot();
        return propsCtx ? propsCtx.getCampfireInfo(campfireId) : null;
      },
      placeCampfireFromWood: () => {
        if (!propsCtx) return null;
        const woodHave = inventory.stacks.firewood ?? 0;
        if (woodHave < CAMPFIRE_WOOD_COST) {
          callbacksRef.current.onToast(
            t('toast.needWood', { cost: CAMPFIRE_WOOD_COST, have: woodHave })
          );
          return null;
        }
        const fx = player.pos.x - Math.sin(player.yaw) * 2.3;
        const fz = player.pos.z - Math.cos(player.yaw) * 2.3;
        const placed = propsCtx.placePlayerCampfire(fx, fz);
        if (!placed.ok || !placed.campfire) {
          callbacksRef.current.onToast(placed.message);
          return null;
        }
        removeStackItem(inventory, 'firewood', CAMPFIRE_WOOD_COST);
        survival.backpackWeightKg = computeInventoryWeightKg(inventory);
        callbacksRef.current.onToast(placed.message);
        syncVitalHudDom();
        pushSurvivalSnapshot();
        return placed.campfire;
      },
      pitchTent: () => {
        if (!propsCtx) return null;
        if (!hasTent(inventory)) {
          callbacksRef.current.onToast(t('toast.noTent'));
          return null;
        }
        const tx = player.pos.x - Math.sin(player.yaw) * 3.85;
        const tz = player.pos.z - Math.cos(player.yaw) * 3.85;
        // Orient tent entrance facing toward the player at a natural 3/4 angle
        const tentYaw = player.yaw + 0.42;
        const placed = propsCtx.placePlayerTent(tx, tz, tentYaw);
        if (!placed.ok || !placed.tent) {
          callbacksRef.current.onToast(placed.message);
          return null;
        }
        removeStackItem(inventory, 'tent', 1);
        survival.backpackWeightKg = computeInventoryWeightKg(inventory);
        callbacksRef.current.onToast(placed.message);
        syncVitalHudDom();
        pushSurvivalSnapshot();
        return placed.tent;
      },
      sitInTent: (tentId?: string) => {
        const list = propsCtx?.getTents() ?? [];
        const target = tentId ? list.find((tt) => tt.id === tentId) : list[0];
        if (!target) return false;
        enterTentSeat(target);
        return true;
      },
      standUpFromTent: () => {
        exitTentSeat(false);
      },
      openSleepForSeatedTent: () => {
        if (!seatedTent) return;
        const tt = seatedTent;
        uiModalOpen = true;
        keysHeld.clear();
        if (document.pointerLockElement) document.exitPointerLock?.();
        pushSurvivalSnapshot();
        callbacksRef.current.onOpenSleepModal({
          kind: 'tent',
          label: t('prop.tentSpotLabel'),
          x: tt.x,
          y: tt.y + 0.15,
          z: tt.z,
          shelter: 'tent',
          tentId: tt.id,
        });
      },
      toggleWearItem: (itemId: ItemId) => {
        if (itemId === 'rain_jacket' && !hasRainJacket(inventory)) {
          callbacksRef.current.onToast(t('toast.noRainJacket'));
          return;
        }
        const nowWorn = toggleWearClothing(inventory, itemId);
        if (nowWorn === null) return;
        sound.init();
        sound.resume();
        sound.playFabricRustle(nowWorn);
        callbacksRef.current.onToast(
          nowWorn ? t('toast.woreRainJacket') : t('toast.tookOffRainJacket')
        );
        syncVitalHudDom();
        pushSurvivalSnapshot();
      },
      sleepInSleepingBag: () => {
        if (!hasSleepingBag(inventory)) {
          callbacksRef.current.onToast(t('toast.noSleepingBag'));
          return;
        }
        const groundY = getTerrainHeight(player.pos.x, player.pos.z);
        if (groundY <= SWAMP_WATER_Y + 0.08) {
          callbacksRef.current.onToast(t('toast.cannotSleepInWater'));
          return;
        }
        const envNow = propsCtx?.getEnvironmentStateAt(player.pos.x, player.pos.z);
        uiModalOpen = true;
        keysHeld.clear();
        if (document.pointerLockElement) document.exitPointerLock?.();
        pushSurvivalSnapshot();
        callbacksRef.current.onOpenSleepModal({
          kind: 'sleeping_bag',
          label: t('prop.sleepingBagSpotLabel'),
          x: player.pos.x,
          y: groundY + 0.12,
          z: player.pos.z,
          shelter: envNow?.shelter ?? 'outdoor',
        });
      },
      cookAtCampfire: (recipe: 'seared_steak' | 'roasted_mushrooms') => {
        const res = cookCampfireRecipe(inventory, recipe);
        if (res.ok) {
          sound.playCookSizzle();
          survival.backpackWeightKg = computeInventoryWeightKg(inventory);
        }
        callbacksRef.current.onToast(res.message);
        pushSurvivalSnapshot();
      },
      boilBottle: (uid: string) => {
        const res = boilBottleAtCampfire(inventory, uid);
        if (res.ok) sound.playCookSizzle();
        callbacksRef.current.onToast(res.message);
        pushSurvivalSnapshot();
      },
      startSleep: (spot: SleepSpotInfo, hours: number) => {
        if (document.pointerLockElement) document.exitPointerLock?.();
        keysHeld.clear();
        keysJustPressed.clear();
        uiModalOpen = false;
        if (seatedTent && spot.kind !== 'tent') {
          exitTentSeat(true);
        }
        const clampedHrs = THREE.MathUtils.clamp(Math.round(hours), 1, 10);
        const envNow = propsCtx?.getEnvironmentStateAt(spot.x, spot.z);
        const fireFactor =
          spot.kind === 'campfire' && spot.campfireId && propsCtx?.getCampfireInfo(spot.campfireId)?.lit
            ? 0.95
            : envNow?.nearLitCampfireFactor ?? 0;
        sleepSession = {
          spot,
          totalHours: clampedHrs,
          elapsedHours: 0,
          realDurationSec: Math.max(5.2, clampedHrs * 1.0),
          orbitAngle: Math.atan2(player.pos.x - spot.x, player.pos.z - spot.z),
          nearFireFactor: fireFactor,
        };
        callbacksRef.current.onPhaseChange('sleeping');
        pushSurvivalSnapshot();
      },
      wakeEarly: () => {
        finishSleep(true);
      },
      renderFullMap: (canvas: HTMLCanvasElement, zoom: number, panX: number, panZ: number) => {
        if (!minimap) return;
        const navMode = getNavigationMode(inventory);
        const campfires = propsCtx
          ? propsCtx.getCampfires().map((c) => ({ x: c.x, z: c.z, lit: c.lit }))
          : [];
        const tents = propsCtx ? propsCtx.getTents().map((tt) => ({ x: tt.x, z: tt.z })) : [];
        minimap.drawFullMap(canvas, {
          playerX: player.pos.x,
          playerZ: player.pos.z,
          playerYaw: player.yaw,
          mode: navMode,
          zoom,
          panX,
          panZ,
          campfires,
          tents,
          bogLabel: t('fullMap.bogLabel'),
        });
      },
    };

    // Lightweight dev/test helper (never shown in UI) for deterministic verification of sleep & collapse flows
    (
      window as unknown as {
        __metsavaikusDebug?: {
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
          setHourForTest: (hour: number) => void;
          triggerLethalCollapse: (cause?: string) => void;
          setVitalsForTest: (patch: Partial<PlayerSurvivalState>) => void;
          getSoundscapeDiagnostics: () => DiagnosticsSnapshot;
          triggerSoundscapeEvent: (type: string, intensity?: number) => void;
          auditionSoundscapeSound: (soundId: string) => boolean;
          reloadSoundscapeConfigJson: (json: string) => {
            ok: boolean;
            issues: ValidationIssue[];
            diffSummary?: string;
          };
          exportSoundscapeSnapshot: () => PersistedSoundscapeState;
          importSoundscapeSnapshot: (snap: PersistedSoundscapeState) => void;
        };
      }
    ).__metsavaikusDebug = {
      getState: () => ({
        survival: { ...survival },
        inventory: cloneInventory(inventory),
        navigationMode: getNavigationMode(inventory),
        phase: phaseRef.current,
        hour: weatherSky.timeOfDay,
        exploredPercent: fogOfWar.getExploredPercent(),
        fogVersion: fogOfWar.version,
        seatedInTent: seatedTent !== null,
        wearingRainJacket: isWearingRainJacket(inventory),
      }),
      movePlayerForTest: (x: number, z: number) => {
        const cx = THREE.MathUtils.clamp(x, -WORLD_HALF + 20, WORLD_HALF - 20);
        const cz = THREE.MathUtils.clamp(z, -WORLD_HALF + 20, WORLD_HALF - 20);
        player.pos.set(cx, getTerrainHeight(cx, cz), cz);
        discovery.markAroundWorldPos(cx, cz, 1);
        fogOfWar.revealAt(cx, cz);
        lastFogRevealX = cx;
        lastFogRevealZ = cz;
        const mmCanvas = hudRefs.minimapCanvasEl.current;
        const navMode = getNavigationMode(inventory);
        if (mmCanvas && minimap && navMode !== 'none') {
          lastMinimapFogVersion = fogOfWar.version;
          lastMinimapX = cx;
          lastMinimapZ = cz;
          minimap.draw(mmCanvas, cx, cz, player.yaw, navMode);
        }
        pushSurvivalSnapshot();
        return {
          x: cx,
          z: cz,
          exploredPercent: fogOfWar.getExploredPercent(),
          fogVersion: fogOfWar.version,
        };
      },
      openPrimaryCampfire: () => {
        const info = propsCtx?.getCampfireInfo('fire_v0');
        if (info) {
          uiModalOpen = true;
          callbacksRef.current.onOpenCampfireModal(info);
        }
      },
      openCampfireById: (id: string) => {
        const info = propsCtx?.getCampfireInfo(id);
        if (info) {
          uiModalOpen = true;
          callbacksRef.current.onOpenCampfireModal(info);
        }
      },
      kickNearestStump: () => {
        if (!propsCtx) return { broken: false, woodPiecesNear: 0 };
        const stumps = propsCtx.getBreakableStumps();
        if (stumps.length === 0) return { broken: false, woodPiecesNear: 0 };
        let nearest = stumps[0];
        let bestSq = Infinity;
        for (const s of stumps) {
          const dSq = (s.x - player.pos.x) ** 2 + (s.z - player.pos.z) ** 2;
          if (dSq < bestSq) {
            bestSq = dSq;
            nearest = s;
          }
        }
        // Position player facing the stump cleanly for visual inspection
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
        updateInteractionHover();
        handleInteractF();
        return {
          broken: !!nearest.entry.gathered,
          woodPiecesNear: propsCtx.getPickupItems().length,
        };
      },
      kickNearestDeadfallReal: () => {
        if (!vegetation || !propsCtx) {
          return { hoveredTitle: null, broken: false, woodPiecesNear: 0 };
        }
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
        updateInteractionHover();
        const hoveredTitle = hoveredDeadfall ? 'Fallen Log (Lamav palk)' : hoveredObj?.name ?? null;
        handleInteractF();
        return {
          hoveredTitle,
          broken: log.broken,
          woodPiecesNear: propsCtx.getPickupItems().length,
        };
      },
      pickNearestBirchFirewoodReal: () => {
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
        updateInteractionHover();
        const hoveredTitle = hoveredObj?.name ?? null;
        const before = inventory.stacks.firewood ?? 0;
        handleInteractE();
        const after = inventory.stacks.firewood ?? 0;
        return {
          hoveredTitle,
          picked: after > before,
          totalWood: after,
          packKg: survival.backpackWeightKg,
        };
      },
      gatherNearbyWood: (maxCount = 3) => {
        if (!propsCtx) return { collected: 0, totalWood: 0, packKg: survival.backpackWeightKg };
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
        survival.backpackWeightKg = computeInventoryWeightKg(inventory);
        syncVitalHudDom();
        pushSurvivalSnapshot();
        return {
          collected,
          totalWood: inventory.stacks.firewood ?? 0,
          packKg: survival.backpackWeightKg,
        };
      },
      placeCampfire: () => {
        return actionsRef.current?.placeCampfireFromWood() ?? null;
      },
      pitchTentForTest: () => {
        return actionsRef.current?.pitchTent() ?? null;
      },
      openTentSleepForTest: () => {
        const list = propsCtx?.getTents() ?? [];
        if (list.length === 0) return false;
        const tt = list[0];
        uiModalOpen = true;
        keysHeld.clear();
        if (document.pointerLockElement) document.exitPointerLock?.();
        pushSurvivalSnapshot();
        callbacksRef.current.onOpenSleepModal({
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
        return actionsRef.current?.sitInTent() ?? false;
      },
      standUpFromTentForTest: () => {
        actionsRef.current?.standUpFromTent();
      },
      packUpTentForTest: () => {
        const list = propsCtx?.getTents() ?? [];
        if (list.length === 0 || !propsCtx) return false;
        const tt = list[0];
        if (seatedTent?.id === tt.id) exitTentSeat(true);
        if (!propsCtx.packUpPlayerTent(tt.id)) return false;
        addItemToInventory(inventory, 'tent', 1);
        survival.backpackWeightKg = computeInventoryWeightKg(inventory);
        callbacksRef.current.onToast(t('prop.tentPackedUp'));
        syncVitalHudDom();
        pushSurvivalSnapshot();
        return true;
      },
      toggleRainJacketForTest: () => {
        actionsRef.current?.toggleWearItem('rain_jacket');
        return isWearingRainJacket(inventory);
      },
      triggerSpatialSoundForTest: (kind: SpatialClipKind) => {
        sound.init();
        sound.resume();
        const angle = Math.PI * 0.25;
        const dist = kind === 'insect' ? 2.4 : kind === 'cricket' ? 8.0 : 12.0;
        const dy = kind === 'bird' ? 5.0 : kind === 'cricket' ? -1.1 : 0.0;
        return sound.triggerSpatialClip(
          kind,
          camera.position.x + Math.cos(angle) * dist,
          camera.position.y + dy,
          camera.position.z + Math.sin(angle) * dist,
          1.0,
          {
            biome: getBiomeInfo(player.pos.x, player.pos.z).id,
            weather: weatherSky.currentWeather,
            hourOfDay: weatherSky.timeOfDay,
          }
        );
      },
      getSpatialAudioStats: () => sound.getSpatialAmbienceStats(),
      setWeatherForTest: (w: WeatherId) => {
        weatherSky.setWeather(w, true);
        lastObservedWeather = w;
        pushSurvivalSnapshot();
      },
      setHourForTest: (hour: number) => {
        weatherSky.timeOfDay = ((hour % 24) + 24) % 24;
        pushSurvivalSnapshot();
      },
      triggerLethalCollapse: (cause = 'Fatal Valge kärbseseen (Amatoxin)') => {
        survival.health = 0;
        survival.deathCause = cause;
        survival.deathFactors = ['Empty stomach', 'Hypothermia (34.4°C)'];
        beginCollapse();
      },
      setVitalsForTest: (patch) => {
        Object.assign(survival, patch);
        syncVitalHudDom();
        pushSurvivalSnapshot();
      },
      getSoundscapeDiagnostics: () => soundscape.engine.getDiagnosticsSnapshot(),
      triggerSoundscapeEvent: (type: string, intensity = 1) => {
        sound.init();
        sound.resume();
        soundscape.engine.emitEvent({
          type,
          origin: 'player',
          simulationTimestamp: simClockMs,
          position: { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z },
          intensity,
          payload: { material: 'wood', source: 'debug' },
        });
      },
      auditionSoundscapeSound: (soundId: string) => {
        sound.init();
        sound.resume();
        return soundscape.engine.auditionSound(soundId);
      },
      reloadSoundscapeConfigJson: (json: string) => soundscape.engine.reloadConfigFromJson(json),
      exportSoundscapeSnapshot: () => soundscape.engine.exportSnapshot(),
      importSoundscapeSnapshot: (snap: PersistedSoundscapeState) => {
        soundscape.engine.importSnapshot(snap);
      },
    };

    let lastPointerLockExitAt = 0;

    const onPointerLockChange = () => {
      const wasLocked = pointerLocked;
      pointerLocked = document.pointerLockElement === renderer.domElement;
      if (wasLocked && !pointerLocked) {
        lastPointerLockExitAt = performance.now();
      }
    };

    const onPointerLockError = () => {
      pointerLocked = document.pointerLockElement === renderer.domElement;
      lastPointerLockExitAt = performance.now();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (phaseRef.current !== 'playing' || uiModalOpen || diagnosticsOpen) return;
      if (e.target !== renderer.domElement) return;
      sound.init();
      mouseDragging = true;
      safeRequestPointerLock(
        renderer.domElement,
        performance.now(),
        lastPointerLockExitAt,
        pointerLocked,
        () => {
          lastPointerLockExitAt = performance.now();
        }
      );
    };

    const onMouseUp = () => {
      mouseDragging = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (phaseRef.current !== 'playing' || uiModalOpen) return;
      if (!pointerLocked && !mouseDragging) return;
      const { dx, dy } = clampMouseLookDelta(e.movementX, e.movementY);
      if (dx === 0 && dy === 0) return;
      const sens = 0.0022;
      player.yaw -= dx * sens;
      if (seatedTent) {
        const rel = THREE.MathUtils.clamp(player.yaw - seatedBaseYaw, -1.48, 1.48);
        player.yaw = seatedBaseYaw + rel;
        player.pitch = THREE.MathUtils.clamp(player.pitch - dy * sens, -0.46, 0.52);
      } else {
        player.pitch = THREE.MathUtils.clamp(
          player.pitch - dy * sens,
          -Math.PI * 0.48,
          Math.PI * 0.48
        );
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (isEditingText && code !== 'F9' && code !== 'Escape') {
        return;
      }

      if (phaseRef.current === 'title' || phaseRef.current === 'packing') {
        return;
      }
      if (
        phaseRef.current === 'sleeping' ||
        phaseRef.current === 'collapsing' ||
        phaseRef.current === 'collapsed'
      ) {
        return;
      }

      if (code === 'F9') {
        if (phaseRef.current === 'playing' || phaseRef.current === 'paused') {
          e.preventDefault();
          if (document.pointerLockElement) document.exitPointerLock?.();
          keysHeld.clear();
          keysJustPressed.clear();
          mouseDragging = false;
          callbacksRef.current.onToggleDiagnostics?.();
        }
        return;
      }

      if (code === 'Tab' || code === 'KeyB') {
        if (phaseRef.current === 'playing') {
          e.preventDefault();
          callbacksRef.current.onToggleBackpack();
        }
        return;
      }

      if (code === 'KeyM') {
        if (phaseRef.current === 'playing') {
          e.preventDefault();
          callbacksRef.current.onToggleFullMap();
        }
        return;
      }

      if (code === 'KeyP' || (code === 'Escape' && !pointerLocked)) {
        if (code === 'Escape' && diagnosticsOpen && !uiModalOpen) {
          return;
        }
        e.preventDefault();
        if (uiModalOpen) {
          callbacksRef.current.onCloseModals();
          return;
        }
        if (phaseRef.current === 'playing') {
          if (document.pointerLockElement) document.exitPointerLock?.();
          sound.suspend();
          keysHeld.clear();
          callbacksRef.current.onPhaseChange('paused');
        } else if (phaseRef.current === 'paused') {
          actionsRef.current?.resumePlaying();
        }
        return;
      }

      if (phaseRef.current !== 'playing' || uiModalOpen) return;

      if (!keysHeld.has(code)) {
        keysJustPressed.add(code);
      }
      keysHeld.add(code);

      if (code === 'KeyL') actionsRef.current?.toggleFlashlight();
      if (code === 'KeyJ') actionsRef.current?.toggleWearItem('rain_jacket');
      if (code === 'KeyT') actionsRef.current?.advanceTime();
      if (code === 'KeyY') actionsRef.current?.cycleWeather();

      if (seatedTent) {
        if (code === 'KeyE') {
          actionsRef.current?.openSleepForSeatedTent();
        } else if (
          code === 'Space' ||
          code === 'KeyW' ||
          code === 'KeyA' ||
          code === 'KeyS' ||
          code === 'KeyD'
        ) {
          exitTentSeat(false);
        }
        return;
      }

      if (code === 'KeyE') handleInteractE();
      if (code === 'KeyF') handleInteractF();
      if (code === 'KeyR') handleInteractR();
      if (code === 'KeyG') actionsRef.current?.placeCampfireFromWood();
      if (code === 'KeyH') actionsRef.current?.pitchTent();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysHeld.delete(e.code);
    };

    const clearInputs = () => {
      keysHeld.clear();
      keysJustPressed.clear();
      mouseDragging = false;
    };

    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      dprSteps = computeAdaptiveDprSteps(
        w,
        h,
        window.devicePixelRatio || 1,
        isSoftwareGl,
        isLowPowerGpu
      );
      dprStepIdx = Math.min(dprStepIdx, dprSteps.length - 1);
      currentDpr = manualResolutionScale !== null ? manualResolutionScale : dprSteps[dprStepIdx];
      renderer.setPixelRatio(currentDpr);
      weatherSky.setPixelRatio(currentDpr);
      renderer.domElement.dataset.pixelRatio = currentDpr.toFixed(2);
      callbacksRef.current.onDisplayMetrics?.({
        autoDpr: dprSteps[0],
        viewportW: w,
        viewportH: h,
      });
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onPointerLockError);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearInputs);
    document.addEventListener('visibilitychange', clearInputs);
    window.addEventListener('resize', onResize);

    function updatePlayer(dt: number): { locomotion: LocomotionState; jumped: boolean } {
      if (seatedTent) {
        if (!uiModalOpen) {
          if (keysHeld.has('ArrowLeft')) player.yaw += 1.5 * dt;
          if (keysHeld.has('ArrowRight')) player.yaw -= 1.5 * dt;
          const rel = THREE.MathUtils.clamp(player.yaw - seatedBaseYaw, -1.48, 1.48);
          player.yaw = seatedBaseYaw + rel;
          if (keysHeld.has('ArrowUp')) {
            player.pitch = THREE.MathUtils.clamp(player.pitch + 1.1 * dt, -0.46, 0.52);
          }
          if (keysHeld.has('ArrowDown')) {
            player.pitch = THREE.MathUtils.clamp(player.pitch - 1.1 * dt, -0.46, 0.52);
          }
        }
        keysJustPressed.clear();
        canRefillBogWater = false;
        seatedBlend = Math.min(1, seatedBlend + dt * 4.5);
        const ease = seatedBlend * seatedBlend * (3 - 2 * seatedBlend);
        const breathY = Math.sin(elapsed * 1.45) * 0.008;
        camera.position.lerpVectors(seatedStartPos, seatedCamPos, ease);
        camera.position.y += breathY;
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        camera.updateMatrixWorld();
        return { locomotion: 'idle', jumped: false };
      }

      if (uiModalOpen) {
        camera.position.set(player.pos.x, player.pos.y + player.currentEye, player.pos.z);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        camera.updateMatrixWorld();
        return { locomotion: 'idle', jumped: false };
      }

      if (keysHeld.has('ArrowLeft')) player.yaw += 1.7 * dt;
      if (keysHeld.has('ArrowRight')) player.yaw -= 1.7 * dt;
      if (keysHeld.has('ArrowUp')) {
        player.pitch = THREE.MathUtils.clamp(player.pitch + 1.2 * dt, -Math.PI * 0.48, Math.PI * 0.48);
      }
      if (keysHeld.has('ArrowDown')) {
        player.pitch = THREE.MathUtils.clamp(player.pitch - 1.2 * dt, -Math.PI * 0.48, Math.PI * 0.48);
      }

      const crouching = keysHeld.has('KeyC');
      const canSprint = survival.physicalTiredness < 94 && survival.energy > 5;
      const wantRun =
        (keysHeld.has('ShiftLeft') || keysHeld.has('ShiftRight')) && !crouching && canSprint;

      _fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      _move.set(0, 0, 0);

      if (keysHeld.has('KeyW')) _move.add(_fwd);
      if (keysHeld.has('KeyS')) _move.sub(_fwd);
      if (keysHeld.has('KeyD')) _move.add(_right);
      if (keysHeld.has('KeyA')) _move.sub(_right);

      const moving = _move.lengthSq() > 0.01;
      if (moving) _move.normalize();

      const onBoardwalk = isOnBoardwalk(player.pos.x, player.pos.z);
      const rawGroundY = getTerrainHeight(player.pos.x, player.pos.z);
      const waterDepth = onBoardwalk ? 0 : Math.max(0, SWAMP_WATER_Y - rawGroundY);
      const isSwimming = waterDepth >= 0.28;
      const isSwampWading =
        !isSwimming &&
        !onBoardwalk &&
        (waterDepth > 0.02 || getSwampFactor(player.pos.x, player.pos.z) > 0.35);

      canRefillBogWater = !onBoardwalk && (waterDepth > 0.03 || isSwimming);

      const burden = computeWeightBurden(survival.backpackWeightKg, survival.waterStomachLoadL);
      const tirednessSpeedMult =
        survival.physicalTiredness > 72
          ? THREE.MathUtils.lerp(1.0, 0.68, (survival.physicalTiredness - 72) / 28)
          : 1.0;

      let speed = crouching ? 2.5 : wantRun && moving && !isSwimming ? 8.0 : 4.6;
      if (isSwimming) speed = 2.45;
      else if (isSwampWading) speed *= 0.64;
      speed *= burden.moveSpeedMultiplier * tirednessSpeedMult;

      let locomotion: LocomotionState = 'idle';
      if (isSwimming) locomotion = 'swim';
      else if (moving) {
        if (isSwampWading) locomotion = 'swamp';
        else if (wantRun) locomotion = 'run';
        else locomotion = 'walk';
      }

      const prevX = player.pos.x;
      const prevZ = player.pos.z;
      player.pos.addScaledVector(_move, speed * dt);
      resolvePlayerCollisions(player.pos);

      const frameMovedM = Math.hypot(player.pos.x - prevX, player.pos.z - prevZ);
      totalDistanceMoved += frameMovedM;
      playerSpeedMps = dt > 0.0001 ? frameMovedM / dt : 0;
      lastIsMoving = moving;
      lastWantRun = wantRun;
      lastCrouching = crouching;
      lastIsSwimming = isSwimming;
      lastIsSwampWading = isSwampWading;
      lastOnBoardwalk = onBoardwalk;
      lastWaterDepthM = waterDepth;

      const targetExertion = isSwimming
        ? 0.75
        : moving && wantRun
          ? survival.physicalTiredness > 60
            ? 0.94
            : 0.68
          : moving
            ? 0.25 + (survival.physicalTiredness / 100) * 0.28
            : Math.max(0.05, (survival.physicalTiredness / 100) * 0.35 + ((100 - survival.energy) / 100) * 0.22);
      const exRate = targetExertion > playerExertion ? dt * 0.45 : dt * 0.22;
      playerExertion += (targetExertion - playerExertion) * Math.min(1, exRate);

      let jumped = false;
      if (keysJustPressed.has('Space') && player.onGround && !crouching && !isSwimming) {
        player.vel.y = 6.4;
        player.onGround = false;
        jumped = true;
        soundscape.engine.emitEvent({
          type: 'player.jump',
          origin: 'player',
          simulationTimestamp: simClockMs,
          position: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
          intensity: 0.8,
          payload: { surface: onBoardwalk ? 'wooden_boardwalk' : 'forest_floor' },
        });
      }
      keysJustPressed.clear();

      const preLandVelY = player.vel.y;
      player.vel.y -= 16.5 * dt;
      player.pos.y += player.vel.y * dt;

      const newGroundY = getSurfaceHeightAt(player.pos.x, player.pos.z);
      const minFloorY = isSwimming
        ? Math.max(newGroundY, SWAMP_WATER_Y - 0.56)
        : Math.max(newGroundY, SWAMP_WATER_Y - 0.36);
      if (player.pos.y <= minFloorY) {
        player.pos.y = minFloorY;
        player.vel.y = 0;
        player.onGround = true;
        if (!prevOnGround && preLandVelY < -2.4) {
          soundscape.engine.emitEvent({
            type: 'player.land',
            origin: 'player',
            simulationTimestamp: simClockMs,
            position: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
            intensity: Math.min(1.2, Math.abs(preLandVelY) / 8),
            payload: {
              impactSpeed: Math.abs(preLandVelY),
              surface: onBoardwalk ? 'wooden_boardwalk' : waterDepth > 0.02 ? 'water' : 'forest_floor',
            },
          });
        }
      } else {
        player.onGround = false;
      }
      prevOnGround = player.onGround;

      const targetEye = isSwimming
        ? 1.12
        : crouching
          ? player.crouchEyeHeight
          : player.eyeHeight;
      player.currentEye = THREE.MathUtils.lerp(player.currentEye, targetEye, Math.min(1, dt * 10));

      let bobY = 0;
      if (isSwimming) {
        player.bobPhase += dt * (moving ? 5.6 : 2.6);
        bobY = Math.sin(player.bobPhase) * 0.055;
        if (moving) {
          player.stepTimer += dt * 1.4;
          if (player.stepTimer >= 1) {
            player.stepTimer = 0;
            if (!sound.getSoundscapeEngine()) sound.playFootstep('water');
          }
        }
      } else if (moving && player.onGround) {
        const freq = wantRun ? 13 : 8.5;
        player.bobPhase += dt * freq;
        bobY = Math.sin(player.bobPhase) * (wantRun ? 0.065 : 0.038);
        player.stepTimer += dt * (wantRun ? 2.4 : 1.55);
        if (player.stepTimer >= 1) {
          player.stepTimer = 0;
          let surf: FootstepSurface = 'grass';
          if (onBoardwalk) surf = 'wood';
          else if (waterDepth > 0.02) surf = 'water';
          else if (distToRoadDetail(player.pos.x, player.pos.z).dist < 3.3) surf = 'road';
          if (!sound.getSoundscapeEngine()) sound.playFootstep(surf);
        }
      }

      // Subtle hypothermia shiver & vomiting camera lurch
      let shiverX = 0;
      let shiverY = 0;
      if (survival.bodyTempC < 35.4) {
        const amp = THREE.MathUtils.clamp((35.4 - survival.bodyTempC) / 1.8, 0.15, 1) * 0.011;
        shiverX = Math.sin(elapsed * 29.0) * amp;
        shiverY = Math.cos(elapsed * 33.0) * amp * 0.8;
      }
      let vomitPitchOffset = 0;
      if (vomitLurchTimer > 0) {
        vomitLurchTimer = Math.max(0, vomitLurchTimer - dt);
        vomitPitchOffset = -Math.sin(vomitLurchTimer * Math.PI) * 0.24;
      }

      camera.position.set(
        player.pos.x + shiverX,
        player.pos.y + player.currentEye + bobY + shiverY,
        player.pos.z
      );
      camera.rotation.set(
        THREE.MathUtils.clamp(player.pitch + vomitPitchOffset, -Math.PI * 0.48, Math.PI * 0.48),
        player.yaw,
        0,
        'YXZ'
      );
      camera.updateMatrixWorld();

      if (player.carrying) {
        _euler.set(player.pitch, player.yaw, 0, 'YXZ');
        _lookDir.set(0, 0, -1).applyEuler(_euler);
        _holdPos.copy(camera.position).addScaledVector(_lookDir, 1.15);
        _holdPos.y -= 0.22;
        const carried = player.carrying;
        const holdOffset = _holdPos.clone().sub(camera.position);
        const safeHold = camera.position.clone();
        if (propsCtx) moveSphere(safeHold, holdOffset, 1, carried.radius, propsCtx.boxColliders, 0);
        if (carried.mesh.position.distanceToSquared(safeHold) > 0.000001) propsCtx?.invalidateLightShadows();
        carried.mesh.position.copy(safeHold);
      }

      return { locomotion, jumped };
    }

    function updateDynamicObjects(dt: number): void {
      if (!propsCtx) return;
      for (let i = 0; i < propsCtx.dynamicObjects.length; i++) {
        const obj = propsCtx.dynamicObjects[i];
        if (obj === player.carrying || obj.resting) continue;

        propsCtx.invalidateLightShadows();
        obj.vel.y -= 15.0 * dt;
        moveSphere(obj.mesh.position, obj.vel, dt, obj.radius, propsCtx.boxColliders);
        obj.mesh.rotation.x += obj.angVel.x * dt;
        obj.mesh.rotation.y += obj.angVel.y * dt;
        obj.mesh.rotation.z += obj.angVel.z * dt;

        const floorY =
          Math.max(
            getSurfaceHeightAt(obj.mesh.position.x, obj.mesh.position.z),
            SWAMP_WATER_Y - 0.15
          ) + obj.onGroundYOffset;
        if (obj.mesh.position.y <= floorY) {
          if (obj.vel.y < -2.2) {
            sound.playImpact(Math.min(1.0, Math.abs(obj.vel.y) / 8));
            soundscape.engine.emitEvent({
              type: 'object.impact',
              origin: 'environment',
              simulationTimestamp: simClockMs,
              position: {
                x: obj.mesh.position.x,
                y: obj.mesh.position.y,
                z: obj.mesh.position.z,
              },
              intensity: Math.min(1.0, Math.abs(obj.vel.y) / 8),
              dedupeKey: `dyn_impact_${obj.name}_${Math.floor(elapsed * 8)}`,
              dedupeWindowMs: 120,
              payload: {
                material: obj.materialType ?? 'wood',
                breakable: Boolean(obj.breakable),
                broken: false,
              },
            });
          }
          obj.mesh.position.y = floorY;
          obj.vel.y = Math.abs(obj.vel.y) > 1.8 ? -obj.vel.y * 0.3 : 0;
          obj.vel.x *= Math.pow(0.05, dt);
          obj.vel.z *= Math.pow(0.05, dt);
          obj.angVel.multiplyScalar(Math.pow(0.08, dt));

          if (obj.vel.lengthSq() < 0.01 && obj.angVel.lengthSq() < 0.02) {
            obj.vel.set(0, 0, 0);
            obj.angVel.set(0, 0, 0);
            obj.resting = true;
          }
        }
      }
    }

    const nearbyInteractives: THREE.Object3D[] = [];

    function updateInteractionHover(): void {
      if (!propsCtx || phaseRef.current !== 'playing' || uiModalOpen || player.carrying || seatedTent) {
        if (hoveredObj !== null || hoveredDeadfall !== null || lastPromptKey !== '') {
          hoveredObj = null;
          hoveredDeadfall = null;
          lastPromptKey = '';
          callbacksRef.current.onPromptChange(null);
        }
        return;
      }

      nearbyInteractives.length = 0;
      const camX = camera.position.x;
      const camZ = camera.position.z;
      const maxRangeSq = 6.5 * 6.5;
      const items = propsCtx.interactiveObjects;
      for (let i = 0; i < items.length; i++) {
        const entry = items[i];
        if (entry.gathered || !entry.mesh.visible) continue;
        const me = entry.mesh.matrixWorld.elements;
        const dx = me[12] - camX;
        const dz = me[14] - camZ;
        if (dx * dx + dz * dz <= maxRangeSq) {
          nearbyInteractives.push(entry.mesh);
        }
      }

      let nextHover: InteractiveEntry | null = null;
      if (nearbyInteractives.length > 0) {
        raycaster.setFromCamera(_rayCenter, camera);
        const hits = raycaster.intersectObjects(nearbyInteractives, true);
        nextHover =
          hits.length > 0 ? (hits[0].object.userData.interactive as InteractiveEntry) : null;
      }
      hoveredObj = nextHover && !nextHover.gathered ? nextHover : null;

      hoveredDeadfall = null;
      if (!hoveredObj && vegetation) {
        camera.getWorldDirection(_camForward);
        hoveredDeadfall = vegetation.findTargetDeadfall(camera.position, _camForward, 4.8);
      }

      let nextPrompt: InteractionPromptData | null = null;
      if (hoveredObj) {
        nextPrompt = buildInteractionPrompt(
          {
            name: getEntryName(hoveredObj),
            desc: getEntryDesc(hoveredObj),
            gatherable: hoveredObj.gatherable,
            carryable: hoveredObj.carryable,
            kickable: hoveredObj.kickable,
            breakable: hoveredObj.breakable,
            pickupLabel: getEntryPickupLabel(hoveredObj),
            secondaryActionLabel: getEntrySecondaryActionLabel(hoveredObj),
            hasUse: !!hoveredObj.onUse,
          },
          false
        );
      } else if (hoveredDeadfall) {
        nextPrompt = {
          title: t('prompt.fallenLogTitle'),
          actionsText:
            hoveredDeadfall.kicksRemaining <= 1
              ? t('prompt.fallenLogShatter')
              : t('prompt.fallenLogBreak'),
        };
      } else if (canRefillBogWater && inventory.bottles.length > 0) {
        nextPrompt = {
          title: t('prompt.bogWaterTitle'),
          actionsText: t('prompt.bogWaterAction'),
        };
      }

      const key = nextPrompt ? `${nextPrompt.title}|${nextPrompt.actionsText}` : '';
      if (key !== lastPromptKey) {
        lastPromptKey = key;
        callbacksRef.current.onPromptChange(nextPrompt);
      }
    }

    function afterDraw(cb: () => void): void {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          isTimeoutFrame = true;
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          isTimeoutFrame = true;
          frameId = window.setTimeout(cb, 80);
        }
      };
      isTimeoutFrame = true;
      frameId = window.setTimeout(poll, 5);
    }

    let lastTime = performance.now();
    let elapsed = 0;
    let fpsEma = 60;
    let hudTimer = 0;
    let snapshotTimer = 0;
    let minimapTimer = 0;
    let diagResetTimer = 0;
    let prevTickCpuMs = 0;
    let lastMinimapCanvas: HTMLCanvasElement | null = null;
    let lastMinimapMode: NavigationMode = 'none';
    let lastMinimapYaw = 999;
    let lastMinimapX = 999999;
    let lastMinimapZ = 999999;
    let lastMinimapFogVersion = -1;
    let titleOrbit = 0;

    const perfSample: FramePerfSample = {
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
      isSoftwareGl,
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
      gpuRenderer,
      pixelRatio: currentDpr,
      backbufferPx: [0, 0],
      antialias: false,
      shadowUpdates: 0,
      fogCullDist: 225,
      culledInstances: 0,
      candidateInstances: 0,
      overlays: 'none',
      lowPowerGpu: isLowPowerGpu,
      programsDelta: 0,
      drsMs: 0,
    };
    let lastFogCullDist = 225;
    let shadowUpdatesWindow = 0;
    let lastProgramCount = 0;
    let programsDeltaWindow = 0;
    let drsMsWindow = 0;

    refreshQualitySceneNow = (profile: QualityProfile) => {
      snapQualityDistanceState(smoothedQuality, profile);
      camera.getWorldDirection(_camForward);
      const skyInfo = weatherSky.update(
        0,
        player.pos,
        scene,
        sound,
        hudRefs.flashEl.current,
        _camForward,
        2,
        'outdoor',
        profile.fogDensityScale
      );
      const swampHere = getSwampFactor(player.pos.x, player.pos.z);
      let targetFog = (0.0052 + swampHere * 0.0095) * profile.fogDensityScale;
      const w = weatherSky.currentWeather;
      if (w === 'mist') targetFog += 0.0135 * Math.min(1.04, profile.fogDensityScale);
      else if (w === 'rain') targetFog += 0.0085;
      else if (w === 'storm') targetFog += 0.014;
      if (scene.fog && 'density' in scene.fog) {
        (scene.fog as THREE.FogExp2).density = targetFog;
      }
      lastFogDensity = targetFog;
      const nextCullDist = computeFogCullDistance(
        targetFog,
        profile.minRenderDist,
        profile.maxRenderDist
      );
      lastFogCullDist = nextCullDist;
      renderer.domElement.dataset.fogCullDist = nextCullDist.toFixed(1);
      renderer.domElement.dataset.qualityGrassRing = String(profile.grassMaxRing);

      if (terrainMgr && vegetation) {
        terrainMgr.update(
          camera,
          chunkStats,
          nextCullDist,
          profile.terrainLod0Dist,
          profile.terrainLod1Dist
        );
        vegQualityOpts.lod0Dist = profile.treeLod0Dist;
        vegQualityOpts.lod1Dist = profile.treeLod1Dist;
        vegQualityOpts.bushDist = profile.bushDist;
        vegQualityOpts.understoryDist = profile.understoryDist;
        vegQualityOpts.boulderDist = profile.boulderDist;
        vegQualityOpts.bogDist = profile.bogDist;
        vegQualityOpts.grassMaxRing = profile.grassMaxRing;
        vegQualityOpts.grassRing1Step = profile.grassRing1Step;
        vegQualityOpts.grassRing2Step = profile.grassRing2Step;
        vegQualityOpts.grassRing3Step = profile.grassRing3Step;
        vegQualityOpts.grassRing4Step = profile.grassRing4Step;
        vegetation.update(
          terrainMgr.activeSlots,
          terrainMgr.chunkLods,
          terrainMgr.chunkSpheres,
          camera.position,
          elapsed,
          skyInfo.windStrength,
          vegStats,
          skyInfo.sunDir,
          skyInfo.sunColor,
          terrainMgr.frustumPlanes,
          _camForward,
          nextCullDist,
          vegQualityOpts
        );
        propsCtx?.updateDynamicProps(
          elapsed,
          camera.position.x,
          camera.position.z,
          skyInfo,
          terrainMgr.frustumPlanes,
          nextCullDist,
          weatherSky.currentWeather,
          profile.mushroomDist
        );
        renderer.domElement.dataset.visibleChunks = String(chunkStats.visibleChunks);
        renderer.domElement.dataset.treesRendered = String(vegStats.treesRendered);
        renderer.domElement.dataset.foliageRendered = String(vegStats.foliageRendered);
      }
    };

    function tick(): void {
      if (disposed) return;
      const now = performance.now();
      const rawDtMs = Math.max(0.1, now - lastTime);
      const rawDt = rawDtMs / 1000;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));
      lastTime = now;
      elapsed += dt;

      fpsEma = smoothFps(fpsEma, rawDt);
      hudTimer += rawDt;
      snapshotTimer += rawDt;
      minimapTimer += rawDt;
      diagResetTimer += rawDt;

      const curPhase = phaseRef.current;

      let playerMs = 0;
      let propsMs = 0;
      let skyMs = 0;
      let terrainMs = 0;
      let vegMs = 0;
      let minimapMs = 0;
      let skyTimeLabel = '';
      let skyWindStrength = 0;
      let skyTimeScale = 1;
      let jumpedThisFrame = false;

      if (curPhase === 'title' || curPhase === 'packing') {
        titleOrbit += dt * 0.08;
        const camX = spawnX + Math.sin(titleOrbit) * 18;
        const camZ = 14 + Math.cos(titleOrbit) * 7;
        const camY = getTerrainHeight(camX, camZ) + 6.5;
        camera.position.set(camX, camY, camZ);
        camera.lookAt(spawnX + 2, getTerrainHeight(spawnX + 2, -22) + 2.2, -22);
        camera.updateMatrixWorld();
      } else if (curPhase === 'playing') {
        const t0 = performance.now();
        const moveRes = updatePlayer(dt);
        lastLocomotion = moveRes.locomotion;
        jumpedThisFrame = moveRes.jumped;
        const t1 = performance.now();
        updateDynamicObjects(dt);
        updateInteractionHover();
        const t2 = performance.now();
        playerMs = t1 - t0;
        propsMs = t2 - t1;
      } else if (curPhase === 'sleeping' && sleepSession) {
        // Fast-time sleeping animation with gentle camera pan on location!
        const wallDt = Math.min(0.25, Math.max(0.001, rawDt));
        const hrsPerRealSec = sleepSession.totalHours / sleepSession.realDurationSec;
        const hrsStep = Math.min(
          sleepSession.totalHours - sleepSession.elapsedHours,
          hrsPerRealSec * wallDt
        );
        sleepSession.elapsedHours += hrsStep;
        skyTimeScale = Math.max(1, hrsStep / Math.max(0.001, dt) / BASE_GAME_HOURS_PER_SEC);

        const clothing = computeClothingBonuses(inventory);
        const sleepGear = computeSleepGearBonuses(inventory);
        stepSleepSlice(
          survival,
          hrsStep,
          weatherSky.timeOfDay,
          weatherSky.currentWeather,
          lastWindStrength,
          sleepSession.spot.shelter,
          sleepSession.nearFireFactor,
          clothing.warmthBonusC,
          sleepGear.warmthBonusC
        );

        sleepSession.orbitAngle += wallDt * (sleepSession.spot.kind === 'bed' ? 0.32 : 0.42);
        const rad =
          sleepSession.spot.kind === 'bed'
            ? 1.55
            : sleepSession.spot.kind === 'tent'
              ? 3.7
              : sleepSession.spot.kind === 'sleeping_bag'
                ? 2.8
                : 3.9;
        const camHeight =
          sleepSession.spot.kind === 'bed'
            ? 1.15
            : sleepSession.spot.kind === 'tent'
              ? 1.85
              : 2.15;
        const cx = sleepSession.spot.x + Math.sin(sleepSession.orbitAngle) * rad;
        const cz = sleepSession.spot.z + Math.cos(sleepSession.orbitAngle) * rad;
        const cy = sleepSession.spot.y + camHeight;
        camera.position.set(cx, cy, cz);
        camera.lookAt(sleepSession.spot.x, sleepSession.spot.y + 0.45, sleepSession.spot.z);
        camera.updateMatrixWorld();

        if (sleepSession.elapsedHours >= sleepSession.totalHours - 0.001) {
          finishSleep(false);
        }
      } else if (curPhase === 'collapsing') {
        collapseTimer = Math.max(0, (now - collapseStartMs) / 1000);
        const p = Math.min(1, collapseTimer / COLLAPSE_DURATION_SEC);
        const ease = p * p * (3 - 2 * p);
        const droopEye = THREE.MathUtils.lerp(collapseStartEye, 0.52, ease);
        const droopPitch = THREE.MathUtils.lerp(collapseStartPitch, -0.52, ease);
        camera.position.set(player.pos.x, player.pos.y + droopEye, player.pos.z);
        camera.rotation.set(droopPitch, player.yaw, ease * 0.28, 'YXZ');
        camera.updateMatrixWorld();
        if (snapshotTimer >= 0.04) {
          snapshotTimer = 0;
          pushSurvivalSnapshot();
        }
        if (p >= 1) {
          phaseRef.current = 'collapsed';
          callbacksRef.current.onPhaseChange('collapsed');
          pushSurvivalSnapshot();
        }
      } else {
        camera.position.set(player.pos.x, player.pos.y + player.currentEye, player.pos.z);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        camera.updateMatrixWorld();
      }

      if (curPhase !== 'paused' && curPhase !== 'collapsed') {
        camera.getWorldDirection(_camForward);

        const curEnvState =
          curPhase === 'playing'
            ? (propsCtx?.getEnvironmentStateAt(player.pos.x, player.pos.z) ?? {
                shelter: 'outdoor' as const,
                shelterLabel: null,
                nearLitCampfireFactor: 0,
                nearestCampfire: null,
              })
            : null;
        const effectiveShelter: AmbientShelter =
          curPhase === 'sleeping' && sleepSession
            ? sleepSession.spot.shelter
            : seatedTent
              ? 'tent'
              : curEnvState?.shelter ?? 'outdoor';

        const qualityProfile = qualityGovernor.getProfile();
        slewQualityDistanceState(smoothedQuality, qualityProfile, dt);
        const tp0 = performance.now();
        const skyInfo = weatherSky.update(
          dt,
          player.pos,
          scene,
          sound,
          hudRefs.flashEl.current,
          _camForward,
          skyTimeScale,
          effectiveShelter,
          smoothedQuality.fogDensityScale
        );
        const tp1 = performance.now();
        skyMs = tp1 - tp0;
        skyTimeLabel = skyInfo.timeLabel;
        skyWindStrength = skyInfo.windStrength;
        lastWindStrength = skyInfo.windStrength;
        lastWeatherIntensity =
          weatherSky.currentWeather === 'storm'
            ? 1.0
            : weatherSky.currentWeather === 'rain'
              ? 0.68
              : weatherSky.currentWeather === 'mist'
                ? 0.2
                : 0;
        lastFogDensity = skyInfo.fogDensity;
        lastSunDirY = skyInfo.sunDir.y;

        const curHour = weatherSky.timeOfDay;
        let hourDelta = curHour - prevSkyHour;
        if (hourDelta < -12) {
          hourDelta += 24;
          simDay += 1;
        } else if (hourDelta < 0) {
          hourDelta = 0;
        }
        prevSkyHour = curHour;
        simClockMs += Math.max(dt * 1000, hourDelta * 3_600_000);

        // Dynamic 3D spatial ambient soundscape + full SoundscapeEngine step
        if (curPhase === 'playing' || curPhase === 'sleeping') {
          const curBiomeId = getBiomeInfo(player.pos.x, player.pos.z).id;
          sound.updateSpatialAmbience(dt, {
            listenerX: camera.position.x,
            listenerY: camera.position.y,
            listenerZ: camera.position.z,
            forwardX: _camForward.x,
            forwardY: _camForward.y,
            forwardZ: _camForward.z,
            biome: curBiomeId,
            weather: weatherSky.currentWeather,
            hourOfDay: weatherSky.timeOfDay,
            shelter: effectiveShelter,
          });

          const structAcoustics: StructureAcousticsInfo = propsCtx
            ? propsCtx.getStructureAcousticsAt(player.pos.x, player.pos.z)
            : {
                id: null,
                quality: 'outdoor',
                profileId: 'outdoor',
                enclosure: 0,
                roofCoverage: 0,
                hasRoof: false,
                roofMaterial: 'none',
                wallMaterial: 'none',
                condition: 'intact',
                portalOpenness: 1,
                abandoned: false,
                floorMaterial: 'forest_floor',
                nearestShelterDistanceM: 999,
              };
          if (seatedTent) {
            structAcoustics.id = seatedTent.id;
            structAcoustics.quality = 'tent';
            structAcoustics.profileId = 'tent';
            structAcoustics.enclosure = 0.72;
            structAcoustics.roofCoverage = 1.0;
            structAcoustics.hasRoof = true;
            structAcoustics.portalOpenness = 0.35;
          }

          const campfirePos = curEnvState?.nearestCampfire
            ? {
                x: curEnvState.nearestCampfire.x,
                y: curEnvState.nearestCampfire.y,
                z: curEnvState.nearestCampfire.z,
              }
            : undefined;

          soundscape.engine.step(
            dt,
            buildWorldContextFromSimulator({
              simulationTimeMs: simClockMs,
              timeOfDayHours: weatherSky.timeOfDay,
              simulationDay: simDay,
              timeAcceleration: skyTimeScale,
              sunDirY: lastSunDirY,
              weather: weatherSky.currentWeather,
              windStrength: skyInfo.windStrength,
              fogDensity: lastFogDensity,
              listenerPos: {
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z,
              },
              listenerForward: {
                x: _camForward.x,
                y: _camForward.y,
                z: _camForward.z,
              },
              listenerVelocity: {
                x: player.vel.x,
                y: player.vel.y,
                z: player.vel.z,
              },
              isMoving: lastIsMoving && curPhase === 'playing' && !uiModalOpen,
              wantRun: lastWantRun,
              crouching: lastCrouching,
              isSwimming: lastIsSwimming,
              isSwampWading: lastIsSwampWading,
              onBoardwalk: lastOnBoardwalk,
              waterDepthM: lastWaterDepthM,
              speedMps: curPhase === 'playing' ? playerSpeedMps : 0,
              stamina: survival.energy,
              exertion: playerExertion,
              tiredness: survival.physicalTiredness,
              wetness: survival.wetness,
              wearingRainJacket: isWearingRainJacket(inventory),
              seatedInTent: seatedTent !== null,
              distanceMovedTotal: totalDistanceMoved,
              nearLitCampfireFactor: curEnvState?.nearLitCampfireFactor ?? 0,
              nearestCampfirePos: campfirePos,
              structure: structAcoustics,
              muted: isMuted,
            })
          );

          if (elapsed - lastSnapshotSaveSec >= 12) {
            lastSnapshotSaveSec = elapsed;
            saveSoundscapeSnapshotToStorage(worldSeed, soundscape.engine);
          }
          void lastWeatherIntensity;
        }

        // Continuous survival physiology tick during active gameplay
        if (curPhase === 'playing' && !uiModalOpen && curEnvState) {
          lastShelterLabel = seatedTent ? t('prop.tentSpotLabel') : curEnvState.shelterLabel;
          lastNearFire = curEnvState.nearLitCampfireFactor;

          stepSurvivalTick(
            survival,
            inventory,
            {
              locomotion: lastLocomotion,
              jumpedThisFrame,
              weather: weatherSky.currentWeather,
              windStrength: skyInfo.windStrength,
              hourOfDay: weatherSky.timeOfDay,
              shelter: seatedTent ? 'tent' : curEnvState.shelter,
              nearLitCampfireFactor: curEnvState.nearLitCampfireFactor,
              flashlightActive: flashlightOn,
              seatedInTent: seatedTent !== null,
            },
            dt,
            dt * BASE_GAME_HOURS_PER_SEC,
            tickEvents
          );

          if (tickEvents.flashlightDepleted && flashlightOn) {
            flashlightOn = false;
            flashlight.intensity = 0;
            callbacksRef.current.onToast(t('toast.batteryDied'));
          }
          if (tickEvents.vomited) {
            vomitLurchTimer = 1.0;
            sound.playVomitRetch();
            callbacksRef.current.onToast(
              t('toast.vomited', { source: tickEvents.vomitSource ?? 'poison' })
            );
            pushSurvivalSnapshot();
          }
          if (tickEvents.died) {
            beginCollapse();
          }
          syncVitalHudDom();
        }

        const maxRenderDist = computeFogCullDistance(
          skyInfo.fogDensity,
          smoothedQuality.minRenderDist,
          smoothedQuality.maxRenderDist
        );
        lastFogCullDist = maxRenderDist;

        if (weatherSky.currentWeather !== lastObservedWeather) {
          lastObservedWeather = weatherSky.currentWeather;
          perfLogger.recordEvent(`autoWeather->${lastObservedWeather}`, tp1);
        }

        if (terrainMgr && vegetation) {
          terrainMgr.setLightingState(skyInfo.dayFactor, elapsed);
          terrainMgr.update(
            camera,
            chunkStats,
            maxRenderDist,
            smoothedQuality.terrainLod0Dist,
            smoothedQuality.terrainLod1Dist
          );
          const tp2 = performance.now();
          terrainMs = tp2 - tp1;

          vegQualityOpts.lod0Dist = smoothedQuality.treeLod0Dist;
          vegQualityOpts.lod1Dist = smoothedQuality.treeLod1Dist;
          vegQualityOpts.bushDist = smoothedQuality.bushDist;
          vegQualityOpts.understoryDist = smoothedQuality.understoryDist;
          vegQualityOpts.boulderDist = smoothedQuality.boulderDist;
          vegQualityOpts.bogDist = smoothedQuality.bogDist;
          vegQualityOpts.grassMaxRing = qualityProfile.grassMaxRing;
          vegQualityOpts.grassRing1Step = qualityProfile.grassRing1Step;
          vegQualityOpts.grassRing2Step = qualityProfile.grassRing2Step;
          vegQualityOpts.grassRing3Step = qualityProfile.grassRing3Step;
          vegQualityOpts.grassRing4Step = qualityProfile.grassRing4Step;

          vegetation.update(
            terrainMgr.activeSlots,
            terrainMgr.chunkLods,
            terrainMgr.chunkSpheres,
            camera.position,
            elapsed,
            skyInfo.windStrength,
            vegStats,
            skyInfo.sunDir,
            skyInfo.sunColor,
            terrainMgr.frustumPlanes,
            _camForward,
            maxRenderDist,
            vegQualityOpts
          );
          const tp3 = performance.now();
          vegMs = tp3 - tp2;

          propsCtx?.updateDynamicProps(
            elapsed,
            camera.position.x,
            camera.position.z,
            skyInfo,
            terrainMgr.frustumPlanes,
            maxRenderDist,
            weatherSky.currentWeather,
            smoothedQuality.mushroomDist
          );
          const tp4 = performance.now();
          propsMs += tp4 - tp3;
        } else {
          propsCtx?.updateDynamicProps(
            elapsed,
            camera.position.x,
            camera.position.z,
            skyInfo,
            undefined,
            maxRenderDist,
            weatherSky.currentWeather,
            smoothedQuality.mushroomDist
          );
          propsMs += performance.now() - tp1;
        }

        if (propsCtx?.needsLightShadowUpdate()) renderer.shadowMap.needsUpdate = true;

        if (!isSoftwareGl && weatherSky.isSunCastingShadow) {
          shadowFrameSkip++;
          const movedSq =
            (player.pos.x - lastShadowX) * (player.pos.x - lastShadowX) +
            (player.pos.z - lastShadowZ) * (player.pos.z - lastShadowZ);
          const sunMoved = Math.abs(skyInfo.sunDir.y - lastShadowSunY) > 0.008;
          const moveThreshSq = qualityProfile.shadowMoveThreshSq;
          const minSkip = qualityProfile.shadowMinSkip;
          if ((movedSq > moveThreshSq || sunMoved) && shadowFrameSkip >= minSkip) {
            renderer.shadowMap.needsUpdate = true;
            shadowUpdatesWindow++;
            lastShadowX = player.pos.x;
            lastShadowZ = player.pos.z;
            lastShadowSunY = skyInfo.sunDir.y;
            shadowFrameSkip = 0;
          }
        }

        if (!isSoftwareGl && curPhase === 'playing' && manualResolutionScale === null) {
          drsCheckTimer += Math.min(0.5, rawDt);
          const drsInterval = isLowPowerGpu ? 2.0 : fpsEma < 22 ? 1.2 : 2.5;
          if (drsCheckTimer >= drsInterval) {
            drsCheckTimer = 0;
            const stepDownFps = isLowPowerGpu ? 34 : 38;
            const requiredLowChecks = isLowPowerGpu ? 2 : 1;
            const requiredHighChecks = isLowPowerGpu ? 3 : 2;
            const stepUpCooldownMs = isLowPowerGpu ? 45_000 : 8_000;

            if (fpsEma < stepDownFps && dprStepIdx < dprSteps.length - 1) {
              drsLowFpsStreak++;
              drsHighFpsStreak = 0;
              if (drsLowFpsStreak >= requiredLowChecks) {
                dprStepIdx++;
                currentDpr = dprSteps[dprStepIdx];
                drsLowFpsStreak = 0;
                lastDrsStepDownMs = now;
                const td0 = performance.now();
                renderer.setPixelRatio(currentDpr);
                weatherSky.setPixelRatio(currentDpr);
                const resizeMs = performance.now() - td0;
                if (resizeMs > drsMsWindow) drsMsWindow = resizeMs;
                perfLogger.recordEvent(`drs->${currentDpr.toFixed(2)}x`, now);
              }
            } else if (
              fpsEma > 57 &&
              dprStepIdx > 0 &&
              now - lastDrsStepDownMs >= stepUpCooldownMs
            ) {
              drsLowFpsStreak = 0;
              drsHighFpsStreak++;
              if (drsHighFpsStreak >= requiredHighChecks) {
                dprStepIdx--;
                currentDpr =
                  dprStepIdx === 0
                    ? computeAutoTopDpr(qualityGovernor.getProfile())
                    : dprSteps[dprStepIdx];
                drsHighFpsStreak = 0;
                const td0 = performance.now();
                renderer.setPixelRatio(currentDpr);
                weatherSky.setPixelRatio(currentDpr);
                const resizeMs = performance.now() - td0;
                if (resizeMs > drsMsWindow) drsMsWindow = resizeMs;
                perfLogger.recordEvent(`drs->${currentDpr.toFixed(2)}x`, now);
              }
            } else {
              drsLowFpsStreak = 0;
              drsHighFpsStreak = 0;
            }
          }
        }

        if (hudTimer >= 0.25) {
          hudTimer = 0;
          if (hudRefs.fpsEl.current) {
            hudRefs.fpsEl.current.textContent = formatFpsLabel(fpsEma);
          }
          if (hudRefs.biomeEl.current) {
            const b = getBiomeInfo(player.pos.x, player.pos.z);
            hudRefs.biomeEl.current.textContent = getLocalizedBiomeLabel(b.id, b.label);
          }
          if (hudRefs.timeWeatherEl.current) {
            hudRefs.timeWeatherEl.current.textContent = `${skyInfo.timeLabel} · ${getWeatherLabel(weatherSky.currentWeather)}`;
          }
          renderer.domElement.dataset.visibleChunks = String(chunkStats.visibleChunks);
          renderer.domElement.dataset.treesRendered = String(vegStats.treesRendered);
          renderer.domElement.dataset.foliageRendered = String(vegStats.foliageRendered);
          renderer.domElement.dataset.culledInstances = String(vegStats.culledInstances ?? 0);
          renderer.domElement.dataset.candidateInstances = String(vegStats.candidateInstances ?? 0);
          renderer.domElement.dataset.fogCullDist = maxRenderDist.toFixed(1);
          renderer.domElement.dataset.pixelRatio = currentDpr.toFixed(2);
          renderer.domElement.dataset.qualityTier = qualityProfile.name;
          renderer.domElement.dataset.qualityMode = String(qualityGovernor.getMode());
          renderer.domElement.dataset.drawCalls = String(renderer.info.render.calls);
          renderer.domElement.dataset.triangles = String(renderer.info.render.triangles);
          renderer.domElement.dataset.weather = weatherSky.currentWeather;
          renderer.domElement.dataset.windStrength = skyInfo.windStrength.toFixed(2);
          renderer.domElement.dataset.hour = String(Math.floor(weatherSky.timeOfDay));
          renderer.domElement.dataset.playerX = player.pos.x.toFixed(2);
          renderer.domElement.dataset.playerY = player.pos.y.toFixed(2);
          renderer.domElement.dataset.playerZ = player.pos.z.toFixed(2);
          renderer.domElement.dataset.heading = formatCompassLabel(player.yaw);
          renderer.domElement.dataset.navMode = getNavigationMode(inventory);

          const vc = worldToVirtualChunk(player.pos.x, player.pos.z);
          const cKey = `${vc.vcx},${vc.vcz}`;
          if (lastObservedChunkKey && cKey !== lastObservedChunkKey) {
            perfLogger.recordEvent(`chunk(${cKey})`, now);
            discovery.markAroundWorldPos(player.pos.x, player.pos.z, 1);
          }
          lastObservedChunkKey = cKey;
        }

        // Smooth continuous fog-of-war reveal whenever player moves >= 3.0m
        if (curPhase === 'playing') {
          const fdx = player.pos.x - lastFogRevealX;
          const fdz = player.pos.z - lastFogRevealZ;
          if (fdx * fdx + fdz * fdz >= 9.0) {
            lastFogRevealX = player.pos.x;
            lastFogRevealZ = player.pos.z;
            fogOfWar.revealAt(player.pos.x, player.pos.z);
          }
        }

        if (
          (curPhase === 'sleeping' && snapshotTimer >= 0.08) ||
          (curPhase === 'playing' && snapshotTimer >= 0.5)
        ) {
          snapshotTimer = 0;
          pushSurvivalSnapshot();
        }

        // Diegetic Navigation Canvas: only renders according to carried Compass / Paper Map!
        const navMode = getNavigationMode(inventory);
        const mmCanvas = hudRefs.minimapCanvasEl.current;
        if (mmCanvas && minimap && navMode !== 'none') {
          const needsYawRedraw = navMode === 'compass' || navMode === 'both';
          const needsPosRedraw = navMode === 'both';
          const needsFogRedraw =
            (navMode === 'map' || navMode === 'both') &&
            fogOfWar.version !== lastMinimapFogVersion;
          const posMoved =
            needsPosRedraw &&
            (Math.abs(player.pos.x - lastMinimapX) > 0.35 ||
              Math.abs(player.pos.z - lastMinimapZ) > 0.35);
          const mmChanged =
            mmCanvas !== lastMinimapCanvas ||
            navMode !== lastMinimapMode ||
            needsFogRedraw ||
            posMoved ||
            (needsYawRedraw && Math.abs(player.yaw - lastMinimapYaw) > 0.012);
          if (
            mmChanged &&
            (mmCanvas !== lastMinimapCanvas ||
              navMode !== lastMinimapMode ||
              needsFogRedraw ||
              minimapTimer >= 0.066)
          ) {
            const tm0 = performance.now();
            minimapTimer = 0;
            lastMinimapCanvas = mmCanvas;
            lastMinimapMode = navMode;
            lastMinimapYaw = player.yaw;
            lastMinimapX = player.pos.x;
            lastMinimapZ = player.pos.z;
            lastMinimapFogVersion = fogOfWar.version;
            minimap.draw(mmCanvas, player.pos.x, player.pos.z, player.yaw, navMode);
            if (hudRefs.compassHeadingEl.current && needsYawRedraw) {
              hudRefs.compassHeadingEl.current.textContent = formatCompassLabel(player.yaw);
            }
            minimapMs = performance.now() - tm0;
          }
        }
      }

      const tr0 = performance.now();
      renderer.render(scene, camera);
      const tr1 = performance.now();
      renderer.domElement.dataset.ready = 'true';
      renderer.domElement.dataset.drawCalls = String(renderer.info.render.calls);
      renderer.domElement.dataset.triangles = String(renderer.info.render.triangles);
      const renderMs = tr1 - tr0;
      const tickCpuMs = tr1 - now;
      const externalWaitMs = Math.max(0, rawDtMs - prevTickCpuMs);
      prevTickCpuMs = tickCpuMs;

      const qualityTransition = qualityGovernor.observe({
        nowMs: tr1,
        rawDtMs,
        fpsEma,
        fpsInstant: 1000 / Math.max(1, rawDtMs),
        frameCpuMs: tickCpuMs,
        isPlaying: curPhase === 'playing' && !uiModalOpen,
        isHidden: document.hidden,
      });
      if (qualityTransition) {
        const nextProfile = qualityGovernor.getProfile();
        applyQualityProfileToScene(nextProfile, false);
        perfLogger.recordEvent(
          `quality->${nextProfile.name}(${qualityTransition.reason})`,
          tr1
        );
      }

      if (curPhase === 'playing') {
        const fpsInstant = 1000 / rawDtMs;
        const isLowNow = fpsEma < 15 || fpsInstant < 15;
        const mightReport = isLowNow || fpsEma >= 22 || !hasLivePerfSample;
        if (mightReport) {
          const needDiag = isLowNow || !hasLivePerfSample;
          const tDiag = needDiag && terrainMgr ? terrainMgr.consumeDiagnostics() : null;
          const vDiag = needDiag && vegetation ? vegetation.consumeDiagnostics() : null;
          const vc = worldToVirtualChunk(player.pos.x, player.pos.z);

          perfSample.nowMs = tr1;
          perfSample.rawDtMs = rawDtMs;
          perfSample.fpsEma = fpsEma;
          perfSample.fpsInstant = fpsInstant;
          perfSample.playerMs = playerMs;
          perfSample.propsMs = propsMs;
          perfSample.skyMs = skyMs;
          perfSample.terrainMs = terrainMs;
          perfSample.vegMs = vegMs;
          perfSample.minimapMs = minimapMs;
          perfSample.renderMs = renderMs;
          perfSample.tickCpuMs = tickCpuMs;
          perfSample.externalWaitMs = externalWaitMs;
          perfSample.pos[0] = player.pos.x;
          perfSample.pos[1] = player.pos.y;
          perfSample.pos[2] = player.pos.z;
          perfSample.chunk[0] = vc.vcx;
          perfSample.chunk[1] = vc.vcz;
          perfSample.biome = getBiomeInfo(player.pos.x, player.pos.z).id;
          perfSample.heading = formatCompassLabel(player.yaw);
          perfSample.timeOfDay = skyTimeLabel;
          perfSample.weather = weatherSky.currentWeather;
          perfSample.wind = skyWindStrength;
          perfSample.flashlightOn = flashlightOn;
          perfSample.sunCastShadow = weatherSky.isSunCastingShadow;
          perfSample.calls = renderer.info.render.calls;
          perfSample.triangles = renderer.info.render.triangles;
          perfSample.points = renderer.info.render.points;
          perfSample.geometries = renderer.info.memory.geometries;
          perfSample.textures = renderer.info.memory.textures;
          const curProgs = renderer.info.programs ? renderer.info.programs.length : 0;
          if (lastProgramCount > 0 && curProgs > lastProgramCount) {
            programsDeltaWindow += curProgs - lastProgramCount;
          }
          lastProgramCount = curProgs;
          perfSample.programsDelta = programsDeltaWindow;
          perfSample.drsMs = drsMsWindow;
          perfSample.programs = curProgs;
          perfSample.visibleChunks = chunkStats.visibleChunks;
          perfSample.lodCounts[0] = chunkStats.lod0;
          perfSample.lodCounts[1] = chunkStats.lod1;
          perfSample.lodCounts[2] = chunkStats.lod2;
          perfSample.treesRendered = vegStats.treesRendered;
          perfSample.foliageRendered = vegStats.foliageRendered;
          perfSample.culledInstances = vegStats.culledInstances ?? 0;
          perfSample.candidateInstances = vegStats.candidateInstances ?? 0;
          perfSample.fogCullDist = lastFogCullDist;
          perfSample.pixelRatio = currentDpr;
          perfSample.backbufferPx![0] = renderer.domElement.width;
          perfSample.backbufferPx![1] = renderer.domElement.height;
          perfSample.shadowUpdates = shadowUpdatesWindow;
          perfSample.survival = {
            hp: Math.round(survival.health),
            en: Math.round(survival.energy),
            hyd: Math.round(survival.hydration),
            full: Math.round(survival.stomachFullness),
            tempC: Math.round(survival.bodyTempC * 10) / 10,
            wet: Math.round(survival.wetness),
            kg: survival.backpackWeightKg,
          };

          const activeOv: string[] = [];
          if (propsCtx?.isWaterVisible()) activeOv.push('water');
          if (propsCtx?.isMistVisible()) activeOv.push('mist');
          if (weatherSky.isSunbeamsVisible) activeOv.push('sunbeams');
          if (weatherSky.isRainVisible) activeOv.push('rain');
          perfSample.overlays = activeOv.length > 0 ? activeOv.join('+') : 'none';

          if (tDiag) {
            perfSample.terrainCacheSize = tDiag.cacheSize;
            perfSample.terrainBuilds += tDiag.geoBuilds;
            perfSample.terrainEvictions += tDiag.geoEvictions;
            perfSample.terrainRecenters += tDiag.recenters;
          }
          if (vDiag) {
            perfSample.foliageCacheSize = vDiag.chunkCacheSize;
            perfSample.foliageBakes += vDiag.chunkBakes;
            perfSample.foliageEvictions += vDiag.chunkEvictions;
            perfSample.foliageVisRebuilds += vDiag.visRebuilds;
            perfSample.grassRebuilds += vDiag.grassRebuilds;
            perfSample.grassCount = vDiag.grassCount;
            perfSample.colliderCells = vDiag.colliderCells;
          }

          const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
          perfSample.jsHeapMB = mem ? mem.usedJSHeapSize / (1024 * 1024) : null;
          hasLivePerfSample = true;

          const emitted = perfLogger.observe(perfSample, document.hidden);
          if (emitted) {
            perfSample.terrainBuilds = 0;
            perfSample.terrainEvictions = 0;
            perfSample.terrainRecenters = 0;
            perfSample.foliageBakes = 0;
            perfSample.foliageEvictions = 0;
            perfSample.foliageVisRebuilds = 0;
            perfSample.grassRebuilds = 0;
            shadowUpdatesWindow = 0;
            programsDeltaWindow = 0;
            drsMsWindow = 0;
          }
        }

        if (diagResetTimer >= 1.5 && fpsEma >= 18) {
          diagResetTimer = 0;
          const td = terrainMgr?.consumeDiagnostics();
          const vd = vegetation?.consumeDiagnostics();
          if (td) perfSample.terrainCacheSize = td.cacheSize;
          if (vd) {
            perfSample.foliageCacheSize = vd.chunkCacheSize;
            perfSample.grassCount = vd.grassCount;
            perfSample.colliderCells = vd.colliderCells;
          }
          perfSample.terrainBuilds = 0;
          perfSample.terrainEvictions = 0;
          perfSample.terrainRecenters = 0;
          perfSample.foliageBakes = 0;
          perfSample.foliageEvictions = 0;
          perfSample.foliageVisRebuilds = 0;
          perfSample.grassRebuilds = 0;
          shadowUpdatesWindow = 0;
          programsDeltaWindow = 0;
          drsMsWindow = 0;
        }
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        isTimeoutFrame = false;
        frameId = requestAnimationFrame(tick);
      }
    }

    void Promise.all([
      ComputeEngine.create(),
      createWorldTextures(Math.min(4, renderer.capabilities.getMaxAnisotropy())),
    ]).then(([engine, loadedTextures]) => {
      if (disposed) {
        loadedTextures.dispose();
        return;
      }
      computeEngine = engine;
      textures = loadedTextures;

      propsCtx = buildArchitectureAndProps(
        scene,
        loadedTextures,
        sound,
        (msg) => callbacksRef.current.onToast(msg),
        isSoftwareGl,
        {
          onOpenSleep: (spot) => {
            uiModalOpen = true;
            keysHeld.clear();
            if (document.pointerLockElement) document.exitPointerLock?.();
            pushSurvivalSnapshot();
            callbacksRef.current.onOpenSleepModal(spot);
          },
          onOpenCampfire: (campfire) => {
            uiModalOpen = true;
            keysHeld.clear();
            if (document.pointerLockElement) document.exitPointerLock?.();
            pushSurvivalSnapshot();
            callbacksRef.current.onOpenCampfireModal(campfire);
          },
          onPackUpTent: (tentId) => {
            if (seatedTent?.id === tentId) {
              exitTentSeat(true);
            }
            addItemToInventory(inventory, 'tent', 1);
            survival.backpackWeightKg = computeInventoryWeightKg(inventory);
            sound.playImpact(0.5);
            callbacksRef.current.onToast(t('prop.tentPackedUp'));
            syncVitalHudDom();
            pushSurvivalSnapshot();
          },
          onRefillWell: (source) => {
            const res = refillBottlesFromSource(inventory, source);
            survival.backpackWeightKg = computeInventoryWeightKg(inventory);
            callbacksRef.current.onToast(res.message);
            syncVitalHudDom();
            pushSurvivalSnapshot();
          },
          onLootCrate: (_crateId, label, loot) => {
            const names: string[] = [];
            for (const entry of loot) {
              addItemToInventory(inventory, entry.itemId, entry.qty);
              names.push(`${entry.qty}× ${getItemName(entry.itemId)}`);
            }
            survival.backpackWeightKg = computeInventoryWeightKg(inventory);
            callbacksRef.current.onToast(
              t('prop.lootedCrate', { label, items: names.join(', ') })
            );
            syncVitalHudDom();
            pushSurvivalSnapshot();
          },
          onDoorToggle: (info) => {
            soundscape.engine.emitEvent({
              type: info.open ? 'object.door.open' : 'object.door.close',
              origin: 'player',
              simulationTimestamp: simClockMs,
              position: { x: info.x, y: info.y, z: info.z },
              sourceEntityId: info.doorId,
              intensity: 0.9,
              dedupeKey: `door_${info.doorId}_${info.open ? 'o' : 'c'}`,
              dedupeWindowMs: 120,
              payload: {
                material: info.abandoned ? 'decrepit_wooden_floor' : 'wooden_floor',
                buildingId: info.buildingId,
                abandoned: info.abandoned,
              },
            });
          },
          onStumpKick: (info) => {
            const corrId = `stump_${Math.round(info.x)}_${Math.round(info.z)}_${Math.round(simClockMs)}`;
            soundscape.engine.emitEvent({
              type: 'player.kick',
              origin: 'player',
              simulationTimestamp: simClockMs,
              position: { x: info.x, y: info.y, z: info.z },
              intensity: info.broken ? 1.2 : 0.9,
              correlationId: corrId,
              dedupeKey: `kick_stump_${Math.floor(elapsed * 5)}`,
              dedupeWindowMs: 120,
              payload: { material: info.material, broken: info.broken },
            });
            soundscape.engine.emitEvent({
              type: info.broken ? 'object.break' : 'object.impact',
              origin: 'player',
              simulationTimestamp: simClockMs,
              position: { x: info.x, y: info.y, z: info.z },
              intensity: info.broken ? 1.2 : 0.9,
              correlationId: corrId,
              dedupeKey: `stump_act_${Math.floor(elapsed * 5)}`,
              dedupeWindowMs: 120,
              payload: { material: info.material, breakable: true, broken: info.broken },
            });
          },
        }
      );
      soundscape.spatialQuery.setBoxColliders(propsCtx.boxColliders);
      weatherSky.setShelterGeometry(propsCtx.shelters);
      propCircleColliders = propsCtx.circleColliders;
      const activeBp = getActiveBlueprint();
      minimap = createMinimapRenderer(activeBp, propsCtx.boardwalkZones, fogOfWar);

      const searchParams = new URLSearchParams(window.location.search);
      const viewParam = searchParams.get('view');
      const weatherParam = searchParams.get('weather') as WeatherId | null;
      if (
        weatherParam === 'clear' ||
        weatherParam === 'mist' ||
        weatherParam === 'rain' ||
        weatherParam === 'storm'
      ) {
        weatherSky.setWeather(weatherParam, true);
        lastObservedWeather = weatherParam;
      }
      if (viewParam === 'mushrooms' && propsCtx.heroMushroomPos) {
        const hx = propsCtx.heroMushroomPos.x;
        const hz = propsCtx.heroMushroomPos.z;
        const mx = hx + 0.12;
        const mz = hz + 1.08;
        player.pos.set(mx, getTerrainHeight(mx, mz), mz);
        player.yaw = 0.02;
        player.pitch = -0.58;
        player.currentEye = 0.78;
      } else if (viewParam === 'bog' && propsCtx.boardwalkZones.length > 0) {
        const bw = propsCtx.boardwalkZones[Math.floor(propsCtx.boardwalkZones.length * 0.28)];
        const bx = (bw.minX + bw.maxX) * 0.5;
        const bz = (bw.minZ + bw.maxZ) * 0.5;
        player.pos.set(bx, bw.y, bz);
        player.yaw = Math.atan2(-(activeBp.bogCenterX - bx), -(activeBp.bogCenterZ - bz));
        player.pitch = -0.14;
      }

      vegetation = new WorldVegetationSystem(loadedTextures, isSoftwareGl, isLowPowerGpu, propsCtx.shelters);
      vegetation.prewarmAround(player.pos.x, player.pos.z);
      scene.add(vegetation.group);

      terrainMgr = new TerrainChunkManager(
        engine,
        loadedTextures.groundDetail,
        loadedTextures.groundNormal,
        {
          forestTex: loadedTextures.terrainForestTex,
          meadowTex: loadedTextures.terrainMeadowTex,
          roadTex: loadedTextures.terrainRoadTex,
          mossTex: loadedTextures.mossCarpetTex,
        }
      );
      terrainMgr.prewarmAround(player.pos.x, player.pos.z);
      scene.add(terrainMgr.group);
      renderer.shadowMap.needsUpdate = true;

      renderer.domElement.dataset.wasmActive = String(engine.isWasmActive);

      if (!isSoftwareGl) {
        weatherSky.setShaderCompilePreview(true);
        vegetation.setShaderCompilePreview(true);
        renderer.compile(scene, camera);
        vegetation.setShaderCompilePreview(false);
        weatherSky.setShaderCompilePreview(false);
        lastProgramCount = renderer.info.programs ? renderer.info.programs.length : 0;
      }

      callbacksRef.current.onWorldReady({
        wasmActive: engine.isWasmActive,
        totalMushrooms: propsCtx.mushroomCountTotal,
      });
      syncVitalHudDom();
      pushSurvivalSnapshot();

      lastTime = performance.now();
      tick();
    });

    const unsubscribeLang = subscribeLanguage(() => {
      lastPromptKey = '';
      lastCondText = '';
      hudTimer = 1;
      if (hudRefs.biomeEl.current) {
        const b = getBiomeInfo(player.pos.x, player.pos.z);
        hudRefs.biomeEl.current.textContent = getLocalizedBiomeLabel(b.id, b.label);
      }
      if (hudRefs.timeWeatherEl.current) {
        hudRefs.timeWeatherEl.current.textContent = `${formatGameHour(weatherSky.timeOfDay)} · ${getWeatherLabel(weatherSky.currentWeather)}`;
      }
      syncVitalHudDom();
      updateInteractionHover();
      if (player.carrying) {
        callbacksRef.current.onCarryChange(
          t('hud.carrying', { name: getEntryName(player.carrying) })
        );
      }
      pushSurvivalSnapshot();
    });

    return () => {
      disposed = true;
      unsubscribeLang();
      if (isTimeoutFrame) window.clearTimeout(frameId);
      else cancelAnimationFrame(frameId);

      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('pointerlockerror', onPointerLockError);
      renderer.domElement.removeEventListener('webglcontextlost', onWebGlContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onWebGlContextRestored);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearInputs);
      document.removeEventListener('visibilitychange', clearInputs);
      window.removeEventListener('resize', onResize);

      terrainMgr?.dispose();
      vegetation?.dispose();
      weatherSky.dispose();
      propsCtx?.dispose();
      minimap?.dispose();
      textures?.dispose();
      envTarget?.dispose();
      saveSoundscapeSnapshotToStorage(worldSeed, soundscape.engine);
      sound.dispose();
      renderer.dispose();
      void computeEngine;

      if (renderer.domElement.parentNode === mountEl) {
        mountEl.removeChild(renderer.domElement);
      }
    };
  }, [worldSeed, actionsRef, hudRefs]);

  return (
    <div
      ref={mountRef}
      data-testid="world-canvas"
      className="fixed inset-0 w-full h-full overflow-hidden"
    />
  );
};
