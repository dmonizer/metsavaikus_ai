export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export type ClockDomain = 'simulation' | 'real';

export type DurationInput = number | string;
export type DistanceInput = number | string;
export type RangeInput = number | [number, number];

export interface TimeWindowDef {
  from: string; // "HH:MM"
  to: string;   // "HH:MM"
}

export type ComparisonOp = {
  eq?: unknown;
  ne?: unknown;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  in?: unknown[];
  not_in?: unknown[];
  between?: [number, number];
  within?: DurationInput;
};

export interface DistanceToFeatureCondition {
  type: FeatureType;
  gt?: DistanceInput;
  gte?: DistanceInput;
  lt?: DistanceInput;
  lte?: DistanceInput;
}

export interface TimeConditionDef {
  from?: string;
  to?: string;
  windows?: Array<[string, string] | TimeWindowDef>;
}

export interface ConditionObject {
  all?: ConditionNode[];
  any?: ConditionNode[];
  not?: ConditionNode;
  time?: TimeConditionDef;
  custom?: { name: string; params?: Record<string, unknown> };
  durationMs?: DurationInput;
  hysteresisMs?: DurationInput;
  // Arbitrary context path lookups (e.g. "weather.type", "listener.biome", "source.structure.has_roof")
  [path: string]: unknown;
}

export type ConditionNode = ConditionObject;

export type FeatureType = 'river' | 'bog' | 'water' | 'road' | 'village' | 'campfire' | 'shelter';
export type BiomeId = 'village' | 'abandoned' | 'island' | 'swamp' | 'road' | 'thicket' | 'forest' | 'meadow' | 'marsh';
export type WeatherType = 'clear' | 'mist' | 'cloudy' | 'rain' | 'light_rain' | 'storm';
export type PlayerActivity = 'idle' | 'stationary' | 'walking' | 'running' | 'sprinting' | 'crouching' | 'wading' | 'swimming' | 'sleeping';
export type GaitType = 'walk' | 'run' | 'sprint' | 'crouch' | 'wade' | 'swim' | 'jump' | 'land' | 'slide';
export type SurfaceMaterial =
  | 'forest_floor'
  | 'grass'
  | 'gravel'
  | 'soil'
  | 'mud'
  | 'wood'
  | 'wooden_boardwalk'
  | 'wooden_floor'
  | 'decrepit_wooden_floor'
  | 'stone'
  | 'concrete'
  | 'metal'
  | 'glass'
  | 'snow'
  | 'ice'
  | 'water';

export type StructuralCondition = 'intact' | 'weathered' | 'sagging' | 'decrepit' | 'ruins';

export type BusId = string;

export interface DuckingRule {
  targetBus: BusId;
  gain: number;
  attackMs?: DurationInput;
  releaseMs?: DurationInput;
}

export interface BusDefinition {
  id: BusId;
  parent?: BusId | null;
  volume?: number;
  muted?: boolean;
  maxConcurrency?: number;
  priority?: number;
  bypassEnvironmentalAttenuation?: boolean;
  ducking?: DuckingRule[];
}

export interface AssetDefinition {
  id: string;
  file: string;
  weight?: number;
  preload?: boolean;
  streaming?: boolean;
  procedural?: boolean;
  proceduralKind?: string;
  embeddedThunder?: boolean;
  placeholder?: boolean;
  durationSec?: number;
  gainScale?: number;
  loopable?: boolean;
  tags?: string[];
}

export type ConcurrencyPolicy =
  | 'allow'
  | 'reject_new'
  | 'restart'
  | 'replace_oldest'
  | 'replace_quietest'
  | 'replace_lowest_priority'
  | 'queue'
  | 'virtualise';

export type ConditionLossPolicy =
  | 'finish'
  | 'fade_out'
  | 'crossfade'
  | 'pause'
  | 'stop_immediately';

export type SelectionMode = 'weighted' | 'random' | 'sequential' | 'shuffle_bag';

export interface PlaybackAssetRef {
  assetId: string;
  weight?: number;
}

