import { useSyncExternalStore } from 'react';
import type { MushroomSpecies } from '../game/gameLogic';
import type { ItemId, NavigationMode, PoisonKind, WaterQuality } from '../game/itemCatalog';
import type { HypothermiaStage, LoadTier } from '../game/survivalEngine';
import type { WeatherId } from '../world/weatherAndSky';

/**
 * Extensible language registry.
 * To add another language later (e.g. 'fi', 'de', 'lv'):
 *   1. Add the code to `LanguageCode`.
 *   2. Add metadata to `SUPPORTED_LANGUAGES`.
 *   3. Add its complete entry to `TRANSLATIONS`, `ITEM_TRANSLATIONS`, and `MUSHROOM_TRANSLATIONS`.
 * TypeScript will enforce 100% key parity across every language automatically.
 */
export type LanguageCode = 'en' | 'et';

export interface LanguageMeta {
  code: LanguageCode;
  shortLabel: string;
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: readonly LanguageMeta[] = [
  { code: 'en', shortLabel: 'EN', nativeName: 'English' },
  { code: 'et', shortLabel: 'ET', nativeName: 'Eesti' },
] as const;

const STORAGE_KEY = 'metsavaikus_lang';

function isValidLanguage(val: unknown): val is LanguageCode {
  return SUPPORTED_LANGUAGES.some((l) => l.code === val);
}

function readInitialLanguage(): LanguageCode {
  if (typeof window === 'undefined') return 'en';
  try {
    const params = new URLSearchParams(window.location.search);
    const paramLang = params.get('lang');
    if (isValidLanguage(paramLang)) return paramLang;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isValidLanguage(saved)) return saved;
  } catch {
    // Ignore storage access errors in restricted contexts
  }
  return 'en';
}

let activeLanguage: LanguageCode = readInitialLanguage();
const listeners = new Set<() => void>();

function syncDocumentLang(code: LanguageCode): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = code;
  }
}
syncDocumentLang(activeLanguage);

export function getLanguage(): LanguageCode {
  return activeLanguage;
}

export function setLanguage(code: LanguageCode): void {
  if (!isValidLanguage(code) || code === activeLanguage) return;
  activeLanguage = code;
  syncDocumentLang(code);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Ignore storage write failures
    }
  }
  listeners.forEach((cb) => cb());
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLanguage(): {
  lang: LanguageCode;
  setLang: (code: LanguageCode) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
} {
  const lang = useSyncExternalStore(subscribeLanguage, getLanguage, () => 'en' as LanguageCode);
  return {
    lang,
    setLang: setLanguage,
    t: (key, params) => t(key, params, lang),
  };
}

