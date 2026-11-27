import * as THREE from 'three';
import {
  addItemToInventory,
  CAMPFIRE_WOOD_COST,
  computeInventoryWeightKg,
  createDefaultPackingSelection,
  createInventoryFromPacking,
  dropBottle,
  getNavigationMode,
  hasFlashlight,
  hasRainJacket,
  hasSleepingBag,
  hasTent,
  InventoryState,
  ItemId,
  PackingSelection,
  removeStackItem,
  toggleWearClothing,
} from '../../game/itemCatalog';
import type { FpsDropLogger } from '../../game/perfLogger';
import { QualityMode, QualityProfile } from '../../game/qualityGovernor';
import {
  boilBottleAtCampfire,
  cookCampfireRecipe,
  createInitialSurvivalState,
  DiscoveryTracker,
  drinkFromBottle,
  eatFoodItem,
  loadFlashlightBattery,
  PlayerSurvivalState,
  refillBottlesFromSource,
  tryIgniteCampfire,
} from '../../game/survivalEngine';
import { getItemName, t } from '../../i18n/i18n';
import type { SleepSpotInfo, WorldInteractionHandlers, WorldPropsContext } from '../../world/architectureAndProps';
import type { MinimapRenderer } from '../../world/minimapMath';
import type { FogOfWarMap } from '../../world/minimapMath';
import type { SoundEngine } from '../../world/soundEngine';
import { saveSoundscapeSnapshotToStorage, SimulatorSoundscape } from '../../world/soundscapeAdapter';
import { getTerrainHeight, getWaterSurfaceAt } from '../../world/terrainMath';
import type { WeatherAndSkySystem, WeatherId } from '../../world/weatherAndSky';
import type { WorldActions, WorldCallbacks } from '../worldRuntimeContracts';
import type { DebugController } from './debugController';
import type { QualityAndDrsController } from './gpuAndQuality';
import type { HudBridge } from './hudBridge';
import type { PlayerController } from './playerController';

export interface SleepSession {
  spot: SleepSpotInfo;
  totalHours: number;
  elapsedHours: number;
  realDurationSec: number;
  orbitAngle: number;
  nearFireFactor: number;
}

export interface WorldActionsBuilderDeps {
  worldSeed: number;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  sound: SoundEngine;
  soundscape: SimulatorSoundscape;
  weatherSky: WeatherAndSkySystem;
  qualityCtrl: QualityAndDrsController;
  perfLogger: FpsDropLogger;
  player: PlayerController;
  hudBridge: HudBridge;
  debugCtrl: DebugController;
  discovery: DiscoveryTracker;
  fogOfWar: FogOfWarMap;
  getCallbacks: () => WorldCallbacks;
  getInitialPacking: () => PackingSelection;
  getPropsCtx: () => WorldPropsContext | null;
  getMinimap: () => MinimapRenderer | null;
  getInventory: () => InventoryState;
  setInventory: (inv: InventoryState) => void;
  getSurvival: () => PlayerSurvivalState;
  setSurvival: (s: PlayerSurvivalState) => void;
  getElapsed: () => number;
  getSimClockMs: () => number;
  getUiModalOpen: () => boolean;
  setUiModalOpen: (open: boolean) => void;
  getDiagnosticsOpen: () => boolean;
  setDiagnosticsOpen: (open: boolean) => void;
  getDebugPanelOpen: () => boolean;
  setDebugPanelOpen: (open: boolean) => void;
  setMouseDragging: (dragging: boolean) => void;
  setFlashlight: (on: boolean) => void;
  getFlashlightOn: () => boolean;
  toggleMuteState: () => boolean;
  getRefreshQualitySceneNow: () => ((profile: QualityProfile) => void) | null;
  setSleepSession: (session: SleepSession | null) => void;
  setCollapseTimer: (val: number) => void;
  onFinishSleep: (early: boolean) => void;
  onFinishInventoryChange: (beforePublish?: () => void) => void;
  onSyncHudAndSnapshot: () => void;
  onPushSurvivalSnapshot: () => void;
  onRestoreGameFocus: () => void;
  onRejectIfSwimming: () => boolean;
  onSetObservedWeather: (w: WeatherId) => void;
  onSetLastFogReveal: (x: number, z: number) => void;
  onClearHoverPrompt: () => void;
  isDisposedOrCleaned: () => boolean;
}

