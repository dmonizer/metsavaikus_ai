import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SOUNDSCAPE_CONFIG } from '../config/soundscape';
import { MockAudioBackend } from './audioBackend';
import { ManualClock, SeededRng } from './clocks';
import { hasValidationErrors, normalizeAndValidateConfig } from './configSchema';
import { SoundscapeEngine } from './soundscapeEngine';
import { SoundEngine } from '../world/soundEngine';
import type { SoundscapeConfig, SpatialQueryProvider, Vector3, WorldContext } from './types';

function makeWorld(overrides?: Partial<{
  simMs: number;
  hour: number;
  day: number;
  timeAccel: number;
  weather: WorldContext['weather']['type'];
  precip: 'none' | 'rain';
  intensity: number;
  windSpeed: number;
  biome: WorldContext['listener']['biome'];
  biomeComp: WorldContext['geography']['biomeComposition'];
  pos: Vector3;
  forward: Vector3;
  waterM: number;
  riverM: number;
  shelterM: number;
  campfireM: number;
  activity: WorldContext['player']['activity'];
  gait: WorldContext['player']['gait'];
  speedMps: number;
  isMoving: boolean;
  surface: WorldContext['player']['surfaceMaterial'];
  distMoved: number;
  exertion: number;
  stamina: number;
  tiredness: number;
  nearCampfire: number;
  structure: Partial<WorldContext['structure']>;
  musicEnabled: boolean;
  muted: boolean;
  useEmbeddedThunder: boolean;
}>): WorldContext {
  const hour = overrides?.hour ?? 10;
  const isNight = hour >= 21.5 || hour < 4.5;
  const biome = overrides?.biome ?? 'forest';
  return {
    simulationTimeMs: overrides?.simMs ?? 0,
    timeOfDayHours: hour,
    simulationDay: overrides?.day ?? 1,
    timeAcceleration: overrides?.timeAccel ?? 1,
    astronomy: {
      sunElevationDeg: isNight ? -18 : 38,
      moonElevationDeg: isNight ? 28 : -15,
      moonAboveHorizon: isNight,
      moonPhase: 0.75,
      isNight,
      sunriseHour: 4.8,
      sunsetHour: 20.8,
    },
    weather: {
      type: overrides?.weather ?? 'clear',
      precipitation: overrides?.precip ?? 'none',
      intensity: overrides?.intensity ?? 0,
      windSpeed: overrides?.windSpeed ?? 0.4,
      windDirectionRad: 0.5,
      fogDensity: 0.005,
    },
    weatherHistory: {
      lastRainEndSimMs: null,
      accumulatedRainMm: 0,
      rainDurationMs: 0,
      timeSinceLastRainMs: Infinity,
    },
    geography: {
      elevationM: 12,
      season: 'autumn',
      temperatureC: isNight ? 7 : 15,
      snowDepthM: 0,
      regionId: `estonia_${biome}`,
      biomeComposition: overrides?.biomeComp ?? { [biome]: 1 },
      featureDistances: {
        riverM: overrides?.riverM ?? 200,
        bogM: 250,
        waterM: overrides?.waterM ?? 200,
        roadM: 60,
        villageM: 400,
        campfireM: overrides?.campfireM ?? 180,
        shelterM: overrides?.shelterM ?? 100,
      },
    },
    listener: {
      id: 'player',
      position: overrides?.pos ?? { x: 0, y: 1.7, z: 0 },
      forward: overrides?.forward ?? { x: 0, y: 0, z: -1 },
      velocity: { x: 0, y: 0, z: 0 },
      biome,
      regionId: `estonia_${biome}`,
      underwater: false,
      waterDepthM: 0,
    },
    player: {
      activity: overrides?.activity ?? 'idle',
      gait: overrides?.gait ?? null,
      isMoving: overrides?.isMoving,
      speedMps: overrides?.speedMps ?? (overrides?.activity && overrides.activity !== 'idle' && overrides.activity !== 'stationary' && overrides.activity !== 'sleeping' ? 4.5 : 0),
      stamina: overrides?.stamina ?? 90,
      exertion: overrides?.exertion ?? 0.05,
      tiredness: overrides?.tiredness ?? 5,
      wetness: 0,
      wearingRainJacket: false,
      seatedInTent: false,
      surfaceMaterial: overrides?.surface ?? 'forest_floor',
      surfaceWetness: 0.1,
      distanceMovedTotal: overrides?.distMoved ?? 0,
      nearLitCampfireFactor: overrides?.nearCampfire ?? 0,
    },
    structure: {
      id: null,
      quality: 'outdoor',
      profileId: 'outdoor',
      enclosure: 0,
      roofCoverage: 0,
      hasRoof: false,
      roofMaterial: 'none',
      wallMaterial: 'none',
      condition: 'intact',
      portalOpenness: 1,
      abandoned: false,
      ...overrides?.structure,
    },
    settings: {
      muted: overrides?.muted ?? false,
      masterVolume: 1,
      musicEnabled: overrides?.musicEnabled ?? true,
      musicVolume: 0.25,
      useEmbeddedThunderAmbience: overrides?.useEmbeddedThunder ?? false,
    },
  };
}

function createTestEngine(opts?: {
  config?: SoundscapeConfig;
  seed?: number;
  spatialQuery?: SpatialQueryProvider;
}) {
  const realClock = new ManualClock(1000);
  const backend = new MockAudioBackend();
  const rng = new SeededRng(opts?.seed ?? 1337);
  const engine = new SoundscapeEngine({
    config: opts?.config ?? DEFAULT_SOUNDSCAPE_CONFIG,
    backend,
    realClock,
    rng,
    spatialQuery: opts?.spatialQuery,
  });
  return { engine, backend, realClock, rng };
}

test('default soundscape config validates cleanly and rejects broken schema references', () => {
  const norm = normalizeAndValidateConfig(DEFAULT_SOUNDSCAPE_CONFIG);
  assert.equal(hasValidationErrors(norm.issues), false, JSON.stringify(norm.issues));

  const badConfig: SoundscapeConfig = {
    ...DEFAULT_SOUNDSCAPE_CONFIG,
    sounds: [
      ...DEFAULT_SOUNDSCAPE_CONFIG.sounds,
      {
        id: 'broken_sound',
        bus: 'nonexistent.bus',
        trigger: { type: 'event', event: 'test.evt' },
        assets: [{ assetId: 'missing_asset_id' }],
        playback: {},
        spatial: { mode: 'non_spatial' },
      },
    ],
  };
  const badNorm = normalizeAndValidateConfig(badConfig);
  assert.equal(hasValidationErrors(badNorm.issues), true);
  assert.ok(badNorm.issues.some((i) => i.property === 'bus'));
  assert.ok(badNorm.issues.some((i) => i.property.startsWith('assets')));
});

test('midnight-crossing wolf window (23:00-04:00) enforces active window and max 2 per night', () => {
  const { engine, realClock, backend } = createTestEngine({ seed: 42 });
  // Daytime at 14:00 -> wolf must be blocked
  engine.step(0.1, makeWorld({ simMs: 14 * 3600_000, hour: 14, biome: 'forest' }));
  let wolfRule = engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'wolf_howl');
  assert.equal(wolfRule?.eligible, false);

  // Night crossing midnight from 23:12 -> 02:30 -> occurrences stay within [1,2] quota
  let simMs = 23.2 * 3600_000;
  for (let i = 0; i < 65; i++) {
    realClock.advanceMs(5000);
    simMs += 180_000; // 3 min steps across midnight
    const hr = (simMs / 3600_000) % 24;
    engine.step(0.1, makeWorld({ simMs, hour: hr, biome: 'forest' }));
  }

  wolfRule = engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'wolf_howl');
  const wolfPlays = backend.records.filter((r) => r.soundId === 'wolf_howl');
  assert.ok(wolfPlays.length >= 1 && wolfPlays.length <= 2, `Expected 1..2 wolf howls per window, got ${wolfPlays.length}`);
  assert.ok(wolfRule && wolfRule.quotaUsed <= 2);
});

test('shared quotaGroup across woodpecker variants enforces combined window cap and re-entry preserves quota', () => {
  const { engine, realClock, backend } = createTestEngine({ seed: 101 });
  let simMs = 5.2 * 3600_000;

  // Step through morning 05:00-08:00 window in forest -> shared quotaGroup woodpecker_drumming max 3
  for (let i = 0; i < 60; i++) {
    realClock.advanceMs(2000);
    simMs += 120_000; // 2m steps
    engine.step(0.1, makeWorld({ simMs, hour: (simMs / 3600_000) % 24, biome: 'forest' }));
  }

  // Leave forest into meadow and re-enter forest inside same morning window -> quota must NOT reset!
  simMs += 60_000;
  realClock.advanceMs(2000);
  engine.step(0.1, makeWorld({ simMs, hour: (simMs / 3600_000) % 24, biome: 'meadow' }));

  for (let i = 0; i < 30; i++) {
    realClock.advanceMs(2000);
    simMs += 60_000;
    engine.step(0.1, makeWorld({ simMs, hour: (simMs / 3600_000) % 24, biome: 'forest' }));
  }

  const woodpeckerPlays = backend.records.filter((r) =>
    r.soundId.startsWith('woodpecker_drumming')
  );
  assert.ok(
    woodpeckerPlays.length <= 3,
    `Expected combined woodpecker quota <= 3, got ${woodpeckerPlays.length}`
  );
});

