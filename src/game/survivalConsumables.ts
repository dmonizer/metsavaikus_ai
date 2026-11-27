import {
  addItemToInventory,
  computeInventoryWeightKg,
  consumeEdibleMushrooms,
  InventoryState,
  ITEM_CATALOG,
  ItemId,
  removeStackItem,
  WaterQuality,
} from './itemCatalog';
import { clamp } from '../world/terrainMath';
import { getItemName, t } from '../i18n/i18n';
import { PlayerSurvivalState } from './survivalTypes';
import { classifyHypothermia, createPoisonEffect } from './survivalVitals';

export function eatFoodItem(
  state: PlayerSurvivalState,
  inv: InventoryState,
  itemId: ItemId
): { ok: boolean; message: string; poisoned: boolean } {
  const def = ITEM_CATALOG[itemId];
  if (!def?.food) return { ok: false, message: t('surv.cannotEat'), poisoned: false };
  if (!removeStackItem(inv, itemId, 1)) {
    return { ok: false, message: t('surv.noneLeft'), poisoned: false };
  }

  const food = def.food;
  const prevFill = Math.max(0, state.stomachFullness);
  const addedFill = Math.max(0, food.fullness);
  const nextFill = clamp(prevFill + addedFill, 0, 100);

  // Blend digestionBurnRate weighted by existing fullness vs newly eaten food
  if (prevFill + addedFill > 0.01) {
    state.digestionBurnRate =
      (prevFill * state.digestionBurnRate + addedFill * food.burnRate) / (prevFill + addedFill);
  } else {
    state.digestionBurnRate = food.burnRate;
  }
  state.stomachFullness = nextFill;

  if (food.energyBoost) {
    state.energy = clamp(state.energy + food.energyBoost, 0, 100);
  }
  if (food.hydrationDelta) {
    state.hydration = clamp(state.hydration + food.hydrationDelta, 0, 100);
  }
  if (food.warmthBoostC) {
    state.bodyTempC = clamp(state.bodyTempC + food.warmthBoostC, 32.2, 37.3);
  }

  state.backpackWeightKg = computeInventoryWeightKg(inv);
  const locName = getItemName(itemId);
  const poisonName = def.estonian ?? locName;
  let poisoned = false;
  let message = t('surv.ateNormal', { name: locName, fill: Math.round(addedFill) });

  if (food.poison) {
    poisoned = true;
    const effect = createPoisonEffect(food.poison.kind, food.poison.severity);
    state.poisons.push(effect);
    state.nausea = clamp(state.nausea + effect.nauseaBoost * 0.4, 0, 100);
    if (food.poison.kind === 'destroying_angel') {
      message = t('surv.ateDestroyingAngel', { name: poisonName });
    } else if (food.poison.kind === 'fly_agaric') {
      message = t('surv.ateFlyAgaric', { name: poisonName });
    } else {
      message = t('surv.ateBitter', { name: locName });
    }
  } else if (food.burnRate >= 1.8) {
    message = t('surv.ateFast', { name: locName, fill: Math.round(addedFill) });
  } else if (food.burnRate <= 0.65) {
    message = t('surv.ateSlow', { name: locName, fill: Math.round(addedFill) });
  }

  return { ok: true, message, poisoned };
}

