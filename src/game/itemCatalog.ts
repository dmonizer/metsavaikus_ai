import { MUSHROOM_SPECIES_INFO, MushroomSpecies } from './gameLogic';

export type ItemCategory =
  | 'navigation'
  | 'water'
  | 'food'
  | 'gear'
  | 'mushroom'
  | 'tools'
  | 'clothing'
  | 'camp'
  | 'firearms';

export type WaterQuality = 'clean' | 'bog' | 'stale';
export type NavigationMode = 'none' | 'compass' | 'map' | 'both';
export type PoisonKind = 'bitter' | 'fly_agaric' | 'destroying_angel' | 'stale_water' | 'bog_water';

export type ItemId =
  | 'compass'
  | 'paper_map'
  | 'bottle_05l'
  | 'bottle_1l'
  | 'bottle_2l'
  | 'raw_steak'
  | 'seared_steak'
  | 'smoked_sausage'
  | 'rye_bread'
  | 'chocolate_bar'
  | 'dried_berries'
  | 'roasted_mushrooms'
  | 'flashlight'
  | 'extra_battery'
  | 'lighter'
  | 'matches'
  | 'firewood'
  | 'tent'
  | 'sleeping_bag'
  | 'rain_jacket'
  | 'mushroom_kukeseen'
  | 'mushroom_kivipuravik'
  | 'mushroom_kasepuravik'
  | 'mushroom_kuuseriisikas'
  | 'mushroom_sapipuravik'
  | 'mushroom_punakarbseseen'
  | 'mushroom_valgekarbseseen';

export interface FoodTrait {
  /** Immediate stomach fullness restored (0-100 scale) */
  fullness: number;
  /** Relative stomach drain multiplier: <1 stays longer (steak), >1 burns faster (chocolate) */
  burnRate: number;
  /** Optional quick energy lift (e.g. chocolate sugar rush) */
  energyBoost?: number;
  /** Optional hydration delta */
  hydrationDelta?: number;
  /** Optional core body temperature bump in °C (hot cooked meal) */
  warmthBoostC?: number;
  /** Short human label for calorie longevity */
  stayingPower: 'Short' | 'Moderate' | 'Long';
  /** Optional toxicity profile */
  poison?: {
    kind: PoisonKind;
    severity: number;
  };
  mushroomSpecies?: MushroomSpecies;
  edibleForCooking?: boolean;
}

export interface WaterContainerTrait {
  capacityLiters: number;
  sipLiters: number;
}

export interface NavigationTrait {
  kind: 'compass' | 'map';
}

export interface LightSourceTrait {
  maxBattery: number;
  drainPerGameHour: number;
}

export interface BatteryTrait {
  rechargeAmount: number;
}

export interface FireStarterTrait {
  kind: 'lighter' | 'matches';
  usesPerItem: number;
  stormReliability: number;
}

/** Extensible optional traits ready for future gear additions (extra clothes, sleeping bag, knife, firearm) */
export interface ClothingTrait {
  warmthBonusC: number;
  rainResistance: number;
}

export interface SleepGearTrait {
  outdoorWarmthBonusC: number;
  energyCapBonus: number;
}

export interface ToolTrait {
  kind: string;
}

export interface WeaponTrait {
  kind: string;
  caliber?: string;
}

export interface FuelTrait {
  burnValue: number;
}

export interface ItemDefinition {
  id: ItemId;
  name: string;
  estonian?: string;
  category: ItemCategory;
  /** Base dry weight in kg (for water bottles, empty bottle weight; water adds 1.0 kg/L) */
  weightKg: number;
  packable: boolean;
  defaultPackQty: number;
  maxPackQty: number;
  description: string;
  navigation?: NavigationTrait;
  waterContainer?: WaterContainerTrait;
  food?: FoodTrait;
  lightSource?: LightSourceTrait;
  battery?: BatteryTrait;
  fireStarter?: FireStarterTrait;
  fuel?: FuelTrait;
  clothing?: ClothingTrait;
  sleepGear?: SleepGearTrait;
  tool?: ToolTrait;
  weapon?: WeaponTrait;
}

export const CAMPFIRE_WOOD_COST = 3;

export interface WaterBottleInstance {
  uid: string;
  itemId: 'bottle_05l' | 'bottle_1l' | 'bottle_2l';
  capacityLiters: number;
  waterLiters: number;
  waterQuality: WaterQuality;
  waterTempC: number;
}

