import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptiveQualityGovernor,
  computeTreeLodFadeBands,
  createQualityDistanceState,
  detectInitialQualityTier,
  getQualityProfile,
  parseQualityMode,
  QUALITY_PROFILES,
  slewQualityDistanceState,
  snapQualityDistanceState,
} from './qualityGovernor';

test('detectInitialQualityTier chooses appropriate starting tier by GPU class', () => {
  assert.equal(detectInitialQualityTier({ isSoftwareGl: true, isLowPowerGpu: true }), 0);
  assert.equal(detectInitialQualityTier({ isSoftwareGl: false, isLowPowerGpu: true }), 1);
  assert.equal(detectInitialQualityTier({ isSoftwareGl: false, isLowPowerGpu: false }), 2);
});

test('quality profiles scale render distance, LOD rings, foliage radius, and shadow extent monotonically', () => {
  for (let tier = 0; tier < 4; tier++) {
    const lower = QUALITY_PROFILES[tier as 0 | 1 | 2 | 3];
    const upper = QUALITY_PROFILES[(tier + 1) as 1 | 2 | 3 | 4];
    assert.ok(upper.maxRenderDist > lower.maxRenderDist);
    assert.ok(upper.terrainLod0Dist > lower.terrainLod0Dist);
    assert.ok(upper.treeLod0Dist > lower.treeLod0Dist);
    assert.ok(upper.understoryDist > lower.understoryDist);
    assert.ok(upper.bushDist > lower.bushDist);
    assert.ok(upper.shadowExtent > lower.shadowExtent);
    assert.ok(upper.grassMaxRing >= lower.grassMaxRing);
  }
  assert.equal(getQualityProfile(4).maxRenderDist, 264);
});

test('AdaptiveQualityGovernor promotes balanced -> high -> ultra on sustained 60 FPS with GPU/CPU headroom', () => {
  const gov = new AdaptiveQualityGovernor({
    hardware: { isSoftwareGl: false, isLowPowerGpu: false },
  });
  assert.equal(gov.getTier(), 2);

  let nowMs = 0;
  let upgradedToHigh = false;
  let upgradedToUltra = false;

  // Step 250ms ticks at constant 60 FPS and 5.2ms CPU frame time
  for (let i = 0; i < 65; i++) {
    nowMs += 250;
    const res = gov.observe({
      nowMs,
      rawDtMs: 250,
      fpsEma: 60,
      fpsInstant: 60,
      frameCpuMs: 5.2,
      isPlaying: true,
    });
    if (res?.toTier === 3) {
      assert.equal(res.reason, 'headroom_upgrade');
      upgradedToHigh = true;
    }
    if (res?.toTier === 4) {
      assert.equal(res.reason, 'headroom_upgrade');
      upgradedToUltra = true;
    }
  }

  assert.equal(upgradedToHigh, true);
  assert.equal(upgradedToUltra, true);
  assert.equal(gov.getTier(), 4);
  assert.equal(gov.getProfile().grassMaxRing, 4);
  assert.equal(gov.getProfile().maxRenderDist, 264);
  assert.ok(gov.getProfile().bushDist >= 200);
  assert.ok(gov.getProfile().understoryDist >= 150);
});

test('AdaptiveQualityGovernor degrades when FPS drops below 35-40 constantly', () => {
  const gov = new AdaptiveQualityGovernor({
    hardware: { isSoftwareGl: false, isLowPowerGpu: false },
  });
  gov.setMode(4);
  gov.setMode('auto'); // resets to 2, let's drive it to 3 first cleanly

  let nowMs = 0;
  for (let i = 0; i < 16; i++) {
    nowMs += 250;
    gov.observe({
      nowMs,
      rawDtMs: 250,
      fpsEma: 60,
      fpsInstant: 60,
      frameCpuMs: 4.5,
      isPlaying: true,
    });
  }
  assert.equal(gov.getTier(), 3);

  // Advance past probation window (5s) at stable FPS first (keep slight CPU margin < upgrade hold or stay just under 57 FPS)
  for (let i = 0; i < 22; i++) {
    nowMs += 250;
    gov.observe({
      nowMs,
      rawDtMs: 250,
      fpsEma: 55,
      fpsInstant: 55,
      frameCpuMs: 6.0,
      isPlaying: true,
    });
  }

  // Now simulate constant 36 FPS (< 38 FPS threshold)
  let downgraded = null;
  for (let i = 0; i < 12; i++) {
    nowMs += 250;
    const tr = gov.observe({
      nowMs,
      rawDtMs: 250,
      fpsEma: 36,
      fpsInstant: 35,
      frameCpuMs: 14,
      isPlaying: true,
    });
    if (tr) downgraded = tr;
  }

  assert.ok(downgraded);
  assert.equal(downgraded!.fromTier, 3);
  assert.equal(downgraded!.toTier, 2);
  assert.equal(downgraded!.reason, 'constant_low_fps');
  assert.equal(gov.getTier(), 2);
});

