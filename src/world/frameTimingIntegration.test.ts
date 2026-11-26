import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeFrameTiming } from '../game/frameTiming';
import { createInitialSurvivalState, stepSurvivalTick } from '../game/survivalEngine';
import { createDefaultPackingSelection, createInventoryFromPacking } from '../game/itemCatalog';
import { moveSphere, type BoxCollider } from './spatialPhysics';
import { WeatherAndSkySystem, BASE_GAME_HOURS_PER_SEC } from './weatherAndSky';
import type { SoundEngine } from './soundEngine';

function simulate(fps: number) {
  const scene = new THREE.Scene();
  const weather = new WeatherAndSkySystem(scene, true, 1, true);
  weather.setWeather('clear', true);
  weather.timeOfDay = 12;
  const inventory = createInventoryFromPacking(createDefaultPackingSelection());
  const survival = createInitialSurvivalState();
  const position = new THREE.Vector3(0, 1, 0), velocity = new THREE.Vector3(10, 0, 0);
  const wall: BoxCollider = { minX: 4, maxX: 4.2, minZ: -2, maxZ: 2, groundY: 0, heightAboveGround: 5, jumpable: false, active: true };
  const sound = { updateAmbience() {}, playThunder() {}, getSoundscapeEngine() { return null; } } as unknown as SoundEngine;
  let traveled = 0;
  try {
    for (let frame = 0; frame < fps * 10; frame++) {
      const timing = computeFrameTiming(1 / fps);
      for (let step = 0; step < timing.stepCount; step++) {
        traveled += 4.6 * timing.stepSec;
        moveSphere(position, velocity, timing.stepSec, 0.2, [wall]);
      }
      weather.update(timing.deltaSec, position, scene, sound, null);
      stepSurvivalTick(survival, inventory, {
        locomotion: 'walk', jumpedThisFrame: false, weather: 'clear', windStrength: 0.4,
        hourOfDay: weather.timeOfDay, shelter: 'outdoor', nearLitCampfireFactor: 0,
        flashlightActive: false,
      }, timing.deltaSec, timing.deltaSec * BASE_GAME_HOURS_PER_SEC);
    }
    return { traveled, position: position.toArray(), hour: weather.timeOfDay, survived: survival.survivalHoursTotal, awake: survival.awakeHours };
  } finally { weather.dispose(); }
}

test('10/20/60 FPS agree on travel, real wall collision, weather clock and survival advancement', () => {
  const expected = simulate(60);
  assert.ok(Math.abs(expected.traveled - 46) < 1e-8);
  assert.ok(Math.abs(expected.hour - 12.4) < 1e-8);
  assert.ok(Math.abs(expected.survived - 0.4) < 1e-8);
  for (const fps of [10, 20]) {
    const actual = simulate(fps);
    for (const key of ['traveled', 'hour', 'survived', 'awake'] as const) {
      assert.ok(Math.abs(actual[key] - expected[key]) < 1e-8, `${fps} FPS: ${key}`);
    }
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(actual.position[i] - expected.position[i]) < 1e-8);
  }
});
