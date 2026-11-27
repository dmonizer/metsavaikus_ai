import {
  computeClothingBonuses,
  computeSleepGearBonuses,
  InventoryState,
} from './itemCatalog';
import { clamp } from '../world/terrainMath';
import { t } from '../i18n/i18n';
import {
  PlayerSurvivalState,
  ShelterQuality,
  SleepPreview,
} from './survivalTypes';
import { classifyHypothermia, computeFeelsLikeTempC } from './survivalVitals';

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
