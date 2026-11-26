import { parseDistanceM, parseDurationMs, SeededRng } from './clocks';
import type { AcousticEnvironmentManager } from './acoustics';
import type { AudioBackend, BackendVoiceHandle } from './audioBackend';
import type { DisturbanceManager } from './disturbanceManager';
import type { AudioMixer } from './mixer';
import type {
  ActiveVoiceSnapshot,
  AssetDefinition,
  ConcurrencyPolicy,
  InstanceLifecycleState,
  SoundDefinition,
  SpatialQueryProvider,
  Vector3,
  WorldContext,
} from './types';

// Gapless repeats share one native source, including finite repeat counts.
// The instance timer still releases finite voices after their final clip.
function usesContinuousPlayback(sound: SoundDefinition): boolean {
  const count = sound.playback.loop?.count ?? 1;
  const pause = sound.playback.loop?.pause;
  const hasPause = pause?.some((duration) => parseDurationMs(duration, 0) > 0) ?? false;
  return (count === 'infinite' || count > 1) && !hasPause;
}

export interface ActiveSoundInstance {
  instanceId: string;
  sound: SoundDefinition;
  asset: AssetDefinition;
  emitterId: string;
  state: InstanceLifecycleState;
  backendHandle: BackendVoiceHandle | null;
  position: Vector3 | null;
  sourceStructureId: string | null;
  sourceInsideSameStructure: boolean;
  baseVolume: number;
  pitch: number;
  priority: number;
  fadeInSec: number;
  fadeOutSec: number;
  currentEnvelopeGain: number;
  targetEnvelopeGain: number;
  startedAtRealMs: number;
  stoppingStartedAtRealMs: number | null;
  loopCountTarget: number | 'infinite';
  loopsCompleted: number;
  elapsedSec: number;
  durationSec: number;
  pendingWaitSec: number;
  pauseBetweenLoopsUntilRealMs: number | null;
  resumeOffsetSec: number;
  reason: string;
  exemptFromDisturbance: boolean;
  isAudition: boolean;
  userPaused: boolean;
  pausedBeforeUserPauseState?: InstanceLifecycleState;
}

const STOPPED_VOICE_RETENTION_MS = 5000;

interface RetainedStoppedVoice {
  snapshot: ActiveVoiceSnapshot;
  stoppedAtRealMs: number;
}

interface QueuedSoundRequest {
  sound: SoundDefinition;
  emitterId: string;
  position: Vector3 | null;
  enqueuedAtRealMs: number;
  maxQueueAgeMs: number;
  sourceStructureId: string | null;
  sourceInsideSameStructure: boolean;
  reason: string;
  exemptFromDisturbance: boolean;
}

function resolveRange(val: number | [number, number] | undefined, fallback: number, rng: SeededRng): number {
  if (val === undefined) return fallback;
  if (typeof val === 'number') return val;
  return rng.range(val[0], val[1]);
}

