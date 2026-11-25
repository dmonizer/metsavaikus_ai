import type { AssetDefinition, BusId, SpatialMode, Vector3 } from './types';

export interface StartVoiceParams {
  instanceId: string;
  soundId: string;
  asset: AssetDefinition;
  busId: BusId;
  spatialMode: SpatialMode;
  position: Vector3 | null;
  referenceDistanceM: number;
  maximumDistanceM: number;
  rolloffFactor: number;
  gain: number;
  pitch: number;
  lowpassHz: number;
  loop: boolean;
  offsetSec: number;
}

export interface UpdateVoiceParams {
  gain: number;
  pitch: number;
  lowpassHz: number;
  position: Vector3 | null;
}

export interface BackendVoiceHandle {
  instanceId: string;
  durationSec: number;
  stop(fadeSec: number): void;
}

export interface AssetLoadStatus {
  loaded: number;
  pending: number;
  failed: string[];
  procedural: number;
}

export interface AudioBackend {
  readonly kind: string;
  readonly unsupportedFeatures: readonly string[];
  preloadAssets(assets: readonly AssetDefinition[]): void;
  setListenerPose(position: Vector3, forward: Vector3): void;
  startVoice(params: StartVoiceParams): BackendVoiceHandle;
  updateVoice(handle: BackendVoiceHandle, params: UpdateVoiceParams): void;
  stopVoice(handle: BackendVoiceHandle, fadeSec: number): void;
  setMasterLimiter(enabled: boolean): void;
  getAssetStatus(): AssetLoadStatus;
  dispose(): void;
}

// Vite expands the glob at compile time; Node/tsx tests use the mock backend.
const SHIPPED_AUDIO_GLOB: Record<string, string> =
  typeof window !== 'undefined'
    ? (import.meta.glob(['../assets/sounds/**/*.mp3', '!../assets/sounds/RAW/**'], {
        eager: true,
        query: '?url',
        import: 'default',
      }) as Record<string, string>)
    : {};

function resolveShippedAudioUrl(assetFile: string): string | null {
  return SHIPPED_AUDIO_GLOB[`../assets/sounds/${assetFile}`] ?? null;
}

export interface MockVoiceRecord {
  instanceId: string;
  soundId: string;
  assetId: string;
  busId: BusId;
  spatialMode: SpatialMode;
  initialPosition: Vector3 | null;
  lastPosition: Vector3 | null;
  gainHistory: number[];
  lowpassHistory: number[];
  pitchHistory: number[];
  stopped: boolean;
  stopFadeSec: number | null;
  loop: boolean;
  offsetSec: number;
}

export class MockAudioBackend implements AudioBackend {
  readonly kind = 'mock';
  readonly unsupportedFeatures: readonly string[] = ['hardware_reverb_convolver'];
  records: MockVoiceRecord[] = [];
  listenerPositions: Vector3[] = [];
  listenerForwards: Vector3[] = [];
  missingAssets = new Set<string>();
  loadedAssets = new Set<string>();
  failedAssets = new Set<string>();
  limiterEnabled = true;
  disposed = false;

  preloadAssets(assets: readonly AssetDefinition[]): void {
    for (const a of assets) {
      if (this.missingAssets.has(a.id) || a.placeholder) {
        this.failedAssets.add(a.file);
      } else if (!a.procedural) {
        this.loadedAssets.add(a.file);
      }
    }
  }

  markAssetMissing(assetId: string): void {
    this.missingAssets.add(assetId);
  }

  setListenerPose(position: Vector3, forward: Vector3): void {
    this.listenerPositions.push({ ...position });
    this.listenerForwards.push({ ...forward });
  }