test('nighttime bird escape cap (<=2) and 1h minInterval are strictly enforced', () => {
  const { engine, realClock, backend } = createTestEngine({ seed: 7 });
  let simMs = 23.0 * 3600_000;
  engine.step(0.1, makeWorld({ simMs, hour: 23, biome: 'forest' }));

  const playTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const before = backend.records.filter((r) => r.soundId === 'nighttime_bird_escape').length;
    engine.emitEvent({
      type: 'wildlife.bird.escape',
      origin: 'environment',
      simulationTimestamp: simMs,
      payload: {},
    });
    const after = backend.records.filter((r) => r.soundId === 'nighttime_bird_escape').length;
    if (after > before) playTimes.push(simMs);

    // Advance 4s of real time so transient bird flight (3.2s) finishes naturally, plus 35m sim time
    for (let s = 0; s < 16; s++) {
      realClock.advanceMs(250);
      simMs += 131_250; // ~2.18m * 16 = 35m sim time per iteration
      engine.step(0.25, makeWorld({ simMs, hour: (simMs / 3600_000) % 24, biome: 'forest' }));
    }
  }

  const nightBirds = backend.records.filter((r) => r.soundId === 'nighttime_bird_escape');
  assert.equal(nightBirds.length, 2, `Expected exactly 2 night birds across 2.5h night, got ${nightBirds.length}`);
  assert.ok(
    playTimes[1] - playTimes[0] >= 60 * 60_000,
    `Night birds violated 1h minInterval: delta=${playTimes[1] - playTimes[0]}`
  );
});

test('condition changes during delayed reactions cancel invalidated delayed sound', () => {
  const testConfig: SoundscapeConfig = {
    ...DEFAULT_SOUNDSCAPE_CONFIG,
    reactions: [
      {
        id: 'delayed_clear_echo',
        event: 'player.kick',
        probability: 1,
        delayMs: ['1000ms', '1000ms'],
        clock: 'simulation',
        executeConditions: { 'weather.type': { eq: 'clear' } },
        playSound: 'wood_break',
      },
    ],
  };
  const { engine, realClock, backend } = createTestEngine({ config: testConfig });
  engine.step(0.1, makeWorld({ simMs: 10_000, weather: 'clear' }));
  const beforeCount = backend.records.filter((r) => r.soundId === 'wood_break').length;

  engine.emitEvent({
    type: 'player.kick',
    origin: 'player',
    simulationTimestamp: 10_000,
    payload: {},
  });

  // Switch weather to storm before 1000ms delay completes
  realClock.advanceMs(1500);
  engine.step(0.1, makeWorld({ simMs: 11_500, weather: 'storm', precip: 'rain', intensity: 1 }));
  const afterCount = backend.records.filter((r) => r.soundId === 'wood_break').length;
  assert.equal(afterCount, beforeCount);
});

test('time acceleration does not cause burst playback, RNG is deterministic, and backward time jumps recover cleanly', () => {
  const runOnce = () => {
    const { engine, realClock, backend } = createTestEngine({ seed: 999 });
    engine.step(0.1, makeWorld({ simMs: 1000, hour: 12, biome: 'forest' }));
    realClock.advanceMs(100);
    // Jump 2 simulation hours across a single fast-forward step
    engine.step(0.1, makeWorld({ simMs: 7_201_000, hour: 14, timeAccel: 60, biome: 'forest' }));
    const afterJumpCount = backend.records.length;
    assert.ok(afterJumpCount < 15, `Time acceleration caused burst: ${afterJumpCount}`);

    // Backward time jump
    realClock.advanceMs(100);
    engine.step(0.1, makeWorld({ simMs: 500_000, hour: 10, biome: 'forest' }));
    return backend.records.map((r) => r.soundId);
  };

  const seqA = runOnce();
  const seqB = runOnce();
  assert.deepEqual(seqA, seqB);
});

test('frame-rate independence between 60Hz and 10Hz stepping produces consistent stochastic counts', () => {
  const runStepped = (hz: number) => {
    const { engine, realClock, backend } = createTestEngine({ seed: 2025 });
    const dt = 1 / hz;
    const totalSteps = hz * 30; // 30s
    let simMs = 12 * 3600_000;
    for (let i = 0; i < totalSteps; i++) {
      realClock.advanceMs(dt * 1000);
      simMs += dt * 1000;
      engine.step(dt, makeWorld({ simMs, hour: 12, biome: 'forest', windSpeed: 0.6 }));
    }
    return backend.records.filter((r) => r.soundId === 'forest_birds_chirp').length;
  };

  const count60 = runStepped(60);
  const count10 = runStepped(10);
  assert.ok(Math.abs(count60 - count10) <= 6, `Rate diverged sharply: 60Hz=${count60}, 10Hz=${count10}`);
});

test('save/load preserves quotas, cooldowns, disturbances, and weather history', () => {
  const { engine: eng1, realClock } = createTestEngine({ seed: 55 });
  // Step through rain for 10 min (>1mm accumulated) then stop rain near shelter
  eng1.step(0.1, makeWorld({ simMs: 10_000, weather: 'rain', precip: 'rain', intensity: 0.8, shelterM: 12, structure: { hasRoof: true } }));
  realClock.advanceMs(500);
  eng1.step(0.1, makeWorld({ simMs: 610_000, weather: 'rain', precip: 'rain', intensity: 0.8, shelterM: 12, structure: { hasRoof: true } }));
  realClock.advanceMs(500);
  eng1.step(0.1, makeWorld({ simMs: 620_000, weather: 'clear', precip: 'none', intensity: 0, shelterM: 12, structure: { hasRoof: true } }));

  eng1.emitEvent({
    type: 'player.weapon.fire',
    origin: 'player',
    simulationTimestamp: 620_000,
    position: { x: 0, y: 1.7, z: 0 },
    intensity: 1,
    payload: {},
  });

  const snap = eng1.exportSnapshot();

  const { engine: eng2 } = createTestEngine({ seed: 55 });
  eng2.importSnapshot(snap);
  eng2.step(
    0.1,
    makeWorld({
      simMs: 621_000,
      weather: 'clear',
      precip: 'none',
      intensity: 0,
      shelterM: 12,
      structure: { hasRoof: true },
    })
  );

  const diag2 = eng2.getDiagnosticsSnapshot();
  assert.ok(diag2.disturbances.some((d) => d.profileId === 'gunshot_disturbance'));
  const dripRule = diag2.rules.find((r) => r.soundId === 'roof_water_trickling');
  assert.equal(dripRule?.eligible, true);
});

test('structural acoustics: smooth transitions, broken roof vs enclosed house, door openness, listener pose, and local footsteps unaffected', () => {
  const { engine, realClock, backend } = createTestEngine();
  // Start outdoors
  engine.step(0.1, makeWorld({ simMs: 1000, weather: 'rain', precip: 'rain', intensity: 0.8, forward: { x: 1, y: 0, z: 0 } }));
  const outdoorEval = engine.getDiagnosticsSnapshot().acoustics;
  assert.equal(outdoorEval.exteriorGain, 1);
  assert.deepEqual(backend.listenerForwards.at(-1), { x: 1, y: 0, z: 0 });

  // Enter wooden_house -> exteriorGain transitions smoothly, not instantaneously
  realClock.advanceMs(50);
  engine.step(
    0.05,
    makeWorld({
      simMs: 1050,
      weather: 'rain',
      precip: 'rain',
      intensity: 0.8,
      structure: {
        id: 'house_1',
        quality: 'warm_house',
        profileId: 'wooden_house',
        enclosure: 0.92,
        roofCoverage: 1,
        hasRoof: true,
        portalOpenness: 0.05,
      },
    })
  );
  const midEval = engine.getDiagnosticsSnapshot().acoustics;
  assert.ok(midEval.exteriorGain < 1 && midEval.exteriorGain > 0.25, `Expected smooth transition, got ${midEval.exteriorGain}`);

  // Settle into closed wooden_house
  for (let i = 0; i < 40; i++) {
    realClock.advanceMs(100);
    engine.step(
      0.1,
      makeWorld({
        simMs: 1100 + i * 100,
        weather: 'rain',
        precip: 'rain',
        intensity: 0.8,
        structure: {
          id: 'house_1',
          quality: 'warm_house',
          profileId: 'wooden_house',
          enclosure: 0.92,
          roofCoverage: 1,
          hasRoof: true,
          portalOpenness: 0.05,
        },
      })
    );
  }
  const closedGain = engine.getDiagnosticsSnapshot().acoustics.exteriorGain;

  // Open door increases portalOpenness -> higher exterior gain bleed
  for (let i = 0; i < 40; i++) {
    realClock.advanceMs(100);
    engine.step(
      0.1,
      makeWorld({
        simMs: 5100 + i * 100,
        weather: 'rain',
        precip: 'rain',
        intensity: 0.8,
        structure: {
          id: 'house_1',
          quality: 'warm_house',
          profileId: 'wooden_house',
          enclosure: 0.92,
          roofCoverage: 1,
          hasRoof: true,
          portalOpenness: 0.95,
        },
      })
    );
  }
  const openDoorGain = engine.getDiagnosticsSnapshot().acoustics.exteriorGain;
  assert.ok(openDoorGain > closedGain, `Expected open door gain ${openDoorGain} > closed ${closedGain}`);

  // Local wooden_floor footstep inside house bypasses exterior attenuation
  engine.emitEvent({
    type: 'player.step',
    origin: 'player',
    simulationTimestamp: 9200,
    position: { x: 0, y: 1.7, z: 0 },
    payload: { material: 'wooden_floor', gait: 'walk' },
  });
  realClock.advanceMs(30);
  engine.step(
    0.03,
    makeWorld({
      simMs: 9230,
      weather: 'rain',
      precip: 'rain',
      intensity: 0.8,
      structure: {
        id: 'house_1',
        quality: 'warm_house',
        profileId: 'wooden_house',
        enclosure: 0.92,
        roofCoverage: 1,
        hasRoof: true,
        portalOpenness: 0.05,
      },
    })
  );
  const stepVoice = engine.getDiagnosticsSnapshot().voices.find((v) => v.soundId === 'wooden_floor_walk');
  assert.ok(stepVoice, 'Expected wooden_floor_walk voice inside house');
  assert.ok(stepVoice.lowpassHz >= 15000, `Expected unmuffled indoor step lowpass, got ${stepVoice.lowpassHz}`);
  const dayAmbInside = engine.getDiagnosticsSnapshot().voices.find((v) => v.soundId === 'forest_day_ambience');
  assert.ok(!dayAmbInside || stepVoice.effectiveGain > dayAmbInside.effectiveGain, 'Local footstep should bypass exterior attenuation');

  // Partially missing roof (decrepit_missing_roof) lets through more exterior sound than intact closed house
  for (let i = 0; i < 40; i++) {
    realClock.advanceMs(100);
    engine.step(
      0.1,
      makeWorld({
        simMs: 9300 + i * 100,
        structure: {
          id: 'hut_1',
          quality: 'drafty_hut',
          profileId: 'decrepit_missing_roof',
          enclosure: 0.55,
          roofCoverage: 0.45,
          hasRoof: true,
          portalOpenness: 0.45,
          abandoned: true,
        },
      })
    );
  }
  const brokenRoofGain = engine.getDiagnosticsSnapshot().acoustics.exteriorGain;
  assert.ok(brokenRoofGain > closedGain, `Expected broken roof gain ${brokenRoofGain} > closed ${closedGain}`);
});

