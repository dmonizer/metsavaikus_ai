import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMushroomToBasket,
  buildInteractionPrompt,
  canClearHeightCollider,
  createEmptyBasket,
  formatFpsLabel,
  getWeatherWindProfile,
  MUSHROOM_SPECIES_INFO,
  MushroomSpecies,
  smoothFps,
} from './gameLogic';
import {
  classifyBottleneck,
  FpsDropLogger,
  FramePerfSample,
} from './perfLogger';

test('Mushroom basket tracks all 7 edible, inedible, and poisonous species cleanly', () => {
  const b0 = createEmptyBasket();
  const b1 = addMushroomToBasket(b0, 'kukeseen');
  const b2 = addMushroomToBasket(b1, 'kivipuravik');
  const b3 = addMushroomToBasket(b2, 'sapipuravik');
  const b4 = addMushroomToBasket(b3, 'punakarbseseen');
  const b5 = addMushroomToBasket(b4, 'valgekarbseseen');
  const b6 = addMushroomToBasket(b5, 'kuuseriisikas');
  const b7 = addMushroomToBasket(b6, 'kasepuravik');

  assert.equal(b0.total, 0);
  assert.equal(b7.total, 7);
  assert.equal(b7.edible, 4);
  assert.equal(b7.inedible, 1);
  assert.equal(b7.poisonous, 2);
  const allSpecies: MushroomSpecies[] = [
    'kukeseen',
    'kivipuravik',
    'kasepuravik',
    'kuuseriisikas',
    'sapipuravik',
    'punakarbseseen',
    'valgekarbseseen',
  ];
  for (const sp of allSpecies) {
    assert.equal(b7.bySpecies[sp], 1);
    assert.ok(MUSHROOM_SPECIES_INFO[sp].estonian.length > 0);
  }
  assert.equal(MUSHROOM_SPECIES_INFO.sapipuravik.edibility, 'inedible');
  assert.equal(MUSHROOM_SPECIES_INFO.punakarbseseen.edibility, 'poisonous');
  assert.equal(MUSHROOM_SPECIES_INFO.valgekarbseseen.edibility, 'poisonous');
});

test('Jump clearance allows hopping over split-pole fences while blocking ground-level walks', () => {
  const groundY = 1.4;
  const fenceHeight = 0.92;
  assert.equal(canClearHeightCollider(groundY, groundY, fenceHeight), false);
  assert.equal(canClearHeightCollider(groundY + 0.5, groundY, fenceHeight), false);
  assert.equal(canClearHeightCollider(groundY + 0.85, groundY, fenceHeight), true);
  assert.equal(canClearHeightCollider(groundY + 1.24, groundY, fenceHeight), true);
});

test('Gatherable mushrooms never expose Kick/Throw actions', () => {
  const prompt = buildInteractionPrompt(
    {
      name: 'Chanterelle (Kukeseen)',
      desc: 'Golden wild forest mushroom.',
      gatherable: true,
      carryable: false,
      kickable: false,
    },
    false
  );
  assert.ok(prompt);
  assert.equal(prompt!.title, 'Chanterelle (Kukeseen)');
  assert.equal(prompt!.actionsText, '[E] Gather  ·  [R] Inspect');
  assert.equal(prompt!.actionsText.includes('Kick'), false);
  assert.equal(prompt!.actionsText.includes('Throw'), false);
});

test('Carryable crates expose Pick up and Kick/Push when empty-handed', () => {
  const prompt = buildInteractionPrompt(
    {
      name: 'Wooden Crate',
      desc: 'Heavy crate.',
      carryable: true,
      kickable: true,
    },
    false
  );
  assert.ok(prompt);
  assert.equal(prompt!.actionsText, '[E] Pick up  ·  [F] Kick / Push  ·  [R] Inspect');
  assert.equal(buildInteractionPrompt({ name: 'Crate', desc: '' }, true), null);
});

test('FPS EMA smoothing and label formatting', () => {
  const s1 = smoothFps(60, 1 / 30);
  assert.ok(s1 > 50 && s1 < 60);
  assert.equal(formatFpsLabel(59.6), '60 FPS');
  assert.equal(formatFpsLabel(0), '1 FPS');
});

test('Weather wind profile scales from mist to storm', () => {
  const mist = getWeatherWindProfile('mist');
  const clear = getWeatherWindProfile('clear');
  const rain = getWeatherWindProfile('rain');
  const storm = getWeatherWindProfile('storm');
  assert.ok(mist.baseStrength < clear.baseStrength);
  assert.ok(clear.baseStrength < rain.baseStrength);
  assert.ok(rain.baseStrength < storm.baseStrength);
  assert.ok(storm.gustAmplitude > clear.gustAmplitude);
});

