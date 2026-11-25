import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMushroomToBasket,
  buildInteractionPrompt,
  canClearHeightCollider,
  canRequestPointerLock,
  clampMouseLookDelta,
  clampResolutionScale,
  computeAdaptiveDprSteps,
  computeScaledBackbuffer,
  createEmptyBasket,
  formatFpsLabel,
  formatResolutionSummary,
  getWeatherWindProfile,
  MUSHROOM_SPECIES_INFO,
  MushroomSpecies,
  POINTER_LOCK_REACQUIRE_COOLDOWN_MS,
  safeRequestPointerLock,
  smoothFps,
} from './gameLogic';
import {
  classifyBottleneck,
  FpsDropLogger,
  FramePerfSample,
} from './perfLogger';
import { SoundEngine } from '../world/soundEngine';

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

test('FPS EMA uses harmonic frame-time mean and resists stutter + catch-up inflation', () => {
  const s1 = smoothFps(60, 1 / 30);
  assert.ok(s1 > 50 && s1 < 60);
  assert.equal(formatFpsLabel(59.6), '60 FPS');
  assert.equal(formatFpsLabel(0), '1 FPS');

  // Alternating 100ms stutter + 4ms rAF catch-up has true throughput ~19.2 FPS (2 frames / 104ms),
  // NOT an inflated 75-130 FPS arithmetic mean!
  let ema = 60;
  for (let i = 0; i < 40; i++) {
    ema = smoothFps(ema, i % 2 === 0 ? 0.1 : 0.004);
  }
  assert.ok(ema > 16 && ema < 23, `Expected true harmonic EMA ~19.2 FPS, got ${ema.toFixed(1)}`);
});

test('computeAdaptiveDprSteps enforces integrated GPU pixel budget while keeping discrete GPUs crisp', () => {
  // Mesa Intel UHD 630 at 2155x1287@1.00x (2.77M px) should start ~0.58x (~0.92M px) with minimal steps to 0.45x
  const uhdSteps = computeAdaptiveDprSteps(2155, 1287, 1, false, true);
  assert.ok(uhdSteps[0] <= 0.6 && uhdSteps[0] >= 0.56, `Expected ~0.58x start DPR, got ${uhdSteps[0]}`);
  const startPixels = 2155 * uhdSteps[0] * (1287 * uhdSteps[0]);
  assert.ok(startPixels <= 1_000_000, `Expected <=1.0M pixels, got ${Math.round(startPixels)}`);
  assert.equal(uhdSteps.length, 2);
  assert.equal(uhdSteps[uhdSteps.length - 1], 0.45);
  for (let i = 1; i < uhdSteps.length; i++) {
    assert.ok(uhdSteps[i] < uhdSteps[i - 1], 'DPR steps must be strictly descending');
  }

  // Discrete GPU at 1440x900@2.0x stays crisp at 1.15x
  const discreteSteps = computeAdaptiveDprSteps(1440, 900, 2, false, false);
  assert.equal(discreteSteps[0], 1.15);

  // Software GL stays fixed at [1]
  assert.deepEqual(computeAdaptiveDprSteps(1440, 900, 2, true, true), [1]);
});

