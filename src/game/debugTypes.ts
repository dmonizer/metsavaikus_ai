import { MUSHROOM_SPECIES_INFO, MushroomSpecies } from './gameLogic';
import {
  InventoryState,
  ITEM_CATALOG,
  ItemId,
  WaterQuality,
} from './itemCatalog';
import {
  PlayerSurvivalState,
  WeightTierThresholds,
} from './survivalEngine';
import type { DynamicFloraKind } from '../world/foliageFactory';
import type { WeatherId } from '../world/weatherAndSky';
import type { HutDecayState } from '../world/worldBlueprint';
import type { PerfCaptureStatus } from './perfCapture';

export interface DebugTargetHit {
  layer: string;
  name: string;
  point: { x: number; y: number; z: number };
  distanceM: number;
  biomeLabel: string;
  biomeWeights: Array<{ id: string; label: string; weight: number }>;
  terrainY: number;
  slopeDeg: number;
  surfaceMaterial: string;
  waterDepthM: number;
  inWaterBasin: boolean;
  shelterQuality: string;
  shelterLabel: string | null;
  nearCampfireFactor: number;
  roadDistanceM: number;
  meta: Record<string, string | number | boolean>;
  capturedAtMs: number;
  source: 'center' | 'cursor';
}

export interface DebugPerfPoint {
  fps: number;
  rawDtMs: number;
  renderMs: number;
  terrainMs: number;
  vegMs: number;
  skyMs: number;
  propsMs: number;
  playerMs: number;
  minimapMs: number;
  externalWaitMs: number;
}

export interface DebugPerfSnapshot {
  fpsEma: number;
  fpsInstant: number;
  rawDtMs: number;
  tickCpuMs: number;
  externalWaitMs: number;
  renderMs: number;
  terrainMs: number;
  vegMs: number;
  skyMs: number;
  propsMs: number;
  playerMs: number;
  minimapMs: number;
  bottleneck: string;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  visibleChunks: number;
  lodCounts: [number, number, number];
  treesRendered: number;
  foliageRendered: number;
  culledInstances: number;
  candidateInstances: number;
  grassCount: number;
  pixelRatio: number;
  backbufferPx: [number, number];
  fogCullDist: number;
  jsHeapMB: number | null;
  overlays: string;
  history: DebugPerfPoint[];
}

export type DebugEventSource = 'soundscape' | 'survival' | 'game' | 'debug';

export interface DebugEventEntry {
  id: number;
  timestampMs: number;
  simTimeStr: string;
  source: DebugEventSource;
  type: string;
  summary: string;
  payload?: Record<string, unknown>;
}

export type SpawnCategory = 'mushroom' | 'flora' | 'structure' | 'item';

export interface SpawnCatalogEntry {
  id: string;
  category: SpawnCategory;
  label: string;
  sublabel: string;
  mushroomSpecies?: MushroomSpecies;
  floraKind?: DynamicFloraKind;
  hutDecay?: HutDecayState;
  campfireLit?: boolean;
  itemId?: ItemId;
}

export function buildSpawnCatalog(): SpawnCatalogEntry[] {
  const entries: SpawnCatalogEntry[] = [];

  for (const [species, info] of Object.entries(MUSHROOM_SPECIES_INFO) as Array<
    [MushroomSpecies, (typeof MUSHROOM_SPECIES_INFO)[MushroomSpecies]]
  >) {
    entries.push({
      id: `mushroom:${species}`,
      category: 'mushroom',
      label: info.estonian,
      sublabel: `${info.english} · ${info.edibility}`,
      mushroomSpecies: species,
    });
  }

  const floraDefs: Array<{ kind: DynamicFloraKind; label: string; sublabel: string }> = [
    { kind: 'spruce', label: 'Norway Spruce', sublabel: 'Kuusk (forest conifer)' },
    { kind: 'lone_spruce', label: 'Lone Spruce (Dense)', sublabel: 'Thick low-branched spruce' },
    { kind: 'spruce_sapling', label: 'Spruce Sapling', sublabel: 'Young conifer understory' },
    { kind: 'pine', label: 'Scots Pine', sublabel: 'Mänd (high-canopy pine)' },
    { kind: 'birch', label: 'Silver Birch', sublabel: 'Kask (white bark)' },
    { kind: 'bog_pine', label: 'Stunted Bog Pine', sublabel: 'Rabamänd' },
    { kind: 'boulder', label: 'Granite Boulder', sublabel: 'Glacial erratic rock' },
  ];
  for (const fl of floraDefs) {
    entries.push({
      id: `flora:${fl.kind}`,
      category: 'flora',
      label: fl.label,
      sublabel: fl.sublabel,
      floraKind: fl.kind,
    });
  }

  const hutDefs: Array<{ decay: HutDecayState; label: string; sublabel: string }> = [
    { decay: 'intact', label: 'Log Hut (Intact)', sublabel: 'Warm roofed cabin w/ bed & door' },
    { decay: 'sagging', label: 'Log Hut (Sagging)', sublabel: 'Weathered drafty shelter' },
    { decay: 'roofless', label: 'Log Hut (Roofless)', sublabel: 'Exposed timber shell' },
    { decay: 'ruins', label: 'Log Hut (Ruins)', sublabel: 'Broken lower walls & rubble' },
  ];
  for (const hut of hutDefs) {
    entries.push({
      id: `hut:${hut.decay}`,
      category: 'structure',
      label: hut.label,
      sublabel: hut.sublabel,
      hutDecay: hut.decay,
    });
  }
  entries.push({
    id: 'structure:campfire_lit',
    category: 'structure',
    label: 'Campfire (Lit)',
    sublabel: 'Stone ring + active flames & warmth',
    campfireLit: true,
  });
  entries.push({
    id: 'structure:campfire_cold',
    category: 'structure',
    label: 'Campfire (Unlit)',
    sublabel: 'Cold campfire pit',
    campfireLit: false,
  });

  for (const def of Object.values(ITEM_CATALOG)) {
    entries.push({
      id: `item:${def.id}`,
      category: 'item',
      label: def.name,
      sublabel: `${def.category} · ${def.weightKg.toFixed(2)} kg`,
      itemId: def.id,
    });
  }

  return entries;
}