test('surface/gait transitions, stop on idle, fatigue breathing recovery, and long gait loop continuity', () => {
  const { engine, realClock, backend } = createTestEngine();

  // Walk on forest_floor uses long gait loop forest_floor_walk without restarting every step
  let dist = 0;
  for (let i = 0; i < 20; i++) {
    dist += 0.45; // 9m over 2s
    realClock.advanceMs(100);
    engine.step(
      0.1,
      makeWorld({
        simMs: 1000 + i * 100,
        activity: 'walking',
        gait: 'walk',
        surface: 'forest_floor',
        distMoved: dist,
        exertion: 0.15,
      })
    );
  }
  const longLoopRecords = backend.records.filter((r) => r.soundId === 'forest_floor_walk');
  assert.equal(longLoopRecords.length, 1, 'Long gait loop must NOT restart on every step');
  assert.equal(longLoopRecords[0].stopped, false);

  // Switch to wooden_boardwalk -> stops/pauses forest_floor_walk and triggers wooden_floor_walk discrete steps
  dist += 2.0;
  realClock.advanceMs(100);
  engine.step(
    0.1,
    makeWorld({
      simMs: 3100,
      activity: 'walking',
      gait: 'walk',
      surface: 'wooden_boardwalk',
      distMoved: dist,
    })
  );
  assert.equal(longLoopRecords[0].stopped, true);
  assert.ok(backend.records.some((r) => r.soundId === 'wooden_floor_walk'));

  // Switch to gravel -> starts gravel_walk_loop and stops on idle
  dist += 1.0;
  realClock.advanceMs(100);
  engine.step(
    0.1,
    makeWorld({
      simMs: 3200,
      activity: 'walking',
      gait: 'walk',
      surface: 'gravel',
      distMoved: dist,
    })
  );
  const gravelLoop = backend.records.find((r) => r.soundId === 'gravel_walk_loop');
  assert.ok(gravelLoop, 'Expected gravel_walk_loop when walking on gravel');

  // Exerted -> Exhausted -> Idle recovery breathing transition
  realClock.advanceMs(100);
  engine.step(
    0.1,
    makeWorld({ simMs: 3300, activity: 'sprinting', gait: 'sprint', exertion: 0.92, stamina: 12, distMoved: dist + 1 })
  );
  const exhaustedBreathing = backend.records.find((r) => r.soundId === 'breathing_exhausted');
  assert.ok(exhaustedBreathing, 'Expected breathing_exhausted under sprint + low stamina');
  assert.equal(gravelLoop.stopped, true);

  for (let i = 0; i < 10; i++) {
    realClock.advanceMs(120);
    engine.step(0.12, makeWorld({ simMs: 3400 + i * 120, activity: 'idle', gait: null, exertion: 0.05, stamina: 95, distMoved: dist + 1 }));
  }
  assert.equal(exhaustedBreathing.stopped, true);
  assert.ok(backend.records.some((r) => r.soundId === 'breathing_rest'));
});

test('breakable object intact impact vs breakage, plus correlated physics deduplication', () => {
  const { engine, backend } = createTestEngine();
  engine.step(0.1, makeWorld({ simMs: 1000 }));

  // Intact breakable wood -> hollow crate impact
  engine.emitEvent({
    type: 'object.impact',
    origin: 'player',
    simulationTimestamp: 1000,
    position: { x: 1, y: 1, z: 1 },
    dedupeKey: 'crate_hit_1',
    dedupeWindowMs: 120,
    payload: { material: 'wood', breakable: true, broken: false },
  });
  // Duplicate within 120ms window must be suppressed
  engine.emitEvent({
    type: 'object.impact',
    origin: 'player',
    simulationTimestamp: 1040,
    position: { x: 1, y: 1, z: 1 },
    dedupeKey: 'crate_hit_1',
    dedupeWindowMs: 120,
    payload: { material: 'wood', breakable: true, broken: false },
  });

  const hollowPlays = backend.records.filter((r) => r.soundId === 'crate_impact_hollow');
  assert.equal(hollowPlays.length, 1);

  // Actual break -> wood_break
  engine.emitEvent({
    type: 'object.break',
    origin: 'player',
    simulationTimestamp: 1200,
    position: { x: 1, y: 1, z: 1 },
    payload: { material: 'wood', breakable: true, broken: true },
  });
  assert.ok(backend.records.some((r) => r.soundId === 'wood_break'));
});

test('post-rain roof dripping requires preceding rain, waterside splash distance gating works, and no duplicated thunder', () => {
  const { engine, realClock, backend } = createTestEngine();

  // Clear without preceding rain -> NO post-rain roof dripping; water > 100m -> NO splash
  engine.step(0.1, makeWorld({ simMs: 1000, weather: 'clear', precip: 'none', riverM: 300, waterM: 300, shelterM: 10, structure: { hasRoof: true } }));
  assert.equal(
    engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'roof_water_trickling')?.eligible,
    false
  );
  assert.equal(
    engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'occasional_waterside_splash')?.eligible,
    false
  );

  // Rain for 10 min then clear near shelter & water -> roof dripping & waterside splash become eligible
  realClock.advanceMs(500);
  engine.step(0.1, makeWorld({ simMs: 601_000, weather: 'rain', precip: 'rain', intensity: 0.8, riverM: 25, waterM: 25, shelterM: 10, structure: { hasRoof: true } }));
  realClock.advanceMs(500);
  engine.step(0.1, makeWorld({ simMs: 605_000, weather: 'clear', precip: 'none', riverM: 25, waterM: 25, shelterM: 10, structure: { hasRoof: true } }));

  assert.equal(
    engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'roof_water_trickling')?.eligible,
    true
  );
  assert.equal(
    engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'occasional_waterside_splash')?.eligible,
    true
  );

  // Embedded thunder suppresses standalone thunder_clap event & switches rain loop cleanly without duplicate thunder
  engine.step(0.1, makeWorld({ simMs: 606_000, weather: 'storm', precip: 'rain', intensity: 1, useEmbeddedThunder: true }));
  const beforeThunder = backend.records.filter((r) => r.soundId === 'thunder_clap').length;
  engine.emitEvent({
    type: 'weather.thunder',
    origin: 'environment',
    simulationTimestamp: 606_000,
    position: { x: 80, y: 40, z: 0 },
    intensity: 1,
    payload: {},
  });
  const afterThunder = backend.records.filter((r) => r.soundId === 'thunder_clap').length;
  assert.equal(afterThunder, beforeThunder, 'Embedded thunder should suppress standalone thunder_clap');
  assert.equal(
    engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'rain_embedded_thunder_loop')?.eligible,
    true
  );
});

