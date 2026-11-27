export {
  DEFAULT_WEIGHT_THRESHOLDS,
  type ActivePoisonEffect,
  type HypothermiaStage,
  type LoadTier,
  type LocomotionState,
  type PlayerSurvivalState,
  type ShelterQuality,
  type SleepPreview,
  type SurvivalEnvInput,
  type SurvivalTickEvents,
  type WeightBurdenMetrics,
  type WeightTierThresholds,
} from './survivalTypes';

export {
  classifyHypothermia,
  computeFeelsLikeTempC,
  computePoisonVulnerability,
  computeWeightBurden,
  createInitialSurvivalState,
  createPoisonEffect,
  refreshInventoryBurden,
  stepSurvivalTick,
} from './survivalVitals';

export {
  boilBottleAtCampfire,
  cookCampfireRecipe,
  drinkFromBottle,
  eatFoodItem,
  loadFlashlightBattery,
  refillBottlesFromSource,
  tryIgniteCampfire,
} from './survivalConsumables';

export {
  previewSleepOutcome,
  stepSleepSlice,
} from './survivalSleep';

export {
  DiscoveryTracker,
  formatGameHour,
} from './survivalDiscovery';