// ============================================================================
// Core UI & Gameplay Translation Dictionaries
// ============================================================================
const EN_DICT = {
  // Common / Language switcher
  'lang.ariaLabel': 'Select language',
  'lang.label': 'Language',

  // Title Screen
  'title.eyebrow': 'Estonian Countryside Simulation · Seed #{seed}',
  'title.tagline':
    'Pack your rucksack and roam procedural Estonian birch groves, spruce thickets, villages, and misty peat bog islands — managing warmth, water, rations, campfires, and seven wild mushroom species.',
  'title.renderResolution': 'Render Resolution',
  'title.quality': 'Detail & Draw Distance',
  'title.auto': 'Auto',
  'quality.auto': 'Auto (Hardware + Live FPS)',
  'quality.minimal': 'Minimal (118m)',
  'quality.low': 'Low (168m)',
  'quality.balanced': 'Balanced (225m)',
  'quality.high': 'High (248m)',
  'quality.ultra': 'Ultra (264m)',
  'title.resFast': '50% Fast',
  'title.resNative': '100% Native',
  'title.resSharp': '150% Sharp',
  'title.enterCountryside': 'Enter Countryside',
  'title.controls':
    'WASD Walk · Shift Run · Space Jump · C Crouch · Tab Pack · E Gather/Use/Refill · F Kick · R Inspect · L Flashlight · T +2h · Y Weather',

  // Packing Modal
  'packing.ariaLabel': 'What are you packing with you?',
  'packing.eyebrow': 'Before Stepping Into Metsavaikus',
  'packing.title': 'What are you packing with you?',
  'packing.preset.light': 'Light Pack',
  'packing.preset.balanced': 'Balanced',
  'packing.preset.expedition': 'Expedition',
  'packing.resetTitle': 'Reset default packing list',
  'packing.group.navigation.title': 'Navigation',
  'packing.group.navigation.subtitle': 'Controls which navigation aid appears on your HUD',
  'packing.group.water.title': 'Water Bottles',
  'packing.group.water.subtitle': 'Packed full (1.0 kg/L); empties lighten your pack as you drink',
  'packing.group.food.title': 'Food & Rations',
  'packing.group.food.subtitle': 'Dense meals last hours; chocolate gives quick energy that burns faster',
  'packing.group.gear.title': 'Light & Fire Gear',
  'packing.group.gear.subtitle': 'Night visibility and campfire ignition in rain or storm wind',
  'packing.group.clothing.title': 'Clothing & Rain Gear',
  'packing.group.clothing.subtitle': 'Wear or remove anytime [J] or in Backpack to stay dry in rain',
  'packing.group.camp.title': 'Camp & Shelter',
  'packing.group.camp.subtitle': 'Pitch a waterproof tent in rain and stay warm overnight in a sleeping bag',
  'packing.unitFull': 'full',
  'packing.unitEach': 'each',
  'packing.fill': '+{pct}% fill',
  'packing.rainProtect': '{pct}% rainproof · +{temp}°C',
  'packing.subtotal': 'Subtotal: {kg} kg',
  'packing.removeItem': 'Remove {name}',
  'packing.addItem': 'Add {name}',
  'packing.packWeight': 'Pack Weight:',
  'packing.tiring': 'Tiring',
  'packing.calorieBurn': 'Calorie Burn',
  'packing.hudNavigation': 'HUD Navigation:',
  'packing.navSummary.both': 'Paper Map + Magnetic Compass (live position & heading-up)',
  'packing.navSummary.compass': 'Magnetic Compass only (no minimap)',
  'packing.navSummary.map': 'Static North-up Paper Map only (no rotation or GPS)',
  'packing.navSummary.none': 'No navigation aids (navigate by landmarks & sun)',
  'packing.back': 'Back',
  'packing.begin': 'Begin Exploration',

  // Gameplay HUD
  'hud.basket': 'Basket',
  'hud.basketEdibleSummary': 'Edible {edible} (Chanterelle {kukeseen} · Bolete {bolete} · Milk Cap {riisikas})',
  'hud.basketInedible': 'Inedible {count}',
  'hud.basketPoisonous': 'Poisonous {count}',
  'hud.openBackpackAria': 'Open backpack and status',
  'hud.backpackTooltip': 'Backpack ({kg} kg) [Tab]',
  'hud.openMapAria': 'Open full map',
  'hud.mapTooltip': 'Full Map [M]',
  'hud.minimapClickHint': 'Click or press [M] to open full map',
  'hud.muteAria': 'Mute audio',
  'hud.unmuteAria': 'Unmute audio',
  'hud.pauseAria': 'Pause game',
  'hud.navAria.compass': 'Magnetic compass',
  'hud.navAria.map': 'Paper valley map with fog of war (click to expand)',
  'hud.navAria.both': 'Paper valley map with fog of war and compass bezel (click to expand)',
  'hud.paperMapCaption': 'Paper Map · N↑ · [M]',
  'hud.vitals': 'Vitals',
  'hud.vital.health': 'Health',
  'hud.vital.energy': 'Energy',
  'hud.vital.water': 'Water',
  'hud.vital.food': 'Food',
  'hud.vital.fatigue': 'Fatigue',
  'hud.controlsHint':
    'Click canvas to look · WASD Move · Shift Run · Tab Pack · M Map · J Jacket · E Gather/Use · F Kick · G Fire · H Tent · L Light · P Pause',
  'hud.carrying': 'Carrying: {name} ([E] Drop · [F] Throw)',

  // Full Map Modal
  'fullMap.ariaLabel': 'Full Countryside Map',
  'fullMap.title': 'Metsavaikus Field Map',
  'fullMap.titleSketch': 'Remembered Terrain Sketch',
  'fullMap.summary': 'Seed #{seed} · Explored {pct}% · {nav}',
  'fullMap.closeAria': 'Close full map',
  'fullMap.zoomInAria': 'Zoom in map',
  'fullMap.zoomOutAria': 'Zoom out map',
  'fullMap.recenter': 'Center',
  'fullMap.recenterAria': 'Center map on your position',
  'fullMap.resetView': 'Fit',
  'fullMap.resetViewAria': 'Fit whole map to view',
  'fullMap.bogLabel': 'Peat Bog',
  'fullMap.noticeNoMap':
    'Paper Map not carried — showing fog-of-war memory sketch only. Pack or pick up a Paper Map for the minimap and full survey detail.',
  'fullMap.noticeNoCompass':
    'Paper Map without Magnetic Compass — terrain reveals as you explore, but live position & bearing are hidden.',
  'fullMap.hintPanZoom': 'Drag to pan · Scroll to zoom · [M] or [Esc] to close',
  'fullMap.legend.explored': 'Explored',
  'fullMap.legend.fog': 'Unexplored Fog',
  'fullMap.legend.road': 'Road / Trail',
  'fullMap.legend.village': 'Village',
  'fullMap.legend.bog': 'Bog & Boardwalk',
  'fullMap.legend.campfire': 'Campfire',
  'fullMap.legend.tent': 'Tent',
  'fullMap.legend.player': 'You',
  'backpack.openFullMap': 'Open Map [M]',

  // HUD Conditions
  'cond.severeHypothermia': 'Severe Hypothermia',
  'cond.hypothermia': 'Hypothermia',
  'cond.cold': 'Cold',
  'cond.soaked': 'Soaked',
  'cond.wet': 'Wet',
  'cond.overburdened': 'Overburdened',
  'cond.heavy': 'Heavy',
  'cond.waterHeavy': 'Water-heavy',
  'cond.sick': 'Sick',
  'cond.hungry': 'Hungry',
  'cond.thirsty': 'Thirsty',
  'cond.exhausted': 'Exhausted',
  'cond.warm': 'Warm',
  'cond.rainJacket': 'Rain Jacket',

  // Load tiers, hypothermia stages, navigation modes, staying power
  'loadTier.light': 'light',
  'loadTier.moderate': 'moderate',
  'loadTier.heavy': 'heavy',
  'loadTier.overburdened': 'overburdened',
  'hypo.normal': 'Normal',
  'hypo.cool': 'Cool',
  'hypo.chilly': 'Chilly',
  'hypo.hypothermia': 'Hypothermia',
  'hypo.severe': 'Severe Hypothermia (Lethal!)',
  'navMode.none': 'None',
  'navMode.compass': 'Compass',
  'navMode.map': 'Paper Map',
  'navMode.both': 'Map + Compass',
  'staying.Short': 'Short',
  'staying.Moderate': 'Moderate',
  'staying.Long': 'Long',
  'waterQuality.clean': 'Clean',
  'waterQuality.bog': 'Bog',
  'waterQuality.stale': 'Stale',

  // Sleeping Overlay
  'sleepOverlay.eyebrow': 'Sleeping · Fast Time',
  'sleepOverlay.stats': 'Energy {energy}% · Core {temp}°C · Food {food}%',
  'sleepOverlay.wakeEarly': 'Wake Early',

  // Pause Modal
  'pause.ariaLabel': 'Game Paused',
  'pause.title': 'Paused',
  'pause.summary': 'Seed #{seed} · Edible: {edible} · Total: {total} / {max}',
  'pause.resolution': 'Resolution',
  'pause.quality': 'Detail & Distance',
  'pause.resume': 'Resume Exploration',
  'pause.newMap': 'New Procedural Map',
  'pause.restartSameSeed': 'Restart Same Seed',
  'pause.titleScreen': 'Title Screen',
  'toast.newMap': 'Generated procedural countryside #{seed}',

  // Backpack & Field Status Drawer
  'backpack.ariaLabel': 'Backpack and Physiology Status',
  'backpack.title': 'Backpack & Field Status',
  'backpack.summary':
    'Pack {kg} kg ({tier}) · Tiring {tiring}× · Calories {cal}× · Explored {pct}%',
  'backpack.closeAria': 'Close backpack',
  'backpack.physiology': 'Physiology',
  'backpack.health': 'Health',
  'backpack.energy': 'Energy',
  'backpack.energySub': 'Awake {hours}h · Refill by sleeping in beds or by campfires',
  'backpack.hydration': 'Hydration',
  'backpack.hydrationHeavy': 'Heavy water load (+{kg} kg sloshing)',
  'backpack.hydrationSub': 'Refill at village/intact wells or boil bog water',
  'backpack.stomachFullness': 'Stomach Fullness',
  'backpack.burnFast': 'Fast burn (sugary/light)',
  'backpack.burnSlow': 'Slow burn (hearty calories)',
  'backpack.burnSteady': 'Steady digestion',
  'backpack.physicalTiredness': 'Physical Tiredness',
  'backpack.tiredHigh': 'Muscles fatigued — rest or walk calmly to recover',
  'backpack.tiredSub': 'Builds from sprinting, swamp wading, swimming & pack load',
  'backpack.coreTemp': 'Core Body Temp',
  'backpack.feelsLike': 'Feels Like (Windchill)',
  'backpack.wetness': 'Clothes Wetness',
  'backpack.shelter': 'Shelter & Warmth',
  'backpack.shelterFire': 'Warm by Campfire',
  'backpack.shelterInside': 'Inside {label}',
  'backpack.shelterOutdoor': 'Outdoors (Exposed)',
  'backpack.navigationAid': 'Navigation Aid',
  'backpack.activePoison': 'Active Poisoning / Illness',
  'backpack.poisonRemaining': '{label} — {hours}h remaining',
  'backpack.waterBottles': 'Water Bottles ({count})',
  'backpack.noBottles': 'No water bottles carried.',
  'backpack.bottleEmpty': 'Empty',
  'backpack.bottleClean': 'Clean · {temp}°C',
  'backpack.bottleStale': 'Stale Well Water (TOXIC!) · {temp}°C',
  'backpack.bottleBog': 'Bog Water (Unboiled) · {temp}°C',
  'backpack.drinkSip': 'Drink Sip',
  'backpack.dropAria': 'Drop {name}',
  'backpack.foodHeading': 'Food & Wild Mushrooms',
  'backpack.noFood': 'No food left. Forage mushrooms or search village pantry crates.',
  'backpack.stay': '{power} stay',
  'backpack.energyBoost': '+{amount} energy',
  'backpack.poisonLethal': 'LETHAL POISON',
  'backpack.poisonVomiting': 'POISONOUS (Vomiting)',
  'backpack.poisonBitter': 'Raw / Bitter upset',
  'backpack.eat': 'Eat',
  'backpack.gearHeading': 'Navigation & Field Gear',
  'backpack.noGear': 'No gear items carried.',
  'backpack.battery': 'Battery {pct}%',
  'backpack.lighterLeft': '{count} strikes left',
  'backpack.matchesLeft': '{count} matches left',
  'backpack.placeCampfire': 'Place Campfire ({cost})',
  'backpack.pitchTent': 'Pitch Tent [H]',
  'backpack.sleepInBag': 'Sleep in Bag',
  'backpack.sleepWarmthBonus': '+{temp}°C sleep warmth',
  'backpack.wearItem': 'Wear [J]',
  'backpack.takeOffItem': 'Take Off [J]',
  'backpack.badgeWorn': 'WORN',
  'backpack.statusWorn': 'Currently worn',
  'backpack.statusInPack': 'Packed in rucksack',
  'backpack.rainGear': 'Rain Protection',
  'backpack.rainGearWorn': 'Rain Jacket ({pct}%)',
  'backpack.rainGearNone': 'None',
  'backpack.loadBattery': 'Load into Flashlight',
  'backpack.wheelHint': 'Move mouse around the wheel to select an item',
  'backpack.wheelEmpty': 'Your backpack is empty',
  'backpack.wheelItemsCount': '{count} items in pack',
  'backpack.drop': 'Drop',

  // Sleep Modal
  'sleepModal.ariaLabel': 'Rest and Sleep',
  'sleepModal.shelteredBed': 'Sheltered Bed',
  'sleepModal.campfireRest': 'Campfire Rest',
  'sleepModal.tentShelter': 'Waterproof Field Tent',
  'sleepModal.sleepingBagRest': 'Insulated Sleeping Bag',
  'sleepModal.sleepingBagActive': 'Sleeping Bag active · +{temp}°C warmth',
  'sleepModal.tentWaterproofNote': 'Waterproof rainfly · Shielded from rain & wind',
  'sleepModal.closeAria': 'Close sleep dialog',
  'sleepModal.duration': 'Sleep Duration',
  'sleepModal.hourSingular': '{n} hour',
  'sleepModal.hourPlural': '{n} hours',
  'sleepModal.nap': '1h Nap',
  'sleepModal.rest': '5h Rest',
  'sleepModal.fullNight': '10h Full Night',
  'sleepModal.projectedEnergy': 'Projected Energy',
  'sleepModal.cappedAt': '(capped at {cap}%)',
  'sleepModal.stomachHydration': 'Stomach / Hydration on Wake',
  'sleepModal.fillHyd': '{fill}% fill · {hyd}% hyd',
  'sleepModal.conditions': 'Sleeping Conditions',
  'sleepModal.feelsCore': 'Feels {feels}°C · Core {core}°C',
  'sleepModal.cancel': 'Cancel',
  'sleepModal.sitInsideBtn': 'Sit Inside',
  'sleepModal.sleepBtn': 'Sleep {hours}h',

  // Seated in Tent HUD
  'tentSeated.statusDry': 'Seated in Field Tent · Dry & Sheltered',
  'tentSeated.statusRain': 'Seated in Field Tent · Listening to the Rain',
  'tentSeated.hint': 'Look around · [Tab] Pack · [E] Sleep · [Space / WASD] Stand Up',
  'tentSeated.sleepBtn': 'Sleep [E]',
  'tentSeated.standUpBtn': 'Stand Up',

  // Campfire Hearth Modal
  'hearth.ariaLabel': 'Campfire Hearth',
  'hearth.lit': 'Burning Brightly',
  'hearth.unlit': 'Cold Ash & Unlit Logs',
  'hearth.title': '{label} Campfire',
  'hearth.closeAria': 'Close campfire',
  'hearth.litDesc': 'Warms core body temperature, dries soaked clothes, cooks food & purifies water.',
  'hearth.useLighter': 'Use Lighter ({count}) to ignite.',
  'hearth.useMatches': 'Use Matches ({count}) to ignite.',
  'hearth.noStarter': 'No Lighter or Matches in your backpack to light this fire.',
  'hearth.bankFire': 'Bank Fire',
  'hearth.igniteFire': 'Ignite Fire',
  'hearth.cookHeading': 'Cook Over Embers',
  'hearth.searSteak': 'Sear Venison Steak',
  'hearth.searSteakDesc': 'Needs 1× Raw Steak (Have {count}) · +58% fill, long stay',
  'hearth.roastMushrooms': 'Roast Mushroom Skewer',
  'hearth.roastMushroomsDesc': 'Needs 3× Edible Mushrooms (Have {count}) · +30% fill',
  'hearth.boilHeading': 'Boil & Purify Water',
  'hearth.noFilledBottles': 'No filled water bottles to boil.',
  'hearth.warmWater': 'Warm (46°C)',
  'hearth.boilPurify': 'Boil & Purify',
  'hearth.restByFire': 'Rest by Campfire',
  'hearth.leaveHearth': 'Leave Hearth',

  // Collapse Overlay
  'collapse.ariaLabel': 'You collapsed in Metsavaikus',
  'collapse.eyebrow': 'Metsavaikus · Seed #{seed}',
  'collapse.title': 'You Collapsed',
  'collapse.primaryCause': 'Primary cause: {cause}',
  'collapse.defaultCause': 'Severe Exposure',
  'collapse.compounding': 'Compounding conditions: {factors}',
  'collapse.timeSurvived': 'Time Survived',
  'collapse.mushroomsGathered': 'Mushrooms Gathered',
  'collapse.edibleInline': '{total} ({edible} edible)',
  'collapse.respawn': 'Respawn at Homestead',
  'collapse.newMap': 'New Procedural Map',
  'collapse.titleScreen': 'Title Screen',

  // Interaction Prompts & Actions
  'prompt.gather': '[E] Gather',
  'prompt.pickUp': '[E] Pick up',
  'prompt.use': '[E] Use',
  'prompt.kickBreak': '[F] Kick to Break',
  'prompt.kickPush': '[F] Kick / Push',
  'prompt.inspect': '[R] Inspect',
  'prompt.takeWood': 'Take Wood (+0.75 kg)',
  'prompt.fallenLogTitle': 'Fallen Log (Lamav palk)',
  'prompt.fallenLogBreak': '[F] Kick to Break · [R] Examine',
  'prompt.fallenLogShatter': '[F] Kick Again to Shatter · [R] Examine',
  'prompt.bogWaterTitle': 'Bog Lake Water (Rabajärv)',
  'prompt.bogWaterAction': '[E] Refill Water Bottles (Boil before drinking)',

  // Weather & Biomes
  'weather.clear': 'Clear',
  'weather.mist': 'Overcast & Bog Mist',
  'weather.rain': 'Rain',
  'weather.storm': 'Thunderstorm',
  'biome.swamp': 'Kõrgesoo raba (Peat Bog)',
  'biome.trail': 'Metsarada (Woodland Trail)',
  'biome.road': 'Kruusatee (Gravel Country Road)',
  'biome.thicket': 'Põlistihnik (Dense Forest Thicket)',
  'biome.forest': 'Eesti mets (Birch & Pine Forest)',

  // World Props & Dynamic Toasts
  'prop.oldCabinDoor': 'Old Cabin Door',
  'prop.namedDoor': '{name} Door',
  'prop.doorDescAbandoned': 'Warped timber creaks on rusted hinges.',
  'prop.doorDescIntact': 'Heavy split-pine door smelling of woodsmoke.',
  'prop.doorOpened': 'Door opened.',
  'prop.doorClosed': 'Door closed.',
  'prop.doorTouchAbandoned': 'The weathered wood is damp and splintering.',
  'prop.doorTouchIntact': 'Solid hand-planed Estonian pine.',
  'prop.bunkName': '{name} Bunk',
  'prop.bedName': '{name} Timber Bed',
  'prop.bedSpotLabel': '{name} Bed',
  'prop.bedDescWarm': 'Dry wool blanket indoors — shielded from rain and windchill.',
  'prop.bedDescDrafty': 'Drafty timber cot — blocks rain, though cold night air creeps in.',
  'prop.bedTouchWarm': 'Warm handwoven wool blanket and dry straw mattress.',
  'prop.bedTouchDrafty': 'Damp, creaking wooden bunk inside the old hut.',
  'prop.oldSupplyBox': 'Old Supply Box',
  'prop.pantryCrate': '{name} Pantry Crate',
  'prop.crateDesc': 'Stored rural provisions and spare gear.',
  'prop.pantryFoodDesc': 'A small pantry provision. Take it to replenish your food supplies.',
  'prop.pantryTake': 'Take food',
  'prop.campfireBlocked': 'There is no clear space for a fire here or in front of the tent door.',
  'prop.crateEmpty': 'This supply crate is empty.',
  'prop.crateTouchEmpty': 'An empty wooden crate.',
  'prop.crateTouchFull': 'Feels heavy with preserved provisions.',
  'prop.lootedCrate': 'Looted {label}: {items}',
  'prop.wellDecrepitName': '{label} — Decrepit Well',
  'prop.wellCleanName': '{label} Water Well',
  'prop.wellDecrepitDesc': 'Murky, algae-choked stale water — unsafe without boiling.',
  'prop.wellCleanDesc': 'Clean, icy Estonian spring groundwater (6°C).',
  'prop.wellDecrepitUse': 'Stagnant greenish water swirls inside the decrepit well.',
  'prop.wellCleanUse': 'You draw a splash of icy Estonian spring water.',
  'prop.wellDecrepitTouch': 'Slimy moss coats the cracked wellstones; a sour marsh smell rises.',
  'prop.wellCleanTouch': 'Cool, moss-covered granite fieldstones above clean groundwater.',
  'prop.campfireName': '{label} Campfire',
  'prop.campfireWilderness': 'Wilderness',
  'prop.campfireDesc': 'Cook food, boil water, warm up, or rest beside the fire.',
  'prop.campfireStoke': 'You stoke the campfire back to life.',
  'prop.campfireBank': 'You bank the embers.',
  'prop.campfireTouchLit': 'Warmth radiates from the birch embers!',
  'prop.campfireTouchCold': 'Cold ash and charred wood.',
  'prop.signpostDesc': 'Weathered wooden trail marker.',
  'prop.signpostMainTitle': 'Signpost (Teeviit)',
  'prop.signpostMainMsg':
    '↑ {village} · → Kõrgesoo Raba & Swamp Islands · 4 Villages across Metsavaikus',
  'prop.signpostBogTitle': 'Bog Trailhead (Rabarada)',
  'prop.signpostBogMsg':
    '"KÕRGESOO RABA — Keep to the wooden boardwalk (laudtee) to reach the bog islands."',
  'prop.woodenCrate': 'Wooden Crate',
  'prop.woodenCrateDesc': 'Heavy weathered shipping crate.',
  'prop.oilDrum': 'Rusted Oil Drum',
  'prop.oilDrumDesc': 'Empty weathered metal barrel.',
  'prop.lanternName': 'Storm Lantern (Tormilatern)',
  'prop.lanternDesc': 'Matte-black hurricane kerosene lantern glowing against the mist.',
  'prop.lanternLit': 'Lantern lit.',
  'prop.lanternDimmed': 'Lantern dimmed.',
  'prop.splitFirewoodName': 'Split Firewood (Küttepuu)',
  'prop.splitFirewoodDesc':
    'Dry split timber (+0.75 kg). Carry 3 pieces to build a campfire anywhere dry.',
  'prop.lyingStumpName': 'Lying Treestump (Lamav känd)',
  'prop.lyingStumpDesc':
    'Dry fallen stump & deadwood. Kick [F] twice to shatter it into gatherable firewood.',
  'prop.lyingStumpTouch': 'Dry, brittle fallen wood. Kick [F] to split it into firewood pieces.',
  'prop.stumpCracked':
    'CRACK! The dry treestump splits open — kick [F] once more to break it apart.',
  'prop.stumpShattered':
    'Shattered the treestump into {count} pieces of Split Firewood! Press [E] on pieces to pack them.',
  'prop.birchFirewoodName': 'Birch Firewood (Kasehalg)',
  'prop.birchFirewoodDesc':
    'Split birch firewood (+0.75 kg). Take 3 pieces to build a campfire anywhere.',
  'prop.fieldstoneName': 'Glacial Fieldstone (Raie-kivi)',
  'prop.fieldstoneDesc': 'Smooth granite left by Ice Age glaciers.',
  'prop.mushroomTagPoison': ' [POISONOUS]',
  'prop.mushroomTagInedible': ' [Inedible]',
  'prop.campfireTooWet': 'Too wet here! Move onto dry ground to stack a campfire.',
  'prop.campfireTooClose': 'There is already a campfire pit right here — use [E] on it instead.',
  'prop.campfireStacked':
    'Stacked firewood into a campfire! Press [E] on it and use your Lighter or Matches to ignite.',
  'prop.tentName': 'Field Tent (Matkatelk)',
  'prop.tentDesc': 'Waterproof trekking tent. Sit inside during rain or sleep completely dry and shielded from wind.',
  'prop.tentSpotLabel': 'Field Tent',
  'prop.tentSleepAction': 'Sit / Sleep in Tent',
  'prop.tentPackUpAction': 'Pack Up Tent',
  'prop.tentTouch': 'Taut waterproof canvas and aluminum poles — dry inside even in driving rain.',
  'prop.tentTooWet': 'Too wet here! Move onto dry ground to pitch your tent.',
  'prop.tentBlocked': 'Not enough clear flat ground here — step away from trees, rocks, or walls.',
  'prop.tentPitched': 'Pitched your waterproof Field Tent! Look at it and press [E] to sit or sleep, or [F] to pack up.',
  'prop.tentPackedUp': 'Packed up your Field Tent (+1.85 kg back in backpack).',
  'prop.sleepingBagSpotLabel': 'Insulated Sleeping Bag',

  // Gameplay Toasts in MetsavaikusWorld
  'toast.gatherPoisonous': 'WARNING: {name} is POISONOUS! Added to backpack.',
  'toast.gatherInedible': 'Caution: {name} is bitter & inedible.',
  'toast.gatherEdible': 'Gathered {name}',
  'toast.packedWoodReady': ' Ready to build a campfire ([G] or Pack)!',
  'toast.packedWoodCount': ' ({have}/{need} for campfire)',
  'toast.packedItem': 'Packed {name} (+{unitKg} kg · Pack {totalKg} kg).{hint}',
  'toast.deadfallCracked':
    'CRACK! The fallen log splits open — kick [F] once more to shatter it into firewood.',
  'toast.deadfallShattered':
    'Shattered the fallen log into {count} pieces of Split Firewood! Press [E] on pieces to pack them.',
  'toast.deadfallInspect':
    'Fallen Log (Lamav palk): Weathered forest deadwood. Kick [F] twice to break it into firewood pieces.',
  'toast.gatherGently': 'Press [E] to gather mushrooms gently.',
  'toast.wontBudge': "You push against the {name}, but it won't budge.",
  'toast.wokeEarly': 'Woke early at {time} ({hours}h slept) — Energy {energy}%.',
  'toast.wokeNormal': 'Woke at {time} after {hours}h rest — Energy {energy}%.',
  'toast.weatherChanged': 'Weather: {weather}',
  'toast.timeAdvanced': 'Time advanced +2 hours.',
  'toast.noFlashlight': "You didn't pack a flashlight.",
  'toast.batteryDead': 'Flashlight battery is dead — load extra batteries in Backpack [Tab].',
  'toast.batteryDied': 'Flashlight battery died! Load extra batteries in Backpack [Tab].',
  'toast.droppedItem': 'Dropped {name}.',
  'toast.droppedBottle': 'Dropped water bottle.',
  'toast.bankedFire': 'Banked the campfire embers.',
  'toast.needWood':
    'Need {cost}× Split Firewood to build a campfire (have {have}). Kick [F] lying treestumps to break them into wood.',
  'toast.noTent': "You don't have a tent in your backpack.",
  'toast.noSleepingBag': "You don't have a sleeping bag in your backpack.",
  'toast.cannotSleepInWater': 'Cannot unroll your sleeping bag in water — move onto dry ground.',
  'toast.woreRainJacket': 'Put on your Waterproof Rain Jacket (88% rain protection).',
  'toast.tookOffRainJacket': 'Took off your Rain Jacket and stowed it in your pack.',
  'toast.noRainJacket': "You didn't pack a Rain Jacket.",
  'toast.satInTent': 'Stepped inside your Field Tent to shelter from the weather.',
  'toast.stoodUpTent': 'Stepped back outside your Field Tent.',
  'toast.vomited': 'Violent vomiting ({source}) — stomach & hydration drained!',

  // Survival Engine messages & death causes
  'poison.bitter': 'Bitter Stomach Upset',
  'poison.bog_water': 'Bog Water Stomach Cramps',
  'poison.fly_agaric': 'Punane kärbseseen Poisoning',
  'poison.stale_water': 'Stale Well Water Illness',
  'poison.destroying_angel': 'Valge kärbseseen (Amatoxin)',
  'death.fatalPoison': 'Fatal {label}',
  'death.hypothermia': 'Severe Hypothermia',
  'death.dehydration': 'Severe Dehydration',
  'death.starvation': 'Starvation & Exhaustion',
  'deathFactor.hypothermia': 'Hypothermia ({temp}°C)',
  'deathFactor.soaked': 'Soaked ({pct}% wet)',
  'deathFactor.emptyStomach': 'Empty stomach',
  'deathFactor.dehydrated': 'Dehydrated',
  'deathFactor.sleepDeprived': 'Sleep-deprived ({hours}h awake)',
  'surv.cannotEat': 'This item cannot be eaten.',
  'surv.noneLeft': 'None left in backpack.',
  'surv.ateNormal': 'Ate {name} (+{fill}% fullness).',
  'surv.ateDestroyingAngel': 'Ate {name}! Deadly amatoxin is entering your bloodstream...',
  'surv.ateFlyAgaric': 'Ate {name}! Your stomach turns violently nauseous.',
  'surv.ateBitter': 'Ate {name} — bitterly unpleasant! Your stomach aches.',
  'surv.ateFast': 'Ate {name} (+{fill}% fullness, quick energy — burns fast).',
  'surv.ateSlow': 'Ate {name} (+{fill}% fullness — long-lasting calories).',
  'surv.bottleNotFound': 'Bottle not found.',
  'surv.bottleEmpty': 'Bottle is empty — refill at a well or bog lake.',
  'surv.drank': 'Drank {liters} L (+{hyd}% hydration{chill}).',
  'surv.drankChill': ', -{temp}°C chill',
  'surv.drankStale': 'Foul stale well water! Violent nausea and stomach cramps hit hard.',
  'surv.drankBog': 'Drank unboiled murky bog water — your stomach rumbles uneasily.',
  'surv.drankSloshing': ' Stomach feels heavy and sloshing.',
  'surv.noBottlesInPack': 'You have no water bottles in your backpack.',
  'surv.bottlesAlreadyFull': 'All water bottles are already full.',
  'surv.refillCleanOne': 'Refilled 1 bottle with cold clean spring water (6°C).',
  'surv.refillCleanMany': 'Refilled {count} bottles with cold clean spring water (6°C).',
  'surv.refillStaleOne': 'Refilled 1 bottle with stale well water — boil before drinking!',
  'surv.refillStaleMany': 'Refilled {count} bottles with stale well water — boil before drinking!',
  'surv.refillBogOne': 'Refilled 1 bottle with cold bog lake water — boil before drinking.',
  'surv.refillBogMany': 'Refilled {count} bottles with cold bog lake water — boil before drinking.',
  'surv.cannotBoilEmpty': 'Cannot boil an empty bottle.',
  'surv.boiledPurified': 'Boiled & purified {name} (safe, warm 46°C).',
  'surv.warmedBottle': 'Warmed {name} beside the embers (46°C).',
  'surv.needRawSteak': 'Need 1× Raw Venison Steak to cook.',
  'surv.cookedSteak': 'Seared a Venison Steak over the birch embers!',
  'surv.needEdibleMushrooms': 'Need 3× edible wild mushrooms to roast a skewer.',
  'surv.cookedMushrooms': 'Roasted a warm Wild Mushroom Skewer!',
  'surv.notCarryingFlashlight': 'You are not carrying a flashlight.',
  'surv.batteryFull': 'Flashlight battery is already full.',
  'surv.noExtraBatteries': 'No extra batteries left in backpack.',
  'surv.loadedBattery': 'Loaded fresh AA batteries (100% charge).',
  'surv.litLighter': 'Lit the campfire with your windproof lighter.',
  'surv.lighterGust': 'A fierce gust blew out the lighter flame — try again.',
  'surv.litMatch': 'Struck a match and kindled the alder logs.',
  'surv.matchSnuffed': 'Damp air snuffed the matchstick before the tinder caught.',
  'surv.needFireStarter': 'You need a Lighter or Matches in your backpack to light the fire.',
  'surv.sleepWarnEmptyNow': 'Empty stomach — energy cannot refill to full.',
  'surv.sleepWarnEmptyMid': 'Stomach will empty mid-sleep — energy recovery capped.',
  'surv.sleepWarnCold': 'Too cold while sleeping — energy recovery capped.',
  'surv.sleepWarnRain': 'Exposed to rain — clothes will soak and recovery is capped. Pitch a tent or find roofed shelter!',
} as const;

