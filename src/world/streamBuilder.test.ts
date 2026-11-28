import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createFreshwaterSystem } from './freshwaterMeshes';
import { setActiveWorldSeed, getActiveBlueprint } from './terrainMath';

test('createFreshwaterSystem builds narrow streambeds, translucent rock-wake water ribbons, and 4 batched instanced prop layers', () => {
  setActiveWorldSeed(2026);
  const bp = getActiveBlueprint();
  assert.ok(bp.streams.length >= 1, 'Expected at least one stream on seed 2026');

  const sys = createFreshwaterSystem(bp.lakes, bp.streams);
  try {
    const names = sys.meshes.map((m) => m.name);

    // Every stream gets a dedicated high-res streambed mesh + translucent water ribbon
    for (const st of bp.streams) {
      assert.ok(names.includes(`${st.name}_bed`), `Missing streambed mesh for ${st.name}`);
      assert.ok(names.includes(st.name), `Missing stream water mesh for ${st.name}`);

      const waterMesh = sys.meshes.find((m) => m.name === st.name)!;
      const geo = waterMesh.geometry;
      const rockWake = geo.getAttribute('aRockWake') as THREE.BufferAttribute;
      const mouthFade = geo.getAttribute('aMouthFade') as THREE.BufferAttribute;
      const slopeAttr = geo.getAttribute('aSlope') as THREE.BufferAttribute;
      assert.ok(rockWake && mouthFade && slopeAttr, 'Stream water geometry missing custom shader attributes');

      // Rock wakes must be populated along the channel
      let maxWake = 0;
      for (let i = 0; i < rockWake.count; i++) {
        if (rockWake.getX(i) > maxWake) maxWake = rockWake.getX(i);
      }
      assert.ok(maxWake > 0.25, `Expected rock wake turbulence > 0.25 on ${st.name}, got ${maxWake}`);

      // Mouth fade must start at 1.0 upstream and dissolve cleanly to 0.0 at the final lake-merge row
      assert.ok(mouthFade.getX(0) > 0.95, 'Upstream mouthFade should be ~1.0');
      assert.ok(
        mouthFade.getX(mouthFade.count - 1) < 0.05,
        `Downstream mouthFade should dissolve to 0.0 for seamless lake merge, got ${mouthFade.getX(mouthFade.count - 1)}`
      );
    }

    // Batched InstancedMesh prop layers shared across all streams (minimal draw calls!)
    const instanced = sys.meshes.filter((m): m is THREE.InstancedMesh => m instanceof THREE.InstancedMesh);
    assert.equal(instanced.length, 4, `Expected 4 batched InstancedMesh layers, got ${instanced.length}`);
    for (const batch of instanced) {
      assert.ok(batch.count > 0, `Expected non-empty instance batch for ${batch.name}`);
    }
    assert.ok(names.includes('stream_boulders'));
    assert.ok(names.includes('stream_pebbles'));
    assert.ok(names.includes('stream_twigs'));
    assert.ok(names.includes('stream_logs'));
  } finally {
    // Disposal must succeed cleanly and idempotently
    sys.dispose();
  }
});