function makePerfSample(overrides: Partial<FramePerfSample> = {}): FramePerfSample {
  return {
    nowMs: 5000,
    rawDtMs: 16.7,
    fpsEma: 60,
    fpsInstant: 60,
    playerMs: 0.4,
    propsMs: 0.5,
    skyMs: 0.3,
    terrainMs: 0.6,
    vegMs: 0.7,
    minimapMs: 0.2,
    renderMs: 2.1,
    tickCpuMs: 4.8,
    externalWaitMs: 11.9,
    pos: [120, 1.5, -540],
    chunk: [2, -12],
    biome: 'forest',
    heading: 'N · 005°',
    timeOfDay: '23:10',
    weather: 'rain',
    wind: 1.8,
    flashlightOn: true,
    sunCastShadow: false,
    isSoftwareGl: false,
    calls: 128,
    triangles: 210000,
    points: 0,
    geometries: 185,
    textures: 24,
    programs: 12,
    visibleChunks: 26,
    lodCounts: [4, 12, 10],
    treesRendered: 1300,
    foliageRendered: 9800,
    terrainCacheSize: 210,
    terrainBuilds: 0,
    terrainEvictions: 0,
    terrainRecenters: 0,
    foliageCacheSize: 180,
    foliageBakes: 0,
    foliageEvictions: 0,
    foliageVisRebuilds: 0,
    grassRebuilds: 0,
    grassCount: 8400,
    colliderCells: 620,
    jsHeapMB: 142.4,
    ...overrides,
  };
}

test('FpsDropLogger logs LOW_FPS (<15), escalates EXTREME_FPS (3-4), classifies bottlenecks, and logs RECOVERED', () => {
  const captured: Array<{ prefix: string; payload: string }> = [];
  const logger = new FpsDropLogger(0, {
    warmupMs: 2000,
    logIntervalMs: 2000,
    escalationCooldownMs: 500,
    sink: (prefix, payload) => captured.push({ prefix, payload }),
  });

  logger.recordEvent('keyWeather->storm', 2800);

  // Warmup frames ignored
  assert.equal(logger.observe(makePerfSample({ nowMs: 1200, fpsEma: 8, fpsInstant: 8, rawDtMs: 125 })), null);
  assert.equal(captured.length, 0);

  // Single dip frame does not fire immediately; 2nd consecutive low frame logs LOW_FPS
  assert.equal(
    logger.observe(
      makePerfSample({
        nowMs: 3000,
        fpsEma: 13.5,
        fpsInstant: 12,
        rawDtMs: 83,
        vegMs: 52,
        tickCpuMs: 60,
        externalWaitMs: 23,
      })
    ),
    null
  );
  const low = logger.observe(
    makePerfSample({
      nowMs: 3085,
      fpsEma: 12.8,
      fpsInstant: 11.7,
      rawDtMs: 85,
      vegMs: 56,
      tickCpuMs: 64,
      externalWaitMs: 21,
      grassRebuilds: 1,
    })
  );
  assert.ok(low);
  assert.equal(low!.severity, 'LOW_FPS');
  assert.equal(low!.dominantCause, 'CPU_VEGETATION_OR_GRASS');
  assert.ok(low!.recentEvents.some((e) => e.startsWith('keyWeather->storm@')));

  // Sudden drop to 3.5 FPS escalates to EXTREME_FPS after cooldown (GPU fillrate stall in storm)
  const extreme = logger.observe(
    makePerfSample({
      nowMs: 3900,
      fpsEma: 4.1,
      fpsInstant: 3.4,
      rawDtMs: 294,
      tickCpuMs: 9.2,
      externalWaitMs: 284.8,
      weather: 'storm',
    })
  );
  assert.ok(extreme);
  assert.equal(extreme!.severity, 'EXTREME_FPS');
  assert.equal(extreme!.dominantCause, 'GPU_FILLRATE_OR_SYNC_DURING_PRECIP');

  // Recovery requires >=22 FPS sustained for >=1000ms
  assert.equal(logger.observe(makePerfSample({ nowMs: 4500, fpsEma: 42, fpsInstant: 55 })), null);
  const recovered = logger.observe(makePerfSample({ nowMs: 5600, fpsEma: 52, fpsInstant: 58 }));
  assert.ok(recovered);
  assert.equal(recovered!.severity, 'RECOVERED');
  assert.equal(captured.length, 3);

  // Copy-pasteable dump includes valid JSON lines
  const lines = logger.dumpText().split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('[METSAVAIKUS_PERF:EXTREME_FPS] '));
  const parsed = JSON.parse(lines[1].replace('[METSAVAIKUS_PERF:EXTREME_FPS] ', ''));
  assert.equal(parsed.world.weather, 'storm');
  assert.equal(classifyBottleneck(makePerfSample({ rawDtMs: 90, terrainMs: 48, tickCpuMs: 60, externalWaitMs: 30 })), 'CPU_TERRAIN_CHUNKS');
});
