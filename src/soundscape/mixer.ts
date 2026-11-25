import { parseDurationMs } from './clocks';
import type { BusDefinition, BusId } from './types';

interface BusRuntime {
  def: BusDefinition;
  volume: number;
  muted: boolean;
  duckMultiplier: number;
  duckTarget: number;
  duckRatePerSec: number;
  activeVoices: number;
}

export class AudioMixer {
  private buses = new Map<BusId, BusRuntime>();
  private masterVolume = 1;
  private masterMuted = false;

  constructor(definitions: readonly BusDefinition[]) {
    this.loadDefinitions(definitions, true);
  }

  loadDefinitions(definitions: readonly BusDefinition[], resetState = false): void {
    const prevVolumes = new Map<string, { volume: number; muted: boolean }>();
    if (!resetState) {
      for (const [id, rt] of this.buses) {
        prevVolumes.set(id, { volume: rt.volume, muted: rt.muted });
      }
    }
    this.buses.clear();
    for (const def of definitions) {
      const prev = prevVolumes.get(def.id);
      this.buses.set(def.id, {
        def,
        volume: prev ? prev.volume : (def.volume ?? 1),
        muted: prev ? prev.muted : Boolean(def.muted),
        duckMultiplier: 1,
        duckTarget: 1,
        duckRatePerSec: 6,
        activeVoices: 0,
      });
    }
  }

  setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(2, vol));
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setMasterMuted(muted: boolean): void {
    this.masterMuted = muted;
  }

  isMasterMuted(): boolean {
    return this.masterMuted;
  }

  setBusVolume(busId: BusId, vol: number): void {
    const b = this.buses.get(busId);
    if (!b) return;
    b.volume = Math.max(0, Math.min(2, vol));
  }

  getBusVolume(busId: BusId): number {
    return this.buses.get(busId)?.volume ?? 1;
  }

  setBusMuted(busId: BusId, muted: boolean): void {
    const b = this.buses.get(busId);
    if (!b) return;
    b.muted = muted;
  }

  isBusMuted(busId: BusId): boolean {
    return this.buses.get(busId)?.muted ?? false;
  }

  isBusOrAncestor(busId: BusId, candidateAncestor: BusId): boolean {
    let cur: BusId | null | undefined = busId;
    const guard = new Set<string>();
    while (cur) {
      if (cur === candidateAncestor) return true;
      if (guard.has(cur)) break;
      guard.add(cur);
      cur = this.buses.get(cur)?.def.parent;
    }
    return false;
  }

  bypassesEnvironmentalAttenuation(busId: BusId): boolean {
    let cur: BusId | null | undefined = busId;
    const guard = new Set<string>();
    while (cur) {
      const b = this.buses.get(cur);
      if (b?.def.bypassEnvironmentalAttenuation) return true;
      if (guard.has(cur)) break;
      guard.add(cur);
      cur = b?.def.parent;
    }
    return false;
  }

  getEffectiveGain(busId: BusId): number {
    if (this.masterMuted) return 0;
    let gain = this.masterVolume;
    let cur: BusId | null | undefined = busId;
    const guard = new Set<string>();
    while (cur) {
      const b = this.buses.get(cur);
      if (!b) break;
      if (b.muted) return 0;
      gain *= b.volume * b.duckMultiplier;
      if (guard.has(cur)) break;
      guard.add(cur);
      cur = b.def.parent;
    }
    return Math.max(0, Math.min(2, gain));
  }

  getMaxConcurrency(busId: BusId): number | undefined {
    return this.buses.get(busId)?.def.maxConcurrency;
  }

  updateCountsAndDucking(activeVoicesByBus: ReadonlyMap<BusId, number>, dtRealSec: number): void {
    // Reset duck targets to 1 before applying active bus duckers
    for (const rt of this.buses.values()) {
      rt.activeVoices = activeVoicesByBus.get(rt.def.id) ?? 0;
      rt.duckTarget = 1;
      rt.duckRatePerSec = 4;
    }

    for (const rt of this.buses.values()) {
      if (rt.activeVoices > 0 && rt.def.ducking) {
        for (const d of rt.def.ducking) {
          const targetRt = this.buses.get(d.targetBus);
          if (!targetRt) continue;
          if (d.gain < targetRt.duckTarget) {
            targetRt.duckTarget = d.gain;
            const attackSec = Math.max(0.02, parseDurationMs(d.attackMs, 150) / 1000);
            targetRt.duckRatePerSec = 1 / attackSec;
          }
        }
      }
    }

    for (const rt of this.buses.values()) {
      const step = Math.min(1, dtRealSec * rt.duckRatePerSec);
      rt.duckMultiplier += (rt.duckTarget - rt.duckMultiplier) * step;
    }
  }

  getDiagnostics(): Array<{
    id: BusId;
    parent: BusId | null;
    volume: number;
    muted: boolean;
    effectiveGain: number;
    activeVoices: number;
  }> {
    const out: Array<{
      id: BusId;
      parent: BusId | null;
      volume: number;
      muted: boolean;
      effectiveGain: number;
      activeVoices: number;
    }> = [];
    for (const rt of this.buses.values()) {
      out.push({
        id: rt.def.id,
        parent: rt.def.parent ?? null,
        volume: rt.volume,
        muted: rt.muted,
        effectiveGain: Math.round(this.getEffectiveGain(rt.def.id) * 1000) / 1000,
        activeVoices: rt.activeVoices,
      });
    }
    return out;
  }

  exportPreferences(): {
    muted: boolean;
    masterVolume: number;
    busVolumes: Record<string, number>;
    busMuted: Record<string, boolean>;
  } {
    const busVolumes: Record<string, number> = {};
    const busMuted: Record<string, boolean> = {};
    for (const [id, rt] of this.buses) {
      busVolumes[id] = rt.volume;
      busMuted[id] = rt.muted;
    }
    return {
      muted: this.masterMuted,
      masterVolume: this.masterVolume,
      busVolumes,
      busMuted,
    };
  }

  importPreferences(prefs: {
    muted?: boolean;
    masterVolume?: number;
    busVolumes?: Record<string, number>;
    busMuted?: Record<string, boolean>;
  }): void {
    if (prefs.muted !== undefined) this.masterMuted = prefs.muted;
    if (prefs.masterVolume !== undefined) this.masterVolume = prefs.masterVolume;
    if (prefs.busVolumes) {
      for (const [id, v] of Object.entries(prefs.busVolumes)) {
        this.setBusVolume(id, v);
      }
    }
    if (prefs.busMuted) {
      for (const [id, m] of Object.entries(prefs.busMuted)) {
        this.setBusMuted(id, m);
      }
    }
  }
}