export type TranslationKey = keyof typeof EN_DICT;
export type TranslationDict = Record<TranslationKey, string>;

const ET_DICT: TranslationDict = {
  // Common / Language switcher
  'lang.ariaLabel': 'Vali keel',
  'lang.label': 'Keel',

  // Title Screen
  'title.eyebrow': 'Eesti maastiku simulatsioon · Seeme #{seed}',
  'title.tagline':
    'Paki seljakott ja rända läbi protseduuriliste Eesti kaasikute, kuusetihnikute, külade ja uduste rabasaarte — hoides sooja, vett, toiduvaru, lõkkeid ja seitset metsaseeneliiki.',
  'title.renderResolution': 'Renderduse eraldusvõime',
  'title.quality': 'Detailid ja nähtavuskaugus',
  'title.auto': 'Automaatne',
  'quality.auto': 'Automaatne (Riistvara + FPS)',
  'quality.minimal': 'Minimaalne (118m)',
  'quality.low': 'Madal (168m)',
  'quality.balanced': 'Tasakaalus (225m)',
  'quality.high': 'Kõrge (248m)',
  'quality.ultra': 'Ülikõrge (264m)',
  'title.resFast': '50% Kiire',
  'title.resNative': '100% Loomulik',
  'title.resSharp': '150% Terav',
  'title.enterCountryside': 'Astu maale',
  'title.controls':
    'WASD Kõnni · Shift Jookse · Tühik Hüppa · C Küüruta · Tab Seljakott · E Korja/Kasuta/Täida · F Löö jalaga · R Uuri · L Taskulamp · T +2h · Y Ilm',

  // Packing Modal
  'packing.ariaLabel': 'Mida sa kaasa pakid?',
  'packing.eyebrow': 'Enne Metsavaikusesse astumist',
  'packing.title': 'Mida sa kaasa pakid?',
  'packing.preset.light': 'Kerge kott',
  'packing.preset.balanced': 'Tasakaalus',
  'packing.preset.expedition': 'Matkavarustus',
  'packing.resetTitle': 'Taasta vaikimisi varustus',
  'packing.group.navigation.title': 'Navigatsioon',
  'packing.group.navigation.subtitle': 'Määrab, milline orienteerumisvahend ekraanil kuvatakse',
  'packing.group.water.title': 'Veepudelid',
  'packing.group.water.subtitle': 'Täidetud (1,0 kg/L); juues muutub seljakott kergemaks',
  'packing.group.food.title': 'Toit ja moon',
  'packing.group.food.subtitle': 'Toekas toit püsib tunde; šokolaad annab kiire energia, mis kulub kiiremini',
  'packing.group.gear.title': 'Valgus ja tuletegemine',
  'packing.group.gear.subtitle': 'Öine nähtavus ja lõkke süütamine vihmas või tormituules',
  'packing.group.clothing.title': 'Riietus ja vihmakaitse',
  'packing.group.clothing.subtitle': 'Pane selga või võta ära igal ajal [J] või seljakotist, et püsida vihmas kuiv',
  'packing.group.camp.title': 'Laager ja varjualune',
  'packing.group.camp.subtitle': 'Püstita veekindel telk vihma kaitseks ja maga soojalt magamiskotis',
  'packing.unitFull': 'täis',
  'packing.unitEach': 'tk',
  'packing.fill': '+{pct}% kõhtu',
  'packing.rainProtect': '{pct}% vihmakindel · +{temp}°C',
  'packing.subtotal': 'Kokku: {kg} kg',
  'packing.removeItem': 'Eemalda {name}',
  'packing.addItem': 'Lisa {name}',
  'packing.packWeight': 'Koti kaal:',
  'packing.tiring': 'Väsimine',
  'packing.calorieBurn': 'Kalorikulu',
  'packing.hudNavigation': 'Navigatsioon:',
  'packing.navSummary.both': 'Paberkaart + magnetkompass (asukoht ja suund reaalajas)',
  'packing.navSummary.compass': 'Ainult magnetkompass (minikaardita)',
  'packing.navSummary.map': 'Staatiline põhjasuunaline paberkaart (pööramise ja asukohata)',
  'packing.navSummary.none': 'Navigatsioonivahenditeta (orienteeru maamärkide ja päikese järgi)',
  'packing.back': 'Tagasi',
  'packing.begin': 'Alusta rännakut',

  // Gameplay HUD
  'hud.basket': 'Korv',
  'hud.basketEdibleSummary': 'Söödavad {edible} (Kukeseen {kukeseen} · Puravik {bolete} · Riisikas {riisikas})',
  'hud.basketInedible': 'Mittesöödavad {count}',
  'hud.basketPoisonous': 'Mürgised {count}',
  'hud.openBackpackAria': 'Ava seljakott ja seisund',
  'hud.backpackTooltip': 'Seljakott ({kg} kg) [Tab]',
  'hud.openMapAria': 'Ava suur kaart',
  'hud.mapTooltip': 'Suur kaart [M]',
  'hud.minimapClickHint': 'Klõpsa või vajuta [M] suure kaardi avamiseks',
  'hud.muteAria': 'Vaigista heli',
  'hud.unmuteAria': 'Lülita heli sisse',
  'hud.pauseAria': 'Peata mäng',
  'hud.navAria.compass': 'Magnetkompass',
  'hud.navAria.map': 'Paberkaart udukattega (klõpsa suurendamiseks)',
  'hud.navAria.both': 'Paberkaart udukatte ja kompassiga (klõpsa suurendamiseks)',
  'hud.paperMapCaption': 'Paberkaart · N↑ · [M]',
  'hud.vitals': 'Näitajad',
  'hud.vital.health': 'Elujõud',
  'hud.vital.energy': 'Energia',
  'hud.vital.water': 'Vesi',
  'hud.vital.food': 'Toit',
  'hud.vital.fatigue': 'Väsimus',
  'hud.controlsHint':
    'Klõpsa vaateks · WASD Liigu · Shift Jookse · Tab Kott · M Kaart · J Jope · E Korja/Kasuta · F Löö · G Lõke · H Telk · L Lamp · P Paus',
  'hud.carrying': 'Kannad: {name} ([E] Pane maha · [F] Viska)',

  // Full Map Modal
  'fullMap.ariaLabel': 'Täielik maastikukaart',
  'fullMap.title': 'Metsavaikuse kaart',
  'fullMap.titleSketch': 'Mälu järgi visandatud kaart',
  'fullMap.summary': 'Seeme #{seed} · Avastatud {pct}% · {nav}',
  'fullMap.closeAria': 'Sulge suur kaart',
  'fullMap.zoomInAria': 'Suumi sisse',
  'fullMap.zoomOutAria': 'Suumi välja',
  'fullMap.recenter': 'Keskenda',
  'fullMap.recenterAria': 'Keskenda kaart oma asukohale',
  'fullMap.resetView': 'Sobita',
  'fullMap.resetViewAria': 'Mahuta kogu kaart vaatesse',
  'fullMap.bogLabel': 'Raba',
  'fullMap.noticeNoMap':
    'Paberkaarti pole kaasas — kuvatakse ainult läbi udu mäletatav maastik. Võta kaasa paberkaart minikaardi ja täpsema kartograafia jaoks.',
  'fullMap.noticeNoCompass':
    'Paberkaart ilma magnetkompassita — maastik avaneb liikudes, kuid reaalajas asukoht ja suund on peidetud.',
  'fullMap.hintPanZoom': 'Lohista nihutamiseks · Keri suumimiseks · [M] või [Esc] sulgemiseks',
  'fullMap.legend.explored': 'Avastatud',
  'fullMap.legend.fog': 'Avastamata udu',
  'fullMap.legend.road': 'Tee / rada',
  'fullMap.legend.village': 'Küla',
  'fullMap.legend.bog': 'Raba ja laudtee',
  'fullMap.legend.campfire': 'Lõke',
  'fullMap.legend.tent': 'Telk',
  'fullMap.legend.player': 'Sina',
  'backpack.openFullMap': 'Ava kaart [M]',

  // HUD Conditions
  'cond.severeHypothermia': 'Raske alajahtumine',
  'cond.hypothermia': 'Alajahtumine',
  'cond.cold': 'Külm',
  'cond.soaked': 'Läbimärg',
  'cond.wet': 'Märg',
  'cond.overburdened': 'Ülekoormatud',
  'cond.heavy': 'Raske kott',
  'cond.waterHeavy': 'Vesi loksub kõhus',
  'cond.sick': 'Halb enesetunne',
  'cond.hungry': 'Näljane',
  'cond.thirsty': 'Janune',
  'cond.exhausted': 'Kurnatud',
  'cond.warm': 'Soe',
  'cond.rainJacket': 'Vihmajope',

  // Load tiers, hypothermia stages, navigation modes, staying power
  'loadTier.light': 'kerge',
  'loadTier.moderate': 'keskmine',
  'loadTier.heavy': 'raske',
  'loadTier.overburdened': 'ülekoormatud',
  'hypo.normal': 'Normaalne',
  'hypo.cool': 'Jahe',
  'hypo.chilly': 'Külmetav',
  'hypo.hypothermia': 'Alajahtumine',
  'hypo.severe': 'Raske alajahtumine (Eluohtlik!)',
  'navMode.none': 'Puudub',
  'navMode.compass': 'Kompass',
  'navMode.map': 'Paberkaart',
  'navMode.both': 'Kaart + kompass',
  'staying.Short': 'Lühike',
  'staying.Moderate': 'Keskmine',
  'staying.Long': 'Pikk',
  'waterQuality.clean': 'Puhas',
  'waterQuality.bog': 'Rabavesi',
  'waterQuality.stale': 'Seisnud',

  // Sleeping Overlay
  'sleepOverlay.eyebrow': 'Uni · Kiirendatud aeg',
  'sleepOverlay.stats': 'Energia {energy}% · Keha {temp}°C · Toit {food}%',
  'sleepOverlay.wakeEarly': 'Ärka varem',

  // Pause Modal
  'pause.ariaLabel': 'Mäng peatatud',
  'pause.title': 'Paus',
  'pause.summary': 'Seeme #{seed} · Söödavaid: {edible} · Kokku: {total} / {max}',
  'pause.resolution': 'Eraldusvõime',
  'pause.quality': 'Detailid ja kaugus',
  'pause.resume': 'Jätka rännakut',
  'pause.newMap': 'Uus protseduuriline kaart',
  'pause.restartSameSeed': 'Alusta uuesti sama seemnega',
  'pause.titleScreen': 'Avakuva',
  'toast.newMap': 'Loodi uus protseduuriline maastik #{seed}',

  // Backpack & Field Status Drawer
  'backpack.ariaLabel': 'Seljakott ja seisund',
  'backpack.title': 'Seljakott ja seisund',
  'backpack.summary':
    'Kott {kg} kg ({tier}) · Väsimine {tiring}× · Kalorid {cal}× · Avastatud {pct}%',
  'backpack.closeAria': 'Sulge seljakott',
  'backpack.physiology': 'Enesetunne',
  'backpack.health': 'Elujõud',
  'backpack.energy': 'Energia',
  'backpack.energySub': 'Ärkvel {hours}h · Taastub magades voodis või lõkke ääres',
  'backpack.hydration': 'Vedelikutase',
  'backpack.hydrationHeavy': 'Raske veekoormus (+{kg} kg loksumas)',
  'backpack.hydrationSub': 'Täida külakaevus või keeda rabavett lõkkel',
  'backpack.stomachFullness': 'Kõhutäis',
  'backpack.burnFast': 'Kiire põlemine (magus/kerge)',
  'backpack.burnSlow': 'Aeglane põlemine (toekas toit)',
  'backpack.burnSteady': 'Ühtlane seedimine',
  'backpack.physicalTiredness': 'Füüsiline väsimus',
  'backpack.tiredHigh': 'Lihased väsinud — puhka või kõnni rahulikult',
  'backpack.tiredSub': 'Kasvab joostes, rabas sumbates, ujudes ja raske kotiga',
  'backpack.coreTemp': 'Kehatemperatuur',
  'backpack.feelsLike': 'Tajutav temp. (tuulekülm)',
  'backpack.wetness': 'Riiete märgus',
  'backpack.shelter': 'Varjualune ja soojus',
  'backpack.shelterFire': 'Soojas lõkke ääres',
  'backpack.shelterInside': 'Sees: {label}',
  'backpack.shelterOutdoor': 'Õues (tuule ja vihma käes)',
  'backpack.navigationAid': 'Navigatsioon',
  'backpack.activePoison': 'Mürgistus / haigus',
  'backpack.poisonRemaining': '{label} — {hours}h jäänud',
  'backpack.waterBottles': 'Veepudelid ({count})',
  'backpack.noBottles': 'Veepudeleid pole kaasas.',
  'backpack.bottleEmpty': 'Tühi',
  'backpack.bottleClean': 'Puhas · {temp}°C',
  'backpack.bottleStale': 'Seisnud kaevuvesi (MÜRGISUSE OHT!) · {temp}°C',
  'backpack.bottleBog': 'Rabavesi (keetmata) · {temp}°C',
  'backpack.drinkSip': 'Joo lonks',
  'backpack.dropAria': 'Viska ära: {name}',
  'backpack.foodHeading': 'Toit ja metsaseened',
  'backpack.noFood': 'Toit on otsas. Korja seeni või otsi küla sahvrikaste.',
  'backpack.stay': '{power} püsivus',
  'backpack.energyBoost': '+{amount} energiat',
  'backpack.poisonLethal': 'SURMAVALT MÜRGINE',
  'backpack.poisonVomiting': 'MÜRGINE (oksendamine)',
  'backpack.poisonBitter': 'Toores / kibe kõhuvalu',
  'backpack.eat': 'Söö',
  'backpack.gearHeading': 'Navigatsioon ja varustus',
  'backpack.noGear': 'Varustust pole kaasas.',
  'backpack.battery': 'Patarei {pct}%',
  'backpack.lighterLeft': '{count} süütamist alles',
  'backpack.matchesLeft': '{count} tikku alles',
  'backpack.placeCampfire': 'Tee lõke ({cost})',
  'backpack.pitchTent': 'Püstita telk [H]',
  'backpack.sleepInBag': 'Maga kotis',
  'backpack.sleepWarmthBonus': '+{temp}°C une soojus',
  'backpack.wearItem': 'Pane selga [J]',
  'backpack.takeOffItem': 'Võta seljast [J]',
  'backpack.badgeWorn': 'SELJAS',
  'backpack.statusWorn': 'Praegu seljas',
  'backpack.statusInPack': 'Seljakotis',
  'backpack.rainGear': 'Vihmakaitse',
  'backpack.rainGearWorn': 'Vihmajope ({pct}%)',
  'backpack.rainGearNone': 'Puudub',
  'backpack.loadBattery': 'Lae taskulampi',
  'backpack.wheelHint': 'Liiguta hiirt ringil eseme valimiseks',
  'backpack.wheelEmpty': 'Sinu seljakott on tühi',
  'backpack.wheelItemsCount': '{count} eset seljakotis',
  'backpack.drop': 'Viska',

  // Sleep Modal
  'sleepModal.ariaLabel': 'Puhkus ja uni',
  'sleepModal.shelteredBed': 'Varjuline voodi',
  'sleepModal.campfireRest': 'Puhkus lõkke ääres',
  'sleepModal.tentShelter': 'Veekindel matkatelk',
  'sleepModal.sleepingBagRest': 'Soojustatud magamiskott',
  'sleepModal.sleepingBagActive': 'Magamiskott kasutusel · +{temp}°C soojust',
  'sleepModal.tentWaterproofNote': 'Veekindel kate · Kaitstud vihma ja tuule eest',
  'sleepModal.closeAria': 'Sulge une aken',
  'sleepModal.duration': 'Une kestus',
  'sleepModal.hourSingular': '{n} tund',
  'sleepModal.hourPlural': '{n} tundi',
  'sleepModal.nap': '1h uinak',
  'sleepModal.rest': '5h puhkus',
  'sleepModal.fullNight': '10h ööuni',
  'sleepModal.projectedEnergy': 'Eeldatav energia',
  'sleepModal.cappedAt': '(piiratud {cap}%)',
  'sleepModal.stomachHydration': 'Kõht ja vedelik ärgates',
  'sleepModal.fillHyd': '{fill}% kõht · {hyd}% vesi',
  'sleepModal.conditions': 'Magamistingimused',
  'sleepModal.feelsCore': 'Tajutav {feels}°C · Keha {core}°C',
  'sleepModal.cancel': 'Tühista',
  'sleepModal.sitInsideBtn': 'Istu telgis',
  'sleepModal.sleepBtn': 'Maga {hours}h',

  // Seated in Tent HUD
  'tentSeated.statusDry': 'Istud matkatelgis · Kuiv ja varjuline',
  'tentSeated.statusRain': 'Istud matkatelgis · Kuulad vihmakrabinat',
  'tentSeated.hint': 'Vaata ringi · [Tab] Kott · [E] Maga · [Tühik / WASD] Tõuse püsti',
  'tentSeated.sleepBtn': 'Maga [E]',
  'tentSeated.standUpBtn': 'Tõuse püsti',

  // Campfire Hearth Modal
  'hearth.ariaLabel': 'Lõkkease',
  'hearth.lit': 'Põleb eredalt',
  'hearth.unlit': 'Külm tuhk ja süütamata halud',
  'hearth.title': '{label} lõke',
  'hearth.closeAria': 'Sulge lõke',
  'hearth.litDesc': 'Soojendab keha, kuivatab märjad riided, küpsetab toitu ja puhastab vett.',
  'hearth.useLighter': 'Kasuta süütamiseks välgumihklit ({count}).',
  'hearth.useMatches': 'Kasuta süütamiseks tikke ({count}).',
  'hearth.noStarter': 'Seljakotis pole välgumihklit ega tikke lõkke süütamiseks.',
  'hearth.bankFire': 'Kustuta lõke',
  'hearth.igniteFire': 'Süüta lõke',
  'hearth.cookHeading': 'Küpseta sütel',
  'hearth.searSteak': 'Prae metsloomaliha',
  'hearth.searSteakDesc': 'Vaja 1× toorest liha (Sul {count}) · +58% kõhtu, pikk püsivus',
  'hearth.roastMushrooms': 'Rösti seenevarras',
  'hearth.roastMushroomsDesc': 'Vaja 3× söödavat seent (Sul {count}) · +30% kõhtu',
  'hearth.boilHeading': 'Keeda ja puhasta vesi',
  'hearth.noFilledBottles': 'Pole ühtegi täidetud veepudelit, mida keeta.',
  'hearth.warmWater': 'Soojenda (46°C)',
  'hearth.boilPurify': 'Keeda ja puhasta',
  'hearth.restByFire': 'Puhka lõkke ääres',
  'hearth.leaveHearth': 'Lahku lõkke äärest',

  // Collapse Overlay
  'collapse.ariaLabel': 'Kaotasid teadvuse Metsavaikuses',
  'collapse.eyebrow': 'Metsavaikus · Seeme #{seed}',
  'collapse.title': 'Kaotasid teadvuse',
  'collapse.primaryCause': 'Peamine põhjus: {cause}',
  'collapse.defaultCause': 'Raske kurnatus ja külm',
  'collapse.compounding': 'Kaasnevad tegurid: {factors}',
  'collapse.timeSurvived': 'Ellujäämisaeg',
  'collapse.mushroomsGathered': 'Korjatud seeni',
  'collapse.edibleInline': '{total} ({edible} söödavat)',
  'collapse.respawn': 'Ärka talus uuesti',
  'collapse.newMap': 'Uus protseduuriline kaart',
  'collapse.titleScreen': 'Avakuva',

  // Interaction Prompts & Actions
  'prompt.gather': '[E] Korja',
  'prompt.pickUp': '[E] Võta kätte',
  'prompt.use': '[E] Kasuta',
  'prompt.kickBreak': '[F] Löö puruks',
  'prompt.kickPush': '[F] Löö / Lükka',
  'prompt.inspect': '[R] Uuri',
  'prompt.takeWood': 'Võta küttepuu (+0.75 kg)',
  'prompt.fallenLogTitle': 'Lamav palk',
  'prompt.fallenLogBreak': '[F] Löö puruks · [R] Uuri',
  'prompt.fallenLogShatter': '[F] Löö veel kord purustamiseks · [R] Uuri',
  'prompt.bogWaterTitle': 'Rabajärve vesi',
  'prompt.bogWaterAction': '[E] Täida veepudelid (keeda enne joomist)',

  // Weather & Biomes
  'weather.clear': 'Selge',
  'weather.mist': 'Pilvine ja rabaudu',
  'weather.rain': 'Vihm',
  'weather.storm': 'Äikesetorm',
  'biome.swamp': 'Kõrgesoo raba',
  'biome.trail': 'Metsarada',
  'biome.road': 'Kruusatee',
  'biome.thicket': 'Põlistihnik',
  'biome.forest': 'Eesti mets',

  // World Props & Dynamic Toasts
  'prop.oldCabinDoor': 'Vana onni uks',
  'prop.namedDoor': '{name} uks',
  'prop.doorDescAbandoned': 'Kõverdunud puit kriiksub roostes hingedel.',
  'prop.doorDescIntact': 'Raske männipuust uks, mis lõhnab puusuitsu järele.',
  'prop.doorOpened': 'Uks avatud.',
  'prop.doorClosed': 'Uks suletud.',
  'prop.doorTouchAbandoned': 'Ilmast räsitud puit on niiske ja pinnuline.',
  'prop.doorTouchIntact': 'Tugev käsitsi hööveldatud Eesti mänd.',
  'prop.bunkName': '{name} nari',
  'prop.bedName': '{name} puuvoodi',
  'prop.bedSpotLabel': '{name} voodi',
  'prop.bedDescWarm': 'Kuiv villane tekk toas — kaitstud vihma ja tuulekülma eest.',
  'prop.bedDescDrafty': 'Tõmbetuulega puitnari — peab vihma, kuid öine külm poeb sisse.',
  'prop.bedTouchWarm': 'Soe käsitsi kootud villane tekk ja kuiv õlgmadrats.',
  'prop.bedTouchDrafty': 'Niiske kriuksuv puunari vanas onnis.',
  'prop.oldSupplyBox': 'Vana varukast',
  'prop.pantryCrate': '{name} sahvrikast',
  'prop.crateDesc': 'Tallel hoitud maamoon ja tagavaratarbed.',
  'prop.pantryFoodDesc': 'Veidi sahvrimoona. Võta see oma toiduvarude täiendamiseks.',
  'prop.pantryTake': 'Võta toitu',
  'prop.campfireBlocked': 'Siin või telgi ukse ees pole lõkke jaoks vaba ruumi.',
  'prop.crateEmpty': 'See varukast on tühi.',
  'prop.crateTouchEmpty': 'Tühi puidust kast.',
  'prop.crateTouchFull': 'Tundub täis ja raske — sees on toiduvaru.',
  'prop.lootedCrate': 'Võtsid kastist ({label}): {items}',
  'prop.wellDecrepitName': '{label} — Riknenud kaev',
  'prop.wellCleanName': '{label} kaev',
  'prop.wellDecrepitDesc': 'Sogane, vetikatest paks seisnud vesi — ilma keetmata ohtlik.',
  'prop.wellCleanDesc': 'Puhas, jääkülm Eesti allikavesi (6°C).',
  'prop.wellDecrepitUse': 'Lagunenud kaevus loksub rohekas seisnud vesi.',
  'prop.wellCleanUse': 'Tõmbasid kargelt külma Eesti allikavett.',
  'prop.wellDecrepitTouch': 'Pragunenud kaevukivid on limased; alt tõuseb hapukas soolõhn.',
  'prop.wellCleanTouch': 'Jahedad samblased maakivid puhta põhjavee kohal.',
  'prop.campfireName': '{label} lõke',
  'prop.campfireWilderness': 'Metsa',
  'prop.campfireDesc': 'Küpseta toitu, keeda vett, soojenda end või puhka lõkke ääres.',
  'prop.campfireStoke': 'Õhutasid lõkke uuesti põlema.',
  'prop.campfireBank': 'Katsid söed tuhaga.',
  'prop.campfireTouchLit': 'Kasesütest kiirgab mõnusat soojust!',
  'prop.campfireTouchCold': 'Külm tuhk ja söestunud halud.',
  'prop.signpostDesc': 'Ilmast puretud puidust teeviit.',
  'prop.signpostMainTitle': 'Teeviit',
  'prop.signpostMainMsg': '↑ {village} · → Kõrgesoo raba ja rabasaared · 4 küla üle Metsavaikuse',
  'prop.signpostBogTitle': 'Rabarada',
  'prop.signpostBogMsg': '„KÕRGESOO RABA — Püsi laudteel, et jõuda rabasaartele.“',
  'prop.woodenCrate': 'Puitkast',
  'prop.woodenCrateDesc': 'Raske ilmast räsitud veokast.',
  'prop.oilDrum': 'Roostes vaat',
  'prop.oilDrumDesc': 'Tühi ilmast räsitud metallvaat.',
  'prop.lanternName': 'Tormilatern',
  'prop.lanternDesc': 'Mattmust petrooleumilatern, mis kumab udus.',
  'prop.lanternLit': 'Latern süüdatud.',
  'prop.lanternDimmed': 'Latern kustutatud.',
  'prop.splitFirewoodName': 'Küttepuu',
  'prop.splitFirewoodDesc':
    'Kuiv lõhutud puit (+0.75 kg). Kanna 3 halgu, et teha lõke ükskõik kuhu kuivale maale.',
  'prop.lyingStumpName': 'Lamav känd',
  'prop.lyingStumpDesc':
    'Kuiv lamav känd ja surnud puit. Löö [F] kaks korda, et purustada see küttepuudeks.',
  'prop.lyingStumpTouch': 'Kuiv, rabe lamav puit. Löö [F], et see halgudeks lõhkuda.',
  'prop.stumpCracked': 'PRAKS! Kuiv känd pragus lahti — löö [F] veel kord, et see purustada.',
  'prop.stumpShattered':
    'Purustasid kännu {count} küttepuuks! Vajuta halgudel [E], et need seljakotti panna.',
  'prop.birchFirewoodName': 'Kasehalg',
  'prop.birchFirewoodDesc':
    'Lõhutud kasehalg (+0.75 kg). Võta 3 halgu, et teha lõke sobivasse kohta.',
  'prop.fieldstoneName': 'Raiekivi',
  'prop.fieldstoneDesc': 'Sile graniitkivi jääajast.',
  'prop.mushroomTagPoison': ' [MÜRGINE]',
  'prop.mushroomTagInedible': ' [Mittesöödav]',
  'prop.campfireTooWet': 'Siin on liiga märg! Mine kuivemale pinnale lõket laduma.',
  'prop.campfireTooClose': 'Siin on juba lõkkease — vajuta sellel hoopis [E].',
  'prop.campfireStacked':
    'Ladusid halud lõkkeasemele! Vajuta sellel [E] ja süüta välgumihkli või tikkudega.',
  'prop.tentName': 'Matkatelk',
  'prop.tentDesc': 'Veekindel matkatelk. Istu vihma ajal sees või maga täielikult kuivalt ja tuulevarjus.',
  'prop.tentSpotLabel': 'Matkatelk',
  'prop.tentSleepAction': 'Istu / maga telgis',
  'prop.tentPackUpAction': 'Paki telk kokku',
  'prop.tentTouch': 'Pingul veekindel kangas ja alumiiniumkaared — sees on kuiv ka paduvihmas.',
  'prop.tentTooWet': 'Siin on liiga märg! Mine kuivemale pinnale telki püstitama.',
  'prop.tentBlocked': 'Siin pole piisavalt vaba lagedat ruumi — astu puudest, kividest või seintest eemale.',
  'prop.tentPitched': 'Püstitasid veekindla matkatelgi! Vaata telgile ja vajuta [E] istumiseks/magamiseks või [F] kokkupakkimiseks.',
  'prop.tentPackedUp': 'Pakkisid matkatelgi kokku (+1.85 kg tagasi seljakotti).',
  'prop.sleepingBagSpotLabel': 'Magamiskott',

  // Gameplay Toasts in MetsavaikusWorld
  'toast.gatherPoisonous': 'HOIATUS: {name} on MÜRGINE! Lisatud seljakotti.',
  'toast.gatherInedible': 'Ettevaatust: {name} on kibe ja mittesöödav.',
  'toast.gatherEdible': 'Korjasid: {name}',
  'toast.packedWoodReady': ' Piisavalt puid lõkke tegemiseks ([G] või Seljakott)!',
  'toast.packedWoodCount': ' ({have}/{need} lõkke jaoks)',
  'toast.packedItem': 'Seljakotti lisatud: {name} (+{unitKg} kg · Kott {totalKg} kg).{hint}',
  'toast.deadfallCracked':
    'PRAKS! Lamav palk lõhenes — löö [F] veel kord, et see küttepuudeks purustada.',
  'toast.deadfallShattered':
    'Purustasid lamava palgi {count} küttepuuks! Vajuta halgudel [E], et need kaasa võtta.',
  'toast.deadfallInspect':
    'Lamav palk: Kuivanud metsapuit. Löö [F] kaks korda, et murda see küttepuudeks.',
  'toast.gatherGently': 'Vajuta [E], et seeni ettevaatlikult korjata.',
  'toast.wontBudge': 'Lükkad objekti ({name}), kuid see ei liigu paigast.',
  'toast.wokeEarly': 'Ärkasid varem kell {time} (magatud {hours}h) — Energia {energy}%.',
  'toast.wokeNormal': 'Ärkasid kell {time} pärast {hours}h puhkust — Energia {energy}%.',
  'toast.weatherChanged': 'Ilm: {weather}',
  'toast.timeAdvanced': 'Aeg liikus +2 tundi edasi.',
  'toast.noFlashlight': 'Sa ei pakkinud taskulampi kaasa.',
  'toast.batteryDead': 'Taskulambi patarei on tühi — lae varupatareid Seljakotis [Tab].',
  'toast.batteryDied': 'Taskulambi patarei sai tühjaks! Lae varupatareid Seljakotis [Tab].',
  'toast.droppedItem': 'Viskasid maha: {name}.',
  'toast.droppedBottle': 'Viskasid veepudeli maha.',
  'toast.bankedFire': 'Kustutasid lõkkesöed.',
  'toast.needWood':
    'Lõkke tegemiseks on vaja {cost}× küttepuud (sul on {have}). Löö [F] lamavaid kände või palke.',
  'toast.noTent': 'Sul pole seljakotis telki kaasas.',
  'toast.noSleepingBag': 'Sul pole seljakotis magamiskotti kaasas.',
  'toast.cannotSleepInWater': 'Vees ei saa magamiskotti lahti rullida — liigu kuivale maale.',
  'toast.woreRainJacket': 'Panid selga veekindla vihmajope (88% vihmakaitse).',
  'toast.tookOffRainJacket': 'Võtsid vihmajope seljast ja panid seljakotti.',
  'toast.noRainJacket': 'Sul pole vihmajopet seljakotis.',
  'toast.satInTent': 'Pugesid matkatelki ilma eest varju.',
  'toast.stoodUpTent': 'Astusid matkatelgist välja.',
  'toast.vomited': 'Tugev oksendamine ({source}) — kõht ja vedelik vähenesid!',

  // Survival Engine messages & death causes
  'poison.bitter': 'Kibe kõhuärritus',
  'poison.bog_water': 'Rabavee kõhukrambid',
  'poison.fly_agaric': 'Punase kärbseseene mürgistus',
  'poison.stale_water': 'Seisnud kaevuvee haigus',
  'poison.destroying_angel': 'Valge kärbseseen (amatoksiin)',
  'death.fatalPoison': 'Surmav: {label}',
  'death.hypothermia': 'Raske alajahtumine',
  'death.dehydration': 'Raske vedelikupuudus',
  'death.starvation': 'Nälg ja kurnatus',
  'deathFactor.hypothermia': 'Alajahtumine ({temp}°C)',
  'deathFactor.soaked': 'Läbimärg ({pct}% märg)',
  'deathFactor.emptyStomach': 'Tühi kõht',
  'deathFactor.dehydrated': 'Vedelikupuudus',
  'deathFactor.sleepDeprived': 'Unepuudus ({hours}h ärkvel)',
  'surv.cannotEat': 'Seda eset ei saa süüa.',
  'surv.noneLeft': 'Seljakotis pole enam alles.',
  'surv.ateNormal': 'Sõid: {name} (+{fill}% kõhtu).',
  'surv.ateDestroyingAngel': 'Sõid: {name}! Surmav amatoksiin levib verre...',
  'surv.ateFlyAgaric': 'Sõid: {name}! Kõhus keerab rängalt.',
  'surv.ateBitter': 'Sõid: {name} — kibedalt ebameeldiv! Kõht valutab.',
  'surv.ateFast': 'Sõid: {name} (+{fill}% kõhtu, kiire energia — kulub kiiresti).',
  'surv.ateSlow': 'Sõid: {name} (+{fill}% kõhtu — püsivad kalorid).',
  'surv.bottleNotFound': 'Pudelit ei leitud.',
  'surv.bottleEmpty': 'Pudel on tühi — täida kaevus või rabajärves.',
  'surv.drank': 'Jõid {liters} L (+{hyd}% vedelikku{chill}).',
  'surv.drankChill': ', -{temp}°C jahutus',
  'surv.drankStale': 'Riknenud kaevuvesi! Tugev iiveldus ja kõhukrambid tabavad sind.',
  'surv.drankBog': 'Jõid keetmata sogast rabavett — kõht koriseb rahutult.',
  'surv.drankSloshing': ' Kõht tundub raske ja loksuv.',
  'surv.noBottlesInPack': 'Seljakotis pole ühtegi veepudelit.',
  'surv.bottlesAlreadyFull': 'Kõik veepudelid on juba täis.',
  'surv.refillCleanOne': 'Täitsid 1 pudeli külma puhta allikaveega (6°C).',
  'surv.refillCleanMany': 'Täitsid {count} pudelit külma puhta allikaveega (6°C).',
  'surv.refillStaleOne': 'Täitsid 1 pudeli seisnud kaevuveega — keeda enne joomist!',
  'surv.refillStaleMany': 'Täitsid {count} pudelit seisnud kaevuveega — keeda enne joomist!',
  'surv.refillBogOne': 'Täitsid 1 pudeli külma rabaveega — keeda enne joomist.',
  'surv.refillBogMany': 'Täitsid {count} pudelit külma rabaveega — keeda enne joomist.',
  'surv.cannotBoilEmpty': 'Tühja pudelit ei saa keeta.',
  'surv.boiledPurified': 'Keetsid ja puhastasid: {name} (ohutu, soe 46°C).',
  'surv.warmedBottle': 'Soojendasid sütel: {name} (46°C).',
  'surv.needRawSteak': 'Küpsetamiseks on vaja 1× toorest metsloomaliha.',
  'surv.cookedSteak': 'Praadisid kasesütel mahlase metsloomaliha!',
  'surv.needEdibleMushrooms': 'Seenevarda jaoks on vaja 3× söödavat metsaseent.',
  'surv.cookedMushrooms': 'Röstisid sooja metsaseenevarda!',
  'surv.notCarryingFlashlight': 'Sul pole taskulampi kaasas.',
  'surv.batteryFull': 'Taskulambi patarei on juba täis.',
  'surv.noExtraBatteries': 'Seljakotis pole varupatareisid.',
  'surv.loadedBattery': 'Panid sisse värsked AA-patareid (100% laetud).',
  'surv.litLighter': 'Süütasid lõkke tormikindla välgumihkliga.',
  'surv.lighterGust': 'Tugev tuuleiil puhus välgumihkli leegi ära — proovi uuesti.',
  'surv.litMatch': 'Tõmbasid tikku ja süütasid lepahalud.',
  'surv.matchSnuffed': 'Niiske õhk kustutas tiku enne, kui tulehakatis süttis.',
  'surv.needFireStarter': 'Lõkke süütamiseks on seljakotti vaja välgumihklit või tikke.',
  'surv.sleepWarnEmptyNow': 'Tühi kõht — energia ei taastu täielikult.',
  'surv.sleepWarnEmptyMid': 'Kõht läheb une pealt tühjaks — energia taastumine on piiratud.',
  'surv.sleepWarnCold': 'Magades on liiga külm — energia taastumine on piiratud.',
  'surv.sleepWarnRain': 'Oled lageda taeva all vihma käes — riided saavad märjaks ja puhkus on piiratud. Püstita telk või otsi katusealust!',
};