export interface InventoryState {
  stacks: Partial<Record<ItemId, number>>;
  bottles: WaterBottleInstance[];
  wornItems: Partial<Record<ItemId, boolean>>;
  flashlightBattery: number;
  lighterUses: number;
  matchStrikes: number;
  nextBottleUid: number;
}

export const MUSHROOM_TO_ITEM_ID: Record<MushroomSpecies, ItemId> = {
  kukeseen: 'mushroom_kukeseen',
  kivipuravik: 'mushroom_kivipuravik',
  kasepuravik: 'mushroom_kasepuravik',
  kuuseriisikas: 'mushroom_kuuseriisikas',
  sapipuravik: 'mushroom_sapipuravik',
  punakarbseseen: 'mushroom_punakarbseseen',
  valgekarbseseen: 'mushroom_valgekarbseseen',
};

export const ITEM_CATALOG: Record<ItemId, ItemDefinition> = {
  // Navigation
  compass: {
    id: 'compass',
    name: 'Magnetic Compass',
    estonian: 'Kompass',
    category: 'navigation',
    weightKg: 0.07,
    packable: true,
    defaultPackQty: 1,
    maxPackQty: 1,
    description: 'Shows magnetic North and live bearing. No terrain map.',
    navigation: { kind: 'compass' },
  },
  paper_map: {
    id: 'paper_map',
    name: 'Paper Topographic Map',
    estonian: 'Kaart',
    category: 'navigation',
    weightKg: 0.08,
    packable: true,
    defaultPackQty: 1,
    maxPackQty: 1,
    description: 'Fixed North-up countryside map. Does not rotate or show GPS position.',
    navigation: { kind: 'map' },
  },

  // Water Containers (packed full of clean spring water at 12°C)
  bottle_05l: {
    id: 'bottle_05l',
    name: '0.5 L Trail Flask',
    category: 'water',
    weightKg: 0.09,
    packable: true,
    defaultPackQty: 0,
    maxPackQty: 4,
    description: 'Compact 0.5 L flask (0.09 kg empty, 0.59 kg full).',
    waterContainer: { capacityLiters: 0.5, sipLiters: 0.25 },
  },
  bottle_1l: {
    id: 'bottle_1l',
    name: '1.0 L Field Canteen',
    category: 'water',
    weightKg: 0.15,
    packable: true,
    defaultPackQty: 1,
    maxPackQty: 3,
    description: 'Balanced 1.0 L canteen (0.15 kg empty, 1.15 kg full).',
    waterContainer: { capacityLiters: 1.0, sipLiters: 0.25 },
  },
  bottle_2l: {
    id: 'bottle_2l',
    name: '2.0 L Expedition Bottle',
    category: 'water',
    weightKg: 0.24,
    packable: true,
    defaultPackQty: 0,
    maxPackQty: 2,
    description: 'Large 2.0 L water jug (0.24 kg empty, 2.24 kg full). Heavy when filled.',
    waterContainer: { capacityLiters: 2.0, sipLiters: 0.25 },
  },

  // Food & Rations
  raw_steak: {
    id: 'raw_steak',
    name: 'Raw Venison Steak',
    estonian: 'Toores liha',
    category: 'food',
    weightKg: 0.45,
    packable: true,
    defaultPackQty: 1,
    maxPackQty: 4,
    description: 'Cook over a lit campfire for a hearty, slow-burning meal.',
    food: {
      fullness: 24,
      burnRate: 0.78,
      stayingPower: 'Moderate',
      poison: { kind: 'bitter', severity: 0.65 },
    },
  },
  seared_steak: {
    id: 'seared_steak',
    name: 'Seared Venison Steak',
    estonian: 'Praetud liha',
    category: 'food',
    weightKg: 0.40,
    packable: false,
    defaultPackQty: 0,
    maxPackQty: 6,
    description: 'Rich campfire-seared steak. High calories that keep you full for hours.',
    food: {
      fullness: 58,
      burnRate: 0.52,
      energyBoost: 4,
      warmthBoostC: 0.28,
      stayingPower: 'Long',
    },
  },
  smoked_sausage: {
    id: 'smoked_sausage',
    name: 'Smoked Country Sausage',
    estonian: 'Suitsuvorst',
    category: 'food',
    weightKg: 0.32,
    packable: true,
    defaultPackQty: 0,
    maxPackQty: 4,
    description: 'Ready-to-eat cured Baltic sausage. Dense calories, long staying power.',
    food: {
      fullness: 44,
      burnRate: 0.62,
      hydrationDelta: -4,
      stayingPower: 'Long',
    },
  },
  rye_bread: {
    id: 'rye_bread',
    name: 'Dark Rye Bread',
    estonian: 'Must leib',
    category: 'food',
    weightKg: 0.42,
    packable: true,
    defaultPackQty: 1,
    maxPackQty: 4,
    description: 'Dense Estonian sourdough rye loaf. Steady, dependable energy.',
    food: {
      fullness: 36,
      burnRate: 0.82,
      hydrationDelta: -3,
      stayingPower: 'Long',
    },
  },
  chocolate_bar: {
    id: 'chocolate_bar',
    name: 'Dark Chocolate Bar',
    estonian: 'Šokolaad',
    category: 'food',
    weightKg: 0.10,
    packable: true,
    defaultPackQty: 1,
    maxPackQty: 6,
    description: 'Light & calorie-dense quick boost, but burns off much faster than a meal.',
    food: {
      fullness: 36,
      burnRate: 2.25,
      energyBoost: 13,
      stayingPower: 'Short',
    },
  },
  dried_berries: {
    id: 'dried_berries',
    name: 'Dried Forest Berries',
    estonian: 'Kuivatatud marjad',
    category: 'food',
    weightKg: 0.14,
    packable: true,
    defaultPackQty: 0,
    maxPackQty: 5,
    description: 'Lingonberries and bilberries. Light trail snack with a touch of moisture.',
    food: {
      fullness: 18,
      burnRate: 1.35,
      energyBoost: 4,
      hydrationDelta: 5,
      stayingPower: 'Short',
    },
  },
  roasted_mushrooms: {
    id: 'roasted_mushrooms',
    name: 'Roasted Mushroom Skewer',
    estonian: 'Röstitud seened',
    category: 'food',
    weightKg: 0.22,
    packable: false,
    defaultPackQty: 0,
    maxPackQty: 8,
    description: 'Campfire-roasted wild mushrooms. Warm and far more filling than raw.',
    food: {
      fullness: 30,
      burnRate: 0.85,
      warmthBoostC: 0.22,
      hydrationDelta: 3,
      stayingPower: 'Moderate',
    },
  },

  // Light & Fire Gear
  flashlight: {
    id: 'flashlight',
    name: 'Field Flashlight',
    estonian: 'Taskulamp',
    category: 'gear',
    weightKg: 0.35,
    packable: true,
    defaultPackQty: 1,
    maxPackQty: 1,
    description: 'Enables [L] night beam. Runs on replaceable AA battery packs.',
    lightSource: { maxBattery: 100, drainPerGameHour: 22 },
  },
  extra_battery: {
    id: 'extra_battery',
    name: 'Extra Batteries',
    estonian: 'Patareid',
    category: 'gear',
    weightKg: 0.10,
    packable: true,
    defaultPackQty: 1,
    maxPackQty: 6,
    description: 'Restores 100% flashlight charge from your backpack.',
    battery: { rechargeAmount: 100 },
  },
  lighter: {
    id: 'lighter',
    name: 'Windproof Lighter',
    estonian: 'Välgumihkel',
    category: 'gear',
    weightKg: 0.04,
    packable: true,
    defaultPackQty: 1,
    maxPackQty: 3,
    description: 'Reliable campfire ignition even in damp wind (35 strikes).',
    fireStarter: { kind: 'lighter', usesPerItem: 35, stormReliability: 0.94 },
  },
  matches: {
    id: 'matches',
    name: 'Safety Matchbox',
    estonian: 'Tikud',
    category: 'gear',
    weightKg: 0.02,
    packable: true,
    defaultPackQty: 0,
    maxPackQty: 6,
    description: 'Featherweight 12-match box. Can fizzle in heavy rain or storm wind.',
    fireStarter: { kind: 'matches', usesPerItem: 12, stormReliability: 0.38 },
  },
  firewood: {
    id: 'firewood',
    name: 'Split Firewood',
    estonian: 'Küttepuu',
    category: 'gear',
    weightKg: 0.75,
    packable: false,
    defaultPackQty: 0,
    maxPackQty: 20,
    description:
      'Dry split timber kicked from fallen treestumps. Heavy to carry; stack 3 pieces [G] or from Pack to build a campfire.',
    fuel: { burnValue: 1 },
  },

  // Camp & Shelter
  tent: {
    id: 'tent',
    name: 'Waterproof Field Tent',
    estonian: 'Matkatelk',
    category: 'camp',
    weightKg: 1.85,
    packable: true,
    defaultPackQty: 0,
    maxPackQty: 1,
    description:
      'Compact waterproof A-frame trekking tent. Pitch on dry ground to sleep completely dry in rain and wind.',
  },
  sleeping_bag: {
    id: 'sleeping_bag',
    name: 'Insulated Sleeping Bag',
    estonian: 'Magamiskott',
    category: 'camp',
    weightKg: 1.15,
    packable: true,
    defaultPackQty: 0,
    maxPackQty: 1,
    description:
      'Warm three-season down bag (+8.5°C sleep warmth). Lets you sleep anywhere dry and keeps you warm through cold nights.',
    sleepGear: { outdoorWarmthBonusC: 8.5, energyCapBonus: 10 },
  },

  // Clothing & Rain Gear
  rain_jacket: {
    id: 'rain_jacket',
    name: 'Waterproof Rain Jacket',
    estonian: 'Vihmajope',
    category: 'clothing',
    weightKg: 0.48,
    packable: true,
    defaultPackQty: 0,
    maxPackQty: 1,
    description:
      'Hooded Baltic hardshell shell jacket. Put on [J] or from Pack in rain to block 88% of soaking and windchill; take off when sunny.',
    clothing: { warmthBonusC: 1.4, rainResistance: 0.88 },
  },

  // Gathered Wild Mushrooms (all 7 Estonian species)
  mushroom_kukeseen: {
    id: 'mushroom_kukeseen',
    name: MUSHROOM_SPECIES_INFO.kukeseen.english,
    estonian: MUSHROOM_SPECIES_INFO.kukeseen.estonian,
    category: 'mushroom',
    weightKg: 0.06,
    packable: false,
    defaultPackQty: 0,
    maxPackQty: 99,
    description: MUSHROOM_SPECIES_INFO.kukeseen.note,
    food: {
      fullness: 9,
      burnRate: 1.15,
      hydrationDelta: 2,
      stayingPower: 'Short',
      mushroomSpecies: 'kukeseen',
      edibleForCooking: true,
    },
  },
  mushroom_kivipuravik: {
    id: 'mushroom_kivipuravik',
    name: MUSHROOM_SPECIES_INFO.kivipuravik.english,
    estonian: MUSHROOM_SPECIES_INFO.kivipuravik.estonian,
    category: 'mushroom',
    weightKg: 0.11,
    packable: false,
    defaultPackQty: 0,
    maxPackQty: 99,
    description: MUSHROOM_SPECIES_INFO.kivipuravik.note,
    food: {
      fullness: 12,
      burnRate: 1.05,
      hydrationDelta: 2,
      stayingPower: 'Moderate',
      mushroomSpecies: 'kivipuravik',
      edibleForCooking: true,
    },
  },
  mushroom_kasepuravik: {
    id: 'mushroom_kasepuravik',
    name: MUSHROOM_SPECIES_INFO.kasepuravik.english,
    estonian: MUSHROOM_SPECIES_INFO.kasepuravik.estonian,
    category: 'mushroom',
    weightKg: 0.09,
    packable: false,
    defaultPackQty: 0,
    maxPackQty: 99,
    description: MUSHROOM_SPECIES_INFO.kasepuravik.note,
    food: {
      fullness: 10,
      burnRate: 1.1,
      hydrationDelta: 2,
      stayingPower: 'Short',
      mushroomSpecies: 'kasepuravik',
      edibleForCooking: true,
    },
  },
  mushroom_kuuseriisikas: {
    id: 'mushroom_kuuseriisikas',
    name: MUSHROOM_SPECIES_INFO.kuuseriisikas.english,
    estonian: MUSHROOM_SPECIES_INFO.kuuseriisikas.estonian,
    category: 'mushroom',
    weightKg: 0.08,
    packable: false,
    defaultPackQty: 0,
    maxPackQty: 99,
    description: MUSHROOM_SPECIES_INFO.kuuseriisikas.note,
    food: {
      fullness: 9,
      burnRate: 1.1,
      hydrationDelta: 2,
      stayingPower: 'Short',
      mushroomSpecies: 'kuuseriisikas',
      edibleForCooking: true,
    },
  },
  mushroom_sapipuravik: {
    id: 'mushroom_sapipuravik',
    name: MUSHROOM_SPECIES_INFO.sapipuravik.english,
    estonian: MUSHROOM_SPECIES_INFO.sapipuravik.estonian,
    category: 'mushroom',
    weightKg: 0.10,
    packable: false,
    defaultPackQty: 0,
    maxPackQty: 99,
    description: MUSHROOM_SPECIES_INFO.sapipuravik.note,
    food: {
      fullness: 3,
      burnRate: 1.2,
      stayingPower: 'Short',
      poison: { kind: 'bitter', severity: 1.0 },
      mushroomSpecies: 'sapipuravik',
    },
  },
  mushroom_punakarbseseen: {
    id: 'mushroom_punakarbseseen',
    name: MUSHROOM_SPECIES_INFO.punakarbseseen.english,
    estonian: MUSHROOM_SPECIES_INFO.punakarbseseen.estonian,
    category: 'mushroom',
    weightKg: 0.09,
    packable: false,
    defaultPackQty: 0,
    maxPackQty: 99,
    description: MUSHROOM_SPECIES_INFO.punakarbseseen.note,
    food: {
      fullness: 4,
      burnRate: 1.3,
      stayingPower: 'Short',
      poison: { kind: 'fly_agaric', severity: 1.0 },
      mushroomSpecies: 'punakarbseseen',
    },
  },
  mushroom_valgekarbseseen: {
    id: 'mushroom_valgekarbseseen',
    name: MUSHROOM_SPECIES_INFO.valgekarbseseen.english,
    estonian: MUSHROOM_SPECIES_INFO.valgekarbseseen.estonian,
    category: 'mushroom',
    weightKg: 0.08,
    packable: false,
    defaultPackQty: 0,
    maxPackQty: 99,
    description: MUSHROOM_SPECIES_INFO.valgekarbseseen.note,
    food: {
      fullness: 4,
      burnRate: 1.1,
      stayingPower: 'Short',
      poison: { kind: 'destroying_angel', severity: 1.0 },
      mushroomSpecies: 'valgekarbseseen',
    },
  },
};

