export type MushroomSpecies =
  | 'kukeseen'
  | 'kivipuravik'
  | 'kasepuravik'
  | 'kuuseriisikas'
  | 'sapipuravik'
  | 'punakarbseseen'
  | 'valgekarbseseen';

export type MushroomEdibility = 'edible' | 'inedible' | 'poisonous';

export interface MushroomSpeciesMeta {
  estonian: string;
  english: string;
  edibility: MushroomEdibility;
  note: string;
}

export const MUSHROOM_SPECIES_INFO: Record<MushroomSpecies, MushroomSpeciesMeta> = {
  kukeseen: {
    estonian: 'Harilik kukeseen',
    english: 'Golden Chanterelle',
    edibility: 'edible',
    note: 'Edible choice: funnel-shaped apricot-gold ridges under mossy spruce & birch.',
  },
  kivipuravik: {
    estonian: 'Harilik kivipuravik',
    english: 'Penny Bun (Porcini)',
    edibility: 'edible',
    note: 'Edible choice: chestnut bun cap with plump cream net-veined stem.',
  },
  kasepuravik: {
    estonian: 'Kasepuravik',
    english: 'Birch Bolete',
    edibility: 'edible',
    note: 'Edible: charcoal-flecked slender stem growing beside silver birches.',
  },
  kuuseriisikas: {
    estonian: 'Kuuseriisikas',
    english: 'Saffron Milk Cap',
    edibility: 'edible',
    note: 'Edible choice: concentric zoned carrot-orange cap thriving in spruce shade.',
  },
  sapipuravik: {
    estonian: 'Sapipuravik',
    english: 'Bitter Bolete',
    edibility: 'inedible',
    note: 'Inedible! Porcini lookalike with pale rosy-pink pores and fiercely bitter flesh.',
  },
  punakarbseseen: {
    estonian: 'Punane kärbseseen',
    english: 'Fly Agaric',
    edibility: 'poisonous',
    note: 'POISONOUS! Iconic scarlet cap dotted with white warts, skirt ring, and volva.',
  },
  valgekarbseseen: {
    estonian: 'Valge kärbseseen',
    english: 'Destroying Angel',
    edibility: 'poisonous',
    note: 'DEADLY POISONOUS! Pure snowy-white cap, white gills, hanging ring, and basal cup.',
  },
};

export interface MushroomBasket {
  total: number;
  edible: number;
  inedible: number;
  poisonous: number;
  bySpecies: Record<MushroomSpecies, number>;
}

export function createEmptyBasket(): MushroomBasket {
  return {
    total: 0,
    edible: 0,
    inedible: 0,
    poisonous: 0,
    bySpecies: {
      kukeseen: 0,
      kivipuravik: 0,
      kasepuravik: 0,
      kuuseriisikas: 0,
      sapipuravik: 0,
      punakarbseseen: 0,
      valgekarbseseen: 0,
    },
  };
}

export function addMushroomToBasket(
  basket: MushroomBasket,
  species: MushroomSpecies
): MushroomBasket {
  const meta = MUSHROOM_SPECIES_INFO[species];
  return {
    total: basket.total + 1,
    edible: basket.edible + (meta.edibility === 'edible' ? 1 : 0),
    inedible: basket.inedible + (meta.edibility === 'inedible' ? 1 : 0),
    poisonous: basket.poisonous + (meta.edibility === 'poisonous' ? 1 : 0),
    bySpecies: {
      ...basket.bySpecies,
      [species]: basket.bySpecies[species] + 1,
    },
  };
}

export interface InteractableDescriptor {
  name: string;
  desc: string;
  gatherable?: boolean;
  carryable?: boolean;
  kickable?: boolean;
  hasUse?: boolean;
}

export interface InteractionPromptData {
  title: string;
  actionsText: string;
}

export function buildInteractionPrompt(
  target: InteractableDescriptor | null,
  isCarrying: boolean
): InteractionPromptData | null {
  if (!target || isCarrying) return null;

  const actions: string[] = [];
  if (target.gatherable) {
    actions.push('[E] Gather');
  } else if (target.carryable) {
    actions.push('[E] Pick up');
  } else if (target.hasUse) {
    actions.push('[E] Use');
  }

  // Gatherable items (like mushrooms) are never kickable/throwable
  if (!target.gatherable && target.kickable) {
    actions.push('[F] Kick / Push');
  }

  actions.push('[R] Inspect');

  return {
    title: target.name,
    actionsText: actions.join('  ·  '),
  };
}

export function smoothFps(prevEma: number, frameDeltaSec: number): number {
  if (frameDeltaSec <= 0.0001) return prevEma;
  const instant = Math.min(240, 1 / frameDeltaSec);
  if (prevEma <= 0) return instant;
  return prevEma * 0.88 + instant * 0.12;
}

export function formatFpsLabel(fps: number): string {
  return `${Math.max(1, Math.round(fps))} FPS`;
}

export interface WeatherWindProfile {
  baseStrength: number;
  gustAmplitude: number;
  gustSpeed: number;
}

export function getWeatherWindProfile(
  weather: 'clear' | 'mist' | 'rain' | 'storm'
): WeatherWindProfile {
  switch (weather) {
    case 'clear':
      return { baseStrength: 0.9, gustAmplitude: 0.35, gustSpeed: 0.55 };
    case 'mist':
      return { baseStrength: 0.5, gustAmplitude: 0.22, gustSpeed: 0.35 };
    case 'rain':
      return { baseStrength: 1.55, gustAmplitude: 0.55, gustSpeed: 0.9 };
    case 'storm':
      return { baseStrength: 2.35, gustAmplitude: 0.85, gustSpeed: 1.35 };
  }
}

export function canClearHeightCollider(
  feetY: number,
  groundY: number,
  colliderHeightAboveGround: number
): boolean {
  return feetY >= groundY + colliderHeightAboveGround - 0.08;
}