test('Resolution scale helpers clamp, snap to 5% increments, and format live backbuffer dimensions', () => {
  assert.equal(clampResolutionScale(0.2), 0.5);
  assert.equal(clampResolutionScale(2.4), 1.5);
  assert.equal(clampResolutionScale(0.87), 0.85);
  assert.equal(clampResolutionScale(1.02), 1.0);
  assert.equal(clampResolutionScale(Number.NaN), 1);

  assert.deepEqual(computeScaledBackbuffer(2155, 1287, 0.58), { width: 1250, height: 746 });
  assert.deepEqual(computeScaledBackbuffer(2155, 1287, 1.0), { width: 2155, height: 1287 });
  assert.equal(formatResolutionSummary(2155, 1287, 0.58, true), 'Auto · 58% (1250×746)');
  assert.equal(formatResolutionSummary(2155, 1287, 1.15, false), '115% (2478×1480)');
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

test('SoundEngine keeps AudioParam timelines bounded across 12,000 frames (200s) and reuses buffers', () => {
  interface MockParam {
    value: number;
    pendingEvents: number;
    maxPendingEvents: number;
    totalScheduled: number;
    cancelScheduledValues: (t: number) => void;
    cancelAndHoldAtTime: (t: number) => void;
    setValueAtTime: (v: number, t: number) => void;
    setTargetAtTime: (v: number, t: number, tau: number) => void;
    exponentialRampToValueAtTime: (v: number, t: number) => void;
    linearRampToValueAtTime: (v: number, t: number) => void;
  }

  function makeParam(initial = 0): MockParam {
    const p: MockParam = {
      value: initial,
      pendingEvents: 0,
      maxPendingEvents: 0,
      totalScheduled: 0,
      cancelScheduledValues() {
        p.pendingEvents = 0;
      },
      cancelAndHoldAtTime() {
        p.pendingEvents = 0;
      },
      setValueAtTime(v: number) {
        p.value = v;
      },
      setTargetAtTime(v: number) {
        p.value = v;
        p.pendingEvents++;
        p.totalScheduled++;
        if (p.pendingEvents > p.maxPendingEvents) p.maxPendingEvents = p.pendingEvents;
      },
      exponentialRampToValueAtTime(v: number) {
        p.value = v;
      },
      linearRampToValueAtTime(v: number) {
        p.value = v;
      },
    };
    return p;
  }

  let createBufferCalls = 0;
  let disconnectedNodes = 0;
  const gainParams: MockParam[] = [];
  const oneShotSources: Array<{ onended: (() => void) | null }> = [];
  const mockCtx = {
    currentTime: 0,
    sampleRate: 44100,
    state: 'running',
    destination: {},
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createBuffer(_ch: number, len: number) {
      createBufferCalls++;
      const arr = new Float32Array(len);
      return { getChannelData: () => arr };
    },
    createBufferSource() {
      const node = {
        buffer: null,
        loop: false,
        onended: null as (() => void) | null,
        connect(dest: unknown) {
          return dest;
        },
        disconnect() {
          disconnectedNodes++;
        },
        start() {},
        stop() {},
      };
      oneShotSources.push(node);
      return node;
    },
    createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: makeParam(320),
        Q: makeParam(1),
        connect(dest: unknown) {
          return dest;
        },
        disconnect() {
          disconnectedNodes++;
        },
      };
    },
    createGain() {
      const g = makeParam(1);
      gainParams.push(g);
      return {
        gain: g,
        connect(dest: unknown) {
          return dest;
        },
        disconnect() {
          disconnectedNodes++;
        },
      };
    },
    createOscillator() {
      const node = {
        type: 'sine',
        frequency: makeParam(440),
        onended: null as (() => void) | null,
        connect(dest: unknown) {
          return dest;
        },
        disconnect() {
          disconnectedNodes++;
        },
        start() {},
        stop() {},
      };
      oneShotSources.push(node);
      return node;
    },
  };

  const sound = new SoundEngine();
  sound.init(mockCtx as unknown as AudioContext);
  const buffersAfterInit = createBufferCalls;
  assert.equal(buffersAfterInit, 4); // ambient noise + step + water + thunder

  // Simulate 200 seconds at 60Hz (12,000 frames) with gusting wind and weather changes
  for (let frame = 0; frame < 12000; frame++) {
    mockCtx.currentTime = frame / 60;
    const weather = frame < 3600 ? 'clear' : frame < 9000 ? 'rain' : 'storm';
    const wind = 0.5 + 0.35 * Math.sin(mockCtx.currentTime * 0.45);
    sound.updateAmbience(weather, wind);
  }

  const windGain = gainParams[0];
  const rainGain = gainParams[1];
  // Prior events must always be cancelled so pending timeline never grows beyond 1
  assert.equal(windGain.maxPendingEvents, 1);
  assert.equal(rainGain.maxPendingEvents, 1);
  // Throttling + deadband should reduce 12,000 calls to well under 500 scheduled updates
  assert.ok(windGain.totalScheduled < 500, `Expected <500 wind updates, got ${windGain.totalScheduled}`);
  assert.ok(rainGain.totalScheduled <= 4, `Expected <=4 rain updates, got ${rainGain.totalScheduled}`);

  // Footsteps and thunder should NOT allocate any new AudioBuffers at runtime
  sound.playFootstep('grass');
  sound.playFootstep('water');
  sound.playFootstep('wood');
  sound.playThunder();
  assert.equal(createBufferCalls, buffersAfterInit);

  // Firing onended disconnects one-shot audio graphs
  for (const s of oneShotSources) {
    if (s.onended) s.onended();
  }
  assert.ok(disconnectedNodes >= 10);
  sound.dispose();
});

