import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFrameTiming } from './frameTiming';

test('10, 20, 60 and 144 FPS each preserve ten seconds of foreground time', () => {
  for (const fps of [10, 20, 60, 144]) {
    let elapsed = 0;
    for (let frame = 0; frame < fps * 10; frame++) elapsed += computeFrameTiming(1 / fps).deltaSec;
    assert.ok(Math.abs(elapsed - 10) < 1e-9, `${fps} FPS advanced ${elapsed}s instead of 10s`);
  }
});

test('physics steps consume the accepted time and bound long stalls without accumulating debt', () => {
  for (const raw of [0, 1 / 144, 1 / 60, 0.05, 0.1, 0.25, 2, 600]) {
    const timing = computeFrameTiming(raw);
    assert.ok(timing.stepSec <= 1 / 60 + 1e-10);
    assert.ok(timing.stepCount <= 15);
    assert.ok(Math.abs(timing.stepCount * timing.stepSec - timing.deltaSec) < 1e-10);
    assert.equal(timing.deltaSec, Math.min(raw, 0.25));
  }
  for (const raw of [-1, NaN, Infinity]) assert.equal(computeFrameTiming(raw).deltaSec, 0);
  assert.equal(computeFrameTiming(600).deltaSec, 0.25);
  assert.equal(computeFrameTiming(1 / 60).deltaSec, 1 / 60);
});
