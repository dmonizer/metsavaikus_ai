import {
  computeClothingBonuses,
  computeInventoryWeightKg,
  InventoryState,
  ITEM_CATALOG,
  PoisonKind,
} from './itemCatalog';
import { clamp } from '../world/terrainMath';
import { getPoisonLabel, t } from '../i18n/i18n';
import {
  ActivePoisonEffect,
  DEFAULT_WEIGHT_THRESHOLDS,
  HypothermiaStage,
  LoadTier,
  PlayerSurvivalState,
  ShelterQuality,
  SurvivalEnvInput,
  SurvivalTickEvents,
  WeightBurdenMetrics,
  WeightTierThresholds,
} from './survivalTypes';

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

  const tiringMultiplier =
    Math.round((1 + excessKg * 0.14 + Math.max(0, waterStomachLoadL - 0.35) * 0.45) * 100) / 100;
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

/** Refresh derived pack state after inventory changes or ingested-water absorption. */
export function refreshInventoryBurden(
  state: PlayerSurvivalState,
  inventory: InventoryState,
  thresholds?: Partial<WeightTierThresholds>
): void {
  state.backpackWeightKg = computeInventoryWeightKg(inventory);
  const burden = computeWeightBurden(state.backpackWeightKg, state.waterStomachLoadL, thresholds);
  state.totalEffectiveWeightKg = burden.effectiveWeightKg;
  state.loadTier = burden.loadTier;
  state.tiringMultiplier = burden.tiringMultiplier;
  state.stomachDrainMultiplier = burden.stomachDrainMultiplier;
  state.energyLoadMultiplier = burden.energyLoadMultiplier;
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
  refreshInventoryBurden(state, inv, env.weightThresholds);

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
  else if (env.locomotion === 'swamp') moveEnergyPerMin = 1.65;
  else if (env.locomotion === 'run') moveEnergyPerMin = 2.65;
  else if (env.locomotion === 'swim') moveEnergyPerMin = 2.55;

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
    tirednessDeltaPerMin = state.tiringMultiplier > 1.35 ? 2.6 * (state.tiringMultiplier - 1.15) : -3.8;
  } else {
    const restBase = env.seatedInTent ? -18.5 : -11.5;
    tirednessDeltaPerMin = restBase * (env.nearLitCampfireFactor > 0.2 ? 1.25 : 1.0);
  }
  if (tirednessDeltaPerMin > 0) {
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
