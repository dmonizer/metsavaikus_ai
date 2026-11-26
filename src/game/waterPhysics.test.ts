import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateBogWaterFocusTarget,
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

test('bog lake water prompt requires dot over water plus standing on shore next to water or shallow non-swimming water', () => {
  // Simple straight bog shoreline: x <= 0 is raised peat shore (+0.32m), x > 0 is bog lake (-0.9m)
  const shoreLakeTerrain = (x: number, _z: number) =>
    x <= 0 ? SWAMP_WATER_Y + 0.32 : SWAMP_WATER_Y - 0.9;

  const normalize = (x: number, y: number, z: number) => {
    const len = Math.hypot(x, y, z);
    return { dirX: x / len, dirY: y / len, dirZ: z / len };
  };

  const baseShore = {
    playerX: -1.1,
    playerZ: 0,
    onGround: true,
    onBoardwalk: false,
    isSwimming: false,
    waterDepth: 0,
    rawGroundY: SWAMP_WATER_Y + 0.32,
    camX: -1.1,
    camY: SWAMP_WATER_Y + 0.32 + 1.68,
    camZ: 0,
    bogCenterX: 10,
    bogCenterZ: 0,
    waterRadius: 60,
    getTerrainHeightAt: shoreLakeTerrain,
    getSurfaceHeightAt: shoreLakeTerrain,
  };

  // 1. Standing on shore next to water, aiming down onto water surface -> TRUE
  assert.equal(
    evaluateBogWaterFocusTarget({ ...baseShore, ...normalize(3.5, -2.0, 0) }),
    true,
    'Should allow bog water action when standing on shore next to water with dot over water'
  );

  // 2. Standing on shore next to water, aiming up at the sky above the bog lake -> FALSE
  assert.equal(
    evaluateBogWaterFocusTarget({ ...baseShore, ...normalize(3.5, 1.2, 0) }),
    false,
    'Must NOT show bog water action when dot is over the sky above bog lake'
  );

  // 3. Standing on shore next to water, aiming horizontally toward horizon above the bog lake -> FALSE
  assert.equal(
    evaluateBogWaterFocusTarget({ ...baseShore, ...normalize(1, 0, 0) }),
    false,
    'Must NOT show bog water action when dot is horizontal over horizon/sky'
  );

  // 4. Standing on shore next to water, aiming at the shore bank in front of feet -> FALSE
  assert.equal(
    evaluateBogWaterFocusTarget({ ...baseShore, ...normalize(0.4, -1.68, 0) }),
    false,
    'Must NOT show bog water action when dot is over the shore bank'
  );

  // 5. Standing on shore next to water, facing away from lake toward bog ground -> FALSE
  assert.equal(
    evaluateBogWaterFocusTarget({ ...baseShore, ...normalize(-2.5, -1.5, 0) }),
    false,
    'Must NOT show bog water action when looking inland at bog shore'
  );

  // 6. Standing further inland on bog shore (not next to water), aiming toward lake -> FALSE
  assert.equal(
    evaluateBogWaterFocusTarget({
      ...baseShore,
      playerX: -4.2,
      camX: -4.2,
      ...normalize(6.0, -2.0, 0),
    }),
    false,
    'Must NOT show bog water action when standing inland away from the shoreline'
  );

  // 7. Standing in shallow non-swimming water (0.45m deep), aiming at water -> TRUE
  const shallowTerrain = (x: number, _z: number) =>
    x <= 0 ? SWAMP_WATER_Y + 0.3 : SWAMP_WATER_Y - 0.45;
  const baseShallow = {
    ...baseShore,
    playerX: 2.0,
    camX: 2.0,
    waterDepth: 0.45,
    rawGroundY: SWAMP_WATER_Y - 0.45,
    camY: SWAMP_WATER_Y - 0.45 + 1.64,
    getTerrainHeightAt: shallowTerrain,
    getSurfaceHeightAt: shallowTerrain,
  };
  assert.equal(
    evaluateBogWaterFocusTarget({ ...baseShallow, ...normalize(2.5, -1.2, 0) }),
    true,
    'Should allow bog water action when standing in shallow water with dot over water'
  );

  // 8. Standing in shallow water, aiming up at the sky -> FALSE
  assert.equal(
    evaluateBogWaterFocusTarget({ ...baseShallow, ...normalize(2.5, 0.8, 0) }),
    false,
    'Must NOT show bog water action while standing in shallow water looking at sky'
  );

  // 9. Standing in shallow water, aiming onto the shore bank -> FALSE
  assert.equal(
    evaluateBogWaterFocusTarget({ ...baseShallow, ...normalize(-2.6, -0.89, 0) }),
    false,
    'Must NOT show bog water action while standing in shallow water looking at shore'
  );

  // 10. Swimming in deep water, aiming directly at water -> FALSE
  assert.equal(
    evaluateBogWaterFocusTarget({
      ...baseShallow,
      isSwimming: true,
      waterDepth: 1.5,
      rawGroundY: SWAMP_WATER_Y - 1.5,
      camY: SWAMP_WATER_Y + SWIM_EYE_ABOVE_WATER,
      ...normalize(1.0, -0.5, 0),
    }),
    false,
    'Must NOT show bog water action while swimming'
  );

  // 11. Standing on boardwalk or airborne, aiming at water -> FALSE
  assert.equal(
    evaluateBogWaterFocusTarget({
      ...baseShore,
      onBoardwalk: true,
      ...normalize(3.5, -2.0, 0),
    }),
    false,
    'Must NOT show bog water action on boardwalk'
  );
  assert.equal(
    evaluateBogWaterFocusTarget({
      ...baseShore,
      onGround: false,
      ...normalize(3.5, -2.0, 0),
    }),
    false,
    'Must NOT show bog water action while airborne'
  );

  // 12. Solid obstacle / wall blocks crosshair ray before water -> FALSE
  assert.equal(
    evaluateBogWaterFocusTarget({
      ...baseShore,
      ...normalize(3.5, -2.0, 0),
      isSegmentBlocked: () => true,
    }),
    false,
    'Must NOT show bog water action when a solid structure blocks the dot'
  );

  // 13. Standing next to water on the left (x < -2.2), aiming right across 5m of dry bog to another pool -> FALSE
  const twoPoolsTerrain = (x: number, _z: number) =>
    x < -2.2 || x > 4.5 ? SWAMP_WATER_Y - 0.7 : SWAMP_WATER_Y + 0.15;
  assert.equal(
    evaluateBogWaterFocusTarget({
      ...baseShore,
      playerX: -1.0,
      camX: -1.0,
      rawGroundY: SWAMP_WATER_Y + 0.15,
      camY: SWAMP_WATER_Y + 0.15 + 1.68,
      getTerrainHeightAt: twoPoolsTerrain,
      getSurfaceHeightAt: twoPoolsTerrain,
      ...normalize(6.6, -1.83, 0),
    }),
    false,
    'Must NOT trigger when aiming across wide dry shore toward a separate distant pool'
  );
});