export const PACKABLE_ITEMS: ItemDefinition[] = Object.values(ITEM_CATALOG).filter(
  (item) => item.packable
);

export type PackingSelection = Record<string, number>;

export function createDefaultPackingSelection(): PackingSelection {
  const sel: PackingSelection = {};
  for (const item of PACKABLE_ITEMS) {
    sel[item.id] = item.defaultPackQty;
  }
  return sel;
}

export function getBottleWeightKg(bottle: WaterBottleInstance): number {
  const def = ITEM_CATALOG[bottle.itemId];
  return def.weightKg + Math.max(0, bottle.waterLiters);
}

export function getPackedItemUnitWeightKg(def: ItemDefinition): number {
  if (def.waterContainer) {
    // Packed bottles start full of clean water (1.0 kg per liter)
    return def.weightKg + def.waterContainer.capacityLiters;
  }
  return def.weightKg;
}

export function computePackingWeightKg(selection: PackingSelection): number {
  let total = 0;
  for (const item of PACKABLE_ITEMS) {
    const qty = Math.max(0, Math.min(item.maxPackQty, Math.floor(selection[item.id] ?? 0)));
    total += qty * getPackedItemUnitWeightKg(item);
  }
  return Math.round(total * 100) / 100;
}

export function createInventoryFromPacking(selection: PackingSelection): InventoryState {
  const inv: InventoryState = {
    stacks: {},
    bottles: [],
    wornItems: {},
    flashlightBattery: 0,
    lighterUses: 0,
    matchStrikes: 0,
    nextBottleUid: 1,
  };

  for (const item of PACKABLE_ITEMS) {
    const qty = Math.max(0, Math.min(item.maxPackQty, Math.floor(selection[item.id] ?? 0)));
    if (qty <= 0) continue;

    if (item.waterContainer) {
      for (let i = 0; i < qty; i++) {
        inv.bottles.push({
          uid: `b${inv.nextBottleUid++}`,
          itemId: item.id as 'bottle_05l' | 'bottle_1l' | 'bottle_2l',
          capacityLiters: item.waterContainer.capacityLiters,
          waterLiters: item.waterContainer.capacityLiters,
          waterQuality: 'clean',
          waterTempC: 12,
        });
      }
    } else {
      inv.stacks[item.id] = qty;
      if (item.lightSource) {
        inv.flashlightBattery = item.lightSource.maxBattery;
      }
      if (item.fireStarter) {
        if (item.fireStarter.kind === 'lighter') {
          inv.lighterUses += qty * item.fireStarter.usesPerItem;
        } else {
          inv.matchStrikes += qty * item.fireStarter.usesPerItem;
        }
      }
    }
  }

  return inv;
}

