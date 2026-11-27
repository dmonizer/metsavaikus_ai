import type React from 'react';
import type { InteractionPromptData, MushroomSpecies } from '../game/gameLogic';
import type { ItemId, NavigationMode, PackingSelection } from '../game/itemCatalog';
import type { QualityMode, QualityTier, QualityTierName } from '../game/qualityGovernor';
import type { PlayerSurvivalState } from '../game/survivalEngine';
import type { DebugActions, DebugSnapshot } from '../game/debugTypes';
import type { DiagnosticsSnapshot, ValidationIssue } from '../soundscape/types';
import type { CampfireInfo, SleepSpotInfo, TentInfo } from '../world/architectureAndProps';
import type { WeatherId } from '../world/weatherAndSky';

export type GamePhase =
  | 'title'
  | 'packing'
  | 'playing'
  | 'paused'
  | 'sleeping'
  | 'collapsing'
  | 'collapsed';

export interface WorldHudRefs {
  fpsEl: React.RefObject<HTMLSpanElement | null>;
  biomeEl: React.RefObject<HTMLDivElement | null>;
  timeWeatherEl: React.RefObject<HTMLDivElement | null>;
  flashEl: React.RefObject<HTMLDivElement | null>;
  minimapCanvasEl: React.RefObject<HTMLCanvasElement | null>;
  compassHeadingEl: React.RefObject<HTMLDivElement | null>;
  healthFillEl: React.RefObject<HTMLDivElement | null>;
  energyFillEl: React.RefObject<HTMLDivElement | null>;
  hydrationFillEl: React.RefObject<HTMLDivElement | null>;
  fullnessFillEl: React.RefObject<HTMLDivElement | null>;
  tirednessFillEl: React.RefObject<HTMLDivElement | null>;
  bodyTempEl: React.RefObject<HTMLSpanElement | null>;
  conditionsEl: React.RefObject<HTMLDivElement | null>;
  frostVignetteEl: React.RefObject<HTMLDivElement | null>;
  nauseaVignetteEl: React.RefObject<HTMLDivElement | null>;
  drowsyVignetteEl: React.RefObject<HTMLDivElement | null>;
}

export interface WorldSurvivalSnapshot {
  survival: PlayerSurvivalState;
  inventory: import('../game/itemCatalog').InventoryState;
  navigationMode: NavigationMode;
  discoveredPercent: number;
  fogVersion: number;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  hourOfDay: number;
  weather: WeatherId;
  windStrength: number;
  shelterLabel: string | null;
  nearLitCampfireFactor: number;
  seatedInTent: boolean;
  wearingRainJacket: boolean;
  isSwimming: boolean;
  waterDepthM: number;
  sleepProgress: { elapsedHours: number; totalHours: number; spotLabel: string } | null;
  collapseProgress: number;
}

export interface WorldCallbacks {
  onGatherMushroom: (species: MushroomSpecies) => void;
  onPromptChange: (prompt: InteractionPromptData | null) => void;
  onCarryChange: (label: string) => void;
  onToast: (msg: string) => void;
  onPhaseChange: (phase: GamePhase) => void;
  onWorldReady: (info: { wasmActive: boolean; totalMushrooms: number }) => void;
  onWorldError?: (message: string) => void;
  onDisplayMetrics?: (info: { autoDpr: number; viewportW: number; viewportH: number }) => void;
  onQualityChange?: (info: {
    mode: QualityMode;
    tier: QualityTier;
    tierName: QualityTierName;
    maxRenderDist: number;
  }) => void;
  onSurvivalSnapshot: (snap: WorldSurvivalSnapshot) => void;
  onOpenSleepModal: (spot: SleepSpotInfo) => void;
  onOpenCampfireModal: (campfire: CampfireInfo) => void;
  onToggleBackpack: () => void;
  onToggleFullMap: () => void;
  onCloseModals: () => void;
  onToggleDiagnostics?: () => void;
  onToggleDebugPanel?: () => void;
}

export interface WorldActions {
  startPlaying: (packingSelection: PackingSelection) => void;
  resumePlaying: () => void;
  restartWorld: (packingSelection?: PackingSelection) => void;
  cycleWeather: () => void;
  advanceTime: () => void;
  toggleFlashlight: () => void;
  toggleMute: () => boolean;
  setResolutionScale: (scale: number | null) => void;
  setQualityMode: (mode: QualityMode) => void;
  setUiModalOpen: (open: boolean) => void;
  setDiagnosticsOpen: (open: boolean) => void;
  getSoundscapeDiagnostics: () => DiagnosticsSnapshot | null;
  triggerSoundscapeEvent: (type: string, intensity?: number) => void;
  auditionSoundscapeSound: (soundId: string) => boolean;
  stopSoundscapeAudition: () => number;
  resetSoundscapeQuotas: () => void;
  setSoundscapeBusVolume: (busId: string, vol: number) => void;
  setSoundscapeBusMuted: (busId: string, muted: boolean) => void;
  setSoundscapeMusicEnabled: (enabled: boolean) => void;
  setSoundscapeMusicVolume: (vol: number) => void;
  pauseSoundscapeVoice: (instanceId: string) => boolean;
  resumeSoundscapeVoice: (instanceId: string) => boolean;
  stopSoundscapeVoice: (instanceId: string) => boolean;
  reloadSoundscapeConfigJson: (json: string) => {
    ok: boolean;
    issues: ValidationIssue[];
    diffSummary?: string;
  };
  getSoundscapeConfigJson: () => string;
  eatItem: (itemId: ItemId) => void;
  drinkBottle: (uid: string) => void;
  loadBattery: () => void;
  dropItem: (itemId: ItemId) => void;
  dropBottleByUid: (uid: string) => void;
  dropBallast: () => void;
  igniteCampfire: (campfireId: string) => CampfireInfo | null;
  bankCampfire: (campfireId: string) => CampfireInfo | null;
  throwFirewoodIntoCampfire: (campfireId: string) => CampfireInfo | null;
  placeCampfireFromWood: () => CampfireInfo | null;
  pitchTent: () => TentInfo | null;
  sitInTent: (tentId?: string) => boolean;
  standUpFromTent: () => void;
  openSleepForSeatedTent: () => void;
  toggleWearItem: (itemId: ItemId) => void;
  sleepInSleepingBag: () => void;
  cookAtCampfire: (recipe: 'seared_steak' | 'roasted_mushrooms') => void;
  boilBottle: (uid: string) => void;
  startSleep: (spot: SleepSpotInfo, hours: number) => void;
  wakeEarly: () => void;
  renderFullMap: (canvas: HTMLCanvasElement, zoom: number, panX: number, panZ: number) => void;
  setDebugPanelOpen: (open: boolean) => void;
  getDebugSnapshot: () => DebugSnapshot;
  getDebugActions: () => DebugActions;
}
