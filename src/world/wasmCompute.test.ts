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
