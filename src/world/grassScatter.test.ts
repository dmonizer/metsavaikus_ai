import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeterministicShuffle,
  computeGrassClumpScale,
  computeMossCarpetScale,
  computeOpennessFactor,
  computeRoadVergeCoverage,
  computeRoadVergeFillerCoverage,
  computeShortGrassScale,
  computeTallUndergrowthScale,
  generateR2TileSamples,
  shouldKeepMossCarpet,
  shouldKeepTallUndergrowth,
} from './grassScatter';

test('generateR2TileSamples distributes points smoothly in 2D without grid or diagonal line alignment', () => {
  const pts = generateR2TileSamples(2, -3, 2026, 16, 760, 17);
  assert.equal(pts.length, 760);

  const quadrants = [0, 0, 0, 0];
  const xBins = new Array(8).fill(0);
  const zBins = new Array(8).fill(0);
  for (const p of pts) {
    assert.ok(p.lx >= 0 && p.lx < 16);
    assert.ok(p.lz >= 0 && p.lz < 16);
    const qi = (p.lz >= 8 ? 2 : 0) + (p.lx >= 8 ? 1 : 0);
    quadrants[qi]++;
    xBins[Math.min(7, Math.floor(p.lx / 2))]++;
    zBins[Math.min(7, Math.floor(p.lz / 2))]++;
  }

  for (const q of quadrants) {
    assert.ok(q >= 155 && q <= 225, `Expected balanced quadrant fill ~190, got ${q}`);
  }
  for (const bx of xBins) {
    assert.ok(bx >= 65 && bx <= 125, `Expected smooth X histogram ~95, got ${bx}`);
  }
  for (const bz of zBins) {
    assert.ok(bz >= 65 && bz <= 125, `Expected smooth Z histogram ~95, got ${bz}`);
  }

  // Check nearest-neighbor angle isotropy across 8 directional sectors (no horizontal/vertical/diagonal lines)
  const angleBins = new Array(8).fill(0);
  for (let i = 0; i < pts.length; i++) {
    let bestSq = Infinity;
    let bestDx = 0;
    let bestDz = 0;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      let dx = pts[j].lx - pts[i].lx;
      let dz = pts[j].lz - pts[i].lz;
      if (dx > 8) dx -= 16;
      else if (dx < -8) dx += 16;
      if (dz > 8) dz -= 16;
      else if (dz < -8) dz += 16;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq) {
        bestSq = dSq;
        bestDx = dx;
        bestDz = dz;
      }
    }
    let ang = Math.atan2(bestDz, bestDx);
    if (ang < 0) ang += Math.PI;
    const bin = Math.min(7, Math.floor((ang / Math.PI) * 8));
    angleBins[bin]++;
  }
  for (const count of angleBins) {
    assert.ok(
      count >= 55 && count <= 145,
      `Expected isotropic nearest-neighbor angles ~95 per sector without directional lines, got [${angleBins.join(', ')}]`
    );
  }
});

test('buildDeterministicShuffle eliminates row/column striping when slicing prefixes for outer grass rings', () => {
  const n = 576; // 24x24 equivalent count
  const order = buildDeterministicShuffle(n, 4242);
  assert.equal(order.length, n);

  const seen = new Set<number>();
  for (let i = 0; i < n; i++) seen.add(order[i]);
  assert.equal(seen.size, n);

  // Taking the first half (equivalent to ringStep=2) must cover both even and odd source columns evenly
  let evenCols = 0;
  let oddCols = 0;
  for (let i = 0; i < n / 2; i++) {
    const col = order[i] % 24;
    if (col % 2 === 0) evenCols++;
    else oddCols++;
  }
  assert.ok(Math.abs(evenCols - oddCols) <= 28, `Expected balanced even/odd cols, got ${evenCols} vs ${oddCols}`);
});

test('computeRoadVergeCoverage feathers road shoulders and keeps tall undergrowth sparser near verges', () => {
  const onRoad = computeRoadVergeCoverage(0.8, false, 0, 0.05);
  assert.equal(onRoad.keep, false);

  const shoulderShort = computeRoadVergeCoverage(2.5, false, 0, 0.25);
  assert.equal(shoulderShort.keep, true);
  assert.ok(shoulderShort.heightScale > 0.4 && shoulderShort.heightScale < 0.95);

  const openMeadow = computeRoadVergeCoverage(6.0, false, 0, 0.99);
  assert.equal(openMeadow.keep, true);
  assert.equal(openMeadow.heightScale, 1);

  const tallVergeBlocked = computeRoadVergeCoverage(2.3, false, 0, 0.5, true);
  assert.equal(tallVergeBlocked.keep, false);

  // Filler short grass & moss feather slightly closer to the shoulder than medium grass
  const fillerRoadEdge = computeRoadVergeFillerCoverage(1.85, false, 0, 0.2);
  assert.equal(fillerRoadEdge.keep, true);
  assert.ok(fillerRoadEdge.heightScale >= 0.38 && fillerRoadEdge.heightScale < 0.85);
});

