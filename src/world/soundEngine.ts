import type { SoundscapeEngine } from '../soundscape/soundscapeEngine';
import type { WebAudioHybridBackend } from '../soundscape/audioBackend';

export type FootstepSurface = 'grass' | 'road' | 'wood' | 'water' | 'swamp' | 'swim';

export type AmbientBiomeId =
  | 'village'
  | 'abandoned'
  | 'island'
  | 'swamp'
  | 'road'
  | 'thicket'
  | 'forest';

export type AmbientWeather = 'clear' | 'mist' | 'rain' | 'storm';
export type AmbientShelter = 'outdoor' | 'tent' | 'drafty_hut' | 'warm_house';
export type SpatialClipKind = 'bird' | 'cricket' | 'insect';

export interface AmbientSoundscapeProfile {
  /** Expected localized 3D clips per minute for each fauna guild */
  birdRatePerMin: number;
  cricketRatePerMin: number;
  insectRatePerMin: number;
  /** Relative gain scale (0..1) factoring shelter muffling and weather */
  birdGain: number;
  cricketGain: number;
  insectGain: number;
}

export interface SpatialAudioEvent {
  kind: SpatialClipKind;
  variant: string;
  x: number;
  y: number;
  z: number;
  distance: number;
  biome: AmbientBiomeId;
  weather: AmbientWeather;
  hourOfDay: number;
  timestampMs: number;
}

export interface SpatialAmbienceInput {
  listenerX: number;
  listenerY: number;
  listenerZ: number;
  forwardX: number;
  forwardY: number;
  forwardZ: number;
  biome: AmbientBiomeId;
  weather: AmbientWeather;
  hourOfDay: number;
  shelter: AmbientShelter;
}

