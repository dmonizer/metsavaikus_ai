import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock } from '../soundscape/clocks';
import { SoundscapeEngine } from '../soundscape/soundscapeEngine';
import { MockAudioBackend } from '../soundscape/audioBackend';
import { DEFAULT_SOUNDSCAPE_CONFIG } from '../config/soundscape';
import {
  buildWorldContextFromSimulator,
  SimulatorSoundscapeContextBuilder,
  type SimulatorSoundscapeInput,
} from './soundscapeAdapter';
import { setActiveWorldSeed } from './terrainMath';

function makeInput(): SimulatorSoundscapeInput {
  const bp = setActiveWorldSeed(2026);
  return {
    simulationTimeMs: 0, timeOfDayHours: 12, simulationDay: 1, timeAcceleration: 1,
    sunDirY: 0.8, weather: 'clear', windStrength: 0.4, fogDensity: 0.005,
    listenerPos: { x: bp.bogCenterX + bp.bogRadius + 5, y: 1.7, z: bp.bogCenterZ },
    listenerForward: { x: 0, y: 0, z: -1 }, listenerVelocity: { x: 0, y: 0, z: 0 },
    isMoving: false, wantRun: false, crouching: false, isSwimming: false,
    isSwampWading: false, onBoardwalk: false, waterDepthM: 0, speedMps: 0,
    stamina: 80, exertion: 0, tiredness: 0, wetness: 0, wearingRainJacket: false,
    seatedInTent: false, distanceMovedTotal: 0, nearLitCampfireFactor: 0, muted: false,
    structure: {
      id: null, quality: 'outdoor', profileId: 'outdoor', enclosure: 0,
      roofCoverage: 0, hasRoof: false, roofMaterial: 'none', wallMaterial: 'none',
      condition: 'intact', portalOpenness: 1, abandoned: false,
      floorMaterial: 'forest_floor', nearestShelterDistanceM: 999,
    },
  };
}

test('stationary context reuses geography while doors, weather, clocks and player state stay live', () => {
  const input = makeInput(), clock = new ManualClock();
  const builder = new SimulatorSoundscapeContextBuilder(clock);
  const expected = buildWorldContextFromSimulator(input);
  assert.deepEqual(builder.build(input), expected);
  for (let i = 0; i < 600; i++) {
    clock.advanceMs(1000 / 60);
    assert.deepEqual(builder.build(input), expected);
  }
  assert.equal(builder.spatialSampleCount, 1);
  input.weather = 'storm';
  input.structure = { ...input.structure, id: 'door-test', portalOpenness: 0 };
  input.listenerPos.y += 2;
  input.stamina = 20;
  input.isMoving = true;
  input.simulationTimeMs = 5000;
  input.listenerForward.x = 1;
  assert.deepEqual(builder.build(input), buildWorldContextFromSimulator(input));
  assert.equal(builder.spatialSampleCount, 1);
});

test('movement samples at one meter or within 200ms, with immediate water and boardwalk transitions', () => {
  const input = makeInput(), clock = new ManualClock();
  const builder = new SimulatorSoundscapeContextBuilder(clock);
  builder.build(input);
  input.listenerPos.x += 0.1;
  clock.advanceMs(199);
  builder.build(input);
  assert.equal(builder.spatialSampleCount, 1);
  clock.advanceMs(1);
  assert.deepEqual(builder.build(input), buildWorldContextFromSimulator(input));
  assert.equal(builder.spatialSampleCount, 2);
  input.listenerPos.x += 1;
  assert.deepEqual(builder.build(input), buildWorldContextFromSimulator(input));
  assert.equal(builder.spatialSampleCount, 3);
  input.waterDepthM = 0.2;
  assert.equal(builder.build(input).geography.featureDistances.waterM, 0);
  input.waterDepthM = 0;
  assert.deepEqual(builder.build(input), buildWorldContextFromSimulator(input));
  input.onBoardwalk = true;
  assert.equal(builder.build(input).player.surfaceMaterial, 'wooden_boardwalk');
  assert.equal(builder.spatialSampleCount, 6);
});

test('geography cache is per-world, bounded and invalidated even by a reset to the same seed', () => {
  const input = makeInput();
  const builder = new SimulatorSoundscapeContextBuilder();
  const context = builder.build(input);
  context.geography.biomeComposition.forest = 999;
  assert.deepEqual(builder.build(input), buildWorldContextFromSimulator(input));
  for (const seed of [777, 777, 2026]) {
    setActiveWorldSeed(seed);
    assert.deepEqual(builder.build(input), buildWorldContextFromSimulator(input));
  }
  assert.equal(builder.spatialSampleCount, 4);
  const other = new SimulatorSoundscapeContextBuilder();
  other.build(input);
  assert.equal(other.spatialSampleCount, 1);
});

test('cached adapter contexts remain usable by the real soundscape engine across transitions', () => {
  const input = makeInput(), clock = new ManualClock();
  const builder = new SimulatorSoundscapeContextBuilder(clock);
  const engine = new SoundscapeEngine({ config: DEFAULT_SOUNDSCAPE_CONFIG, backend: new MockAudioBackend(), realClock: clock });
  try {
    for (let i = 0; i < 60; i++) {
      clock.advanceMs(1000 / 60);
      input.simulationTimeMs += 1000;
      input.weather = i < 30 ? 'clear' : 'rain';
      engine.step(1 / 60, builder.build(input));
    }
    assert.equal(builder.spatialSampleCount, 1);
    assert.ok(engine.getDiagnosticsSnapshot());
  } finally { engine.dispose(); }
});