test('disturbance suppression, exceptions, overlapping policies, independent recovery, and region departure/return', () => {
  const { engine, realClock, backend } = createTestEngine({ seed: 77 });
  engine.step(0.1, makeWorld({ simMs: 100_000, hour: 12, biome: 'forest' }));

  // Fire weapon at origin -> schedules gunshot_disturbance (activationDelayMs: 250ms, radius: 300m)
  engine.emitEvent({
    type: 'player.weapon.fire',
    origin: 'player',
    simulationTimestamp: 100_000,
    position: { x: 0, y: 1.7, z: 0 },
    intensity: 1,
    payload: {},
  });

  // Advance past 250ms activation delay
  realClock.advanceMs(350);
  engine.step(0.1, makeWorld({ simMs: 100_350, hour: 12, biome: 'forest' }));

  // Wildlife birds blocked by active gunshot disturbance
  const birdRule = engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'forest_birds_chirp');
  assert.equal(birdRule?.eligible, false);

  // Player footsteps (discrete wooden floor + continuous gravel walk) & startled bird escape remain exempt!
  engine.emitEvent({
    type: 'player.step',
    origin: 'player',
    simulationTimestamp: 100_360,
    position: { x: 0, y: 1.7, z: 0 },
    payload: { material: 'wooden_floor', gait: 'walk' },
  });
  engine.step(0.1, makeWorld({ simMs: 100_450, hour: 12, biome: 'forest', activity: 'walking', gait: 'walk', surface: 'gravel', distMoved: 2 }));
  engine.emitEvent({
    type: 'wildlife.bird.startled_gunshot',
    origin: 'environment',
    simulationTimestamp: 100_460,
    position: { x: 10, y: 4, z: 0 },
    payload: {},
  });
  assert.ok(backend.records.some((r) => r.soundId === 'wooden_floor_walk'));
  assert.ok(backend.records.some((r) => r.soundId === 'gravel_walk_loop'));
  assert.ok(backend.records.some((r) => r.soundId === 'bird_escaping_flight_gunshot'));

  // Departure > 300m away leaves disturbance zone -> birds eligible again; returning inside radius re-suppresses!
  realClock.advanceMs(50);
  engine.step(0.05, makeWorld({ simMs: 102_000, hour: 12, biome: 'forest', pos: { x: 320, y: 1.7, z: 0 } }));
  const farBirdRule = engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'forest_birds_chirp');
  assert.equal(farBirdRule?.eligible, true);

  realClock.advanceMs(50);
  engine.step(0.05, makeWorld({ simMs: 104_000, hour: 12, biome: 'forest', pos: { x: 10, y: 1.7, z: 0 } }));
  const returnedBirdRule = engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'forest_birds_chirp');
  assert.equal(returnedBirdRule?.eligible, false);

  // Overlapping thunder_disturbance adds a second distinct disturbance
  engine.emitEvent({
    type: 'weather.thunder',
    origin: 'environment',
    simulationTimestamp: 105_000,
    position: { x: 20, y: 40, z: 20 },
    intensity: 1,
    payload: {},
  });
  realClock.advanceMs(300);
  engine.step(0.1, makeWorld({ simMs: 105_300, hour: 12, biome: 'forest', pos: { x: 10, y: 1.7, z: 0 } }));
  assert.ok(engine.getDiagnosticsSnapshot().disturbances.length >= 2);

  // Insects (recoveryDelay 10-30s + fade 30s) recover before birds (recoveryDelay 3-5m + fade 2m)
  realClock.advanceMs(1000);
  engine.step(0.1, makeWorld({ simMs: 175_000, hour: 12, biome: 'forest', pos: { x: 10, y: 1.7, z: 0 } }));
  const suppAfter1Min = engine.disturbances.evaluateSuppression({
    soundId: 'bog_mosquitoes',
    busId: 'environment.wildlife.insects',
    tags: ['insects'],
    position: { x: 10, y: 1.7, z: 0 },
    simTimeMs: 175_000,
    mixer: engine.mixer,
  });
  const birdSuppAfter1Min = engine.disturbances.evaluateSuppression({
    soundId: 'forest_birds_chirp',
    busId: 'environment.wildlife.birds',
    tags: ['birds'],
    position: { x: 10, y: 1.7, z: 0 },
    simTimeMs: 175_000,
    mixer: engine.mixer,
  });
  assert.ok(suppAfter1Min.gainMultiplier > birdSuppAfter1Min.gainMultiplier);
});

test('reaction chain depth guard, voice budget eviction/virtualisation, music toggle, hot-reload, missing assets, and dispose', () => {
  const loopConfig: SoundscapeConfig = {
    ...DEFAULT_SOUNDSCAPE_CONFIG,
    engine: {
      ...DEFAULT_SOUNDSCAPE_CONFIG.engine,
      maxReactionChainDepth: 3,
      maxEventsPerChain: 4,
      maxActiveVoices: 4,
    },
    // Keep incidental wildlife from taking the slot this test expects wind to
    // regain once the auditioned one-shot has finished.
    sounds: DEFAULT_SOUNDSCAPE_CONFIG.sounds.map((sound) => sound.trigger.type === 'stochastic'
      ? { ...sound, schedule: { ...sound.schedule, probabilityPerAttempt: 0 } }
      : sound),
    reactions: [
      {
        id: 'infinite_loop_rx',
        event: 'custom.ping',
        probability: 1,
        emitEvent: { type: 'custom.ping' },
      },
    ],
  };

  const { engine, realClock, backend } = createTestEngine({ config: loopConfig });
  backend.markAssetMissing('wolf_howl_mp3');
  engine.step(0.1, makeWorld({ simMs: 1000, windSpeed: 0.7 }));

  engine.emitEvent({
    type: 'custom.ping',
    origin: 'environment',
    simulationTimestamp: 1000,
    payload: {},
  });
  const pings = engine.eventBus.getTraceHistory().filter((e) => e.type === 'custom.ping');
  assert.ok(pings.length <= 5, `Chain guard failed, dispatched ${pings.length} pings`);

  // Auditioning sounds respects maxActiveVoices budget & handles missing assets cleanly without throwing
  assert.equal(engine.auditionSound('nonexistent_sound'), false);
  assert.equal(engine.auditionSound('wooden_floor_walk'), true);
  assert.equal(engine.auditionSound('wolf_howl'), true);
  const diagBudget = engine.getDiagnosticsSnapshot();
  assert.ok(diagBudget.activeCount <= 4, `Active voices exceeded maxActiveVoices=4: ${diagBudget.activeCount}`);

  // Music disable stops music independently while transient voices finish & virtualised wind_open automatically resumes
  engine.setMusicEnabled(false);
  const howlDurationSec = loopConfig.assets.find((asset) => asset.id === 'wolf_howl_mp3')!.durationSec!;
  const recoverySteps = Math.ceil((howlDurationSec / 0.97 + 2) / 0.25);
  for (let i = 0; i < recoverySteps; i++) {
    realClock.advanceMs(250);
    engine.step(0.25, makeWorld({ simMs: 1200 + i * 250, windSpeed: 0.9 }));
  }
  assert.equal(engine.getDiagnosticsSnapshot().music.enabled, false);
  assert.ok(backend.records.some((r) => r.soundId === 'wind_open' && !r.stopped), JSON.stringify(engine.getDiagnosticsSnapshot().voices));

  // Invalid hot reload preserves valid config
  const badRes = engine.reloadConfigFromJson('{ invalid json');
  assert.equal(badRes.ok, false);
  assert.ok(badRes.issues.length > 0);
  assert.ok(engine.getConfig().sounds.length > 5);

  // Valid hot reload updates config cleanly
  const validClone = JSON.parse(JSON.stringify(engine.getRawConfig())) as SoundscapeConfig;
  validClone.engine.maxActiveVoices = 12;
  const okRes = engine.reloadConfigFromJson(JSON.stringify(validClone));
  assert.equal(okRes.ok, true);
  assert.equal(engine.getConfig().engine.maxActiveVoices, 12);

  engine.dispose();
  assert.equal(backend.disposed, true);
  assert.ok(backend.records.every((r) => r.stopped));
});

for (const pitch of [0.5, 1, 2]) {
  test(`one-shot reserves its slot for the entire clip at pitch ${pitch}`, () => {
    const config = structuredClone(DEFAULT_SOUNDSCAPE_CONFIG);
    config.assets = [{ id: 'test_clip', file: 'test-clip.mp3', durationSec: 4 }];
    config.sounds = [{
      id: 'test_one_shot',
      bus: 'player.movement',
      trigger: { type: 'event', event: 'test.play' },
      assets: [{ assetId: 'test_clip' }],
      playback: { pitch, maxInstances: 1, concurrencyPolicy: 'reject_new' },
      spatial: { mode: 'non_spatial' },
    }];
    config.materials = [];
    config.biomes = [];
    config.reactions = [];
    config.disturbances = [];
    config.music = [];
    const { engine, realClock, backend } = createTestEngine({ config });
    engine.step(0, makeWorld({ simMs: 1000 }));
    assert.equal(engine.auditionSound('test_one_shot'), true);

    // Playback follows real time, even when the simulation runs much faster.
    const playbackSec = 4 / pitch;
    const stepSec = 0.05;
    const steps = Math.round(playbackSec / stepSec);
    for (let i = 1; i < steps; i++) {
      realClock.advanceMs(stepSec * 1000);
      engine.step(stepSec, makeWorld({ simMs: 1000 + i * 10000, timeAccel: 200 }));
    }
    assert.equal(backend.records[0].stopped, false, 'Clip must finish before its slot is released');
    assert.equal(engine.auditionSound('test_one_shot'), false, 'Concurrent trigger must be rejected');
    realClock.advanceMs(stepSec * 2000);
    engine.step(stepSec * 2, makeWorld({ simMs: 1000 + (steps + 1) * 10000, timeAccel: 200 }));
    assert.equal(backend.records[0].stopped, true);
    assert.equal(engine.auditionSound('test_one_shot'), true, 'Slot becomes available after playback');
    engine.dispose();
  });
}

test('plank trail, swamp mud, shallow water, and swimming use distinct sounds and swimming stops in shallow water', () => {
  const { engine, realClock, backend } = createTestEngine();

  let dist = 0;

  // 1. Walking on plank trail (wooden_boardwalk) -> wooden_floor_walk
  dist += 2.0;
  realClock.advanceMs(100);
  engine.step(
    0.1,
    makeWorld({
      simMs: 1000,
      activity: 'walking',
      gait: 'walk',
      surface: 'wooden_boardwalk',
      distMoved: dist,
    })
  );
  assert.ok(backend.records.some((r) => r.soundId === 'wooden_floor_walk'));

  // 2. Wading in swamp mud -> swamp_mud_wade (distinct from plank trail and water!)
  dist += 2.0;
  realClock.advanceMs(100);
  engine.step(
    0.1,
    makeWorld({
      simMs: 1200,
      activity: 'wading',
      gait: 'wade',
      surface: 'mud',
      distMoved: dist,
    })
  );
  assert.ok(backend.records.some((r) => r.soundId === 'swamp_mud_wade'));
  assert.equal(
    backend.records.some((r) => r.soundId === 'water_wade_loop'),
    false,
    'Swamp mud wading must NOT reuse the open-water wading sound'
  );

  // 3. Swimming in deep water -> water_swim_loop
  dist += 1.0;
  realClock.advanceMs(100);
  engine.step(
    0.1,
    makeWorld({
      simMs: 1400,
      activity: 'swimming',
      gait: 'swim',
      surface: 'water',
      distMoved: dist,
    })
  );
  const swimLoop = backend.records.find((r) => r.soundId === 'water_swim_loop');
  assert.ok(swimLoop, 'Expected dedicated water_swim_loop when swimming');
  assert.equal(swimLoop.stopped, false);

  // 4. Moving into shallow water (still in water, not swimming) -> stops water_swim_loop immediately and switches to water_wade_loop
  dist += 1.0;
  realClock.advanceMs(100);
  engine.step(
    0.1,
    makeWorld({
      simMs: 1600,
      activity: 'wading',
      gait: 'wade',
      surface: 'water',
      distMoved: dist,
    })
  );
  assert.equal(
    swimLoop.stopped,
    true,
    'Swimming sound must stop immediately when entering shallow water'
  );
  const shallowWadeLoop = backend.records.find((r) => r.soundId === 'water_wade_loop');
  assert.ok(shallowWadeLoop, 'Expected water_wade_loop when wading in shallow water');
  assert.equal(shallowWadeLoop.stopped, false);

  // 5. Stopping movement in shallow water -> stops water_wade_loop
  realClock.advanceMs(100);
  engine.step(
    0.1,
    makeWorld({
      simMs: 1800,
      activity: 'idle',
      gait: null,
      surface: 'water',
      distMoved: dist,
    })
  );
  assert.equal(shallowWadeLoop.stopped, true);
  engine.dispose();
});

