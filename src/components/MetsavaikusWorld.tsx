import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  clampMouseLookDelta,
  formatFpsLabel,
  MushroomBasket,
  safeRequestPointerLock,
  smoothFps,
} from '../game/gameLogic';
import { computeFrameTiming } from '../game/frameTiming';
import {
  computeClothingBonuses,
  computeInventoryWeightKg,
  computeSleepGearBonuses,
  createDefaultPackingSelection,
  createInventoryFromPacking,
  getNavigationMode,
  InventoryState,
  isWearingRainJacket,
  PackingSelection,
} from '../game/itemCatalog';
import { consumeGameKeyDown } from '../game/keyboardInput';
import { FpsDropLogger } from '../game/perfLogger';
import { QualityMode, QualityProfile } from '../game/qualityGovernor';
import {
  createInitialSurvivalState,
  DiscoveryTracker,
  formatGameHour,
  PlayerSurvivalState,
  refreshInventoryBurden,
  stepSleepSlice,
  stepSurvivalTick,
  SurvivalTickEvents,
} from '../game/survivalEngine';
import {
  getLocalizedBiomeLabel,
  getWeatherLabel,
  subscribeLanguage,
  t,
} from '../i18n/i18n';
import {
  buildArchitectureAndProps,
  CircleCollider,
  StructureAcousticsInfo,
  WorldPropsContext,
} from '../world/architectureAndProps';
import {
  VegetationQualityOptions,
  VegetationStats,
  WorldVegetationSystem,
} from '../world/foliageFactory';
import { computeFogCullDistance } from '../world/forestFrustumCuller';
import {
  createMinimapRenderer,
  FogOfWarMap,
  formatCompassLabel,
  MinimapRenderer,
} from '../world/minimapMath';
import { createWorldTextures, WorldTextures } from '../world/proceduralTextures';
import {
  AmbientShelter,
  SoundEngine,
} from '../world/soundEngine';
import type { WebAudioHybridBackend } from '../soundscape/audioBackend';
import {
  createSimulatorSoundscape,
  loadSoundscapeSnapshotFromStorage,
  saveSoundscapeSnapshotToStorage,
} from '../world/soundscapeAdapter';
import {
  ChunkVisibilityStats,
  TerrainChunkManager,
} from '../world/terrainChunkManager';
import {
  getActiveBlueprint,
  getBiomeInfo,
  getSwampFactor,
  getTerrainHeight,
  setActiveWorldSeed,
  worldToVirtualChunk,
} from '../world/terrainMath';
import { ComputeEngine } from '../world/wasmCompute';
import {
  BASE_GAME_HOURS_PER_SEC,
  WeatherAndSkySystem,
  WeatherId,
} from '../world/weatherAndSky';
import {
  AsyncWorldInitHandle,
  formatWorldInitError,
  startAsyncWorldInit,
} from '../world/worldInit';
import { createInitialPerfSample, DebugController, MetsavaikusDebugApi } from './runtime/debugController';
import {
  createOutdoorEnvScene,
  detectGpuInfo,
  QualityAndDrsController,
} from './runtime/gpuAndQuality';
import { HudBridge } from './runtime/hudBridge';
import { getEntryName, InteractionController } from './runtime/interactionController';
import { PlayerController } from './runtime/playerController';
import {
  buildWorldActions,
  buildWorldInteractionHandlers,
  SleepSession,
} from './runtime/worldActionsBuilder';
import type {
  GamePhase,
  WorldActions,
  WorldCallbacks,
  WorldLoadingStage,
  WorldHudRefs,
  WorldSurvivalSnapshot,
} from './worldRuntimeContracts';

export type {
  GamePhase,
  WorldActions,
  WorldCallbacks,
  WorldHudRefs,
  WorldSurvivalSnapshot,
} from './worldRuntimeContracts';

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

