import {
  addItemToInventory,
  computeClothingBonuses,
  computeInventoryWeightKg,
  computeSleepGearBonuses,
  consumeEdibleMushrooms,
  InventoryState,
  ITEM_CATALOG,
  ItemId,
  PoisonKind,
  removeStackItem,
  WaterBottleInstance,
  WaterQuality,
} from './itemCatalog';
import { clamp, TOTAL_CHUNK_GRID, worldToVirtualChunk } from '../world/terrainMath';
import { getItemName, getPoisonLabel, t } from '../i18n/i18n';

export type LocomotionState = 'idle' | 'walk' | 'run' | 'swamp' | 'swim';
export type ShelterQuality = 'outdoor' | 'tent' | 'drafty_hut' | 'warm_house';
export type LoadTier = 'light' | 'moderate' | 'heavy' | 'overburdened';
export type HypothermiaStage = 'normal' | 'cool' | 'chilly' | 'hypothermia' | 'severe';

export interface ActivePoisonEffect {
  kind: PoisonKind;
  label: string;
  remainingHours: number;
  delayHours: number;
  damagePerHour: number;
  vomitIntervalHours: number;
  nextVomitInHours: number;
  vomitsLeft: number;
  nauseaBoost: number;
}

export interface PlayerSurvivalState {
  health: number; // 0-100
  energy: number; // 0-100 (refilled by sleep)
  stomachFullness: number; // 0-100
  /** Weighted digestion burn rate: 0.52 (steak) .. 1.0 (normal) .. 2.25 (chocolate) */
  digestionBurnRate: number;
  hydration: number; // 0-100
  /** Recently gulped unabsorbed water in liters; creates temporary heaviness & extra energy drain */
  waterStomachLoadL: number;
  physicalTiredness: number; // 0-100 (builds from exertion, recovers during rest/calm walking)
  awakeHours: number; // continuous hours awake since sleep
  bodyTempC: number; // 32.0 - 37.5°C (core body temperature)
  feelsLikeC: number; // ambient apparent temperature factoring windchill + wetness + fire
  wetness: number; // 0-100%
  nausea: number; // 0-100%
  poisons: ActivePoisonEffect[];
  backpackWeightKg: number;
  totalEffectiveWeightKg: number;
  loadTier: LoadTier;
  tiringMultiplier: number;
  stomachDrainMultiplier: number;
  energyLoadMultiplier: number;
  hypothermiaStage: HypothermiaStage;
  survivalHoursTotal: number;
  deathCause: string | null;
  deathFactors: string[];
}

export interface WeightTierThresholds {
  moderateKg: number;
  heavyKg: number;
  overburdenedKg: number;
}

export const DEFAULT_WEIGHT_THRESHOLDS: WeightTierThresholds = {
  moderateKg: 3.8,
  heavyKg: 6.2,
  overburdenedKg: 9.5,
};

export interface SurvivalEnvInput {
  locomotion: LocomotionState;
  jumpedThisFrame?: boolean;
  seatedInTent?: boolean;
  weather: 'clear' | 'mist' | 'rain' | 'storm';
  windStrength: number;
  hourOfDay: number;
  shelter: ShelterQuality;
  nearLitCampfireFactor: number; // 0 (far) .. 1 (right beside lit campfire)
  flashlightActive: boolean;
  godMode?: boolean;
  weightThresholds?: Partial<WeightTierThresholds>;
}

export interface SurvivalTickEvents {
  vomited: boolean;
  vomitSource: string | null;
  died: boolean;
  flashlightDepleted: boolean;
  toastMessage: string | null;
}

export interface WeightBurdenMetrics {
  effectiveWeightKg: number;
  loadTier: LoadTier;
  tiringMultiplier: number;
  stomachDrainMultiplier: number;
  energyLoadMultiplier: number;
  moveSpeedMultiplier: number;
}

export interface SleepPreview {
  hours: number;
  startHour: number;
  wakeHour: number;
  startEnergy: number;
  projectedEnergy: number;
  energyCap: number;
  projectedFullness: number;
  projectedHydration: number;
  projectedBodyTempC: number;
  avgFeelsLikeC: number;
  coldDuringSleep: boolean;
  stomachEmptyDuringSleep: boolean;
  exposedToRain: boolean;
  hasSleepingBag: boolean;
  sleepGearWarmthBonusC: number;
  warnings: string[];
}

export function createInitialSurvivalState(backpackWeightKg = 2.5): PlayerSurvivalState {
  const burden = computeWeightBurden(backpackWeightKg, 0);
  return {
    health: 100,
    energy: 92,
    stomachFullness: 78,
    digestionBurnRate: 0.95,
    hydration: 84,
    waterStomachLoadL: 0,
    physicalTiredness: 0,
    awakeHours: 2.0,
    bodyTempC: 37.0,
    feelsLikeC: 14.0,
    wetness: 0,
    nausea: 0,
    poisons: [],
    backpackWeightKg,
    totalEffectiveWeightKg: burden.effectiveWeightKg,
    loadTier: burden.loadTier,
    tiringMultiplier: burden.tiringMultiplier,
    stomachDrainMultiplier: burden.stomachDrainMultiplier,
    energyLoadMultiplier: burden.energyLoadMultiplier,
    hypothermiaStage: 'normal',
    survivalHoursTotal: 0,
    deathCause: null,
    deathFactors: [],
  };
}

/**
 * Computes pack-weight and ingested-water-load exertion & calorie multipliers.
 * Light packs (<= 3.0 kg) carry minimal penalty; heavy packs and rapid water gulping
 * significantly increase tiring speed, stomach calorie burn, and energy drain.
 */