export function cloneInventory(inv: InventoryState): InventoryState {
  return {
    stacks: { ...inv.stacks },
    bottles: inv.bottles.map((b) => ({ ...b })),
    wornItems: { ...(inv.wornItems ?? {}) },
    flashlightBattery: inv.flashlightBattery,
    lighterUses: inv.lighterUses,
    matchStrikes: inv.matchStrikes,
    nextBottleUid: inv.nextBottleUid,
  };
}

export function addItemToInventory(inv: InventoryState, itemId: ItemId, qty = 1): void {
  if (qty <= 0) return;
  const def = ITEM_CATALOG[itemId];
  if (def.waterContainer) {
    for (let i = 0; i < qty; i++) {
      inv.bottles.push({
        uid: `b${inv.nextBottleUid++}`,
        itemId: itemId as 'bottle_05l' | 'bottle_1l' | 'bottle_2l',
        capacityLiters: def.waterContainer.capacityLiters,
        waterLiters: def.waterContainer.capacityLiters,
        waterQuality: 'clean',
        waterTempC: 11,
      });
    }
    return;
  }

  inv.stacks[itemId] = (inv.stacks[itemId] ?? 0) + qty;
  if (def.lightSource && inv.flashlightBattery <= 0) {
    inv.flashlightBattery = def.lightSource.maxBattery;
  }
  if (def.fireStarter) {
    if (def.fireStarter.kind === 'lighter') {
      inv.lighterUses += qty * def.fireStarter.usesPerItem;
    } else {
      inv.matchStrikes += qty * def.fireStarter.usesPerItem;
    }
  }
}

