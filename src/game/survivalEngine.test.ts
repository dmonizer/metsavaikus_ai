import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeClothingBonuses,
  computeInventoryWeightKg,
  computePackingWeightKg,
  computeSleepGearBonuses,
  createDefaultPackingSelection,
  createInventoryFromPacking,
  getBottleWeightKg,
  getNavigationMode,
  hasRainJacket,
  hasSleepingBag,
  hasTent,
  isWearingRainJacket,
  PackingSelection,
  removeStackItem,
  toggleWearClothing,
} from './itemCatalog';
import { computeAmbientSoundscapeProfile } from '../world/soundEngine';
import {
  boilBottleAtCampfire,
  classifyHypothermia,
  computeFeelsLikeTempC,
  computePoisonVulnerability,
  computeWeightBurden,
  cookCampfireRecipe,
  createInitialSurvivalState,
  DiscoveryTracker,
  drinkFromBottle,
  eatFoodItem,
  loadFlashlightBattery,
  LocomotionState,
  previewSleepOutcome,
  refillBottlesFromSource,
  stepSleepSlice,
  stepSurvivalTick,
  tryIgniteCampfire,
} from './survivalEngine';

describe('Item Catalog & Packing Weight', () => {
  it('calculates packing weight with multiples and dynamic water bottle mass', () => {
    const empty: PackingSelection = {};
    assert.equal(computePackingWeightKg(empty), 0);

    const packed: PackingSelection = {
      bottle_2l: 2,
      chocolate_bar: 3,
      compass: 1,
    };
    const kg = computePackingWeightKg(packed);
    assert.ok(kg > 4.5 && kg < 5.5, `expected ~4.94kg, got ${kg}`);

    const inv = createInventoryFromPacking(packed);
    assert.equal(inv.bottles.length, 2);
    assert.ok(Math.abs(computeInventoryWeightKg(inv) - kg) < 0.001);
  });

  it('derives all four diegetic navigation modes from compass and paper map presence', () => {
    assert.equal(getNavigationMode(createInventoryFromPacking({})), 'none');
    assert.equal(getNavigationMode(createInventoryFromPacking({ compass: 1 })), 'compass');
    assert.equal(getNavigationMode(createInventoryFromPacking({ paper_map: 1 })), 'map');
    assert.equal(
      getNavigationMode(createInventoryFromPacking({ compass: 1, paper_map: 1 })),
      'both'
    );
  });
});

