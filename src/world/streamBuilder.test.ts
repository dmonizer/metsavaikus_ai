import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createFreshwaterSystem } from './freshwaterMeshes';
import { setActiveWorldSeed, getActiveBlueprint, getTerrainHeight, getWaterSurfaceAt } from './terrainMath';
import { createWorldBlueprint } from './worldBlueprint';

test('createFreshwaterSystem builds narrow meandering streambeds, curvature/rock-wake water ribbons, and 4 batched instanced prop layers', () => {
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

      // Verify genuine meandering (path length meaningfully exceeds straight chord distance)
      const first = st.points[0];
      const last = st.points[st.points.length - 1];
      const chord = Math.hypot(last.x - first.x, last.z - first.z);
      let pathLen = 0;
      for (let i = 1; i < st.points.length; i++) {
        pathLen += Math.hypot(st.points[i].x - st.points[i - 1].x, st.points[i].z - st.points[i - 1].z);
      }
      assert.ok(
        pathLen > chord * 1.045,
        `Expected ${st.name} to meander naturally (pathLen=${pathLen.toFixed(1)} vs chord=${chord.toFixed(1)})`
      );

      const waterMesh = sys.meshes.find((m) => m.name === st.name)!;
      const geo = waterMesh.geometry;
      const rockWake = geo.getAttribute('aRockWake') as THREE.BufferAttribute;
      const mouthFade = geo.getAttribute('aMouthFade') as THREE.BufferAttribute;
      const slopeAttr = geo.getAttribute('aSlope') as THREE.BufferAttribute;
      const curveAttr = geo.getAttribute('aCurvature') as THREE.BufferAttribute;
      assert.ok(
        rockWake && mouthFade && slopeAttr && curveAttr,
        'Stream water geometry missing custom shader attributes'
      );

      // Rock wakes and bend curvature must both vary meaningfully along the meandering channel
      let maxWake = 0;
      let maxCurve = 0;
      let minCurve = Infinity;
      for (let i = 0; i < rockWake.count; i++) {
        if (rockWake.getX(i) > maxWake) maxWake = rockWake.getX(i);
        const c = curveAttr.getX(i);
        if (c > maxCurve) maxCurve = c;
        if (c < minCurve) minCurve = c;
      }
      assert.ok(maxWake > 0.25, `Expected rock wake turbulence > 0.25 on ${st.name}, got ${maxWake}`);
      assert.ok(
        maxCurve > 0.025 && maxCurve > minCurve * 2,
        `Expected varied meander curvature on ${st.name} (min=${minCurve.toFixed(4)}, max=${maxCurve.toFixed(4)})`
      );

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

test('streams rarely cross roads and any road crossing builds a culvert pipe with a dry road deck above water', () => {
  let totalStreams = 0;
  let mainRoadCrossings = 0;
  let checkedCulvert = false;

  for (let seed = 2020; seed <= 2035; seed++) {
    const bp = createWorldBlueprint(seed);
    totalStreams += bp.streams.length;
    for (const st of bp.streams) {
      for (const cv of st.culverts) {
        if (!cv.isTrail) mainRoadCrossings++;

        // Road surface directly over a culvert must remain dry and well above stream waterY
        const roadGroundY = getTerrainHeight(cv.x, cv.z, bp);
        assert.ok(
          roadGroundY >= cv.waterY + 0.35,
          `Seed ${seed} culvert road deck (${roadGroundY.toFixed(2)}) must sit cleanly above waterY (${cv.waterY.toFixed(2)})`
        );
        const water = getWaterSurfaceAt(cv.x, cv.z, bp, roadGroundY);
        assert.equal(water.hasWater, false, `Seed ${seed} road surface over culvert should be dry`);

        if (!checkedCulvert) {
          setActiveWorldSeed(seed);
          const sys = createFreshwaterSystem(bp.lakes, bp.streams);
          try {
            const hasPipe = sys.meshes.some((m) => m.name.includes('_culvert_'));
            assert.ok(hasPipe, `Expected 3D culvert drainage pipe mesh on seed ${seed}`);
            checkedCulvert = true;
          } finally {
            sys.dispose();
          }
        }
      }
    }
  }

  assert.ok(totalStreams >= 20, `Expected streams across test seeds, got ${totalStreams}`);
  // Road avoidance should keep main road crossings rare (strictly a minority of streams)
  assert.ok(
    mainRoadCrossings <= Math.ceil(totalStreams * 0.45),
    `Expected main road crossings to be rare, got ${mainRoadCrossings}/${totalStreams}`
  );
  setActiveWorldSeed(2026);
});

