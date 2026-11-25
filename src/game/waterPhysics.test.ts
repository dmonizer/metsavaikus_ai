import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePlayerWaterState,
  SWIM_ENTER_DEPTH,
  SWIM_EXIT_DEPTH,
  SWIM_EYE_ABOVE_WATER,
} from './waterPhysics';
import { SWAMP_WATER_Y } from '../world/terrainMath';

test('wading progressively drops camera viewpoint closer to water until swimming', () => {
  const depths = [0, 0.15, 0.45, 0.85, 1.15, 1.35, 1.65];
  let prevEyeAboveWater = Infinity;

  for (const depth of depths) {
    const rawGroundY = SWAMP_WATER_Y - depth;
    const state = evaluatePlayerWaterState({
      rawGroundY,
      surfaceY: rawGroundY,
      onBoardwalk: false,
      swampFactor: 0.9,
      crouching: false,
      wasSwimming: false,
      eyeHeight: 1.68,
      crouchEyeHeight: 1.0,
      inWaterBasin: true,
    });

    assert.ok(
      state.eyeAboveWater <= prevEyeAboveWater + 1e-6,
      `Expected viewpoint above water to decrease monotonically at depth=${depth} (${state.eyeAboveWater} vs ${prevEyeAboveWater})`
    );
    prevEyeAboveWater = state.eyeAboveWater;

    if (depth >= SWIM_ENTER_DEPTH) {
      assert.equal(state.isSwimming, true);
      assert.ok(
        Math.abs(state.eyeAboveWater - SWIM_EYE_ABOVE_WATER) < 0.01,
        `Swimming camera should sit close to water (${state.eyeAboveWater}m)`
      );
      assert.equal(state.canUseBackpack, false, 'Backpack/eating/drinking must be disabled while swimming');
      assert.equal(state.canRefillBogWater, false, 'Refilling from backpack must be disabled while swimming');
    } else if (depth > 0.02) {
      assert.equal(state.isSwimming, false);
      assert.equal(state.isWadingWater, true);
      assert.equal(state.canUseBackpack, true);
    }
  }

  // Deepest swimming viewpoint is dramatically closer to water than shoreline
  assert.ok(prevEyeAboveWater <= SWIM_EYE_ABOVE_WATER + 0.01);
});

test('crouching in chest-deep water never dips camera underwater and swim hysteresis works cleanly', () => {
  const chestGroundY = SWAMP_WATER_Y - 1.1;
  const crouched = evaluatePlayerWaterState({
    rawGroundY: chestGroundY,
    surfaceY: chestGroundY,
    onBoardwalk: false,
    swampFactor: 0.9,
    crouching: true,
    wasSwimming: false,
    eyeHeight: 1.68,
    crouchEyeHeight: 1.0,
    inWaterBasin: true,
  });
  assert.ok(
    crouched.eyeAboveWater >= SWIM_EYE_ABOVE_WATER - 1e-6,
    `Crouching in deep wading water must keep eye above water (${crouched.eyeAboveWater})`
  );

  // Moving from deep swimming back into shallow water (< SWIM_EXIT_DEPTH) exits swimming cleanly
  const shallowGroundY = SWAMP_WATER_Y - (SWIM_EXIT_DEPTH - 0.25);
  const shallowAfterSwim = evaluatePlayerWaterState({
    rawGroundY: shallowGroundY,
    surfaceY: shallowGroundY,
    onBoardwalk: false,
    swampFactor: 0.9,
    crouching: false,
    wasSwimming: true,
    eyeHeight: 1.68,
    crouchEyeHeight: 1.0,
    inWaterBasin: true,
  });
  assert.equal(shallowAfterSwim.isSwimming, false);
  assert.equal(shallowAfterSwim.isWadingWater, true);
  assert.equal(shallowAfterSwim.canUseBackpack, true);
});

test('dry valleys outside the bog basin and elevated boardwalk planks never trigger water/swimming', () => {
  const dryValley = evaluatePlayerWaterState({
    rawGroundY: SWAMP_WATER_Y - 1.8,
    surfaceY: SWAMP_WATER_Y - 1.8,
    onBoardwalk: false,
    swampFactor: 0,
    crouching: false,
    wasSwimming: false,
    eyeHeight: 1.68,
    crouchEyeHeight: 1.0,
    inWaterBasin: false,
  });
  assert.equal(dryValley.waterDepth, 0);
  assert.equal(dryValley.isInWater, false);
  assert.equal(dryValley.isSwimming, false);
  assert.equal(dryValley.canUseBackpack, true);

  const onPlanks = evaluatePlayerWaterState({
    rawGroundY: SWAMP_WATER_Y - 1.5,
    surfaceY: SWAMP_WATER_Y + 0.14,
    onBoardwalk: true,
    swampFactor: 1.0,
    crouching: false,
    wasSwimming: true,
    eyeHeight: 1.68,
    crouchEyeHeight: 1.0,
    inWaterBasin: true,
  });
  assert.equal(onPlanks.waterDepth, 0);
  assert.equal(onPlanks.isSwimming, false);
  assert.equal(onPlanks.isSwampWading, false);
  assert.equal(onPlanks.canUseBackpack, true);
});