export interface PlaybackConfig {
  volume?: RangeInput;
  pitch?: RangeInput;
  speed?: RangeInput;
  loop?: {
    count?: number | 'infinite';
    pause?: [DurationInput, DurationInput];
    preserveOffsetOnResume?: boolean;
  };
  fadeInMs?: DurationInput;
  fadeOutMs?: DurationInput;
  crossfadeMs?: DurationInput;
  onConditionLost?: ConditionLossPolicy;
  priority?: number;
  maxInstances?: number;
  concurrencyPolicy?: ConcurrencyPolicy;
  selection?: SelectionMode;
  avoidConsecutiveRepetition?: boolean;
  maxQueueAgeMs?: DurationInput;
  isLongGaitLoop?: boolean;
}

export type SpatialMode =
  | 'non_spatial'
  | 'world'
  | 'listener_relative'
  | 'player_attached'
  | 'moving_entity'
  | 'linear_feature'
  | 'area'
  | 'volume'
  | 'generated_point';

export interface SpatialConfig {
  mode: SpatialMode;
  attenuation?: 'none' | 'inverse_distance' | 'linear';
  referenceDistanceM?: DistanceInput;
  maximumDistanceM?: DistanceInput;
  rolloffFactor?: number;
  occlusion?: boolean;
  environmentalAcoustics?: boolean;
  doppler?: boolean;
  spawnDistanceM?: [DistanceInput, DistanceInput];
  elevationOffsetM?: RangeInput;
  onFeature?: FeatureType;
  attachTo?: string;
}

export type TriggerType =
  | 'event'
  | 'scheduled'
  | 'stochastic'
  | 'continuous'
  | 'repeating'
  | 'state_driven';

export interface TriggerDef {
  type: TriggerType;
  event?: string;
  events?: string[];
}

export type QuotaScope = 'global' | 'player' | 'region' | 'biome' | 'emitter' | 'entity';
export type QuotaPeriod = 'day' | 'night' | 'window' | 'rolling' | 'all_time';

export interface ScheduleDef {
  occurrencesPerWindow?: [number, number];
  interval?: [DurationInput, DurationInput];
  ratePerMinute?: number;
  probabilityPerAttempt?: number;
  initialDelay?: DurationInput;
  clock?: ClockDomain;
  quotaScope?: QuotaScope;
  quotaPeriod?: QuotaPeriod;
  quotaGroup?: string;
  minInterval?: DurationInput;
  maxOccurrences?: number;
  missedOccurrence?: 'skip' | 'play_latest';
  windowProbability?: number;
}

export interface LimitsDef {
  quotaPeriod?: QuotaPeriod;
  quotaGroup?: string;
  maxOccurrences?: number;
  minInterval?: DurationInput;
  cooldown?: DurationInput;
  scope?: QuotaScope;
  clock?: ClockDomain;
}

export interface SoundDefinition {
  id: string;
  extends?: string;
  $remove?: string[];
  bus: BusId;
  trigger: TriggerDef;
  assets: PlaybackAssetRef[];
  playback: PlaybackConfig;
  spatial: SpatialConfig;
  conditions?: ConditionNode;
  schedule?: ScheduleDef;
  limits?: LimitsDef;
  tags?: string[];
  gaitRole?: {
    surface?: SurfaceMaterial;
    gait?: GaitType;
  };
  embeddedThunderSuppressed?: boolean;
}

export interface MaterialActionRef {
  sound: string;
  volumeScale?: number;
  pitchScale?: number;
}

export interface MaterialReactionRule {
  event: string;
  probability?: number;
  sound: string;
  delayMs?: [DurationInput, DurationInput];
  minIntensity?: number;
}

export interface MaterialProfile {
  id: string;
  extends?: string;
  $remove?: string[];
  footsteps?: Partial<Record<GaitType, string | MaterialActionRef>>;
  impact?: MaterialActionRef;
  hollowImpact?: MaterialActionRef;
  break?: MaterialActionRef;
  scrape?: MaterialActionRef;
  creak?: MaterialActionRef;
  slide?: MaterialActionRef;
  splash?: MaterialActionRef;
  fall?: MaterialActionRef;
  fallHeavy?: MaterialActionRef;
  doorOpen?: MaterialActionRef;
  doorClose?: MaterialActionRef;
  additionalReactions?: MaterialReactionRule[];
}