describe('Hydration, Dynamic Bottle Weight & Water Quality', () => {
  it('makes full bottles heavier than empty ones, lightens on drinking, and blocks drinking empty bottles', () => {
    const inv = createInventoryFromPacking({ bottle_1l: 1 });
    const state = createInitialSurvivalState();
    state.hydration = 50;
    const bottle = inv.bottles[0];
    const fullWeight = getBottleWeightKg(bottle);
    assert.ok(fullWeight > 1.05, `full 1L bottle should weigh > 1.05 kg, got ${fullWeight}`);

    // Drink 4 sips of 0.25L to empty the 1.0L bottle
    for (let i = 0; i < 4; i++) {
      const res = drinkFromBottle(state, inv, bottle.uid);
      assert.equal(res.ok, true);
    }
    assert.equal(bottle.waterLiters, 0);
    const emptyWeight = getBottleWeightKg(bottle);
    assert.ok(emptyWeight < 0.25, 'empty 1L bottle should weigh < 0.25 kg');
    assert.ok(fullWeight - emptyWeight >= 0.99);

    // Empty bottle cannot be drunk from
    const emptyAttempt = drinkFromBottle(state, inv, bottle.uid);
    assert.equal(emptyAttempt.ok, false);
  });

  it('adds water stomach heaviness when drinking rapidly and drops body temp with cold water', () => {
    const inv = createInventoryFromPacking({ bottle_2l: 1 });
    const state = createInitialSurvivalState();
    const bottle = inv.bottles[0];
    bottle.waterTempC = 5; // cold spring water
    const startTemp = state.bodyTempC;
    const startBurden = computeWeightBurden(computeInventoryWeightKg(inv), 0);

    for (let i = 0; i < 5; i++) {
      drinkFromBottle(state, inv, bottle.uid);
    }

    assert.ok(state.waterStomachLoadL > 1.0, 'rapid drinking should fill water stomach load');
    assert.ok(state.bodyTempC < startTemp - 0.2, 'cold water should lower core body temperature');

    const heavyBurden = computeWeightBurden(computeInventoryWeightKg(inv), state.waterStomachLoadL);
    assert.ok(heavyBurden.tiringMultiplier > startBurden.tiringMultiplier);
    assert.ok(heavyBurden.energyLoadMultiplier > startBurden.energyLoadMultiplier);

    // Compare energy drain with water-slosh stomach vs dry stomach at same pack weight
    const dryState = createInitialSurvivalState();
    const heavyState = createInitialSurvivalState();
    heavyState.waterStomachLoadL = 1.5;

    stepSurvivalTick(
      dryState,
      inv,
      {
        locomotion: 'run',
        weather: 'clear',
        windStrength: 0.5,
        hourOfDay: 12,
        shelter: 'outdoor',
        nearLitCampfireFactor: 0,
        flashlightActive: false,
      },
      12,
      0.4
    );
    stepSurvivalTick(
      heavyState,
      inv,
      {
        locomotion: 'run',
        weather: 'clear',
        windStrength: 0.5,
        hourOfDay: 12,
        shelter: 'outdoor',
        nearLitCampfireFactor: 0,
        flashlightActive: false,
      },
      12,
      0.4
    );
    assert.ok(
      heavyState.energy < dryState.energy,
      'drinking a lot should drain energy faster while moving'
    );
  });

  it('refills decrepit wells with stale water that causes vomiting/illness similar to Punane kärbseseen, and campfire boiling purifies it', () => {
    const inv = createInventoryFromPacking({ bottle_1l: 1 });
    inv.bottles[0].waterLiters = 0;

    const refill = refillBottlesFromSource(inv, 'stale_well');
    assert.equal(refill.refilledCount, 1);
    assert.equal(inv.bottles[0].waterQuality, 'stale');

    // Drinking unboiled stale water poisons the player
    const sickState = createInitialSurvivalState();
    sickState.hydration = 60;
    drinkFromBottle(sickState, inv, inv.bottles[0].uid);
    assert.ok(
      sickState.poisons.some((p) => p.kind === 'stale_water'),
      'stale well water must apply stale_water poison'
    );

    // Advance time and verify vomiting & health damage occur
    let vomited = false;
    for (let i = 0; i < 40; i++) {
      const ev = stepSurvivalTick(
        sickState,
        inv,
        {
          locomotion: 'idle',
          weather: 'clear',
          windStrength: 0.5,
          hourOfDay: 12,
          shelter: 'warm_house',
          nearLitCampfireFactor: 0,
          flashlightActive: false,
        },
        1,
        0.05
      );
      if (ev.vomited) vomited = true;
    }
    assert.equal(vomited, true, 'stale well water should induce vomiting');
    assert.ok(sickState.health < 95, 'stale well water should reduce health');

    // Boiling the same bottle at a lit campfire purifies it to safe warm water
    const boiled = boilBottleAtCampfire(inv, inv.bottles[0].uid);
    assert.equal(boiled.ok, true);
    assert.equal(inv.bottles[0].waterQuality, 'clean');
    assert.ok(inv.bottles[0].waterTempC >= 40);

    const healthyState = createInitialSurvivalState();
    healthyState.bodyTempC = 36.2;
    drinkFromBottle(healthyState, inv, inv.bottles[0].uid);
    assert.equal(healthyState.poisons.length, 0);
    assert.ok(healthyState.bodyTempC > 36.2, 'warm boiled water should gently warm core temp');
  });
});

