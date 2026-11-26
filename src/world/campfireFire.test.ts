import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCampfireFireVisual } from './campfireFire';

test('createCampfireFireVisual constructs valid multi-tongue flame, base log, ember, and spark geometries', () => {
  const fire = createCampfireFireVisual(12345, true);
  assert.equal(fire.group.children.length, 3); // litGroup + baseLogsGroup + fuelLogsGroup

  const litGroup = fire.group.children[0] as THREE.Group;
  assert.equal(litGroup.visible, true);
  assert.equal(litGroup.children.length, 4); // emberMesh, flameMesh, sparksPoints, burstPoints

  const baseLogsGroup = fire.group.children[1] as THREE.Group;
  assert.equal(baseLogsGroup.children.length, 8); // 4 base logs + 4 per-log flame clusters
  const firstBaseLogMesh = (baseLogsGroup.children[0] as THREE.Group).children[0] as THREE.Mesh;
  const firstBaseLogMat = firstBaseLogMesh.material as THREE.ShaderMaterial;
  assert.ok(firstBaseLogMat.uniforms.uHeat.value > 0.5, 'Lit campfire base logs should glow');
  const firstBaseFlameMesh = (baseLogsGroup.children[1] as THREE.Group).children[0] as THREE.Mesh;
  assert.equal(firstBaseFlameMesh.visible, true, 'Lit campfire base logs should have visible flames');

  const flameMesh = litGroup.children[1] as THREE.Mesh;
  const posAttr = flameMesh.geometry.getAttribute('position');
  const flameAttr = flameMesh.geometry.getAttribute('aFlame');
  const anchorAttr = flameMesh.geometry.getAttribute('aAnchor');
  assert.ok(posAttr && posAttr.count > 400);
  assert.ok(flameAttr && flameAttr.count === posAttr.count);
  assert.ok(anchorAttr && anchorAttr.count === posAttr.count);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    assert.ok(Number.isFinite(y));
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  assert.ok(minY >= 0 && minY < 0.2, `Expected low base flames, got minY=${minY}`);
  assert.ok(maxY > 0.7, `Expected tall hero flame tongues > 0.7m, got maxY=${maxY}`);

  const ambientSparks = litGroup.children[2] as THREE.Points;
  assert.ok(ambientSparks.geometry.getAttribute('aSpark'));
  assert.ok(ambientSparks.geometry.getAttribute('aSparkExtra'));

  fire.dispose();
});

test('throwing a fuel log into a lit fire erupts sparks, delays glow while charring, and catches fire soon after', () => {
  const fire = createCampfireFireVisual(777, true);
  assert.equal(fire.getActiveFuelLogCount(), 0);
  assert.equal(fire.getActiveBurstSparkCount(), 0);

  const res = fire.addFuelLog(0.08, 0.16, -0.05, 0.4);
  assert.equal(res.willCatchFire, true);
  assert.equal(fire.getActiveFuelLogCount(), 1);
  assert.ok(
    fire.getActiveBurstSparkCount() >= 75,
    `Expected spark cloud burst >= 75 particles, got ${fire.getActiveBurstSparkCount()}`
  );

  const fuelLogsGroup = fire.group.children[2] as THREE.Group;
  const thrownWrapper = fuelLogsGroup.children[0] as THREE.Group;
  const thrownLogMesh = thrownWrapper.children[0] as THREE.Mesh;
  const thrownLogMat = thrownLogMesh.material as THREE.ShaderMaterial;

  let caughtCount = 0;
  let elapsed = 0;
  const dt = 0.05;

  // Step 0.6s: log starts charring, should NOT glow or catch fire immediately
  for (let step = 0; step < 12; step++) {
    elapsed += dt;
    fire.update(elapsed, dt, () => {
      caughtCount++;
    });
  }
  assert.equal(caughtCount, 0, 'Newly tossed log should not catch fire instantaneously');
  assert.ok(thrownLogMat.uniforms.uChar.value > 0.1, 'Newly tossed log should begin charring');
  assert.equal(thrownLogMat.uniforms.uHeat.value, 0, 'Newly tossed log should wait before glowing');

  // Step another 2.2s (total 2.8s): log catch delay is ~1.9-2.5s and ember glow ramps in
  for (let step = 0; step < 44; step++) {
    elapsed += dt;
    fire.update(elapsed, dt, () => {
      caughtCount++;
    });
  }

  assert.equal(caughtCount, 1, 'Thrown log should catch fire once after heating up');
  assert.ok(thrownLogMat.uniforms.uHeat.value > 0.2, 'Thrown log should glow after heating up');
  assert.ok(fire.getIntensityBoost() > 0, 'Catching fire should temporarily boost main flame energy');

  // Stepping several more seconds allows burst sparks to dissipate cleanly
  for (let step = 0; step < 60; step++) {
    elapsed += dt;
    fire.update(elapsed, dt);
  }
  assert.equal(fire.getActiveBurstSparkCount(), 0, 'Burst sparks should naturally burn out');

  fire.dispose();
});

test('existing base logs and logs tossed onto an unlit pit heat up and catch fire when the fire is lit', () => {
  const fire = createCampfireFireVisual(999, false);
  const baseLogsGroup = fire.group.children[1] as THREE.Group;
  const baseLogMesh = (baseLogsGroup.children[0] as THREE.Group).children[0] as THREE.Mesh;
  const baseLogMat = baseLogMesh.material as THREE.ShaderMaterial;
  const baseFlameMesh = (baseLogsGroup.children[1] as THREE.Group).children[0] as THREE.Mesh;

  assert.equal(baseLogMat.uniforms.uHeat.value, 0, 'Unlit pit base logs start cold');
  assert.equal(baseFlameMesh.visible, false, 'Unlit pit base logs have no flames');

  const res = fire.addFuelLog(0, 0.15, 0, 0);
  assert.equal(res.willCatchFire, false);
  assert.equal(fire.getActiveFuelLogCount(), 1);
  assert.equal(fire.getActiveBurstSparkCount(), 0);

  let caughtCount = 0;
  fire.update(1.0, 0.1, () => {
    caughtCount++;
  });
  assert.equal(caughtCount, 0, 'Cold pit must not ignite logs while unlit');
  assert.equal(baseLogMat.uniforms.uHeat.value, 0);
  assert.equal(baseFlameMesh.visible, false);

  fire.setLit(true);
  let t = 1.0;
  for (let i = 0; i < 56; i++) {
    t += 0.05;
    fire.update(t, 0.05, () => {
      caughtCount++;
    });
  }
  assert.equal(caughtCount, 1, 'Cold stacked log should catch fire after campfire is lit');
  assert.ok(baseLogMat.uniforms.uHeat.value > 0.5, 'Existing base logs should glow hot after ignition');
  assert.equal(baseFlameMesh.visible, true, 'Existing base logs should catch fire with flames');

  fire.dispose();
});
