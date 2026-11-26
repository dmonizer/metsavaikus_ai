import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { prepareGeometry } from './geometryPreparation';
import * as botanical from './botanicalGeometry';

function triangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 0, 2, 0], 3));
  return geometry;
}

test('attribute preparation preserves existing data and the optional color distinction', () => {
  const plain = prepareGeometry(triangle());
  assert.ok(plain.attributes.normal); assert.ok(plain.attributes.uv);
  assert.equal(plain.attributes.color, undefined);
  const white = prepareGeometry(triangle(), { colors: { mode: 'white' } });
  assert.deepEqual([...white.attributes.color.array], Array(9).fill(1));
  const color = new THREE.Color(0.1, 0.2, 0.3);
  const solid = prepareGeometry(triangle(), { colors: { mode: 'solid', color } });
  assert.deepEqual([...solid.attributes.color.array], [...new Float32Array([0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3])]);
  const original = { ...solid.attributes };
  assert.equal(prepareGeometry(solid, { colors: { mode: 'white' } }), solid);
  for (const name of ['position', 'normal', 'uv', 'color']) assert.equal(solid.attributes[name], original[name]);
  for (const geo of [plain, white, solid]) geo.dispose();
});

test('height gradient and flat geometry colors remain finite and preserve their endpoints', () => {
  const options = { colors: { mode: 'height-gradient' as const, bottom: new THREE.Color(0, 0, 0), top: new THREE.Color(1, 1, 1) } };
  const gradient = prepareGeometry(triangle(), options);
  assert.deepEqual([...gradient.attributes.color.array], [0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1]);
  const flat = triangle();
  for (let i = 0; i < 3; i++) flat.attributes.position.setY(i, 0);
  prepareGeometry(flat, options);
  assert.deepEqual([...flat.attributes.color.array], Array(9).fill(0));
  gradient.dispose(); flat.dispose();
});

test('reuse, copy and consume have explicit source ownership for indexed and non-indexed input', () => {
  for (const indexed of [false, true]) {
    for (const source of ['reuse', 'copy', 'consume'] as const) {
      const input = triangle(); if (indexed) input.setIndex([0, 1, 2]);
      let disposed = 0; input.addEventListener('dispose', () => disposed++);
      const output = prepareGeometry(input, { source, colors: { mode: 'white' } });
      assert.equal(output.index, null);
      assert.equal(disposed, source === 'consume' && indexed ? 1 : 0);
      assert.equal(output === input, !indexed && source !== 'copy');
      if (source === 'copy' || indexed) {
        assert.equal(input.attributes.normal, undefined);
        assert.equal(input.attributes.color, undefined);
        assert.notEqual(input.attributes.position.array, output.attributes.position.array);
      }
      output.dispose();
      if (output !== input && source !== 'consume') input.dispose();
    }
  }
});

// Attribute-byte hashes captured from the six complete tree builders before extraction.
test('botanical output stays byte-for-byte equal across the shared-preparation extraction', () => {
  const expected = {
  "buildBirchGeometries": "3bc39972f1e8844db448303b08f0531db5209c229657e519e77b2f4ce8a6b350",
  "buildPineGeometries": "477ff4697075ddf7ad7737861a886f5d99c984dc45368619f5aef7e5af0bce0f",
  "buildBogPineGeometries": "f4c99c0f6f1d7b78021b982a28c7a235979234cb5d6fc980956d23ae5e6430fb",
  "buildSpruceGeometries": "4bf1c940c25a7737a0ccbecfba8b99c521ad925a23ea82968929f2b0485bd6e7",
  "buildLoneSpruceGeometries": "f94ae5d45badf7988e6b46fcfad167e1eb88352b6c2664b5400a936694e73028",
  "buildSpruceSaplingGeometries": "64bfac4cd6929adb64ba2e286a23bcf95563918cfcda9512d64b663b0d83bc5d"
};
  for (const [name, golden] of Object.entries(expected)) {
    const geometries = botanical[name as keyof typeof expected]();
    const hash = createHash('sha256');
    for (const [part, geometry] of Object.entries(geometries)) {
      hash.update(part);
      for (const [attribute, data] of Object.entries(geometry.attributes)) {
        hash.update(attribute);
        hash.update(Buffer.from(data.array.buffer, data.array.byteOffset, data.array.byteLength));
      }
      if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer));
      geometry.dispose();
    }
    assert.equal(hash.digest('hex'), golden, name);
  }
});