describe('Thermoregulation, Rain/Storm Wetting, Windchill & Hypothermia', () => {
  it('wets faster in storm than rain, accounts for windchill, and drives hypothermia to lethal collapse', () => {
    const inv = createInventoryFromPacking(createDefaultPackingSelection());
    const rainState = createInitialSurvivalState();
    const stormState = createInitialSurvivalState();

    stepSurvivalTick(
      rainState,
      inv,
      {
        locomotion: 'walk',
        weather: 'rain',
        windStrength: 1.5,
        hourOfDay: 14,
        shelter: 'outdoor',
        nearLitCampfireFactor: 0,
        flashlightActive: false,
      },
      10,
      0.2
    );
    stepSurvivalTick(
      stormState,
      inv,
      {
        locomotion: 'walk',
        weather: 'storm',
        windStrength: 3.0,
        hourOfDay: 14,
        shelter: 'outdoor',
        nearLitCampfireFactor: 0,
        flashlightActive: false,
      },
      10,
      0.2
    );

    assert.ok(stormState.wetness > rainState.wetness, 'storm must wet clothes faster than rain');
    const calmFeels = computeFeelsLikeTempC(2, 'clear', 0.5, 0, 'outdoor', 0);
    const windyFeels = computeFeelsLikeTempC(2, 'storm', 3.4, 80, 'outdoor', 0);
    assert.ok(
      windyFeels.feelsLikeC < calmFeels.feelsLikeC - 4,
      'windchill + wetness should significantly lower feels-like temp'
    );

    // Sustained severe exposure in cold storm while soaked should reach hypothermia and lethal collapse
    const exposed = createInitialSurvivalState();
    exposed.wetness = 95;
    let collapsed = false;
    for (let i = 0; i < 300; i++) {
      const ev = stepSurvivalTick(
        exposed,
        inv,
        {
          locomotion: 'swim',
          weather: 'storm',
          windStrength: 3.4,
          hourOfDay: 2,
          shelter: 'outdoor',
          nearLitCampfireFactor: 0,
          flashlightActive: false,
        },
        12,
        0.05
      );
      if (ev.died) {
        collapsed = true;
        break;
      }
    }
    assert.ok(exposed.bodyTempC < 34.0, 'core temperature should drop into hypothermia');
    assert.notEqual(classifyHypothermia(exposed.bodyTempC), 'normal');
    assert.equal(collapsed, true, 'severe hypothermia must be lethal');
  });
});