test('engine gates gait loops and walking physiology on actual motion even when activity is crouching', () => {
  const { engine, backend, realClock } = createTestEngine();
  try {
    // Direct WorldContext with activity: 'crouching' but zero speed and zero distance delta
    for (let i = 0; i < 4; i++) {
      realClock.advanceMs(100);
      engine.step(
        0.1,
        makeWorld({
          simMs: 1000 + i * 100,
          activity: 'crouching',
          gait: 'crouch',
          speedMps: 0,
          distMoved: 0,
          surface: 'gravel',
        })
      );
    }
    assert.equal(backend.records.filter((r) => r.soundId === 'gravel_walk_loop').length, 0);
    assert.ok(backend.records.some((r) => r.soundId === 'breathing_rest' && !r.stopped));
    assert.equal(backend.records.filter((r) => r.soundId === 'breathing_walk').length, 0);

    // Moving while crouching starts gravel_walk_loop, then stopping pauses it
    for (let i = 0; i < 3; i++) {
      realClock.advanceMs(100);
      engine.step(
        0.1,
        makeWorld({
          simMs: 1500 + i * 100,
          activity: 'crouching',
          gait: 'crouch',
          speedMps: 2.5,
          isMoving: true,
          distMoved: (i + 1) * 0.25,
          surface: 'gravel',
        })
      );
    }
    const gravelLoop = backend.records.find((r) => r.soundId === 'gravel_walk_loop');
    assert.ok(gravelLoop && !gravelLoop.stopped);

    for (let i = 0; i < 4; i++) {
      realClock.advanceMs(100);
      engine.step(
        0.1,
        makeWorld({
          simMs: 1900 + i * 100,
          activity: 'crouching',
          gait: 'crouch',
          speedMps: 0,
          isMoving: false,
          distMoved: 0.75,
          surface: 'gravel',
        })
      );
    }
    assert.ok(
      gravelLoop.stopped || engine.getDiagnosticsSnapshot().voices.every((v) => v.soundId !== 'gravel_walk_loop' || v.state !== 'playing')
    );
  } finally {
    engine.dispose();
  }
});

test('physical impacts route through one soundscape voice with bus mute/gain, spatial occlusion, and detached fallback', () => {
  const occludedCollider = { occluded: false };
  const spatialQuery: SpatialQueryProvider = {
    findPointOnFeature: () => null,
    computeOcclusionFactor: () => (occludedCollider.occluded ? 0.8 : 0),
  };
  const { engine, backend, realClock } = createTestEngine({ spatialQuery });
  try {
    // 1. Single prop collision creates one intended material-specific voice with spatial & bus metadata
    const nearPos = { x: 2, y: 0.4, z: 0 };
    const farPos = { x: 24, y: 0.4, z: 0 };
    engine.step(0.05, makeWorld({ simMs: 100, pos: { x: 0, y: 1.7, z: 0 } }));
    engine.emitEvent({
      type: 'object.impact',
      origin: 'environment',
      simulationTimestamp: 120,
      position: nearPos,
      intensity: 0.85,
      correlationId: 'prop_fall_1',
      dedupeKey: 'prop_fall_1',
      dedupeWindowMs: 120,
      payload: { material: 'stone', breakable: false, broken: false },
    });
    const nearHits = backend.records.filter((r) => r.soundId === 'stone_impact_solid');
    assert.equal(nearHits.length, 1);
    assert.equal(nearHits[0].busId, 'objects');
    assert.equal(nearHits[0].spatialMode, 'world');
    assert.deepEqual(nearHits[0].initialPosition, nearPos);
    realClock.advanceMs(50);
    engine.step(0.05, makeWorld({ simMs: 170, pos: { x: 0, y: 1.7, z: 0 } }));
    const clearGain = nearHits[0].gainHistory.at(-1) ?? 0;
    const clearLowpass = nearHits[0].lowpassHistory.at(-1) ?? 20000;
    assert.ok(clearGain > 0, `Expected non-zero near impact gain, got ${clearGain}`);

    // Occluded distant impact reduces gain and lowpass via spatial acoustics
    occludedCollider.occluded = true;
    engine.emitEvent({
      type: 'object.impact',
      origin: 'environment',
      simulationTimestamp: 320,
      position: farPos,
      intensity: 0.85,
      correlationId: 'prop_fall_2',
      dedupeKey: 'prop_fall_2',
      dedupeWindowMs: 120,
      payload: { material: 'stone', breakable: false, broken: false },
    });
    const allStoneHits = backend.records.filter((r) => r.soundId === 'stone_impact_solid');
    assert.equal(allStoneHits.length, 2);
    assert.deepEqual(allStoneHits[1].initialPosition, farPos);
    realClock.advanceMs(50);
    engine.step(0.05, makeWorld({ simMs: 370, pos: { x: 0, y: 1.7, z: 0 } }));
    assert.ok((allStoneHits[1].lowpassHistory.at(-1) ?? 20000) < clearLowpass);

    // Objects bus gain & mute consistently affect impact voices
    occludedCollider.occluded = false;
    engine.mixer.setBusVolume('objects', 0.25);
    engine.emitEvent({
      type: 'object.impact',
      origin: 'environment',
      simulationTimestamp: 500,
      position: nearPos,
      intensity: 0.9,
      dedupeKey: 'prop_fall_scaled',
      dedupeWindowMs: 120,
      payload: { material: 'metal', breakable: false, broken: false },
    });
    const scaledMetal = backend.records.find((r) => r.soundId === 'metal_impact_solid');
    assert.ok(scaledMetal);
    realClock.advanceMs(50);
    engine.step(0.05, makeWorld({ simMs: 550, pos: { x: 0, y: 1.7, z: 0 } }));
    assert.ok((scaledMetal.gainHistory.at(-1) ?? 1) < clearGain);

    engine.mixer.setBusMuted('objects', true);
    engine.emitEvent({
      type: 'object.impact',
      origin: 'environment',
      simulationTimestamp: 650,
      position: nearPos,
      intensity: 0.9,
      dedupeKey: 'prop_fall_muted',
      dedupeWindowMs: 120,
      payload: { material: 'wood', breakable: false, broken: false },
    });
    const mutedWood = backend.records.find((r) => r.soundId === 'wood_impact_solid');
    assert.ok(mutedWood);
    realClock.advanceMs(50);
    engine.step(0.05, makeWorld({ simMs: 700, pos: { x: 0, y: 1.7, z: 0 } }));
    assert.equal(mutedWood.gainHistory.at(-1) ?? 0, 0);

    // 2. SoundEngine fallback only synthesizes when SoundscapeEngine is detached
    const soundFacade = new SoundEngine();
    let fallbackSynthCalls = 0;
    soundFacade.playImpact = () => {
      fallbackSynthCalls++;
    };
    soundFacade.playPhysicalImpactFallback(0.8);
    assert.equal(fallbackSynthCalls, 1, 'Detached SoundEngine should invoke legacy synth fallback');

    soundFacade.attachSoundscapeEngine(engine, backend as never);
    soundFacade.playPhysicalImpactFallback(0.8);
    assert.equal(fallbackSynthCalls, 1, 'Attached SoundEngine must suppress duplicate legacy impact synth');
  } finally {
    engine.dispose();
  }
});

