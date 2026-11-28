import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ComputeEngine } from './wasmCompute';

test('Rust preserves the original float32 terrain noise bytes at all four mesh densities', async () => {
  const kernels = (await ComputeEngine.create()).getRawExports();
  assert.ok(kernels);
  const offset = kernels.scratchBase() + 16384;
  const hash = createHash('sha256');
  for (const dim of [7, 13, 25, 49]) {
    for (const [x, z] of [[-576, -528], [0, 0], [-48, 96], [528, -288]]) {
      kernels.fillNoiseGrid(offset, x, z, 48 / (dim - 1), dim);
      hash.update(new Uint8Array(kernels.memory.buffer, offset, 12 * dim * dim));
    }
  }
  assert.equal(hash.digest('hex'), 'e477b69d482cb3c42455fb5a35c89fb26c71f7cb2e921c2b62811b216ac7ef6c');
});

test('culling keeps tangent spheres, exact maximum range, and exclusive LOD boundaries', async () => {
  const spheres = new Float32Array([
    -4, 0, 0, 4, -4.001, 0, 0, 4, 9.999, 0, 0, 1,
    10, 0, 0, 1, 20, 0, 0, 1, 30, 0, 0, 1, 30.001, 0, 0, 1,
  ]);
  const planes = new Float32Array(24);
  planes[0] = 1;
  for (const useWasm of [true, false]) {
    const engine = await ComputeEngine.create(useWasm);
    assert.equal(engine.isWasmActive, useWasm);
    const lods = new Int32Array(7);
    assert.equal(engine.cullChunks(spheres, 7, planes, 0, 0, 0, 900, 100, 400, lods), 5);
    assert.deepEqual([...lods], [0, -1, 0, 1, 2, 2, -1]);
  }
});