export function computeWeightBurden(
  backpackWeightKg: number,
  waterStomachLoadL: number,
  thresholds?: Partial<WeightTierThresholds>
): WeightBurdenMetrics {
  const waterLoadKg = Math.max(0, waterStomachLoadL) * 1.45;
  const effectiveWeightKg = Math.round((Math.max(0, backpackWeightKg) + waterLoadKg) * 100) / 100;
  const excessKg = Math.max(0, effectiveWeightKg - 3.0);

  const moderateKg = Math.max(0.2, thresholds?.moderateKg ?? DEFAULT_WEIGHT_THRESHOLDS.moderateKg);
  const heavyKg = Math.max(moderateKg + 0.2, thresholds?.heavyKg ?? DEFAULT_WEIGHT_THRESHOLDS.heavyKg);
  const overburdenedKg = Math.max(
    heavyKg + 0.2,
    thresholds?.overburdenedKg ?? DEFAULT_WEIGHT_THRESHOLDS.overburdenedKg
  );

  const tiringMultiplier = Math.round((1 + excessKg * 0.14 + Math.max(0, waterStomachLoadL - 0.35) * 0.45) * 100) / 100;
  const stomachDrainMultiplier = Math.round((1 + excessKg * 0.085) * 100) / 100;
  // Drinking a lot quickly adds extra sloshing energy drain on top of pack weight
  const waterSloshEnergyPenalty = Math.max(0, waterStomachLoadL - 0.35) * 0.55;
  const energyLoadMultiplier =
    Math.round((1 + excessKg * 0.065 + waterSloshEnergyPenalty) * 100) / 100;
  const moveSpeedMultiplier = clamp(1 - Math.max(0, effectiveWeightKg - 5.0) * 0.028, 0.72, 1.0);

  let loadTier: LoadTier = 'light';
  if (effectiveWeightKg >= overburdenedKg) loadTier = 'overburdened';
  else if (effectiveWeightKg >= heavyKg) loadTier = 'heavy';
  else if (effectiveWeightKg >= moderateKg) loadTier = 'moderate';

  return {
    effectiveWeightKg,
    loadTier,
    tiringMultiplier: clamp(tiringMultiplier, 1.0, 2.6),
    stomachDrainMultiplier: clamp(stomachDrainMultiplier, 1.0, 1.85),
    energyLoadMultiplier: clamp(energyLoadMultiplier, 1.0, 1.95),
    moveSpeedMultiplier,
  };
}

/**
 * Computes realistic Baltic air temperature + live windchill + wetness chill + shelter/fire warmth.
 */
export function computeFeelsLikeTempC(
  hourOfDay: number,
  weather: 'clear' | 'mist' | 'rain' | 'storm',
  windStrength: number,
  wetness: number,
  shelter: ShelterQuality,
  nearLitCampfireFactor: number,
  clothingWarmthBonusC = 0
): { airTempC: number; windchillDropC: number; feelsLikeC: number } {
  // Diurnal curve: warmest ~15:00 (15.5°C), coldest ~04:00 (4.5°C)
  const diurnal = Math.sin(((hourOfDay - 9) / 24) * Math.PI * 2);
  let airTempC = 10.0 + diurnal * 5.5;

  if (weather === 'mist') airTempC -= 1.8;
  else if (weather === 'rain') airTempC -= 3.6;
  else if (weather === 'storm') airTempC -= 5.8;

  // Roofed buildings & pitched tents shield against wind and trap ambient warmth
  const windExposure =
    shelter === 'warm_house'
      ? 0.12
      : shelter === 'tent'
        ? 0.18
        : shelter === 'drafty_hut'
          ? 0.38
          : 1.0;
  const shelterWarmth =
    shelter === 'warm_house'
      ? 5.8
      : shelter === 'tent'
        ? 3.6
        : shelter === 'drafty_hut'
          ? 2.4
          : 0;

  // Windchill increases with wind speed and amplifies sharply when clothes are wet
  const wetRatio = clamp(wetness / 100, 0, 1);
  const effectiveWind = Math.max(0, windStrength) * windExposure;
  const windchillDropC = effectiveWind * (2.35 + wetRatio * 3.1) + wetRatio * 3.2;

  const fireWarmth = clamp(nearLitCampfireFactor, 0, 1) * 19.0;
  const feelsLikeC = airTempC - windchillDropC + shelterWarmth + fireWarmth + clothingWarmthBonusC;

  return {
    airTempC: Math.round(airTempC * 10) / 10,
    windchillDropC: Math.round(windchillDropC * 10) / 10,
    feelsLikeC: Math.round(feelsLikeC * 10) / 10,
  };
}

export function classifyHypothermia(bodyTempC: number): HypothermiaStage {
  if (bodyTempC < 33.8) return 'severe';
  if (bodyTempC < 35.0) return 'hypothermia';
  if (bodyTempC < 35.8) return 'chilly';
  if (bodyTempC < 36.4) return 'cool';
  return 'normal';
}

/**
 * Poison vulnerability multiplier: effects are significantly worse if already
 * cold/hypothermic, hungry, dehydrated, or sleep-deprived.
 */
export function computePoisonVulnerability(state: PlayerSurvivalState): number {
  let mult = 1.0;
  if (state.bodyTempC < 35.8) mult += 0.25;
  if (state.bodyTempC < 35.0) mult += 0.25;
  if (state.stomachFullness < 25) mult += 0.28;
  if (state.hydration < 25) mult += 0.22;
  if (state.awakeHours > 18) mult += 0.25;
  if (state.energy < 22) mult += 0.2;
  return Math.round(clamp(mult, 1.0, 2.45) * 100) / 100;
}