export function buildWorldActions(deps: WorldActionsBuilderDeps): WorldActions {
  return {
    startPlaying: (packingSelection: PackingSelection) => {
      const { player, hudBridge, discovery, fogOfWar, weatherSky, sound } = deps;
      sound.init();
      sound.resume();
      const nextInv = createInventoryFromPacking(packingSelection);
      deps.setInventory(nextInv);
      deps.setSurvival(createInitialSurvivalState(computeInventoryWeightKg(nextInv)));
      discovery.reset();
      discovery.markAroundWorldPos(player.pos.x, player.pos.z, 1);
      fogOfWar.reset();
      fogOfWar.revealAt(player.pos.x, player.pos.z);
      deps.onSetLastFogReveal(player.pos.x, player.pos.z);
      deps.setFlashlight(false);
      deps.setUiModalOpen(false);
      deps.setSleepSession(null);
      player.seatedTent = null;
      deps.setCollapseTimer(0);
      hudBridge.invalidateBars();
      hudBridge.resetMinimapCache();
      player.resetIdleMotionFlags(false);
      player.prevOnGround = true;
      player.fallPeakY = player.pos.y;
      player.fallFromJump = false;
      player.waterFallEmitted = false;
      player.prevInWater = false;
      player.climbingOutOfWater = false;
      deps.getCallbacks().onPhaseChange('playing');
      deps.renderer.domElement.focus({ preventScroll: true });
      deps.onSyncHudAndSnapshot();
      window.requestAnimationFrame(() => {
        if (deps.isDisposedOrCleaned()) return;
        hudBridge.syncBiomeAndWeatherLabels(
          player.pos.x,
          player.pos.z,
          weatherSky.timeOfDay,
          weatherSky.currentWeather
        );
        hudBridge.drawMinimapImmediate(
          deps.getMinimap(),
          deps.getInventory(),
          fogOfWar,
          player.pos.x,
          player.pos.z,
          player.yaw
        );
      });
    },
    resumePlaying: () => {
      deps.sound.init();
      deps.sound.resume();
      deps.setUiModalOpen(false);
      deps.player.resetIdleMotionFlags(false);
      deps.getCallbacks().onPhaseChange('playing');
      deps.renderer.domElement.focus({ preventScroll: true });
    },
    restartWorld: (packingSelection?: PackingSelection) => {
      const { player, hudBridge, discovery, fogOfWar, soundscape, sound } = deps;
      player.resetForRestart(true);
      const nextInv = createInventoryFromPacking(
        packingSelection ?? deps.getInitialPacking() ?? createDefaultPackingSelection()
      );
      deps.setInventory(nextInv);
      deps.setSurvival(createInitialSurvivalState(computeInventoryWeightKg(nextInv)));
      discovery.reset();
      discovery.markAroundWorldPos(player.pos.x, player.pos.z, 1);
      fogOfWar.reset();
      fogOfWar.revealAt(player.pos.x, player.pos.z);
      deps.onSetLastFogReveal(player.pos.x, player.pos.z);
      deps.setFlashlight(false);
      deps.setUiModalOpen(false);
      deps.setSleepSession(null);
      deps.setCollapseTimer(0);
      hudBridge.invalidateBars();
      hudBridge.resetMinimapCache();
      soundscape.engine.stopAuditionSounds();
      sound.resume();
      deps.getCallbacks().onPhaseChange('playing');
      deps.renderer.domElement.focus({ preventScroll: true });
      deps.onSyncHudAndSnapshot();
    },
    cycleWeather: () => {
      const w = deps.weatherSky.cycleWeather();
      deps.onSetObservedWeather(w);
      deps.perfLogger.recordEvent(`keyWeather->${w}`, performance.now());
      deps.debugCtrl.pushDebugEvent('game', 'weather.cycle', `Weather -> ${w}`);
      deps.getCallbacks().onToast(t('toast.weatherChanged', { weather: t(`weather.${w}`) }));
      deps.onPushSurvivalSnapshot();
    },
    advanceTime: () => {
      deps.weatherSky.advanceTime(2);
      deps.perfLogger.recordEvent(
        `keyTime->${deps.weatherSky.timeOfDay.toFixed(1)}h`,
        performance.now()
      );
      deps.getCallbacks().onToast(t('toast.timeAdvanced'));
      deps.onPushSurvivalSnapshot();
    },
    toggleFlashlight: () => {
      if (!deps.getFlashlightOn() && deps.onRejectIfSwimming()) return;
      const inventory = deps.getInventory();
      if (!hasFlashlight(inventory)) {
        deps.getCallbacks().onToast(t('toast.noFlashlight'));
        return;
      }
      if (!deps.getFlashlightOn() && inventory.flashlightBattery <= 0.5) {
        deps.getCallbacks().onToast(t('toast.batteryDead'));
        return;
      }
      const nextOn = !deps.getFlashlightOn();
      deps.setFlashlight(nextOn);
      deps.perfLogger.recordEvent(`flashlight->${nextOn ? 'on' : 'off'}`, performance.now());
      deps.sound.playImpact(0.3);
    },
    toggleMute: () => deps.toggleMuteState(),
    setResolutionScale: (scale: number | null) => {
      deps.qualityCtrl.setResolutionScale(scale, deps.renderer, deps.weatherSky);
    },
    setQualityMode: (mode: QualityMode) => {
      const prevMode = deps.qualityCtrl.governor.getMode();
      const transition = deps.qualityCtrl.governor.setMode(mode);
      const profile = deps.qualityCtrl.governor.getProfile();
      if (transition || prevMode !== mode) {
        deps.qualityCtrl.applyQualityProfileToScene(
          profile,
          deps.renderer,
          deps.weatherSky,
          deps.getRefreshQualitySceneNow(),
          true
        );
        deps.perfLogger.recordEvent(`qualityMode->${mode}(${profile.name})`, performance.now());
      }
    },
    setUiModalOpen: (open: boolean) => {
      const wasOpen = deps.getUiModalOpen();
      deps.setUiModalOpen(open);
      if (open) {
        deps.player.resetIdleMotionFlags();
        deps.setMouseDragging(false);
        if (document.pointerLockElement) document.exitPointerLock?.();
        deps.onPushSurvivalSnapshot();
      } else if (wasOpen) {
        deps.onRestoreGameFocus();
      }
    },
    setDiagnosticsOpen: (open: boolean) => {
      const wasOpen = deps.getDiagnosticsOpen();
      deps.setDiagnosticsOpen(open);
      if (open) {
        if (document.pointerLockElement) document.exitPointerLock?.();
        deps.setMouseDragging(false);
      } else if (wasOpen) {
        deps.onRestoreGameFocus();
      }
    },
    setDebugPanelOpen: (open: boolean) => {
      const wasOpen = deps.getDebugPanelOpen();
      deps.setDebugPanelOpen(open);
      if (open) {
        if (document.pointerLockElement) document.exitPointerLock?.();
        deps.setMouseDragging(false);
      } else if (wasOpen) {
        deps.onRestoreGameFocus();
      }
    },
    getSoundscapeDiagnostics: () => deps.soundscape.engine.getDiagnosticsSnapshot(),
    triggerSoundscapeEvent: (type: string, intensity = 1) => {
      deps.sound.init();
      deps.sound.resume();
      const { player } = deps;
      deps.soundscape.engine.emitEvent({
        type,
        origin: 'player',
        simulationTimestamp: deps.getSimClockMs(),
        position: { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z },
        intensity,
        payload: { material: 'wood', source: 'diagnostics' },
      });
    },
    auditionSoundscapeSound: (soundId: string) => {
      deps.sound.init();
      deps.sound.resume();
      return deps.soundscape.engine.auditionSound(soundId);
    },
    stopSoundscapeAudition: () => deps.soundscape.engine.stopAuditionSounds(),
    resetSoundscapeQuotas: () => {
      deps.soundscape.engine.resetQuotasAndCooldowns();
      saveSoundscapeSnapshotToStorage(deps.worldSeed, deps.soundscape.engine);
    },
    setSoundscapeBusVolume: (busId: string, vol: number) => {
      deps.soundscape.engine.setBusVolume(busId, vol);
    },
    setSoundscapeBusMuted: (busId: string, muted: boolean) => {
      deps.soundscape.engine.setBusMuted(busId, muted);
    },
    setSoundscapeMusicEnabled: (enabled: boolean) => {
      deps.soundscape.engine.setMusicEnabled(enabled);
    },
    setSoundscapeMusicVolume: (vol: number) => {
      deps.soundscape.engine.setMusicVolume(vol);
    },
    pauseSoundscapeVoice: (instanceId: string) => deps.soundscape.engine.pauseVoice(instanceId),
    resumeSoundscapeVoice: (instanceId: string) => deps.soundscape.engine.resumeVoice(instanceId),
    stopSoundscapeVoice: (instanceId: string) => deps.soundscape.engine.stopVoice(instanceId),
    reloadSoundscapeConfigJson: (json: string) => deps.soundscape.engine.reloadConfigFromJson(json),
    getSoundscapeConfigJson: () => JSON.stringify(deps.soundscape.engine.getRawConfig(), null, 2),
    eatItem: (itemId: ItemId) => {
      if (deps.onRejectIfSwimming()) return;
      const res = eatFoodItem(deps.getSurvival(), deps.getInventory(), itemId);
      if (res.ok) {
        deps.sound.playEatCrunch();
        if (res.poisoned) deps.player.vomitLurchTimer = 0.6;
      }
      deps.getCallbacks().onToast(res.message);
      if (res.ok) deps.onFinishInventoryChange();
    },
    drinkBottle: (uid: string) => {
      if (deps.onRejectIfSwimming()) return;
      const res = drinkFromBottle(deps.getSurvival(), deps.getInventory(), uid);
      if (res.ok) {
        deps.sound.playDrinkSip();
        if (res.poisoned) deps.player.vomitLurchTimer = 0.7;
      }
      deps.getCallbacks().onToast(res.message);
      if (res.ok) deps.onFinishInventoryChange();
    },
    loadBattery: () => {
      if (deps.onRejectIfSwimming()) return;
      const res = loadFlashlightBattery(deps.getInventory());
      if (res.ok) deps.sound.playImpact(0.35);
      deps.getCallbacks().onToast(res.message);
      if (res.ok) deps.onFinishInventoryChange();
    },
    dropItem: (itemId: ItemId) => {
      if (deps.onRejectIfSwimming()) return;
      const inventory = deps.getInventory();
      if (removeStackItem(inventory, itemId, 1)) {
        if (itemId === 'flashlight' && !hasFlashlight(inventory) && deps.getFlashlightOn()) {
          deps.setFlashlight(false);
        }
        deps.hudBridge.resetMinimapCache();
        deps.getCallbacks().onToast(t('toast.droppedItem', { name: getItemName(itemId) }));
        deps.onFinishInventoryChange();
      }
    },
    dropBottleByUid: (uid: string) => {
      if (deps.onRejectIfSwimming()) return;
      if (dropBottle(deps.getInventory(), uid)) {
        deps.getCallbacks().onToast(t('toast.droppedBottle'));
        deps.onFinishInventoryChange();
      }
    },
    dropBallast: () => {
      if (deps.onRejectIfSwimming()) return;
      deps.getInventory().debugBallastKg = 0;
      deps.debugCtrl.pushDebugEvent('debug', 'debug.ballast', 'Cleared debug ballast (0.00 kg)');
      deps.onFinishInventoryChange();
    },
    igniteCampfire: (campfireId: string) => {
      const propsCtx = deps.getPropsCtx();
      const res = tryIgniteCampfire(
        deps.getInventory(),
        deps.weatherSky.currentWeather,
        deps.getSurvival().wetness
      );
      deps.sound.playFireIgnite(res.ok);
      if (res.ok && propsCtx) {
        propsCtx.setCampfireLit(campfireId, true);
      }
      deps.getCallbacks().onToast(res.message);
      if (res.used) deps.onFinishInventoryChange();
      return propsCtx ? propsCtx.getCampfireInfo(campfireId) : null;
    },
    bankCampfire: (campfireId: string) => {
      const propsCtx = deps.getPropsCtx();
      if (propsCtx) {
        propsCtx.setCampfireLit(campfireId, false);
      }
      deps.sound.playImpact(0.45);
      deps.getCallbacks().onToast(t('toast.bankedFire'));
      deps.onPushSurvivalSnapshot();
      return propsCtx ? propsCtx.getCampfireInfo(campfireId) : null;
    },
    throwFirewoodIntoCampfire: (campfireId: string) => {
      const propsCtx = deps.getPropsCtx();
      if (!propsCtx) return null;
      const inventory = deps.getInventory();
      if ((inventory.stacks.firewood ?? 0) <= 0) {
        deps.getCallbacks().onToast(t('toast.noFirewoodToThrow'));
        return propsCtx.getCampfireInfo(campfireId);
      }
      if (removeStackItem(inventory, 'firewood', 1)) {
        deps.onFinishInventoryChange(() => {
          propsCtx.feedCampfireWithLog(campfireId);
        });
      }
      return propsCtx.getCampfireInfo(campfireId);
    },
    placeCampfireFromWood: () => {
      const propsCtx = deps.getPropsCtx();
      if (!propsCtx || deps.onRejectIfSwimming()) return null;
      const inventory = deps.getInventory();
      const woodHave = inventory.stacks.firewood ?? 0;
      if (woodHave < CAMPFIRE_WOOD_COST) {
        deps.getCallbacks().onToast(
          t('toast.needWood', { cost: CAMPFIRE_WOOD_COST, have: woodHave })
        );
        return null;
      }
      const { player } = deps;
      const fx = player.pos.x - Math.sin(player.yaw) * 2.3;
      const fz = player.pos.z - Math.cos(player.yaw) * 2.3;
      const placed = propsCtx.placePlayerCampfire(fx, fz);
      if (!placed.ok || !placed.campfire) {
        deps.getCallbacks().onToast(placed.message);
        return null;
      }
      removeStackItem(inventory, 'firewood', CAMPFIRE_WOOD_COST);
      deps.getCallbacks().onToast(placed.message);
      deps.onFinishInventoryChange();
      return placed.campfire;
    },
    pitchTent: () => {
      const propsCtx = deps.getPropsCtx();
      if (!propsCtx || deps.onRejectIfSwimming()) return null;
      const inventory = deps.getInventory();
      if (!hasTent(inventory)) {
        deps.getCallbacks().onToast(t('toast.noTent'));
        return null;
      }
      const { player } = deps;
      const tx = player.pos.x - Math.sin(player.yaw) * 3.85;
      const tz = player.pos.z - Math.cos(player.yaw) * 3.85;
      const placed = propsCtx.placePlayerTent(tx, tz, player.yaw + 0.42);
      if (!placed.ok || !placed.tent) {
        deps.getCallbacks().onToast(placed.message);
        return null;
      }
      removeStackItem(inventory, 'tent', 1);
      deps.getCallbacks().onToast(placed.message);
      deps.onFinishInventoryChange();
      return placed.tent;
    },
    sitInTent: (tentId?: string) => {
      const list = deps.getPropsCtx()?.getTents() ?? [];
      const target = tentId ? list.find((tt) => tt.id === tentId) : list[0];
      if (!target) return false;
      deps.player.enterTentSeat(target);
      return true;
    },
    standUpFromTent: () => {
      deps.player.exitTentSeat(false);
    },
    openSleepForSeatedTent: () => {
      const tt = deps.player.seatedTent;
      if (!tt) return;
      deps.setUiModalOpen(true);
      deps.player.resetIdleMotionFlags();
      if (document.pointerLockElement) document.exitPointerLock?.();
      deps.onPushSurvivalSnapshot();
      deps.getCallbacks().onOpenSleepModal({
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
      if (deps.onRejectIfSwimming()) return;
      const inventory = deps.getInventory();
      if (itemId === 'rain_jacket' && !hasRainJacket(inventory)) {
        deps.getCallbacks().onToast(t('toast.noRainJacket'));
        return;
      }
      const nowWorn = toggleWearClothing(inventory, itemId);
      if (nowWorn === null) return;
      deps.sound.init();
      deps.sound.resume();
      deps.sound.playFabricRustle(nowWorn);
      deps.getCallbacks().onToast(
        nowWorn ? t('toast.woreRainJacket') : t('toast.tookOffRainJacket')
      );
      deps.onFinishInventoryChange();
    },
    sleepInSleepingBag: () => {
      if (deps.onRejectIfSwimming()) return;
      const inventory = deps.getInventory();
      if (!hasSleepingBag(inventory)) {
        deps.getCallbacks().onToast(t('toast.noSleepingBag'));
        return;
      }
      const { player } = deps;
      const groundY = getTerrainHeight(player.pos.x, player.pos.z);
      const waterAt = getWaterSurfaceAt(player.pos.x, player.pos.z, undefined, groundY);
      if (waterAt.hasWater || groundY <= waterAt.waterY + 0.08 && waterAt.kind !== 'none') {
        deps.getCallbacks().onToast(t('toast.cannotSleepInWater'));
        return;
      }
      const envNow = deps.getPropsCtx()?.getEnvironmentStateAt(player.pos.x, player.pos.z);
      deps.setUiModalOpen(true);
      player.resetIdleMotionFlags();
      if (document.pointerLockElement) document.exitPointerLock?.();
      deps.onPushSurvivalSnapshot();
      deps.getCallbacks().onOpenSleepModal({
        kind: 'sleeping_bag',
        label: t('prop.sleepingBagSpotLabel'),
        x: player.pos.x,
        y: groundY + 0.12,
        z: player.pos.z,
        shelter: envNow?.shelter ?? 'outdoor',
      });
    },
    cookAtCampfire: (recipe: 'seared_steak' | 'roasted_mushrooms') => {
      const res = cookCampfireRecipe(deps.getInventory(), recipe);
      if (res.ok) deps.sound.playCookSizzle();
      deps.getCallbacks().onToast(res.message);
      if (res.ok) deps.onFinishInventoryChange();
    },
    boilBottle: (uid: string) => {
      const res = boilBottleAtCampfire(deps.getInventory(), uid);
      if (res.ok) deps.sound.playCookSizzle();
      deps.getCallbacks().onToast(res.message);
      if (res.ok) deps.onFinishInventoryChange();
    },
    startSleep: (spot: SleepSpotInfo, hours: number) => {
      if (document.pointerLockElement) document.exitPointerLock?.();
      const { player } = deps;
      const propsCtx = deps.getPropsCtx();
      player.resetIdleMotionFlags();
      deps.setUiModalOpen(false);
      if (player.seatedTent && spot.kind !== 'tent') {
        player.exitTentSeat(true);
      }
      const clampedHrs = THREE.MathUtils.clamp(Math.round(hours), 1, 10);
      const envNow = propsCtx?.getEnvironmentStateAt(spot.x, spot.z);
      const fireFactor =
        spot.kind === 'campfire' && spot.campfireId && propsCtx?.getCampfireInfo(spot.campfireId)?.lit
          ? 0.95
          : envNow?.nearLitCampfireFactor ?? 0;
      deps.setSleepSession({
        spot,
        totalHours: clampedHrs,
        elapsedHours: 0,
        realDurationSec: Math.max(5.2, clampedHrs * 1.0),
        orbitAngle: Math.atan2(player.pos.x - spot.x, player.pos.z - spot.z),
        nearFireFactor: fireFactor,
      });
      deps.getCallbacks().onPhaseChange('sleeping');
      deps.onPushSurvivalSnapshot();
    },
    wakeEarly: () => {
      deps.onFinishSleep(true);
    },
    renderFullMap: (canvas: HTMLCanvasElement, zoom: number, panX: number, panZ: number) => {
      const minimap = deps.getMinimap();
      if (!minimap) return;
      const propsCtx = deps.getPropsCtx();
      const { player } = deps;
      const navMode = getNavigationMode(deps.getInventory());
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
    getDebugSnapshot: () => deps.debugCtrl.buildDebugSnapshot(),
    getDebugActions: () => deps.debugCtrl.actions,
  };
}

const _throwEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _throwDir = new THREE.Vector3();

export function buildWorldInteractionHandlers(deps: {
  player: PlayerController;
  camera: THREE.PerspectiveCamera;
  sound: SoundEngine;
  soundscape: SimulatorSoundscape;
  debugCtrl: DebugController;
  getPropsCtx: () => WorldPropsContext | null;
  getInventory: () => InventoryState;
  getElapsed: () => number;
  getSimClockMs: () => number;
  setUiModalOpen: (open: boolean) => void;
  getCallbacks: () => WorldCallbacks;
  onFinishInventoryChange: (beforePublish?: () => void) => void;
  onPushSurvivalSnapshot: () => void;
  onClearHoverPromptKey: () => void;
}): WorldInteractionHandlers {
  return {
    onOpenSleep: (spot) => {
      deps.setUiModalOpen(true);
      deps.player.resetIdleMotionFlags();
      if (document.pointerLockElement) document.exitPointerLock?.();
      deps.onPushSurvivalSnapshot();
      deps.getCallbacks().onOpenSleepModal(spot);
    },
    onOpenCampfire: (campfire) => {
      deps.setUiModalOpen(true);
      deps.player.resetIdleMotionFlags();
      if (document.pointerLockElement) document.exitPointerLock?.();
      deps.onPushSurvivalSnapshot();
      deps.getCallbacks().onOpenCampfireModal(campfire);
    },
    onPackUpTent: (tentId) => {
      if (deps.player.seatedTent?.id === tentId) {
        deps.player.exitTentSeat(true);
      }
      addItemToInventory(deps.getInventory(), 'tent', 1);
      deps.sound.playImpact(0.5);
      deps.getCallbacks().onToast(t('prop.tentPackedUp'));
      deps.onFinishInventoryChange();
    },
    onRefillWell: (source) => {
      const res = refillBottlesFromSource(deps.getInventory(), source);
      deps.getCallbacks().onToast(res.message);
      if (res.refilledCount > 0) deps.onFinishInventoryChange();
    },
    onLootCrate: (_crateId, label, loot) => {
      const names: string[] = [];
      for (const entry of loot) {
        addItemToInventory(deps.getInventory(), entry.itemId, entry.qty);
        names.push(`${entry.qty}× ${getItemName(entry.itemId)}`);
      }
      deps.getCallbacks().onToast(t('prop.lootedCrate', { label, items: names.join(', ') }));
      deps.onFinishInventoryChange();
    },
    onDoorToggle: (info) => {
      deps.soundscape.engine.emitEvent({
        type: info.open ? 'object.door.open' : 'object.door.close',
        origin: 'player',
        simulationTimestamp: deps.getSimClockMs(),
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
      const elapsed = deps.getElapsed();
      const simClockMs = deps.getSimClockMs();
      const corrId = `stump_${Math.round(info.x)}_${Math.round(info.z)}_${Math.round(simClockMs)}`;
      deps.soundscape.engine.emitEvent({
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
      deps.soundscape.engine.emitEvent({
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
    hasFirewoodInPack: () => (deps.getInventory().stacks.firewood ?? 0) > 0,
    onThrowFirewoodAtCampfire: (campfire) => {
      const propsCtx = deps.getPropsCtx();
      if (!propsCtx) return;
      const inventory = deps.getInventory();
      if ((inventory.stacks.firewood ?? 0) <= 0) {
        deps.getCallbacks().onToast(t('toast.noFirewoodToThrow'));
        return;
      }
      if (!removeStackItem(inventory, 'firewood', 1)) return;
      _throwEuler.set(deps.player.pitch, deps.player.yaw, 0, 'YXZ');
      _throwDir.set(0, 0, -1).applyEuler(_throwEuler);
      const sx = deps.camera.position.x + _throwDir.x * 0.55;
      const sy = deps.camera.position.y - 0.18 + _throwDir.y * 0.35;
      const sz = deps.camera.position.z + _throwDir.z * 0.55;
      propsCtx.throwFirewoodAtCampfire(campfire.id, sx, sy, sz);
      deps.sound.playImpact(0.32);
      deps.onClearHoverPromptKey();
      deps.debugCtrl.pushDebugEvent('game', 'campfire.throw_log', `Threw firewood toward ${campfire.label}`);
      deps.onFinishInventoryChange();
    },
    onCampfireLogImpact: (campfire, lit, x, y, z) => {
      deps.soundscape.engine.emitEvent({
        type: 'object.impact',
        origin: 'environment',
        simulationTimestamp: deps.getSimClockMs(),
        position: { x, y, z },
        intensity: lit ? 0.9 : 0.55,
        dedupeKey: `campfire_log_${campfire.id}_${Math.floor(deps.getElapsed() * 4)}`,
        dedupeWindowMs: 120,
        payload: { material: 'wood', breakable: false, broken: false },
      });
      deps.getCallbacks().onToast(lit ? t('toast.threwLogLit') : t('toast.threwLogCold'));
      deps.debugCtrl.pushDebugEvent(
        'game',
        'campfire.log_landed',
        `Firewood landed in ${campfire.label} (${lit ? 'lit — spark burst!' : 'cold pit'})`
      );
    },
    onCampfireLogCaughtFire: (campfire) => {
      deps.debugCtrl.pushDebugEvent(
        'game',
        'campfire.log_caught_fire',
        `Thrown log caught fire at ${campfire.label}`
      );
    },
  };
}