export const TRANSLATIONS: Record<LanguageCode, TranslationDict> = {
  en: EN_DICT,
  et: ET_DICT,
};

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  lang: LanguageCode = activeLanguage
): string {
  const dict = TRANSLATIONS[lang] ?? EN_DICT;
  let text = dict[key] ?? EN_DICT[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

// ============================================================================
// Localized Item Catalog & Mushroom Species Dictionaries
// ============================================================================
interface LocalizedItemCopy {
  name: string;
  secondary?: string;
  description: string;
}

const ITEM_TRANSLATIONS: Record<LanguageCode, Record<ItemId, LocalizedItemCopy>> = {
  en: {
    compass: {
      name: 'Magnetic Compass',
      secondary: 'Kompass',
      description: 'Shows magnetic North and live bearing. No terrain map.',
    },
    paper_map: {
      name: 'Paper Topographic Map',
      secondary: 'Kaart',
      description: 'Fixed North-up countryside map. Combine with Compass for live positioning.',
    },
    bottle_05l: {
      name: '0.5 L Trail Flask',
      description: 'Compact 0.5 L flask (0.09 kg empty, 0.59 kg full).',
    },
    bottle_1l: {
      name: '1.0 L Field Canteen',
      description: 'Balanced 1.0 L canteen (0.15 kg empty, 1.15 kg full).',
    },
    bottle_2l: {
      name: '2.0 L Expedition Bottle',
      description: 'Large 2.0 L water jug (0.24 kg empty, 2.24 kg full). Heavy when filled.',
    },
    raw_steak: {
      name: 'Raw Venison Steak',
      secondary: 'Toores liha',
      description: 'Cook over a lit campfire for a hearty, slow-burning meal.',
    },
    seared_steak: {
      name: 'Seared Venison Steak',
      secondary: 'Praetud liha',
      description: 'Rich campfire-seared steak. High calories that keep you full for hours.',
    },
    smoked_sausage: {
      name: 'Smoked Country Sausage',
      secondary: 'Suitsuvorst',
      description: 'Ready-to-eat cured Baltic sausage. Dense calories, long staying power.',
    },
    rye_bread: {
      name: 'Dark Rye Bread',
      secondary: 'Must leib',
      description: 'Dense Estonian sourdough rye loaf. Steady, dependable energy.',
    },
    chocolate_bar: {
      name: 'Dark Chocolate Bar',
      secondary: 'Šokolaad',
      description: 'Light & calorie-dense quick boost, but burns off much faster than a meal.',
    },
    dried_berries: {
      name: 'Dried Forest Berries',
      secondary: 'Kuivatatud marjad',
      description: 'Lingonberries and bilberries. Light trail snack with a touch of moisture.',
    },
    roasted_mushrooms: {
      name: 'Roasted Mushroom Skewer',
      secondary: 'Röstitud seened',
      description: 'Campfire-roasted wild mushrooms. Warm and far more filling than raw.',
    },
    flashlight: {
      name: 'Field Flashlight',
      secondary: 'Taskulamp',
      description: 'Enables [L] night beam. Runs on replaceable AA battery packs.',
    },
    extra_battery: {
      name: 'Extra Batteries',
      secondary: 'Patareid',
      description: 'Restores 100% flashlight charge from your backpack.',
    },
    lighter: {
      name: 'Windproof Lighter',
      secondary: 'Välgumihkel',
      description: 'Reliable campfire ignition even in damp wind (35 strikes).',
    },
    matches: {
      name: 'Safety Matchbox',
      secondary: 'Tikud',
      description: 'Featherweight 12-match box. Can fizzle in heavy rain or storm wind.',
    },
    firewood: {
      name: 'Split Firewood',
      secondary: 'Küttepuu',
      description:
        'Dry split timber kicked from fallen treestumps. Heavy to carry; stack 3 pieces [G] or from Pack to build a campfire.',
    },
    tent: {
      name: 'Waterproof Field Tent',
      secondary: 'Matkatelk',
      description:
        'Compact waterproof A-frame trekking tent. Pitch on dry ground [H] or from Pack to sleep dry in rain & wind.',
    },
    sleeping_bag: {
      name: 'Insulated Sleeping Bag',
      secondary: 'Magamiskott',
      description:
        'Warm three-season down bag (+8.5°C sleep warmth). Lets you sleep anywhere dry and stay warm on cold nights.',
    },
    rain_jacket: {
      name: 'Waterproof Rain Jacket',
      secondary: 'Vihmajope',
      description:
        'Hooded Baltic storm shell. Wear [J] or from Pack to block 88% of rain soaking and cut cold wind.',
    },
    mushroom_kukeseen: {
      name: 'Golden Chanterelle',
      secondary: 'Harilik kukeseen',
      description: 'Edible choice: funnel-shaped apricot-gold ridges under mossy spruce & birch.',
    },
    mushroom_kivipuravik: {
      name: 'Penny Bun (Porcini)',
      secondary: 'Harilik kivipuravik',
      description: 'Edible choice: chestnut bun cap with plump cream net-veined stem.',
    },
    mushroom_kasepuravik: {
      name: 'Birch Bolete',
      secondary: 'Kasepuravik',
      description: 'Edible: charcoal-flecked slender stem growing beside silver birches.',
    },
    mushroom_kuuseriisikas: {
      name: 'Saffron Milk Cap',
      secondary: 'Kuuseriisikas',
      description: 'Edible choice: concentric zoned carrot-orange cap thriving in spruce shade.',
    },
    mushroom_sapipuravik: {
      name: 'Bitter Bolete',
      secondary: 'Sapipuravik',
      description: 'Inedible! Porcini lookalike with pale rosy-pink pores and fiercely bitter flesh.',
    },
    mushroom_punakarbseseen: {
      name: 'Fly Agaric',
      secondary: 'Punane kärbseseen',
      description: 'POISONOUS! Iconic scarlet cap dotted with white warts, skirt ring, and volva.',
    },
    mushroom_valgekarbseseen: {
      name: 'Destroying Angel',
      secondary: 'Valge kärbseseen',
      description: 'DEADLY POISONOUS! Pure snowy-white cap, white gills, hanging ring, and basal cup.',
    },
  },
  et: {
    compass: {
      name: 'Magnetkompass',
      description: 'Näitab põhjasuunda ja täpset kurssi. Maastikukaardita.',
    },
    paper_map: {
      name: 'Topograafiline paberkaart',
      description: 'Põhjasuunaline maastikukaart. Koos kompassiga näitab asukohta ja liikumissuunda.',
    },
    bottle_05l: {
      name: '0,5 L matkapudel',
      description: 'Kompaktne 0,5 L pudel (tühjalt 0,09 kg, täis 0,59 kg).',
    },
    bottle_1l: {
      name: '1,0 L välipudel',
      description: 'Tasakaalus 1,0 L pudel (tühjalt 0,15 kg, täis 1,15 kg).',
    },
    bottle_2l: {
      name: '2,0 L matkakanister',
      description: 'Suur 2,0 L veepudel (tühjalt 0,24 kg, täis 2,24 kg). Täis peast raske.',
    },
    raw_steak: {
      name: 'Toores metsloomaliha',
      description: 'Küpseta lõkkel toekaks ja kauakestvaks eineks.',
    },
    seared_steak: {
      name: 'Praetud metsloomaliha',
      description: 'Lõkkel pruunistatud steik. Palju kaloreid, mis hoiavad kõhu tunde täis.',
    },
    smoked_sausage: {
      name: 'Suitsuvorst',
      description: 'Söömiseks valmis maasuitsuvorst. Toekad ja kauapüsivad kalorid.',
    },
    rye_bread: {
      name: 'Must leib',
      description: 'Tihe Eesti juuretisega rukkileib. Ühtlane ja kindel jõuallikas.',
    },
    chocolate_bar: {
      name: 'Tume šokolaad',
      description: 'Kerge ja kiire energialaeng, kuid põleb kõhus märksa kiiremini ära.',
    },
    dried_berries: {
      name: 'Kuivatatud metsamarjad',
      description: 'Pohlad ja mustikad. Kerge matkasnäkk vähese niiskusega.',
    },
    roasted_mushrooms: {
      name: 'Röstitud seenevarras',
      description: 'Lõkkel röstitud metsaseened. Soojad ja märksa toitvam kui toorelt.',
    },
    flashlight: {
      name: 'Taskulamp',
      description: 'Võimaldab [L] öist valgusvihku. Töötab vahetatavate AA-patareidega.',
    },
    extra_battery: {
      name: 'Varupatareid',
      description: 'Taastab seljakotist taskulambi laetuse 100%-ni.',
    },
    lighter: {
      name: 'Tormikindel välgumihkel',
      description: 'Kindel lõkkesüütaja ka niiskes tuules (35 süütamist).',
    },
    matches: {
      name: 'Tikutoos',
      description: 'Ülikerge 12 tikuga toos. Võib tugevas vihmas või tormituules kustuda.',
    },
    firewood: {
      name: 'Küttepuu',
      description:
        'Kuiv lõhutud puit lamavatest kändudest. Raske kanda; lao 3 halgu [G] või kotist lõkke tegemiseks.',
    },
    tent: {
      name: 'Veekindel matkatelk',
      description:
        'Kompaktne veekindel matkatelk. Püstita kuivale maale [H] või kotist, et magada kuivalt vihmas ja tuules.',
    },
    sleeping_bag: {
      name: 'Soojustatud magamiskott',
      description:
        'Soe kolme hooaja magamiskott (+8,5°C une soojust). Lubab magada kuival maal ja hoiab öösel sooja.',
    },
    rain_jacket: {
      name: 'Veekindel vihmajope',
      description:
        'Kapuutsiga tormijope. Pane selga [J] või seljakotist, et tõrjuda 88% vihmast ja külma tuult.',
    },
    mushroom_kukeseen: {
      name: 'Harilik kukeseen',
      description: 'Hea söögiseen: lehtrikujuline kuldkollane kübar samblases kuusikus ja kaasikus.',
    },
    mushroom_kivipuravik: {
      name: 'Harilik kivipuravik',
      description: 'Väärt söögiseen: kastanpruun kübar ja jässakas võrguline hele jalg.',
    },
    mushroom_kasepuravik: {
      name: 'Kasepuravik',
      description: 'Söödav: tumedate soomustega sale jalg kaskede läheduses.',
    },
    mushroom_kuuseriisikas: {
      name: 'Kuuseriisikas',
      description: 'Hea söögiseen: kontsentriliste ringidega porgandioranž kübar kuuskede all.',
    },
    mushroom_sapipuravik: {
      name: 'Sapipuravik',
      description: 'Mittesöödav! Kivipuraviku teisik kahvaturoosade torukeste ja kibeda viljalihaga.',
    },
    mushroom_punakarbseseen: {
      name: 'Punane kärbseseen',
      description: 'MÜRGINE! Ere sarlakpunane kübar valgete täppide, rõnga ja tupega.',
    },
    mushroom_valgekarbseseen: {
      name: 'Valge kärbseseen',
      description: 'ELUOHTLIKULT MÜRGINE! Lumivalge kübar, valged eoslehed, rõngas ja tupp.',
    },
  },
};

export interface LocalizedMushroomCopy {
  name: string;
  displayLabel: string;
  note: string;
}

const MUSHROOM_TRANSLATIONS: Record<LanguageCode, Record<MushroomSpecies, LocalizedMushroomCopy>> = {
  en: {
    kukeseen: {
      name: 'Golden Chanterelle',
      displayLabel: 'Golden Chanterelle (Harilik kukeseen)',
      note: 'Edible choice: funnel-shaped apricot-gold ridges under mossy spruce & birch.',
    },
    kivipuravik: {
      name: 'Penny Bun (Porcini)',
      displayLabel: 'Penny Bun (Harilik kivipuravik)',
      note: 'Edible choice: chestnut bun cap with plump cream net-veined stem.',
    },
    kasepuravik: {
      name: 'Birch Bolete',
      displayLabel: 'Birch Bolete (Kasepuravik)',
      note: 'Edible: charcoal-flecked slender stem growing beside silver birches.',
    },
    kuuseriisikas: {
      name: 'Saffron Milk Cap',
      displayLabel: 'Saffron Milk Cap (Kuuseriisikas)',
      note: 'Edible choice: concentric zoned carrot-orange cap thriving in spruce shade.',
    },
    sapipuravik: {
      name: 'Bitter Bolete',
      displayLabel: 'Bitter Bolete (Sapipuravik)',
      note: 'Inedible! Porcini lookalike with pale rosy-pink pores and fiercely bitter flesh.',
    },
    punakarbseseen: {
      name: 'Fly Agaric',
      displayLabel: 'Fly Agaric (Punane kärbseseen)',
      note: 'POISONOUS! Iconic scarlet cap dotted with white warts, skirt ring, and volva.',
    },
    valgekarbseseen: {
      name: 'Destroying Angel',
      displayLabel: 'Destroying Angel (Valge kärbseseen)',
      note: 'DEADLY POISONOUS! Pure snowy-white cap, white gills, hanging ring, and basal cup.',
    },
  },
  et: {
    kukeseen: {
      name: 'Harilik kukeseen',
      displayLabel: 'Harilik kukeseen',
      note: 'Hea söögiseen: lehtrikujuline kuldkollane kübar samblases kuusikus ja kaasikus.',
    },
    kivipuravik: {
      name: 'Harilik kivipuravik',
      displayLabel: 'Harilik kivipuravik',
      note: 'Väärt söögiseen: kastanpruun kübar ja jässakas võrguline hele jalg.',
    },
    kasepuravik: {
      name: 'Kasepuravik',
      displayLabel: 'Kasepuravik',
      note: 'Söödav: tumedate soomustega sale jalg kaskede läheduses.',
    },
    kuuseriisikas: {
      name: 'Kuuseriisikas',
      displayLabel: 'Kuuseriisikas',
      note: 'Hea söögiseen: kontsentriliste ringidega porgandioranž kübar kuuskede all.',
    },
    sapipuravik: {
      name: 'Sapipuravik',
      displayLabel: 'Sapipuravik',
      note: 'Mittesöödav! Kivipuraviku teisik kahvaturoosade torukeste ja kibeda viljalihaga.',
    },
    punakarbseseen: {
      name: 'Punane kärbseseen',
      displayLabel: 'Punane kärbseseen',
      note: 'MÜRGINE! Ere sarlakpunane kübar valgete täppide, rõnga ja tupega.',
    },
    valgekarbseseen: {
      name: 'Valge kärbseseen',
      displayLabel: 'Valge kärbseseen',
      note: 'ELUOHTLIKULT MÜRGINE! Lumivalge kübar, valged eoslehed, rõngas ja tupp.',
    },
  },
};

export function getItemName(id: ItemId, lang: LanguageCode = activeLanguage): string {
  return ITEM_TRANSLATIONS[lang]?.[id]?.name ?? ITEM_TRANSLATIONS.en[id].name;
}

export function getItemSecondaryName(
  id: ItemId,
  lang: LanguageCode = activeLanguage
): string | undefined {
  return ITEM_TRANSLATIONS[lang]?.[id]?.secondary;
}

export function getItemDescription(id: ItemId, lang: LanguageCode = activeLanguage): string {
  return ITEM_TRANSLATIONS[lang]?.[id]?.description ?? ITEM_TRANSLATIONS.en[id].description;
}

export function getMushroomCopy(
  species: MushroomSpecies,
  lang: LanguageCode = activeLanguage
): LocalizedMushroomCopy {
  return MUSHROOM_TRANSLATIONS[lang]?.[species] ?? MUSHROOM_TRANSLATIONS.en[species];
}

export function getWeatherLabel(weather: WeatherId, lang: LanguageCode = activeLanguage): string {
  const key = `weather.${weather}` as TranslationKey;
  return t(key, undefined, lang);
}

export function getLocalizedBiomeLabel(
  biomeId: 'village' | 'abandoned' | 'island' | 'swamp' | 'road' | 'thicket' | 'forest',
  rawLabel: string,
  lang: LanguageCode = activeLanguage
): string {
  if (biomeId === 'swamp') return t('biome.swamp', undefined, lang);
  if (biomeId === 'thicket') return t('biome.thicket', undefined, lang);
  if (biomeId === 'forest') return t('biome.forest', undefined, lang);
  if (biomeId === 'road') {
    return rawLabel.includes('Metsarada') || rawLabel.includes('Trail')
      ? t('biome.trail', undefined, lang)
      : t('biome.road', undefined, lang);
  }
  return rawLabel;
}

export function getLoadTierLabel(tier: LoadTier, lang: LanguageCode = activeLanguage): string {
  return t(`loadTier.${tier}` as TranslationKey, undefined, lang);
}

export function getHypothermiaLabel(
  stage: HypothermiaStage,
  lang: LanguageCode = activeLanguage
): string {
  return t(`hypo.${stage}` as TranslationKey, undefined, lang);
}

export function getNavigationModeLabel(
  mode: NavigationMode,
  lang: LanguageCode = activeLanguage
): string {
  return t(`navMode.${mode}` as TranslationKey, undefined, lang);
}

export function getStayingPowerLabel(
  power: 'Short' | 'Moderate' | 'Long',
  lang: LanguageCode = activeLanguage
): string {
  return t(`staying.${power}` as TranslationKey, undefined, lang);
}

export function getWaterQualityShort(
  q: WaterQuality,
  lang: LanguageCode = activeLanguage
): string {
  return t(`waterQuality.${q}` as TranslationKey, undefined, lang);
}

export function getPoisonLabel(kind: PoisonKind, lang: LanguageCode = activeLanguage): string {
  return t(`poison.${kind}` as TranslationKey, undefined, lang);
}

export function getItemTranslationRecord(lang: LanguageCode): Record<ItemId, LocalizedItemCopy> {
  return ITEM_TRANSLATIONS[lang];
}

export function getMushroomTranslationRecord(
  lang: LanguageCode
): Record<MushroomSpecies, LocalizedMushroomCopy> {
  return MUSHROOM_TRANSLATIONS[lang];
}