export function createPoisonEffect(kind: PoisonKind, severity = 1.0): ActivePoisonEffect {
  switch (kind) {
    case 'bitter':
      return {
        kind,
        label: getPoisonLabel(kind),
        remainingHours: 0.9,
        delayHours: 0,
        damagePerHour: 7 * severity,
        vomitIntervalHours: 0,
        nextVomitInHours: 99,
        vomitsLeft: 0,
        nauseaBoost: 24 * severity,
      };
    case 'bog_water':
      return {
        kind,
        label: getPoisonLabel(kind),
        remainingHours: 1.6,
        delayHours: 0.08,
        damagePerHour: 8.5 * severity,
        vomitIntervalHours: 0.9,
        nextVomitInHours: 0.45,
        vomitsLeft: 1,
        nauseaBoost: 42 * severity,
      };
    case 'fly_agaric':
      return {
        kind,
        label: getPoisonLabel(kind),
        remainingHours: 2.6,
        delayHours: 0.05,
        damagePerHour: 11.5 * severity,
        vomitIntervalHours: 0.55,
        nextVomitInHours: 0.12,
        vomitsLeft: 3,
        nauseaBoost: 78 * severity,
      };
    case 'stale_water':
      return {
        kind,
        label: getPoisonLabel(kind),
        remainingHours: 2.4,
        delayHours: 0.05,
        damagePerHour: 11.0 * severity,
        vomitIntervalHours: 0.55,
        nextVomitInHours: 0.14,
        vomitsLeft: 3,
        nauseaBoost: 74 * severity,
      };
    case 'destroying_angel':
      return {
        kind,
        label: getPoisonLabel(kind),
        remainingHours: 3.4,
        delayHours: 0.18,
        damagePerHour: 36.0 * severity,
        vomitIntervalHours: 0.75,
        nextVomitInHours: 0.35,
        vomitsLeft: 2,
        nauseaBoost: 86 * severity,
      };
  }
}

function recordCollapseIfDead(
  state: PlayerSurvivalState,
  primaryCause: string
): boolean {
  if (state.health > 0) return false;
  state.health = 0;
  if (!state.deathCause) {
    state.deathCause = primaryCause;
    const factors: string[] = [];
    if (state.bodyTempC < 35.4) {
      factors.push(t('deathFactor.hypothermia', { temp: state.bodyTempC.toFixed(1) }));
    }
    if (state.wetness > 50) {
      factors.push(t('deathFactor.soaked', { pct: Math.round(state.wetness) }));
    }
    if (state.stomachFullness < 20) factors.push(t('deathFactor.emptyStomach'));
    if (state.hydration < 20) factors.push(t('deathFactor.dehydrated'));
    if (state.awakeHours > 18 || state.energy < 20) {
      factors.push(t('deathFactor.sleepDeprived', { hours: state.awakeHours.toFixed(1) }));
    }
    if (state.poisons.length > 0) {
      const pLabel = getPoisonLabel(state.poisons[0].kind);
      if (!primaryCause.includes(pLabel)) factors.push(pLabel);
    }
    state.deathFactors = factors;
  }
  return true;
}

/**
 * Advances continuous survival physiology by dtSec (real seconds) and gameHoursDelta (in-game hours).
 * Zero allocations in steady state (only returns a tiny plain events struct or mutates outEvents).
 */