test('FpsDropLogger classifies GPU backpressure, thermal throttles, bog overlays, and formats live snapshots', () => {
  assert.equal(
    classifyBottleneck(
      makePerfSample({
        rawDtMs: 250,
        tickCpuMs: 145,
        renderMs: 132,
        externalWaitMs: 105,
        calls: 22,
        triangles: 28840,
        terrainMs: 1.0,
        vegMs: 0.2,
        minimapMs: 1.0,
        weather: 'clear',
      })
    ),
    'GPU_BACKPRESSURE_RENDER_SYNC'
  );

  assert.equal(
    classifyBottleneck(
      makePerfSample({
        rawDtMs: 620,
        tickCpuMs: 26,
        externalWaitMs: 590,
        calls: 19,
        triangles: 27748,
        weather: 'clear',
      })
    ),
    'GPU_DRIVER_OR_THERMAL_THROTTLE'
  );

  assert.equal(
    classifyBottleneck(
      makePerfSample({
        rawDtMs: 180,
        tickCpuMs: 18,
        externalWaitMs: 162,
        calls: 68,
        triangles: 82000,
        weather: 'clear',
        overlays: 'water+mist',
      })
    ),
    'GPU_FILLRATE_BOG_OR_OVERLAYS'
  );

  assert.equal(
    classifyBottleneck(
      makePerfSample({
        rawDtMs: 1640,
        tickCpuMs: 1400,
        renderMs: 1390,
        externalWaitMs: 240,
        programs: 70,
        programsDelta: 27,
      })
    ),
    'SHADER_COMPILE_STALL'
  );

  assert.equal(
    classifyBottleneck(
      makePerfSample({
        rawDtMs: 1700,
        tickCpuMs: 1650,
        renderMs: 42,
        drsMs: 1580,
      })
    ),
    'DRS_SWAPCHAIN_RESIZE_STALL'
  );

  const logger = new FpsDropLogger(0, { sink: () => {} });
  const snap = logger.dumpText(
    makePerfSample({
      nowMs: 12000,
      gpuRenderer: 'ANGLE (Intel Iris Xe)',
      lowPowerGpu: true,
      pixelRatio: 0.64,
      backbufferPx: [1379, 824],
      antialias: false,
      shadowUpdates: 2,
      fogCullDist: 151.8,
      culledInstances: 3200,
      candidateInstances: 4400,
      overlays: 'rain',
    })
  );
  assert.ok(snap.includes('[METSAVAIKUS_PERF:SNAPSHOT]'));
  assert.ok(snap.includes('"gpu":"ANGLE (Intel Iris Xe)"'));
  assert.ok(snap.includes('"lowPower":true'));
  assert.ok(snap.includes('"res":"1379x824@0.64x"'));
  assert.ok(snap.includes('"aa":false'));
  assert.ok(snap.includes('"cull":"3200/4400(73%)"'));
  assert.ok(snap.includes('"fogCullM":151.8'));
  assert.ok(snap.includes('"overlays":"rain"'));
});

test('safeRequestPointerLock respects exit cooldown, handles async rejections, and clampMouseLookDelta drops warp spikes', async () => {
  assert.equal(canRequestPointerLock(1000, 0, false), true);
  assert.equal(canRequestPointerLock(1000, 0, true), false);
  assert.equal(canRequestPointerLock(2000, 1200, false), false);
  assert.equal(
    canRequestPointerLock(1200 + POINTER_LOCK_REACQUIRE_COOLDOWN_MS, 1200, false),
    true
  );

  let calls = 0;
  let rejectedCallbacks = 0;
  const target = {
    requestPointerLock: () => {
      calls++;
      return Promise.reject(
        new DOMException(
          'Pointer lock cannot be acquired immediately after the user has exited the lock.',
          'SecurityError'
        )
      );
    },
  };

  // Blocked inside cooldown before even touching browser API
  assert.equal(safeRequestPointerLock(target, 2000, 1500, false), false);
  assert.equal(calls, 0);

  // Outside cooldown: catches async Promise rejection cleanly without unhandledRejection
  assert.equal(
    safeRequestPointerLock(target, 4000, 1500, false, () => {
      rejectedCallbacks++;
    }),
    true
  );
  assert.equal(calls, 1);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(rejectedCallbacks, 1);

  // Synchronous throw is also caught
  const throwingTarget = {
    requestPointerLock: () => {
      throw new Error('Blocked');
    },
  };
  assert.equal(safeRequestPointerLock(throwingTarget, 4000, 0, false), false);

  // Mouse delta sanitization passes normal look deltas and suppresses warp spikes / NaNs
  assert.deepEqual(clampMouseLookDelta(14, -9), { dx: 14, dy: -9 });
  assert.deepEqual(clampMouseLookDelta(720, 450), { dx: 0, dy: 0 });
  assert.deepEqual(clampMouseLookDelta(Number.NaN, 5), { dx: 0, dy: 0 });
});
