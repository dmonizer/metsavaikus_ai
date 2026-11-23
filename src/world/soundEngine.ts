export type FootstepSurface = 'grass' | 'road' | 'wood' | 'water';

export interface SchedulableAudioParam {
  value: number;
  cancelScheduledValues(cancelTime: number): unknown;
  cancelAndHoldAtTime?(cancelTime: number): unknown;
  setValueAtTime(value: number, startTime: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
}

/**
 * Safely schedules an exponential approach on an AudioParam without letting
 * past setTargetAtTime entries accumulate unboundedly in the browser's
 * AudioParamTimeline (which otherwise stalls the real-time audio thread after
 * a few minutes of per-frame updates).
 */
export function scheduleGainTarget(
  param: SchedulableAudioParam,
  target: number,
  now: number,
  timeConstant: number
): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now);
  } else {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
  }
  param.setTargetAtTime(target, now, timeConstant);
}

const AMBIENCE_MIN_INTERVAL_SEC = 0.25;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private stepNoiseBuffer: AudioBuffer | null = null;
  private waterNoiseBuffer: AudioBuffer | null = null;
  private thunderNoiseBuffer: AudioBuffer | null = null;
  private initialized = false;
  private muted = false;

  private lastAmbienceTime = -Infinity;
  private lastTargetWind = -1;
  private lastTargetRain = -1;
  private ambienceUpdateCount = 0;

  private createDecayingNoiseBuffer(
    ctx: AudioContext,
    durSec: number,
    exponent: number
  ): AudioBuffer {
    const len = Math.max(1, Math.floor(ctx.sampleRate * durSec));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, exponent);
    }
    return buf;
  }

  init(customCtx?: AudioContext): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    let ctx = customCtx ?? null;
    if (!ctx && typeof window !== 'undefined') {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (!ctx) return;

    this.ctx = ctx;
    this.initialized = true;

    const bufSize = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Pre-allocate decaying noise buffers once so footsteps & thunder never allocate in-game
    this.stepNoiseBuffer = this.createDecayingNoiseBuffer(ctx, 0.08, 1.0);
    this.waterNoiseBuffer = this.createDecayingNoiseBuffer(ctx, 0.16, 1.0);
    this.thunderNoiseBuffer = this.createDecayingNoiseBuffer(ctx, 2.5, 1.45);

    // Wind loop
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 320;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.03;
    windSrc.connect(windFilter).connect(this.windGain).connect(ctx.destination);
    windSrc.start();

    // Rain loop
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noiseBuffer;
    rainSrc.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1850;
    rainFilter.Q.value = 0.55;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rainFilter).connect(this.rainGain).connect(ctx.destination);
    rainSrc.start();
  }

  getAmbienceUpdateCount(): number {
    return this.ambienceUpdateCount;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.initialized || !this.ctx || !this.windGain || !this.rainGain) return;
    const now = this.ctx.currentTime;
    if (muted) {
      scheduleGainTarget(this.windGain.gain, 0, now, 0.08);
      scheduleGainTarget(this.rainGain.gain, 0, now, 0.08);
      this.lastTargetWind = 0;
      this.lastTargetRain = 0;
      this.lastAmbienceTime = now;
      this.ambienceUpdateCount++;
    } else {
      // Force next updateAmbience call to restore levels smoothly
      this.lastTargetWind = -1;
      this.lastTargetRain = -1;
      this.lastAmbienceTime = -Infinity;
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend();
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  updateAmbience(weather: string, windStrength: number): void {
    if (!this.initialized || !this.ctx || !this.windGain || !this.rainGain) return;
    const now = this.ctx.currentTime;
    const targetWind = this.muted ? 0 : 0.025 + windStrength * 0.085;
    const targetRain = this.muted
      ? 0
      : weather === 'rain'
        ? 0.13
        : weather === 'storm'
          ? 0.22
          : 0;

    const windDelta = Math.abs(targetWind - this.lastTargetWind);
    const rainDelta = Math.abs(targetRain - this.lastTargetRain);
    const urgentRainSwitch = rainDelta > 0.05;

    if (!urgentRainSwitch) {
      if (now - this.lastAmbienceTime < AMBIENCE_MIN_INTERVAL_SEC) return;
      if (windDelta < 0.012 && rainDelta < 0.008) return;
    }

    const tau = this.muted ? 0.15 : 0.45;
    if (windDelta >= 0.004 || this.lastTargetWind < 0) {
      scheduleGainTarget(this.windGain.gain, targetWind, now, tau);
      this.lastTargetWind = targetWind;
    }
    if (rainDelta >= 0.004 || this.lastTargetRain < 0) {
      scheduleGainTarget(this.rainGain.gain, targetRain, now, tau);
      this.lastTargetRain = targetRain;
    }
    this.lastAmbienceTime = now;
    this.ambienceUpdateCount++;
  }

  playFootstep(surface: FootstepSurface): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    if (surface === 'wood') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(135 + Math.random() * 28, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.085);
      gain.gain.setValueAtTime(0.13, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
      osc.connect(gain).connect(this.ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now);
      osc.stop(now + 0.1);
      return;
    }

    const buf = surface === 'water' ? this.waterNoiseBuffer : this.stepNoiseBuffer;
    if (!buf) return;
    const dur = surface === 'water' ? 0.16 : 0.08;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    if (surface === 'water') {
      filter.type = 'bandpass';
      filter.frequency.value = 920 + Math.random() * 340;
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.008, now + dur);
    } else {
      filter.type = 'lowpass';
      filter.frequency.value = surface === 'road' ? 1650 : 640;
      gain.gain.setValueAtTime(surface === 'road' ? 0.1 : 0.065, now);
      gain.gain.exponentialRampToValueAtTime(0.005, now + dur);
    }

    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(now);
  }

  playImpact(strength = 1): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110 + Math.random() * 16, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.14);
    gain.gain.setValueAtTime(Math.min(0.26, 0.11 * strength), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(this.ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.16);
  }

  playGatherMushroom(): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    // Soft mossy pluck + warm wooden chime
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(360 + Math.random() * 45, now);
    osc1.frequency.exponentialRampToValueAtTime(590, now + 0.11);
    gain1.gain.setValueAtTime(0.14, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(gain1).connect(this.ctx.destination);
    osc1.onended = () => {
      osc1.disconnect();
      gain1.disconnect();
    };
    osc1.start(now);
    osc1.stop(now + 0.2);

    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(720, now + 0.04);
    osc2.frequency.exponentialRampToValueAtTime(880, now + 0.16);
    gain2.gain.setValueAtTime(0.07, now + 0.04);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc2.connect(gain2).connect(this.ctx.destination);
    osc2.onended = () => {
      osc2.disconnect();
      gain2.disconnect();
    };
    osc2.start(now + 0.04);
    osc2.stop(now + 0.23);
  }

  playThunder(): void {
    if (!this.initialized || !this.ctx || this.muted || !this.thunderNoiseBuffer) return;
    const now = this.ctx.currentTime;
    const dur = 2.5;
    const src = this.ctx.createBufferSource();
    src.buffer = this.thunderNoiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(190, now);
    filter.frequency.linearRampToValueAtTime(55, now + dur - 0.1);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.42, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(now);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.windGain = null;
    this.rainGain = null;
    this.noiseBuffer = null;
    this.stepNoiseBuffer = null;
    this.waterNoiseBuffer = null;
    this.thunderNoiseBuffer = null;
    this.lastAmbienceTime = -Infinity;
    this.lastTargetWind = -1;
    this.lastTargetRain = -1;
    this.initialized = false;
  }
}
