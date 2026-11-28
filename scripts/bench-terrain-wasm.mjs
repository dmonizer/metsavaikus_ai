// node --import tsx scripts/bench-terrain-wasm.mjs [reference/src/world/wasmCompute.ts]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ComputeEngine } from '../src/world/wasmCompute.ts';

async function backend(name, Engine) {
  const engine = await Engine.create();
  const raw = engine.getRawExports();
  assert.ok(raw, name + ' fell back to JavaScript');
  const offset = (raw.scratchBase?.() ?? 0) + 16384;
  return { name, engine, raw, offset };
}

const engines = [await backend('candidate', ComputeEngine)];
if (process.argv[2]) {
  const reference = await import(pathToFileURL(resolve(process.argv[2])).href);
  engines.push(await backend('reference', reference.ComputeEngine));
}
const spheres = new Float32Array(121 * 4);
const planes = new Float32Array([1,0,0,84, -1,0,0,84, 0,1,0,32, 0,-1,0,32, 0,0,1,140, 0,0,-1,80]);
for (let i = 0; i < 121; i++) spheres.set([(i % 11 - 5) * 48, 0, (Math.floor(i / 11) - 5) * 48, 34], i * 4);
const lods = new Int32Array(121);
const grids = [7, 13, 25, 49];
function noise(e, dim, i) {
  e.raw.fillNoiseGrid(e.offset, (i % 19 - 9)*48, (i % 11 - 5)*48, 48/(dim-1), dim);
}
function cull(e, i) {
  return e.engine.cullChunks(spheres, 121, planes, i % 91 - 40, 2, i % 61 - 30, 240**2, 72**2, 144**2, lods);
}

const hashes = engines.map(e => {
  const hash = createHash('sha256');
  for (const dim of grids) for (let i = 0; i < 32; i++) {
    noise(e, dim, i);
    hash.update(new Uint8Array(e.raw.memory.buffer, e.offset, dim * dim * 12));
  }
  for (let i = 0; i < 512; i++) {
    hash.update(String(cull(e,i)));
    hash.update(lods);
  }
  return hash.digest('hex');
});
assert.ok(hashes.every(h => h === hashes[0]), 'Output bytes differ between compute engines');
console.log('Noise and culling SHA-256:', hashes[0]);

function measure(label, count, run) {
  const times = new Map(engines.map(e => [e, []]));
  // Alternate order each batch so both engines see early and late samples.
  for (let batch = 0; batch < 40; batch++) {
    for (const e of (batch % 2 ? [...engines].reverse() : engines)) {
      const start = performance.now();
      for (let i = 0; i < count; i++) run(e,i);
      if (batch >= 10) times.get(e).push((performance.now() - start)*1000/count);
    }
  }
  for (const [e, samples] of times) {
    samples.sort((a,b) => a-b);
    console.log(label, e.name, 'p50', samples[14].toFixed(3), 'p95', samples[28].toFixed(3), 'µs/call');
  }
}
for (const dim of grids) measure('noise-'+dim, Math.ceil(160000/(dim*dim)), (e,i) => noise(e,dim,i));
measure('cull-121', 8000, cull);