export function drinkFromBottle(
  state: PlayerSurvivalState,
  inv: InventoryState,
  bottleUid: string
): { ok: boolean; message: string; poisoned: boolean; tempDropC: number } {
  const bottle = inv.bottles.find((b) => b.uid === bottleUid);
  if (!bottle) {
    return { ok: false, message: t('surv.bottleNotFound'), poisoned: false, tempDropC: 0 };
  }
  if (bottle.waterLiters <= 0.001) {
    return {
      ok: false,
      message: t('surv.bottleEmpty'),
      poisoned: false,
      tempDropC: 0,
    };
  }

  const def = ITEM_CATALOG[bottle.itemId];
  const sipTarget = def.waterContainer?.sipLiters ?? 0.25;
  const drunkL = Math.min(bottle.waterLiters, sipTarget);
  bottle.waterLiters = Math.max(0, Math.round((bottle.waterLiters - drunkL) * 100) / 100);

  // Hydration + temporary ingested water heaviness
  const hydrationGain = drunkL * 88; // 0.25 L => +22% hydration
  state.hydration = clamp(state.hydration + hydrationGain, 0, 100);
  state.waterStomachLoadL = clamp(state.waterStomachLoadL + drunkL, 0, 2.0);
  state.backpackWeightKg = computeInventoryWeightKg(inv);

  // Cold water lowers core body temp; warm boiled water warms gently
  let tempDropC = 0;
  if (bottle.waterTempC < 16) {
    const chillFactor = clamp((16 - bottle.waterTempC) / 12, 0.2, 1.3);
    tempDropC = Math.round(drunkL * 1.45 * chillFactor * 100) / 100; // ~0.3°C per cold sip
    state.bodyTempC = clamp(state.bodyTempC - tempDropC, 32.2, 37.4);
    state.hypothermiaStage = classifyHypothermia(state.bodyTempC);
  } else if (bottle.waterTempC > 32) {
    const warmGain = drunkL * 0.85;
    state.bodyTempC = clamp(state.bodyTempC + warmGain, 32.2, 37.3);
    state.hypothermiaStage = classifyHypothermia(state.bodyTempC);
  }

  let poisoned = false;
  const chillSuffix =
    tempDropC >= 0.15 ? t('surv.drankChill', { temp: tempDropC.toFixed(1) }) : '';
  let message = t('surv.drank', {
    liters: drunkL.toFixed(2),
    hyd: Math.round(hydrationGain),
    chill: chillSuffix,
  });

  if (bottle.waterQuality === 'stale') {
    poisoned = true;
    const eff = createPoisonEffect('stale_water', 1.0);
    state.poisons.push(eff);
    state.nausea = clamp(state.nausea + 36, 0, 100);
    message = t('surv.drankStale');
  } else if (bottle.waterQuality === 'bog') {
    poisoned = true;
    const eff = createPoisonEffect('bog_water', 0.85);
    state.poisons.push(eff);
    state.nausea = clamp(state.nausea + 20, 0, 100);
    message = t('surv.drankBog');
  } else if (state.waterStomachLoadL > 0.7) {
    message += t('surv.drankSloshing');
  }

  return { ok: true, message, poisoned, tempDropC };
}

export function refillBottlesFromSource(
  inv: InventoryState,
  source: 'clean_well' | 'stale_well' | 'bog_lake'
): { refilledCount: number; message: string } {
  const quality: WaterQuality =
    source === 'clean_well' ? 'clean' : source === 'stale_well' ? 'stale' : 'bog';
  const waterTempC = source === 'clean_well' ? 6 : source === 'stale_well' ? 8 : 7;

  let refilledCount = 0;
  for (const b of inv.bottles) {
    if (b.waterLiters < b.capacityLiters - 0.01 || (source === 'clean_well' && b.waterQuality !== 'clean')) {
      b.waterLiters = b.capacityLiters;
      b.waterQuality = quality;
      b.waterTempC = waterTempC;
      refilledCount++;
    }
  }

  if (refilledCount === 0) {
    if (inv.bottles.length === 0) {
      return { refilledCount: 0, message: t('surv.noBottlesInPack') };
    }
    return { refilledCount: 0, message: t('surv.bottlesAlreadyFull') };
  }

  if (source === 'clean_well') {
    return {
      refilledCount,
      message:
        refilledCount === 1
          ? t('surv.refillCleanOne')
          : t('surv.refillCleanMany', { count: refilledCount }),
    };
  }
  if (source === 'stale_well') {
    return {
      refilledCount,
      message:
        refilledCount === 1
          ? t('surv.refillStaleOne')
          : t('surv.refillStaleMany', { count: refilledCount }),
    };
  }
  return {
    refilledCount,
    message:
      refilledCount === 1
        ? t('surv.refillBogOne')
        : t('surv.refillBogMany', { count: refilledCount }),
  };
}