export interface AcousticCategoryTransmission {
  gain: number;
  lowpassHz: number;
}

export interface AcousticProfile {
  id: string;
  extends?: string;
  $remove?: string[];
  wallMaterial?: string;
  roofMaterial?: string;
  enclosure: number; // 0 (outdoors) .. 1 (solidly enclosed)
  roofCoverage: number; // 0 (roofless) .. 1 (full intact roof)
  condition: StructuralCondition;
  exteriorGainDefault: number;
  lowpassHz: number;
  reverbLevel: number;
  portalBleedFactor?: number;
  categoryTransmission?: Record<string, AcousticCategoryTransmission>;
  roomToneSound?: string;
}

export interface BiomeLayerRef {
  sound: string;
  weight?: number;
  tags?: string[];
}

export interface BiomeProfile {
  id: BiomeId;
  extends?: string;
  $remove?: string[];
  layers: BiomeLayerRef[];
}

export interface EventReactionDefinition {
  id: string;
  event: string;
  probability?: number;
  delayMs?: [DurationInput, DurationInput];
  clock?: ClockDomain;
  scheduleConditions?: ConditionNode;
  executeConditions?: ConditionNode;
  emitEvent?: {
    type: string;
    origin?: 'player' | 'environment' | 'stochastic';
    intensity?: number;
    payload?: Record<string, unknown>;
  };
  playSound?: string;
  activateDisturbance?: string;
  cooldownMs?: DurationInput;
  maxOccurrences?: number;
  quotaPeriod?: QuotaPeriod;
  quotaGroup?: string;
  scope?: QuotaScope;
  exemptFromDisturbance?: boolean;
  sourcePositionMode?: 'event' | 'listener_offset';
  spawnDistanceM?: [DistanceInput, DistanceInput];
  triggerDistanceMaxM?: DistanceInput;
}

export type OverlapPolicy =
  | 'strongest_and_longest'
  | 'reset'
  | 'extend'
  | 'accumulate'
  | 'independent';

export interface DisturbanceEffectDef {
  target: string; // BusId, soundId, or tag:<name>
  gain: number;
  blockNewEvents: boolean;
  fadeOutMs: DurationInput;
  recoveryDelayMs: [DurationInput, DurationInput];
  recoveryFadeMs: DurationInput;
}

export interface DisturbanceProfile {
  id: string;
  trigger: {
    event: string;
    minIntensity?: number;
  };
  spatial: {
    origin: 'event.position' | 'listener';
    radiusM: DistanceInput;
    attenuation: 'linear' | 'none';
  };
  overlapPolicy: OverlapPolicy;
  activationDelayMs?: DurationInput;
  effects: DisturbanceEffectDef[];
  exceptions?: {
    buses?: BusId[];
    sounds?: string[];
    tags?: string[];
  };
  tags?: string[];
}

export interface MusicProfile {
  id: string;
  bus: BusId;
  conditions?: ConditionNode;
  assets: PlaybackAssetRef[];
  playback: PlaybackConfig;
}

export interface EngineBudgetsConfig {
  maxActiveVoices: number;
  maxVirtualSources: number;
  maxPendingEvents: number;
  maxReactionChainDepth: number;
  maxEventsPerChain: number;
  occlusionQueryRateHz: number;
  maxOcclusionDistanceM: number;
  masterLimiterEnabled: boolean;
  useEmbeddedThunderAmbience: boolean;
  suppressStochasticThunderWhenEmbedded: boolean;
}

export interface SoundscapeConfig {
  version: number;
  engine: EngineBudgetsConfig;
  buses: BusDefinition[];
  assets: AssetDefinition[];
  materials: MaterialProfile[];
  acoustics: AcousticProfile[];
  biomes: BiomeProfile[];
  sounds: SoundDefinition[];
  reactions: EventReactionDefinition[];
  disturbances: DisturbanceProfile[];
  music: MusicProfile[];
}

export type EventOrigin = 'player' | 'environment' | 'stochastic';