describe('Energy, Locomotion, Calorie Longevity, Poisons & Sleep Caps', () => {
  it('drains energy fastest in run/swim, more in swamp than walking, and scales with pack weight', () => {
    const lightInv = createInventoryFromPacking({});
    const heavyInv = createInventoryFromPacking({ bottle_2l: 4, raw_steak: 4 });

    const runStep = (loco: LocomotionState, inv = lightInv) => {
      const s = createInitialSurvivalState();
      const startEnergy = s.energy;
      stepSurvivalTick(
        s,
        inv,
        {
          locomotion: loco,
          weather: 'clear',
          windStrength: 0.5,
          hourOfDay: 12,
          shelter: 'outdoor',
          nearLitCampfireFactor: 0,
          flashlightActive: false,
        },
        20,
        0.25
      );
      return startEnergy - s.energy;
    };

    const walkDrain = runStep('walk');
    const swampDrain = runStep('swamp');
    const runDrain = runStep('run');
    const swimDrain = runStep('swim');
    const heavyWalkDrain = runStep('walk', heavyInv);

    assert.ok(swampDrain > walkDrain, 'walking in swamp drains more energy than dry walking');
    assert.ok(runDrain > swampDrain, 'running drains more energy than swamp walking');
    assert.ok(
      Math.abs(swimDrain - runDrain) / runDrain < 0.25,
      'swimming drains roughly the same energy as running'
    );
    assert.ok(heavyWalkDrain > walkDrain, 'heavier backpack accelerates tiring');
  });

  it('gives seared steak long fullness longevity, chocolate quick short fullness, and raw mushroom small fullness', () => {
    const inv = createInventoryFromPacking({
      raw_steak: 1,
      chocolate_bar: 1,
    });
    inv.stacks.mushroom_kukeseen = 1;

    // Cook steak first
    const cooked = cookCampfireRecipe(inv, 'seared_steak');
    assert.equal(cooked.ok, true);

    const steakState = createInitialSurvivalState();
    steakState.stomachFullness = 20;
    eatFoodItem(steakState, inv, 'seared_steak');

    const chocState = createInitialSurvivalState();
    chocState.stomachFullness = 20;
    eatFoodItem(chocState, inv, 'chocolate_bar');

    const mushState = createInitialSurvivalState();
    mushState.stomachFullness = 20;
    eatFoodItem(mushState, inv, 'mushroom_kukeseen');

    assert.ok(
      steakState.stomachFullness > mushState.stomachFullness + 30,
      'steak should fill stomach much more than a single mushroom'
    );

    // Step 1.5 game hours and check fullness decay: chocolate burns noticeably faster than steak
    const steakBefore = steakState.stomachFullness;
    const chocBefore = chocState.stomachFullness;
    const emptyInv = createInventoryFromPacking({});
    for (let i = 0; i < 30; i++) {
      stepSurvivalTick(
        steakState,
        emptyInv,
        {
          locomotion: 'walk',
          weather: 'clear',
          windStrength: 0.5,
          hourOfDay: 12,
          shelter: 'outdoor',
          nearLitCampfireFactor: 0,
          flashlightActive: false,
        },
        1,
        0.05
      );
      stepSurvivalTick(
        chocState,
        emptyInv,
        {
          locomotion: 'walk',
          weather: 'clear',
          windStrength: 0.5,
          hourOfDay: 12,
          shelter: 'outdoor',
          nearLitCampfireFactor: 0,
          flashlightActive: false,
        },
        1,
        0.05
      );
    }
    const steakDrop = steakBefore - steakState.stomachFullness;
    const chocDrop = chocBefore - chocState.stomachFullness;
    assert.ok(
      chocDrop > steakDrop * 1.6,
      `chocolate should fade faster than steak (chocDrop=${chocDrop.toFixed(1)}, steakDrop=${steakDrop.toFixed(1)})`
    );
  });

  it('amplifies mushroom poison when cold, hungry, or sleep-deprived and makes Valge kärbseseen lethal', () => {
    const healthy = createInitialSurvivalState();
    const stressed = createInitialSurvivalState();
    stressed.stomachFullness = 5;
    stressed.bodyTempC = 34.8;
    stressed.awakeHours = 28;
    stressed.hydration = 20;

    assert.ok(
      computePoisonVulnerability(stressed) > computePoisonVulnerability(healthy) * 1.8,
      'vulnerability multiplier should compound cold + hunger + sleep deprivation'
    );

    // Valge kärbseseen kills the player over time
    const inv = createInventoryFromPacking({});
    inv.stacks.mushroom_valgekarbseseen = 1;
    const victim = createInitialSurvivalState();
    victim.stomachFullness = 15;
    eatFoodItem(victim, inv, 'mushroom_valgekarbseseen');

    let died = false;
    for (let i = 0; i < 400; i++) {
      const ev = stepSurvivalTick(
        victim,
        inv,
        {
          locomotion: 'idle',
          weather: 'clear',
          windStrength: 0.4,
          hourOfDay: 14,
          shelter: 'warm_house',
          nearLitCampfireFactor: 0,
          flashlightActive: false,
        },
        1,
        0.06
      );
      if (ev.died) {
        died = true;
        break;
      }
    }
    assert.equal(died, true, 'Valge kärbseseen should be able to kill the player');
  });

  it('prevents sleep from refilling energy to 100% if stomach is empty, empties mid-sleep, or sleeping cold', () => {
    const inv = createInventoryFromPacking({});

    // Case 1: Well-fed, warm sheltered bed -> reaches ~100%
    const warmFed = createInitialSurvivalState();
    warmFed.energy = 25;
    warmFed.stomachFullness = 85;
    const warmOutcome = previewSleepOutcome(warmFed, inv, 8, 22, 'clear', 0.4, 'warm_house', 0);
    assert.ok(
      warmOutcome.projectedEnergy >= 96,
      `warm fed sleep should fill energy, got ${warmOutcome.projectedEnergy}`
    );

    // Case 2: Empty stomach -> capped well below 100%
    const hungry = createInitialSurvivalState();
    hungry.energy = 25;
    hungry.stomachFullness = 0;
    const hungryOutcome = previewSleepOutcome(hungry, inv, 8, 22, 'clear', 0.4, 'warm_house', 0);
    assert.ok(
      hungryOutcome.projectedEnergy <= 70,
      `hungry sleep must cap energy, got ${hungryOutcome.projectedEnergy}`
    );
    assert.equal(hungryOutcome.stomachEmptyDuringSleep, true);

    // Case 3: Empties mid-sleep -> capped below 100%
    const midEmpty = createInitialSurvivalState();
    midEmpty.energy = 25;
    midEmpty.stomachFullness = 14;
    const midOutcome = previewSleepOutcome(midEmpty, inv, 8, 22, 'clear', 0.4, 'warm_house', 0);
    assert.ok(
      midOutcome.projectedEnergy < 85,
      `mid-sleep hunger should cap energy, got ${midOutcome.projectedEnergy}`
    );
    assert.equal(midOutcome.stomachEmptyDuringSleep, true);

    // Case 4: Cold storm outdoors without fire -> capped well below 100%
    const cold = createInitialSurvivalState();
    cold.energy = 25;
    cold.stomachFullness = 90;
    cold.wetness = 75;
    const coldOutcome = previewSleepOutcome(cold, inv, 8, 1, 'storm', 3.0, 'outdoor', 0);
    assert.ok(
      coldOutcome.projectedEnergy <= 75,
      `cold sleep must cap energy, got ${coldOutcome.projectedEnergy}`
    );
    assert.equal(coldOutcome.coldDuringSleep, true);

    // Direct stepSleepSlice matches preview logic
    stepSleepSlice(warmFed, 1, 23, 'clear', 0.4, 'warm_house', 0);
    assert.ok(warmFed.energy > 25);
  });

  it('supports flashlight battery reloading, campfire ignition, and discovery tracking', () => {
    const inv = createInventoryFromPacking({
      flashlight: 1,
      extra_battery: 1,
      lighter: 1,
    });
    inv.flashlightBattery = 15;
    const reload = loadFlashlightBattery(inv);
    assert.equal(reload.ok, true);
    assert.equal(inv.flashlightBattery, 100);
    assert.equal(inv.stacks.extra_battery ?? 0, 0);

    const ign = tryIgniteCampfire(inv, 'clear', 0.6, 0.2);
    assert.equal(ign.ok, true);
    assert.equal(ign.used, 'lighter');

    const tracker = new DiscoveryTracker();
    assert.equal(tracker.getDiscoveredPercent(), 0);
    tracker.markAroundWorldPos(0, 0);
    assert.ok(tracker.getDiscoveredPercent() > 0);
  });

  it('increases backpack weight and tiring load when gathering firewood, then lightens when stacking a campfire to light and cook', () => {
    const inv = createInventoryFromPacking({
      bottle_1l: 1,
      raw_steak: 1,
      lighter: 1,
    });
    const baseKg = computeInventoryWeightKg(inv);
    const baseBurden = computeWeightBurden(baseKg, 0);

    // Gather 4 pieces of split firewood (4 * 0.75 kg = +3.00 kg)
    inv.stacks.firewood = (inv.stacks.firewood ?? 0) + 4;
    const loadedKg = computeInventoryWeightKg(inv);
    const loadedBurden = computeWeightBurden(loadedKg, 0);
    assert.ok(Math.abs(loadedKg - (baseKg + 3.0)) < 0.001, '4 wood pieces should add 3.0 kg');
    assert.ok(
      loadedBurden.tiringMultiplier > baseBurden.tiringMultiplier,
      'carrying gathered wood should increase tiring speed'
    );

    // Place campfire (consumes 3 wood pieces = -2.25 kg)
    inv.stacks.firewood -= 3;
    const afterPlaceKg = computeInventoryWeightKg(inv);
    assert.ok(Math.abs(afterPlaceKg - (baseKg + 0.75)) < 0.001);

    // Light the placed campfire with lighter and sear raw steak
    const lit = tryIgniteCampfire(inv, 'clear', 0, 0.1);
    assert.equal(lit.ok, true);
    assert.equal(lit.used, 'lighter');
    const cooked = cookCampfireRecipe(inv, 'seared_steak');
    assert.equal(cooked.ok, true);
    assert.equal(inv.stacks.seared_steak, 1);
    assert.equal(inv.stacks.raw_steak ?? 0, 0);
  });
});