test('Grass and tall undergrowth scale helpers produce wide randomized height diversity in open areas', () => {
  const lowGrass = computeGrassClumpScale(0, 0.1, 0.2, 0.1, 0.05, 1, 1);
  const longGrass = computeGrassClumpScale(0, 0.85, 0.7, 0.9, 0.96, 1, 1);
  assert.ok(longGrass.sy > lowGrass.sy * 2.1, `Expected strong height spread, got ${lowGrass.sy} vs ${longGrass.sy}`);
  assert.ok(lowGrass.sxz >= 1.0 && longGrass.sxz > lowGrass.sxz);

  const shortUndergrowth = computeTallUndergrowthScale(0.1, 0.1, 0.1, 0.05, 1, 1);
  const tallUndergrowth = computeTallUndergrowthScale(0.9, 0.9, 0.9, 0.95, 1, 1);
  assert.ok(tallUndergrowth.sy > shortUndergrowth.sy * 1.9);
});

test('Short filler grass and moss carpet fill inter-clump spaces in both forest and open meadows', () => {
  const pts = generateR2TileSamples(3, -1, 2026, 16, 400, 73);
  let forestMoss = 0;
  let meadowMoss = 0;

  for (const p of pts) {
    const mossNoise = (p.lx / 16) * 0.5 + (p.lz / 16) * 0.5;
    if (shouldKeepMossCarpet(0, mossNoise, 0, p.r1, p.r4)) forestMoss++;
    if (shouldKeepMossCarpet(1, mossNoise, 0, p.r1, p.r4)) meadowMoss++;
  }

  assert.ok(forestMoss > 260, `Expected lush forest moss coverage >65%, got ${forestMoss}/400`);
  assert.ok(meadowMoss > 150 && meadowMoss < forestMoss, `Expected natural meadow moss patches, got ${meadowMoss}/400 vs forest ${forestMoss}`);

  const shortOpen = computeShortGrassScale(0, 0.5, 0.5, 0.5, 0.5, 1, 1);
  const shortForest = computeShortGrassScale(0, 0.5, 0.5, 0.5, 0.5, 1, 0);
  assert.ok(shortOpen.sxz >= 1.0 && shortForest.sy < shortOpen.sy);

  const mossForest = computeMossCarpetScale(0, 0.6, 0.5, 0.5, 0.5, 1, 0);
  const mossOpen = computeMossCarpetScale(0, 0.6, 0.5, 0.5, 0.5, 1, 1);
  assert.ok(mossForest.sxz > mossOpen.sxz && mossForest.sy > mossOpen.sy);
});

test('computeOpennessFactor distinguishes open village/road clearings from deep forest', () => {
  assert.equal(computeOpennessFactor(10, 26, 40, false, 0, 0, 0.3), 1);
  assert.equal(computeOpennessFactor(90, 26, 4.5, false, 0, 0, 0.3), 1);
  assert.equal(computeOpennessFactor(120, 26, 22, false, 0, 0, 0.4), 0);
});

test('Forest grass is roughly half shorter than open areas while preserving occasional long tufts', () => {
  const pts = generateR2TileSamples(1, 2, 2026, 16, 400, 13);
  let openSum = 0;
  let forestSum = 0;
  let forestLongTufts = 0;
  let forestTallKeep = 0;
  let openTallKeep = 0;

  for (const p of pts) {
    const openScale = computeGrassClumpScale(0, 0.45, p.r1, p.r2, p.r3, 1, 1);
    const forestScale = computeGrassClumpScale(0, 0.45, p.r1, p.r2, p.r3, 1, 0);
    openSum += openScale.sy;
    forestSum += forestScale.sy;
    if (forestScale.sy >= openScale.sy * 0.85) forestLongTufts++;
    if (shouldKeepTallUndergrowth(1, 0.55, p.r1, p.r4)) openTallKeep++;
    if (shouldKeepTallUndergrowth(0, 0.55, p.r1, p.r4)) forestTallKeep++;
  }

  const ratio = forestSum / openSum;
  assert.ok(ratio >= 0.46 && ratio <= 0.65, `Expected forest grass average ~0.55x open, got ${ratio.toFixed(3)}`);
  assert.ok(forestLongTufts >= 30 && forestLongTufts <= 90, `Expected ~14% long tufts in forest, got ${forestLongTufts}/400`);
  assert.ok(forestTallKeep > 20 && forestTallKeep < openTallKeep * 0.35, `Expected sparse tall undergrowth tufts in forest, got ${forestTallKeep} vs open ${openTallKeep}`);
});