function dist3(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export class InstanceManager {
  private instances: ActiveSoundInstance[] = [];
  private recentlyStopped: RetainedStoppedVoice[] = [];
  private queued: QueuedSoundRequest[] = [];
  private lastAssetBySound = new Map<string, string>();
  private shuffleBags = new Map<string, number[]>();
  private sequentialIdx = new Map<string, number>();
  private lastObservedRealMs = 0;
  private seq = 1;

  getInstances(): readonly ActiveSoundInstance[] {
    return this.instances;
  }

  getQueuedCount(): number {
    return this.queued.length;
  }

  findActiveForSound(
    soundId: string,
    emitterId?: string,
    includeAudition = false
  ): ActiveSoundInstance | undefined {
    return this.instances.find(
      (i) =>
        i.sound.id === soundId &&
        i.state !== 'completed' &&
        (includeAudition || !i.isAudition) &&
        (emitterId === undefined || i.emitterId === emitterId)
    );
  }

  private selectAsset(
    sound: SoundDefinition,
    assetsMap: ReadonlyMap<string, AssetDefinition>,
    rng: SeededRng
  ): AssetDefinition | null {
    const valid = sound.assets
      .map((ref) => ({ asset: assetsMap.get(ref.assetId), weight: ref.weight ?? 1 }))
      .filter((x): x is { asset: AssetDefinition; weight: number } => Boolean(x.asset));
    if (valid.length === 0) return null;
    if (valid.length === 1) {
      this.lastAssetBySound.set(sound.id, valid[0].asset.id);
      return valid[0].asset;
    }

    const mode = sound.playback.selection ?? 'weighted';
    const avoidRepeat = sound.playback.avoidConsecutiveRepetition ?? true;
    const prevId = this.lastAssetBySound.get(sound.id);

    let chosen: AssetDefinition;
    if (mode === 'sequential') {
      const idx = (this.sequentialIdx.get(sound.id) ?? 0) % valid.length;
      this.sequentialIdx.set(sound.id, idx + 1);
      chosen = valid[idx].asset;
    } else if (mode === 'shuffle_bag') {
      let bag = this.shuffleBags.get(sound.id);
      if (!bag || bag.length === 0) {
        bag = valid.map((_, i) => i);
        for (let i = bag.length - 1; i > 0; i--) {
          const j = rng.int(0, i);
          const tmp = bag[i];
          bag[i] = bag[j];
          bag[j] = tmp;
        }
        if (avoidRepeat && valid[bag[bag.length - 1]].asset.id === prevId && bag.length > 1) {
          const tmp = bag[bag.length - 1];
          bag[bag.length - 1] = bag[0];
          bag[0] = tmp;
        }
        this.shuffleBags.set(sound.id, bag);
      }
      const nextIdx = bag.pop()!;
      chosen = valid[nextIdx].asset;
    } else {
      const pool = avoidRepeat ? valid.filter((v) => v.asset.id !== prevId) : valid;
      const picked = rng.pickWeighted(pool.length > 0 ? pool : valid);
      chosen = picked!.asset;
    }

    this.lastAssetBySound.set(sound.id, chosen.id);
    return chosen;
  }

  private resolveSpawnPosition(
    sound: SoundDefinition,
    world: WorldContext,
    rng: SeededRng,
    spatialQuery?: SpatialQueryProvider,
    explicitPos?: Vector3
  ): { ok: boolean; pos: Vector3 | null } {
    if (explicitPos) {
      return { ok: true, pos: { ...explicitPos } };
    }
    const mode = sound.spatial.mode;
    if (mode === 'non_spatial' || mode === 'player_attached') {
      return { ok: true, pos: mode === 'player_attached' ? { ...world.listener.position } : null };
    }
    if (sound.spatial.onFeature && spatialQuery) {
      const minD = sound.spatial.spawnDistanceM ? parseDistanceM(sound.spatial.spawnDistanceM[0], 10) : 10;
      const maxD = sound.spatial.spawnDistanceM ? parseDistanceM(sound.spatial.spawnDistanceM[1], 100) : 100;
      const res = spatialQuery.findPointOnFeature(
        sound.spatial.onFeature,
        world.listener.position,
        minD,
        maxD,
        () => rng.next()
      );
      if (!res || !res.featureFound) {
        return { ok: false, pos: null };
      }
      return { ok: true, pos: res.position };
    }

    const [minD, maxD] = sound.spatial.spawnDistanceM
      ? [
          parseDistanceM(sound.spatial.spawnDistanceM[0], 8),
          parseDistanceM(sound.spatial.spawnDistanceM[1], 30),
        ]
      : [0, 0];
    if (maxD > 0) {
      const angle = rng.range(0, Math.PI * 2);
      const dist = rng.range(minD, maxD);
      const elev = resolveRange(sound.spatial.elevationOffsetM, 0, rng);
      return {
        ok: true,
        pos: {
          x: world.listener.position.x + Math.cos(angle) * dist,
          y: world.listener.position.y + elev,
          z: world.listener.position.z + Math.sin(angle) * dist,
        },
      };
    }

    return { ok: true, pos: { ...world.listener.position } };
  }

  spawnOrResume(params: {
    sound: SoundDefinition;
    assetsMap: ReadonlyMap<string, AssetDefinition>;
    world: WorldContext;
    backend: AudioBackend;
    mixer: AudioMixer;
    rng: SeededRng;
    nowRealMs: number;
    maxGlobalActiveVoices: number;
    spatialQuery?: SpatialQueryProvider;
    emitterId?: string;
    explicitPosition?: Vector3;
    sourceStructureId?: string | null;
    sourceInsideSameStructure?: boolean;
    reason?: string;
    exemptFromDisturbance?: boolean;
    volumeScale?: number;
    pitchScale?: number;
    allowRequeue?: boolean;
    isAudition?: boolean;
  }): { started: boolean; virtualised: boolean; rejectedReason?: string; instance?: ActiveSoundInstance } {
    const {
      sound,
      assetsMap,
      world,
      backend,
      mixer,
      rng,
      nowRealMs,
      maxGlobalActiveVoices,
      spatialQuery,
      emitterId,
      explicitPosition,
      sourceStructureId = null,
      sourceInsideSameStructure = false,
      reason = 'triggered',
      exemptFromDisturbance = false,
      volumeScale = 1,
      pitchScale = 1,
      allowRequeue = true,
      isAudition = false,
    } = params;

    const resolvedEmitterId = isAudition
      ? `audition:${sound.id}`
      : (emitterId ?? `${sound.id}:default`);

    // Fade-reversal support: if an instance of this sound+emitter is currently stopping (fading out), reverse fade instead of restarting!
    const existingStopping = this.instances.find(
      (i) =>
        i.sound.id === sound.id &&
        i.emitterId === resolvedEmitterId &&
        i.isAudition === isAudition &&
        i.state === 'stopping'
    );
    if (existingStopping) {
      existingStopping.state = 'playing';
      existingStopping.stoppingStartedAtRealMs = null;
      existingStopping.targetEnvelopeGain = 1;
      existingStopping.reason = `${reason} (fade reversed)`;
      return { started: true, virtualised: false, instance: existingStopping };
    }

    // Check definition/emitter/bus concurrency limits (paused/virtualised voices do not hold active backend voices)
    // Audition voices isolate concurrency checks from gameplay instances so active ambient/gait loops never block F9 previews.
    const isAudibleActive = (i: ActiveSoundInstance) =>
      i.state === 'starting' || i.state === 'playing' || i.state === 'stopping';
    const sameDef = this.instances.filter(
      (i) =>
        i.sound.id === sound.id &&
        isAudibleActive(i) &&
        (isAudition ? i.isAudition : !i.isAudition)
    );
    const maxDef = sound.playback.maxInstances;
    const sameBus = this.instances.filter(
      (i) =>
        i.sound.bus === sound.bus &&
        isAudibleActive(i) &&
        (isAudition ? i.isAudition : !i.isAudition)
    );
    const maxBus = mixer.getMaxConcurrency(sound.bus);
    const activeNonVirtual = this.instances.filter(isAudibleActive);

    const defHit = maxDef !== undefined && sameDef.length >= maxDef;
    const busHit = maxBus !== undefined && sameBus.length >= maxBus;
    const globalHit = activeNonVirtual.length >= maxGlobalActiveVoices;

    const policy: ConcurrencyPolicy = sound.playback.concurrencyPolicy ?? 'allow';
    const basePriority = sound.playback.priority ?? 50;
    const newPriority = isAudition ? Math.max(basePriority, 85) : basePriority;

    if (defHit || busHit) {
      const candidates = defHit ? sameDef : sameBus;

      if (policy === 'reject_new') {
        return { started: false, virtualised: false, rejectedReason: 'concurrency reject_new' };
      }
      if (policy === 'queue') {
        if (!allowRequeue) {
          return { started: false, virtualised: false, rejectedReason: 'concurrency_busy' };
        }
        const maxQueueAgeMs = parseDurationMs(sound.playback.maxQueueAgeMs, 350);
        const posRes = this.resolveSpawnPosition(sound, world, rng, spatialQuery, explicitPosition);
        if (!posRes.ok) return { started: false, virtualised: false, rejectedReason: 'source placement unavailable' };
        this.queued.push({
          sound,
          emitterId: resolvedEmitterId,
          position: posRes.pos,
          enqueuedAtRealMs: nowRealMs,
          maxQueueAgeMs,
          sourceStructureId,
          sourceInsideSameStructure,
          reason,
          exemptFromDisturbance,
        });
        return { started: false, virtualised: false, rejectedReason: 'queued' };
      }
      if (policy === 'restart' && candidates.length > 0) {
        this.disposeInstance(candidates[0], backend);
      } else if (policy === 'replace_oldest' && candidates.length > 0) {
        const oldest = [...candidates].sort((a, b) => a.startedAtRealMs - b.startedAtRealMs)[0];
        this.disposeInstance(oldest, backend);
      } else if (policy === 'replace_quietest' && candidates.length > 0) {
        const quietest = [...candidates].sort((a, b) => a.currentEnvelopeGain * a.baseVolume - b.currentEnvelopeGain * b.baseVolume)[0];
        if (quietest.priority <= newPriority) {
          this.disposeInstance(quietest, backend);
        } else {
          return { started: false, virtualised: false, rejectedReason: 'existing priority higher' };
        }
      } else if (policy === 'replace_lowest_priority' && candidates.length > 0) {
        const lowest = [...candidates].sort((a, b) => a.priority - b.priority)[0];
        if (lowest.priority < newPriority) {
          this.disposeInstance(lowest, backend);
        } else {
          return { started: false, virtualised: false, rejectedReason: 'no lower priority voice' };
        }
      }
    }

    // Re-evaluate global active voice budget after any def/bus eviction; preempt lowest priority if needed
    const activeAfterDef = this.instances.filter(
      (i) => i.state === 'starting' || i.state === 'playing' || i.state === 'stopping'
    );
    if (activeAfterDef.length >= maxGlobalActiveVoices && policy !== 'virtualise') {
      const lowestGlobal = [...activeAfterDef].sort((a, b) => a.priority - b.priority)[0];
      if (lowestGlobal && lowestGlobal.priority < newPriority) {
        if (lowestGlobal.loopCountTarget === 'infinite') {
          lowestGlobal.state = 'virtualised';
          if (lowestGlobal.backendHandle) {
            backend.stopVoice(lowestGlobal.backendHandle, 0.04);
            lowestGlobal.backendHandle = null;
          }
        } else {
          this.disposeInstance(lowestGlobal, backend);
        }
      } else if (policy === 'queue') {
        if (!allowRequeue) {
          return { started: false, virtualised: false, rejectedReason: 'concurrency_busy' };
        }
        const maxQueueAgeMs = parseDurationMs(sound.playback.maxQueueAgeMs, 350);
        const posRes = this.resolveSpawnPosition(sound, world, rng, spatialQuery, explicitPosition);
        if (!posRes.ok) return { started: false, virtualised: false, rejectedReason: 'source placement unavailable' };
        this.queued.push({
          sound,
          emitterId: resolvedEmitterId,
          position: posRes.pos,
          enqueuedAtRealMs: nowRealMs,
          maxQueueAgeMs,
          sourceStructureId,
          sourceInsideSameStructure,
          reason,
          exemptFromDisturbance,
        });
        return { started: false, virtualised: false, rejectedReason: 'queued_global_budget' };
      } else {
        return { started: false, virtualised: false, rejectedReason: 'global_voice_budget_full' };
      }
    }

    const posRes = isAudition
      ? { ok: true, pos: null }
      : this.resolveSpawnPosition(sound, world, rng, spatialQuery, explicitPosition);
    if (!posRes.ok) {
      return { started: false, virtualised: false, rejectedReason: 'feature placement failed' };
    }

    const asset = this.selectAsset(sound, assetsMap, rng);
    if (!asset) {
      return { started: false, virtualised: false, rejectedReason: 'no valid asset' };
    }

    const assetGainScale = asset.gainScale ?? 1;
    const rawBaseVolume = Math.max(0, resolveRange(sound.playback.volume, 0.7, rng) * volumeScale * assetGainScale);
    const baseVolume = isAudition ? Math.max(0.58 * assetGainScale, rawBaseVolume) : rawBaseVolume;
    const pitch = Math.max(0.25, resolveRange(sound.playback.pitch, 1.0, rng) * pitchScale);
    const fadeInSec = isAudition ? 0 : Math.max(0, parseDurationMs(sound.playback.fadeInMs, 0) / 1000);
    const fadeOutSec = Math.max(0.02, parseDurationMs(sound.playback.fadeOutMs, 200) / 1000);
    const loopCountTarget = sound.playback.loop?.count ?? 1;
    const durationSec = asset.durationSec ?? 2.0;

    // Check distance cull -> spawn virtualised if beyond maximumDistanceM or if policy is virtualise on budget hit
    const maxDistM = parseDistanceM(sound.spatial.maximumDistanceM, 200);
    const curDistM = posRes.pos ? dist3(posRes.pos, world.listener.position) : 0;
    const activeCountAfter = this.instances.filter(
      (i) => i.state === 'starting' || i.state === 'playing' || i.state === 'stopping'
    ).length;
    const shouldVirtualise =
      !isAudition &&
      policy === 'virtualise' &&
      (activeCountAfter >= maxGlobalActiveVoices ||
        (sound.spatial.mode !== 'non_spatial' && curDistM > maxDistM));

    const inst: ActiveSoundInstance = {
      instanceId: `voice_${this.seq++}`,
      sound,
      asset,
      emitterId: resolvedEmitterId,
      state: shouldVirtualise ? 'virtualised' : fadeInSec > 0 ? 'starting' : 'playing',
      backendHandle: null,
      position: posRes.pos,
      sourceStructureId,
      sourceInsideSameStructure,
      baseVolume,
      pitch,
      priority: newPriority,
      fadeInSec,
      fadeOutSec,
      currentEnvelopeGain: fadeInSec > 0 ? 0 : 1,
      targetEnvelopeGain: 1,
      startedAtRealMs: nowRealMs,
      stoppingStartedAtRealMs: null,
      loopCountTarget,
      loopsCompleted: 0,
      elapsedSec: 0,
      durationSec,
      pendingWaitSec: 0,
      pauseBetweenLoopsUntilRealMs: null,
      resumeOffsetSec: 0,
      reason,
      exemptFromDisturbance: exemptFromDisturbance || isAudition,
      isAudition,
      userPaused: false,
    };

    if (!shouldVirtualise) {
      const initialGain = inst.currentEnvelopeGain * baseVolume * mixer.getEffectiveGain(sound.bus);
      inst.backendHandle = backend.startVoice({
        instanceId: inst.instanceId,
        soundId: sound.id,
        asset,
        busId: sound.bus,
        spatialMode: isAudition ? 'non_spatial' : sound.spatial.mode,
        position: isAudition ? null : inst.position,
        referenceDistanceM: parseDistanceM(sound.spatial.referenceDistanceM, 5),
        maximumDistanceM: maxDistM,
        rolloffFactor: sound.spatial.rolloffFactor ?? 1.0,
        gain: initialGain,
        pitch,
        lowpassHz: isAudition ? 20000 : 18000,
        loop: usesContinuousPlayback(sound),
        offsetSec: 0,
      });
    }

    this.instances.push(inst);
    return { started: !shouldVirtualise, virtualised: shouldVirtualise, instance: inst };
  }

  requestConditionStop(inst: ActiveSoundInstance, backend: AudioBackend, nowRealMs: number): void {
    if (inst.state === 'completed' || inst.state === 'stopping') return;
    const policy =
      inst.sound.playback.onConditionLost ??
      (inst.sound.trigger.type === 'continuous' || inst.sound.trigger.type === 'state_driven'
        ? 'fade_out'
        : 'finish');

    if (policy === 'finish') {
      // Allow current transient playback to finish naturally!
      if (inst.loopCountTarget === 'infinite') {
        inst.loopCountTarget = inst.loopsCompleted + 1;
      }
      return;
    }
    if (policy === 'pause') {
      inst.state = 'paused';
      inst.resumeOffsetSec = inst.elapsedSec;
      if (inst.backendHandle) {
        backend.stopVoice(inst.backendHandle, 0.04);
        inst.backendHandle = null;
      }
      return;
    }
    if (policy === 'stop_immediately') {
      this.disposeInstance(inst, backend);
      return;
    }
    // fade_out / crossfade
    inst.state = 'stopping';
    inst.targetEnvelopeGain = 0;
    inst.stoppingStartedAtRealMs = nowRealMs;
  }

  resumePaused(
    inst: ActiveSoundInstance,
    backend: AudioBackend,
    mixer: AudioMixer
  ): void {
    if (inst.state !== 'paused' || inst.userPaused) return;
    inst.state = inst.fadeInSec > 0.01 ? 'starting' : 'playing';
    inst.stoppingStartedAtRealMs = null;
    inst.currentEnvelopeGain = inst.fadeInSec > 0.01 ? Math.max(0.05, Math.min(inst.currentEnvelopeGain, 0.25)) : 1;
    inst.targetEnvelopeGain = 1;
    const offset = inst.sound.playback.loop?.preserveOffsetOnResume !== false ? inst.resumeOffsetSec : 0;
    const maxDistM = parseDistanceM(inst.sound.spatial.maximumDistanceM, 200);
    inst.backendHandle = backend.startVoice({
      instanceId: inst.instanceId,
      soundId: inst.sound.id,
      asset: inst.asset,
      busId: inst.sound.bus,
      spatialMode: inst.sound.spatial.mode,
      position: inst.position,
      referenceDistanceM: parseDistanceM(inst.sound.spatial.referenceDistanceM, 5),
      maximumDistanceM: maxDistM,
      rolloffFactor: inst.sound.spatial.rolloffFactor ?? 1.0,
      gain: inst.currentEnvelopeGain * inst.baseVolume * mixer.getEffectiveGain(inst.sound.bus),
      pitch: inst.pitch,
      lowpassHz: 18000,
      loop: usesContinuousPlayback(inst.sound),
      offsetSec: offset,
    });
  }

  private pruneStopped(nowRealMs: number): void {
    if (this.recentlyStopped.length === 0) return;
    this.recentlyStopped = this.recentlyStopped.filter(
      (entry) => nowRealMs >= entry.stoppedAtRealMs && nowRealMs - entry.stoppedAtRealMs < STOPPED_VOICE_RETENTION_MS
    );
  }

  private recordStoppedVoice(inst: ActiveSoundInstance, nowRealMs: number): void {
    const snap: ActiveVoiceSnapshot = {
      instanceId: inst.instanceId,
      soundId: inst.sound.id,
      assetId: inst.asset.id,
      bus: inst.sound.bus,
      state: 'stopped',
      spatialMode: inst.isAudition ? 'non_spatial' : inst.sound.spatial.mode,
      position: inst.isAudition ? null : inst.position ? { ...inst.position } : null,
      distanceM: null,
      effectiveGain: 0,
      lowpassHz: inst.isAudition ? 20000 : 18000,
      pitch: Math.round(inst.pitch * 100) / 100,
      loopCountTarget: inst.loopCountTarget,
      loopsCompleted: inst.loopsCompleted,
      elapsedSec: Math.round(inst.elapsedSec * 10) / 10,
      durationSec: Math.round(inst.durationSec * 10) / 10,
      reason: inst.reason,
      isAudition: inst.isAudition,
      userPaused: false,
      stoppedAtRealMs: nowRealMs,
    };
    this.recentlyStopped = this.recentlyStopped.filter((e) => e.snapshot.instanceId !== inst.instanceId);
    this.recentlyStopped.unshift({ snapshot: snap, stoppedAtRealMs: nowRealMs });
    if (this.recentlyStopped.length > 40) {
      this.recentlyStopped.length = 40;
    }
    this.pruneStopped(nowRealMs);
  }

  disposeInstance(inst: ActiveSoundInstance, backend: AudioBackend, nowRealMs = this.lastObservedRealMs): void {
    if (inst.state !== 'completed') {
      this.recordStoppedVoice(inst, nowRealMs);
    }
    if (inst.backendHandle) {
      backend.stopVoice(inst.backendHandle, 0.02);
      inst.backendHandle = null;
    }
    inst.userPaused = false;
    inst.state = 'completed';
  }

  pauseInstanceById(instanceId: string, backend: AudioBackend): boolean {
    const inst = this.instances.find((i) => i.instanceId === instanceId && i.state !== 'completed');
    if (!inst || inst.userPaused) return false;
    inst.pausedBeforeUserPauseState = inst.state === 'paused' ? 'playing' : inst.state;
    inst.userPaused = true;
    inst.state = 'paused';
    inst.resumeOffsetSec = inst.elapsedSec;
    if (inst.backendHandle) {
      if (typeof inst.backendHandle.setPaused === 'function') {
        inst.backendHandle.setPaused(true);
      } else {
        backend.stopVoice(inst.backendHandle, 0.02);
        inst.backendHandle = null;
      }
    }
    return true;
  }

  resumeInstanceById(instanceId: string, backend: AudioBackend, mixer: AudioMixer): boolean {
    const inst = this.instances.find((i) => i.instanceId === instanceId && i.state !== 'completed');
    if (!inst || !inst.userPaused) return false;
    inst.userPaused = false;
    const prev = inst.pausedBeforeUserPauseState;
    inst.state = prev && prev !== 'paused' && prev !== 'completed' ? prev : 'playing';
    inst.pausedBeforeUserPauseState = undefined;
    if (inst.backendHandle) {
      if (typeof inst.backendHandle.setPaused === 'function') {
        inst.backendHandle.setPaused(false);
      }
    } else if (inst.state !== 'virtualised') {
      const maxDistM = parseDistanceM(inst.sound.spatial.maximumDistanceM, 200);
      inst.backendHandle = backend.startVoice({
        instanceId: inst.instanceId,
        soundId: inst.sound.id,
        asset: inst.asset,
        busId: inst.sound.bus,
        spatialMode: inst.isAudition ? 'non_spatial' : inst.sound.spatial.mode,
        position: inst.isAudition ? null : inst.position,
        referenceDistanceM: parseDistanceM(inst.sound.spatial.referenceDistanceM, 5),
        maximumDistanceM: maxDistM,
        rolloffFactor: inst.sound.spatial.rolloffFactor ?? 1.0,
        gain: inst.currentEnvelopeGain * inst.baseVolume * mixer.getEffectiveGain(inst.sound.bus),
        pitch: inst.pitch,
        lowpassHz: inst.isAudition ? 20000 : 18000,
        loop: usesContinuousPlayback(inst.sound),
        offsetSec: inst.resumeOffsetSec,
      });
    }
    return true;
  }

  stopInstanceById(instanceId: string, backend: AudioBackend, nowRealMs = this.lastObservedRealMs): boolean {
    const inst = this.instances.find((i) => i.instanceId === instanceId && i.state !== 'completed');
    if (!inst) return false;
    this.disposeInstance(inst, backend, nowRealMs);
    this.instances = this.instances.filter((i) => i.state !== 'completed');
    return true;
  }

  getStoppedSnapshots(nowRealMs = this.lastObservedRealMs): ActiveVoiceSnapshot[] {
    this.pruneStopped(nowRealMs);
    return this.recentlyStopped.map((entry) => ({
      ...entry.snapshot,
      stoppedAtRealMs: entry.stoppedAtRealMs,
    }));
  }

  step(params: {
    dtRealSec: number;
    nowRealMs: number;
    nowSimMs: number;
    world: WorldContext;
    backend: AudioBackend;
    mixer: AudioMixer;
    acoustics: AcousticEnvironmentManager;
    disturbances: DisturbanceManager;
    assetsMap: ReadonlyMap<string, AssetDefinition>;
    rng: SeededRng;
    maxGlobalActiveVoices: number;
    spatialQuery?: SpatialQueryProvider;
  }): Map<string, number> {
    const {
      dtRealSec,
      nowRealMs,
      nowSimMs,
      world,
      backend,
      mixer,
      acoustics,
      disturbances,
      assetsMap,
      rng,
      maxGlobalActiveVoices,
      spatialQuery,
    } = params;
    this.lastObservedRealMs = nowRealMs;
    this.pruneStopped(nowRealMs);

    // 1. Drain or expire queued requests safely using a snapshot (prevents infinite synchronous re-enqueue loops!)
    if (this.queued.length > 0) {
      const pending = this.queued;
      this.queued = [];
      const nextQueued: QueuedSoundRequest[] = [];
      for (const q of pending) {
        if (nowRealMs - q.enqueuedAtRealMs > q.maxQueueAgeMs) {
          continue; // Drop expired transient!
        }
        const activeCount = this.instances.filter(
          (i) => i.state === 'starting' || i.state === 'playing' || i.state === 'stopping'
        ).length;
        if (activeCount < maxGlobalActiveVoices) {
          const res = this.spawnOrResume({
            sound: q.sound,
            assetsMap,
            world,
            backend,
            mixer,
            rng,
            nowRealMs,
            maxGlobalActiveVoices,
            spatialQuery,
            emitterId: q.emitterId,
            explicitPosition: q.position ?? undefined,
            sourceStructureId: q.sourceStructureId,
            sourceInsideSameStructure: q.sourceInsideSameStructure,
            reason: `${q.reason} (dequeued)`,
            exemptFromDisturbance: q.exemptFromDisturbance,
            allowRequeue: false,
          });
          if (!res.started && !res.virtualised && res.rejectedReason === 'concurrency_busy') {
            nextQueued.push(q);
          }
        } else {
          nextQueued.push(q);
        }
      }
      if (nextQueued.length > 0) {
        this.queued.push(...nextQueued);
      }
    }

    const activeByBus = new Map<string, number>();

    for (const inst of this.instances) {
      if (inst.state === 'completed' || inst.state === 'paused') continue;

      if (!inst.isAudition && this.spatialModeIsAttached(inst)) {
        inst.position = { ...world.listener.position };
        inst.sourceStructureId = world.structure.id;
        inst.sourceInsideSameStructure = world.structure.quality !== 'outdoor';
      }

      // Track position within the source clip. Playback rate changes both its
      // wall-clock lifetime and the source offset used when resuming a voice.
      if (inst.pauseBetweenLoopsUntilRealMs !== null) {
        if (nowRealMs >= inst.pauseBetweenLoopsUntilRealMs) {
          inst.pauseBetweenLoopsUntilRealMs = null;
          inst.elapsedSec = 0;
          if (inst.state !== 'virtualised' && !inst.backendHandle) {
            const nextAsset = this.selectAsset(inst.sound, assetsMap, rng) ?? inst.asset;
            inst.asset = nextAsset;
            inst.durationSec = nextAsset.durationSec ?? inst.durationSec;
            inst.backendHandle = backend.startVoice({
              instanceId: inst.instanceId,
              soundId: inst.sound.id,
              asset: inst.asset,
              busId: inst.sound.bus,
              spatialMode: inst.isAudition ? 'non_spatial' : inst.sound.spatial.mode,
              position: inst.isAudition ? null : inst.position,
              referenceDistanceM: parseDistanceM(inst.sound.spatial.referenceDistanceM, 5),
              maximumDistanceM: parseDistanceM(inst.sound.spatial.maximumDistanceM, 200),
              rolloffFactor: inst.sound.spatial.rolloffFactor ?? 1.0,
              gain: inst.currentEnvelopeGain * inst.baseVolume * mixer.getEffectiveGain(inst.sound.bus),
              pitch: inst.pitch,
              lowpassHz: inst.isAudition ? 20000 : 18000,
              loop: false,
              offsetSec: 0,
            });
          }
        }
      } else if (inst.backendHandle?.isPendingLoad && inst.pendingWaitSec < 8.0) {
        inst.pendingWaitSec += dtRealSec;
      } else {
        inst.elapsedSec += dtRealSec * inst.pitch;
        const duration = Math.max(0.1, inst.backendHandle?.durationSec ?? inst.durationSec);
        if (inst.elapsedSec >= duration) {
          inst.loopsCompleted += 1;
          const targetLoops = inst.loopCountTarget;
          if (targetLoops !== 'infinite' && inst.loopsCompleted >= targetLoops) {
            this.disposeInstance(inst, backend, nowRealMs);
            continue;
          }
          if (inst.sound.playback.loop?.pause) {
            const [pA, pB] = inst.sound.playback.loop.pause;
            const pauseMs = rng.range(parseDurationMs(pA, 0), parseDurationMs(pB, 0));
            if (pauseMs > 0 || !usesContinuousPlayback(inst.sound)) {
              if (inst.backendHandle) {
                backend.stopVoice(inst.backendHandle, 0.04);
                inst.backendHandle = null;
              }
              inst.pauseBetweenLoopsUntilRealMs = nowRealMs + pauseMs;
            }
          }
          inst.elapsedSec %= duration;
        }
      }

      // Envelope fades (supports smooth fade reversal!)
      if (inst.state === 'starting') {
        if (inst.fadeInSec <= 0.001) {
          inst.currentEnvelopeGain = 1;
          inst.state = 'playing';
        } else {
          inst.currentEnvelopeGain = Math.min(1, inst.currentEnvelopeGain + dtRealSec / inst.fadeInSec);
          if (inst.currentEnvelopeGain >= 0.999) {
            inst.currentEnvelopeGain = 1;
            inst.state = 'playing';
          }
        }
      } else if (inst.state === 'playing') {
        if (inst.currentEnvelopeGain < 1) {
          const rate = inst.fadeInSec > 0.01 ? 1 / inst.fadeInSec : 6;
          inst.currentEnvelopeGain = Math.min(1, inst.currentEnvelopeGain + dtRealSec * rate);
        }
      } else if (inst.state === 'stopping') {
        if (inst.fadeOutSec <= 0.001) {
          this.disposeInstance(inst, backend, nowRealMs);
          continue;
        }
        inst.currentEnvelopeGain = Math.max(0, inst.currentEnvelopeGain - dtRealSec / inst.fadeOutSec);
        if (inst.currentEnvelopeGain <= 0.002) {
          this.disposeInstance(inst, backend, nowRealMs);
          continue;
        }
      }

      // Check virtualisation transitions for spatial sounds
      const maxDistM = parseDistanceM(inst.sound.spatial.maximumDistanceM, 200);
      const distM = inst.position ? dist3(inst.position, world.listener.position) : 0;
      if (inst.state === 'virtualised') {
        const activeNow = this.instances.filter(
          (i) => i.state === 'starting' || i.state === 'playing' || i.state === 'stopping'
        ).length;
        if (
          activeNow < maxGlobalActiveVoices &&
          (inst.sound.spatial.mode === 'non_spatial' || distM <= maxDistM * 0.92)
        ) {
          inst.state = 'playing';
          inst.backendHandle = backend.startVoice({
            instanceId: inst.instanceId,
            soundId: inst.sound.id,
            asset: inst.asset,
            busId: inst.sound.bus,
            spatialMode: inst.sound.spatial.mode,
            position: inst.position,
            referenceDistanceM: parseDistanceM(inst.sound.spatial.referenceDistanceM, 5),
            maximumDistanceM: maxDistM,
            rolloffFactor: inst.sound.spatial.rolloffFactor ?? 1.0,
            gain: 0.001,
            pitch: inst.pitch,
            lowpassHz: 18000,
            loop: usesContinuousPlayback(inst.sound),
            offsetSec: inst.elapsedSec,
          });
        }
        continue;
      }

      if (!inst.isAudition && inst.sound.spatial.mode !== 'non_spatial' && distM > maxDistM * 1.15 && inst.loopCountTarget === 'infinite') {
        inst.state = 'virtualised';
        if (inst.backendHandle) {
          backend.stopVoice(inst.backendHandle, 0.05);
          inst.backendHandle = null;
        }
        continue;
      }

      // Compute final gain & filtering (Bus * Envelope * Acoustics * Disturbance)
      // Audition previews bypass acoustic muffling, occlusion, and disturbance suppression.
      const busGain = mixer.getEffectiveGain(inst.sound.bus);
      let finalGain: number;
      let lowpassHz: number;
      if (inst.isAudition) {
        finalGain = inst.currentEnvelopeGain * inst.baseVolume * busGain;
        lowpassHz = 20000;
      } else {
        const bypassEnv = mixer.bypassesEnvironmentalAttenuation(inst.sound.bus);
        const occFactor =
          inst.sound.spatial.occlusion && inst.position && spatialQuery?.computeOcclusionFactor
            ? spatialQuery.computeOcclusionFactor(world.listener.position, inst.position)
            : 0;

        const prop = acoustics.evaluatePropagation({
          busId: inst.sound.bus,
          spatialMode: inst.sound.spatial.mode,
          environmentalAcoustics: inst.sound.spatial.environmentalAcoustics ?? true,
          occlusionEnabled: inst.sound.spatial.occlusion ?? false,
          bypassBusEnvironmental: bypassEnv,
          sourceInsideSameStructure: inst.sourceInsideSameStructure,
          sourceStructureId: inst.sourceStructureId,
          listenerStructureId: world.structure.id,
          occlusionFactor: occFactor,
          soundTags: inst.sound.tags,
        });

        const distSupp = disturbances.evaluateSuppression({
          soundId: inst.sound.id,
          busId: inst.sound.bus,
          tags: inst.sound.tags,
          position: inst.position ?? world.listener.position,
          simTimeMs: nowSimMs,
          mixer,
          exemptFromDisturbance: inst.exemptFromDisturbance,
        });

        finalGain =
          inst.currentEnvelopeGain *
          inst.baseVolume *
          busGain *
          prop.gainMultiplier *
          distSupp.gainMultiplier;
        lowpassHz = prop.lowpassHz;
      }

      if (inst.backendHandle) {
        backend.updateVoice(inst.backendHandle, {
          gain: finalGain,
          pitch: inst.pitch,
          lowpassHz,
          position: inst.isAudition ? null : inst.position,
        });
      }

      activeByBus.set(inst.sound.bus, (activeByBus.get(inst.sound.bus) ?? 0) + 1);
    }

    this.instances = this.instances.filter((i) => i.state !== 'completed');
    return activeByBus;
  }

  stepAuditionOnly(params: {
    dtRealSec: number;
    nowRealMs: number;
    backend: AudioBackend;
    mixer: AudioMixer;
    assetsMap: ReadonlyMap<string, AssetDefinition>;
    rng: SeededRng;
  }): void {
    const { dtRealSec, nowRealMs, backend, mixer, assetsMap, rng } = params;
    this.lastObservedRealMs = nowRealMs;
    this.pruneStopped(nowRealMs);
    for (const inst of this.instances) {
      if (!inst.isAudition || inst.state === 'completed' || inst.state === 'paused') continue;

      if (inst.pauseBetweenLoopsUntilRealMs !== null) {
        if (nowRealMs >= inst.pauseBetweenLoopsUntilRealMs) {
          inst.pauseBetweenLoopsUntilRealMs = null;
          inst.elapsedSec = 0;
          if (!inst.backendHandle) {
            const nextAsset = this.selectAsset(inst.sound, assetsMap, rng) ?? inst.asset;
            inst.asset = nextAsset;
            inst.durationSec = nextAsset.durationSec ?? inst.durationSec;
            inst.backendHandle = backend.startVoice({
              instanceId: inst.instanceId,
              soundId: inst.sound.id,
              asset: inst.asset,
              busId: inst.sound.bus,
              spatialMode: 'non_spatial',
              position: null,
              referenceDistanceM: 5,
              maximumDistanceM: 200,
              rolloffFactor: 1.0,
              gain: inst.currentEnvelopeGain * inst.baseVolume * mixer.getEffectiveGain(inst.sound.bus),
              pitch: inst.pitch,
              lowpassHz: 20000,
              loop: false,
              offsetSec: 0,
            });
          }
        }
      } else if (inst.backendHandle?.isPendingLoad && inst.pendingWaitSec < 8.0) {
        inst.pendingWaitSec += dtRealSec;
      } else {
        inst.elapsedSec += dtRealSec * inst.pitch;
        const duration = Math.max(0.1, inst.backendHandle?.durationSec ?? inst.durationSec);
        if (inst.elapsedSec >= duration) {
          inst.loopsCompleted += 1;
          const targetLoops = inst.loopCountTarget;
          if (targetLoops !== 'infinite' && inst.loopsCompleted >= targetLoops) {
            this.disposeInstance(inst, backend, nowRealMs);
            continue;
          }
          inst.elapsedSec %= duration;
        }
      }

      if (inst.state === 'stopping') {
        this.disposeInstance(inst, backend, nowRealMs);
        continue;
      }

      if (inst.backendHandle) {
        backend.updateVoice(inst.backendHandle, {
          gain: inst.currentEnvelopeGain * inst.baseVolume * mixer.getEffectiveGain(inst.sound.bus),
          pitch: inst.pitch,
          lowpassHz: 20000,
          position: null,
        });
      }
    }
    this.instances = this.instances.filter((i) => i.state !== 'completed');
  }

  stopAuditionInstances(backend: AudioBackend, nowRealMs = this.lastObservedRealMs): number {
    let stoppedCount = 0;
    for (const inst of this.instances) {
      if (inst.isAudition && inst.state !== 'completed') {
        this.disposeInstance(inst, backend, nowRealMs);
        stoppedCount++;
      }
    }
    if (stoppedCount > 0) {
      this.instances = this.instances.filter((i) => i.state !== 'completed');
    }
    return stoppedCount;
  }

  private spatialModeIsAttached(inst: ActiveSoundInstance): boolean {
    return inst.sound.spatial.mode === 'player_attached' || inst.sound.spatial.mode === 'listener_relative';
  }

  getSnapshots(listenerPos: Vector3, mixer: AudioMixer, acoustics: AcousticEnvironmentManager, disturbances: DisturbanceManager, nowSimMs: number): ActiveVoiceSnapshot[] {
    return this.instances.map((inst) => {
      if (inst.isAudition) {
        const effGain = inst.currentEnvelopeGain * inst.baseVolume * mixer.getEffectiveGain(inst.sound.bus);
        return {
          instanceId: inst.instanceId,
          soundId: inst.sound.id,
          assetId: inst.asset.id,
          bus: inst.sound.bus,
          state: inst.state,
          spatialMode: 'non_spatial',
          position: null,
          distanceM: null,
          effectiveGain: Math.round(effGain * 1000) / 1000,
          lowpassHz: 20000,
          pitch: Math.round(inst.pitch * 100) / 100,
          loopCountTarget: inst.loopCountTarget,
          loopsCompleted: inst.loopsCompleted,
          elapsedSec: Math.round(inst.elapsedSec * 10) / 10,
          durationSec: Math.round(inst.durationSec * 10) / 10,
          reason: inst.reason,
          isAudition: true,
          userPaused: inst.userPaused,
        };
      }

      const distM = inst.position ? Math.round(dist3(inst.position, listenerPos) * 10) / 10 : null;
      const prop = acoustics.evaluatePropagation({
        busId: inst.sound.bus,
        spatialMode: inst.sound.spatial.mode,
        environmentalAcoustics: inst.sound.spatial.environmentalAcoustics ?? true,
        occlusionEnabled: inst.sound.spatial.occlusion ?? false,
        bypassBusEnvironmental: mixer.bypassesEnvironmentalAttenuation(inst.sound.bus),
        sourceInsideSameStructure: inst.sourceInsideSameStructure,
        sourceStructureId: inst.sourceStructureId,
        listenerStructureId: null,
        soundTags: inst.sound.tags,
      });
      const supp = disturbances.evaluateSuppression({
        soundId: inst.sound.id,
        busId: inst.sound.bus,
        tags: inst.sound.tags,
        position: inst.position ?? listenerPos,
        simTimeMs: nowSimMs,
        mixer,
        exemptFromDisturbance: inst.exemptFromDisturbance,
      });
      const effGain =
        inst.currentEnvelopeGain *
        inst.baseVolume *
        mixer.getEffectiveGain(inst.sound.bus) *
        prop.gainMultiplier *
        supp.gainMultiplier;

      return {
        instanceId: inst.instanceId,
        soundId: inst.sound.id,
        assetId: inst.asset.id,
        bus: inst.sound.bus,
        state: inst.state,
        spatialMode: inst.sound.spatial.mode,
        position: inst.position ? { ...inst.position } : null,
        distanceM: distM,
        effectiveGain: Math.round(effGain * 1000) / 1000,
        lowpassHz: prop.lowpassHz,
        pitch: Math.round(inst.pitch * 100) / 100,
        loopCountTarget: inst.loopCountTarget,
        loopsCompleted: inst.loopsCompleted,
        elapsedSec: Math.round(inst.elapsedSec * 10) / 10,
        durationSec: Math.round(inst.durationSec * 10) / 10,
        reason: inst.reason,
        isAudition: false,
        userPaused: inst.userPaused,
      };
    });
  }

  disposeAll(backend: AudioBackend): void {
    for (const inst of this.instances) {
      if (inst.backendHandle) {
        backend.stopVoice(inst.backendHandle, 0);
        inst.backendHandle = null;
      }
      inst.state = 'completed';
    }
    this.instances = [];
    this.recentlyStopped = [];
    this.queued = [];
  }
}
