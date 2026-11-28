import { buildTerrainChunk } from './terrainChunkGeometry';
import type { TerrainWorkerRequest } from './terrainChunkPrefetch';
import { getActiveBlueprint, setActiveWorldSeed } from './terrainMath';
import { ComputeEngine } from './wasmCompute';

let engine: Promise<ComputeEngine>;
let useWasm: boolean;
// The manager sends configuration first, then one chunk request at a time.
self.onmessage = async ({ data }: MessageEvent<TerrainWorkerRequest>) => {
  try {
    if ('seed' in data) {
      if (getActiveBlueprint().seed !== data.seed) setActiveWorldSeed(data.seed);
      useWasm = data.wasm;
      engine = ComputeEngine.create(useWasm);
      return;
    }
    const compute = await engine;
    if (compute.isWasmActive !== useWasm) throw new Error('Terrain compute backend mismatch');
    const result = buildTerrainChunk(compute, data);
    self.postMessage(result, {
      transfer: [result.positions.buffer, result.normals.buffer, result.colors.buffer,
        result.uvs.buffer, result.splats.buffer],
    });
  } catch {
    self.postMessage(null);
  }
};