export function removeStackItem(inv: InventoryState, itemId: ItemId, qty = 1): boolean {
  const cur = inv.stacks[itemId] ?? 0;
  if (cur < qty) return false;
  const next = cur - qty;
  if (next <= 0) {
    delete inv.stacks[itemId];
    if (inv.wornItems?.[itemId]) {
      delete inv.wornItems[itemId];
    }
  } else {
    inv.stacks[itemId] = next;
  }

  const def = ITEM_CATALOG[itemId];
  if (def.lightSource && next <= 0) {
    inv.flashlightBattery = 0;
  }
  if (def.fireStarter) {
    const maxAllowed = next * def.fireStarter.usesPerItem;
    if (def.fireStarter.kind === 'lighter') {
      inv.lighterUses = Math.min(inv.lighterUses, maxAllowed);
    } else {
      inv.matchStrikes = Math.min(inv.matchStrikes, maxAllowed);
    }
  }
  return true;
}

export function dropBottle(inv: InventoryState, uid: string): boolean {
  const idx = inv.bottles.findIndex((b) => b.uid === uid);
  if (idx < 0) return false;
  inv.bottles.splice(idx, 1);
  return true;
}

export function computeInventoryWeightKg(inv: InventoryState): number {
  let total = 0;
  for (const [id, qty] of Object.entries(inv.stacks)) {
    if (!qty || qty <= 0) continue;
    const def = ITEM_CATALOG[id as ItemId];
    if (def) total += def.weightKg * qty;
  }
  for (let i = 0; i < inv.bottles.length; i++) {
    total += getBottleWeightKg(inv.bottles[i]);
  }
  return Math.round(total * 100) / 100;
}

