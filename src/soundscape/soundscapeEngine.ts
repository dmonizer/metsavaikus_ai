import { AcousticEnvironmentManager } from './acoustics';
import type { AudioBackend } from './audioBackend';
import { Clock, parseDurationMs, SeededRng, SystemRealClock } from './clocks';
import { ConditionEvaluator, type CustomConditionEvaluator } from './conditionEvaluator';
import {
  hasValidationErrors,
  normalizeAndValidateConfig,
  type NormalizedSoundscapeConfig,
  parseAndValidateConfigJson,
} from './configSchema';
import { DisturbanceManager } from './disturbanceManager';
import { SimulationEventBus, type EmitEventInput } from './eventBus';
import { InstanceManager } from './instanceManager';
import { AudioMixer } from './mixer';
import { RuleScheduler } from './scheduler';
import type { ActiveSoundInstance } from './instanceManager';
import type {
  BiomeId,
  DiagnosticsSnapshot,
  EventReactionDefinition,
  GaitType,
  PersistedSoundscapeState,
  RuleDiagnosticsRow,
  SimulationEvent,
  SoundDefinition,
  SoundscapeConfig,
  SpatialQueryProvider,
  SurfaceMaterial,
  ValidationIssue,
  Vector3,
  WeatherHistoryState,
  WorldContext,
} from './types';

export interface SoundscapeEngineOptions {
  config: SoundscapeConfig;
  backend: AudioBackend;
  realClock?: Clock;
  rng?: SeededRng;
  spatialQuery?: SpatialQueryProvider;
}

export class WeatherHistoryTracker {
  private lastRainEndSimMs: number | null = null;
  private accumulatedRainMm = 0;
  private rainDurationMs = 0;
  private wasRaining = false;

  update(
    dtSimMs: number,
    nowSimMs: number,
    isRaining: boolean,
    intensity: number,
    authoritative?: Partial<WeatherHistoryState>
  ): WeatherHistoryState {
    if (dtSimMs > 0) {
      if (isRaining) {
        this.wasRaining = true;
        this.rainDurationMs += dtSimMs;
        // ~12 mm/hr at intensity 1.0
        const hours = dtSimMs / 3_600_000;
        this.accumulatedRainMm += hours * 12.0 * Math.max(0.2, intensity);
      } else {
        if (this.wasRaining) {
          this.lastRainEndSimMs = nowSimMs;
          this.wasRaining = false;
        }
        // Gradual evaporation over hours after rain stops
        const hoursDry = dtSimMs / 3_600_000;
        this.accumulatedRainMm = Math.max(0, this.accumulatedRainMm - hoursDry * 0.45);
      }
    }

    const hasAuth =
      Boolean(authoritative) &&
      (authoritative!.lastRainEndSimMs !== null ||
        (authoritative!.accumulatedRainMm ?? 0) > 0 ||
        (authoritative!.rainDurationMs ?? 0) > 0);
    const lastEnd = hasAuth ? (authoritative!.lastRainEndSimMs ?? this.lastRainEndSimMs) : this.lastRainEndSimMs;
    const accMm = hasAuth ? (authoritative!.accumulatedRainMm ?? this.accumulatedRainMm) : this.accumulatedRainMm;
    const durMs = hasAuth ? (authoritative!.rainDurationMs ?? this.rainDurationMs) : this.rainDurationMs;
    const timeSinceLast =
      isRaining ? 0 : lastEnd !== null && nowSimMs >= lastEnd ? nowSimMs - lastEnd : Infinity;

    return {
      lastRainEndSimMs: lastEnd,
      accumulatedRainMm: Math.round(accMm * 100) / 100,
      rainDurationMs: durMs,
      timeSinceLastRainMs: timeSinceLast,
    };
  }

  exportState(): WeatherHistoryState {
    return {
      lastRainEndSimMs: this.lastRainEndSimMs,
      accumulatedRainMm: this.accumulatedRainMm,
      rainDurationMs: this.rainDurationMs,
      timeSinceLastRainMs: 0,
    };
  }

  importState(saved: WeatherHistoryState): void {
    this.lastRainEndSimMs = saved.lastRainEndSimMs;
    this.accumulatedRainMm = saved.accumulatedRainMm;
    this.rainDurationMs = saved.rainDurationMs;
    this.wasRaining = false;
  }
}

export class SoundscapeEngine {
  private normalized: NormalizedSoundscapeConfig;
  private readonly backend: AudioBackend;
  private readonly realClock: Clock;
  private readonly rng: SeededRng;
  private spatialQuery?: SpatialQueryProvider;

  readonly eventBus: SimulationEventBus;
  readonly evaluator: ConditionEvaluator;
  readonly mixer: AudioMixer;
  readonly acoustics: AcousticEnvironmentManager;
  readonly disturbances: DisturbanceManager;
  readonly scheduler: RuleScheduler;
  readonly instances: InstanceManager;
  readonly weatherHistory = new WeatherHistoryTracker();

  private lastSimMs: number | null = null;
  private lastWorld: WorldContext | null = null;
  private lastRuleRows: RuleDiagnosticsRow[] = [];

  // Movement & gait loop controller state
  private prevDistanceMoved = 0;
  private stepAccumM = 0;
  private activeGaitSoundId: string | null = null;
  private prevLocomotionMoving = false;
  private prevUnderWater = false;

  // Breathing state controller
  private activeBreathingSoundId: string | null = null;

