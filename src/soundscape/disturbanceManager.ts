import { parseDistanceM, parseDurationMs, SeededRng } from './clocks';
import type { AudioMixer } from './mixer';
import type {
  ActiveDisturbanceSnapshot,
  BusId,
  DisturbanceEffectDef,
  DisturbanceProfile,
  PersistedSoundscapeState,
  SimulationEvent,
  Vector3,
} from './types';

interface ActiveTargetRecovery {
  effect: DisturbanceEffectDef;
  fadeOutEndSimMs: number;
  recoveryDelayEndSimMs: number;
  recoveryFadeEndSimMs: number;
}

interface ActiveDisturbanceInstance {
  instanceId: string;
  profile: DisturbanceProfile;
  origin: Vector3;
  createdAtSimMs: number;
  activateAtSimMs: number;
  radiusM: number;
  intensity: number;
  targets: ActiveTargetRecovery[];
}

export interface TargetSuppressionResult {
  gainMultiplier: number;
  blockNewEvents: boolean;
}

function dist3(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export class DisturbanceManager {
  private profiles = new Map<string, DisturbanceProfile>();
  private instances: ActiveDisturbanceInstance[] = [];
  private seq = 1;

  constructor(profiles: readonly DisturbanceProfile[]) {
    this.updateProfiles(profiles);
  }

  updateProfiles(profiles: readonly DisturbanceProfile[]): void {
    this.profiles.clear();
    for (const p of profiles) this.profiles.set(p.id, p);
  }

  handleEvent(event: SimulationEvent, listenerPos: Vector3, rng: SeededRng): void {
    for (const profile of this.profiles.values()) {
      if (profile.trigger.event !== event.type) continue;
      if (
        profile.trigger.minIntensity !== undefined &&
        (event.intensity ?? 1) < profile.trigger.minIntensity
      ) {
        continue;
      }
      const origin =
        profile.spatial.origin === 'event.position' && event.position
          ? { ...event.position }
          : { ...listenerPos };
      this.activateProfile(profile, origin, event.simulationTimestamp, event.intensity ?? 1, rng);
    }
  }

  activateProfileById(
    profileId: string,
    origin: Vector3,
    simTimeMs: number,
    intensity: number,
    rng: SeededRng
  ): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) return false;
    this.activateProfile(profile, origin, simTimeMs, intensity, rng);
    return true;
  }

  private activateProfile(
    profile: DisturbanceProfile,
    origin: Vector3,
    simTimeMs: number,
    intensity: number,
    rng: SeededRng
  ): void {
    const radiusM = parseDistanceM(profile.spatial.radiusM, 300);
    const actDelayMs = parseDurationMs(profile.activationDelayMs, 0);

    const buildTargets = (): ActiveTargetRecovery[] =>
      profile.effects.map((eff) => {
        const fadeOutMs = parseDurationMs(eff.fadeOutMs, 300);
        const recDelayMin = parseDurationMs(eff.recoveryDelayMs[0], 10000);
        const recDelayMax = parseDurationMs(eff.recoveryDelayMs[1], recDelayMin);
        const recDelayMs = rng.range(recDelayMin, recDelayMax);
        const recFadeMs = parseDurationMs(eff.recoveryFadeMs, 5000);
        const activeStart = simTimeMs + actDelayMs;
        return {
          effect: eff,
          fadeOutEndSimMs: activeStart + fadeOutMs,
          recoveryDelayEndSimMs: activeStart + recDelayMs,
          recoveryFadeEndSimMs: activeStart + recDelayMs + recFadeMs,
        };
      });

    if (profile.overlapPolicy === 'independent') {
      this.instances.push({
        instanceId: `dist_${this.seq++}`,
        profile,
        origin,
        createdAtSimMs: simTimeMs,
        activateAtSimMs: simTimeMs + actDelayMs,
        radiusM,
        intensity,
        targets: buildTargets(),
      });
      return;
    }

    // Look for an overlapping existing instance of same profile covering the new origin
    const existing = this.instances.find(
      (inst) =>
        inst.profile.id === profile.id &&
        dist3(inst.origin, origin) <= Math.max(inst.radiusM, radiusM)
    );

    if (!existing) {
      this.instances.push({
        instanceId: `dist_${this.seq++}`,
        profile,
        origin,
        createdAtSimMs: simTimeMs,
        activateAtSimMs: simTimeMs + actDelayMs,
        radiusM,
        intensity,
        targets: buildTargets(),
      });
      return;
    }

    const freshTargets = buildTargets();
    if (profile.overlapPolicy === 'reset') {
      existing.origin = origin;
      existing.createdAtSimMs = simTimeMs;
      existing.activateAtSimMs = simTimeMs + actDelayMs;
      existing.radiusM = radiusM;
      existing.intensity = intensity;
      existing.targets = freshTargets;
    } else if (profile.overlapPolicy === 'extend') {
      existing.origin = origin;
      existing.intensity = Math.max(existing.intensity, intensity);
      for (let i = 0; i < existing.targets.length; i++) {
        const cur = existing.targets[i];
        const fresh = freshTargets[i];
        if (!fresh) continue;
        const addedDelay = fresh.recoveryDelayEndSimMs - (simTimeMs + actDelayMs);
        cur.recoveryDelayEndSimMs = Math.max(cur.recoveryDelayEndSimMs, simTimeMs) + addedDelay;
        cur.recoveryFadeEndSimMs =
          cur.recoveryDelayEndSimMs + (fresh.recoveryFadeEndSimMs - fresh.recoveryDelayEndSimMs);
      }
    } else if (profile.overlapPolicy === 'accumulate') {
      existing.intensity = Math.min(2, existing.intensity + intensity * 0.5);
      existing.radiusM = Math.max(existing.radiusM, radiusM);
      for (let i = 0; i < existing.targets.length; i++) {
        const cur = existing.targets[i];
        const fresh = freshTargets[i];
        if (!fresh) continue;
        cur.recoveryDelayEndSimMs = Math.max(cur.recoveryDelayEndSimMs, fresh.recoveryDelayEndSimMs);
        cur.recoveryFadeEndSimMs = Math.max(cur.recoveryFadeEndSimMs, fresh.recoveryFadeEndSimMs);
      }
    } else {
      // strongest_and_longest (default)
      existing.intensity = Math.max(existing.intensity, intensity);
      existing.radiusM = Math.max(existing.radiusM, radiusM);
      for (let i = 0; i < existing.targets.length; i++) {
        const cur = existing.targets[i];
        const fresh = freshTargets[i];
        if (!fresh) continue;
        if (fresh.recoveryDelayEndSimMs > cur.recoveryDelayEndSimMs) {
          cur.recoveryDelayEndSimMs = fresh.recoveryDelayEndSimMs;
        }
        if (fresh.recoveryFadeEndSimMs > cur.recoveryFadeEndSimMs) {
          cur.recoveryFadeEndSimMs = fresh.recoveryFadeEndSimMs;
        }
      }
    }
  }

  step(simTimeMs: number): void {
    // Reconcile backward simulation clock jumps safely and expire completed disturbances
    this.instances = this.instances.filter((inst) => {
      if (simTimeMs < inst.createdAtSimMs) {
        const shift = inst.createdAtSimMs - simTimeMs;
        inst.createdAtSimMs = simTimeMs;
        inst.activateAtSimMs = Math.max(simTimeMs, inst.activateAtSimMs - shift);
        for (const t of inst.targets) {
          t.fadeOutEndSimMs = Math.max(simTimeMs, t.fadeOutEndSimMs - shift);
          t.recoveryDelayEndSimMs = Math.max(simTimeMs, t.recoveryDelayEndSimMs - shift);
          t.recoveryFadeEndSimMs = Math.max(t.recoveryDelayEndSimMs, t.recoveryFadeEndSimMs - shift);
        }
      }
      return inst.targets.some((t) => simTimeMs < t.recoveryFadeEndSimMs);
    });
  }

  private matchesExceptions(
    profile: DisturbanceProfile,
    soundId: string,
    busId: BusId,
    tags: readonly string[] | undefined,
    mixer: AudioMixer
  ): boolean {
    const ex = profile.exceptions;
    if (!ex) return false;
    if (ex.sounds?.includes(soundId)) return true;
    if (ex.buses?.some((b) => mixer.isBusOrAncestor(busId, b))) return true;
    if (ex.tags && tags && ex.tags.some((t) => tags.includes(t))) return true;
    return false;
  }

  private matchesTarget(
    target: string,
    soundId: string,
    busId: BusId,
    tags: readonly string[] | undefined,
    mixer: AudioMixer
  ): boolean {
    if (target.startsWith('tag:')) {
      const tagName = target.slice(4);
      return Boolean(tags?.includes(tagName));
    }
    if (target === soundId) return true;
    return mixer.isBusOrAncestor(busId, target);
  }

  private computeTargetGainAndBlock(
    inst: ActiveDisturbanceInstance,
    t: ActiveTargetRecovery,
    simTimeMs: number,
    evalPos: Vector3
  ): { gainMult: number; blocking: boolean } {
    if (simTimeMs < inst.activateAtSimMs || simTimeMs >= t.recoveryFadeEndSimMs) {
      return { gainMult: 1, blocking: false };
    }

    const d = dist3(inst.origin, evalPos);
    if (d >= inst.radiusM) {
      return { gainMult: 1, blocking: false };
    }

    const spatialWeight =
      inst.profile.spatial.attenuation === 'linear'
        ? Math.max(0, Math.min(1, 1 - d / Math.max(0.001, inst.radiusM)))
        : 1;

    let timeEnvelope = 1;
    if (simTimeMs < t.fadeOutEndSimMs) {
      const denom = Math.max(1, t.fadeOutEndSimMs - inst.activateAtSimMs);
      timeEnvelope = Math.max(0, Math.min(1, (simTimeMs - inst.activateAtSimMs) / denom));
    } else if (simTimeMs >= t.recoveryDelayEndSimMs) {
      const denom = Math.max(1, t.recoveryFadeEndSimMs - t.recoveryDelayEndSimMs);
      timeEnvelope = 1 - Math.max(0, Math.min(1, (simTimeMs - t.recoveryDelayEndSimMs) / denom));
    }

    const strength = spatialWeight * timeEnvelope * Math.min(1, inst.intensity);
    const targetGain = t.effect.gain;
    const gainMult = 1 - strength * (1 - targetGain);
    const blocking =
      t.effect.blockNewEvents &&
      spatialWeight > 0.15 &&
      simTimeMs < t.recoveryDelayEndSimMs;

    return { gainMult, blocking };
  }

  evaluateSuppression(params: {
    soundId: string;
    busId: BusId;
    tags?: readonly string[];
    position: Vector3;
    simTimeMs: number;
    mixer: AudioMixer;
    exemptFromDisturbance?: boolean;
  }): TargetSuppressionResult {
    if (params.exemptFromDisturbance) {
      return { gainMultiplier: 1, blockNewEvents: false };
    }

    let minGain = 1;
    let blocked = false;

    for (const inst of this.instances) {
      if (this.matchesExceptions(inst.profile, params.soundId, params.busId, params.tags, params.mixer)) {
        continue;
      }
      for (const t of inst.targets) {
        if (!this.matchesTarget(t.effect.target, params.soundId, params.busId, params.tags, params.mixer)) {
          continue;
        }
        const res = this.computeTargetGainAndBlock(inst, t, params.simTimeMs, params.position);
        if (res.gainMult < minGain) minGain = res.gainMult;
        if (res.blocking) blocked = true;
      }
    }

    return {
      gainMultiplier: Math.max(0, Math.min(1, minGain)),
      blockNewEvents: blocked,
    };
  }

  isListenerInDisturbance(listenerPos: Vector3, simTimeMs: number): boolean {
    for (const inst of this.instances) {
      if (simTimeMs < inst.activateAtSimMs) continue;
      if (dist3(inst.origin, listenerPos) >= inst.radiusM) continue;
      if (inst.targets.some((t) => simTimeMs < t.recoveryFadeEndSimMs)) {
        return true;
      }
    }
    return false;
  }

  getDiagnostics(listenerPos: Vector3, simTimeMs: number): ActiveDisturbanceSnapshot[] {
    return this.instances.map((inst) => {
      const d = dist3(inst.origin, listenerPos);
      const att =
        d >= inst.radiusM
          ? 0
          : inst.profile.spatial.attenuation === 'linear'
            ? Math.max(0, 1 - d / Math.max(0.001, inst.radiusM))
            : 1;
      return {
        instanceId: inst.instanceId,
        profileId: inst.profile.id,
        origin: { ...inst.origin },
        radiusM: inst.radiusM,
        distanceFromListenerM: Math.round(d * 10) / 10,
        attenuationAtListener: Math.round(att * 1000) / 1000,
        effects: inst.targets.map((t) => {
          const res = this.computeTargetGainAndBlock(inst, t, simTimeMs, listenerPos);
          return {
            target: t.effect.target,
            currentGainMult: Math.round(res.gainMult * 1000) / 1000,
            blockingNewEvents: res.blocking,
            remainingRecoveryDelaySimSec: Math.max(
              0,
              Math.round(((t.recoveryDelayEndSimMs - simTimeMs) / 1000) * 10) / 10
            ),
            remainingRecoveryFadeSimSec: Math.max(
              0,
              Math.round(((t.recoveryFadeEndSimMs - simTimeMs) / 1000) * 10) / 10
            ),
          };
        }),
      };
    });
  }

  exportState(): PersistedSoundscapeState['disturbances'] {
    return this.instances.map((inst) => ({
      instanceId: inst.instanceId,
      profileId: inst.profile.id,
      origin: { ...inst.origin },
      createdAtSimMs: inst.createdAtSimMs,
      radiusM: inst.radiusM,
      intensity: inst.intensity,
      targets: inst.targets.map((t) => ({
        target: t.effect.target,
        recoveryDelayEndSimMs: t.recoveryDelayEndSimMs,
        recoveryFadeEndSimMs: t.recoveryFadeEndSimMs,
      })),
    }));
  }

  importState(saved: PersistedSoundscapeState['disturbances']): void {
    this.instances = [];
    for (const item of saved) {
      const profile = this.profiles.get(item.profileId);
      if (!profile) continue;
      const targets: ActiveTargetRecovery[] = [];
      for (const eff of profile.effects) {
        const savedT = item.targets.find((st) => st.target === eff.target);
        if (!savedT) continue;
        const actDelayMs = parseDurationMs(profile.activationDelayMs, 0);
        const fadeOutMs = parseDurationMs(eff.fadeOutMs, 300);
        targets.push({
          effect: eff,
          fadeOutEndSimMs: item.createdAtSimMs + actDelayMs + fadeOutMs,
          recoveryDelayEndSimMs: savedT.recoveryDelayEndSimMs,
          recoveryFadeEndSimMs: savedT.recoveryFadeEndSimMs,
        });
      }
      this.instances.push({
        instanceId: item.instanceId,
        profile,
        origin: { ...item.origin },
        createdAtSimMs: item.createdAtSimMs,
        activateAtSimMs: item.createdAtSimMs + parseDurationMs(profile.activationDelayMs, 0),
        radiusM: item.radiusM,
        intensity: item.intensity,
        targets,
      });
    }
  }
}
