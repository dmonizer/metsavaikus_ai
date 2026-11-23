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