describe('Field Tent & Insulated Sleeping Bag', () => {
  it('tracks tent and sleeping bag pack weight and sleep gear bonuses accurately', () => {
    const emptyInv = createInventoryFromPacking({});
    assert.equal(hasTent(emptyInv), false);
    assert.equal(hasSleepingBag(emptyInv), false);
    assert.equal(computeSleepGearBonuses(emptyInv).warmthBonusC, 0);

    const campPack: PackingSelection = { tent: 1, sleeping_bag: 1 };
    const campWeight = computePackingWeightKg(campPack);
    assert.ok(Math.abs(campWeight - 3.0) < 0.001, `expected 3.00 kg, got ${campWeight}`);

    const campInv = createInventoryFromPacking(campPack);
    assert.equal(hasTent(campInv), true);
    assert.equal(hasSleepingBag(campInv), true);
    const bonuses = computeSleepGearBonuses(campInv);
    assert.equal(bonuses.warmthBonusC, 8.5);
    assert.equal(bonuses.hasSleepingBag, true);
    assert.ok(Math.abs(computeInventoryWeightKg(campInv) - 3.0) < 0.001);
  });

  it('wets clothes, warns, and caps energy when sleeping outdoors in rain, while a pitched tent stays dry and dries damp gear', () => {
    const plainInv = createInventoryFromPacking({});

    // Outdoor sleep in rain
    const outdoorState = createInitialSurvivalState();
    outdoorState.energy = 30;
    outdoorState.stomachFullness = 90;
    outdoorState.wetness = 10;
    const outdoorPreview = previewSleepOutcome(
      outdoorState,
      plainInv,
      6,
      23,
      'rain',
      1.6,
      'outdoor',
      0
    );
    assert.equal(outdoorPreview.exposedToRain, true);
    assert.ok(
      outdoorPreview.warnings.some((w) => w.toLowerCase().includes('rain')),
      'outdoor rain sleep must include a rain warning'
    );

    const outdoorLive = createInitialSurvivalState();
    outdoorLive.energy = 30;
    outdoorLive.stomachFullness = 90;
    outdoorLive.wetness = 10;
    for (let i = 0; i < 6; i++) {
      stepSleepSlice(outdoorLive, 1, (23 + i) % 24, 'rain', 1.6, 'outdoor', 0, 0);
    }
    assert.ok(
      outdoorLive.wetness > 75,
      `outdoor rain sleep should soak clothes, got wetness=${outdoorLive.wetness}`
    );

    // Pitched tent sleep in the exact same rainstorm
    const tentState = createInitialSurvivalState();
    tentState.energy = 30;
    tentState.stomachFullness = 90;
    tentState.wetness = 45;
    const tentPreview = previewSleepOutcome(
      tentState,
      plainInv,
      6,
      23,
      'rain',
      1.6,
      'tent',
      0
    );
    assert.equal(tentPreview.exposedToRain, false);
    assert.equal(
      tentPreview.warnings.some((w) => w.toLowerCase().includes('rain')),
      false,
      'pitched tent sleep in rain must NOT warn about rain exposure'
    );
    assert.ok(
      tentPreview.projectedEnergy > outdoorPreview.projectedEnergy + 15,
      `tent sleep (${tentPreview.projectedEnergy}) should recover far more energy than outdoor rain sleep (${outdoorPreview.projectedEnergy})`
    );

    const tentLive = createInitialSurvivalState();
    tentLive.energy = 30;
    tentLive.stomachFullness = 90;
    tentLive.wetness = 45;
    for (let i = 0; i < 6; i++) {
      stepSleepSlice(tentLive, 1, (23 + i) % 24, 'rain', 1.6, 'tent', 0, 0);
    }
    assert.ok(
      tentLive.wetness < 10,
      `pitched tent should keep rain out and dry damp clothes, got wetness=${tentLive.wetness}`
    );
  });

  it('adds insulated sleeping bag warmth inside a pitched tent for full warm recovery on a cold rainy night', () => {
    const noBagInv = createInventoryFromPacking({});
    const withBagInv = createInventoryFromPacking({ sleeping_bag: 1 });

    const baseState = createInitialSurvivalState();
    baseState.energy = 25;
    baseState.stomachFullness = 92;
    baseState.bodyTempC = 36.2;

    const bagOutcome = previewSleepOutcome(
      baseState,
      withBagInv,
      6,
      23,
      'rain',
      2.0,
      'tent',
      0
    );
    const noBagOutdoor = previewSleepOutcome(
      baseState,
      noBagInv,
      6,
      23,
      'rain',
      2.0,
      'outdoor',
      0
    );

    assert.equal(bagOutcome.hasSleepingBag, true);
    assert.equal(bagOutcome.sleepGearWarmthBonusC, 8.5);
    assert.equal(bagOutcome.exposedToRain, false);
    assert.equal(bagOutcome.coldDuringSleep, false);
    assert.equal(bagOutcome.warnings.length, 0);
    assert.ok(
      bagOutcome.projectedEnergy >= 96,
      `tent + sleeping bag in cold rain should give full rest, got ${bagOutcome.projectedEnergy}`
    );
    assert.ok(
      bagOutcome.projectedBodyTempC > noBagOutdoor.projectedBodyTempC + 0.5,
      `tent + sleeping bag (${bagOutcome.projectedBodyTempC}) must keep core body temperature significantly warmer than outdoor (${noBagOutdoor.projectedBodyTempC})`
    );
  });

  it('keeps the player dry, dries damp gear faster, and recovers physical tiredness faster while seated inside a pitched tent during rain', () => {
    const inv = createInventoryFromPacking({});

    const seated = createInitialSurvivalState();
    seated.wetness = 48;
    seated.physicalTiredness = 65;

    const standing = createInitialSurvivalState();
    standing.wetness = 48;
    standing.physicalTiredness = 65;

    for (let i = 0; i < 60; i++) {
      stepSurvivalTick(
        seated,
        inv,
        {
          locomotion: 'idle',
          weather: 'storm',
          windStrength: 2.8,
          hourOfDay: 15,
          shelter: 'tent',
          nearLitCampfireFactor: 0,
          flashlightActive: false,
          seatedInTent: true,
        },
        1,
        0.04
      );
      stepSurvivalTick(
        standing,
        inv,
        {
          locomotion: 'idle',
          weather: 'storm',
          windStrength: 2.8,
          hourOfDay: 15,
          shelter: 'outdoor',
          nearLitCampfireFactor: 0,
          flashlightActive: false,
          seatedInTent: false,
        },
        1,
        0.04
      );
    }

    assert.ok(
      seated.wetness < 44,
      `seated in tent should dry damp clothes even during a storm, got ${seated.wetness}`
    );
    assert.ok(
      standing.wetness > 55,
      `standing outdoors in storm should soak clothes, got ${standing.wetness}`
    );
    assert.ok(
      seated.physicalTiredness < standing.physicalTiredness - 5,
      `sitting inside tent should rest muscles faster (seated=${seated.physicalTiredness.toFixed(1)}, standing=${standing.physicalTiredness.toFixed(1)})`
    );
  });
});