test('walking and water wading loops resume cleanly after pausing instead of staying stuck on paused', () => {
  const { engine, realClock, backend } = createTestEngine();

  let dist = 0;
  let simMs = 1000;
  const stepWalk = (
    activity: WorldContext['player']['activity'],
    gait: WorldContext['player']['gait'],
    surface: WorldContext['player']['surfaceMaterial'],
    deltaDist: number
  ) => {
    dist += deltaDist;
    simMs += 100;
    realClock.advanceMs(100);
    engine.step(
      0.1,
      makeWorld({
        simMs,
        activity,
        gait,
        surface,
        distMoved: dist,
        biome: surface === 'water' || surface === 'mud' ? 'swamp' : 'forest',
      })
    );
  };

  // 1. Walk on forest floor -> plays forest_floor_walk
  stepWalk('walking', 'walk', 'forest_floor', 0.5);
  stepWalk('walking', 'walk', 'forest_floor', 0.5);
  let walkVoice = engine.getDiagnosticsSnapshot().voices.find((v) => v.soundId === 'forest_floor_walk');
  assert.ok(walkVoice && (walkVoice.state === 'starting' || walkVoice.state === 'playing'));

  // 2. Stop -> pauses forest_floor_walk
  stepWalk('idle', null, 'forest_floor', 0);
  walkVoice = engine.getDiagnosticsSnapshot().voices.find((v) => v.soundId === 'forest_floor_walk');
  assert.equal(walkVoice?.state, 'paused');

  // 3. Walk again -> MUST resume out of 'paused' and start a fresh backend voice
  const beforeForestRecords = backend.records.filter((r) => r.soundId === 'forest_floor_walk').length;
  stepWalk('walking', 'walk', 'forest_floor', 0.5);
  stepWalk('walking', 'walk', 'forest_floor', 0.5);
  walkVoice = engine.getDiagnosticsSnapshot().voices.find((v) => v.soundId === 'forest_floor_walk');
  assert.ok(
    walkVoice && (walkVoice.state === 'starting' || walkVoice.state === 'playing'),
    `forest_floor_walk remained stuck in state=${walkVoice?.state}`
  );
  const forestRecordsAfter = backend.records.filter((r) => r.soundId === 'forest_floor_walk');
  assert.ok(forestRecordsAfter.length > beforeForestRecords);
  assert.equal(forestRecordsAfter.at(-1)?.stopped, false);

  // 4. Repeatedly enter water -> exit to bog mud (triggers swamp_mud_wade) -> re-enter water -> swim -> exit
  for (let cycle = 0; cycle < 4; cycle++) {
    // Enter shallow water
    stepWalk('wading', 'wade', 'water', 0.5);
    stepWalk('wading', 'wade', 'water', 0.5);
    const wadeVoice = engine.getDiagnosticsSnapshot().voices.find((v) => v.soundId === 'water_wade_loop');
    assert.ok(
      wadeVoice && (wadeVoice.state === 'starting' || wadeVoice.state === 'playing'),
      `Cycle ${cycle}: water_wade_loop stuck in state=${wadeVoice?.state}`
    );
    const activeWadeRec = backend.records.filter((r) => r.soundId === 'water_wade_loop').at(-1);
    assert.equal(activeWadeRec?.stopped, false, `Cycle ${cycle}: water_wade_loop backend voice must be playing`);

    // Swim deeper then return to shallow
    stepWalk('swimming', 'swim', 'water', 0.5);
    const swimVoice = engine.getDiagnosticsSnapshot().voices.find((v) => v.soundId === 'water_swim_loop');
    assert.ok(
      swimVoice && (swimVoice.state === 'starting' || swimVoice.state === 'playing'),
      `Cycle ${cycle}: water_swim_loop stuck in state=${swimVoice?.state}`
    );

    // Exit onto bog mud -> pauses water loops and fires swamp_mud_wade without freezing
    const mudCountBefore = backend.records.filter((r) => r.soundId === 'swamp_mud_wade').length;
    stepWalk('wading', 'wade', 'mud', 1.6);
    stepWalk('wading', 'wade', 'mud', 1.6);
    const mudCountAfter = backend.records.filter((r) => r.soundId === 'swamp_mud_wade').length;
    assert.ok(
      mudCountAfter > mudCountBefore,
      `Cycle ${cycle}: expected swamp_mud_wade to play on bog mud exit`
    );

    // Pause briefly on shore
    stepWalk('idle', null, 'mud', 0);
  }

  engine.dispose();
});

test('queued concurrencyPolicy on a saturated bus never freezes step() and recovers when slots free', () => {
  const config = structuredClone(DEFAULT_SOUNDSCAPE_CONFIG);
  const movementBus = config.buses.find((b) => b.id === 'player.movement');
  assert.ok(movementBus);
  movementBus.maxConcurrency = 1;

  const { engine, realClock, backend } = createTestEngine({ config });

  // Occupy the single player.movement slot with forest_floor_walk
  let simMs = 1000;
  engine.step(
    0.1,
    makeWorld({
      simMs,
      activity: 'walking',
      gait: 'walk',
      surface: 'forest_floor',
      distMoved: 1.0,
    })
  );

  // Trigger swamp_mud_wade (which has concurrencyPolicy: 'queue') while the bus is full
  engine.emitEvent({
    type: 'player.step',
    origin: 'player',
    simulationTimestamp: simMs,
    position: { x: 0, y: 1.7, z: 0 },
    payload: { material: 'mud', gait: 'wade' },
  });

  // Stepping repeatedly while bus remains full (< 160ms maxQueueAgeMs) must NEVER infinite-loop
  for (let i = 0; i < 2; i++) {
    realClock.advanceMs(40);
    simMs += 40;
    engine.step(
      0.04,
      makeWorld({
        simMs,
        activity: 'walking',
        gait: 'walk',
        surface: 'forest_floor',
        distMoved: 1.0 + i * 0.2,
      })
    );
  }
  assert.equal(engine.instances.getQueuedCount(), 1, 'swamp_mud_wade should remain queued while bus is busy');

  // Free the bus slot by going idle within 160ms -> queued swamp_mud_wade dequeues and plays cleanly
  realClock.advanceMs(40);
  simMs += 40;
  engine.step(
    0.04,
    makeWorld({
      simMs,
      activity: 'idle',
      gait: null,
      surface: 'mud',
      distMoved: 2.0,
    })
  );

  assert.ok(
    backend.records.some((r) => r.soundId === 'swamp_mud_wade'),
    'Queued swamp_mud_wade should play once the movement bus slot frees up within maxQueueAgeMs'
  );

  // Now saturate the bus again and hold past maxQueueAgeMs (160ms) -> must expire cleanly without freezing
  const mudCountBeforeExpiry = backend.records.filter((r) => r.soundId === 'swamp_mud_wade').length;
  realClock.advanceMs(500);
  simMs += 500;
  engine.step(
    0.1,
    makeWorld({
      simMs,
      activity: 'walking',
      gait: 'walk',
      surface: 'forest_floor',
      distMoved: 2.5,
    })
  );
  engine.emitEvent({
    type: 'player.step',
    origin: 'player',
    simulationTimestamp: simMs,
    position: { x: 0, y: 1.7, z: 0 },
    payload: { material: 'mud', gait: 'wade' },
  });
  for (let i = 0; i < 6; i++) {
    realClock.advanceMs(50);
    simMs += 50;
    engine.step(
      0.05,
      makeWorld({
        simMs,
        activity: 'walking',
        gait: 'walk',
        surface: 'forest_floor',
        distMoved: 2.5 + i * 0.2,
      })
    );
  }
  assert.equal(engine.instances.getQueuedCount(), 0, 'Expired queued item must be dropped after maxQueueAgeMs');
  assert.equal(
    backend.records.filter((r) => r.soundId === 'swamp_mud_wade').length,
    mudCountBeforeExpiry,
    'Expired swamp_mud_wade must not play stale after maxQueueAgeMs'
  );
  engine.dispose();
});

test('stopMovementLoops immediately stops active walking, gravel, wading, and swimming loops on collapse', () => {
  const { engine, realClock, backend } = createTestEngine();

  const cases: Array<{
    soundId: string;
    activity: WorldContext['player']['activity'];
    gait: WorldContext['player']['gait'];
    surface: WorldContext['player']['surfaceMaterial'];
  }> = [
    { soundId: 'forest_floor_walk', activity: 'walking', gait: 'walk', surface: 'forest_floor' },
    { soundId: 'gravel_walk_loop', activity: 'walking', gait: 'walk', surface: 'gravel' },
    { soundId: 'water_wade_loop', activity: 'wading', gait: 'wade', surface: 'water' },
    { soundId: 'water_swim_loop', activity: 'swimming', gait: 'swim', surface: 'water' },
  ];

  let simMs = 1000;
  let dist = 0;
  for (const c of cases) {
    dist += 1.2;
    simMs += 100;
    realClock.advanceMs(100);
    engine.step(
      0.1,
      makeWorld({
        simMs,
        activity: c.activity,
        gait: c.gait,
        surface: c.surface,
        distMoved: dist,
        biome: c.surface === 'water' ? 'swamp' : 'forest',
      })
    );

    const activeRec = backend.records.filter((r) => r.soundId === c.soundId).at(-1);
    assert.ok(activeRec, `Expected ${c.soundId} to start while moving`);
    assert.equal(activeRec.stopped, false, `Expected ${c.soundId} to be playing before collapse`);

    // Simulate sudden loss of consciousness (stopMovementLoops without waiting for another step)
    engine.stopMovementLoops(true);
    assert.equal(
      activeRec.stopped,
      true,
      `${c.soundId} MUST stop immediately when stopMovementLoops(true) is called on collapse`
    );

    // Stepping during collapsing with idle locomotion must keep the movement loop silent
    simMs += 100;
    realClock.advanceMs(100);
    const countBeforeIdle = backend.records.filter((r) => r.soundId === c.soundId).length;
    engine.step(
      0.1,
      makeWorld({
        simMs,
        activity: 'idle',
        gait: null,
        surface: c.surface,
        distMoved: dist,
        biome: c.surface === 'water' ? 'swamp' : 'forest',
      })
    );
    assert.equal(
      backend.records.filter((r) => r.soundId === c.soundId).length,
      countBeforeIdle,
      `${c.soundId} must not restart during idle collapse`
    );
  }

  // After waking/restarting, moving again resumes movement loops cleanly
  dist += 1.2;
  simMs += 100;
  realClock.advanceMs(100);
  engine.step(
    0.1,
    makeWorld({
      simMs,
      activity: 'walking',
      gait: 'walk',
      surface: 'forest_floor',
      distMoved: dist,
    })
  );
  const resumed = backend.records.filter((r) => r.soundId === 'forest_floor_walk').at(-1);
  assert.ok(resumed && resumed.stopped === false, 'Movement loop should resume cleanly after restart');

  engine.dispose();
});