export interface SpatialAmbienceStats {
  totalTriggered: number;
  byKind: Record<SpatialClipKind, number>;
  lastEvent: SpatialAudioEvent | null;
  lastProfile: AmbientSoundscapeProfile;
  activeVoices: number;
}

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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothWindow(x: number, edge0: number, edge1: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Pure acoustic ecology curve computing localized 3D ambient trigger rates
 * (clips per minute) and relative gains for Baltic forest birds, crickets,
 * and buzzing insects based on biome, weather, time of day, and shelter.
 */
export function computeAmbientSoundscapeProfile(
  biome: AmbientBiomeId,
  weather: AmbientWeather,
  hourOfDay: number,
  shelter: AmbientShelter = 'outdoor'
): AmbientSoundscapeProfile {
  const h = ((hourOfDay % 24) + 24) % 24;

  // 1. Time-of-day activity curves (0..1)
  // Birds: strong dawn chorus (04:30-09:00), steady day, gentle dusk fade, silent at night
  const birdRise = smoothWindow(h, 4.0, 5.8);
  const birdFall = 1 - smoothWindow(h, 19.2, 21.4);
  const dawnChorusBoost = Math.exp(-Math.pow((h - 6.8) / 2.2, 2)) * 0.55;
  const birdTime = clamp01(birdRise * birdFall * (0.72 + dawnChorusBoost));

  // Crickets: light in warm afternoon meadows, strong dusk through night (19:00-04:30)
  const cricketNight =
    h >= 18.0
      ? smoothWindow(h, 18.0, 20.6)
      : h <= 6.2
        ? 1 - smoothWindow(h, 4.0, 6.2)
        : 0;
  const cricketWarmAfternoon = Math.exp(-Math.pow((h - 15.5) / 2.6, 2)) * 0.28;
  const cricketTime = clamp01(Math.max(cricketNight, cricketWarmAfternoon));

  // Buzzing insects (mosquitoes/bog gnats/horseflies): late morning through twilight, peak humid evening
  const insectDayRise = smoothWindow(h, 7.5, 10.5);
  const insectNightFall = 1 - smoothWindow(h, 21.5, 23.5);
  const eveningSwarmBoost = Math.exp(-Math.pow((h - 19.2) / 2.5, 2)) * 0.45;
  const insectTime = clamp01(insectDayRise * insectNightFall * (0.68 + eveningSwarmBoost));

  // 2. Biome habitat density multipliers
  let birdBiome = 1.0;
  let cricketBiome = 1.0;
  let insectBiome = 1.0;
  switch (biome) {
    case 'forest':
      birdBiome = 1.35;
      cricketBiome = 0.85;
      insectBiome = 0.85;
      break;
    case 'thicket':
      birdBiome = 1.45;
      cricketBiome = 0.65;
      insectBiome = 1.15;
      break;
    case 'swamp':
      birdBiome = 0.48;
      cricketBiome = 0.35;
      insectBiome = 1.65; // Peat bog mosquitoes & gnats thrive here
      break;
    case 'island':
      birdBiome = 0.95;
      cricketBiome = 0.95;
      insectBiome = 1.45;
      break;
    case 'village':
      birdBiome = 1.05;
      cricketBiome = 1.35;
      insectBiome = 0.55;
      break;
    case 'abandoned':
      birdBiome = 0.65;
      cricketBiome = 1.25;
      insectBiome = 0.8;
      break;
    case 'road':
      birdBiome = 1.0;
      cricketBiome = 1.2;
      insectBiome = 0.65;
      break;
  }

  // 3. Weather modulation
  let birdWeather = 1.0;
  let cricketWeather = 1.0;
  let insectWeather = 1.0;
  if (weather === 'mist') {
    birdWeather = 0.72;
    cricketWeather = 0.82;
    insectWeather = 1.25; // Humid still mist brings out buzzing bog insects
  } else if (weather === 'rain') {
    birdWeather = 0.14;
    cricketWeather = 0.1;
    insectWeather = 0.04;
  } else if (weather === 'storm') {
    birdWeather = 0;
    cricketWeather = 0;
    insectWeather = 0;
  }

  // 4. Shelter acoustic attenuation (tent canvas muffles exterior sounds & blocks insects inside!)
  const exteriorMuffle =
    shelter === 'warm_house'
      ? 0.32
      : shelter === 'tent'
        ? 0.62
        : shelter === 'drafty_hut'
          ? 0.72
          : 1.0;
  const insectShelterMult = shelter === 'outdoor' ? 1.0 : shelter === 'drafty_hut' ? 0.35 : 0;

  const birdRatePerMin = Math.round(13.5 * birdTime * birdBiome * birdWeather * 100) / 100;
  const cricketRatePerMin =
    Math.round(16.0 * cricketTime * cricketBiome * cricketWeather * 100) / 100;
  const insectRatePerMin =
    Math.round(9.5 * insectTime * insectBiome * insectWeather * insectShelterMult * 100) / 100;

  return {
    birdRatePerMin,
    cricketRatePerMin,
    insectRatePerMin,
    birdGain: Math.round(clamp01(0.85 * exteriorMuffle) * 100) / 100,
    cricketGain: Math.round(clamp01(0.75 * exteriorMuffle) * 100) / 100,
    insectGain: Math.round(clamp01(0.8 * insectShelterMult) * 100) / 100,
  };
}

const AMBIENCE_MIN_INTERVAL_SEC = 0.25;
const MAX_CONCURRENT_SPATIAL_VOICES = 6;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private stepNoiseBuffer: AudioBuffer | null = null;
  private waterNoiseBuffer: AudioBuffer | null = null;
  private thunderNoiseBuffer: AudioBuffer | null = null;
  private initialized = false;
  private muted = false;

  private lastAmbienceTime = -Infinity;
  private lastTargetWind = -1;
  private lastTargetRain = -1;
  private lastShelterAcoustic: AmbientShelter = 'outdoor';
  private ambienceUpdateCount = 0;

  // Dynamic 3D spatial ambient soundscape state
  private activeSpatialVoices = 0;
  private birdCooldownSec = 2.4;
  private cricketCooldownSec = 3.2;
  private insectCooldownSec = 4.8;
  private spatialCounts: Record<SpatialClipKind, number> = {
    bird: 0,
    cricket: 0,
    insect: 0,
  };
  private lastSpatialEvent: SpatialAudioEvent | null = null;
  private lastProfile: AmbientSoundscapeProfile = computeAmbientSoundscapeProfile(
    'forest',
    'clear',
    10,
    'outdoor'
  );
  private lastListenerX = 0;
  private lastListenerY = 1.65;
  private lastListenerZ = 0;
  private soundscapeEngine: SoundscapeEngine | null = null;
  private soundscapeBackend: WebAudioHybridBackend | null = null;

  attachSoundscapeEngine(engine: SoundscapeEngine, backend: WebAudioHybridBackend): void {
    this.soundscapeEngine = engine;
    this.soundscapeBackend = backend;
    if (this.ctx) {
      backend.attachAudioContext(this.ctx);
    }
    engine.mixer.setMasterMuted(this.muted);
  }

  getSoundscapeEngine(): SoundscapeEngine | null {
    return this.soundscapeEngine;
  }

  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

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
    if (this.soundscapeBackend) {
      this.soundscapeBackend.attachAudioContext(ctx);
    }

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

    // Wind & Rain legacy oscillators only activate when standalone (when SoundscapeEngine is not attached)
    if (!this.soundscapeEngine) {
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = this.noiseBuffer;
      windSrc.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.frequency.value = 320;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0.03;
      windSrc.connect(this.windFilter).connect(this.windGain).connect(ctx.destination);
      windSrc.start();

      const rainSrc = ctx.createBufferSource();
      rainSrc.buffer = this.noiseBuffer;
      rainSrc.loop = true;
      this.rainFilter = ctx.createBiquadFilter();
      this.rainFilter.type = 'bandpass';
      this.rainFilter.frequency.value = 1850;
      this.rainFilter.Q.value = 0.55;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      rainSrc.connect(this.rainFilter).connect(this.rainGain).connect(ctx.destination);
      rainSrc.start();
    }
  }

  getAmbienceUpdateCount(): number {
    return this.ambienceUpdateCount;
  }

  getSpatialAmbienceStats(): SpatialAmbienceStats {
    return {
      totalTriggered:
        this.spatialCounts.bird + this.spatialCounts.cricket + this.spatialCounts.insect,
      byKind: { ...this.spatialCounts },
      lastEvent: this.lastSpatialEvent ? { ...this.lastSpatialEvent } : null,
      lastProfile: { ...this.lastProfile },
      activeVoices: this.activeSpatialVoices,
    };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.soundscapeEngine?.mixer.setMasterMuted(muted);
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

  /**
   * Syncs the Web Audio 3D AudioListener to the player camera pose.
   */
  updateListener(
    x: number,
    y: number,
    z: number,
    fwdX: number,
    fwdY: number,
    fwdZ: number
  ): void {
    this.lastListenerX = x;
    this.lastListenerY = y;
    this.lastListenerZ = z;
    if (!this.initialized || !this.ctx || !this.ctx.listener) return;

    const listener = this.ctx.listener;
    const now = this.ctx.currentTime;
    if (listener.positionX && typeof listener.positionX.setValueAtTime === 'function') {
      listener.positionX.setValueAtTime(x, now);
      listener.positionY.setValueAtTime(y, now);
      listener.positionZ.setValueAtTime(z, now);
      listener.forwardX?.setValueAtTime(fwdX, now);
      listener.forwardY?.setValueAtTime(fwdY, now);
      listener.forwardZ?.setValueAtTime(fwdZ, now);
      listener.upX?.setValueAtTime(0, now);
      listener.upY?.setValueAtTime(1, now);
      listener.upZ?.setValueAtTime(0, now);
    } else if (typeof listener.setPosition === 'function') {
      listener.setPosition(x, y, z);
      listener.setOrientation?.(fwdX, fwdY, fwdZ, 0, 1, 0);
    }
  }

  updateAmbience(
    weather: string,
    windStrength: number,
    shelter: AmbientShelter = 'outdoor'
  ): void {
    if (this.soundscapeEngine) {
      this.ambienceUpdateCount++;
      return;
    }
    if (!this.initialized || !this.ctx || !this.windGain || !this.rainGain) return;
    const now = this.ctx.currentTime;

    const shelterWindMult =
      shelter === 'warm_house'
        ? 0.42
        : shelter === 'tent'
          ? 0.62
          : shelter === 'drafty_hut'
            ? 0.72
            : 1.0;
    // Rain inside a tent sounds slightly richer & lower-pitched (raindrops drumming on canvas!)
    const shelterRainMult =
      shelter === 'warm_house'
        ? 0.52
        : shelter === 'tent'
          ? 1.08
          : shelter === 'drafty_hut'
            ? 0.78
            : 1.0;

    const targetWind = this.muted ? 0 : (0.025 + windStrength * 0.085) * shelterWindMult;
    const targetRain = this.muted
      ? 0
      : (weather === 'rain' ? 0.13 : weather === 'storm' ? 0.22 : 0) * shelterRainMult;

    const windDelta = Math.abs(targetWind - this.lastTargetWind);
    const rainDelta = Math.abs(targetRain - this.lastTargetRain);
    const shelterChanged = shelter !== this.lastShelterAcoustic;
    const urgentRainSwitch = rainDelta > 0.05 || shelterChanged;

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
    if (shelterChanged && this.rainFilter && this.windFilter) {
      const targetRainFreq =
        shelter === 'warm_house'
          ? 580
          : shelter === 'tent'
            ? 940
            : shelter === 'drafty_hut'
              ? 1220
              : 1850;
      const targetRainQ = shelter === 'tent' ? 0.95 : shelter === 'warm_house' ? 0.85 : 0.55;
      const targetWindFreq = shelter === 'warm_house' ? 210 : shelter === 'tent' ? 255 : 320;
      scheduleGainTarget(this.rainFilter.frequency, targetRainFreq, now, 0.35);
      scheduleGainTarget(this.rainFilter.Q, targetRainQ, now, 0.35);
      scheduleGainTarget(this.windFilter.frequency, targetWindFreq, now, 0.35);
      this.lastShelterAcoustic = shelter;
    }

    this.lastAmbienceTime = now;
    this.ambienceUpdateCount++;
  }

  /**
   * Advances the dynamic localized 3D ambient soundscape scheduler.
   * Triggers spatialized forest birds, crickets, and buzzing insects around the player
   * based on biome, weather, time of day, and shelter.
   */
  updateSpatialAmbience(dtSec: number, input: SpatialAmbienceInput): void {
    const clampedDt = Math.max(0, Math.min(0.25, dtSec));
    this.updateListener(
      input.listenerX,
      input.listenerY,
      input.listenerZ,
      input.forwardX,
      input.forwardY,
      input.forwardZ
    );

    const profile = computeAmbientSoundscapeProfile(
      input.biome,
      input.weather,
      input.hourOfDay,
      input.shelter
    );
    this.lastProfile = profile;

    if (this.soundscapeEngine) {
      // SoundscapeEngine schedules all continuous & localized 3D wildlife sounds cleanly
      return;
    }

    if (this.muted || clampedDt <= 0) return;

    this.birdCooldownSec -= clampedDt;
    this.cricketCooldownSec -= clampedDt;
    this.insectCooldownSec -= clampedDt;

    if (profile.birdRatePerMin > 0.1 && this.birdCooldownSec <= 0) {
      const meanInterval = 60 / profile.birdRatePerMin;
      this.birdCooldownSec = Math.max(1.8, meanInterval * (0.55 + Math.random() * 0.9));
      const angle = Math.random() * Math.PI * 2;
      const dist = 7 + Math.random() * 19;
      const x = input.listenerX + Math.cos(angle) * dist;
      const z = input.listenerZ + Math.sin(angle) * dist;
      const y = input.listenerY + 3.5 + Math.random() * 8.5;
      this.triggerSpatialClip('bird', x, y, z, profile.birdGain, input);
    }

    if (profile.cricketRatePerMin > 0.1 && this.cricketCooldownSec <= 0) {
      const meanInterval = 60 / profile.cricketRatePerMin;
      this.cricketCooldownSec = Math.max(1.4, meanInterval * (0.5 + Math.random() * 0.95));
      const angle = Math.random() * Math.PI * 2;
      const dist = 4 + Math.random() * 12;
      const x = input.listenerX + Math.cos(angle) * dist;
      const z = input.listenerZ + Math.sin(angle) * dist;
      const y = input.listenerY - 1.15;
      this.triggerSpatialClip('cricket', x, y, z, profile.cricketGain, input);
    }

    if (profile.insectRatePerMin > 0.1 && this.insectCooldownSec <= 0) {
      const meanInterval = 60 / profile.insectRatePerMin;
      this.insectCooldownSec = Math.max(2.6, meanInterval * (0.6 + Math.random() * 0.95));
      const angle = Math.random() * Math.PI * 2;
      const dist = 1.4 + Math.random() * 3.1;
      const x = input.listenerX + Math.cos(angle) * dist;
      const z = input.listenerZ + Math.sin(angle) * dist;
      const y = input.listenerY + (Math.random() - 0.35) * 0.9;
      this.triggerSpatialClip('insect', x, y, z, profile.insectGain, input);
    }
  }

  /**
   * Triggers a single localized 3D ambient audio clip at world coordinates (x, y, z).
   * Synthesizes real Web Audio HRTF spatial audio when AudioContext is active, and
   * records telemetry stats for deterministic diagnostics/testing.
   */
  triggerSpatialClip(
    kind: SpatialClipKind,
    x: number,
    y: number,
    z: number,
    gainScale = 0.85,
    contextInfo?: Partial<Pick<SpatialAmbienceInput, 'biome' | 'weather' | 'hourOfDay'>>
  ): SpatialAudioEvent | null {
    if (this.muted || gainScale <= 0.01) return null;
    if (this.activeSpatialVoices >= MAX_CONCURRENT_SPATIAL_VOICES) return null;

    const dist = Math.hypot(
      x - this.lastListenerX,
      y - this.lastListenerY,
      z - this.lastListenerZ
    );
    let variant = 'default';

    if (this.initialized && this.ctx && this.ctx.state === 'running') {
      if (kind === 'bird') {
        variant = this.synthesizeSpatialBird(x, y, z, gainScale);
      } else if (kind === 'cricket') {
        variant = this.synthesizeSpatialCricket(x, y, z, gainScale);
      } else {
        variant = this.synthesizeSpatialInsect(x, y, z, gainScale);
      }
    } else {
      variant = kind === 'bird' ? 'willow_warbler' : kind === 'cricket' ? 'field_cricket' : 'bog_mosquito';
    }

    const evt: SpatialAudioEvent = {
      kind,
      variant,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      z: Math.round(z * 10) / 10,
      distance: Math.round(dist * 10) / 10,
      biome: contextInfo?.biome ?? 'forest',
      weather: contextInfo?.weather ?? 'clear',
      hourOfDay: contextInfo?.hourOfDay ?? 12,
      timestampMs: Date.now(),
    };

    this.spatialCounts[kind]++;
    this.lastSpatialEvent = evt;
    return evt;
  }

  private createSpatialPanner(
    ctx: AudioContext,
    x: number,
    y: number,
    z: number,
    refDist: number,
    maxDist: number
  ): PannerNode | null {
    if (typeof ctx.createPanner !== 'function') return null;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDist;
    panner.maxDistance = maxDist;
    panner.rolloffFactor = 1.15;
    const now = ctx.currentTime;
    if (panner.positionX && typeof panner.positionX.setValueAtTime === 'function') {
      panner.positionX.setValueAtTime(x, now);
      panner.positionY.setValueAtTime(y, now);
      panner.positionZ.setValueAtTime(z, now);
    } else if (typeof panner.setPosition === 'function') {
      panner.setPosition(x, y, z);
    }
    return panner;
  }

  private synthesizeSpatialBird(x: number, y: number, z: number, gainScale: number): string {
    const ctx = this.ctx;
    if (!ctx) return 'willow_warbler';
    const now = ctx.currentTime;
    const panner = this.createSpatialPanner(ctx, x, y, z, 5.5, 42);
    const out: AudioNode = panner ? panner : ctx.destination;
    if (panner) panner.connect(ctx.destination);

    const roll = Math.random();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    let endTime = now + 0.7;
    let variant = 'willow_warbler';

    this.activeSpatialVoices++;

    if (roll < 0.34) {
      // Great Tit (Rasvatihane): crisp two-note "ti-ta, ti-ta"
      variant = 'great_tit';
      osc.type = 'sine';
      const hi = 3450 + Math.random() * 450;
      const lo = hi * 0.78;
      gain.gain.setValueAtTime(0.0001, now);
      for (let i = 0; i < 2; i++) {
        const t0 = now + i * 0.34;
        osc.frequency.setValueAtTime(hi, t0);
        gain.gain.linearRampToValueAtTime(0.07 * gainScale, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
        osc.frequency.setValueAtTime(lo, t0 + 0.15);
        gain.gain.linearRampToValueAtTime(0.062 * gainScale, t0 + 0.17);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.29);
      }
      endTime = now + 0.72;
    } else if (roll < 0.66) {
      // Willow Warbler (Salu-lehelind): sweet descending Nordic woodland cascade
      variant = 'willow_warbler';
      osc.type = 'sine';
      const notes = 5;
      let baseF = 4150 + Math.random() * 480;
      gain.gain.setValueAtTime(0.0001, now);
      for (let i = 0; i < notes; i++) {
        const t0 = now + i * 0.135;
        osc.frequency.setValueAtTime(baseF, t0);
        osc.frequency.exponentialRampToValueAtTime(baseF * 0.89, t0 + 0.11);
        gain.gain.linearRampToValueAtTime(0.06 * gainScale * (1 - i * 0.08), t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.125);
        baseF *= 0.91;
      }
      endTime = now + notes * 0.14 + 0.08;
    } else if (roll < 0.84) {
      // Distant Cuckoo (Kägu): hollow minor-third forest call
      variant = 'cuckoo';
      osc.type = 'triangle';
      const f1 = 700 + Math.random() * 40;
      const f2 = f1 * 0.83;
      gain.gain.setValueAtTime(0.0001, now);
      osc.frequency.setValueAtTime(f1, now);
      gain.gain.linearRampToValueAtTime(0.075 * gainScale, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.frequency.setValueAtTime(f2, now + 0.28);
      gain.gain.linearRampToValueAtTime(0.068 * gainScale, now + 0.31);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.56);
      endTime = now + 0.62;
    } else {
      // Song Thrush (Laulurästas): clear melodic upward-flicked flute motif
      variant = 'song_thrush';
      osc.type = 'sine';
      const f0 = 2350 + Math.random() * 420;
      gain.gain.setValueAtTime(0.0001, now);
      for (let i = 0; i < 3; i++) {
        const t0 = now + i * 0.21;
        osc.frequency.setValueAtTime(f0 * (1 + i * 0.05), t0);
        osc.frequency.exponentialRampToValueAtTime(f0 * (1.28 + i * 0.04), t0 + 0.12);
        gain.gain.linearRampToValueAtTime(0.065 * gainScale, t0 + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
      }
      endTime = now + 0.72;
    }

    osc.connect(gain).connect(out);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      panner?.disconnect();
      this.activeSpatialVoices = Math.max(0, this.activeSpatialVoices - 1);
    };
    osc.start(now);
    osc.stop(endTime);
    return variant;
  }

  private synthesizeSpatialCricket(x: number, y: number, z: number, gainScale: number): string {
    const ctx = this.ctx;
    if (!ctx) return 'field_cricket';
    const now = ctx.currentTime;
    const panner = this.createSpatialPanner(ctx, x, y, z, 3.2, 26);
    const out: AudioNode = panner ? panner : ctx.destination;
    if (panner) panner.connect(ctx.destination);

    this.activeSpatialVoices++;

    // Carrier + rapid stridulation pulse envelope at 4.3-4.9 kHz
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    const baseFreq = 4250 + Math.random() * 620;
    carrier.frequency.setValueAtTime(baseFreq, now);

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(34 + Math.random() * 10, now);
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(140, now);
    mod.connect(modGain).connect(carrier.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = baseFreq;
    filter.Q.value = 4.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);

    const chirps = 3 + Math.floor(Math.random() * 3);
    const chirpGap = 0.24 + Math.random() * 0.07;
    const peak = 0.045 * gainScale;
    for (let i = 0; i < chirps; i++) {
      const t0 = now + i * chirpGap;
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.018);
      gain.gain.setValueAtTime(peak * 0.88, t0 + 0.085);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.14);
    }
    const endTime = now + chirps * chirpGap + 0.06;

    carrier.connect(filter).connect(gain).connect(out);
    carrier.onended = () => {
      mod.disconnect();
      modGain.disconnect();
      carrier.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner?.disconnect();
      this.activeSpatialVoices = Math.max(0, this.activeSpatialVoices - 1);
    };
    mod.start(now);
    carrier.start(now);
    mod.stop(endTime);
    carrier.stop(endTime);

    return baseFreq > 4600 ? 'bush_cricket' : 'field_cricket';
  }

  private synthesizeSpatialInsect(x: number, y: number, z: number, gainScale: number): string {
    const ctx = this.ctx;
    if (!ctx) return 'bog_mosquito';
    const now = ctx.currentTime;
    const dur = 0.85 + Math.random() * 0.75;
    const panner = this.createSpatialPanner(ctx, x, y, z, 1.4, 14);
    const out: AudioNode = panner ? panner : ctx.destination;
    if (panner) {
      panner.connect(ctx.destination);
      // Animate fly-by arc across 3D space around the player!
      const sweepX = x + (Math.random() - 0.5) * 3.4;
      const sweepY = y + (Math.random() - 0.4) * 0.7;
      const sweepZ = z + (Math.random() - 0.5) * 3.4;
      if (panner.positionX && typeof panner.positionX.linearRampToValueAtTime === 'function') {
        panner.positionX.linearRampToValueAtTime(sweepX, now + dur);
        panner.positionY.linearRampToValueAtTime(sweepY, now + dur);
        panner.positionZ.linearRampToValueAtTime(sweepZ, now + dur);
      }
    }

    this.activeSpatialVoices++;

    const isHorsefly = Math.random() < 0.35;
    const baseHz = isHorsefly ? 240 + Math.random() * 65 : 490 + Math.random() * 145;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseHz, now);
    osc.frequency.linearRampToValueAtTime(baseHz * (0.93 + Math.random() * 0.18), now + dur * 0.5);
    osc.frequency.linearRampToValueAtTime(baseHz * 0.91, now + dur);

    // Subtle wing-flutter FM vibrato
    const flutter = ctx.createOscillator();
    flutter.type = 'sine';
    flutter.frequency.value = isHorsefly ? 24 : 38;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = isHorsefly ? 14 : 26;
    flutter.connect(flutterDepth).connect(osc.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = baseHz * 2.1;
    filter.Q.value = 3.6;

    const gain = ctx.createGain();
    const peak = (isHorsefly ? 0.038 : 0.028) * gainScale;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + dur * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + dur);

    osc.connect(filter).connect(gain).connect(out);
    osc.onended = () => {
      flutter.disconnect();
      flutterDepth.disconnect();
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner?.disconnect();
      this.activeSpatialVoices = Math.max(0, this.activeSpatialVoices - 1);
    };
    flutter.start(now);
    osc.start(now);
    flutter.stop(now + dur + 0.02);
    osc.stop(now + dur + 0.02);

    return isHorsefly ? 'horsefly' : 'bog_mosquito';
  }

  /**
   * Subtle waterproof shell / tent canvas rustle when putting on/taking off rain jacket or entering tent.
   */
  playFabricRustle(rising = true): void {
    if (!this.initialized || !this.ctx || this.muted || !this.waterNoiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.waterNoiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(rising ? 950 : 1750, now);
    filter.frequency.exponentialRampToValueAtTime(rising ? 1850 : 880, now + 0.14);
    filter.Q.value = 1.4;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.003, now + 0.16);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(now);
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

    const buf =
      surface === 'water' || surface === 'swim' ? this.waterNoiseBuffer : this.stepNoiseBuffer;
    if (!buf) return;
    const dur = surface === 'swim' ? 0.16 : surface === 'water' ? 0.16 : 0.08;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    if (surface === 'swim') {
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(340 + Math.random() * 90, now);
      filter.frequency.exponentialRampToValueAtTime(620, now + dur * 0.65);
      filter.Q.value = 1.6;
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.008, now + dur);
    } else if (surface === 'water') {
      filter.type = 'bandpass';
      filter.frequency.value = 980 + Math.random() * 340;
      filter.Q.value = 1.1;
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.008, now + dur);
    } else if (surface === 'swamp') {
      // Viscous bog mud squelch: low resonant upward suction chirp
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(240 + Math.random() * 60, now);
      filter.frequency.exponentialRampToValueAtTime(590 + Math.random() * 120, now + dur * 0.85);
      filter.Q.value = 3.8;
      gain.gain.setValueAtTime(0.13, now);
      gain.gain.exponentialRampToValueAtTime(0.005, now + dur);
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

  /**
   * Legacy synth fallback for physical impacts/breaks when the declarative
   * SoundscapeEngine is unavailable. Callers emitting `object.impact` or
   * `object.break` must use this rather than calling `playImpact()` directly
   * so one collision never plays both synth and soundscape voices.
   */
  playPhysicalImpactFallback(strength = 1): void {
    if (this.soundscapeEngine) return;
    this.playImpact(strength);
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

  playDrinkSip(): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.19);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
    osc.connect(gain).connect(this.ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.22);
  }

  playEatCrunch(): void {
    if (!this.initialized || !this.ctx || this.muted || !this.stepNoiseBuffer) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const start = now + i * 0.12;
      const src = this.ctx.createBufferSource();
      src.buffer = this.stepNoiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100 + i * 300;
      filter.Q.value = 1.2;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.11, start);
      gain.gain.exponentialRampToValueAtTime(0.004, start + 0.08);
      src.connect(filter).connect(gain).connect(this.ctx.destination);
      src.onended = () => {
        src.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
      src.start(start);
    }
  }

  playFireIgnite(success: boolean): void {
    if (!this.initialized || !this.ctx || this.muted || !this.waterNoiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.waterNoiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(success ? 1900 : 2800, now);
    filter.frequency.exponentialRampToValueAtTime(success ? 420 : 1200, now + 0.15);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(success ? 0.18 : 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.004, now + 0.16);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(now);
  }

  playFireSparkBurst(): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const noiseBuf = this.stepNoiseBuffer ?? this.waterNoiseBuffer;
    if (!noiseBuf) return;
    const now = this.ctx.currentTime;

    // 1. Warm thump + ember scatter hiss on log impact
    const whoosh = this.ctx.createBufferSource();
    whoosh.buffer = noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.setValueAtTime(750, now);
    lp.frequency.exponentialRampToValueAtTime(240, now + 0.28);
    lp.Q.value = 0.85;
    const wg = this.ctx.createGain();
    wg.gain.setValueAtTime(0.18, now);
    wg.gain.exponentialRampToValueAtTime(0.003, now + 0.3);
    whoosh.connect(lp).connect(wg).connect(this.ctx.destination);
    whoosh.onended = () => {
      whoosh.disconnect();
      lp.disconnect();
      wg.disconnect();
    };
    whoosh.start(now);

    // 2. Rapid cluster of crisp spark crackle pops
    const popOffsets = [0.01, 0.045, 0.09, 0.145, 0.21, 0.29];
    for (let i = 0; i < popOffsets.length; i++) {
      const start = now + popOffsets[i];
      const src = this.ctx.createBufferSource();
      src.buffer = noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800 + (i % 3) * 950;
      bp.Q.value = 2.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.095 - i * 0.01, start);
      g.gain.exponentialRampToValueAtTime(0.002, start + 0.045);
      src.connect(bp).connect(g).connect(this.ctx.destination);
      src.onended = () => {
        src.disconnect();
        bp.disconnect();
        g.disconnect();
      };
      src.start(start);
    }
  }

  playFireLogCatch(): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const noiseBuf = this.waterNoiseBuffer ?? this.stepNoiseBuffer;
    if (!noiseBuf) return;
    const now = this.ctx.currentTime;

    // Soft thermal flare whoosh as the log catches fire
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(1150, now + 0.22);
    filter.frequency.exponentialRampToValueAtTime(340, now + 0.52);
    filter.Q.value = 0.9;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.004, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.14);
    gain.gain.exponentialRampToValueAtTime(0.003, now + 0.55);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(now);
  }

  playCookSizzle(): void {
    if (!this.initialized || !this.ctx || this.muted || !this.waterNoiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.waterNoiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2400;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.004, now + 0.16);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(now);
  }

  playVomitRetch(): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(74, now + 0.34);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.002, now + 0.38);
    osc.connect(filter).connect(gain).connect(this.ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.4);
  }

  dispose(): void {
    this.soundscapeEngine?.dispose();
    this.soundscapeEngine = null;
    this.soundscapeBackend = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.windGain = null;
    this.windFilter = null;
    this.rainGain = null;
    this.rainFilter = null;
    this.noiseBuffer = null;
    this.stepNoiseBuffer = null;
    this.waterNoiseBuffer = null;
    this.thunderNoiseBuffer = null;
    this.lastAmbienceTime = -Infinity;
    this.lastTargetWind = -1;
    this.lastTargetRain = -1;
    this.lastShelterAcoustic = 'outdoor';
    this.activeSpatialVoices = 0;
    this.initialized = false;
  }
}