  startVoice(params: StartVoiceParams): BackendVoiceHandle {
    if (this.missingAssets.has(params.asset.id) || params.asset.placeholder) {
      this.failedAssets.add(params.asset.file);
    } else if (!params.asset.procedural) {
      this.loadedAssets.add(params.asset.file);
    }

    const rec: MockVoiceRecord = {
      instanceId: params.instanceId,
      soundId: params.soundId,
      assetId: params.asset.id,
      busId: params.busId,
      spatialMode: params.spatialMode,
      initialPosition: params.position ? { ...params.position } : null,
      lastPosition: params.position ? { ...params.position } : null,
      gainHistory: [params.gain],
      lowpassHistory: [params.lowpassHz],
      pitchHistory: [params.pitch],
      stopped: false,
      stopFadeSec: null,
      loop: params.loop,
      offsetSec: params.offsetSec,
    };
    this.records.push(rec);

    return {
      instanceId: params.instanceId,
      durationSec: params.asset.durationSec ?? 2.0,
      stop: (fadeSec: number) => {
        rec.stopped = true;
        rec.stopFadeSec = fadeSec;
      },
    };
  }

  updateVoice(handle: BackendVoiceHandle, params: UpdateVoiceParams): void {
    const rec = this.records.find((r) => r.instanceId === handle.instanceId);
    if (!rec || rec.stopped) return;
    rec.gainHistory.push(params.gain);
    rec.lowpassHistory.push(params.lowpassHz);
    rec.pitchHistory.push(params.pitch);
    if (params.position) rec.lastPosition = { ...params.position };
  }

  stopVoice(handle: BackendVoiceHandle, fadeSec: number): void {
    handle.stop(fadeSec);
  }

  setMasterLimiter(enabled: boolean): void {
    this.limiterEnabled = enabled;
  }

  getAssetStatus(): AssetLoadStatus {
    return {
      loaded: this.loadedAssets.size,
      pending: 0,
      failed: Array.from(this.failedAssets),
      procedural: 0,
    };
  }

  dispose(): void {
    for (const r of this.records) {
      r.stopped = true;
    }
    this.disposed = true;
  }
}

interface WebVoiceRuntime {
  instanceId: string;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  pannerNode: PannerNode | null;
  cleanup: () => void;
  stopped: boolean;
}

function scheduleAudioParam(
  param: AudioParam,
  target: number,
  now: number,
  timeConstant = 0.04
): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now);
  } else {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
  }
  param.setTargetAtTime(target, now, timeConstant);
}

export class WebAudioHybridBackend implements AudioBackend {
  readonly kind = 'webaudio_hybrid';
  readonly unsupportedFeatures: readonly string[] = [
    'per_room_convolver_impulse_responses (simulated via gain + lowpass + portal bleed)',
    'velocity_doppler_pitch_shift',
  ];

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private limiterEnabled = true;

  private decodedBuffers = new Map<string, AudioBuffer>();
  private loadingPromises = new Map<string, Promise<AudioBuffer | null>>();
  private failedAssets = new Set<string>();
  private proceduralCount = 0;

  private whiteNoiseBuf: AudioBuffer | null = null;
  private pinkNoiseBuf: AudioBuffer | null = null;
  private voices = new Map<string, WebVoiceRuntime>();

  attachAudioContext(ctx: AudioContext): void {
    if (this.ctx === ctx) return;
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1.0;

    if (typeof ctx.createDynamicsCompressor === 'function') {
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -2.0;
      this.limiter.knee.value = 4.0;
      this.limiter.ratio.value = 12.0;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.12;
      this.masterGain.connect(this.limiter).connect(ctx.destination);
    } else {
      this.masterGain.connect(ctx.destination);
    }

    // Shared 2.5s white + pink noise buffers
    const len = Math.floor(ctx.sampleRate * 2.5);
    this.whiteNoiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const wData = this.whiteNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      wData[i] = Math.random() * 2 - 1;
    }