test('player.fall triggers distinct surface sounds, selects heavy splash on high drops, and supports custom distance/surface rules', () => {
  const customConfig: SoundscapeConfig = {
    ...DEFAULT_SOUNDSCAPE_CONFIG,
    sounds: [
      ...DEFAULT_SOUNDSCAPE_CONFIG.sounds,
      {
        id: 'custom_high_stone_drop',
        bus: 'player.movement',
        trigger: { type: 'event', event: 'player.fall' },
        conditions: {
          all: [
            { 'event.surface': { eq: 'stone' } },
            { 'event.distanceM': { gte: 1.2 } },
          ],
        },
        assets: [{ assetId: 'proc_fall_land_stone' }],
        playback: { volume: 0.9, maxInstances: 2, concurrencyPolicy: 'replace_oldest' },
        spatial: { mode: 'non_spatial' },
      },
    ],
  };

  const { engine, realClock, backend } = createTestEngine({ config: customConfig });
  let simMs = 5000;
  engine.step(0.1, makeWorld({ simMs }));

  // 1. Small bank drop-in into bog lake water (0.35m) -> player_fall_water
  engine.emitEvent({
    type: 'player.fall',
    origin: 'player',
    simulationTimestamp: simMs,
    position: { x: 0, y: -0.35, z: 0 },
    intensity: 0.65,
    payload: { distanceM: 0.35, surface: 'water', material: 'water', fromJump: false },
  });
  const smallWaterSplash = backend.records.find((r) => r.soundId === 'player_fall_water');
  assert.ok(smallWaterSplash, 'Expected player_fall_water on small bog bank drop-in');
  assert.equal(
    backend.records.some((r) => r.soundId === 'player_fall_water_heavy'),
    false,
    'Small bank drop should not trigger heavy plunge splash'
  );

  // 2. High jump plunge into bog lake water (1.45m) -> player_fall_water_heavy
  simMs += 400;
  realClock.advanceMs(400);
  engine.step(0.1, makeWorld({ simMs }));
  engine.emitEvent({
    type: 'player.fall',
    origin: 'player',
    simulationTimestamp: simMs,
    position: { x: 0, y: -0.35, z: 0 },
    intensity: 1.1,
    payload: { distanceM: 1.45, surface: 'water', material: 'water', fromJump: true },
  });
  assert.ok(
    backend.records.some((r) => r.soundId === 'player_fall_water_heavy'),
    'Expected player_fall_water_heavy on high jump plunge into water'
  );

  // 3. Stepping/jumping down onto different solid surfaces resolves distinct configured sounds
  const surfaceExpectations: Array<{
    surface: WorldContext['player']['surfaceMaterial'];
    distanceM: number;
    expectedSoundId: string;
  }> = [
    { surface: 'stone', distanceM: 0.6, expectedSoundId: 'player_fall_stone' },
    { surface: 'gravel', distanceM: 0.7, expectedSoundId: 'player_fall_stone' },
    { surface: 'wooden_boardwalk', distanceM: 0.65, expectedSoundId: 'player_fall_wood' },
    { surface: 'mud', distanceM: 0.55, expectedSoundId: 'player_fall_mud' },
    { surface: 'forest_floor', distanceM: 0.6, expectedSoundId: 'player_fall_forest' },
  ];

  for (const item of surfaceExpectations) {
    simMs += 400;
    realClock.advanceMs(400);
    engine.step(0.1, makeWorld({ simMs }));
    const before = backend.records.filter((r) => r.soundId === item.expectedSoundId).length;
    engine.emitEvent({
      type: 'player.fall',
      origin: 'player',
      simulationTimestamp: simMs,
      position: { x: 2, y: 1, z: 2 },
      payload: { distanceM: item.distanceM, surface: item.surface, material: item.surface },
    });
    const after = backend.records.filter((r) => r.soundId === item.expectedSoundId).length;
    assert.ok(
      after > before,
      `Expected player.fall on ${item.surface} (${item.distanceM}m) to trigger ${item.expectedSoundId}`
    );
  }

  // 4. Custom declarative rule filtering event.surface === 'stone' && event.distanceM >= 1.2
  assert.equal(
    backend.records.some((r) => r.soundId === 'custom_high_stone_drop'),
    false,
    '0.6m stone drop must not trigger custom >=1.2m rule'
  );
  simMs += 400;
  realClock.advanceMs(400);
  engine.step(0.1, makeWorld({ simMs }));
  engine.emitEvent({
    type: 'player.fall',
    origin: 'player',
    simulationTimestamp: simMs,
    position: { x: 2, y: 1, z: 2 },
    payload: { distanceM: 1.5, surface: 'stone', material: 'stone' },
  });
  assert.ok(
    backend.records.some((r) => r.soundId === 'custom_high_stone_drop'),
    'Expected custom declarative player.fall rule to fire on 1.5m stone drop'
  );

  engine.dispose();
});

test('wolf_howl resolves distinct per-night quotas across consecutive nights and resetQuotasAndCooldowns clears limits', () => {
  const { engine, realClock, backend } = createTestEngine({ seed: 2026 });

  // Night 1 (Day 0): 23:05 -> 03:55
  let simMs = 23.08 * 3600_000;
  for (let i = 0; i < 95; i++) {
    realClock.advanceMs(3000);
    simMs += 180_000; // 3m steps
    const hr = (simMs / 3600_000) % 24;
    engine.step(0.1, makeWorld({ simMs, hour: hr, biome: 'forest' }));
  }
  const night1Plays = backend.records.filter((r) => r.soundId === 'wolf_howl').length;
  assert.ok(
    night1Plays >= 1 && night1Plays <= 2,
    `Expected 1..2 wolf howls on Night 1, got ${night1Plays}`
  );

  // Advance to Night 2 (24h later): must NOT be stuck in all_time quota!
  simMs = 24 * 3600_000 + 23.08 * 3600_000;
  for (let i = 0; i < 95; i++) {
    realClock.advanceMs(3000);
    simMs += 180_000;
    const hr = (simMs / 3600_000) % 24;
    engine.step(0.1, makeWorld({ simMs, day: 2, hour: hr, biome: 'forest' }));
  }
  const totalAfterNight2 = backend.records.filter((r) => r.soundId === 'wolf_howl').length;
  assert.ok(
    totalAfterNight2 > night1Plays,
    `Expected wolf_howl to trigger again on Night 2 (night1=${night1Plays}, totalAfterNight2=${totalAfterNight2})`
  );

  // Clearing quotas resets window counters and cooldowns cleanly
  engine.resetQuotasAndCooldowns();
  const wolfRule = engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'wolf_howl');
  assert.equal(wolfRule?.quotaUsed, 0);
  assert.equal(wolfRule?.cooldownRemainingSimSec, 0);

  engine.dispose();
});

test('F9 auditionSound plays unobstructed near-listener previews across loops/features/indoors and stopAuditionSounds halts only auditions', () => {
  const { engine, realClock, backend } = createTestEngine({ seed: 101 });

  // Closed wooden house + gunshot disturbance + daytime forest + missing water feature
  const simMs = 12 * 3600_000;
  engine.step(
    0.1,
    makeWorld({
      simMs,
      hour: 12,
      biome: 'forest',
      windSpeed: 0.7,
      structure: {
        id: 'house_1',
        quality: 'warm_house',
        profileId: 'wooden_house',
        enclosure: 0.92,
        roofCoverage: 1,
        hasRoof: true,
        portalOpenness: 0.05,
      },
    })
  );

  // Trigger gunshot disturbance near listener
  engine.emitEvent({
    type: 'player.weapon.fire',
    origin: 'player',
    simulationTimestamp: simMs,
    position: { x: 0, y: 1.7, z: 0 },
    intensity: 1,
    payload: {},
  });
  realClock.advanceMs(300);
  engine.step(
    0.1,
    makeWorld({
      simMs: simMs + 300,
      hour: 12,
      biome: 'forest',
      structure: {
        id: 'house_1',
        quality: 'warm_house',
        profileId: 'wooden_house',
        enclosure: 0.92,
        roofCoverage: 1,
        hasRoof: true,
        portalOpenness: 0.05,
      },
    })
  );

  // Audition:
  // 1) distant spatial nocturnal sound (wolf_howl)
  // 2) feature-bound sound with no spatialQuery water point (occasional_waterside_splash)
  // 3) continuous ambient loop (wind_open) even though live wind_open is already active
  // 4) movement gait loop (forest_floor_walk) while idle indoors
  assert.equal(engine.auditionSound('wolf_howl'), true);
  assert.equal(engine.auditionSound('occasional_waterside_splash'), true);
  assert.equal(engine.auditionSound('wind_open'), true);
  assert.equal(engine.auditionSound('forest_floor_walk'), true);

  const diag = engine.getDiagnosticsSnapshot();
  const auditions = diag.voices.filter((v) => v.isAudition);
  assert.equal(auditions.length, 4);
  for (const v of auditions) {
    assert.equal(v.spatialMode, 'non_spatial', `${v.soundId} audition must be non_spatial`);
    assert.equal(v.distanceM, null, `${v.soundId} audition must be near-listener`);
    assert.equal(v.lowpassHz, 20000, `${v.soundId} audition must bypass indoor muffling`);
    assert.ok(v.effectiveGain >= 0.35, `${v.soundId} audition gain too low: ${v.effectiveGain}`);
  }

  // Subsequent gameplay steps (even switching to night & idle) must NOT stop active loop auditions!
  realClock.advanceMs(200);
  engine.step(0.2, makeWorld({ simMs: simMs + 500, hour: 23, biome: 'swamp', activity: 'idle' }));
  const afterStepAuditions = engine.getDiagnosticsSnapshot().voices.filter((v) => v.isAudition);
  assert.ok(afterStepAuditions.some((v) => v.soundId === 'wind_open'));
  assert.ok(afterStepAuditions.some((v) => v.soundId === 'forest_floor_walk'));

  // Paused F9 stepping advances finite audition clips without affecting non-audition voices
  for (let i = 0; i < 45; i++) {
    realClock.advanceMs(200);
    engine.stepAuditionVoices(0.2);
  }
  const postPauseAuditions = engine.getDiagnosticsSnapshot().voices.filter((v) => v.isAudition);
  assert.equal(
    postPauseAuditions.some((v) => v.soundId === 'wolf_howl'),
    false,
    'Finite wolf_howl audition should complete during paused stepAuditionVoices'
  );
  assert.equal(
    postPauseAuditions.some((v) => v.soundId === 'wind_open'),
    true,
    'Infinite loop wind_open audition should keep playing until stopped'
  );

  // Explicit Stop halts remaining audition previews while preserving live ambience
  const stoppedCount = engine.stopAuditionSounds();
  assert.ok(stoppedCount >= 2);
  assert.equal(
    engine.getDiagnosticsSnapshot().voices.filter((v) => v.isAudition).length,
    0
  );
  const liveWind = backend.records.find(
    (r) => r.soundId === 'wind_open' && !r.stopped
  );
  assert.ok(liveWind, 'Live gameplay wind_open must stay running after stopAuditionSounds');

  engine.dispose();
});

