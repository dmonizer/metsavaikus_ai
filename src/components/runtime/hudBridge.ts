import * as THREE from 'three';
import {
  cloneInventory,
  getNavigationMode,
  InventoryState,
  isWearingRainJacket,
  NavigationMode,
} from '../../game/itemCatalog';
import { formatGameHour, PlayerSurvivalState } from '../../game/survivalEngine';
import { getLocalizedBiomeLabel, getWeatherLabel, t } from '../../i18n/i18n';
import { FogOfWarMap, formatCompassLabel, MinimapRenderer } from '../../world/minimapMath';
import { getBiomeInfo } from '../../world/terrainMath';
import { WeatherId } from '../../world/weatherAndSky';
import type { WorldHudRefs, WorldSurvivalSnapshot } from '../worldRuntimeContracts';

export interface HudSnapshotInput {
  survival: PlayerSurvivalState;
  inventory: InventoryState;
  fogOfWar: FogOfWarMap;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  hourOfDay: number;
  weather: WeatherId;
  windStrength: number;
  shelterLabel: string | null;
  nearLitCampfireFactor: number;
  seatedInTent: boolean;
  isSwimming: boolean;
  waterDepthM: number;
  sleepProgress: { elapsedHours: number; totalHours: number; spotLabel: string } | null;
  collapseProgress: number;
}

export class HudBridge {
  private lastBarHealth = -1;
  private lastBarEnergy = -1;
  private lastBarHydration = -1;
  private lastBarFullness = -1;
  private lastBarTiredness = -1;
  private lastTempText = '';
  private lastCondText = '';

  lastMinimapCanvas: HTMLCanvasElement | null = null;
  lastMinimapMode: NavigationMode = 'none';
  lastMinimapYaw = 999;
  lastMinimapX = 999999;
  lastMinimapZ = 999999;
  lastMinimapFogVersion = -1;

  constructor(private readonly hudRefs: WorldHudRefs) {}

  invalidateBars(): void {
    this.lastBarHealth = -1;
    this.lastBarEnergy = -1;
    this.lastBarHydration = -1;
    this.lastBarFullness = -1;
    this.lastBarTiredness = -1;
  }

  invalidateConditions(): void {
    this.lastCondText = '';
  }

  resetMinimapCache(): void {
    this.lastMinimapCanvas = null;
    this.lastMinimapFogVersion = -1;
  }

  syncVitalHudDom(
    survival: PlayerSurvivalState,
    inventory: InventoryState,
    nearFireFactor: number,
    isSwimming: boolean
  ): void {
    const refs = this.hudRefs;
    if (refs.healthFillEl.current && Math.abs(survival.health - this.lastBarHealth) > 0.25) {
      this.lastBarHealth = survival.health;
      refs.healthFillEl.current.style.transform = `scaleX(${(survival.health / 100).toFixed(3)})`;
    }
    if (refs.energyFillEl.current && Math.abs(survival.energy - this.lastBarEnergy) > 0.25) {
      this.lastBarEnergy = survival.energy;
      refs.energyFillEl.current.style.transform = `scaleX(${(survival.energy / 100).toFixed(3)})`;
    }
    if (refs.hydrationFillEl.current && Math.abs(survival.hydration - this.lastBarHydration) > 0.25) {
      this.lastBarHydration = survival.hydration;
      refs.hydrationFillEl.current.style.transform = `scaleX(${(survival.hydration / 100).toFixed(3)})`;
    }
    if (refs.fullnessFillEl.current && Math.abs(survival.stomachFullness - this.lastBarFullness) > 0.25) {
      this.lastBarFullness = survival.stomachFullness;
      refs.fullnessFillEl.current.style.transform = `scaleX(${(survival.stomachFullness / 100).toFixed(3)})`;
    }
    if (refs.tirednessFillEl.current && Math.abs(survival.physicalTiredness - this.lastBarTiredness) > 0.25) {
      this.lastBarTiredness = survival.physicalTiredness;
      refs.tirednessFillEl.current.style.transform = `scaleX(${(survival.physicalTiredness / 100).toFixed(3)})`;
    }
    if (refs.bodyTempEl.current) {
      const txt = `${survival.bodyTempC.toFixed(1)}°C`;
      if (txt !== this.lastTempText) {
        this.lastTempText = txt;
        refs.bodyTempEl.current.textContent = txt;
      }
    }
    if (refs.conditionsEl.current) {
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
      if (nearFireFactor > 0.25) conds.push(t('cond.warm'));
      if (isSwimming) conds.push(t('cond.swimming'));
      if (isWearingRainJacket(inventory)) conds.push(t('cond.rainJacket'));
      const nextCond = conds.slice(0, 4).join(' · ');
      if (nextCond !== this.lastCondText) {
        this.lastCondText = nextCond;
        refs.conditionsEl.current.textContent = nextCond;
      }
    }

    if (refs.frostVignetteEl.current) {
      const frost = THREE.MathUtils.clamp((35.8 - survival.bodyTempC) / 2.2, 0, 1) * 0.72;
      refs.frostVignetteEl.current.style.opacity = frost.toFixed(3);
    }
    if (refs.nauseaVignetteEl.current) {
      const nau = THREE.MathUtils.clamp(survival.nausea / 100, 0, 1) * 0.62;
      refs.nauseaVignetteEl.current.style.opacity = nau.toFixed(3);
    }
    if (refs.drowsyVignetteEl.current) {
      const drowsy = THREE.MathUtils.clamp((25 - survival.energy) / 25, 0, 1) * 0.52;
      refs.drowsyVignetteEl.current.style.opacity = drowsy.toFixed(3);
    }
  }