export interface SimulationEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  origin: EventOrigin;
  simulationTimestamp: number;
  position?: Vector3;
  sourceEntityId?: string;
  targetEntityId?: string;
  intensity?: number;
  correlationId?: string;
  causationId?: string;
  chainDepth: number;
  dedupeKey?: string;
  dedupeWindowMs?: number;
  payload: T;
}

export interface StructureContext {
  id: string | null;
  quality: 'outdoor' | 'tent' | 'drafty_hut' | 'warm_house';
  profileId: string;
  enclosure: number; // 0..1
  roofCoverage: number; // 0..1
  hasRoof: boolean;
  roofMaterial: string;
  wallMaterial: string;
  condition: StructuralCondition;
  portalOpenness: number; // 0..1 (doors/openings openness)
  abandoned: boolean;
  roofDrainagePoint?: Vector3;
}

export interface FeatureDistanceSummary {
  riverM: number;
  bogM: number;
  waterM: number;
  roadM: number;
  villageM: number;
  campfireM: number;
  shelterM: number;
}

export interface WeatherHistoryState {
  lastRainEndSimMs: number | null;
  accumulatedRainMm: number;
  rainDurationMs: number;
  timeSinceLastRainMs: number;
}

export interface WorldContext {
  simulationTimeMs: number;
  timeOfDayHours: number; // 0..24
  simulationDay: number;
  timeAcceleration: number;
  astronomy: {
    sunElevationDeg: number;
    moonElevationDeg: number;
    moonAboveHorizon: boolean;
    moonPhase: number; // 0..1
    isNight: boolean;
    sunriseHour: number;
    sunsetHour: number;
  };
  weather: {
    type: WeatherType;
    precipitation: 'none' | 'rain' | 'snow';
    intensity: number; // 0..1
    windSpeed: number; // 0..1+
    windDirectionRad: number;
    fogDensity: number;
  };
  weatherHistory: WeatherHistoryState;
  geography: {
    elevationM: number;
    season: 'spring' | 'summer' | 'autumn' | 'winter';
    temperatureC: number;
    snowDepthM: number;
    regionId: string;
    biomeComposition: Partial<Record<BiomeId, number>>;
    featureDistances: FeatureDistanceSummary;
  };
  listener: {
    id: string;
    position: Vector3;
    forward: Vector3;
    velocity: Vector3;
    biome: BiomeId;
    regionId: string;
    underwater: boolean;
    waterDepthM: number;
  };
  player: {
    activity: PlayerActivity;
    gait: GaitType | null;
    speedMps: number;
    stamina: number; // 0..100
    exertion: number; // 0..1
    tiredness: number; // 0..100
    wetness: number; // 0..100
    wearingRainJacket: boolean;
    seatedInTent: boolean;
    surfaceMaterial: SurfaceMaterial;
    surfaceWetness: number; // 0..1
    distanceMovedTotal: number;
    nearLitCampfireFactor: number; // 0..1
    nearestCampfirePos?: Vector3;
  };
  structure: StructureContext;
  settings: {
    muted: boolean;
    masterVolume: number;
    musicEnabled: boolean;
    musicVolume: number;
    useEmbeddedThunderAmbience: boolean;
  };
}

export interface SpatialQueryResult {
  position: Vector3;
  featureFound: boolean;
}

export interface SpatialQueryProvider {
  findPointOnFeature(
    feature: FeatureType,
    listenerPos: Vector3,
    minDistM: number,
    maxDistM: number,
    rngNext: () => number
  ): SpatialQueryResult | null;
  computeOcclusionFactor?(listenerPos: Vector3, sourcePos: Vector3): number;
}

export interface ValidationIssue {
  file: string;
  definition: string;
  property: string;
  message: string;
  severity: 'error' | 'warning';
}

export type InstanceLifecycleState =
  | 'scheduled'
  | 'starting'
  | 'playing'
  | 'paused'
  | 'virtualised'
  | 'stopping'
  | 'stopped'
  | 'completed';