describe('Waterproof Rain Jacket (Wear & Take Off)', () => {
  it('only grants rain & warmth protection when actively worn, and clears worn state when removed or dropped', () => {
    const inv = createInventoryFromPacking({ rain_jacket: 1 });
    assert.equal(hasRainJacket(inv), true);
    assert.equal(isWearingRainJacket(inv), false);
    assert.equal(computeClothingBonuses(inv).rainResistance, 0);
    assert.equal(computeClothingBonuses(inv).warmthBonusC, 0);

    // Put on rain jacket
    const wearRes = toggleWearClothing(inv, 'rain_jacket');
    assert.equal(wearRes, true);
    assert.equal(isWearingRainJacket(inv), true);
    assert.ok(computeClothingBonuses(inv).rainResistance >= 0.85);
    assert.ok(computeClothingBonuses(inv).warmthBonusC >= 1.2);

    // Compare soaking in rain: worn jacket vs stowed in pack
    const wornState = createInitialSurvivalState();
    const stowedInv = createInventoryFromPacking({ rain_jacket: 1 });
    const stowedState = createInitialSurvivalState();

    for (let i = 0; i < 60; i++) {
      stepSurvivalTick(
        wornState,
        inv,
        {
          locomotion: 'walk',
          weather: 'rain',
          windStrength: 1.5,
          hourOfDay: 13,
          shelter: 'outdoor',
          nearLitCampfireFactor: 0,
          flashlightActive: false,
        },
        1,
        0.04
      );
      stepSurvivalTick(
        stowedState,
        stowedInv,
        {
          locomotion: 'walk',
          weather: 'rain',
          windStrength: 1.5,
          hourOfDay: 13,
          shelter: 'outdoor',
          nearLitCampfireFactor: 0,
          flashlightActive: false,
        },
        1,
        0.04
      );
    }

    assert.ok(
      wornState.wetness < stowedState.wetness * 0.25,
      `wearing rain jacket must block most rain soaking (worn=${wornState.wetness.toFixed(1)}, stowed=${stowedState.wetness.toFixed(1)})`
    );

    // Take off jacket -> bonuses drop back to 0
    const offRes = toggleWearClothing(inv, 'rain_jacket');
    assert.equal(offRes, false);
    assert.equal(isWearingRainJacket(inv), false);
    assert.equal(computeClothingBonuses(inv).rainResistance, 0);

    // Wearing then dropping jacket clears worn state cleanly
    toggleWearClothing(inv, 'rain_jacket');
    assert.equal(isWearingRainJacket(inv), true);
    removeStackItem(inv, 'rain_jacket', 1);
    assert.equal(hasRainJacket(inv), false);
    assert.equal(isWearingRainJacket(inv), false);
    assert.equal(computeClothingBonuses(inv).rainResistance, 0);
  });
});