export function getNavigationMode(inv: InventoryState): NavigationMode {
  const hasCompass = (inv.stacks.compass ?? 0) > 0;
  const hasMap = (inv.stacks.paper_map ?? 0) > 0;
  if (hasCompass && hasMap) return 'both';
  if (hasCompass) return 'compass';
  if (hasMap) return 'map';
  return 'none';
}

export function hasFlashlight(inv: InventoryState): boolean {
  return (inv.stacks.flashlight ?? 0) > 0;
}

export function countEdibleMushrooms(inv: InventoryState): number {
  let total = 0;
  for (const [id, qty] of Object.entries(inv.stacks)) {
    if (!qty || qty <= 0) continue;
    const def = ITEM_CATALOG[id as ItemId];
    if (def?.food?.edibleForCooking) total += qty;
  }
  return total;
}

export function consumeEdibleMushrooms(inv: InventoryState, count: number): boolean {
  if (countEdibleMushrooms(inv) < count) return false;
  let remaining = count;
  const order: ItemId[] = [
    'mushroom_kukeseen',
    'mushroom_kuuseriisikas',
    'mushroom_kasepuravik',
    'mushroom_kivipuravik',
  ];
  for (const id of order) {
    const have = inv.stacks[id] ?? 0;
    if (have <= 0) continue;
    const take = Math.min(have, remaining);
    removeStackItem(inv, id, take);
    remaining -= take;
    if (remaining <= 0) break;
  }
  return remaining === 0;
}