  // Music controller state
  private musicEnabled = true;
  private musicVolume = 0.25;
  private activeMusicProfileId: string | null = null;
  private activeMusicSoundDef: SoundDefinition | null = null;
  private nextMusicAllowedRealMs = 0;

  // Validation history for diagnostics
  private lastValidationIssues: ValidationIssue[] = [];

  constructor(opts: SoundscapeEngineOptions) {
    this.normalized = normalizeAndValidateConfig(opts.config);
    this.lastValidationIssues = [...this.normalized.issues];
    this.backend = opts.backend;
    this.realClock = opts.realClock ?? new SystemRealClock();
    this.rng = opts.rng ?? new SeededRng(2026);
    this.spatialQuery = opts.spatialQuery;

    this.eventBus = new SimulationEventBus(80);
    this.evaluator = new ConditionEvaluator();
    this.mixer = new AudioMixer(this.normalized.resolved.buses);
    this.acoustics = new AcousticEnvironmentManager(this.normalized.resolved.acoustics);
    this.disturbances = new DisturbanceManager(this.normalized.resolved.disturbances);
    this.scheduler = new RuleScheduler();
    this.instances = new InstanceManager();

    this.backend.preloadAssets(this.normalized.resolved.assets);
    this.backend.setMasterLimiter(this.normalized.resolved.engine.masterLimiterEnabled);

    this.eventBus.on('*', (event) => {
      this.handleEventDispatched(event);
    });
  }

  getConfig(): SoundscapeConfig {
    return this.normalized.resolved;
  }

  getRawConfig(): SoundscapeConfig {
    return this.normalized.raw;
  }

  registerConditionEvaluator(name: string, fn: CustomConditionEvaluator): void {
    this.evaluator.registerEvaluator(name, fn);
  }

  setSpatialQueryProvider(provider: SpatialQueryProvider): void {
    this.spatialQuery = provider;
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (!enabled) {
      this.stopActiveMusic(false);
    }
  }

  isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  setMusicVolume(vol: number): void {
    this.musicVolume = Math.max(0, Math.min(2, vol));
    this.mixer.setBusVolume('music', this.musicVolume);
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  setBusVolume(busId: string, volume: number): void {
    this.mixer.setBusVolume(busId, volume);
  }

  setBusMuted(busId: string, muted: boolean): void {
    this.mixer.setBusMuted(busId, muted);
  }

  emitEvent<T = Record<string, unknown>>(input: EmitEventInput<T>): SimulationEvent<T> | null {
    const res = this.eventBus.emit(input);
    return res.event;
  }

  private handleEventDispatched(event: SimulationEvent): void {
    const world = this.lastWorld;
    if (!world) return;

    const nowSimMs = event.simulationTimestamp;
    const nowRealMs = this.realClock.nowMs();

    // 1. Activate disturbances triggered directly by this event
    this.disturbances.handleEvent(event, world.listener.position, this.rng);

    // 2. Handle direct event-triggered sound rules
    for (const sound of this.normalized.resolved.sounds) {
      if (sound.trigger.type !== 'event') continue;
      const matches =
        sound.trigger.event === event.type || sound.trigger.events?.includes(event.type);
      if (!matches) continue;

      const check = this.scheduler.canTriggerSound({
        sound,
        world,
        evaluator: this.evaluator,
        disturbances: this.disturbances,
        mixer: this.mixer,
        rng: this.rng,
        nowSimMs,
        nowRealMs,
        event,
      });
      if (!check.eligible) continue;

      this.playSoundDefinition(sound, {
        world,
        originEvent: event,
        explicitPosition: event.position,
        reason: `event:${event.type}`,
      });
    }

    // 3. Handle material-profile sound selection for footsteps, impacts, breaks, doors
    this.handleMaterialEventSounds(event, world, nowSimMs, nowRealMs);

    // 4. Schedule declarative event reactions (with chain depth / cap / atomic quota reservation)
    this.scheduler.scheduleReactionsForEvent({
      event,
      reactions: this.normalized.resolved.reactions,
      soundsMap: this.normalized.soundMap,
      world,
      evaluator: this.evaluator,
      disturbances: this.disturbances,
      mixer: this.mixer,
      rng: this.rng,
      nowSimMs,
      nowRealMs,
      maxChainDepth: this.normalized.resolved.engine.maxReactionChainDepth,
      maxEventsPerChain: this.normalized.resolved.engine.maxEventsPerChain,
      maxPendingEvents: this.normalized.resolved.engine.maxPendingEvents,
      onExecuteReaction: (rx, srcEvt) => this.executeReaction(rx, srcEvt),
    });
  }

  private handleMaterialEventSounds(
    event: SimulationEvent,
    world: WorldContext,
    nowSimMs: number,
    nowRealMs: number
  ): void {
    const p = event.payload as Record<string, unknown>;
    const materialId = (p.material as SurfaceMaterial | string) ?? world.player.surfaceMaterial;
    const mat = this.normalized.materialMap.get(materialId);
    if (!mat) return;

    if (event.type === 'player.step') {
      const gait = ((p.gait as GaitType) ?? world.player.gait ?? 'walk') as GaitType;
      const ref = mat.footsteps?.[gait] ?? mat.footsteps?.walk;
      const soundId = typeof ref === 'string' ? ref : ref?.sound;
      const volumeScale = typeof ref === 'string' ? (gait === 'crouch' ? 0.55 : gait === 'run' ? 1.15 : 1.0) : (ref?.volumeScale ?? 1.0);
      const pitchScale = typeof ref === 'string' ? (gait === 'run' ? 1.08 : gait === 'crouch' ? 0.92 : 1.0) : (ref?.pitchScale ?? 1.0);

      if (soundId) {
        const sDef = this.normalized.soundMap.get(soundId);
        // Long gait loops are handled by syncMovementAudio, NOT restarted on every footstep!
        if (sDef && !sDef.playback.isLongGaitLoop) {
          this.playSoundDefinition(sDef, {
            world,
            originEvent: event,
            explicitPosition: event.position ?? world.listener.position,
            sourceStructureId: world.structure.id,
            sourceInsideSameStructure: world.structure.quality !== 'outdoor',
            reason: `step:${materialId}:${gait}`,
            volumeScale,
            pitchScale,
          });
        }
      }

      // Material additional reactions (e.g. 15% floorboard creak on decrepit_wooden_floor)
      if (mat.additionalReactions) {
        for (const r of mat.additionalReactions) {
          if (r.event !== 'player.step') continue;
          if (this.rng.next() <= (r.probability ?? 1)) {
            const sDef = this.normalized.soundMap.get(r.sound);
            if (sDef) {
              this.playSoundDefinition(sDef, {
                world,
                originEvent: event,
                explicitPosition: event.position ?? world.listener.position,
                sourceStructureId: world.structure.id,
                sourceInsideSameStructure: world.structure.quality !== 'outdoor',
                reason: `material_reaction:${mat.id}`,
              });
            }
          }
        }
      }
      return;
    }

    if (event.type === 'object.impact') {
      const intactBreakable = Boolean(p.breakable) && !Boolean(p.broken);
      const ref = intactBreakable && mat.hollowImpact ? mat.hollowImpact : mat.impact;
      if (ref) {
        const sDef = this.normalized.soundMap.get(ref.sound);
        if (sDef) {
          const intensity = Math.max(0.25, Math.min(1.5, event.intensity ?? 1));
          this.playSoundDefinition(sDef, {
            world,
            originEvent: event,
            explicitPosition: event.position ?? world.listener.position,
            reason: intactBreakable ? 'object.impact(hollow)' : 'object.impact(solid)',
            volumeScale: (ref.volumeScale ?? 1) * intensity,
            pitchScale: ref.pitchScale ?? 1,
          });
        }
      }
      return;
    }

    if (event.type === 'object.break') {
      const ref = mat.break ?? mat.impact;
      if (ref) {
        const sDef = this.normalized.soundMap.get(ref.sound);
        if (sDef) {
          this.playSoundDefinition(sDef, {
            world,
            originEvent: event,
            explicitPosition: event.position ?? world.listener.position,
            reason: 'object.break',
            volumeScale: ref.volumeScale ?? 1,
            pitchScale: ref.pitchScale ?? 1,
          });
        }
      }
      return;
    }

    if (event.type === 'object.door.open' || event.type === 'object.door.close') {
      const ref = event.type === 'object.door.open' ? mat.doorOpen : mat.doorClose;
      if (ref) {
        const sDef = this.normalized.soundMap.get(ref.sound);
        if (sDef) {
          this.playSoundDefinition(sDef, {
            world,
            originEvent: event,
            explicitPosition: event.position ?? world.listener.position,
            sourceStructureId: (p.buildingId as string) ?? world.structure.id,
            sourceInsideSameStructure:
              ((p.buildingId as string) ?? null) === world.structure.id &&
              world.structure.quality !== 'outdoor',
            reason: `${event.type}:${materialId}`,
            volumeScale: ref.volumeScale ?? 1,
            pitchScale: ref.pitchScale ?? 1,
          });
        }
      }
    }
    void nowSimMs;
    void nowRealMs;
  }

  private executeReaction(rx: EventReactionDefinition, srcEvt: SimulationEvent): void {
    const world = this.lastWorld;
    if (!world) return;
    const nowSimMs = world.simulationTimeMs;

    if (rx.activateDisturbance) {
      const origin = srcEvt.position ?? world.listener.position;
      this.disturbances.activateProfileById(rx.activateDisturbance, origin, nowSimMs, srcEvt.intensity ?? 1, this.rng);
    }

    if (rx.playSound) {
      const sound = this.normalized.soundMap.get(rx.playSound);
      if (sound) {
        const pos =
          rx.sourcePositionMode === 'event' && srcEvt.position
            ? srcEvt.position
            : undefined;
        const check = this.scheduler.canTriggerSound({
          sound,
          world,
          evaluator: this.evaluator,
          disturbances: this.disturbances,
          mixer: this.mixer,
          rng: this.rng,
          nowSimMs,
          nowRealMs: this.realClock.nowMs(),
          event: srcEvt,
          exemptFromDisturbance: rx.exemptFromDisturbance,
        });
        if (check.eligible) {
          this.playSoundDefinition(sound, {
            world,
            originEvent: srcEvt,
            explicitPosition: pos,
            reason: `reaction:${rx.id}`,
            exemptFromDisturbance: rx.exemptFromDisturbance,
          });
        }
      }
    }

    if (rx.emitEvent) {
      this.emitEvent({
        type: rx.emitEvent.type,
        origin: rx.emitEvent.origin ?? srcEvt.origin,
        simulationTimestamp: nowSimMs,
        position: srcEvt.position,
        sourceEntityId: srcEvt.sourceEntityId,
        targetEntityId: srcEvt.targetEntityId,
        intensity: rx.emitEvent.intensity ?? srcEvt.intensity,
        correlationId: srcEvt.correlationId ?? srcEvt.id,
        causationId: srcEvt.id,
        chainDepth: srcEvt.chainDepth + 1,
        payload: rx.emitEvent.payload ?? {},
      });
    }
  }

  private playSoundDefinition(
    sound: SoundDefinition,
    opts: {
      world: WorldContext;
      originEvent?: SimulationEvent;
      explicitPosition?: Vector3;
      emitterId?: string;
      sourceStructureId?: string | null;
      sourceInsideSameStructure?: boolean;
      reason?: string;
      exemptFromDisturbance?: boolean;
      volumeScale?: number;
      pitchScale?: number;
      skipQuotaRecord?: boolean;
    }
  ): ActiveSoundInstance | null {
    const nowRealMs = this.realClock.nowMs();
    const res = this.instances.spawnOrResume({
      sound,
      assetsMap: this.normalized.assetMap,
      world: opts.world,
      backend: this.backend,
      mixer: this.mixer,
      rng: this.rng,
      nowRealMs,
      maxGlobalActiveVoices: this.normalized.resolved.engine.maxActiveVoices,
      spatialQuery: this.spatialQuery,
      emitterId: opts.emitterId,
      explicitPosition: opts.explicitPosition,
      sourceStructureId: opts.sourceStructureId,
      sourceInsideSameStructure: opts.sourceInsideSameStructure,
      reason: opts.reason,
      exemptFromDisturbance: opts.exemptFromDisturbance,
      volumeScale: opts.volumeScale,
      pitchScale: opts.pitchScale,
    });

    // Record accepted occurrences consistently (including virtualised starts; excluding rejected/queued drops)
    if ((res.started || res.virtualised) && !opts.skipQuotaRecord) {
      this.scheduler.recordSoundAccepted(
        sound,
        opts.world,
        this.rng,
        opts.world.simulationTimeMs,
        opts.originEvent
      );
    }

    return res.instance ?? null;
  }

  step(dtRealSec: number, worldInput: WorldContext): void {
    const clampedRealDt = Math.max(0, Math.min(0.25, dtRealSec));
    const nowRealMs = this.realClock.nowMs();
    const nowSimMs = worldInput.simulationTimeMs;
    const dtSimMs = this.lastSimMs !== null ? nowSimMs - this.lastSimMs : clampedRealDt * 1000;
    this.lastSimMs = nowSimMs;

    // Sync weather history cleanly
    const isRaining = worldInput.weather.precipitation === 'rain';
    const history = this.weatherHistory.update(
      Math.max(0, dtSimMs),
      nowSimMs,
      isRaining,
      worldInput.weather.intensity,
      worldInput.weatherHistory
    );
    const world: WorldContext = {
      ...worldInput,
      weatherHistory: history,
      settings: {
        ...worldInput.settings,
        musicEnabled: this.musicEnabled,
        musicVolume: this.musicVolume,
      },
    };
    this.lastWorld = world;

    this.mixer.setMasterMuted(world.settings.muted);
    this.mixer.setMasterVolume(world.settings.masterVolume);
    this.mixer.setBusVolume('music', this.musicVolume);
    this.backend.setListenerPose(world.listener.position, world.listener.forward);

    // 1. Acoustic environment & disturbances
    this.acoustics.step(clampedRealDt, world);
    this.disturbances.step(nowSimMs);

    // 2. Step pending delayed reactions
    this.scheduler.stepPendingReactions({
      world,
      evaluator: this.evaluator,
      nowSimMs,
      nowRealMs,
      onExecuteReaction: (rx, srcEvt) => this.executeReaction(rx, srcEvt),
    });

    // 3. Synchronize continuous / state_driven layers & biome ambience (deduplicated across neighboring biomes!)
    const continuousDiag = this.syncContinuousAndBiomeLayers(world, nowSimMs, nowRealMs);

    // 4. Synchronize movement footsteps / long gait loops + exertion breathing
    this.syncMovementAndPhysiology(world, nowSimMs, nowRealMs);

    // 5. Step scheduled, stochastic, and repeating rules
    const schedDiag = this.scheduler.stepScheduledAndStochastic({
      sounds: this.normalized.resolved.sounds,
      world,
      dtSimMs,
      dtRealMs: clampedRealDt * 1000,
      nowSimMs,
      nowRealMs,
      evaluator: this.evaluator,
      disturbances: this.disturbances,
      mixer: this.mixer,
      rng: this.rng,
      onTrigger: (req) => {
        this.playSoundDefinition(req.sound, {
          world,
          originEvent: req.originEvent,
          reason: `schedule:${req.sound.trigger.type}`,
          exemptFromDisturbance: req.exemptFromDisturbance,
          skipQuotaRecord: req.skipQuotaRecord,
        });
      },
    });
    this.lastRuleRows = [...continuousDiag, ...schedDiag];

    // 6. Step independent Music controller
    this.stepMusic(world, nowRealMs);

    // 7. Step InstanceManager + Mixer ducking
    const activeByBus = this.instances.step({
      dtRealSec: clampedRealDt,
      nowRealMs,
      nowSimMs,
      world,
      backend: this.backend,
      mixer: this.mixer,
      acoustics: this.acoustics,
      disturbances: this.disturbances,
      assetsMap: this.normalized.assetMap,
      rng: this.rng,
      maxGlobalActiveVoices: this.normalized.resolved.engine.maxActiveVoices,
      spatialQuery: this.spatialQuery,
    });
    this.mixer.updateCountsAndDucking(activeByBus, clampedRealDt);
  }

  private syncContinuousAndBiomeLayers(
    world: WorldContext,
    nowSimMs: number,
    nowRealMs: number
  ): RuleDiagnosticsRow[] {
    const rows: RuleDiagnosticsRow[] = [];

    // Gather blended biome layer weights without duplicating shared definitions
    const biomeLayerWeights = new Map<string, number>();
    const comp = world.geography.biomeComposition;
    const entries = Object.entries(comp) as Array<[BiomeId, number]>;
    const activeBiomes = entries.length > 0 ? entries : [[world.listener.biome, 1] as [BiomeId, number]];

    for (const [bId, weight] of activeBiomes) {
      if (weight <= 0.01) continue;
      const bp = this.normalized.biomeMap.get(bId);
      if (!bp) continue;
      for (const layer of bp.layers) {
        const w = (layer.weight ?? 1) * weight;
        const prev = biomeLayerWeights.get(layer.sound) ?? 0;
        if (w > prev) biomeLayerWeights.set(layer.sound, w);
      }
    }

    for (const sound of this.normalized.resolved.sounds) {
      if (sound.trigger.type !== 'continuous' && sound.trigger.type !== 'state_driven') {
        continue;
      }
      // Gait and breathing loops are driven by dedicated state controllers
      if (sound.gaitRole || sound.id.startsWith('breathing_')) continue;

      const isBiomeLayer = sound.bus.startsWith('environment.ambience') || biomeLayerWeights.has(sound.id);
      const biomeWeight = biomeLayerWeights.get(sound.id);
      let condRes = this.evaluator.evaluate(
        sound.conditions,
        {
          world,
          isDisturbedAtListener: this.disturbances.isListenerInDisturbance(world.listener.position, nowSimMs),
        },
        `cont:${sound.id}`,
        nowRealMs
      );

      if (sound.embeddedThunderSuppressed && world.settings.useEmbeddedThunderAmbience) {
        condRes = { passed: false, reasons: ['embedded_thunder active'] };
      } else if (sound.id.includes('embedded_thunder') && !world.settings.useEmbeddedThunderAmbience) {
        condRes = { passed: false, reasons: ['embedded_thunder disabled in settings'] };
      }

      if (isBiomeLayer && biomeLayerWeights.size > 0 && biomeWeight === undefined && sound.bus === 'environment.ambience') {
        condRes = { passed: false, reasons: ['not present in nearby biomes'] };
      }

      const active = this.instances.findActiveForSound(sound.id);
      if (condRes.passed) {
        // Compute dynamic intensity scaling for wind / rain / biome blend
        let scale = biomeWeight !== undefined ? Math.max(0.2, Math.min(1, biomeWeight)) : 1.0;
        if (sound.bus === 'environment.weather.wind') {
          scale *= Math.max(0.15, Math.min(1.35, 0.3 + world.weather.windSpeed * 0.75));
        } else if (sound.bus === 'environment.weather.rain') {
          scale *= Math.max(0.1, Math.min(1.25, world.weather.intensity));
        }

        if (!active || active.state === 'stopping') {
          const explicitPos =
            sound.spatial.attachTo === 'structure.roof_drainage_point' && world.structure.roofDrainagePoint
              ? world.structure.roofDrainagePoint
              : undefined;
          this.playSoundDefinition(sound, {
            world,
            explicitPosition: explicitPos,
            reason: `continuous:${sound.id}`,
            volumeScale: scale,
            skipQuotaRecord: true,
          });
        } else if (active.state === 'paused') {
          this.instances.resumePaused(active, this.backend, this.mixer);
        } else {
          // Modulate live target gain cleanly on active continuous layer
          const nominal = typeof sound.playback.volume === 'number'
            ? sound.playback.volume
            : Array.isArray(sound.playback.volume)
              ? (sound.playback.volume[0] + sound.playback.volume[1]) * 0.5
              : 0.7;
          active.baseVolume = nominal * scale;
        }
      } else if (active) {
        this.instances.requestConditionStop(active, this.backend, nowRealMs);
      }

      rows.push({
        soundId: sound.id,
        triggerType: sound.trigger.type,
        bus: sound.bus,
        eligible: condRes.passed,
        reasons: condRes.reasons,
        quotaUsed: active ? 1 : 0,
        quotaTarget: null,
        quotaMax: sound.playback.maxInstances ?? null,
        cooldownRemainingSimSec: 0,
        nextScheduledSimSec: null,
      });
    }

    return rows;
  }

  private syncMovementAndPhysiology(
    world: WorldContext,
    nowSimMs: number,
    nowRealMs: number
  ): void {
    const movedDelta = Math.max(0, world.player.distanceMovedTotal - this.prevDistanceMoved);
    this.prevDistanceMoved = world.player.distanceMovedTotal;

    const activity = world.player.activity;
    const isMoving =
      activity === 'walking' ||
      activity === 'running' ||
      activity === 'sprinting' ||
      activity === 'crouching' ||
      activity === 'wading' ||
      activity === 'swimming';

    const surface = world.player.surfaceMaterial;
    const gait: GaitType =
      activity === 'swimming'
        ? 'swim'
        : activity === 'wading'
          ? 'wade'
          : activity === 'running' || activity === 'sprinting'
            ? 'run'
            : activity === 'crouching'
              ? 'crouch'
              : 'walk';

    // Lookup material footstep definition (supporting long gait loops vs individual steps!)
    const mat = this.normalized.materialMap.get(surface);
    const ref = mat?.footsteps?.[gait] ?? mat?.footsteps?.walk;
    const targetSoundId = typeof ref === 'string' ? ref : ref?.sound ?? null;
    const targetDef = targetSoundId ? this.normalized.soundMap.get(targetSoundId) : undefined;
    const wantsLongGaitLoop = Boolean(isMoving && targetDef?.playback.isLongGaitLoop);

    // Underwater water entry/exit events
    if (world.listener.underwater !== this.prevUnderWater) {
      this.emitEvent({
        type: world.listener.underwater ? 'player.water.enter' : 'player.water.exit',
        origin: 'player',
        simulationTimestamp: nowSimMs,
        position: world.listener.position,
        payload: { depth: world.listener.waterDepthM, speed: world.player.speedMps },
      });
      this.prevUnderWater = world.listener.underwater;
    }

    if (this.activeGaitSoundId && (!wantsLongGaitLoop || this.activeGaitSoundId !== targetSoundId)) {
      const cur = this.instances.findActiveForSound(this.activeGaitSoundId);
      if (cur) this.instances.requestConditionStop(cur, this.backend, nowRealMs);
      this.activeGaitSoundId = null;
    }

    if (wantsLongGaitLoop && targetDef && targetSoundId) {
      const existing = this.instances.findActiveForSound(targetSoundId);
      const speedNorm = Math.max(0.75, Math.min(1.25, world.player.speedMps / 4.6));
      if (!existing || existing.state === 'stopping') {
        const spawned = this.playSoundDefinition(targetDef, {
          world,
          explicitPosition: world.listener.position,
          sourceStructureId: world.structure.id,
          sourceInsideSameStructure: world.structure.quality !== 'outdoor',
          reason: `gait_loop:${surface}:${gait}`,
          skipQuotaRecord: true,
        });
        if (spawned) spawned.pitch = speedNorm;
      } else if (existing.state === 'paused') {
        existing.pitch = speedNorm;
        existing.position = { ...world.listener.position };
        existing.sourceStructureId = world.structure.id;
        existing.sourceInsideSameStructure = world.structure.quality !== 'outdoor';
        this.instances.resumePaused(existing, this.backend, this.mixer);
      } else {
        // Scale pitch/volume subtly with speed
        existing.pitch = speedNorm;
      }
      this.activeGaitSoundId = targetSoundId;
    }

    // Distance-based footstep events (even when long gait loop plays, steps trigger floorboard creaks/bird-startle reactions!)
    if (isMoving) {
      const strideLengthM = gait === 'run' || activity === 'sprinting' ? 1.85 : gait === 'crouch' ? 1.15 : 1.5;
      this.stepAccumM += movedDelta;
      if (this.stepAccumM >= strideLengthM) {
        this.stepAccumM %= strideLengthM;
        this.emitEvent({
          type: 'player.step',
          origin: 'player',
          simulationTimestamp: nowSimMs,
          position: world.listener.position,
          intensity: gait === 'run' ? 1.15 : gait === 'crouch' ? 0.5 : 0.85,
          payload: {
            material: surface,
            gait,
            speed: world.player.speedMps,
            wetness: world.player.surfaceWetness,
          },
        });
      }
    } else if (this.prevLocomotionMoving) {
      this.stepAccumM = 0;
    }
    this.prevLocomotionMoving = isMoving;

    // Exertion & fatigue breathing state controller (independent of footsteps, recovers smoothly!)
    const exertion = world.player.exertion;
    const tiredness = world.player.tiredness;
    const stamina = world.player.stamina;

    let desiredBreathId = 'breathing_rest';
    if (stamina < 18 || tiredness > 85 || exertion > 0.82) {
      desiredBreathId = 'breathing_exhausted';
    } else if (exertion > 0.42 || activity === 'running' || activity === 'sprinting') {
      desiredBreathId = 'breathing_exerted';
    } else if (isMoving) {
      desiredBreathId = 'breathing_walk';
    }

    if (this.activeBreathingSoundId && this.activeBreathingSoundId !== desiredBreathId) {
      const prevBreath = this.instances.findActiveForSound(this.activeBreathingSoundId);
      if (prevBreath) {
        this.instances.requestConditionStop(prevBreath, this.backend, nowRealMs);
      }
    }

    const breathDef = this.normalized.soundMap.get(desiredBreathId);
    if (breathDef) {
      const condRes = this.evaluator.evaluate(breathDef.conditions, { world }, `breath:${desiredBreathId}`, nowRealMs);
      const curBreath = this.instances.findActiveForSound(desiredBreathId);
      if (condRes.passed) {
        if (!curBreath || curBreath.state === 'stopping') {
          this.playSoundDefinition(breathDef, {
            world,
            explicitPosition: world.listener.position,
            sourceStructureId: world.structure.id,
            sourceInsideSameStructure: world.structure.quality !== 'outdoor',
            reason: `physiology:${desiredBreathId}`,
            skipQuotaRecord: true,
          });
        } else if (curBreath.state === 'paused') {
          curBreath.position = { ...world.listener.position };
          this.instances.resumePaused(curBreath, this.backend, this.mixer);
        }
        this.activeBreathingSoundId = desiredBreathId;
      } else if (curBreath) {
        this.instances.requestConditionStop(curBreath, this.backend, nowRealMs);
      }
    }
  }

  private stepMusic(world: WorldContext, nowRealMs: number): void {
    if (!this.musicEnabled || this.musicVolume <= 0.001) {
      this.stopActiveMusic(false);
      return;
    }

    let eligibleProfile = null;
    for (const mp of this.normalized.resolved.music) {
      const res = this.evaluator.evaluate(mp.conditions, { world }, `music:${mp.id}`, nowRealMs);
      if (res.passed) {
        eligibleProfile = mp;
        break;
      }
    }

    if (!eligibleProfile) {
      this.stopActiveMusic(false);
      return;
    }

    const activeVoice = this.activeMusicSoundDef
      ? this.instances.findActiveForSound(this.activeMusicSoundDef.id)
      : undefined;

    if (this.activeMusicProfileId === eligibleProfile.id && activeVoice && activeVoice.state !== 'completed') {
      if (activeVoice.state === 'stopping') {
        this.instances.spawnOrResume({
          sound: this.activeMusicSoundDef!,
          assetsMap: this.normalized.assetMap,
          world,
          backend: this.backend,
          mixer: this.mixer,
          rng: this.rng,
          nowRealMs,
          maxGlobalActiveVoices: this.normalized.resolved.engine.maxActiveVoices,
          reason: `music:${eligibleProfile.id}`,
        });
      }
      return;
    }

    if (nowRealMs < this.nextMusicAllowedRealMs) return;

    // Crossfade out previous music profile if switching biomes/time-of-day
    if (this.activeMusicSoundDef) {
      const prev = this.instances.findActiveForSound(this.activeMusicSoundDef.id);
      if (prev) this.instances.requestConditionStop(prev, this.backend, nowRealMs);
    }

    const synthSound: SoundDefinition = {
      id: `__music_${eligibleProfile.id}`,
      bus: eligibleProfile.bus,
      trigger: { type: 'continuous' },
      assets: eligibleProfile.assets,
      playback: eligibleProfile.playback,
      spatial: { mode: 'non_spatial', environmentalAcoustics: false },
    };
    this.activeMusicProfileId = eligibleProfile.id;
    this.activeMusicSoundDef = synthSound;

    const spawned = this.playSoundDefinition(synthSound, {
      world,
      reason: `music:${eligibleProfile.id}`,
      skipQuotaRecord: true,
    });
    if (!spawned) {
      this.nextMusicAllowedRealMs = nowRealMs + 10_000;
    } else if (eligibleProfile.playback.loop?.pause) {
      const [a, b] = eligibleProfile.playback.loop.pause;
      this.nextMusicAllowedRealMs = nowRealMs + this.rng.range(parseDurationMs(a, 0), parseDurationMs(b, 0));
    }
  }

  private stopActiveMusic(immediate: boolean): void {
    if (this.activeMusicSoundDef) {
      const active = this.instances.findActiveForSound(this.activeMusicSoundDef.id);
      if (active) {
        if (immediate) this.instances.disposeInstance(active, this.backend);
        else this.instances.requestConditionStop(active, this.backend, this.realClock.nowMs());
      }
    }
    this.activeMusicProfileId = null;
  }

  /**
   * Safe configuration hot-reload: validates first, preserves unaffected active voices,
   * quotas, cooldowns, disturbances, and weather history; rolls back cleanly on error.
   */
  reloadConfigFromJson(jsonText: string): {
    ok: boolean;
    issues: ValidationIssue[];
    diffSummary?: string;
  } {
    const parsed = parseAndValidateConfigJson(jsonText);
    if (!parsed.ok) {
      this.lastValidationIssues = parsed.issues;
      return { ok: false, issues: parsed.issues };
    }
    return this.applyNormalizedConfig(parsed.normalized);
  }

  reloadConfig(newConfig: SoundscapeConfig): {
    ok: boolean;
    issues: ValidationIssue[];
    diffSummary?: string;
  } {
    const norm = normalizeAndValidateConfig(newConfig);
    if (hasValidationErrors(norm.issues)) {
      this.lastValidationIssues = norm.issues;
      return { ok: false, issues: norm.issues };
    }
    return this.applyNormalizedConfig(norm);
  }

  private applyNormalizedConfig(next: NormalizedSoundscapeConfig): {
    ok: boolean;
    issues: ValidationIssue[];
    diffSummary: string;
  } {
    const prevSounds = this.normalized.soundMap;
    this.normalized = next;
    this.lastValidationIssues = [...next.issues];

    this.mixer.loadDefinitions(next.resolved.buses, false);
    this.acoustics.updateProfiles(next.resolved.acoustics);
    this.disturbances.updateProfiles(next.resolved.disturbances);
    this.backend.preloadAssets(next.resolved.assets);
    this.backend.setMasterLimiter(next.resolved.engine.masterLimiterEnabled);

    // Stop active voices whose sound definition was removed or changed bus; preserve unaffected voices!
    let updatedCount = 0;
    let removedCount = 0;
    for (const inst of this.instances.getInstances()) {
      const nextSound = next.soundMap.get(inst.sound.id);
      if (!nextSound) {
        this.instances.disposeInstance(inst, this.backend);
        removedCount++;
      } else {
        const old = prevSounds.get(inst.sound.id);
        if (JSON.stringify(old) !== JSON.stringify(nextSound)) {
          inst.sound = nextSound;
          updatedCount++;
        }
      }
    }

    return {
      ok: true,
      issues: next.issues,
      diffSummary: `Reloaded config (${next.resolved.sounds.length} sounds, ${updatedCount} updated, ${removedCount} removed; preserved active voices, quotas & disturbances)`,
    };
  }

  auditionSound(soundId: string, worldOverride?: WorldContext): boolean {
    const sound = this.normalized.soundMap.get(soundId);
    const world = worldOverride ?? this.lastWorld;
    if (!sound || !world) return false;
    const spawned = this.playSoundDefinition(sound, {
      world,
      reason: 'diagnostics:audition',
      exemptFromDisturbance: true,
      skipQuotaRecord: true,
    });
    return Boolean(spawned);
  }

  exportSnapshot(): PersistedSoundscapeState {
    const sched = this.scheduler.exportState();
    const prefs = this.mixer.exportPreferences();
    return {
      version: 1,
      simulationTimeMs: this.lastSimMs ?? 0,
      rngState: this.rng.exportState(),
      weatherHistory: this.weatherHistory.exportState(),
      windowStates: sched.windowStates,
      cooldowns: sched.cooldowns,
      pendingReactions: sched.pendingReactions,
      disturbances: this.disturbances.exportState(),
      preferences: {
        ...prefs,
        musicEnabled: this.musicEnabled,
        musicVolume: this.musicVolume,
      },
      music: {
        activeProfileId: this.activeMusicProfileId,
        shuffleBagIndices: {},
        nextAllowedPlayRealMs: this.nextMusicAllowedRealMs,
      },
    };
  }

  importSnapshot(snapshot: PersistedSoundscapeState): void {
    this.lastSimMs = snapshot.simulationTimeMs;
    this.rng.importState(snapshot.rngState);
    this.weatherHistory.importState(snapshot.weatherHistory);
    this.scheduler.importState(
      {
        windowStates: snapshot.windowStates,
        cooldowns: snapshot.cooldowns,
        pendingReactions: snapshot.pendingReactions,
      },
      this.normalized.resolved.reactions,
      snapshot.simulationTimeMs,
      this.realClock
    );
    this.disturbances.importState(snapshot.disturbances);
    this.mixer.importPreferences(snapshot.preferences);
    this.musicEnabled = snapshot.preferences.musicEnabled;
    this.musicVolume = snapshot.preferences.musicVolume;
    this.activeMusicProfileId = snapshot.music.activeProfileId;
  }

  getDiagnosticsSnapshot(): DiagnosticsSnapshot {
    const world = this.lastWorld;
    const listenerPos = world?.listener.position ?? { x: 0, y: 0, z: 0 };
    const nowSimMs = world?.simulationTimeMs ?? 0;

    const voices = this.instances.getSnapshots(
      listenerPos,
      this.mixer,
      this.acoustics,
      this.disturbances,
      nowSimMs
    );
    const virtualCount = voices.filter((v) => v.state === 'virtualised').length;
    const activeCount = voices.filter(
      (v) => v.state === 'starting' || v.state === 'playing' || v.state === 'stopping'
    ).length;

    const biomeMix = world
      ? (Object.entries(world.geography.biomeComposition) as Array<[BiomeId, number]>)
          .filter(([, w]) => w > 0.01)
          .map(([biome, weight]) => ({ biome, weight: Math.round(weight * 100) / 100 }))
      : [];

    const activeMusic = this.activeMusicSoundDef
      ? this.instances.findActiveForSound(this.activeMusicSoundDef.id)
      : undefined;

    return {
      simulationTimeMs: nowSimMs,
      timeOfDayHours: world?.timeOfDayHours ?? 0,
      realTimeMs: this.realClock.nowMs(),
      timeAcceleration: world?.timeAcceleration ?? 1,
      backendKind: this.backend.kind,
      unsupportedBackendFeatures: [...this.backend.unsupportedFeatures],
      acoustics: this.acoustics.getEvaluation(),
      biomeMix,
      voices,
      virtualCount,
      activeCount,
      queuedCount: this.instances.getQueuedCount(),
      rules: this.lastRuleRows,
      disturbances: this.disturbances.getDiagnostics(listenerPos, nowSimMs),
      recentEvents: this.eventBus.getTraceHistory().slice(-20).map((e) => ({
        id: e.id,
        type: e.type,
        origin: e.origin,
        timestampSimMs: e.simulationTimestamp,
        correlationId: e.correlationId,
        causationId: e.causationId,
        chainDepth: e.chainDepth,
      })),
      music: {
        enabled: this.musicEnabled,
        volume: this.musicVolume,
        activeProfileId: this.activeMusicProfileId,
        activeTrackId: activeMusic?.asset.id ?? null,
        state: activeMusic?.state ?? 'silent',
      },
      buses: this.mixer.getDiagnostics(),
      assetStatus: this.backend.getAssetStatus(),
      validationIssues: this.lastValidationIssues,
    };
  }

  dispose(): void {
    this.instances.disposeAll(this.backend);
    this.backend.dispose();
  }
}