describe('Dynamic 3D Ambient Soundscape Ecology', () => {
  it('triggers forest birds at dawn/day, crickets at dusk/night, and buzzing insects in swamp/mist, while muting insects inside a tent', () => {
    const forestDawn = computeAmbientSoundscapeProfile('forest', 'clear', 6.5, 'outdoor');
    const forestNight = computeAmbientSoundscapeProfile('forest', 'clear', 23.0, 'outdoor');
    const forestStorm = computeAmbientSoundscapeProfile('forest', 'storm', 10.0, 'outdoor');
    const villageNight = computeAmbientSoundscapeProfile('village', 'clear', 22.5, 'outdoor');
    const swampMist = computeAmbientSoundscapeProfile('swamp', 'mist', 17.5, 'outdoor');
    const swampTent = computeAmbientSoundscapeProfile('swamp', 'mist', 17.5, 'tent');

    assert.ok(
      forestDawn.birdRatePerMin > 8 && forestDawn.birdRatePerMin > forestNight.birdRatePerMin * 5,
      `birds should sing strongly at dawn in forest (dawn=${forestDawn.birdRatePerMin}, night=${forestNight.birdRatePerMin})`
    );
    assert.equal(forestStorm.birdRatePerMin, 0, 'birds should take cover during thunderstorms');
    assert.ok(
      villageNight.cricketRatePerMin > 10 && villageNight.cricketRatePerMin > forestDawn.cricketRatePerMin * 3,
      `crickets should chirp actively at night (night=${villageNight.cricketRatePerMin}, dawn=${forestDawn.cricketRatePerMin})`
    );
    assert.ok(
      swampMist.insectRatePerMin > 10 && swampMist.insectRatePerMin > forestDawn.insectRatePerMin,
      `buzzing insects should peak in misty peat bog (swamp=${swampMist.insectRatePerMin})`
    );
    assert.equal(
      swampTent.insectRatePerMin,
      0,
      'zipped tent shelter should keep buzzing insects outside'
    );
    assert.ok(
      swampTent.birdGain < swampMist.birdGain,
      'tent canvas should gently muffle outdoor bird calls'
    );
  });
});