export interface ActiveVoiceSnapshot {
  instanceId: string;
  soundId: string;
  assetId: string;
  bus: BusId;
  state: InstanceLifecycleState;
  spatialMode: SpatialMode;
  position: Vector3 | null;
  distanceM: number | null;
  effectiveGain: number;
  lowpassHz: number;
  pitch: number;
  loopCountTarget: number | 'infinite';
  loopsCompleted: number;
  elapsedSec: number;
  durationSec: number;
  reason: string;
  isAudition?: boolean;
  userPaused?: boolean;
  stoppedAtRealMs?: number;
}

export interface RuleDiagnosticsRow {
  soundId: string;
  triggerType: TriggerType;
  bus: BusId;
  eligible: boolean;
  reasons: string[];
  quotaUsed: number;
  quotaTarget: number | null;
  quotaMax: number | null;
  cooldownRemainingSimSec: number;
  nextScheduledSimSec: number | null;
}

export interface ActiveDisturbanceSnapshot {
  instanceId: string;
  profileId: string;
  origin: Vector3;
  radiusM: number;
  distanceFromListenerM: number;
  attenuationAtListener: number;
  effects: Array<{
    target: string;
    currentGainMult: number;
    blockingNewEvents: boolean;
    remainingRecoveryDelaySimSec: number;
    remainingRecoveryFadeSimSec: number;
  }>;
}

export interface DiagnosticsSnapshot {
  simulationTimeMs: number;
  timeOfDayHours: number;
  realTimeMs: number;
  timeAcceleration: number;
  backendKind: string;
  unsupportedBackendFeatures: string[];
  acoustics: {
    profileId: string;
    enclosure: number;
    roofCoverage: number;
    portalOpenness: number;
    exteriorGain: number;
    exteriorLowpassHz: number;
    roomReverb: number;
    underwater: boolean;
  };
  biomeMix: Array<{ biome: BiomeId; weight: number }>;
  voices: ActiveVoiceSnapshot[];
  stoppedVoices?: ActiveVoiceSnapshot[];
  virtualCount: number;
  activeCount: number;
  queuedCount: number;
  rules: RuleDiagnosticsRow[];
  disturbances: ActiveDisturbanceSnapshot[];
  recentEvents: Array<{
    id: string;
    type: string;
    origin: EventOrigin;
    timestampSimMs: number;
    correlationId?: string;
    causationId?: string;
    chainDepth: number;
  }>;
  music: {
    enabled: boolean;
    volume: number;
    activeProfileId: string | null;
    activeTrackId: string | null;
    state: InstanceLifecycleState | 'silent';
  };
  buses: Array<{
    id: BusId;
    parent: BusId | null;
    volume: number;
    muted: boolean;
    effectiveGain: number;
    activeVoices: number;
  }>;
  assetStatus: {
    loaded: number;
    pending: number;
    failed: string[];
    procedural: number;
  };
  validationIssues: ValidationIssue[];
}

export interface PersistedSoundscapeState {
  version: number;
  simulationTimeMs: number;
  rngState: number;
  weatherHistory: WeatherHistoryState;
  windowStates: Array<{
    key: string;
    sampledTarget: number | null;
    count: number;
    lastTriggeredSimMs: number | null;
  }>;
  cooldowns: Array<{
    key: string;
    untilSimMs: number;
  }>;
  pendingReactions: Array<{
    id: string;
    reactionId: string;
    executeAtSimMs: number;
    sourceEvent: SimulationEvent;
    reservedQuotaKey?: string;
  }>;
  disturbances: Array<{
    instanceId: string;
    profileId: string;
    origin: Vector3;
    createdAtSimMs: number;
    radiusM: number;
    intensity: number;
    targets: Array<{
      target: string;
      recoveryDelayEndSimMs: number;
      recoveryFadeEndSimMs: number;
    }>;
  }>;
  preferences: {
    muted: boolean;
    masterVolume: number;
    musicEnabled: boolean;
    musicVolume: number;
    busVolumes: Record<string, number>;
    busMuted: Record<string, boolean>;
  };
  music: {
    activeProfileId: string | null;
    shuffleBagIndices: Record<string, number[]>;
    nextAllowedPlayRealMs: number;
  };
}