const _camForward = new THREE.Vector3(0, 0, -1);
const COLLAPSE_DURATION_SEC = 3.2;

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
    let cleanedUp = false;
    let worldInitReady = false;
    let asyncInitHandle: AsyncWorldInitHandle | null = null;
    let frameId = 0;
    let isTimeoutFrame = false;

    const gpu = detectGpuInfo();
    const perfLogger = new FpsDropLogger(performance.now());
    const qualityCtrl = new QualityAndDrsController({
      gpu,
      initialMode: qualityModeRef.current,
      initialResolutionScale: resolutionScaleRef.current,
      getCallbacks: () => callbacksRef.current,
      perfLogger,
    });

    callbacksRef.current.onDisplayMetrics?.({
      autoDpr: qualityCtrl.dprSteps[0],
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    });

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      callbacksRef.current.onWorldError?.(formatWorldInitError(err));
      return () => {
        disposed = true;
      };
    }

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(qualityCtrl.currentDpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.domElement.tabIndex = 0;
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
    if (!gpu.isLowPowerGpu) {
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
    const audioBackend = soundscape.backend as WebAudioHybridBackend;
    sound.attachSoundscapeEngine(soundscape.engine, audioBackend);
    loadSoundscapeSnapshotFromStorage(worldSeed, soundscape.engine);

    const vegQualityOpts: VegetationQualityOptions = {};
    const weatherSky = new WeatherAndSkySystem(
      scene,
      gpu.isSoftwareGl,
      qualityCtrl.currentDpr,
      gpu.isLowPowerGpu
    );

    let refreshQualitySceneNow: ((profile: QualityProfile) => void) | null = null;
    qualityCtrl.applyQualityProfileToScene(
      qualityCtrl.governor.getProfile(),
      renderer,
      weatherSky,
      refreshQualitySceneNow,
      true
    );

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
    let debugPanelOpen = false;
    let inspectRaycastTimer = 0;

    let collapseTimer = 0;
    let collapseStartMs = 0;
    let collapseStartPitch = 0;
    let collapseStartEye = 1.7;
    let sleepSession: SleepSession | null = null;

    let lastTime = performance.now();
    let elapsed = 0;
    let simElapsed = 0;
    let fpsEma = 60;
    let hudTimer = 0;
    let snapshotTimer = 0;
    let minimapTimer = 0;
    let diagResetTimer = 0;
    let prevTickCpuMs = 0;
    let titleOrbit = 0;

    let flashlightOn = false;
    let isMuted = false;
    let pointerLocked = false;
    let mouseDragging = false;
    let lastObservedWeather = weatherSky.currentWeather;
    let lastObservedChunkKey = '';
    let lastWindStrength = 0.6;
    let lastShelterLabel: string | null = null;
    let lastNearFire = 0;
    let lastWeatherIntensity = 0;
    let lastFogDensity = 0.006;
    let lastSunDirY = 0.5;

    let hasLivePerfSample = false;
    let shadowUpdatesWindow = 0;
    let lastProgramCount = 0;
    let programsDeltaWindow = 0;
    const perfSample = createInitialPerfSample(gpu, qualityCtrl.currentDpr);

    const keysHeld = new Set<string>();
    const keysJustPressed = new Set<string>();
    const chunkStats: ChunkVisibilityStats = { visibleChunks: 0, lod0: 0, lod1: 0, lod2: 0 };
    const vegStats: VegetationStats = {
      treesRendered: 0,
      foliageRendered: 0,
      culledInstances: 0,
      candidateInstances: 0,
    };

    const hudBridge = new HudBridge(hudRefs);

    const setFlashlightState = (on: boolean) => {
      flashlightOn = on;
      flashlight.intensity = on ? 3.5 : 0;
    };

    const syncVitalHudDom = (): void => {
      hudBridge.syncVitalHudDom(survival, inventory, lastNearFire, player.lastIsSwimming);
    };

    const pushSurvivalSnapshot = (): void => {
      callbacksRef.current.onSurvivalSnapshot(
        hudBridge.buildSurvivalSnapshot({
          survival,
          inventory,
          fogOfWar,
          playerX: player.pos.x,
          playerZ: player.pos.z,
          playerYaw: player.yaw,
          hourOfDay: weatherSky.timeOfDay,
          weather: weatherSky.currentWeather,
          windStrength: lastWindStrength,
          shelterLabel: lastShelterLabel,
          nearLitCampfireFactor: lastNearFire,
          seatedInTent: player.seatedTent !== null,
          isSwimming: player.lastIsSwimming,
          waterDepthM: player.lastWaterDepthM,
          sleepProgress: sleepSession
            ? {
                elapsedHours: sleepSession.elapsedHours,
                totalHours: sleepSession.totalHours,
                spotLabel: sleepSession.spot.label,
              }
            : null,
          collapseProgress: Math.min(1, collapseTimer / COLLAPSE_DURATION_SEC),
        })
      );
    };

    const syncHudAndSnapshot = (): void => {
      syncVitalHudDom();
      pushSurvivalSnapshot();
    };

    const finishInventoryChange = (beforePublish?: () => void): void => {
      refreshInventoryBurden(survival, inventory, debugCtrl.weightThresholds);
      beforePublish?.();
      syncVitalHudDom();
      pushSurvivalSnapshot();
    };

    const rejectIfSwimming = (): boolean => {
      if (!player.lastIsSwimming) return false;
      callbacksRef.current.onToast(t('toast.cannotUsePackSwimming'));
      return true;
    };

    const restoreGameFocus = (): void => {
      if (phaseRef.current === 'playing' && !uiModalOpen && !diagnosticsOpen && !debugPanelOpen) {
        renderer.domElement.focus({ preventScroll: true });
      }
    };

    const beginCollapse = (): void => {
      if (debugCtrl.godMode) {
        survival.deathCause = null;
        survival.deathFactors = [];
        return;
      }
      if (phaseRef.current === 'collapsing' || phaseRef.current === 'collapsed') return;
      if (document.pointerLockElement) document.exitPointerLock?.();
      player.resetForRestart(true);
      uiModalOpen = false;
      sleepSession = null;
      collapseTimer = 0;
      collapseStartMs = performance.now();
      collapseStartPitch = player.pitch;
      collapseStartEye = player.currentEye;
      if (flashlightOn) {
        setFlashlightState(false);
      }
      phaseRef.current = 'collapsing';
      callbacksRef.current.onPhaseChange('collapsing');
      pushSurvivalSnapshot();
    };

    const finishSleep = (early: boolean): void => {
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
      syncHudAndSnapshot();
    };

    const player = new PlayerController({
      camera,
      sound,
      soundscape,
      keysHeld,
      keysJustPressed,
      getPropsCtx: () => propsCtx,
      getVegetation: () => vegetation,
      getPropCircleColliders: () => propCircleColliders,
      getSurvival: () => survival,
      getWeightThresholds: () => debugCtrl.weightThresholds,
      getElapsed: () => elapsed,
      getSimClockMs: () => simClockMs,
      getUiModalOpen: () => uiModalOpen,
      setUiModalOpen: (open) => {
        uiModalOpen = open;
      },
      onCloseModals: () => callbacksRef.current.onCloseModals(),
      onToast: (msg) => callbacksRef.current.onToast(msg),
      onCarryChange: (label) => callbacksRef.current.onCarryChange(label),
      onSyncHudAndSnapshot: syncHudAndSnapshot,
      onClearHoverPrompt: () => {
        interaction.clearPrompt();
      },
    });

    discovery.markAroundWorldPos(player.pos.x, player.pos.z, 1);
    fogOfWar.revealAt(player.pos.x, player.pos.z);
    lastFogRevealX = player.pos.x;
    lastFogRevealZ = player.pos.z;

    const interaction = new InteractionController({
      camera,
      player,
      sound,
      soundscape,
      getPhase: () => phaseRef.current,
      getUiModalOpen: () => uiModalOpen,
      getPropsCtx: () => propsCtx,
      getVegetation: () => vegetation,
      getInventory: () => inventory,
      getSurvival: () => survival,
      getElapsed: () => elapsed,
      getSimClockMs: () => simClockMs,
      onPromptChange: (prompt) => callbacksRef.current.onPromptChange(prompt),
      onCarryChange: (label) => callbacksRef.current.onCarryChange(label),
      onToast: (msg) => callbacksRef.current.onToast(msg),
      onGatherMushroom: (species) => callbacksRef.current.onGatherMushroom(species),
      onFinishInventoryChange: finishInventoryChange,
      onSyncHudAndSnapshot: syncHudAndSnapshot,
    });

    const debugCtrl = new DebugController({
      worldSeed,
      renderer,
      camera,
      weatherSky,
      sound,
      soundscape,
      player,
      interaction,
      hudBridge,
      discovery,
      fogOfWar,
      perfLogger,
      perfSample,
      getHasLivePerfSample: () => hasLivePerfSample,
      getPhase: () => phaseRef.current,
      setUiModalOpen: (open) => {
        uiModalOpen = open;
      },
      getSimDay: () => simDay,
      getSimClockMs: () => simClockMs,
      setSimClockAndPrevHour: (nextClockMs, prevHour) => {
        simClockMs = nextClockMs;
        prevSkyHour = prevHour;
      },
      getLastWindStrength: () => lastWindStrength,
      getLastFogCullDist: () => qualityCtrl.lastFogCullDist,
      getCurrentDpr: () => qualityCtrl.currentDpr,
      getSurvival: () => survival,
      getInventory: () => inventory,
      getPropsCtx: () => propsCtx,
      getTerrainMgr: () => terrainMgr,
      getVegetation: () => vegetation,
      getMinimap: () => minimap,
      onUpdatePropCircleColliders: (colliders) => {
        propCircleColliders = colliders;
      },
      onFinishInventoryChange: finishInventoryChange,
      onSyncHudAndSnapshot: syncHudAndSnapshot,
      onPushSurvivalSnapshot: pushSurvivalSnapshot,
      onSetObservedWeather: (w) => {
        lastObservedWeather = w;
      },
      onSetLastFogReveal: (x, z) => {
        lastFogRevealX = x;
        lastFogRevealZ = z;
      },
      onTurnOffFlashlight: () => {
        if (flashlightOn) setFlashlightState(false);
      },
      onBeginCollapse: beginCollapse,
      getCallbacks: () => callbacksRef.current,
      getActions: () => actionsRef.current,
      keysHeld,
      keysJustPressed,
    });
    const { perfCapture } = debugCtrl;

    const unsubscribeSoundEvents = soundscape.engine.subscribeEvents((ev) => {
      const p = (ev.payload ?? {}) as Record<string, unknown>;
      const details: string[] = [];
      if (p.material) details.push(`mat=${String(p.material)}`);
      if (p.surface && p.surface !== p.material) details.push(`surf=${String(p.surface)}`);
      if (typeof p.distanceM === 'number') details.push(`dist=${p.distanceM.toFixed(2)}m`);
      if (p.gait) details.push(`gait=${String(p.gait)}`);
      if (p.species) details.push(`sp=${String(p.species)}`);
      if (p.broken !== undefined) details.push(`broken=${String(p.broken)}`);
      if (ev.intensity !== undefined) details.push(`int=${ev.intensity.toFixed(2)}`);
      debugCtrl.pushDebugEvent(
        'soundscape',
        ev.type,
        details.length > 0 ? details.join(' · ') : `origin=${ev.origin}`,
        p
      );
    });

    const dumpPerfFn = () => {
      const dump = perfLogger.dumpText(hasLivePerfSample ? perfSample : undefined);
      console.log(dump);
      return dump;
    };
    (window as unknown as { dumpMetsavaikusPerf?: () => string }).dumpMetsavaikusPerf = dumpPerfFn;

    const instanceDebugApi = debugCtrl.createInstanceDebugApi();
    (window as unknown as { __metsavaikusDebug?: MetsavaikusDebugApi }).__metsavaikusDebug =
      instanceDebugApi;

    const instanceActions = buildWorldActions({
      worldSeed,
      renderer,
      camera,
      sound,
      soundscape,
      weatherSky,
      qualityCtrl,
      perfLogger,
      player,
      hudBridge,
      debugCtrl,
      discovery,
      fogOfWar,
      getCallbacks: () => callbacksRef.current,
      getInitialPacking: () => initialPackingRef.current,
      getPropsCtx: () => propsCtx,
      getMinimap: () => minimap,
      getInventory: () => inventory,
      setInventory: (inv) => {
        inventory = inv;
      },
      getSurvival: () => survival,
      setSurvival: (s) => {
        survival = s;
      },
      getElapsed: () => elapsed,
      getSimClockMs: () => simClockMs,
      getUiModalOpen: () => uiModalOpen,
      setUiModalOpen: (open) => {
        uiModalOpen = open;
      },
      getDiagnosticsOpen: () => diagnosticsOpen,
      setDiagnosticsOpen: (open) => {
        diagnosticsOpen = open;
      },
      getDebugPanelOpen: () => debugPanelOpen,
      setDebugPanelOpen: (open) => {
        debugPanelOpen = open;
      },
      setMouseDragging: (dragging) => {
        mouseDragging = dragging;
      },
      setFlashlight: setFlashlightState,
      getFlashlightOn: () => flashlightOn,
      toggleMuteState: () => {
        isMuted = !isMuted;
        sound.setMuted(isMuted);
        return isMuted;
      },
      getRefreshQualitySceneNow: () => refreshQualitySceneNow,
      setSleepSession: (session) => {
        sleepSession = session;
      },
      setCollapseTimer: (val) => {
        collapseTimer = val;
      },
      onFinishSleep: finishSleep,
      onFinishInventoryChange: finishInventoryChange,
      onSyncHudAndSnapshot: syncHudAndSnapshot,
      onPushSurvivalSnapshot: pushSurvivalSnapshot,
      onRestoreGameFocus: restoreGameFocus,
      onRejectIfSwimming: rejectIfSwimming,
      onSetObservedWeather: (w) => {
        lastObservedWeather = w;
      },
      onSetLastFogReveal: (x, z) => {
        lastFogRevealX = x;
        lastFogRevealZ = z;
      },
      onClearHoverPrompt: () => {
        interaction.clearPrompt();
      },
      isDisposedOrCleaned: () => disposed || cleanedUp,
    });
    actionsRef.current = instanceActions;

    const onWebGlContextLost = (ev: Event) => {
      ev.preventDefault();
      perfLogger.recordEvent('webglcontextlost', performance.now());
    };
    const onWebGlContextRestored = () => {
      perfLogger.recordEvent('webglcontextrestored', performance.now());
    };
    renderer.domElement.addEventListener('webglcontextlost', onWebGlContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onWebGlContextRestored);

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
      renderer.domElement.focus({ preventScroll: true });
      sound.init();
      if (debugCtrl.pickTargetActive && e.button === 0) {
        const rect = renderer.domElement.getBoundingClientRect();
        const ndcX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
        const ndcY = -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
        const hit = debugCtrl.inspectAtNdc(ndcX, ndcY, 'cursor');
        if (hit) {
          debugCtrl.pickedHit = hit;
          debugCtrl.pushDebugEvent(
            'debug',
            'debug.pick_target',
            `Picked [${hit.layer}] ${hit.name} @ (${hit.point.x.toFixed(1)}, ${hit.point.z.toFixed(1)})`
          );
          if (debugCtrl.autoSpawnOnPick) {
            debugCtrl.actions.spawnEntry(debugCtrl.selectedSpawnId, 'picked');
          }
        }
        return;
      }
      if (debugPanelOpen) return;
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
      if (player.seatedTent) {
        const rel = THREE.MathUtils.clamp(player.yaw - player.seatedBaseYaw, -1.48, 1.48);
        player.yaw = player.seatedBaseYaw + rel;
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
      if (
        !consumeGameKeyDown(e, {
          phase: phaseRef.current,
          modalOpen: uiModalOpen || diagnosticsOpen || debugPanelOpen,
          pointerLocked,
        })
      ) {
        return;
      }

      if (code === 'F8') {
        if (phaseRef.current === 'playing' || phaseRef.current === 'paused') {
          if (document.pointerLockElement) document.exitPointerLock?.();
          keysHeld.clear();
          keysJustPressed.clear();
          mouseDragging = false;
          callbacksRef.current.onToggleDebugPanel?.();
        }
        return;
      }

      if (code === 'F9') {
        if (phaseRef.current === 'playing' || phaseRef.current === 'paused') {
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
          if (rejectIfSwimming()) return;
          callbacksRef.current.onToggleBackpack();
        }
        return;
      }

      if (code === 'KeyM') {
        if (phaseRef.current === 'playing') {
          callbacksRef.current.onToggleFullMap();
        }
        return;
      }

      if (code === 'KeyP' || (code === 'Escape' && !pointerLocked)) {
        if (code === 'Escape' && (diagnosticsOpen || debugPanelOpen) && !uiModalOpen) {
          return;
        }
        if (uiModalOpen) {
          callbacksRef.current.onCloseModals();
          return;
        }
        if (phaseRef.current === 'playing') {
          if (document.pointerLockElement) document.exitPointerLock?.();
          player.resetIdleMotionFlags(false);
          soundscape.engine.stopMovementLoops();
          sound.suspend();
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

      if (player.seatedTent) {
        if (code === 'KeyE') {
          actionsRef.current?.openSleepForSeatedTent();
        } else if (
          code === 'Space' ||
          code === 'KeyW' ||
          code === 'KeyA' ||
          code === 'KeyS' ||
          code === 'KeyD'
        ) {
          player.exitTentSeat(false);
        }
        return;
      }

      if (code === 'KeyE') interaction.handleInteractE();
      if (code === 'KeyF') interaction.handleInteractF();
      if (code === 'KeyR') interaction.handleInteractR();
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
      lastTime = performance.now();
      perfCapture.breakInterval();
    };

    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      qualityCtrl.onResize(w, h, renderer, weatherSky);
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

    refreshQualitySceneNow = (profile: QualityProfile) => {
      qualityCtrl.slewDistances(0);
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
      qualityCtrl.lastFogCullDist = nextCullDist;
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

    let prevTickPhase: GamePhase = phaseRef.current;

    function tick(): void {
      if (disposed) return;
      const now = performance.now();
      const rawDtMs = Math.max(0.1, now - lastTime);
      const rawDt = rawDtMs / 1000;
      const frameTiming = computeFrameTiming(rawDt);
      const dt = frameTiming.deltaSec;
      lastTime = now;
      elapsed += dt;

      const curPhase = phaseRef.current;
      const isSimFrozen = curPhase === 'playing' && debugCtrl.debugSimPaused;
      const captureFrame = perfCapture.active && curPhase === 'playing' && !isSimFrozen &&
        !uiModalOpen && !debugPanelOpen && !diagnosticsOpen && !document.hidden;
      if (!captureFrame && perfCapture.active) perfCapture.breakInterval();
      if (!isSimFrozen && curPhase !== 'paused' && curPhase !== 'collapsed') {
        simElapsed += dt;
      }

      fpsEma = smoothFps(fpsEma, rawDt);
      hudTimer += rawDt;
      snapshotTimer += rawDt;
      minimapTimer += rawDt;
      diagResetTimer += rawDt;
      inspectRaycastTimer += rawDt;

      if (curPhase !== prevTickPhase) {
        if (curPhase !== 'playing') {
          player.resetIdleMotionFlags(
            curPhase === 'collapsing' || curPhase === 'collapsed' || curPhase === 'title'
          );
        }
        if (curPhase === 'paused' || curPhase === 'collapsed') {
          sound.suspend();
        }
        prevTickPhase = curPhase;
      }

      let playerMs = 0;
      let propsMs = 0;
      let skyMs = 0;
      let terrainMs = 0;
      let vegMs = 0;
      let minimapMs = 0;
      let soundscapeMs = 0;
      let soundscapeSaveMs = 0;
      let skyTimeLabel = '';
      let skyWindStrength = 0;
      let skyTimeScale = 1;
      let jumpedThisFrame = false;

      if (curPhase === 'title' || curPhase === 'packing') {
        titleOrbit += dt * 0.08;
        const fwdX = -Math.sin(player.spawnYaw);
        const fwdZ = -Math.cos(player.spawnYaw);
        const rightX = Math.cos(player.spawnYaw);
        const rightZ = -Math.sin(player.spawnYaw);
        const orbitSide = Math.sin(titleOrbit) * 18;
        const orbitBack = 8 + Math.cos(titleOrbit) * 7;
        const camX = player.spawnX + rightX * orbitSide - fwdX * orbitBack;
        const camZ = player.spawnZ + rightZ * orbitSide - fwdZ * orbitBack;
        const camY = getTerrainHeight(camX, camZ) + 6.5;
        const lookX = player.spawnX + fwdX * 28 + rightX * 2;
        const lookZ = player.spawnZ + fwdZ * 28 + rightZ * 2;
        camera.position.set(camX, camY, camZ);
        camera.lookAt(lookX, getTerrainHeight(lookX, lookZ) + 2.2, lookZ);
        camera.updateMatrixWorld();
      } else if (curPhase === 'playing' && debugCtrl.debugSimPaused) {
        camera.position.set(player.pos.x, player.pos.y + player.currentEye, player.pos.z);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        camera.updateMatrixWorld();
      } else if (curPhase === 'playing') {
        skyTimeScale = debugCtrl.clockSpeedMult;
        for (let step = 0; step < frameTiming.stepCount; step++) {
          const t0 = performance.now();
          const moveRes = player.step(frameTiming.stepSec, {
            noClip: debugCtrl.noClip,
            moveSpeedMult: debugCtrl.moveSpeedMult,
          });
          player.lastLocomotion = moveRes.locomotion;
          jumpedThisFrame ||= moveRes.jumped;
          const t1 = performance.now();
          interaction.updateDynamicObjects(frameTiming.stepSec);
          const t2 = performance.now();
          playerMs += t1 - t0;
          propsMs += t2 - t1;
        }
        const hoverStart = performance.now();
        interaction.updateInteractionHover();
        propsMs += performance.now() - hoverStart;
      } else if (curPhase === 'sleeping' && sleepSession) {
        const wallDt = dt;
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
          soundscape.engine.stopMovementLoops(true);
          sound.suspend();
          phaseRef.current = 'collapsed';
          prevTickPhase = 'collapsed';
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
            : player.seatedTent
              ? 'tent'
              : curEnvState?.shelter ?? 'outdoor';

        if (
          debugCtrl.weatherOverride !== null &&
          weatherSky.currentWeather !== debugCtrl.weatherOverride
        ) {
          weatherSky.setWeather(debugCtrl.weatherOverride, false);
        }

        const simStepDt = isSimFrozen ? 0 : dt;
        const qualityProfile = qualityCtrl.slewDistances(simStepDt);
        const tp0 = performance.now();
        const skyInfo = weatherSky.update(
          simStepDt,
          player.pos,
          scene,
          sound,
          hudRefs.flashEl.current,
          _camForward,
          skyTimeScale,
          effectiveShelter,
          qualityCtrl.smoothedQuality.fogDensityScale
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
        const rawDelta = curHour - prevSkyHour;
        if (rawDelta < -12) {
          simDay += 1;
        }
        prevSkyHour = curHour;
        simClockMs = ((simDay - 1) * 24 + curHour) * 3_600_000;

        if (
          !isSimFrozen &&
          (curPhase === 'playing' || curPhase === 'sleeping' || curPhase === 'collapsing')
        ) {
          const audioStart = captureFrame ? performance.now() : 0;
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
          if (player.seatedTent) {
            structAcoustics.id = player.seatedTent.id;
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
            soundscape.contextBuilder.build({
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
              isMoving:
                player.lastIsMoving &&
                player.playerSpeedMps > 0.05 &&
                curPhase === 'playing' &&
                !uiModalOpen &&
                !player.seatedTent,
              wantRun: player.lastWantRun,
              crouching:
                player.lastCrouching &&
                curPhase === 'playing' &&
                !uiModalOpen &&
                !player.seatedTent,
              isSwimming: player.lastIsSwimming,
              isSwampWading: player.lastIsSwampWading,
              onBoardwalk: player.lastOnBoardwalk,
              waterDepthM: player.lastWaterDepthM,
              speedMps:
                curPhase === 'playing' && !uiModalOpen && !player.seatedTent
                  ? player.playerSpeedMps
                  : 0,
              stamina: survival.energy,
              exertion: player.playerExertion,
              tiredness: survival.physicalTiredness,
              wetness: survival.wetness,
              wearingRainJacket: isWearingRainJacket(inventory),
              seatedInTent: player.seatedTent !== null,
              isSleeping: curPhase === 'sleeping',
              distanceMovedTotal: player.totalDistanceMoved,
              nearLitCampfireFactor: curEnvState?.nearLitCampfireFactor ?? 0,
              nearestCampfirePos: campfirePos,
              structure: structAcoustics,
              muted: isMuted,
            })
          );
          if (captureFrame) soundscapeMs = performance.now() - audioStart;

          if (elapsed - lastSnapshotSaveSec >= 12) {
            const saveStart = captureFrame ? performance.now() : 0;
            lastSnapshotSaveSec = elapsed;
            saveSoundscapeSnapshotToStorage(worldSeed, soundscape.engine);
            if (captureFrame) soundscapeSaveMs = performance.now() - saveStart;
          }
          void lastWeatherIntensity;
        } else if (diagnosticsOpen || isSimFrozen) {
          soundscape.engine.stepAuditionVoices(dt);
        }

        if (curPhase === 'playing' && !isSimFrozen && !uiModalOpen && curEnvState) {
          lastShelterLabel = player.seatedTent
            ? t('prop.tentSpotLabel')
            : curEnvState.shelterLabel;
          lastNearFire = curEnvState.nearLitCampfireFactor;

          stepSurvivalTick(
            survival,
            inventory,
            {
              locomotion: player.lastLocomotion,
              jumpedThisFrame,
              weather: weatherSky.currentWeather,
              windStrength: skyInfo.windStrength,
              hourOfDay: weatherSky.timeOfDay,
              shelter: player.seatedTent ? 'tent' : curEnvState.shelter,
              nearLitCampfireFactor: curEnvState.nearLitCampfireFactor,
              flashlightActive: flashlightOn,
              seatedInTent: player.seatedTent !== null,
              godMode: debugCtrl.godMode,
              weightThresholds: debugCtrl.weightThresholds,
            },
            dt,
            dt * BASE_GAME_HOURS_PER_SEC * debugCtrl.clockSpeedMult,
            tickEvents
          );

          if (tickEvents.flashlightDepleted && flashlightOn) {
            setFlashlightState(false);
            callbacksRef.current.onToast(t('toast.batteryDied'));
            debugCtrl.pushDebugEvent(
              'survival',
              'survival.flashlight_depleted',
              'Flashlight battery reached 0%'
            );
          }
          if (tickEvents.vomited) {
            player.vomitLurchTimer = 1.0;
            sound.playVomitRetch();
            callbacksRef.current.onToast(
              t('toast.vomited', { source: tickEvents.vomitSource ?? 'poison' })
            );
            debugCtrl.pushDebugEvent(
              'survival',
              'survival.vomited',
              `Vomited (${tickEvents.vomitSource ?? 'poison'})`
            );
            pushSurvivalSnapshot();
          }
          if (tickEvents.died && !debugCtrl.godMode) {
            debugCtrl.pushDebugEvent(
              'survival',
              'survival.died',
              `Player collapsed (${survival.deathCause ?? 'unknown'})`
            );
            beginCollapse();
          }
          syncVitalHudDom();
        }

        if (
          curPhase === 'playing' &&
          (debugCtrl.debugOverlayEnabled || debugPanelOpen) &&
          !debugCtrl.pickTargetActive &&
          inspectRaycastTimer >= 0.12
        ) {
          inspectRaycastTimer = 0;
          debugCtrl.centerHit = debugCtrl.inspectAtNdc(0, 0, 'center');
        }

        const maxRenderDist = computeFogCullDistance(
          skyInfo.fogDensity,
          qualityCtrl.smoothedQuality.minRenderDist,
          qualityCtrl.smoothedQuality.maxRenderDist
        );
        qualityCtrl.lastFogCullDist = maxRenderDist;

        if (weatherSky.currentWeather !== lastObservedWeather) {
          lastObservedWeather = weatherSky.currentWeather;
          perfLogger.recordEvent(`autoWeather->${lastObservedWeather}`, tp1);
        }

        if (terrainMgr && vegetation) {
          const terrainStart = performance.now();
          terrainMgr.setLightingState(
            skyInfo.dayFactor,
            simElapsed,
            skyInfo.windStrength,
            skyInfo.skyHorizonColor
          );
          terrainMgr.update(
            camera,
            chunkStats,
            maxRenderDist,
            qualityCtrl.smoothedQuality.terrainLod0Dist,
            qualityCtrl.smoothedQuality.terrainLod1Dist
          );
          const tp2 = performance.now();
          terrainMs = tp2 - terrainStart;

          vegQualityOpts.lod0Dist = qualityCtrl.smoothedQuality.treeLod0Dist;
          vegQualityOpts.lod1Dist = qualityCtrl.smoothedQuality.treeLod1Dist;
          vegQualityOpts.bushDist = qualityCtrl.smoothedQuality.bushDist;
          vegQualityOpts.understoryDist = qualityCtrl.smoothedQuality.understoryDist;
          vegQualityOpts.boulderDist = qualityCtrl.smoothedQuality.boulderDist;
          vegQualityOpts.bogDist = qualityCtrl.smoothedQuality.bogDist;
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
            simElapsed,
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
            simElapsed,
            camera.position.x,
            camera.position.z,
            skyInfo,
            terrainMgr.frustumPlanes,
            maxRenderDist,
            weatherSky.currentWeather,
            qualityCtrl.smoothedQuality.mushroomDist
          );
          const tp4 = performance.now();
          propsMs += tp4 - tp3;
        } else {
          const propsStart = performance.now();
          propsCtx?.updateDynamicProps(
            simElapsed,
            camera.position.x,
            camera.position.z,
            skyInfo,
            undefined,
            maxRenderDist,
            weatherSky.currentWeather,
            qualityCtrl.smoothedQuality.mushroomDist
          );
          propsMs += performance.now() - propsStart;
        }

        if (propsCtx?.needsLightShadowUpdate()) renderer.shadowMap.needsUpdate = true;

        if (!gpu.isSoftwareGl && weatherSky.isSunCastingShadow) {
          shadowFrameSkip++;
          const movedSq =
            (player.pos.x - lastShadowX) * (player.pos.x - lastShadowX) +
            (player.pos.z - lastShadowZ) * (player.pos.z - lastShadowZ);
          const sunMoved = Math.abs(skyInfo.sunDir.y - lastShadowSunY) > 0.008;
          if (
            (movedSq > qualityProfile.shadowMoveThreshSq || sunMoved) &&
            shadowFrameSkip >= qualityProfile.shadowMinSkip
          ) {
            renderer.shadowMap.needsUpdate = true;
            shadowUpdatesWindow++;
            lastShadowX = player.pos.x;
            lastShadowZ = player.pos.z;
            lastShadowSunY = skyInfo.sunDir.y;
            shadowFrameSkip = 0;
          }
        }

        qualityCtrl.updateDrs(
          rawDt,
          now,
          fpsEma,
          curPhase === 'playing',
          renderer,
          weatherSky
        );

        if (hudTimer >= 0.25) {
          hudTimer = 0;
          if (hudRefs.fpsEl.current) {
            hudRefs.fpsEl.current.textContent = formatFpsLabel(fpsEma);
          }
          hudBridge.syncBiomeAndWeatherLabels(
            player.pos.x,
            player.pos.z,
            weatherSky.timeOfDay,
            weatherSky.currentWeather,
            skyInfo.timeLabel
          );
          renderer.domElement.dataset.visibleChunks = String(chunkStats.visibleChunks);
          renderer.domElement.dataset.treesRendered = String(vegStats.treesRendered);
          renderer.domElement.dataset.foliageRendered = String(vegStats.foliageRendered);
          renderer.domElement.dataset.culledInstances = String(vegStats.culledInstances ?? 0);
          renderer.domElement.dataset.candidateInstances = String(vegStats.candidateInstances ?? 0);
          renderer.domElement.dataset.fogCullDist = maxRenderDist.toFixed(1);
          renderer.domElement.dataset.pixelRatio = qualityCtrl.currentDpr.toFixed(2);
          renderer.domElement.dataset.qualityTier = qualityProfile.name;
          renderer.domElement.dataset.qualityMode = String(qualityCtrl.governor.getMode());
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

        const mmRes = hudBridge.maybeRedrawMinimap(
          minimap,
          inventory,
          fogOfWar,
          player.pos.x,
          player.pos.z,
          player.yaw,
          minimapTimer
        );
        if (mmRes.redrew) {
          minimapTimer = 0;
          minimapMs = mmRes.minimapMs;
        }
      } else if (diagnosticsOpen) {
        soundscape.engine.stepAuditionVoices(dt);
      }

      const probe = captureFrame ? debugCtrl.replayProbe : null;
      probe?.beginRender(now);
      const tr0 = performance.now();
      const reflected = propsCtx?.renderWaterReflection(renderer, scene, camera, debugCtrl.perfReflectionsEnabled) ?? false;
      const reflectionEnd = captureFrame ? performance.now() : 0;
      probe?.beginMainRender(reflected);
      const mainRenderStart = probe ? performance.now() : reflectionEnd;
      renderer.render(scene, camera);
      const tr1 = performance.now();
      probe?.endRender();
      renderer.domElement.dataset.ready = 'true';
      renderer.domElement.dataset.drawCalls = String(renderer.info.render.calls);
      renderer.domElement.dataset.triangles = String(renderer.info.render.triangles);
      const renderMs = tr1 - tr0;
      const tickCpuMs = tr1 - now;
      const externalWaitMs = Math.max(0, rawDtMs - prevTickCpuMs);
      prevTickCpuMs = tickCpuMs;

      if (captureFrame) {
        perfCapture.record(now, {
          tick: tickCpuMs,
          mainRender: tr1 - mainRenderStart,
          reflection: reflectionEnd - tr0,
          terrain: terrainMs,
          vegetation: vegMs,
          soundscape: soundscapeMs,
          soundscapeSave: soundscapeSaveMs,
        }, reflected, {
          backbufferPx: [renderer.domElement.width, renderer.domElement.height],
          pixelRatio: qualityCtrl.currentDpr,
          quality: qualityCtrl.governor.getProfile().name,
          position: [player.pos.x, player.pos.y, player.pos.z],
          yawDeg: THREE.MathUtils.radToDeg(player.yaw),
          pitchDeg: THREE.MathUtils.radToDeg(player.pitch),
          weather: weatherSky.currentWeather,
          hour: weatherSky.timeOfDay,
          reflectionsEnabled: debugCtrl.perfReflectionsEnabled,
          waterVisible: propsCtx?.isWaterVisible() ?? false,
          sunShadow: weatherSky.isSunCastingShadow,
          audioContext: sound.getAudioContext()?.state ?? 'uninitialized',
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          trees: vegStats.treesRendered,
          grass: vegetation?.grassCount ?? 0,
        });
      }

      const qualityTransition = qualityCtrl.governor.observe({
        nowMs: tr1,
        rawDtMs,
        fpsEma,
        fpsInstant: 1000 / Math.max(1, rawDtMs),
        frameCpuMs: tickCpuMs,
        isPlaying: curPhase === 'playing' && !uiModalOpen,
        isHidden: document.hidden,
      });
      if (qualityTransition) {
        const nextProfile = qualityCtrl.governor.getProfile();
        qualityCtrl.applyQualityProfileToScene(
          nextProfile,
          renderer,
          weatherSky,
          refreshQualitySceneNow,
          false
        );
        perfLogger.recordEvent(
          `quality->${nextProfile.name}(${qualityTransition.reason})`,
          tr1
        );
      }

      if (curPhase === 'playing') {
        const fpsInstant = 1000 / rawDtMs;
        const isLowNow = fpsEma < 15 || fpsInstant < 15;
        const mightReport = !!probe || isLowNow || fpsEma >= 22 || !hasLivePerfSample;
        if (mightReport) {
          const needDiag = !!probe || isLowNow || !hasLivePerfSample;
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
          perfSample.drsMs = qualityCtrl.drsMsWindow;
          perfSample.programs = curProgs;
          perfSample.visibleChunks = chunkStats.visibleChunks;
          perfSample.lodCounts[0] = chunkStats.lod0;
          perfSample.lodCounts[1] = chunkStats.lod1;
          perfSample.lodCounts[2] = chunkStats.lod2;
          perfSample.treesRendered = vegStats.treesRendered;
          perfSample.foliageRendered = vegStats.foliageRendered;
          perfSample.culledInstances = vegStats.culledInstances ?? 0;
          perfSample.candidateInstances = vegStats.candidateInstances ?? 0;
          perfSample.fogCullDist = qualityCtrl.lastFogCullDist;
          perfSample.pixelRatio = qualityCtrl.currentDpr;
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
            perfSample.terrainWorkerBuilds += tDiag.workerBuilds;
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
          if (probe) {
            // perfSample is reused and its log-window counters can reset after this tick.
            // Keep both the live logger fields and the exact deltas since the preceding draw.
            perfCapture.attachDiagnostics({
              ...perfSample, pos: [...perfSample.pos], chunk: [...perfSample.chunk],
              lodCounts: [...perfSample.lodCounts], backbufferPx: [...perfSample.backbufferPx!],
              terrainDelta: tDiag, foliageDelta: vDiag, ...probe.drawStats(),
              frameStartMs: now - probe.startMs,
            });
          }
          hasLivePerfSample = true;

          if (!debugCtrl.debugSimPaused) {
            debugCtrl.perfHistory.push({
              fps: fpsInstant,
              rawDtMs,
              renderMs,
              terrainMs,
              vegMs,
              skyMs,
              propsMs,
              playerMs,
              minimapMs,
              externalWaitMs,
            });
            if (debugCtrl.perfHistory.length > 120) {
              debugCtrl.perfHistory.shift();
            }
          }

          const emitted = perfLogger.observe(perfSample, document.hidden);
          if (emitted) {
            probe?.reports.push(emitted);
            perfSample.terrainBuilds = 0;
            perfSample.terrainWorkerBuilds = 0;
            perfSample.terrainEvictions = 0;
            perfSample.terrainRecenters = 0;
            perfSample.foliageBakes = 0;
            perfSample.foliageEvictions = 0;
            perfSample.foliageVisRebuilds = 0;
            perfSample.grassRebuilds = 0;
            shadowUpdatesWindow = 0;
            programsDeltaWindow = 0;
            qualityCtrl.drsMsWindow = 0;
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
          perfSample.terrainWorkerBuilds = 0;
          perfSample.terrainEvictions = 0;
          perfSample.terrainRecenters = 0;
          perfSample.foliageBakes = 0;
          perfSample.foliageEvictions = 0;
          perfSample.foliageVisRebuilds = 0;
          perfSample.grassRebuilds = 0;
          shadowUpdatesWindow = 0;
          programsDeltaWindow = 0;
          qualityCtrl.drsMsWindow = 0;
        }
      }

      if (gpu.isSoftwareGl) {
        afterDraw(tick);
      } else {
        isTimeoutFrame = false;
        frameId = requestAnimationFrame(tick);
      }
    }

    const unsubscribeLang = subscribeLanguage(() => {
      if (disposed || cleanedUp) return;
      interaction.lastPromptKey = '';
      hudBridge.invalidateConditions();
      hudTimer = 1;
      hudBridge.syncBiomeAndWeatherLabels(
        player.pos.x,
        player.pos.z,
        weatherSky.timeOfDay,
        weatherSky.currentWeather
      );
      syncVitalHudDom();
      interaction.updateInteractionHover();
      if (player.carrying) {
        callbacksRef.current.onCarryChange(
          t('hud.carrying', { name: getEntryName(player.carrying) })
        );
      }
      pushSurvivalSnapshot();
    });

    const cleanupRuntime = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;

      asyncInitHandle?.cancel();
      unsubscribeLang();
      unsubscribeSoundEvents();
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
      terrainMgr = null;
      vegetation?.dispose();
      vegetation = null;
      weatherSky.dispose();
      propsCtx?.dispose();
      propsCtx = null;
      minimap?.dispose();
      minimap = null;
      textures?.dispose();
      textures = null;
      envTarget?.dispose();
      envTarget = null;
      if (worldInitReady) {
        saveSoundscapeSnapshotToStorage(worldSeed, soundscape.engine);
      }
      sound.dispose();
      debugCtrl.replayProbe?.finish();
      debugCtrl.replayProbe = null;
      renderer.dispose();
      void computeEngine;
      computeEngine = null;

      if (actionsRef.current === instanceActions) {
        actionsRef.current = null;
      }
      const win = window as unknown as {
        __metsavaikusDebug?: unknown;
        dumpMetsavaikusPerf?: unknown;
      };
      if (win.__metsavaikusDebug === instanceDebugApi) {
        delete win.__metsavaikusDebug;
      }
      if (win.dumpMetsavaikusPerf === dumpPerfFn) {
        delete win.dumpMetsavaikusPerf;
      }

      if (renderer.domElement.parentNode === mountEl) {
        mountEl.removeChild(renderer.domElement);
      }
    };

    const interactionHandlers = buildWorldInteractionHandlers({
      player,
      camera,
      sound,
      soundscape,
      debugCtrl,
      getPropsCtx: () => propsCtx,
      getInventory: () => inventory,
      getElapsed: () => elapsed,
      getSimClockMs: () => simClockMs,
      setUiModalOpen: (open) => {
        uiModalOpen = open;
      },
      getCallbacks: () => callbacksRef.current,
      onFinishInventoryChange: finishInventoryChange,
      onPushSurvivalSnapshot: pushSurvivalSnapshot,
      onClearHoverPromptKey: () => {
        interaction.lastPromptKey = '';
      },
    });

    async function showLoadingStage(stage: WorldLoadingStage): Promise<boolean> {
      if (disposed || cleanedUp) return false;
      callbacksRef.current.onWorldLoading(stage);
      if (phaseRef.current !== 'title') return true;
      // Let the browser paint the label before synchronous generation occupies the main thread.
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      return !disposed && !cleanedUp;
    }

    callbacksRef.current.onWorldLoading('textures');
    asyncInitHandle = startAsyncWorldInit({
      loadComputeEngine: () => ComputeEngine.create(),
      loadTextures: () =>
        createWorldTextures(Math.min(4, renderer.capabilities.getMaxAnisotropy())),
      buildWorld: async (engine, loadedTextures) => {
        computeEngine = engine;
        textures = loadedTextures;
        if (phaseRef.current === 'title') {
          if (!await showLoadingStage('audio')) return;
          await audioBackend.preloadRecordings();
        }
        if (!await showLoadingStage('map')) return;

        propsCtx = buildArchitectureAndProps(
          scene,
          loadedTextures,
          sound,
          (msg) => callbacksRef.current.onToast(msg),
          gpu.isSoftwareGl,
          interactionHandlers,
          gpu.isLowPowerGpu
        );
        soundscape.spatialQuery.setBoxColliders(propsCtx.boxColliders);
        weatherSky.setShelterGeometry(propsCtx.shelters);
        propCircleColliders = propsCtx.circleColliders;
        const activeBp = getActiveBlueprint();
        minimap = createMinimapRenderer(activeBp, propsCtx.boardwalkZones, fogOfWar);

        const searchParams = new URLSearchParams(window.location.search);
        const viewParam = searchParams.get('view');
        const weatherParam = searchParams.get('weather') as WeatherId | null;
        const windParam = searchParams.get('wind');
        if (windParam !== null) {
          const parsedWind = Number(windParam);
          if (Number.isFinite(parsedWind)) {
            weatherSky.windOverride = Math.max(0, Math.min(2, parsedWind));
          }
        }
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
          const aimTarget = activeBp.bogPools[0] ?? { x: activeBp.bogCenterX, z: activeBp.bogCenterZ };
          player.yaw = Math.atan2(-(aimTarget.x - bx), -(aimTarget.z - bz));
          player.pitch = -0.14;
        } else {
          const camXRaw = searchParams.get('camX');
          const camZRaw = searchParams.get('camZ');
          if (camXRaw !== null && camZRaw !== null) {
            const cx = Number(camXRaw);
            const cz = Number(camZRaw);
            if (Number.isFinite(cx) && Number.isFinite(cz)) {
              player.pos.set(cx, getTerrainHeight(cx, cz), cz);
              const cyaw = Number(searchParams.get('camYaw'));
              const cpitch = Number(searchParams.get('camPitch'));
              if (Number.isFinite(cyaw)) player.yaw = cyaw;
              if (Number.isFinite(cpitch)) player.pitch = cpitch;
            }
          }
        }

        if (!await showLoadingStage('landscape')) return;
        vegetation = new WorldVegetationSystem(
          loadedTextures,
          gpu.isSoftwareGl,
          gpu.isLowPowerGpu,
          propsCtx.shelters
        );
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
        const bogShoreDepth = propsCtx.getBogShoreDepthInfo();
        terrainMgr.setBogShoreDepthMap(
          bogShoreDepth.texture,
          bogShoreDepth.centerX,
          bogShoreDepth.centerZ,
          bogShoreDepth.radius
        );
        const distances = qualityCtrl.smoothedQuality;
        await terrainMgr.prewarmAround(player.pos.x, player.pos.z, distances.maxRenderDist,
          distances.terrainLod0Dist, distances.terrainLod1Dist);
        if (disposed || cleanedUp) return;
        scene.add(terrainMgr.group);
        renderer.shadowMap.needsUpdate = true;

        renderer.domElement.dataset.wasmActive = String(engine.isWasmActive);

        if (!await showLoadingStage('rendering')) return;
        if (!gpu.isSoftwareGl) {
          weatherSky.setShaderCompilePreview(true);
          vegetation.setShaderCompilePreview(true);
          renderer.compile(scene, camera);
          vegetation.setShaderCompilePreview(false);
          weatherSky.setShaderCompilePreview(false);
          lastProgramCount = renderer.info.programs ? renderer.info.programs.length : 0;
        }

        worldInitReady = true;
        syncHudAndSnapshot();

        lastTime = performance.now();
        tick();
        callbacksRef.current.onWorldReady({
          wasmActive: engine.isWasmActive,
          totalMushrooms: propsCtx.mushroomCountTotal,
        });
      },
      cleanupResources: cleanupRuntime,
      onError: (message) => {
        callbacksRef.current.onWorldError?.(message);
      },
      isDisposed: () => disposed,
    });

    return () => {
      disposed = true;
      cleanupRuntime();
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