export function boilBottleAtCampfire(
  inv: InventoryState,
  bottleUid: string
): { ok: boolean; message: string } {
  const b = inv.bottles.find((item) => item.uid === bottleUid);
  if (!b || b.waterLiters <= 0.001) {
    return { ok: false, message: t('surv.cannotBoilEmpty') };
  }
  const wasImpure = b.waterQuality !== 'clean';
  b.waterQuality = 'clean';
  b.waterTempC = 46;
  const name = getItemName(b.itemId);
  return {
    ok: true,
    message: wasImpure
      ? t('surv.boiledPurified', { name })
      : t('surv.warmedBottle', { name }),
  };
}

export function cookCampfireRecipe(
  inv: InventoryState,
  recipe: 'seared_steak' | 'roasted_mushrooms'
): { ok: boolean; message: string } {
  if (recipe === 'seared_steak') {
    if (!removeStackItem(inv, 'raw_steak', 1)) {
      return { ok: false, message: t('surv.needRawSteak') };
    }
    addItemToInventory(inv, 'seared_steak', 1);
    return { ok: true, message: t('surv.cookedSteak') };
  }
  if (!consumeEdibleMushrooms(inv, 3)) {
    return { ok: false, message: t('surv.needEdibleMushrooms') };
  }
  addItemToInventory(inv, 'roasted_mushrooms', 1);
  return { ok: true, message: t('surv.cookedMushrooms') };
}

export function loadFlashlightBattery(inv: InventoryState): { ok: boolean; message: string } {
  if ((inv.stacks.flashlight ?? 0) <= 0) {
    return { ok: false, message: t('surv.notCarryingFlashlight') };
  }
  if (inv.flashlightBattery >= 98) {
    return { ok: false, message: t('surv.batteryFull') };
  }
  if (!removeStackItem(inv, 'extra_battery', 1)) {
    return { ok: false, message: t('surv.noExtraBatteries') };
  }
  inv.flashlightBattery = 100;
  return { ok: true, message: t('surv.loadedBattery') };
}

export function tryIgniteCampfire(
  inv: InventoryState,
  weather: 'clear' | 'mist' | 'rain' | 'storm',
  wetness: number,
  rngVal = Math.random()
): { ok: boolean; used: 'lighter' | 'matches' | null; message: string } {
  const isHarsh = weather === 'storm' || weather === 'rain' || wetness > 55;
  if (inv.lighterUses > 0) {
    inv.lighterUses--;
    if (inv.lighterUses <= 0 && (inv.stacks.lighter ?? 0) > 0) {
      removeStackItem(inv, 'lighter', 1);
    }
    const chance = weather === 'storm' ? 0.92 : 0.99;
    if (rngVal <= chance) {
      return { ok: true, used: 'lighter', message: t('surv.litLighter') };
    }
    return { ok: false, used: 'lighter', message: t('surv.lighterGust') };
  }

  if (inv.matchStrikes > 0) {
    inv.matchStrikes--;
    const boxesNeeded = Math.ceil(inv.matchStrikes / 12);
    if ((inv.stacks.matches ?? 0) > boxesNeeded) {
      removeStackItem(inv, 'matches', (inv.stacks.matches ?? 0) - boxesNeeded);
    }
    const chance = weather === 'storm' ? 0.35 : isHarsh ? 0.62 : 0.92;
    if (rngVal <= chance) {
      return { ok: true, used: 'matches', message: t('surv.litMatch') };
    }
    return {
      ok: false,
      used: 'matches',
      message: t('surv.matchSnuffed'),
    };
  }

  return {
    ok: false,
    used: null,
    message: t('surv.needFireStarter'),
  };
}