/**
 * Check whether the player owns a clothing item and is actively wearing it.
 */
export function isWearingItem(inv: InventoryState, itemId: ItemId): boolean {
  return (inv.stacks[itemId] ?? 0) > 0 && Boolean(inv.wornItems?.[itemId]);
}

export function hasRainJacket(inv: InventoryState): boolean {
  return (inv.stacks.rain_jacket ?? 0) > 0;
}

export function isWearingRainJacket(inv: InventoryState): boolean {
  return isWearingItem(inv, 'rain_jacket');
}

/**
 * Toggle wearing a clothing item on/off. Returns the new worn state, or null if not owned/wearable.
 */
export function toggleWearClothing(inv: InventoryState, itemId: ItemId): boolean | null {
  const def = ITEM_CATALOG[itemId];
  if (!def?.clothing || (inv.stacks[itemId] ?? 0) <= 0) return null;
  if (!inv.wornItems) inv.wornItems = {};
  const next = !inv.wornItems[itemId];
  if (next) {
    inv.wornItems[itemId] = true;
  } else {
    delete inv.wornItems[itemId];
  }
  return next;
}

/**
 * Sum clothing insulation / rain resistance across actively WORN clothing items.
 */
export function computeClothingBonuses(inv: InventoryState): {
  warmthBonusC: number;
  rainResistance: number;
} {
  let warmthBonusC = 0;
  let rainResistance = 0;
  for (const [id, qty] of Object.entries(inv.stacks)) {
    if (!qty || qty <= 0) continue;
    const itemId = id as ItemId;
    if (!inv.wornItems?.[itemId]) continue;
    const c = ITEM_CATALOG[itemId]?.clothing;
    if (c) {
      warmthBonusC += c.warmthBonusC;
      rainResistance = Math.min(0.92, rainResistance + c.rainResistance);
    }
  }
  return { warmthBonusC, rainResistance };
}

export function hasTent(inv: InventoryState): boolean {
  return (inv.stacks.tent ?? 0) > 0;
}

export function hasSleepingBag(inv: InventoryState): boolean {
  return (inv.stacks.sleeping_bag ?? 0) > 0;
}

/**
 * Sum sleep insulation & comfort bonuses across any carried sleep gear (e.g. sleeping bag).
 */
export function computeSleepGearBonuses(inv: InventoryState): {
  warmthBonusC: number;
  energyCapBonus: number;
  hasSleepingBag: boolean;
} {
  let warmthBonusC = 0;
  let energyCapBonus = 0;
  for (const [id, qty] of Object.entries(inv.stacks)) {
    if (!qty || qty <= 0) continue;
    const sg = ITEM_CATALOG[id as ItemId]?.sleepGear;
    if (sg) {
      warmthBonusC += sg.outdoorWarmthBonusC;
      energyCapBonus += sg.energyCapBonus;
    }
  }
  return {
    warmthBonusC,
    energyCapBonus,
    hasSleepingBag: hasSleepingBag(inv),
  };
}