export function stepSurvivalTick(
  state: PlayerSurvivalState,
  inv: InventoryState,
  env: SurvivalEnvInput,
  dtSec: number,
  gameHoursDelta: number,
  outEvents?: SurvivalTickEvents
): SurvivalTickEvents {
  const ev: SurvivalTickEvents = outEvents ?? {
    vomited: false,
    vomitSource: null,
    died: false,
    flashlightDepleted: false,
    toastMessage: null,
  };
  ev.vomited = false;
  ev.vomitSource = null;
  ev.died = false;
  ev.flashlightDepleted = false;
  ev.toastMessage = null;

  const godMode = Boolean(env.godMode);
  if (dtSec <= 0 || (state.health <= 0 && !godMode)) return ev;
  if (godMode) {
    state.deathCause = null;
    state.deathFactors = [];
  }

  const dtMin = dtSec / 60;
  const gHrs = Math.max(0, gameHoursDelta);
  state.survivalHoursTotal += gHrs;
  state.awakeHours += gHrs;

  // 1. Pack weight & ingested water absorption
  state.waterStomachLoadL = Math.max(0, state.waterStomachLoadL - dtMin * 0.28);
  state.backpackWeightKg = computeInventoryWeightKg(inv);
  const burden = computeWeightBurden(
    state.backpackWeightKg,
    state.waterStomachLoadL,
    env.weightThresholds
  );
  state.totalEffectiveWeightKg = burden.effectiveWeightKg;
  state.loadTier = burden.loadTier;
  state.tiringMultiplier = burden.tiringMultiplier;
  state.stomachDrainMultiplier = burden.stomachDrainMultiplier;
  state.energyLoadMultiplier = burden.energyLoadMultiplier;

  // 2. Flashlight battery drain while ON
  if (env.flashlightActive && inv.flashlightBattery > 0) {
    const drain = (ITEM_CATALOG.flashlight.lightSource?.drainPerGameHour ?? 22) * gHrs;
    inv.flashlightBattery = Math.max(0, inv.flashlightBattery - drain);
    if (inv.flashlightBattery <= 0) {
      ev.flashlightDepleted = true;
    }
  }

  // 3. Wetness (rain, storm > rain, swamp wading, swimming; drying by fire & shelter)
  const clothing = computeClothingBonuses(inv);
  let wetDeltaPerMin = 0;
  if (env.locomotion === 'swim') {
    wetDeltaPerMin += 36;
  } else if (env.locomotion === 'swamp') {
    wetDeltaPerMin += 6.5;
  }
  if (env.shelter === 'outdoor') {
    const rainResist = 1 - clothing.rainResistance;
    if (env.weather === 'rain') wetDeltaPerMin += 4.2 * rainResist;
    else if (env.weather === 'storm') wetDeltaPerMin += 9.5 * rainResist;
    else if (env.weather === 'mist') wetDeltaPerMin += 0.4 * rainResist;
  }
  // Drying sources
  if (env.nearLitCampfireFactor > 0.1) {
    wetDeltaPerMin -= 22 * env.nearLitCampfireFactor;
  } else if (env.shelter === 'warm_house') {
    wetDeltaPerMin -= 5.8;
  } else if (env.shelter === 'tent') {
    wetDeltaPerMin -= env.seatedInTent ? 5.2 : 4.0;
  } else if (env.shelter === 'drafty_hut') {
    wetDeltaPerMin -= 3.0;
  } else if (env.weather === 'clear' && env.locomotion !== 'swim' && env.locomotion !== 'swamp') {
    wetDeltaPerMin -= 2.2 + env.windStrength * 0.6;
  }
  state.wetness = clamp(state.wetness + wetDeltaPerMin * dtMin, 0, 100);

  // 4. Windchill & Core Body Temperature (°C)
  const tempInfo = computeFeelsLikeTempC(
    env.hourOfDay,
    env.weather,
    env.windStrength,
    state.wetness,
    env.shelter,
    env.nearLitCampfireFactor,
    clothing.warmthBonusC
  );
  state.feelsLikeC = tempInfo.feelsLikeC;

  // Target core body temperature responds to feelsLikeC, swimming immersion, and exertion warmth
  let targetCoreC = 37.0;
  if (env.locomotion === 'swim') {
    targetCoreC = 33.1;
  } else if (state.feelsLikeC < 11) {
    const coldSeverity = (11 - state.feelsLikeC) / 19; // 0 .. ~1.2
    const exertionWarmth = env.locomotion === 'run' ? 0.45 : env.locomotion === 'walk' ? 0.18 : 0;
    targetCoreC = clamp(37.0 - coldSeverity * 3.8 + exertionWarmth, 32.4, 37.1);
  } else if (env.nearLitCampfireFactor > 0.25) {
    targetCoreC = 37.1;
  }
  const thermalRate =
    targetCoreC < state.bodyTempC
      ? (env.locomotion === 'swim' ? 0.55 : 0.08 + (state.wetness / 100) * 0.14)
      : env.nearLitCampfireFactor > 0.2
        ? 0.36 * env.nearLitCampfireFactor
        : 0.11;
  state.bodyTempC = clamp(
    state.bodyTempC + (targetCoreC - state.bodyTempC) * Math.min(1, thermalRate * dtMin),
    32.2,
    37.4
  );
  state.hypothermiaStage = classifyHypothermia(state.bodyTempC);

  // 5. Cold & Wet environmental multiplier for awake drain
  const isCold = state.bodyTempC < 35.8 || state.feelsLikeC < 7.0;
  const isWet = state.wetness > 25;
  const envDrainMult = isCold && isWet ? 2.05 : isCold || isWet ? 1.38 : 1.0;

  // 6. Energy drain (awake time + locomotion + weight/water-load)
  const sleepDeprivedMult = state.awakeHours > 18 ? 1.28 : 1.0;
  const awakeEnergyDrain = 3.1 * gHrs * envDrainMult * sleepDeprivedMult;
  let moveEnergyPerMin = 0;
  if (env.locomotion === 'walk') moveEnergyPerMin = 0.75;
  else if (env.locomotion === 'swamp') moveEnergyPerMin = 1.65; // noticeably more than ordinary walking
  else if (env.locomotion === 'run') moveEnergyPerMin = 2.65; // running drains much more
  else if (env.locomotion === 'swim') moveEnergyPerMin = 2.55; // swimming ~ same as running

  const totalEnergyDrain =
    awakeEnergyDrain + moveEnergyPerMin * dtMin * state.energyLoadMultiplier * (isCold ? 1.15 : 1.0);
  state.energy = clamp(state.energy - totalEnergyDrain, 0, 100);

  // 7. Physical Tiredness (acute muscular exertion vs calm recovery)
  const lowVitalsFatigueMult =
    1 + (state.energy < 25 ? 0.35 : 0) + (state.stomachFullness < 20 ? 0.25 : 0) + (state.hydration < 25 ? 0.25 : 0);
  let tirednessDeltaPerMin = 0;
  if (env.locomotion === 'run') tirednessDeltaPerMin = 16.5;
  else if (env.locomotion === 'swim') tirednessDeltaPerMin = 15.8;
  else if (env.locomotion === 'swamp') tirednessDeltaPerMin = 9.2;
  else if (env.locomotion === 'walk') {
    // Calm walking recovers lightly when pack is light, or builds mild tiredness when heavily laden
    tirednessDeltaPerMin = state.tiringMultiplier > 1.35 ? 2.6 * (state.tiringMultiplier - 1.15) : -3.8;
  } else {
    // Standing / resting recovers physical tiredness steadily; sitting in a tent rests deeper
    const restBase = env.seatedInTent ? -18.5 : -11.5;
    tirednessDeltaPerMin = restBase * (env.nearLitCampfireFactor > 0.2 ? 1.25 : 1.0);
  }
  if (tirednessDeltaPerMin > 0) {
    // Wearing a non-breathable rain shell while sprinting in clear warm air builds a bit more heat fatigue
    const warmShellMult =
      clothing.rainResistance > 0.5 &&
      env.locomotion === 'run' &&
      env.weather === 'clear' &&
      state.feelsLikeC > 12.5
        ? 1.12
        : 1.0;
    tirednessDeltaPerMin *= state.tiringMultiplier * lowVitalsFatigueMult * warmShellMult;
  }
  const jumpTiredness = env.jumpedThisFrame ? 2.4 * state.tiringMultiplier : 0;
  state.physicalTiredness = clamp(
    state.physicalTiredness + tirednessDeltaPerMin * dtMin + jumpTiredness,
    0,
    100
  );

  // 8. Stomach Fullness drain (awake time + digestionBurnRate + cold/wet + movement weight)
  const moveHungerMult =
    env.locomotion === 'run' || env.locomotion === 'swim'
      ? 1.75
      : env.locomotion === 'swamp'
        ? 1.45
        : env.locomotion === 'walk'
          ? 1.15
          : 0.92;
  const stomachDrain =
    4.6 *
    gHrs *
    state.digestionBurnRate *
    envDrainMult *
    moveHungerMult *
    state.stomachDrainMultiplier;
  state.stomachFullness = clamp(state.stomachFullness - stomachDrain, 0, 100);
  // Gently relax digestionBurnRate back toward 1.0 when stomach empties
  if (state.stomachFullness < 6) {
    state.digestionBurnRate = state.digestionBurnRate + (1.0 - state.digestionBurnRate) * Math.min(1, dtMin * 0.5);
  }

  // 9. Hydration drain (awake time + exertion + pack weight)
  const moveHydrationMult =
    env.locomotion === 'run' || env.locomotion === 'swim'
      ? 2.1
      : env.locomotion === 'swamp'
        ? 1.5
        : env.locomotion === 'walk'
          ? 1.15
          : 0.88;
  const hydrationDrain = 5.4 * gHrs * moveHydrationMult * (1 + (state.tiringMultiplier - 1) * 0.35);
  state.hydration = clamp(state.hydration - hydrationDrain, 0, 100);

  // 10. Active Poisons & Vomiting
  const vuln = computePoisonVulnerability(state);
  let targetNausea = 0;
  for (let i = state.poisons.length - 1; i >= 0; i--) {
    const p = state.poisons[i];
    if (p.delayHours > 0) {
      p.delayHours = Math.max(0, p.delayHours - gHrs);
      continue;
    }
    p.remainingHours -= gHrs;
    targetNausea = Math.max(targetNausea, p.nauseaBoost);

    const pLabel = getPoisonLabel(p.kind);
    const dmg = p.damagePerHour * vuln * gHrs;
    state.health = clamp(state.health - dmg, 0, 100);
    if (!godMode && recordCollapseIfDead(state, t('death.fatalPoison', { label: pLabel }))) {
      ev.died = true;
      return ev;
    }

    if (p.vomitsLeft > 0) {
      p.nextVomitInHours -= gHrs;
      if (p.nextVomitInHours <= 0) {
        p.vomitsLeft--;
        p.nextVomitInHours = p.vomitIntervalHours;
        state.stomachFullness = clamp(state.stomachFullness - 28, 0, 100);
        state.hydration = clamp(state.hydration - 16, 0, 100);
        state.waterStomachLoadL = Math.max(0, state.waterStomachLoadL - 0.5);
        state.health = clamp(state.health - 4.5 * vuln, 0, 100);
        ev.vomited = true;
        ev.vomitSource = pLabel;
        if (!godMode && recordCollapseIfDead(state, t('death.fatalPoison', { label: pLabel }))) {
          ev.died = true;
          return ev;
        }
      }
    }

    if (p.remainingHours <= 0) {
      state.poisons.splice(i, 1);
    }
  }
  state.nausea = clamp(
    state.nausea + (targetNausea - state.nausea) * Math.min(1, dtSec * 0.45),
    0,
    100
  );

  // 11. Lethal Hypothermia, Severe Dehydration, Starvation
  if (state.bodyTempC < 33.8) {
    const hypoIntensity = clamp((33.8 - state.bodyTempC) / 1.4, 0.25, 1.5);
    state.health = clamp(state.health - 24 * hypoIntensity * gHrs, 0, 100);
    if (!godMode && recordCollapseIfDead(state, t('death.hypothermia'))) {
      ev.died = true;
      return ev;
    }
  }
  if (state.hydration <= 0.1) {
    state.health = clamp(state.health - 12 * gHrs, 0, 100);
    if (!godMode && recordCollapseIfDead(state, t('death.dehydration'))) {
      ev.died = true;
      return ev;
    }
  }
  if (state.stomachFullness <= 0.1) {
    state.health = clamp(state.health - 6.5 * gHrs, 0, 100);
    if (!godMode && recordCollapseIfDead(state, t('death.starvation'))) {
      ev.died = true;
      return ev;
    }
  }

  return ev;
}

