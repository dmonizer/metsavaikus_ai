// Run with node --import tsx scripts/bench-world-streaming.mjs.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { distToRoadDetail, setActiveWorldSeed } from '../src/world/terrainMath.ts';
import { ComputeEngine } from '../src/world/wasmCompute.ts';
import { bakeGrassTile } from '../src/world/vegetation/grassTileStreamer.ts';
import { ShelterGeometry } from '../src/world/shelterGeometry.ts';

setActiveWorldSeed(2026);
const shelters = new ShelterGeometry();
const engine = await ComputeEngine.create();
const positions = new Float32Array(49 * 49 * 3);
const normals = new Float32Array(positions.length);
const colors = new Float32Array(positions.length);
const points = Array.from({ length: 40_000 }, (_, i) => [
  ((i * 2741) % 12001 - 6000) / 10,
  ((i * 1103) % 11999 - 5999) / 10,
]);
const road = [], terrain = [], grass = [];
const hash = createHash('sha256');
let roadSum = 0;
for (let i = 0; i < 36; i++) {
  let start = performance.now();
  for (const [x, z] of points) roadSum += distToRoadDetail(x, z).dist;
  if (i >= 6) road.push(performance.now() - start);

  start = performance.now();
  engine.fillTerrainChunk(48 * (1 + i % 2), 48 * (Math.floor(i / 2) % 2), 48, 48,
    positions, normals, colors);
  if (i >= 6) terrain.push(performance.now() - start);
  for (const buffer of [positions, normals, colors]) hash.update(buffer);

  start = performance.now();
  const tile = bakeGrassTile(3 + i % 5, 2 + Math.floor(i / 5) % 3, shelters);
  if (i >= 6) grass.push(performance.now() - start);
  for (const slab of [tile.slab, tile.shortSlab, tile.mossSlab, tile.tallSlab]) {
    hash.update(slab.matrices);
    hash.update(slab.colors);
  }
}
shelters.dispose();
function summarize(times) {
  times.sort((a, b) => a - b);
  return { p50Ms: times[14], p95Ms: times[28] };
}
console.log({
  wasm: engine.isWasmActive, road: summarize(road), terrain: summarize(terrain),
  grass: summarize(grass), roadSum, geometryHash: hash.digest('hex'),
});