    this.pinkNoiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const pData = this.pinkNoiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      pData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }

  preloadAssets(assets: readonly AssetDefinition[]): void {
    this.proceduralCount = assets.filter((a) => a.procedural).length;
    if (!this.ctx) return;
    for (const a of assets) {
      if (a.preload && !a.procedural && !a.placeholder) {
        void this.ensureBufferLoaded(a);
      }
    }
  }

  private async ensureBufferLoaded(asset: AssetDefinition): Promise<AudioBuffer | null> {
    if (!this.ctx || asset.procedural || asset.placeholder) return null;
    const cached = this.decodedBuffers.get(asset.file);
    if (cached) return cached;
    if (this.failedAssets.has(asset.file)) return null;

    const inFlight = this.loadingPromises.get(asset.file);
    if (inFlight) return inFlight;

    const url = resolveShippedAudioUrl(asset.file);
    if (!url || typeof fetch !== 'function') {
      this.failedAssets.add(asset.file);
      return null;
    }

    const p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((ab) => this.ctx!.decodeAudioData(ab))
      .then((decoded) => {
        this.decodedBuffers.set(asset.file, decoded);
        return decoded;
      })
      .catch(() => {
        this.failedAssets.add(asset.file);
        return null;
      })
      .finally(() => {
        this.loadingPromises.delete(asset.file);
      });

    this.loadingPromises.set(asset.file, p);
    return p;
  }

  setListenerPose(position: Vector3, forward: Vector3): void {
    if (!this.ctx || !this.ctx.listener) return;
    const l = this.ctx.listener;
    const now = this.ctx.currentTime;
    if (l.positionX && typeof l.positionX.setValueAtTime === 'function') {
      l.positionX.setValueAtTime(position.x, now);
      l.positionY.setValueAtTime(position.y, now);
      l.positionZ.setValueAtTime(position.z, now);
      l.forwardX?.setValueAtTime(forward.x, now);
      l.forwardY?.setValueAtTime(forward.y, now);
      l.forwardZ?.setValueAtTime(forward.z, now);
      l.upX?.setValueAtTime(0, now);
      l.upY?.setValueAtTime(1, now);
      l.upZ?.setValueAtTime(0, now);
    } else if (typeof l.setPosition === 'function') {
      l.setPosition(position.x, position.y, position.z);
      l.setOrientation?.(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  startVoice(params: StartVoiceParams): BackendVoiceHandle {
    if (!this.ctx || !this.masterGain) {
      return {
        instanceId: params.instanceId,
        durationSec: params.asset.durationSec ?? 2.0,
        stop: () => {},
      };
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.setValueAtTime(Math.max(200, Math.min(20000, params.lowpassHz)), now);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(Math.max(0.0001, params.gain), now);

    let pannerNode: PannerNode | null = null;
    if (
      params.spatialMode !== 'non_spatial' &&
      params.spatialMode !== 'player_attached' &&
      params.position &&
      typeof ctx.createPanner === 'function'
    ) {
      pannerNode = ctx.createPanner();
      pannerNode.panningModel = 'HRTF';
      pannerNode.distanceModel = 'inverse';
      pannerNode.refDistance = Math.max(0.5, params.referenceDistanceM);
      pannerNode.maxDistance = Math.max(2, params.maximumDistanceM);
      pannerNode.rolloffFactor = params.rolloffFactor;
      if (pannerNode.positionX && typeof pannerNode.positionX.setValueAtTime === 'function') {
        pannerNode.positionX.setValueAtTime(params.position.x, now);
        pannerNode.positionY.setValueAtTime(params.position.y, now);
        pannerNode.positionZ.setValueAtTime(params.position.z, now);
      } else if (typeof pannerNode.setPosition === 'function') {
        pannerNode.setPosition(params.position.x, params.position.y, params.position.z);
      }
      filterNode.connect(gainNode).connect(pannerNode).connect(this.masterGain);
    } else {
      filterNode.connect(gainNode).connect(this.masterGain);
    }

    let cleanupFn = () => {};
    let stopped = false;

    const cachedBuf = !params.asset.procedural ? this.decodedBuffers.get(params.asset.file) : null;
    const getDurationSec = () => this.decodedBuffers.get(params.asset.file)?.duration ?? params.asset.durationSec ?? 2.0;

    if (cachedBuf) {
      const src = ctx.createBufferSource();
      src.buffer = cachedBuf;
      src.loop = params.loop;
      src.playbackRate.setValueAtTime(params.pitch, now);
      src.connect(filterNode);
      const offset = params.offsetSec % Math.max(0.1, cachedBuf.duration);
      src.start(now, offset);
      cleanupFn = () => {
        try {
          src.stop();
        } catch {
          // Ignore already stopped
        }
        src.disconnect();
        filterNode.disconnect();
        gainNode.disconnect();
        pannerNode?.disconnect();
      };
    } else if (!params.asset.procedural && !params.asset.placeholder) {
      // Trigger lazy decode for next use and start subtle fallback if needed
      void this.ensureBufferLoaded(params.asset).then((buf) => {
        if (buf && !stopped && this.voices.has(params.instanceId) && params.loop) {
          // Swap in decoded MP3 seamlessly for long loops once decoded
          const v = this.voices.get(params.instanceId);
          if (!v || v.stopped) return;
          v.cleanup();
          const s = ctx.createBufferSource();
          s.buffer = buf;
          s.loop = params.loop;
          s.playbackRate.setValueAtTime(params.pitch, ctx.currentTime);
          s.connect(filterNode);
          if (pannerNode) filterNode.connect(gainNode).connect(pannerNode).connect(this.masterGain!);
          else filterNode.connect(gainNode).connect(this.masterGain!);
          s.start(ctx.currentTime, 0);
          v.cleanup = () => {
            try { s.stop(); } catch {}
            s.disconnect();
            filterNode.disconnect();
            gainNode.disconnect();
            pannerNode?.disconnect();
          };
        }
      });
      // Lightweight fallback synth when MP3 hasn't decoded on first trigger
      cleanupFn = this.startProceduralSynth(ctx, params, filterNode);
    } else {
      cleanupFn = this.startProceduralSynth(ctx, params, filterNode);
    }

    const rt: WebVoiceRuntime = {
      instanceId: params.instanceId,
      gainNode,
      filterNode,
      pannerNode,
      cleanup: cleanupFn,
      stopped: false,
    };
    this.voices.set(params.instanceId, rt);

    return {
      instanceId: params.instanceId,
      get durationSec() { return getDurationSec(); },
      stop: (fadeSec: number) => {
        if (stopped) return;
        stopped = true;
        rt.stopped = true;
        const t = ctx.currentTime;
        const f = Math.max(0.015, fadeSec);
        scheduleAudioParam(rt.gainNode.gain, 0.0001, t, f * 0.35);
        const removeVoice = () => {
          rt.cleanup();
          this.voices.delete(params.instanceId);
        };
        if (typeof window !== 'undefined') {
          window.setTimeout(removeVoice, Math.ceil(f * 1000) + 40);
        } else {
          removeVoice();
        }
      },
    };
  }

  private startProceduralSynth(
    ctx: AudioContext,
    params: StartVoiceParams,
    outFilter: BiquadFilterNode
  ): () => void {
    const kind = params.asset.proceduralKind ?? params.soundId;
    const now = ctx.currentTime;
    const nodes: AudioNode[] = [];

    const connectNoise = (pink: boolean, bpFreq: number, q: number, level: number, loop: boolean, durSec?: number) => {
      const buf = pink ? this.pinkNoiseBuf : this.whiteNoiseBuf;
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      const flt = ctx.createBiquadFilter();
      flt.type = 'bandpass';
      flt.frequency.setValueAtTime(bpFreq, now);
      flt.Q.setValueAtTime(q, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, now);
      if (!loop && durSec) {
        g.gain.exponentialRampToValueAtTime(0.001, now + durSec);
      }
      src.connect(flt).connect(g).connect(outFilter);
      src.start(now);
      if (!loop && durSec) src.stop(now + durSec + 0.02);
      nodes.push(src, flt, g);
    };

    if (kind.includes('wind') || kind.includes('forest_day') || kind.includes('forest_night') || kind.includes('marsh')) {
      connectNoise(true, kind.includes('wind_strong') ? 420 : 280, 0.7, 0.16, true);
    } else if (kind.includes('rain_tent')) {
      connectNoise(false, 940, 0.95, 0.22, true);
    } else if (kind.includes('rain_roof')) {
      connectNoise(false, 780, 1.1, 0.19, true);
    } else if (kind.includes('rain')) {
      connectNoise(false, 1750, 0.55, 0.2, true);
    } else if (kind.includes('water_trickling') || kind.includes('river') || kind.includes('campfire')) {
      connectNoise(false, kind.includes('campfire') ? 1400 : 2400, 1.8, 0.1, params.loop, params.loop ? undefined : 0.8);
    } else if (kind.includes('breathing')) {
      connectNoise(true, kind.includes('exhausted') ? 760 : 540, 1.3, 0.09, true);
    } else if (kind.includes('wooden_floor') || kind.includes('wood_impact') || kind.includes('hollow_crate')) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(kind.includes('hollow') ? 195 : 132, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.11);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.24, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(g).connect(outFilter);
      osc.start(now);
      osc.stop(now + 0.16);
      nodes.push(osc, g);
    } else if (kind.includes('creak') || kind.includes('door')) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.linearRampToValueAtTime(215, now + 0.22);
      osc.frequency.linearRampToValueAtTime(125, now + 0.45);
      const flt = ctx.createBiquadFilter();
      flt.type = 'bandpass';
      flt.frequency.value = 620;
      flt.Q.value = 2.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.08, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc.connect(flt).connect(g).connect(outFilter);
      osc.start(now);
      osc.stop(now + 0.5);
      nodes.push(osc, flt, g);
    } else if (kind.includes('gunshot') || kind.includes('thunder')) {
      connectNoise(false, kind.includes('thunder') ? 160 : 950, 0.6, 0.55, false, kind.includes('thunder') ? 1.8 : 0.45);
    } else if (kind.includes('cricket')) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(4380, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.04, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(g).connect(outFilter);
      osc.start(now);
      osc.stop(now + 0.24);
      nodes.push(osc, g);
    } else if (kind.includes('music')) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.06, now);
      osc.connect(g).connect(outFilter);
      osc.start(now);
      nodes.push(osc, g);
    } else {
      // Crisp natural transient fallback (step, splash, rustle, chirp)
      connectNoise(false, 980, 1.0, 0.14, false, 0.14);
    }

    return () => {
      for (const n of nodes) {
        if ('stop' in n && typeof (n as AudioBufferSourceNode).stop === 'function') {
          try {
            (n as AudioBufferSourceNode).stop();
          } catch {
            // Already stopped
          }
        }
        try {
          n.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
      outFilter.disconnect();
    };
  }

  updateVoice(handle: BackendVoiceHandle, params: UpdateVoiceParams): void {
    if (!this.ctx) return;
    const rt = this.voices.get(handle.instanceId);
    if (!rt || rt.stopped) return;
    const now = this.ctx.currentTime;
    scheduleAudioParam(rt.gainNode.gain, Math.max(0.0001, params.gain), now, 0.05);
    scheduleAudioParam(rt.filterNode.frequency, Math.max(200, Math.min(20000, params.lowpassHz)), now, 0.08);
    if (rt.pannerNode && params.position) {
      if (rt.pannerNode.positionX && typeof rt.pannerNode.positionX.setValueAtTime === 'function') {
        rt.pannerNode.positionX.setValueAtTime(params.position.x, now);
        rt.pannerNode.positionY.setValueAtTime(params.position.y, now);
        rt.pannerNode.positionZ.setValueAtTime(params.position.z, now);
      } else if (typeof rt.pannerNode.setPosition === 'function') {
        rt.pannerNode.setPosition(params.position.x, params.position.y, params.position.z);
      }
    }
  }

  stopVoice(handle: BackendVoiceHandle, fadeSec: number): void {
    handle.stop(fadeSec);
  }

  setMasterLimiter(enabled: boolean): void {
    this.limiterEnabled = enabled;
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.disconnect();
    if (enabled && this.limiter) {
      this.masterGain.connect(this.limiter).connect(this.ctx.destination);
    } else {
      this.masterGain.connect(this.ctx.destination);
    }
    void this.limiterEnabled;
  }

  getAssetStatus(): AssetLoadStatus {
    return {
      loaded: this.decodedBuffers.size,
      pending: this.loadingPromises.size,
      failed: Array.from(this.failedAssets),
      procedural: this.proceduralCount,
    };
  }

  dispose(): void {
    for (const v of this.voices.values()) {
      v.stopped = true;
      v.cleanup();
    }
    this.voices.clear();
  }
}