export function eatFoodItem(
  state: PlayerSurvivalState,
  inv: InventoryState,
  itemId: ItemId
): { ok: boolean; message: string; poisoned: boolean } {
  const def = ITEM_CATALOG[itemId];
  if (!def?.food) return { ok: false, message: t('surv.cannotEat'), poisoned: false };
  if (!removeStackItem(inv, itemId, 1)) {
    return { ok: false, message: t('surv.noneLeft'), poisoned: false };
  }

  const food = def.food;
  const prevFill = Math.max(0, state.stomachFullness);
  const addedFill = Math.max(0, food.fullness);
  const nextFill = clamp(prevFill + addedFill, 0, 100);

  // Blend digestionBurnRate weighted by existing fullness vs newly eaten food
  if (prevFill + addedFill > 0.01) {
    state.digestionBurnRate =
      (prevFill * state.digestionBurnRate + addedFill * food.burnRate) / (prevFill + addedFill);
  } else {
    state.digestionBurnRate = food.burnRate;
  }
  state.stomachFullness = nextFill;

  if (food.energyBoost) {
    state.energy = clamp(state.energy + food.energyBoost, 0, 100);
  }
  if (food.hydrationDelta) {
    state.hydration = clamp(state.hydration + food.hydrationDelta, 0, 100);
  }
  if (food.warmthBoostC) {
    state.bodyTempC = clamp(state.bodyTempC + food.warmthBoostC, 32.2, 37.3);
  }

  state.backpackWeightKg = computeInventoryWeightKg(inv);
  const locName = getItemName(itemId);
  const poisonName = def.estonian ?? locName;
  let poisoned = false;
  let message = t('surv.ateNormal', { name: locName, fill: Math.round(addedFill) });

  if (food.poison) {
    poisoned = true;
    const effect = createPoisonEffect(food.poison.kind, food.poison.severity);
    state.poisons.push(effect);
    state.nausea = clamp(state.nausea + effect.nauseaBoost * 0.4, 0, 100);
    if (food.poison.kind === 'destroying_angel') {
      message = t('surv.ateDestroyingAngel', { name: poisonName });
    } else if (food.poison.kind === 'fly_agaric') {
      message = t('surv.ateFlyAgaric', { name: poisonName });
    } else {
      message = t('surv.ateBitter', { name: locName });
    }
  } else if (food.burnRate >= 1.8) {
    message = t('surv.ateFast', { name: locName, fill: Math.round(addedFill) });
  } else if (food.burnRate <= 0.65) {
    message = t('surv.ateSlow', { name: locName, fill: Math.round(addedFill) });
  }

  return { ok: true, message, poisoned };
}

