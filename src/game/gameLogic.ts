import { t } from '../i18n/i18n';

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
  breakable?: boolean;
  pickupLabel?: string;
  secondaryActionLabel?: string;
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
  if (target.pickupLabel) {
    actions.push(`[E] ${target.pickupLabel}`);
  } else if (target.gatherable) {
    actions.push(t('prompt.gather'));
  } else if (target.carryable) {
    actions.push(t('prompt.pickUp'));
  } else if (target.hasUse) {
    actions.push(t('prompt.use'));
  }

  // Secondary [F] action (e.g. Pack Up Tent) or Kick/Push for non-gatherables
  if (target.secondaryActionLabel) {
    actions.push(`[F] ${target.secondaryActionLabel}`);
  } else if (!target.gatherable && target.kickable) {
    actions.push(target.breakable ? t('prompt.kickBreak') : t('prompt.kickPush'));
  }

  actions.push(t('prompt.inspect'));

  return {
    title: target.name,
    actionsText: actions.join('  ·  '),
  };
}

export function smoothFps(prevEma: number, frameDeltaSec: number): number {
  if (frameDeltaSec <= 0.0001) return prevEma;
  const clampedDt = Math.min(0.5, Math.max(1 / 240, frameDeltaSec));
  if (prevEma <= 0) return 1 / clampedDt;
  const prevDt = 1 / Math.max(1, prevEma);
  const nextDt = prevDt * 0.88 + clampedDt * 0.12;
  return 1 / nextDt;
}

export function formatFpsLabel(fps: number): string {
  return `${Math.max(1, Math.round(fps))} FPS`;
}

/**
 * Computes discrete DRS pixel-ratio steps bounded by a GPU pixel budget so
 * integrated GPUs (e.g. Intel UHD 630 on a 2155x1287 viewport) don't choke
 * shading 2.8M pixels at 1.0x DPR while discrete GPUs stay crisp.
 */
export function computeAdaptiveDprSteps(
  viewportW: number,
  viewportH: number,
  deviceDpr: number,
  isSoftwareGl: boolean,
  isLowPowerGpu: boolean
): number[] {
  if (isSoftwareGl) return [1];
  const pixelsAt1x = Math.max(1, viewportW * viewportH);
  const hardMaxDpr = Math.min(deviceDpr || 1, isLowPowerGpu ? 0.9 : 1.15);
  const pixelBudget = isLowPowerGpu ? 920_000 : 2_300_000;
  const budgetDpr = Math.sqrt(pixelBudget / pixelsAt1x);
  const startDpr = Math.max(0.5, Math.min(hardMaxDpr, Math.round(budgetDpr * 100) / 100));
  const floorDpr = isLowPowerGpu ? 0.45 : 0.62;

  const steps: number[] = [startDpr];
  if (isLowPowerGpu) {
    // Keep step count minimal (2 steps on UHD/2K viewports) to avoid Mesa EGL swapchain resize stalls
    if (startDpr > 0.74) {
      const mid = Math.max(floorDpr, Math.round(startDpr * 0.74 * 100) / 100);
      if (mid < startDpr - 0.04 && mid > floorDpr + 0.04) {
        steps.push(mid);
      }
    }
    if (steps[steps.length - 1] > floorDpr + 0.03) {
      steps.push(floorDpr);
    }
    return steps;
  }

  const multipliers = [0.85, 0.7, 0.58];
  for (const m of multipliers) {
    const candidate = Math.max(floorDpr, Math.round(startDpr * m * 100) / 100);
    if (candidate < steps[steps.length - 1] - 0.03) {
      steps.push(candidate);
    }
  }
  if (steps[steps.length - 1] > floorDpr + 0.03) {
    steps.push(floorDpr);
  }
  return steps;
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

export const RESOLUTION_SCALE_MIN = 0.5;
export const RESOLUTION_SCALE_MAX = 1.5;
export const RESOLUTION_SCALE_STEP = 0.05;

export function clampResolutionScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  const clamped = Math.max(RESOLUTION_SCALE_MIN, Math.min(RESOLUTION_SCALE_MAX, scale));
  return Math.round(clamped * 20) / 20;
}

export function computeScaledBackbuffer(
  viewportW: number,
  viewportH: number,
  scale: number
): { width: number; height: number } {
  const safeScale = Math.max(0.25, Math.min(2.5, Number.isFinite(scale) ? scale : 1));
  return {
    width: Math.max(1, Math.round(Math.max(1, viewportW) * safeScale)),
    height: Math.max(1, Math.round(Math.max(1, viewportH) * safeScale)),
  };
}

export function formatResolutionSummary(
  viewportW: number,
  viewportH: number,
  scale: number,
  isAuto: boolean
): string {
  const pct = Math.round(scale * 100);
  const { width, height } = computeScaledBackbuffer(viewportW, viewportH, scale);
  return isAuto
    ? `${t('title.auto')} · ${pct}% (${width}×${height})`
    : `${pct}% (${width}×${height})`;
}


