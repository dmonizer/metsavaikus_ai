import type { TerrainChunkData, TerrainChunkRequest } from './terrainChunkGeometry';

export interface PrefetchJob extends TerrainChunkRequest {
  key: string;
  priority: number;
}
export type TerrainWorkerRequest = { seed: number; wasm: boolean } | TerrainChunkRequest;

// At most one build can be stale when the camera moves. Queued work is replaced
// with the latest plan, and results are keyed by world coordinates, never by mesh slot.
export class TerrainChunkPrefetch {
  private worker: Worker | null = null;
  private queue: PrefetchJob[] = [];
  private active: PrefetchJob | undefined;
  private waiters: Array<() => void> = [];

  constructor(
    seed: number,
    wasm: boolean,
    private readonly cached: (key: string) => boolean,
    private readonly accept: (job: PrefetchJob, data: TerrainChunkData) => void,
  ) {
    if (typeof Worker === 'undefined') return;
    try {
      const worker = new Worker(new URL('./terrainChunk.worker.ts', import.meta.url), {
        type: 'module', name: 'terrain-chunks',
      });
      this.worker = worker;
      worker.onerror = worker.onmessageerror = () => this.dispose();
      worker.onmessage = ({ data }: MessageEvent<TerrainChunkData | null>) => {
        if (!this.worker) return;
        if (!data || !this.active) {
          this.dispose();
          return;
        }
        if (!this.cached(this.active.key)) this.accept(this.active, data);
        this.active = undefined;
        this.next();
      };
      worker.postMessage({ seed, wasm } satisfies TerrainWorkerRequest);
    } catch {
      this.dispose();
    }
  }

  get available(): boolean { return this.worker !== null; }

  schedule(jobs: PrefetchJob[]): void {
    this.queue = jobs.sort((a, b) => b.priority - a.priority);
    if (!this.active) this.next();
  }

  whenIdle(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return new Promise(resolve => this.waiters.push(resolve));
  }

  private next(): void {
    while (this.worker && this.queue.length) {
      const job = this.queue.pop()!;
      if (this.cached(job.key)) continue;
      this.active = job;
      try {
        this.worker.postMessage({ vcx: job.vcx, vcz: job.vcz, lod: job.lod } satisfies TerrainChunkRequest);
      } catch {
        this.dispose();
      }
      return;
    }
    for (const resolve of this.waiters) resolve();
    this.waiters.length = 0;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.queue.length = 0;
    this.active = undefined;
    this.next();
  }
}