export function drinkFromBottle(
  state: PlayerSurvivalState,
  inv: InventoryState,
  bottleUid: string
): { ok: boolean; message: string; poisoned: boolean; tempDropC: number } {
  const bottle = inv.bottles.find((b) => b.uid === bottleUid);
  if (!bottle) {
    return { ok: false, message: t('surv.bottleNotFound'), poisoned: false, tempDropC: 0 };
  }
  if (bottle.waterLiters <= 0.001) {
    return {
      ok: false,
      message: t('surv.bottleEmpty'),
      poisoned: false,
      tempDropC: 0,
    };
  }

  const def = ITEM_CATALOG[bottle.itemId];
  const sipTarget = def.waterContainer?.sipLiters ?? 0.25;
  const drunkL = Math.min(bottle.waterLiters, sipTarget);
  bottle.waterLiters = Math.max(0, Math.round((bottle.waterLiters - drunkL) * 100) / 100);

  // Hydration + temporary ingested water heaviness
  const hydrationGain = drunkL * 88; // 0.25 L => +22% hydration
  state.hydration = clamp(state.hydration + hydrationGain, 0, 100);
  state.waterStomachLoadL = clamp(state.waterStomachLoadL + drunkL, 0, 2.0);
  state.backpackWeightKg = computeInventoryWeightKg(inv);

  // Cold water lowers core body temp; warm boiled water warms gently
  let tempDropC = 0;
  if (bottle.waterTempC < 16) {
    const chillFactor = clamp((16 - bottle.waterTempC) / 12, 0.2, 1.3);
    tempDropC = Math.round(drunkL * 1.45 * chillFactor * 100) / 100; // ~0.3°C per cold sip
    state.bodyTempC = clamp(state.bodyTempC - tempDropC, 32.2, 37.4);
    state.hypothermiaStage = classifyHypothermia(state.bodyTempC);
  } else if (bottle.waterTempC > 32) {
    const warmGain = drunkL * 0.85;
    state.bodyTempC = clamp(state.bodyTempC + warmGain, 32.2, 37.3);
    state.hypothermiaStage = classifyHypothermia(state.bodyTempC);
  }

  let poisoned = false;
  const chillSuffix =
    tempDropC >= 0.15 ? t('surv.drankChill', { temp: tempDropC.toFixed(1) }) : '';
  let message = t('surv.drank', {
    liters: drunkL.toFixed(2),
    hyd: Math.round(hydrationGain),
    chill: chillSuffix,
  });

  if (bottle.waterQuality === 'stale') {
    poisoned = true;
    const eff = createPoisonEffect('stale_water', 1.0);
    state.poisons.push(eff);
    state.nausea = clamp(state.nausea + 36, 0, 100);
    message = t('surv.drankStale');
  } else if (bottle.waterQuality === 'bog') {
    poisoned = true;
    const eff = createPoisonEffect('bog_water', 0.85);
    state.poisons.push(eff);
    state.nausea = clamp(state.nausea + 20, 0, 100);
    message = t('surv.drankBog');
  } else if (state.waterStomachLoadL > 0.7) {
    message += t('surv.drankSloshing');
  }

  return { ok: true, message, poisoned, tempDropC };
}

export function refillBottlesFromSource(
  inv: InventoryState,
  source: 'clean_well' | 'stale_well' | 'bog_lake'
): { refilledCount: number; message: string } {
  const quality: WaterQuality =
    source === 'clean_well' ? 'clean' : source === 'stale_well' ? 'stale' : 'bog';
  const waterTempC = source === 'clean_well' ? 6 : source === 'stale_well' ? 8 : 7;

  let refilledCount = 0;
  for (const b of inv.bottles) {
    if (b.waterLiters < b.capacityLiters - 0.01 || (source === 'clean_well' && b.waterQuality !== 'clean')) {
      b.waterLiters = b.capacityLiters;
      b.waterQuality = quality;
      b.waterTempC = waterTempC;
      refilledCount++;
    }
  }

  if (refilledCount === 0) {
    if (inv.bottles.length === 0) {
      return { refilledCount: 0, message: t('surv.noBottlesInPack') };
    }
    return { refilledCount: 0, message: t('surv.bottlesAlreadyFull') };
  }

  if (source === 'clean_well') {
    return {
      refilledCount,
      message:
        refilledCount === 1
          ? t('surv.refillCleanOne')
          : t('surv.refillCleanMany', { count: refilledCount }),
    };
  }
  if (source === 'stale_well') {
    return {
      refilledCount,
      message:
        refilledCount === 1
          ? t('surv.refillStaleOne')
          : t('surv.refillStaleMany', { count: refilledCount }),
    };
  }
  return {
    refilledCount,
    message:
      refilledCount === 1
        ? t('surv.refillBogOne')
        : t('surv.refillBogMany', { count: refilledCount }),
  };
}

export function boilBottleAtCampfire(
  inv: InventoryState,
  bottleUid: string
): { ok: boolean; message: string } {
  const b = inv.bottles.find((item) => item.uid === bottleUid);
  if (!b || b.waterLiters <= 0.001) {
    return { ok: false, message: t('surv.cannotBoilEmpty') };
  }
  const wasImpure = b.waterQuality !== 'clean';
  b.waterQuality = 'clean';
  b.waterTempC = 46;
  const name = getItemName(b.itemId);
  return {
    ok: true,
    message: wasImpure
      ? t('surv.boiledPurified', { name })
      : t('surv.warmedBottle', { name }),
  };
}

export function cookCampfireRecipe(
  inv: InventoryState,
  recipe: 'seared_steak' | 'roasted_mushrooms'
): { ok: boolean; message: string } {
  if (recipe === 'seared_steak') {
    if (!removeStackItem(inv, 'raw_steak', 1)) {
      return { ok: false, message: t('surv.needRawSteak') };
    }
    addItemToInventory(inv, 'seared_steak', 1);
    return { ok: true, message: t('surv.cookedSteak') };
  }
  if (!consumeEdibleMushrooms(inv, 3)) {
    return { ok: false, message: t('surv.needEdibleMushrooms') };
  }
  addItemToInventory(inv, 'roasted_mushrooms', 1);
  return { ok: true, message: t('surv.cookedMushrooms') };
}

