export const PERF_CAPTURE_SECONDS = 30;
const MAX_CAPTURE_FRAMES = 12_000;
const STALL_MS = 50;
const SLOW_FRAME_COUNT = 5;

export interface PerfCaptureContext {
  backbufferPx: [number, number];
  pixelRatio: number;
  quality: string;
  position: [number, number, number];
  yawDeg: number;
  pitchDeg: number;
  weather: string;
  hour: number;
  reflectionsEnabled: boolean;
  waterVisible: boolean;
  sunShadow: boolean;
  audioContext: string;
  calls: number;
  triangles: number;
  trees: number;
  grass: number;
}

export interface PerfCaptureTimings {
  tick: number;
  mainRender: number;
  reflection: number;
  terrain: number;
  vegetation: number;
  soundscape: number;
  soundscapeSave: number;
}

export interface PerfCaptureStatus {
  recording: boolean;
  seconds: number;
  frames: number;
}

interface CapturedFrame {
  elapsedMs: number;
  timingsMs: PerfCaptureTimings & { frame: number; outsideTick: number };
  reflected: boolean;
  context: PerfCaptureContext;
}

interface PendingFrame {
  startMs: number;
  timings: PerfCaptureTimings;
  reflected: boolean;
  context: PerfCaptureContext;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function summarize(values: number[]) {
  values.sort((a, b) => a - b);
  const percentile = (fraction: number) => round(values[Math.ceil(values.length * fraction) - 1]);
  return { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: round(values.at(-1)!) };
}

export class PerfCapture {
  private recording = false;
  private frames: CapturedFrame[] = [];
  private elapsedMs = 0;
  private pending: PendingFrame | null = null;

  constructor(private readonly seed: number, private readonly gpu: string) {}

  start(): void {
    if (this.recording) return;
    this.frames = [];
    this.elapsedMs = 0;
    this.recording = true;
  }

  stop(): void {
    this.recording = false;
    this.breakInterval();
  }

  breakInterval(): void {
    this.pending = null;
  }

  get active(): boolean {
    return this.recording;
  }

  getStatus(): PerfCaptureStatus {
    return { recording: this.recording, seconds: this.elapsedMs / 1000, frames: this.frames.length };
  }

  record(startMs: number, timings: PerfCaptureTimings, reflected: boolean, context: PerfCaptureContext): void {
    if (!this.recording) return;
    const previous = this.pending;
    if (previous && startMs > previous.startMs) {
      // A frame interval ends at the next tick start. Attribute it to the work
      // and scene from the tick that actually preceded the wait.
      const frame = startMs - previous.startMs;
      this.elapsedMs += frame;
      this.frames.push({
        elapsedMs: this.elapsedMs,
        timingsMs: { ...previous.timings, frame, outsideTick: Math.max(0, frame - previous.timings.tick) },
        reflected: previous.reflected,
        context: previous.context,
      });
      if (this.elapsedMs >= PERF_CAPTURE_SECONDS * 1000 || this.frames.length >= MAX_CAPTURE_FRAMES) {
        this.stop();
        return;
      }
    }

    this.pending = { startMs, timings, reflected, context };
  }

  dumpText(): string {
    const first = this.frames[0];
    if (!first) return '';

    const frameMs = this.frames.map(frame => frame.timingsMs.frame);
    const timingsMs = Object.fromEntries(
      (Object.keys(first.timingsMs) as Array<keyof CapturedFrame['timingsMs']>).map(key =>
        [key, summarize(this.frames.map(frame => frame.timingsMs[key]))]
      )
    );
    const slowestFrames = [...this.frames]
      .sort((a, b) => b.timingsMs.frame - a.timingsMs.frame)
      .slice(0, SLOW_FRAME_COUNT)
      .map(frame => ({
        elapsedMs: round(frame.elapsedMs),
        timingsMs: Object.fromEntries(Object.entries(frame.timingsMs).map(([key, ms]) => [key, round(ms)])),
        reflected: frame.reflected,
        context: frame.context,
      }));

    return `[METSAVAIKUS_PERF:CAPTURE] ${JSON.stringify({
      seed: this.seed,
      gpu: this.gpu,
      seconds: round(this.elapsedMs / 1000),
      frames: frameMs.length,
      averageFps: round(frameMs.length * 1000 / this.elapsedMs),
      framesOver50Ms: frameMs.filter(ms => ms > STALL_MS).length,
      reflectionFrames: this.frames.filter(frame => frame.reflected).length,
      start: first.context,
      end: this.frames.at(-1)!.context,
      timingsMs,
      slowestFrames,
    })}`;
  }
}