  buildSurvivalSnapshot(input: HudSnapshotInput): WorldSurvivalSnapshot {
    return {
      survival: {
        ...input.survival,
        poisons: input.survival.poisons.map((p) => ({ ...p })),
        deathFactors: [...input.survival.deathFactors],
      },
      inventory: cloneInventory(input.inventory),
      navigationMode: getNavigationMode(input.inventory),
      discoveredPercent: input.fogOfWar.getExploredPercent(),
      fogVersion: input.fogOfWar.version,
      playerX: input.playerX,
      playerZ: input.playerZ,
      playerYaw: input.playerYaw,
      hourOfDay: input.hourOfDay,
      weather: input.weather,
      windStrength: input.windStrength,
      shelterLabel: input.seatedInTent ? t('prop.tentSpotLabel') : input.shelterLabel,
      nearLitCampfireFactor: input.nearLitCampfireFactor,
      seatedInTent: input.seatedInTent,
      wearingRainJacket: isWearingRainJacket(input.inventory),
      isSwimming: input.isSwimming,
      waterDepthM: input.waterDepthM,
      sleepProgress: input.sleepProgress,
      collapseProgress: input.collapseProgress,
    };
  }

  syncBiomeAndWeatherLabels(
    playerX: number,
    playerZ: number,
    hourOfDay: number,
    weather: WeatherId,
    timeLabel?: string
  ): void {
    if (this.hudRefs.biomeEl.current) {
      const b = getBiomeInfo(playerX, playerZ);
      this.hudRefs.biomeEl.current.textContent = getLocalizedBiomeLabel(b.id, b.label);
    }
    if (this.hudRefs.timeWeatherEl.current) {
      const tStr = timeLabel ?? formatGameHour(hourOfDay);
      this.hudRefs.timeWeatherEl.current.textContent = `${tStr} · ${getWeatherLabel(weather)}`;
    }
  }

  drawMinimapImmediate(
    minimap: MinimapRenderer | null,
    inventory: InventoryState,
    fogOfWar: FogOfWarMap,
    playerX: number,
    playerZ: number,
    playerYaw: number,
    updatePos = false
  ): void {
    const mmCanvas = this.hudRefs.minimapCanvasEl.current;
    const navMode = getNavigationMode(inventory);
    if (!mmCanvas || !minimap || navMode === 'none') return;
    this.lastMinimapCanvas = mmCanvas;
    this.lastMinimapMode = navMode;
    this.lastMinimapYaw = playerYaw;
    if (updatePos) {
      this.lastMinimapX = playerX;
      this.lastMinimapZ = playerZ;
    }
    this.lastMinimapFogVersion = fogOfWar.version;
    minimap.draw(mmCanvas, playerX, playerZ, playerYaw, navMode);
    if (this.hudRefs.compassHeadingEl.current && (navMode === 'compass' || navMode === 'both')) {
      this.hudRefs.compassHeadingEl.current.textContent = formatCompassLabel(playerYaw);
    }
  }

  maybeRedrawMinimap(
    minimap: MinimapRenderer | null,
    inventory: InventoryState,
    fogOfWar: FogOfWarMap,
    playerX: number,
    playerZ: number,
    playerYaw: number,
    minimapTimer: number
  ): { redrew: boolean; minimapMs: number } {
    const navMode = getNavigationMode(inventory);
    const mmCanvas = this.hudRefs.minimapCanvasEl.current;
    if (!mmCanvas || !minimap || navMode === 'none') {
      return { redrew: false, minimapMs: 0 };
    }
    const needsYawRedraw = navMode === 'compass' || navMode === 'both';
    const needsPosRedraw = navMode === 'both';
    const needsFogRedraw =
      (navMode === 'map' || navMode === 'both') &&
      fogOfWar.version !== this.lastMinimapFogVersion;
    const posMoved =
      needsPosRedraw &&
      (Math.abs(playerX - this.lastMinimapX) > 0.35 ||
        Math.abs(playerZ - this.lastMinimapZ) > 0.35);
    const mmChanged =
      mmCanvas !== this.lastMinimapCanvas ||
      navMode !== this.lastMinimapMode ||
      needsFogRedraw ||
      posMoved ||
      (needsYawRedraw && Math.abs(playerYaw - this.lastMinimapYaw) > 0.012);
    if (
      !mmChanged ||
      !(
        mmCanvas !== this.lastMinimapCanvas ||
        navMode !== this.lastMinimapMode ||
        needsFogRedraw ||
        minimapTimer >= 0.066
      )
    ) {
      return { redrew: false, minimapMs: 0 };
    }

    const tm0 = performance.now();
    this.lastMinimapCanvas = mmCanvas;
    this.lastMinimapMode = navMode;
    this.lastMinimapYaw = playerYaw;
    this.lastMinimapX = playerX;
    this.lastMinimapZ = playerZ;
    this.lastMinimapFogVersion = fogOfWar.version;
    minimap.draw(mmCanvas, playerX, playerZ, playerYaw, navMode);
    if (this.hudRefs.compassHeadingEl.current && needsYawRedraw) {
      this.hudRefs.compassHeadingEl.current.textContent = formatCompassLabel(playerYaw);
    }
    return { redrew: true, minimapMs: performance.now() - tm0 };
  }
}