export function loadFlashlightBattery(inv: InventoryState): { ok: boolean; message: string } {
  if ((inv.stacks.flashlight ?? 0) <= 0) {
    return { ok: false, message: t('surv.notCarryingFlashlight') };
  }
  if (inv.flashlightBattery >= 98) {
    return { ok: false, message: t('surv.batteryFull') };
  }
  if (!removeStackItem(inv, 'extra_battery', 1)) {
    return { ok: false, message: t('surv.noExtraBatteries') };
  }
  inv.flashlightBattery = 100;
  return { ok: true, message: t('surv.loadedBattery') };
}

export function tryIgniteCampfire(
  inv: InventoryState,
  weather: 'clear' | 'mist' | 'rain' | 'storm',
  wetness: number,
  rngVal = Math.random()
): { ok: boolean; used: 'lighter' | 'matches' | null; message: string } {
  const isHarsh = weather === 'storm' || weather === 'rain' || wetness > 55;
  if (inv.lighterUses > 0) {
    inv.lighterUses--;
    if (inv.lighterUses <= 0 && (inv.stacks.lighter ?? 0) > 0) {
      removeStackItem(inv, 'lighter', 1);
    }
    const chance = weather === 'storm' ? 0.92 : 0.99;
    if (rngVal <= chance) {
      return { ok: true, used: 'lighter', message: t('surv.litLighter') };
    }
    return { ok: false, used: 'lighter', message: t('surv.lighterGust') };
  }

  if (inv.matchStrikes > 0) {
    inv.matchStrikes--;
    const boxesNeeded = Math.ceil(inv.matchStrikes / 12);
    if ((inv.stacks.matches ?? 0) > boxesNeeded) {
      removeStackItem(inv, 'matches', (inv.stacks.matches ?? 0) - boxesNeeded);
    }
    const chance = weather === 'storm' ? 0.35 : isHarsh ? 0.62 : 0.92;
    if (rngVal <= chance) {
      return { ok: true, used: 'matches', message: t('surv.litMatch') };
    }
    return {
      ok: false,
      used: 'matches',
      message: t('surv.matchSnuffed'),
    };
  }

  return {
    ok: false,
    used: null,
    message: t('surv.needFireStarter'),
  };
}

/**
 * Simulates one hour of sleep deterministically, enforcing hunger and cold recovery caps.
 * Used both for previewing sleep outcomes and stepping real-time fast-forward sleep ticks.
 */
export function stepSleepSlice(
  state: PlayerSurvivalState,
  hoursSlice: number,
  hourOfDay: number,
  weather: 'clear' | 'mist' | 'rain' | 'storm',
  windStrength: number,
  shelter: ShelterQuality,
  nearLitCampfireFactor: number,
  clothingWarmthBonusC = 0,
  sleepGearWarmthBonusC = 0
): {
  feelsLikeC: number;
  energyCap: number;
  isCold: boolean;
  stomachEmpty: boolean;
  exposedToRain: boolean;
} {
  const h = Math.max(0, hoursSlice);
  const exposedToRain = shelter === 'outdoor' && (weather === 'rain' || weather === 'storm');

  // Wetting from exposed rain vs drying inside a tent, house, hut, or beside a lit fire
  if (exposedToRain) {
    const rainWetPerHour = weather === 'storm' ? 32 : 18;
    const fireOffset = nearLitCampfireFactor > 0.2 ? 10 * nearLitCampfireFactor : 0;
    state.wetness = clamp(state.wetness + Math.max(4, rainWetPerHour - fireOffset) * h, 0, 100);
  } else if (nearLitCampfireFactor > 0.2) {
    state.wetness = clamp(state.wetness - 32 * h * nearLitCampfireFactor, 0, 100);
  } else if (shelter === 'warm_house') {
    state.wetness = clamp(state.wetness - 16 * h, 0, 100);
  } else if (shelter === 'tent') {
    state.wetness = clamp(state.wetness - 10 * h, 0, 100);
  } else if (shelter === 'drafty_hut') {
    state.wetness = clamp(state.wetness - 8 * h, 0, 100);
  }

  const tempInfo = computeFeelsLikeTempC(
    hourOfDay,
    weather,
    windStrength,
    state.wetness,
    shelter,
    nearLitCampfireFactor,
    clothingWarmthBonusC
  );
  state.feelsLikeC = tempInfo.feelsLikeC;

  const shelterSleepWarmth =
    shelter === 'warm_house'
      ? 6.5
      : shelter === 'tent'
        ? 4.5
        : shelter === 'drafty_hut'
          ? 3.0
          : 0;
  const effectiveSleepTempC = tempInfo.feelsLikeC + shelterSleepWarmth + sleepGearWarmthBonusC;
  const targetCore =
    effectiveSleepTempC < 12
      ? clamp(37.0 - ((12 - effectiveSleepTempC) / 14) * 2.2, 34.1, 37.0)
      : 37.0;
  state.bodyTempC = clamp(
    state.bodyTempC + (targetCore - state.bodyTempC) * Math.min(1, 0.45 * h),
    33.6,
    37.1
  );
  state.hypothermiaStage = classifyHypothermia(state.bodyTempC);

  // Stomach & hydration burn during sleep (slower than active waking, faster if cold)
  const isCold = effectiveSleepTempC < 12.5 || state.bodyTempC < 36.0;
  const coldSleepMult = isCold ? 1.45 : 1.0;
  const stomachBefore = state.stomachFullness;
  state.stomachFullness = clamp(
    state.stomachFullness - 3.6 * h * state.digestionBurnRate * coldSleepMult,
    0,
    100
  );
  state.hydration = clamp(state.hydration - 3.4 * h, 0, 100);
  state.waterStomachLoadL = Math.max(0, state.waterStomachLoadL - 1.2 * h);

  const stomachEmpty = stomachBefore <= 1.0 || state.stomachFullness <= 1.0;

  // Energy recovery cap: NEVER fills to 100% if stomach is/gets empty, sleeping cold, or exposed to rain!
  let energyCap = 100;
  if (stomachEmpty) energyCap -= 30; // max 70% if hungry
  if (isCold) energyCap -= 26; // max 74% if cold; 44% if BOTH cold & hungry!
  if (exposedToRain) energyCap -= 20; // miserable soaking sleep in open rain without tent/roof
  if (state.hydration < 12) energyCap -= 10;
  energyCap = clamp(energyCap, 38, 100);

  const recoveryPerHour = isCold || stomachEmpty || exposedToRain ? 9.5 : 13.5;
  if (state.energy < energyCap) {
    state.energy = Math.min(energyCap, state.energy + recoveryPerHour * h);
  }

  state.physicalTiredness = clamp(state.physicalTiredness - 34 * h, 0, 100);
  state.awakeHours = Math.max(0, state.awakeHours - 2.6 * h);
  state.survivalHoursTotal += h;

  // Gentle health restoration when warm, dry, fed, hydrated, and unpoisoned
  if (!isCold && !stomachEmpty && !exposedToRain && state.hydration > 20 && state.poisons.length === 0) {
    state.health = clamp(state.health + 4.5 * h, 0, 100);
  }

  return {
    feelsLikeC: tempInfo.feelsLikeC,
    energyCap,
    isCold,
    stomachEmpty,
    exposedToRain,
  };
}