test('AdaptiveQualityGovernor degrades when FPS dips below 40 often even if EMA stays above 40', () => {
  const gov = new AdaptiveQualityGovernor({
    hardware: { isSoftwareGl: false, isLowPowerGpu: false },
  });

  let nowMs = 0;
  // Warmup at 60 FPS
  for (let i = 0; i < 12; i++) {
    nowMs += 250;
    gov.observe({
      nowMs,
      rawDtMs: 250,
      fpsEma: 60,
      fpsInstant: 60,
      isPlaying: true,
    });
  }

  // Alternating stuttering frames: EMA sits around 45 FPS, but >35% of samples dip to 34-37 FPS
  let downgraded = null;
  for (let i = 0; i < 20; i++) {
    nowMs += 250;
    const dip = i % 2 === 0;
    const tr = gov.observe({
      nowMs,
      rawDtMs: 250,
      fpsEma: 44,
      fpsInstant: dip ? 36 : 56,
      isPlaying: true,
    });
    if (tr) {
      downgraded = tr;
      break;
    }
  }

  assert.ok(downgraded);
  assert.equal(downgraded!.fromTier, 2);
  assert.equal(downgraded!.toTier, 1);
  assert.equal(downgraded!.reason, 'frequent_low_fps');
});

test('Probation rollback reverts over-ambitious upgrade and prevents ping-pong oscillation', () => {
  const gov = new AdaptiveQualityGovernor({
    hardware: { isSoftwareGl: false, isLowPowerGpu: false },
  });

  let nowMs = 0;
  // Climb 2 -> 3 at 60 FPS
  for (let i = 0; i < 16; i++) {
    nowMs += 250;
    gov.observe({
      nowMs,
      rawDtMs: 250,
      fpsEma: 60,
      fpsInstant: 60,
      frameCpuMs: 5,
      isPlaying: true,
    });
  }
  assert.equal(gov.getTier(), 3);

  // Immediately after stepping up to Tier 3, FPS drops to 42 (< 48 probation rollback)
  nowMs += 250;
  const rollback = gov.observe({
    nowMs,
    rawDtMs: 250,
    fpsEma: 42,
    fpsInstant: 39,
    frameCpuMs: 11,
    isPlaying: true,
  });
  assert.ok(rollback);
  assert.equal(rollback!.fromTier, 3);
  assert.equal(rollback!.toTier, 2);
  assert.equal(rollback!.reason, 'probation_rollback');

  // Even if FPS returns to 60 FPS for the next 25s, Tier 3 remains locked out to stop oscillation
  for (let i = 0; i < 100; i++) {
    nowMs += 250;
    const tr = gov.observe({
      nowMs,
      rawDtMs: 250,
      fpsEma: 60,
      fpsInstant: 60,
      frameCpuMs: 5,
      isPlaying: true,
    });
    assert.equal(tr, null);
  }
  assert.equal(gov.getTier(), 2);

  // After lockout expires (~45s from rollback) and hold duration completes, Tier 3 can be retried
  for (let i = 0; i < 95; i++) {
    nowMs += 250;
    gov.observe({
      nowMs,
      rawDtMs: 250,
      fpsEma: 60,
      fpsInstant: 60,
      frameCpuMs: 5,
      isPlaying: true,
    });
  }
  assert.equal(gov.getTier(), 3);
});

test('Manual quality mode locks tier and paused/hidden frames never degrade auto quality', () => {
  const gov = new AdaptiveQualityGovernor({
    hardware: { isSoftwareGl: false, isLowPowerGpu: false },
  });

  // Paused / hidden / huge tab-switch dt must be ignored in auto mode
  let nowMs = 3000;
  for (let i = 0; i < 40; i++) {
    nowMs += 250;
    assert.equal(
      gov.observe({
        nowMs,
        rawDtMs: 250,
        fpsEma: 15,
        fpsInstant: 12,
        isPlaying: false,
      }),
      null
    );
    assert.equal(
      gov.observe({
        nowMs,
        rawDtMs: 250,
        fpsEma: 15,
        fpsInstant: 12,
        isPlaying: true,
        isHidden: true,
      }),
      null
    );
    assert.equal(
      gov.observe({
        nowMs,
        rawDtMs: 800,
        fpsEma: 10,
        fpsInstant: 5,
        isPlaying: true,
      }),
      null
    );
  }
  assert.equal(gov.getTier(), 2);

  const manualRes = gov.setMode(4);
  assert.deepEqual(manualRes, { fromTier: 2, toTier: 4, reason: 'manual' });
  assert.equal(gov.getTier(), 4);
  assert.equal(
    gov.observe({
      nowMs: 20_000,
      rawDtMs: 250,
      fpsEma: 12,
      fpsInstant: 10,
      isPlaying: true,
    }),
    null
  );
  assert.equal(gov.getTier(), 4);
  assert.equal(parseQualityMode('3'), 3);
  assert.equal(parseQualityMode('auto'), 'auto');
  assert.equal(parseQualityMode('invalid'), 'auto');
});

