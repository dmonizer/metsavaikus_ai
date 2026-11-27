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
  readonly isPendingLoad?: boolean;
  setPaused?(paused: boolean): void;
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
  paused?: boolean;
  pauseHistory?: boolean[];
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
      paused: false,
      pauseHistory: [false],
      stopFadeSec: null,
      loop: params.loop,
      offsetSec: params.offsetSec,
    };
    this.records.push(rec);

    return {
      instanceId: params.instanceId,
      durationSec: params.asset.durationSec ?? 2.0,
      isPendingLoad: false,
      setPaused: (paused: boolean) => {
        rec.paused = paused;
        rec.pauseHistory?.push(paused);
      },
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
  bufferSource: AudioBufferSourceNode | null;
  bufferRef: AudioBuffer | null;
  loop: boolean;
  cleanup: () => void;
  stopped: boolean;
  paused: boolean;
  pendingLoad: boolean;
  latestPitch: number;
  latestGain: number;
  bufferStartedCtxTime: number;
  bufferStartOffsetSec: number;
  pausedOffsetSec: number;
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

  private recordingsToPreload: readonly AssetDefinition[] = [];
  private readonly downloads = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly downloadAbort = new AbortController();
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

    // Replay preload queue if preloadAssets() was called before AudioContext was unlocked
    for (const asset of this.recordingsToPreload) void this.ensureBufferLoaded(asset);
  }

  preloadAssets(assets: readonly AssetDefinition[]): void {
    this.recordingsToPreload = assets.filter(asset => asset.preload && !asset.procedural && !asset.placeholder);
    this.proceduralCount = assets.filter((a) => a.procedural).length;
    if (!this.ctx) return;
    for (const asset of this.recordingsToPreload) void this.ensureBufferLoaded(asset);
  }

  /** Download configured recordings silently. Decoding uses the playback context on unlock. */
  async preloadRecordings(): Promise<void> {
    await Promise.all(this.recordingsToPreload
      .map(asset => this.decodedBuffers.has(asset.file) ? null : this.download(asset.file)));
  }

  private download(file: string): Promise<ArrayBuffer | null> {
    const pending = this.downloads.get(file);
    if (pending) return pending;
    const url = resolveShippedAudioUrl(file);
    if (!url || typeof fetch !== 'function') {
      this.failedAssets.add(file);
      return Promise.resolve(null);
    }
    const request = fetch(url, { signal: this.downloadAbort.signal })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .catch(() => {
        if (!this.downloadAbort.signal.aborted) this.failedAssets.add(file);
        return null;
      });
    this.downloads.set(file, request);
    return request;
  }

  private async ensureBufferLoaded(asset: AssetDefinition): Promise<AudioBuffer | null> {
    if (!this.ctx || asset.procedural || asset.placeholder) return null;
    const cached = this.decodedBuffers.get(asset.file);
    if (cached) return cached;
    if (this.failedAssets.has(asset.file)) return null;

    const inFlight = this.loadingPromises.get(asset.file);
    if (inFlight) return inFlight;

    const ctx = this.ctx;
    const p = this.download(asset.file)
      .then(bytes => bytes && ctx.decodeAudioData(bytes))
      .then((decoded) => {
        if (!decoded || this.downloadAbort.signal.aborted) return null;
        this.decodedBuffers.set(asset.file, decoded);
        return decoded;
      })
      .catch(() => {
        this.failedAssets.add(asset.file);
        return null;
      })
      .finally(() => {
        this.downloads.delete(asset.file);
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
        isPendingLoad: false,
        stop: () => {},
      };
    }

    const ctx = this.ctx;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      void ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.setValueAtTime(Math.max(200, Math.min(20000, params.lowpassHz)), now);

    const gainNode = ctx.createGain();
    const initialSafeGain = Number.isFinite(params.gain) ? Math.max(0.0001, Math.min(8.0, params.gain)) : 0.0001;
    gainNode.gain.setValueAtTime(initialSafeGain, now);

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
    let activeBufferSource: AudioBufferSourceNode | null = null;
    const safePitch = Number.isFinite(params.pitch) ? Math.max(0.25, Math.min(2.5, params.pitch)) : 1.0;

    const cachedBuf = !params.asset.procedural ? this.decodedBuffers.get(params.asset.file) : null;
    const getDurationSec = () => this.decodedBuffers.get(params.asset.file)?.duration ?? params.asset.durationSec ?? 2.0;

    const disconnectGraph = () => {
      try {
        filterNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      try {
        gainNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      try {
        pannerNode?.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    };

    const rt: WebVoiceRuntime = {
      instanceId: params.instanceId,
      gainNode,
      filterNode,
      pannerNode,
      bufferSource: null,
      bufferRef: cachedBuf ?? null,
      loop: params.loop,
      cleanup: disconnectGraph,
      stopped: false,
      paused: false,
      pendingLoad: false,
      latestPitch: safePitch,
      latestGain: Math.max(0.0001, params.gain),
      bufferStartedCtxTime: now,
      bufferStartOffsetSec: 0,
      pausedOffsetSec: 0,
    };

    const startBufferPlayback = (buf: AudioBuffer, offsetSec: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = rt.loop;
      src.playbackRate.setValueAtTime(rt.latestPitch, ctx.currentTime);
      src.connect(filterNode);
      const safeDur = Math.max(0.1, buf.duration);
      const safeOffset = Number.isFinite(offsetSec) ? Math.max(0, offsetSec) % safeDur : 0;
      src.start(ctx.currentTime, safeOffset);
      rt.bufferRef = buf;
      rt.bufferSource = src;
      rt.bufferStartedCtxTime = ctx.currentTime;
      rt.bufferStartOffsetSec = safeOffset;
      rt.cleanup = () => {
        if (rt.bufferSource) {
          try {
            rt.bufferSource.stop();
          } catch {
            // Ignore already stopped
          }
          try {
            rt.bufferSource.disconnect();
          } catch {
            // Ignore disconnect errors
          }
          rt.bufferSource = null;
        }
        disconnectGraph();
      };
    };

    if (cachedBuf) {
      startBufferPlayback(cachedBuf, params.offsetSec);
      activeBufferSource = rt.bufferSource;
      cleanupFn = rt.cleanup;
    } else if (!params.asset.procedural && !params.asset.placeholder) {
      // Wait for async fetch+decode so uncached one-shots (e.g. wolf_howl, owl, woodpecker)
      // and loops play the real recording rather than discarding it for a fallback noise burst.
      rt.pendingLoad = true;
      cleanupFn = disconnectGraph;
      void this.ensureBufferLoaded(params.asset).then((buf) => {
        rt.pendingLoad = false;
        if (stopped || rt.stopped || this.voices.get(params.instanceId) !== rt) {
          disconnectGraph();
          return;
        }
        if (buf) {
          rt.bufferRef = buf;
          if (rt.paused) {
            const safeDur = Math.max(0.1, buf.duration);
            rt.pausedOffsetSec = Number.isFinite(params.offsetSec)
              ? Math.max(0, params.offsetSec) % safeDur
              : 0;
            return;
          }
          startBufferPlayback(buf, params.offsetSec);
        } else {
          // Asset failed to fetch/decode -> fall back to procedural synth
          rt.cleanup = this.startProceduralSynth(ctx, params, filterNode);
        }
      });
    } else {
      cleanupFn = this.startProceduralSynth(ctx, params, filterNode);
    }

    rt.bufferSource = activeBufferSource;
    if (cleanupFn !== rt.cleanup) rt.cleanup = cleanupFn;
    this.voices.set(params.instanceId, rt);

    return {
      instanceId: params.instanceId,
      get durationSec() { return getDurationSec(); },
      get isPendingLoad() { return rt.pendingLoad; },
      setPaused: (paused: boolean) => {
        if (stopped || rt.stopped || rt.paused === paused) return;
        rt.paused = paused;
        const t = ctx.currentTime;
        if (paused) {
          scheduleAudioParam(rt.gainNode.gain, 0.0001, t, 0.015);
          if (rt.bufferSource && rt.bufferRef) {
            const elapsed = Math.max(0, t - rt.bufferStartedCtxTime) * rt.latestPitch;
            const safeDur = Math.max(0.1, rt.bufferRef.duration);
            rt.pausedOffsetSec = (rt.bufferStartOffsetSec + elapsed) % safeDur;
            try {
              rt.bufferSource.stop();
            } catch {
              // Ignore already stopped
            }
            try {
              rt.bufferSource.disconnect();
            } catch {
              // Ignore disconnect errors
            }
            rt.bufferSource = null;
          }
        } else {
          scheduleAudioParam(rt.gainNode.gain, rt.latestGain, t, 0.02);
          if (rt.bufferRef && !rt.bufferSource) {
            startBufferPlayback(rt.bufferRef, rt.pausedOffsetSec);
          }
        }
      },
      stop: (fadeSec: number) => {
        if (stopped) return;
        stopped = true;
        rt.stopped = true;
        rt.pendingLoad = false;
        const t = ctx.currentTime;
        const f = Math.max(0.015, fadeSec);
        scheduleAudioParam(rt.gainNode.gain, 0.0001, t, f * 0.35);
        const removeVoice = () => {
          rt.cleanup();
          // Guard against deleting a newly resumed voice sharing the same instanceId!
          if (this.voices.get(params.instanceId) === rt) {
            this.voices.delete(params.instanceId);
          }
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
    } else if (kind.includes('swamp_mud_wade')) {
      // Viscous peat-bog mud squelch: soft damp thud + resonant rising-falling suction sweep
      const safePitch = Number.isFinite(params.pitch) ? Math.max(0.5, Math.min(2.0, params.pitch)) : 1.0;
      const pinkBuf = this.pinkNoiseBuf;
      if (pinkBuf) {
        const src = ctx.createBufferSource();
        src.buffer = pinkBuf;
        src.loop = false;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(220 * safePitch, now);
        bp.frequency.exponentialRampToValueAtTime(690 * safePitch, now + 0.12);
        bp.frequency.exponentialRampToValueAtTime(270 * safePitch, now + 0.34);
        bp.Q.setValueAtTime(4.2, now);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.28, now + 0.045);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
        src.connect(bp).connect(g).connect(outFilter);
        src.start(now);
        src.stop(now + 0.38);
        nodes.push(src, bp, g);
      }
      const thud = ctx.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(145 * safePitch, now);
      thud.frequency.exponentialRampToValueAtTime(58, now + 0.16);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.14, now);
      tg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      thud.connect(tg).connect(outFilter);
      thud.start(now);
      thud.stop(now + 0.2);
      nodes.push(thud, tg);
    } else if (kind.includes('water_swim_loop')) {
      // Deep rhythmic breaststroke water push & glide (distinct from sharp shallow foot splashes)
      const safePitch = Number.isFinite(params.pitch) ? Math.max(0.6, Math.min(2.0, params.pitch)) : 1.0;
      const pinkBuf = this.pinkNoiseBuf;
      if (pinkBuf) {
        const strokeSrc = ctx.createBufferSource();
        strokeSrc.buffer = pinkBuf;
        strokeSrc.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(460, now);
        bp.Q.setValueAtTime(1.4, now);
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(0.82 * Math.max(0.75, safePitch), now);
        const lfoFreqGain = ctx.createGain();
        lfoFreqGain.gain.setValueAtTime(240, now);
        lfo.connect(lfoFreqGain).connect(bp.frequency);
        const strokeGain = ctx.createGain();
        strokeGain.gain.setValueAtTime(0.2, now);
        const lfoAmpGain = ctx.createGain();
        lfoAmpGain.gain.setValueAtTime(0.12, now);
        lfo.connect(lfoAmpGain).connect(strokeGain.gain);
        strokeSrc.connect(bp).connect(strokeGain).connect(outFilter);
        strokeSrc.start(now);
        lfo.start(now);
        nodes.push(strokeSrc, bp, lfo, lfoFreqGain, lfoAmpGain, strokeGain);

        // Low-frequency submerged water body rush
        const subSrc = ctx.createBufferSource();
        subSrc.buffer = pinkBuf;
        subSrc.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(170, now);
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.18, now);
        subSrc.connect(lp).connect(subGain).connect(outFilter);
        subSrc.start(now);
        nodes.push(subSrc, lp, subGain);
      }
    } else if (kind.includes('water_plunge_splash')) {
      // Multi-layered bog-water plunge splash: cavity kerplunk + turbulent spray burst + droplet tail
      const safePitch = Number.isFinite(params.pitch) ? Math.max(0.6, Math.min(1.6, params.pitch)) : 1.0;
      const whiteBuf = this.whiteNoiseBuf;
      const pinkBuf = this.pinkNoiseBuf;

      // 1. Deep resonant water-cavity plunge thump ("kerplunk")
      const cav = ctx.createOscillator();
      cav.type = 'sine';
      cav.frequency.setValueAtTime(165 * safePitch, now);
      cav.frequency.exponentialRampToValueAtTime(52 * safePitch, now + 0.19);
      const cavGain = ctx.createGain();
      cavGain.gain.setValueAtTime(0.32, now);
      cavGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      cav.connect(cavGain).connect(outFilter);
      cav.start(now);
      cav.stop(now + 0.26);
      nodes.push(cav, cavGain);

      // 2. Main turbulent water splash surge
      if (pinkBuf) {
        const surge = ctx.createBufferSource();
        surge.buffer = pinkBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1250 * safePitch, now);
        bp.frequency.exponentialRampToValueAtTime(340, now + 0.65);
        bp.Q.value = 0.75;
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.01, now);
        sg.gain.linearRampToValueAtTime(0.46, now + 0.035);
        sg.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
        surge.connect(bp).connect(sg).connect(outFilter);
        surge.start(now);
        surge.stop(now + 0.88);
        nodes.push(surge, bp, sg);
      }

      // 3. Crisp high-frequency foam spray & trailing splash droplets
      if (whiteBuf) {
        const spray = ctx.createBufferSource();
        spray.buffer = whiteBuf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.frequency.setValueAtTime(2900 * safePitch, now + 0.02);
        hp.frequency.exponentialRampToValueAtTime(1150, now + 0.95);
        hp.Q.value = 1.1;
        const spg = ctx.createGain();
        spg.gain.setValueAtTime(0.001, now);
        spg.gain.linearRampToValueAtTime(0.24, now + 0.06);
        spg.gain.exponentialRampToValueAtTime(0.001, now + 1.05);
        spray.connect(hp).connect(spg).connect(outFilter);
        spray.start(now + 0.015);
        spray.stop(now + 1.08);
        nodes.push(spray, hp, spg);
      }
    } else if (kind.includes('fall_land_mud')) {
      const safePitch = Number.isFinite(params.pitch) ? Math.max(0.6, Math.min(1.6, params.pitch)) : 1.0;
      const thud = ctx.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(125 * safePitch, now);
      thud.frequency.exponentialRampToValueAtTime(42, now + 0.16);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.28, now);
      tg.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      thud.connect(tg).connect(outFilter);
      thud.start(now);
      thud.stop(now + 0.24);
      nodes.push(thud, tg);
      if (this.pinkNoiseBuf) {
        const squelch = ctx.createBufferSource();
        squelch.buffer = this.pinkNoiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(420 * safePitch, now);
        bp.frequency.exponentialRampToValueAtTime(980 * safePitch, now + 0.11);
        bp.frequency.exponentialRampToValueAtTime(240, now + 0.42);
        bp.Q.value = 2.0;
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.34, now);
        sg.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        squelch.connect(bp).connect(sg).connect(outFilter);
        squelch.start(now);
        squelch.stop(now + 0.48);
        nodes.push(squelch, bp, sg);
      }
    } else if (kind.includes('fall_land_wood')) {
      const safePitch = Number.isFinite(params.pitch) ? Math.max(0.6, Math.min(1.6, params.pitch)) : 1.0;
      const plank = ctx.createOscillator();
      plank.type = 'triangle';
      plank.frequency.setValueAtTime(158 * safePitch, now);
      plank.frequency.exponentialRampToValueAtTime(52, now + 0.15);
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(0.36, now);
      pg.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      plank.connect(pg).connect(outFilter);
      plank.start(now);
      plank.stop(now + 0.26);
      nodes.push(plank, pg);
      if (this.pinkNoiseBuf) {
        const rattle = ctx.createBufferSource();
        rattle.buffer = this.pinkNoiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(720 * safePitch, now);
        bp.Q.value = 1.6;
        const rg = ctx.createGain();
        rg.gain.setValueAtTime(0.18, now);
        rg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        rattle.connect(bp).connect(rg).connect(outFilter);
        rattle.start(now);
        rattle.stop(now + 0.2);
        nodes.push(rattle, bp, rg);
      }
    } else if (kind.includes('fall_land_stone')) {
      const safePitch = Number.isFinite(params.pitch) ? Math.max(0.6, Math.min(1.6, params.pitch)) : 1.0;
      const clack = ctx.createOscillator();
      clack.type = 'triangle';
      clack.frequency.setValueAtTime(240 * safePitch, now);
      clack.frequency.exponentialRampToValueAtTime(78, now + 0.08);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.28, now);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      clack.connect(cg).connect(outFilter);
      clack.start(now);
      clack.stop(now + 0.13);
      nodes.push(clack, cg);
      if (this.whiteNoiseBuf) {
        const grit = ctx.createBufferSource();
        grit.buffer = this.whiteNoiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2200 * safePitch, now);
        bp.Q.value = 0.9;
        const gg = ctx.createGain();
        gg.gain.setValueAtTime(0.26, now);
        gg.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        grit.connect(bp).connect(gg).connect(outFilter);
        grit.start(now);
        grit.stop(now + 0.25);
        nodes.push(grit, bp, gg);
      }
    } else if (kind.includes('fall_land_soft')) {
      const safePitch = Number.isFinite(params.pitch) ? Math.max(0.6, Math.min(1.6, params.pitch)) : 1.0;
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(112 * safePitch, now);
      thump.frequency.exponentialRampToValueAtTime(44, now + 0.13);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.26, now);
      tg.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      thump.connect(tg).connect(outFilter);
      thump.start(now);
      thump.stop(now + 0.19);
      nodes.push(thump, tg);
      if (this.pinkNoiseBuf) {
        const brush = ctx.createBufferSource();
        brush.buffer = this.pinkNoiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1150 * safePitch, now);
        bp.Q.value = 0.85;
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.18, now);
        bg.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        brush.connect(bp).connect(bg).connect(outFilter);
        brush.start(now);
        brush.stop(now + 0.26);
        nodes.push(brush, bp, bg);
      }
    } else if (kind.includes('campfire')) {
      // Warm low fire rumble + subtle high ember crackle
      if (this.pinkNoiseBuf) {
        const bed = ctx.createBufferSource();
        bed.buffer = this.pinkNoiseBuf;
        bed.loop = params.loop;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(320, now);
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.22, now);
        bed.connect(lp).connect(bg).connect(outFilter);
        bed.start(now);
        if (!params.loop) bed.stop(now + 1.5);
        nodes.push(bed, lp, bg);
      }
      if (this.whiteNoiseBuf) {
        const crackle = ctx.createBufferSource();
        crackle.buffer = this.whiteNoiseBuf;
        crackle.loop = params.loop;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2600, now);
        bp.Q.setValueAtTime(1.8, now);
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(0.14, now);
        const lfo = ctx.createOscillator();
        lfo.type = 'triangle';
        lfo.frequency.setValueAtTime(9.5, now);
        const lg = ctx.createGain();
        lg.gain.setValueAtTime(0.11, now);
        lfo.connect(lg).connect(cg.gain);
        crackle.connect(bp).connect(cg).connect(outFilter);
        crackle.start(now);
        lfo.start(now);
        if (!params.loop) {
          crackle.stop(now + 1.5);
          lfo.stop(now + 1.5);
        }
        nodes.push(crackle, bp, cg, lfo, lg);
      }
    } else if (kind.includes('water_trickling') || kind.includes('river')) {
      connectNoise(false, 2400, 1.5, 0.14, params.loop, params.loop ? undefined : 0.9);
    } else if (kind.includes('breathing')) {
      connectNoise(true, kind.includes('exhausted') ? 760 : 540, 1.2, 0.16, true);
    } else if (kind.includes('stone_impact')) {
      const safePitch = Number.isFinite(params.pitch) ? Math.max(0.6, Math.min(1.6, params.pitch)) : 1.0;
      const clack = ctx.createOscillator();
      clack.type = 'triangle';
      clack.frequency.setValueAtTime(320 * safePitch, now);
      clack.frequency.exponentialRampToValueAtTime(95, now + 0.08);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.28, now);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      clack.connect(cg).connect(outFilter);
      clack.start(now);
      clack.stop(now + 0.14);
      nodes.push(clack, cg);
      connectNoise(false, 2400 * safePitch, 1.0, 0.24, false, 0.18);
    } else if (kind.includes('metal_impact')) {
      const safePitch = Number.isFinite(params.pitch) ? Math.max(0.6, Math.min(1.6, params.pitch)) : 1.0;
      for (const [freq, amp, decay] of [
        [620, 0.2, 0.36],
        [1290, 0.14, 0.28],
        [2040, 0.09, 0.22],
      ]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq * safePitch, now);
        const g = ctx.createGain();
        g.gain.setValueAtTime(amp, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + decay);
        osc.connect(g).connect(outFilter);
        osc.start(now);
        osc.stop(now + decay + 0.02);
        nodes.push(osc, g);
      }
    } else if (kind.includes('wooden_floor') || kind.includes('wood_impact') || kind.includes('hollow_crate')) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(kind.includes('hollow') ? 195 : 132, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(g).connect(outFilter);
      osc.start(now);
      osc.stop(now + 0.2);
      nodes.push(osc, g);
      if (kind.includes('hollow')) {
        connectNoise(true, 560, 1.6, 0.18, false, 0.16);
      }
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
      g.gain.setValueAtTime(0.14, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc.connect(flt).connect(g).connect(outFilter);
      osc.start(now);
      osc.stop(now + 0.5);
      nodes.push(osc, flt, g);
    } else if (kind.includes('gunshot') || kind.includes('thunder')) {
      connectNoise(false, kind.includes('thunder') ? 160 : 950, 0.6, 0.55, false, kind.includes('thunder') ? 1.8 : 0.45);
    } else if (kind.includes('cricket')) {
      // Rhythmic high cricket chirp pulses
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(4250, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      for (let p = 0; p < 3; p++) {
        const t0 = now + p * 0.18;
        g.gain.setValueAtTime(0.001, t0);
        g.gain.linearRampToValueAtTime(0.14, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
      }
      osc.connect(g).connect(outFilter);
      osc.start(now);
      osc.stop(now + 0.62);
      nodes.push(osc, g);
    } else if (kind.includes('insect')) {
      // Bog mosquito hum: FM-warbled 520Hz triangle buzz + high wing shimmer
      const carrier = ctx.createOscillator();
      carrier.type = 'sawtooth';
      carrier.frequency.setValueAtTime(510, now);
      carrier.frequency.linearRampToValueAtTime(590, now + 0.45);
      carrier.frequency.linearRampToValueAtTime(475, now + 1.0);
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(24, now);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(32, now);
      lfo.connect(lg).connect(carrier.frequency);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1100, now);
      bp.Q.setValueAtTime(1.4, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.14, now + 0.12);
      g.gain.setValueAtTime(0.14, now + 0.85);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      carrier.connect(bp).connect(g).connect(outFilter);
      carrier.start(now);
      lfo.start(now);
      carrier.stop(now + 1.22);
      lfo.stop(now + 1.22);
      nodes.push(carrier, lfo, lg, bp, g);
    } else if (kind.includes('rustle')) {
      connectNoise(true, 1650, 0.85, 0.22, false, 0.26);
    } else if (kind === 'ui' || kind.includes('ui_click')) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(920, now);
      osc.frequency.exponentialRampToValueAtTime(460, now + 0.045);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.24, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(g).connect(outFilter);
      osc.start(now);
      osc.stop(now + 0.07);
      nodes.push(osc, g);
    } else if (kind.includes('music')) {
      // Soft Nordic minor fifth ambient pad (D3 + A3 + F4)
      for (const [freq, amp] of [
        [146.83, 0.11],
        [220.0, 0.08],
        [349.23, 0.05],
      ]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, now);
        const g = ctx.createGain();
        g.gain.setValueAtTime(amp, now);
        osc.connect(lp).connect(g).connect(outFilter);
        osc.start(now);
        nodes.push(osc, lp, g);
      }
    } else {
      // Crisp natural transient fallback (step, splash, rustle, chirp)
      connectNoise(false, 980, 1.0, 0.18, false, 0.18);
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
    const safeGain = Number.isFinite(params.gain) ? Math.max(0.0001, Math.min(8.0, params.gain)) : 0.0001;
    const safeLowpass = Number.isFinite(params.lowpassHz) ? Math.max(200, Math.min(20000, params.lowpassHz)) : 18000;
    rt.latestGain = safeGain;
    scheduleAudioParam(rt.gainNode.gain, rt.paused ? 0.0001 : safeGain, now, 0.05);
    scheduleAudioParam(rt.filterNode.frequency, safeLowpass, now, 0.08);
    if (Number.isFinite(params.pitch)) {
      const safePitch = Math.max(0.25, Math.min(2.5, params.pitch));
      rt.latestPitch = safePitch;
      if (rt.bufferSource) {
        scheduleAudioParam(rt.bufferSource.playbackRate, safePitch, now, 0.06);
      }
    }
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
    this.downloadAbort.abort();
    this.downloads.clear();
    this.decodedBuffers.clear();
    for (const v of this.voices.values()) {
      v.stopped = true;
      v.cleanup();
    }
    this.voices.clear();
  }
}