export function previewSleepOutcome(
  state: PlayerSurvivalState,
  inv: InventoryState,
  hours: number,
  startHour: number,
  weather: 'clear' | 'mist' | 'rain' | 'storm',
  windStrength: number,
  shelter: ShelterQuality,
  nearLitCampfireFactor: number
): SleepPreview {
  const sim: PlayerSurvivalState = {
    ...state,
    poisons: state.poisons.map((p) => ({ ...p })),
    deathFactors: [...state.deathFactors],
  };
  const clothing = computeClothingBonuses(inv);
  const sleepGear = computeSleepGearBonuses(inv);
  const steps = Math.max(1, Math.round(hours * 2));
  const slice = hours / steps;

  let minCap = 100;
  let anyCold = false;
  let anyEmpty = sim.stomachFullness <= 1;
  let anyRain = false;
  let feelsSum = 0;

  for (let i = 0; i < steps; i++) {
    const hNow = (startHour + i * slice) % 24;
    const res = stepSleepSlice(
      sim,
      slice,
      hNow,
      weather,
      windStrength,
      shelter,
      nearLitCampfireFactor,
      clothing.warmthBonusC,
      sleepGear.warmthBonusC
    );
    if (res.energyCap < minCap) minCap = res.energyCap;
    if (res.isCold) anyCold = true;
    if (res.stomachEmpty) anyEmpty = true;
    if (res.exposedToRain) anyRain = true;
    feelsSum += res.feelsLikeC;
  }

  const warnings: string[] = [];
  if (anyRain) {
    warnings.push(t('surv.sleepWarnRain'));
  }
  if (anyEmpty) {
    warnings.push(
      state.stomachFullness <= 1 ? t('surv.sleepWarnEmptyNow') : t('surv.sleepWarnEmptyMid')
    );
  }
  if (anyCold) {
    warnings.push(t('surv.sleepWarnCold'));
  }

  return {
    hours,
    startHour,
    wakeHour: (startHour + hours) % 24,
    startEnergy: Math.round(state.energy),
    projectedEnergy: Math.round(sim.energy),
    energyCap: Math.round(minCap),
    projectedFullness: Math.round(sim.stomachFullness),
    projectedHydration: Math.round(sim.hydration),
    projectedBodyTempC: Math.round(sim.bodyTempC * 10) / 10,
    avgFeelsLikeC: Math.round((feelsSum / steps) * 10) / 10,
    coldDuringSleep: anyCold,
    stomachEmptyDuringSleep: anyEmpty,
    exposedToRain: anyRain,
    hasSleepingBag: sleepGear.hasSleepingBag,
    sleepGearWarmthBonusC: sleepGear.warmthBonusC,
    warnings,
  };
}

/**
 * Lightweight 25x25 chunk discovery bitmask tracking explored countryside cells
 * so a future Full Map view renders filled when Paper Map is carried or discovered-only when not.
 */
export class DiscoveryTracker {
  readonly gridSize = TOTAL_CHUNK_GRID;
  readonly cells: Uint8Array;
  private discoveredCount = 0;

  constructor() {
    this.cells = new Uint8Array(this.gridSize * this.gridSize);
  }

  markAroundWorldPos(worldX: number, worldZ: number, radiusChunks = 1): number {
    const { vcx, vcz } = worldToVirtualChunk(worldX, worldZ);
    const half = Math.floor(this.gridSize / 2);
    const gx0 = vcx + half;
    const gz0 = vcz + half;
    let newlyFound = 0;
    for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
      for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
        const gx = gx0 + dx;
        const gz = gz0 + dz;
        if (gx < 0 || gx >= this.gridSize || gz < 0 || gz >= this.gridSize) continue;
        const idx = gz * this.gridSize + gx;
        if (this.cells[idx] === 0) {
          this.cells[idx] = 1;
          this.discoveredCount++;
          newlyFound++;
        }
      }
    }
    return newlyFound;
  }

  getDiscoveredPercent(): number {
    return Math.round((this.discoveredCount / this.cells.length) * 100);
  }

  revealAll(): void {
    this.cells.fill(1);
    this.discoveredCount = this.cells.length;
  }

  reset(): void {
    this.cells.fill(0);
    this.discoveredCount = 0;
  }
}

export function formatGameHour(hour: number): string {
  const norm = ((hour % 24) + 24) % 24;
  const h = Math.floor(norm);
  const m = Math.floor((norm - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