test('Sustained 60 FPS promotes to Ultra even with occasional frameCpuMs spikes and on low-power GPUs', () => {
  const gov = new AdaptiveQualityGovernor({
    hardware: { isSoftwareGl: false, isLowPowerGpu: true },
  });
  assert.equal(gov.getTier(), 1);
  assert.equal(gov.getAutoCeilingTier(), 4);

  let nowMs = 0;
  for (let i = 0; i < 65; i++) {
    nowMs += 250;
    // Simulate occasional 17.5ms chunk-bake/shadow spikes while FPS remains steady 60
    const frameCpuMs = i % 7 === 0 ? 17.5 : 6.2;
    gov.observe({
      nowMs,
      rawDtMs: 250,
      fpsEma: 60,
      fpsInstant: 59,
      frameCpuMs,
      isPlaying: true,
    });
  }

  assert.equal(gov.getTier(), 4);
  assert.equal(gov.getProfile().name, 'ultra');
});

test('computeTreeLodFadeBands preserves strict non-overlapping 2-phase LOD crossfade ordering across all tiers and fog ranges', () => {
  const fogValues = [72, 96, 128, 180, 264];
  for (let tier = 0; tier <= 4; tier++) {
    const profile = QUALITY_PROFILES[tier as 0 | 1 | 2 | 3 | 4];
    for (const fog of fogValues) {
      const b = computeTreeLodFadeBands(profile.treeLod0Dist, profile.treeLod1Dist, fog);
      assert.ok(b.lod0InStart < b.lod0InEnd, `tier ${tier} fog ${fog} lod0In inverted`);
      assert.equal(b.lod0InEnd, b.lod0OutStart);
      assert.ok(b.lod0OutStart < b.lod0OutEnd, `tier ${tier} fog ${fog} lod0Out inverted`);
      assert.ok(b.lod0OutEnd < b.lod1InStart, `tier ${tier} fog ${fog} lod0 overlaps lod1`);
      assert.ok(b.lod1InStart < b.lod1InEnd, `tier ${tier} fog ${fog} lod1In inverted`);
      assert.equal(b.lod1InEnd, b.lod1OutStart);
      assert.ok(b.lod1OutStart < b.lod1OutEnd, `tier ${tier} fog ${fog} lod1Out inverted`);
      assert.ok(b.lod1OutEnd < b.treeFadeStart, `tier ${tier} fog ${fog} lod1 overlaps horizon fade`);
      assert.ok(b.treeFadeStart < b.treeFadeEnd, `tier ${tier} fog ${fog} tree fade inverted`);
    }
  }
});

test('slewQualityDistanceState glides distances gradually instead of snapping rings on upgrade', () => {
  const balanced = getQualityProfile(2);
  const ultra = getQualityProfile(4);
  const distState = createQualityDistanceState(balanced);

  // One 50ms frame should step only ~1.4m instead of jumping +44m instantaneously
  slewQualityDistanceState(distState, ultra, 0.05);
  assert.ok(distState.bushDist > balanced.bushDist);
  assert.ok(distState.bushDist < balanced.bushDist + 3);
  assert.ok(distState.treeLod0Dist > balanced.treeLod0Dist);
  assert.ok(distState.treeLod0Dist < balanced.treeLod0Dist + 3);

  // After sufficient time (~4s), reaches full ultra distances
  for (let i = 0; i < 80; i++) {
    slewQualityDistanceState(distState, ultra, 0.05);
  }
  assert.equal(distState.bushDist, ultra.bushDist);
  assert.equal(distState.treeLod1Dist, ultra.treeLod1Dist);
  assert.equal(distState.maxRenderDist, ultra.maxRenderDist);

  snapQualityDistanceState(distState, balanced);
  assert.equal(distState.bushDist, balanced.bushDist);
});

