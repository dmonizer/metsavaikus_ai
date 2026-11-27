import type { PoisonKind } from './itemCatalog';

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
