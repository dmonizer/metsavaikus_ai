export type PerfSeverity = 'LOW_FPS' | 'EXTREME_FPS' | 'RECOVERED';

export interface FramePerfSample {
  nowMs: number;
  rawDtMs: number;
  fpsEma: number;
  fpsInstant: number;
  playerMs: number;
  propsMs: number;
  skyMs: number;
  terrainMs: number;
  vegMs: number;
  minimapMs: number;
  renderMs: number;
  tickCpuMs: number;
  /** Unaccounted frame time outside tick() — GPU sync, compositor, GC, or browser stall */
  externalWaitMs: number;
  pos: [number, number, number];
  chunk: [number, number];
  biome: string;
  heading: string;
  timeOfDay: string;
  weather: string;
  wind: number;
  flashlightOn: boolean;
  sunCastShadow: boolean;
  isSoftwareGl: boolean;
  calls: number;
  triangles: number;
  points: number;
  geometries: number;
  textures: number;
  programs: number;
  visibleChunks: number;
  lodCounts: [number, number, number];
  treesRendered: number;
  foliageRendered: number;
  terrainCacheSize: number;
  terrainBuilds: number;
  terrainEvictions: number;
  terrainRecenters: number;
  foliageCacheSize: number;
  foliageBakes: number;
  foliageEvictions: number;
  foliageVisRebuilds: number;
  grassRebuilds: number;
  grassCount: number;
  colliderCells: number;
  jsHeapMB: number | null;
}

export interface PerfReportEntry {
  severity: PerfSeverity;
  tSec: number;
  fpsEma: number;
  fpsInstant: number;
  rawDtMs: number;
  dominantCause: string;
  timingsMs: {
    cpuTotal: number;
    externalWait: number;
    renderSubmit: number;
    terrain: number;
    veg: number;
    sky: number;
    props: number;
    player: number;
    minimap: number;
    peakCpuWindow: number;
    peakFrameWindow: number;
  };
  world: {
    pos: string;
    chunk: string;
    biome: string;
    heading: string;
    time: string;
    weather: string;
    wind: number;
    flashlight: boolean;
    sunShadow: boolean;
    softwareGl: boolean;
  };
  renderer: {
    calls: number;
    tris: number;
    pts: number;
    geos: number;
    texs: number;
    progs: number;
  };
  streaming: {
    visChunks: string;
    trees: number;
    foliage: number;
    grass: number;
    tCache: number;
    tBuild: number;
    tEvict: number;
    tRecenter: number;
    fCache: number;
    fBake: number;
    fEvict: number;
    fVisReb: number;
    grassReb: number;
    collCells: number;
    heapMB: number | null;
  };
  recentEvents: string[];
}

export interface PerfLoggerOptions {
  lowFpsThreshold?: number;
  extremeFpsThreshold?: number;
  recoverFpsThreshold?: number;
  warmupMs?: number;
  logIntervalMs?: number;
  escalationCooldownMs?: number;
  maxHistory?: number;
  sink?: (prefix: string, payload: string, entry: PerfReportEntry) => void;
}

interface RecentEvent {
  atMs: number;
  label: string;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

export function classifyBottleneck(s: FramePerfSample): string {
  const cpuShare = s.rawDtMs > 0 ? s.tickCpuMs / s.rawDtMs : 0;
  if (cpuShare < 0.45 && s.externalWaitMs > 30) {
    if (s.weather === 'rain' || s.weather === 'storm') {
      return 'GPU_FILLRATE_OR_SYNC_DURING_PRECIP';
    }
    return 'GPU_OR_COMPOSITOR_STALL';
  }

  const buckets: Array<[string, number]> = [
    ['CPU_TERRAIN_CHUNKS', s.terrainMs],
    ['CPU_VEGETATION_OR_GRASS', s.vegMs],
    ['CPU_RENDER_SUBMIT', s.renderMs],
    ['CPU_PROPS_AND_RAYCAST', s.propsMs],
    ['CPU_SKY_WEATHER', s.skyMs],
    ['CPU_PLAYER_COLLISION', s.playerMs],
    ['CPU_MINIMAP_2D', s.minimapMs],
  ];
  buckets.sort((a, b) => b[1] - a[1]);
  const top = buckets[0];
  if (top[1] >= 4) return top[0];
  return 'GPU_OR_DRIVER_SYNC';
}

export class FpsDropLogger {
  private readonly lowFps: number;
  private readonly extremeFps: number;
  private readonly recoverFps: number;
  private readonly warmupMs: number;
  private readonly logIntervalMs: number;
  private readonly escalationCooldownMs: number;
  private readonly maxHistory: number;
  private readonly sink: (prefix: string, payload: string, entry: PerfReportEntry) => void;