test('Voice pause/resume locks out autoResume while paused and stopped voices stay visible for 5 seconds', () => {
  const realClock = new ManualClock(50_000);
  const backend = new MockAudioBackend();
  const engine = new SoundscapeEngine({
    config: DEFAULT_SOUNDSCAPE_CONFIG,
    backend,
    realClock,
    rng: new SeededRng(42),
  });

  let simMs = 2000;
  engine.step(0.25, makeWorld({ simMs, hour: 10, biome: 'forest', windSpeed: 0.45 }));

  const diag1 = engine.getDiagnosticsSnapshot();
  const windVoice = diag1.voices.find((v) => v.soundId === 'wind_open');
  assert.ok(windVoice, 'Expected active wind_open voice');

  // Pause the voice manually
  assert.equal(engine.pauseVoice(windVoice.instanceId), true);
  const afterPause = engine.getDiagnosticsSnapshot();
  const pausedWind = afterPause.voices.find((v) => v.instanceId === windVoice.instanceId);
  assert.ok(pausedWind);
  assert.equal(pausedWind.state, 'paused');
  assert.equal(pausedWind.userPaused, true);
  const backendWind = backend.records.find((r) => r.instanceId === windVoice.instanceId);
  assert.equal(backendWind?.paused, true);

  // Subsequent simulation ticks must NOT auto-resume a userPaused voice
  simMs += 400;
  realClock.advanceMs(400);
  engine.step(0.4, makeWorld({ simMs, hour: 10, biome: 'forest', windSpeed: 0.6 }));
  const stillPaused = engine
    .getDiagnosticsSnapshot()
    .voices.find((v) => v.instanceId === windVoice.instanceId);
  assert.equal(stillPaused?.state, 'paused');
  assert.equal(stillPaused?.userPaused, true);

  // Explicit resume restores active pre-pause state ('starting' or 'playing')
  assert.equal(engine.resumeVoice(windVoice.instanceId), true);
  const resumed = engine
    .getDiagnosticsSnapshot()
    .voices.find((v) => v.instanceId === windVoice.instanceId);
  assert.ok(resumed?.state === 'starting' || resumed?.state === 'playing');
  assert.equal(resumed?.userPaused, false);
  assert.equal(backendWind?.paused, false);

  // Stopping a voice removes it from active voices and moves it to stoppedVoices for 5 seconds
  assert.equal(engine.stopVoice(windVoice.instanceId), true);
  const afterStop = engine.getDiagnosticsSnapshot();
  assert.equal(
    afterStop.voices.some((v) => v.instanceId === windVoice.instanceId),
    false
  );
  const stoppedEntry = (afterStop.stoppedVoices ?? []).find(
    (v) => v.instanceId === windVoice.instanceId
  );
  assert.ok(stoppedEntry, 'Stopped voice must appear in stoppedVoices');
  assert.equal(stoppedEntry.state, 'stopped');

  // Still visible at +4500ms (< 5000ms retention window)
  realClock.advanceMs(4500);
  const beforeExpiry = engine.getDiagnosticsSnapshot();
  assert.ok(
    (beforeExpiry.stoppedVoices ?? []).some((v) => v.instanceId === windVoice.instanceId),
    'Stopped voice should still be retained before 5000ms elapses'
  );

  // Pruned once >= 5000ms have elapsed
  realClock.advanceMs(600);
  const afterExpiry = engine.getDiagnosticsSnapshot();
  assert.equal(
    (afterExpiry.stoppedVoices ?? []).some((v) => v.instanceId === windVoice.instanceId),
    false,
    'Stopped voice should expire from stoppedVoices after 5 seconds'
  );

  engine.dispose();
});

test('wildlife.call triggers wolf_howl at spatial distance, enforces night conditions/quotas/cooldowns, and supports gainScale calibration', () => {
  const { engine, realClock, backend } = createTestEngine({ seed: 777 });

  // Verify wildlife assets are preloaded and quiet recordings carry gainScale normalization
  const wolfAsset = DEFAULT_SOUNDSCAPE_CONFIG.assets.find((a) => a.id === 'wolf_howl_mp3');
  const owlAsset = DEFAULT_SOUNDSCAPE_CONFIG.assets.find((a) => a.id === 'tawny_owl_mp3');
  assert.equal(wolfAsset?.preload, true);
  assert.equal(owlAsset?.preload, true);
  assert.ok((wolfAsset?.gainScale ?? 1) > 1);
  assert.ok((owlAsset?.gainScale ?? 1) > 1);

  // Daytime (14:00): normal wildlife.call respects conditions and does not fire wolf_howl
  let simMs = 14 * 3600_000;
  engine.step(0.1, makeWorld({ simMs, hour: 14, biome: 'forest', weather: 'clear' }));
  engine.emitEvent({
    type: 'wildlife.call',
    origin: 'player',
    simulationTimestamp: simMs,
    position: { x: 0, y: 2.2, z: 0 },
    intensity: 0.9,
    payload: { species: 'wolf_howl' },
  });
  assert.equal(
    backend.records.filter((r) => r.soundId === 'wolf_howl').length,
    0,
    'wolf_howl should not play on non-forced wildlife.call during daytime'
  );

  // Nighttime (01:55): wildlife.call { species: 'wolf_howl' } plays spatially at distance & updates quota
  simMs = (24 + 1 + 55 / 60) * 3600_000;
  realClock.advanceMs(500);
  engine.step(0.1, makeWorld({ simMs, day: 2, hour: 1 + 55 / 60, biome: 'forest', weather: 'clear' }));
  engine.emitEvent({
    type: 'wildlife.call',
    origin: 'player',
    simulationTimestamp: simMs,
    position: { x: 0, y: 2.2, z: 0 },
    intensity: 0.9,
    payload: { species: 'wolf_howl' },
  });

  const wolfRecs = backend.records.filter((r) => r.soundId === 'wolf_howl');
  assert.equal(wolfRecs.length, 1, 'Expected wildlife.call to play wolf_howl at 01:55');
  assert.ok(wolfRecs[0].initialPosition, 'wolf_howl should use generated_point spatial position');
  const distFromListener = Math.hypot(
    wolfRecs[0].initialPosition!.x,
    wolfRecs[0].initialPosition!.z
  );
  assert.ok(
    distFromListener >= 100 && distFromListener <= 300,
    `Expected wolf_howl to spawn at distant forest range (110..280m), got ${distFromListener.toFixed(1)}m`
  );
  // Advance fade-in past 120ms and verify calibrated gain & updated rule quota
  realClock.advanceMs(200);
  engine.step(0.2, makeWorld({ simMs: simMs + 200, day: 2, hour: 1 + 55 / 60, biome: 'forest', weather: 'clear' }));
  const ruleAfterFirst = engine.getDiagnosticsSnapshot().rules.find((r) => r.soundId === 'wolf_howl');
  assert.equal(ruleAfterFirst?.quotaUsed, 1);
  assert.ok(
    (wolfRecs[0].gainHistory.at(-1) ?? 0) >= 0.65,
    `Expected calibrated wolf_howl gain >= 0.65, got ${wolfRecs[0].gainHistory.at(-1)}`
  );

  // Immediate repeat emit within 1h minInterval cooldown must be suppressed
  engine.emitEvent({
    type: 'wildlife.call',
    origin: 'player',
    simulationTimestamp: simMs + 200,
    position: { x: 0, y: 2.2, z: 0 },
    intensity: 0.9,
    payload: { species: 'wolf_howl' },
  });
  assert.equal(
    backend.records.filter((r) => r.soundId === 'wolf_howl').length,
    1,
    'Immediate repeat wildlife.call should respect minInterval cooldown'
  );

  // Wait past finite clip completion + clear quotas -> wildlife.call immediately plays again
  for (let i = 0; i < 45; i++) {
    realClock.advanceMs(200);
    simMs += 200;
    engine.step(0.2, makeWorld({ simMs, day: 2, hour: 1 + 55 / 60, biome: 'forest', weather: 'clear' }));
  }
  engine.resetQuotasAndCooldowns();
  engine.emitEvent({
    type: 'wildlife.call',
    origin: 'player',
    simulationTimestamp: simMs,
    position: { x: 0, y: 2.2, z: 0 },
    intensity: 0.9,
    payload: { species: 'wolf_howl' },
  });
  assert.equal(
    backend.records.filter((r) => r.soundId === 'wolf_howl').length,
    2,
    'wildlife.call should play wolf_howl again after resetQuotasAndCooldowns()'
  );

  engine.dispose();
});