export interface TeleportLocation {
  id: string;
  label: string;
  kind: 'village' | 'island' | 'bog' | 'homestead' | 'mushroom' | 'picked';
  x: number;
  z: number;
}

export interface DebugSnapshot {
  simDay: number;
  hourOfDay: number;
  simTimeStr: string;
  clockSpeedMultiplier: number;
  simPaused: boolean;
  godMode: boolean;
  noClip: boolean;
  moveSpeedMultiplier: number;
  overlayEnabled: boolean;
  pickTargetActive: boolean;
  autoSpawnOnPick: boolean;
  selectedSpawnId: string;
  weather: WeatherId;
  weatherOverride: WeatherId | null;
  windStrength: number;
  windOverride: number | null;
  weightThresholds: WeightTierThresholds;
  playerPos: { x: number; y: number; z: number };
  playerYaw: number;
  playerPitch: number;
  isSwimming: boolean;
  onBoardwalk: boolean;
  waterDepthM: number;
  discoveredPercent: number;
  survival: PlayerSurvivalState;
  inventory: InventoryState;
  centerHit: DebugTargetHit | null;
  pickedHit: DebugTargetHit | null;
  events: DebugEventEntry[];
  perf: DebugPerfSnapshot | null;
  perfCapture: PerfCaptureStatus;
  perfReflectionsEnabled: boolean;
  teleportLocations: TeleportLocation[];
}

export interface DebugActions {
  setSimPaused: (paused: boolean) => void;
  setGodMode: (enabled: boolean) => void;
  setNoClip: (enabled: boolean) => void;
  setMoveSpeedMultiplier: (mult: number) => void;
  setOverlayEnabled: (enabled: boolean) => void;
  setPickTargetActive: (active: boolean) => void;
  setAutoSpawnOnPick: (enabled: boolean) => void;
  setSelectedSpawnId: (spawnId: string) => void;
  setClockSpeedMultiplier: (mult: number) => void;
  setTimeOfDayHour: (hour: number) => void;
  setWeatherOverride: (weather: WeatherId | null) => void;
  setWindOverride: (wind: number | null) => void;
  setVitalsPatch: (
    patch: Partial<
      Pick<
        PlayerSurvivalState,
        | 'health'
        | 'energy'
        | 'hydration'
        | 'stomachFullness'
        | 'physicalTiredness'
        | 'bodyTempC'
        | 'wetness'
        | 'nausea'
        | 'awakeHours'
        | 'digestionBurnRate'
        | 'waterStomachLoadL'
      >
    > & { flashlightBattery?: number }
  ) => void;
  applyStatePreset: (
    preset:
      | 'soaked'
      | 'hypothermic'
      | 'exhausted'
      | 'starving'
      | 'dehydrated'
      | 'poisoned'
      | 'cleanse'
  ) => void;
  adjustInventoryItem: (itemId: ItemId, delta: number) => void;
  setBottleState: (
    uid: string,
    patch: { waterLiters?: number; waterQuality?: WaterQuality; waterTempC?: number }
  ) => void;
  adjustDebugBallastKg: (deltaKg: number) => void;
  setDebugBallastKg: (kg: number) => void;
  setWeightThresholds: (patch: Partial<WeightTierThresholds>) => void;
  spawnEntry: (
    spawnId: string,
    target: 'in_front' | 'picked' | 'coords',
    opts?: { x?: number; z?: number; scale?: number }
  ) => { ok: boolean; message: string };
  revealFullMap: () => void;
  teleportTo: (x: number, z: number, label?: string) => void;
  clearEvents: () => void;
  emitDebugEvent: (type: string, payload?: Record<string, unknown>, intensity?: number) => void;
  dumpPerfText: () => string;
  startPerfCapture: () => void;
  stopPerfCapture: () => void;
  dumpPerfCaptureText: () => string;
  setPerfReflectionsEnabled: (enabled: boolean) => void;
}