  private readonly startMs: number;
  private readonly events: RecentEvent[] = [];
  private readonly history: PerfReportEntry[] = [];

  private inLowState = false;
  private inExtremeState = false;
  private lastLogMs = -Infinity;
  private recoverSinceMs = -1;
  private lowConsecutiveFrames = 0;

  private windowPeakCpuMs = 0;
  private windowPeakFrameMs = 0;

  constructor(startMs: number, opts: PerfLoggerOptions = {}) {
    this.startMs = startMs;
    this.lowFps = opts.lowFpsThreshold ?? 15;
    this.extremeFps = opts.extremeFpsThreshold ?? 6.5;
    this.recoverFps = opts.recoverFpsThreshold ?? 22;
    this.warmupMs = opts.warmupMs ?? 2500;
    this.logIntervalMs = opts.logIntervalMs ?? 2000;
    this.escalationCooldownMs = opts.escalationCooldownMs ?? 700;
    this.maxHistory = opts.maxHistory ?? 40;
    this.sink =
      opts.sink ??
      ((prefix, payload) => {
        console.log(`${prefix} ${payload}`);
      });
  }

  recordEvent(label: string, nowMs: number): void {
    this.events.push({ atMs: nowMs, label });
    if (this.events.length > 8) {
      this.events.shift();
    }
  }

  getHistory(): readonly PerfReportEntry[] {
    return this.history;
  }

  dumpText(): string {
    if (this.history.length === 0) {
      return '[METSAVAIKUS_PERF] No FPS drops (<15 FPS) recorded in this session.';
    }
    return this.history
      .map((entry) => `[METSAVAIKUS_PERF:${entry.severity}] ${JSON.stringify(entry)}`)
      .join('\n');
  }

  observe(sample: FramePerfSample, tabHidden = false): PerfReportEntry | null {
    if (tabHidden) {
      this.lowConsecutiveFrames = 0;
      this.recoverSinceMs = -1;
      return null;
    }

    const elapsedMs = sample.nowMs - this.startMs;
    if (elapsedMs < this.warmupMs) return null;

    // Ignore single huge tab-backgrounding wake frames (>2.5s gap)
    if (sample.rawDtMs > 2500 && !this.inLowState) {
      this.recordEvent(`wakeGap(${Math.round(sample.rawDtMs)}ms)`, sample.nowMs);
      return null;
    }

    if (sample.tickCpuMs > this.windowPeakCpuMs) this.windowPeakCpuMs = sample.tickCpuMs;
    if (sample.rawDtMs > this.windowPeakFrameMs) this.windowPeakFrameMs = sample.rawDtMs;

    const effectiveFps = Math.min(sample.fpsEma, sample.fpsInstant);
    const isExtreme =
      sample.fpsEma <= this.extremeFps ||
      (sample.fpsInstant <= this.extremeFps && this.lowConsecutiveFrames >= 1);
    const isLow = sample.fpsEma < this.lowFps || sample.fpsInstant < this.lowFps;

    if (isLow) {
      this.lowConsecutiveFrames++;
      this.recoverSinceMs = -1;

      const enteredLow = !this.inLowState && this.lowConsecutiveFrames >= 2;
      const escalatedExtreme = isExtreme && !this.inExtremeState;
      const sinceLast = sample.nowMs - this.lastLogMs;

      const shouldEmit =
        enteredLow ||
        (escalatedExtreme && sinceLast >= this.escalationCooldownMs) ||
        (this.inLowState && sinceLast >= this.logIntervalMs);

      if (shouldEmit) {
        this.inLowState = true;
        if (isExtreme) this.inExtremeState = true;
        return this.emit(isExtreme ? 'EXTREME_FPS' : 'LOW_FPS', sample);
      }
      return null;
    }

    // Healthy frame
    this.lowConsecutiveFrames = 0;
    if (this.inLowState && effectiveFps >= this.recoverFps) {
      if (this.recoverSinceMs < 0) {
        this.recoverSinceMs = sample.nowMs;
      } else if (sample.nowMs - this.recoverSinceMs >= 1000) {
        this.inLowState = false;
        this.inExtremeState = false;
        this.recoverSinceMs = -1;
        return this.emit('RECOVERED', sample);
      }
    } else {
      this.recoverSinceMs = -1;
    }
    return null;
  }

  private emit(severity: PerfSeverity, s: FramePerfSample): PerfReportEntry {
    this.lastLogMs = s.nowMs;
    const recent = this.events
      .slice(-6)
      .map((ev) => `${ev.label}@-${((s.nowMs - ev.atMs) / 1000).toFixed(1)}s`);

    const entry: PerfReportEntry = {
      severity,
      tSec: r1((s.nowMs - this.startMs) / 1000),
      fpsEma: r1(s.fpsEma),
      fpsInstant: r1(s.fpsInstant),
      rawDtMs: r1(s.rawDtMs),
      dominantCause: severity === 'RECOVERED' ? 'OK' : classifyBottleneck(s),
      timingsMs: {
        cpuTotal: r1(s.tickCpuMs),
        externalWait: r1(s.externalWaitMs),
        renderSubmit: r1(s.renderMs),
        terrain: r1(s.terrainMs),
        veg: r1(s.vegMs),
        sky: r1(s.skyMs),
        props: r1(s.propsMs),
        player: r1(s.playerMs),
        minimap: r1(s.minimapMs),
        peakCpuWindow: r1(this.windowPeakCpuMs),
        peakFrameWindow: r1(this.windowPeakFrameMs),
      },
      world: {
        pos: `${s.pos[0].toFixed(1)},${s.pos[1].toFixed(1)},${s.pos[2].toFixed(1)}`,
        chunk: `${s.chunk[0]},${s.chunk[1]}`,
        biome: s.biome,
        heading: s.heading,
        time: s.timeOfDay,
        weather: s.weather,
        wind: r1(s.wind),
        flashlight: s.flashlightOn,
        sunShadow: s.sunCastShadow,
        softwareGl: s.isSoftwareGl,
      },
      renderer: {
        calls: s.calls,
        tris: s.triangles,
        pts: s.points,
        geos: s.geometries,
        texs: s.textures,
        progs: s.programs,
      },
      streaming: {
        visChunks: `${s.visibleChunks}(${s.lodCounts[0]}/${s.lodCounts[1]}/${s.lodCounts[2]})`,
        trees: s.treesRendered,
        foliage: s.foliageRendered,
        grass: s.grassCount,
        tCache: s.terrainCacheSize,
        tBuild: s.terrainBuilds,
        tEvict: s.terrainEvictions,
        tRecenter: s.terrainRecenters,
        fCache: s.foliageCacheSize,
        fBake: s.foliageBakes,
        fEvict: s.foliageEvictions,
        fVisReb: s.foliageVisRebuilds,
        grassReb: s.grassRebuilds,
        collCells: s.colliderCells,
        heapMB: s.jsHeapMB !== null ? r1(s.jsHeapMB) : null,
      },
      recentEvents: recent,
    };

    this.windowPeakCpuMs = 0;
    this.windowPeakFrameMs = 0;

    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    const prefix = `[METSAVAIKUS_PERF:${severity}]`;
    const payload = JSON.stringify(entry);
    this.sink(prefix, payload, entry);
    return entry;
  }
}
