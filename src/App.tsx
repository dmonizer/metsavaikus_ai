import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  addMushroomToBasket,
  clampResolutionScale,
  createEmptyBasket,
  formatResolutionSummary,
  InteractionPromptData,
  MushroomBasket,
  MushroomSpecies,
} from './game/gameLogic';
import {
  getQualityProfile,
  parseQualityMode,
  QualityMode,
  QualityTier,
  QualityTierName,
} from './game/qualityGovernor';
import {
  computeInventoryWeightKg,
  createDefaultPackingSelection,
  ItemId,
  PackingSelection,
} from './game/itemCatalog';
import type { CampfireInfo, SleepSpotInfo } from './world/architectureAndProps';
import type {
  GamePhase,
  WorldActions,
  WorldCallbacks,
  WorldHudRefs,
  WorldSurvivalSnapshot,
} from './components/worldRuntimeContracts';
import { GameplayHud } from './components/GameplayHud';
import { LazyChunkBoundary, LazyOverlayLoadingFallback, makeLazyComponent } from './components/LazyChunkBoundary';
import { PauseModal } from './components/PauseModal';
import { SleepingOverlay } from './components/SleepingOverlay';
import { TitleScreen } from './components/TitleScreen';
import { WorldErrorOverlay } from './components/WorldErrorOverlay';
import type { DebugSnapshot } from './game/debugTypes';
import type { DiagnosticsSnapshot } from './soundscape/types';
import { t as translate } from './i18n/i18n';

const LazyMetsavaikusWorld = makeLazyComponent(() =>
  import('./components/MetsavaikusWorld').then((m) => ({ default: m.MetsavaikusWorld }))
);
const LazyPackingModal = makeLazyComponent(() =>
  import('./components/PackingModal').then((m) => ({ default: m.PackingModal }))
);
const LazyBackpackStatusDrawer = makeLazyComponent(() =>
  import('./components/BackpackStatusDrawer').then((m) => ({ default: m.BackpackStatusDrawer }))
);
const LazySleepModal = makeLazyComponent(() =>
  import('./components/SleepAndHearthModals').then((m) => ({ default: m.SleepModal }))
);
const LazyCampfireHearthModal = makeLazyComponent(() =>
  import('./components/SleepAndHearthModals').then((m) => ({ default: m.CampfireHearthModal }))
);
const LazyCollapseOverlay = makeLazyComponent(() =>
  import('./components/CollapseOverlay').then((m) => ({ default: m.CollapseOverlay }))
);
const LazyFullMapModal = makeLazyComponent(() =>
  import('./components/FullMapModal').then((m) => ({ default: m.FullMapModal }))
);
const LazySoundscapeDiagnosticsOverlay = makeLazyComponent(() =>
  import('./components/SoundscapeDiagnosticsOverlay').then((m) => ({
    default: m.SoundscapeDiagnosticsOverlay,
  }))
);
const LazyDebugConsoleOverlay = makeLazyComponent(() =>
  import('./components/DebugConsoleOverlay').then((m) => ({ default: m.DebugConsoleOverlay }))
);
const LazyDebugOverlayHud = makeLazyComponent(() =>
  import('./components/DebugOverlayHud').then((m) => ({ default: m.DebugOverlayHud }))
);

function getInitialPhase(): GamePhase {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') return 'playing';
  }
  return 'title';
}

function pickRandomWorldSeed(): number {
  return 1000 + Math.floor(Math.random() * 89000);
}

function getInitialSeed(): number {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('seed');
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed !== 0) return Math.floor(parsed);
    }
  }
  return pickRandomWorldSeed();
}

const RESOLUTION_STORAGE_KEY = 'metsavaikus_resolution_scale';
const QUALITY_STORAGE_KEY = 'metsavaikus_quality_mode';

function getInitialResolutionScale(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RESOLUTION_STORAGE_KEY);
    if (!raw || raw === 'auto') return null;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return clampResolutionScale(parsed);
  } catch {
    // Ignore storage access failures in restricted contexts
  }
  return null;
}

function getInitialQualityMode(): QualityMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const params = new URLSearchParams(window.location.search);
    const paramQuality = params.get('quality');
    if (paramQuality !== null) return parseQualityMode(paramQuality);
    const saved = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    return parseQualityMode(saved);
  } catch {
    // Ignore storage access failures in restricted contexts
  }
  return 'auto';
}

export default function App() {
  const [worldSeed, setWorldSeed] = useState<number>(getInitialSeed);
  const [phase, setPhase] = useState<GamePhase>(getInitialPhase);
  const [packingSelection, setPackingSelection] = useState<PackingSelection>(
    createDefaultPackingSelection
  );
  const [basket, setBasket] = useState<MushroomBasket>(createEmptyBasket);
  const [totalWorldMushrooms, setTotalWorldMushrooms] = useState<number>(250);
  const [prompt, setPrompt] = useState<InteractionPromptData | null>(null);
  const [carryLabel, setCarryLabel] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string>('');
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(false);
  const [worldKey, setWorldKey] = useState<number>(0);
  const [worldError, setWorldError] = useState<string | null>(null);
  const [resolutionScale, setResolutionScale] = useState<number | null>(getInitialResolutionScale);
  const [qualityMode, setQualityMode] = useState<QualityMode>(getInitialQualityMode);
  const [activeQuality, setActiveQuality] = useState<{
    mode: QualityMode;
    tier: QualityTier;
    tierName: QualityTierName;
    maxRenderDist: number;
  }>(() => {
    const initialMode = getInitialQualityMode();
    const initialTier: QualityTier = initialMode === 'auto' ? 2 : initialMode;
    const profile = getQualityProfile(initialTier);
    return {
      mode: initialMode,
      tier: initialTier,
      tierName: profile.name,
      maxRenderDist: profile.maxRenderDist,
    };
  });
  const [displayMetrics, setDisplayMetrics] = useState<{
    autoDpr: number;
    viewportW: number;
    viewportH: number;
  }>(() => ({
    autoDpr: 1,
    viewportW: typeof window !== 'undefined' ? window.innerWidth : 1440,
    viewportH: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));

  const [snapshot, setSnapshot] = useState<WorldSurvivalSnapshot | null>(null);
  const [backpackOpen, setBackpackOpen] = useState<boolean>(false);
  const [fullMapOpen, setFullMapOpen] = useState<boolean>(false);
  const [activeSleepSpot, setActiveSleepSpot] = useState<SleepSpotInfo | null>(null);
  const [activeCampfire, setActiveCampfire] = useState<CampfireInfo | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState<boolean>(false);
  const [diagSnapshot, setDiagSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [debugPanelOpen, setDebugPanelOpen] = useState<boolean>(false);
  const [debugOverlayActive, setDebugOverlayActive] = useState<boolean>(false);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const actionsRef = useRef<WorldActions | null>(null);

  const fpsEl = useRef<HTMLSpanElement | null>(null);
  const biomeEl = useRef<HTMLDivElement | null>(null);
  const timeWeatherEl = useRef<HTMLDivElement | null>(null);
  const flashEl = useRef<HTMLDivElement | null>(null);
  const minimapCanvasEl = useRef<HTMLCanvasElement | null>(null);
  const compassHeadingEl = useRef<HTMLDivElement | null>(null);
  const healthFillEl = useRef<HTMLDivElement | null>(null);
  const energyFillEl = useRef<HTMLDivElement | null>(null);
  const hydrationFillEl = useRef<HTMLDivElement | null>(null);
  const fullnessFillEl = useRef<HTMLDivElement | null>(null);
  const tirednessFillEl = useRef<HTMLDivElement | null>(null);
  const bodyTempEl = useRef<HTMLSpanElement | null>(null);
  const conditionsEl = useRef<HTMLDivElement | null>(null);
  const frostVignetteEl = useRef<HTMLDivElement | null>(null);
  const nauseaVignetteEl = useRef<HTMLDivElement | null>(null);
  const drowsyVignetteEl = useRef<HTMLDivElement | null>(null);

  const hudRefs = useMemo<WorldHudRefs>(
    () => ({
      fpsEl,
      biomeEl,
      timeWeatherEl,
      flashEl,
      minimapCanvasEl,
      compassHeadingEl,
      healthFillEl,
      energyFillEl,
      hydrationFillEl,
      fullnessFillEl,
      tirednessFillEl,
      bodyTempEl,
      conditionsEl,
      frostVignetteEl,
      nauseaVignetteEl,
      drowsyVignetteEl,
    }),
    []
  );

  const anyGameplayModalOpen =
    phase === 'playing' &&
    (backpackOpen || fullMapOpen || activeSleepSpot !== null || activeCampfire !== null);

  useEffect(() => {
    document.body.dataset.state = phase;
  }, [phase]);

  useEffect(() => {
    actionsRef.current?.setUiModalOpen(anyGameplayModalOpen);
  }, [anyGameplayModalOpen]);

  useEffect(() => {
    actionsRef.current?.setDiagnosticsOpen(diagnosticsOpen);
    if (!diagnosticsOpen) return;
    setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
    const timer = window.setInterval(() => {
      setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
    }, 250);
    return () => window.clearInterval(timer);
  }, [diagnosticsOpen]);

  useEffect(() => {
    actionsRef.current?.setDebugPanelOpen(debugPanelOpen);
    if ((!debugPanelOpen && !debugOverlayActive) || (phase !== 'playing' && phase !== 'paused')) {
      return;
    }
    const pullSnapshot = () => {
      const next = actionsRef.current?.getDebugSnapshot() ?? null;
      setDebugSnapshot(next);
      if (next) {
        setDebugOverlayActive(next.overlayEnabled);
      }
    };
    pullSnapshot();
    const timer = window.setInterval(pullSnapshot, 120);
    return () => window.clearInterval(timer);
  }, [debugPanelOpen, debugOverlayActive, phase]);

  useEffect(() => {
    if (phase !== 'playing') {
      setBackpackOpen(false);
      setFullMapOpen(false);
      setActiveSleepSpot(null);
      setActiveCampfire(null);
      if (phase !== 'paused') {
        setDiagnosticsOpen(false);
        setDebugPanelOpen(false);
        setDebugOverlayActive(false);
        setDebugSnapshot(null);
      }
    }
  }, [phase]);

  useEffect(() => {
    if (snapshot?.isSwimming && backpackOpen) {
      setBackpackOpen(false);
    }
  }, [snapshot?.isSwimming, backpackOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (anyGameplayModalOpen) {
          e.preventDefault();
          setBackpackOpen(false);
          setFullMapOpen(false);
          setActiveSleepSpot(null);
          setActiveCampfire(null);
        } else if (diagnosticsOpen) {
          e.preventDefault();
          setDiagnosticsOpen(false);
        } else if (debugPanelOpen) {
          e.preventDefault();
          setDebugPanelOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyGameplayModalOpen, diagnosticsOpen, debugPanelOpen]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastVisible(false);
    }, 3600);
  }, []);

  const callbacks = useMemo<WorldCallbacks>(
    () => ({
      onGatherMushroom: (species: MushroomSpecies) => {
        setBasket((prev) => addMushroomToBasket(prev, species));
      },
      onPromptChange: (next) => {
        setPrompt(next);
      },
      onCarryChange: (label) => {
        setCarryLabel(label);
      },
      onToast: showToast,
      onPhaseChange: (nextPhase) => {
        document.body.dataset.state = nextPhase;
        setPhase(nextPhase);
      },
      onWorldReady: ({ totalMushrooms }) => {
        setWorldError(null);
        setTotalWorldMushrooms(totalMushrooms);
      },
      onWorldError: (message) => {
        if (document.pointerLockElement) {
          document.exitPointerLock?.();
        }
        setBackpackOpen(false);
        setFullMapOpen(false);
        setActiveSleepSpot(null);
        setActiveCampfire(null);
        setWorldError(message);
      },
      onDisplayMetrics: (info) => {
        setDisplayMetrics(info);
      },
      onQualityChange: (info) => {
        setActiveQuality(info);
      },
      onSurvivalSnapshot: (nextSnap) => {
        setSnapshot(nextSnap);
      },
      onOpenSleepModal: (spot) => {
        setBackpackOpen(false);
        setFullMapOpen(false);
        setActiveCampfire(null);
        setActiveSleepSpot(spot);
      },
      onOpenCampfireModal: (campfire) => {
        setBackpackOpen(false);
        setFullMapOpen(false);
        setActiveSleepSpot(null);
        setActiveCampfire(campfire);
      },
      onToggleBackpack: () => {
        setFullMapOpen(false);
        setActiveSleepSpot(null);
        setActiveCampfire(null);
        setBackpackOpen((prev) => !prev);
      },
      onToggleFullMap: () => {
        if (document.pointerLockElement) {
          document.exitPointerLock?.();
        }
        setBackpackOpen(false);
        setActiveSleepSpot(null);
        setActiveCampfire(null);
        setFullMapOpen((prev) => !prev);
      },
      onCloseModals: () => {
        setBackpackOpen(false);
        setFullMapOpen(false);
        setActiveSleepSpot(null);
        setActiveCampfire(null);
      },
      onToggleDiagnostics: () => {
        setDiagnosticsOpen((prev) => !prev);
      },
      onToggleDebugPanel: () => {
        setDebugPanelOpen((prev) => !prev);
      },
    }),
    [showToast]
  );

  const handleResolutionSliderChange = useCallback((nextScale: number) => {
    const clamped = clampResolutionScale(nextScale);
    setResolutionScale(clamped);
    try {
      window.localStorage.setItem(RESOLUTION_STORAGE_KEY, clamped.toFixed(2));
    } catch {
      // Ignore storage write failures
    }
  }, []);

  const handleResolutionAutoReset = useCallback(() => {
    setResolutionScale(null);
    try {
      window.localStorage.removeItem(RESOLUTION_STORAGE_KEY);
    } catch {
      // Ignore storage write failures
    }
  }, []);

  const handleQualityModeChange = useCallback((rawValue: string) => {
    const nextMode = parseQualityMode(rawValue);
    setQualityMode(nextMode);
    actionsRef.current?.setQualityMode(nextMode);
    try {
      if (nextMode === 'auto') {
        window.localStorage.setItem(QUALITY_STORAGE_KEY, 'auto');
      } else {
        window.localStorage.setItem(QUALITY_STORAGE_KEY, String(nextMode));
      }
    } catch {
      // Ignore storage write failures
    }
  }, []);

  const handleOpenPacking = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    document.body.dataset.state = 'packing';
    setPhase('packing');
  }, []);

  const handleBeginFromPacking = useCallback(() => {
    setBasket(createEmptyBasket());
    setCarryLabel('');
    setPrompt(null);
    setBackpackOpen(false);
    setFullMapOpen(false);
    setActiveSleepSpot(null);
    setActiveCampfire(null);
    document.body.dataset.state = 'playing';
    setPhase('playing');
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    actionsRef.current?.startPlaying(packingSelection);
  }, [packingSelection]);

  const handleResumeClick = useCallback(() => {
    document.body.dataset.state = 'playing';
    setPhase('playing');
    actionsRef.current?.resumePlaying();
  }, []);

  const handleRespawnAtHomestead = useCallback(() => {
    setBasket(createEmptyBasket());
    setCarryLabel('');
    setPrompt(null);
    setBackpackOpen(false);
    setFullMapOpen(false);
    setActiveSleepSpot(null);
    setActiveCampfire(null);
    document.body.dataset.state = 'playing';
    setPhase('playing');
    actionsRef.current?.restartWorld(packingSelection);
  }, [packingSelection]);

  const handleRetryWorldInit = useCallback(() => {
    setWorldError(null);
    setBasket(createEmptyBasket());
    setCarryLabel('');
    setPrompt(null);
    setBackpackOpen(false);
    setFullMapOpen(false);
    setActiveSleepSpot(null);
    setActiveCampfire(null);
    setSnapshot(null);
    setWorldKey((k) => k + 1);
  }, []);

  const handleRestartClick = useCallback(() => {
    setWorldError(null);
    setBasket(createEmptyBasket());
    setCarryLabel('');
    setPrompt(null);
    setBackpackOpen(false);
    setFullMapOpen(false);
    setActiveSleepSpot(null);
    setActiveCampfire(null);
    setWorldKey((k) => k + 1);
    document.body.dataset.state = 'playing';
    setPhase('playing');
  }, []);

  const handleNewProceduralMap = useCallback(() => {
    const nextSeed = pickRandomWorldSeed();
    setWorldError(null);
    setWorldSeed(nextSeed);
    setBasket(createEmptyBasket());
    setCarryLabel('');
    setPrompt(null);
    setBackpackOpen(false);
    setFullMapOpen(false);
    setActiveSleepSpot(null);
    setActiveCampfire(null);
    setWorldKey((k) => k + 1);
    document.body.dataset.state = 'playing';
    setPhase('playing');
    showToast(translate('toast.newMap', { seed: nextSeed }));
  }, [showToast]);

  const handleReturnToTitle = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    setBackpackOpen(false);
    setFullMapOpen(false);
    setActiveSleepSpot(null);
    setActiveCampfire(null);
    document.body.dataset.state = 'title';
    setPhase('title');
  }, []);

  const handleToggleMute = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (actionsRef.current) {
      setMuted(actionsRef.current.toggleMute());
    }
  }, []);

  const handleToggleBackpackBtn = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.blur();
      if (snapshot?.isSwimming) {
        showToast(translate('toast.cannotUsePackSwimming'));
        return;
      }
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      setFullMapOpen(false);
      setActiveSleepSpot(null);
      setActiveCampfire(null);
      setBackpackOpen((prev) => !prev);
    },
    [snapshot?.isSwimming, showToast]
  );

  const handleToggleFullMapBtn = useCallback((e?: MouseEvent<HTMLElement>) => {
    if (e && e.currentTarget instanceof HTMLElement) {
      e.currentTarget.blur();
    }
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    setBackpackOpen(false);
    setActiveSleepSpot(null);
    setActiveCampfire(null);
    setFullMapOpen((prev) => !prev);
  }, []);

  const handleRenderFullMap = useCallback(
    (canvas: HTMLCanvasElement, zoom: number, panX: number, panZ: number) => {
      actionsRef.current?.renderFullMap(canvas, zoom, panX, panZ);
    },
    []
  );

  const handlePauseBtn = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    setBackpackOpen(false);
    setFullMapOpen(false);
    setActiveSleepSpot(null);
    setActiveCampfire(null);
    document.body.dataset.state = 'paused';
    setPhase('paused');
  }, []);

  const handleConfirmSleep = useCallback(
    (hours: number) => {
      if (!activeSleepSpot) return;
      const spot = activeSleepSpot;
      setActiveSleepSpot(null);
      actionsRef.current?.startSleep(spot, hours);
    },
    [activeSleepSpot]
  );

  const handleSitInTent = useCallback((spot: SleepSpotInfo) => {
    setActiveSleepSpot(null);
    actionsRef.current?.sitInTent(spot.tentId);
  }, []);

  const handleIgniteActiveCampfire = useCallback(() => {
    if (!activeCampfire) return;
    const updated = actionsRef.current?.igniteCampfire(activeCampfire.id);
    if (updated) {
      setActiveCampfire(updated);
    }
  }, [activeCampfire]);

  const handleBankActiveCampfire = useCallback(() => {
    if (!activeCampfire) return;
    const updated = actionsRef.current?.bankCampfire(activeCampfire.id);
    if (updated) {
      setActiveCampfire(updated);
    }
  }, [activeCampfire]);

  const handleThrowLogActiveCampfire = useCallback(() => {
    if (!activeCampfire) return;
    const updated = actionsRef.current?.throwFirewoodIntoCampfire(activeCampfire.id);
    if (updated) {
      setActiveCampfire(updated);
    }
  }, [activeCampfire]);

  const handleOpenCampfireRest = useCallback(() => {
    if (!activeCampfire) return;
    const fire = activeCampfire;
    setActiveCampfire(null);
    setActiveSleepSpot({
      kind: 'campfire',
      label: fire.label,
      x: fire.x,
      y: fire.y,
      z: fire.z,
      shelter: 'outdoor',
      campfireId: fire.id,
    });
  }, [activeCampfire]);

  const handleOpenSleepForSeatedTent = useCallback(() => {
    actionsRef.current?.openSleepForSeatedTent();
  }, []);

  const handleStandUpFromTent = useCallback(() => {
    actionsRef.current?.standUpFromTent();
  }, []);

  const handleWakeEarly = useCallback(() => {
    actionsRef.current?.wakeEarly();
  }, []);

  const edibleCount = basket.edible;
  const boleteEdibleCount = basket.bySpecies.kivipuravik + basket.bySpecies.kasepuravik;
  const effectiveResolutionScale =
    resolutionScale !== null ? resolutionScale : clampResolutionScale(displayMetrics.autoDpr);
  const displayResolutionScale =
    resolutionScale !== null ? resolutionScale : displayMetrics.autoDpr;
  const resolutionSummary = formatResolutionSummary(
    displayMetrics.viewportW,
    displayMetrics.viewportH,
    displayResolutionScale,
    resolutionScale === null
  );
  const packWeightKg = snapshot ? computeInventoryWeightKg(snapshot.inventory) : 0;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0b100d] text-[#eef3ec]">
      {/* Isolated WebGL Canvas Viewport */}
      <LazyChunkBoundary
        fallback={<div data-testid="world-loading-fallback" className="fixed inset-0 bg-[#0b100d]" />}
        onRetry={() => {
          LazyMetsavaikusWorld.reset();
          handleRetryWorldInit();
        }}
      >
        <LazyMetsavaikusWorld.Component
          key={`${worldKey}-${worldSeed}`}
          worldSeed={worldSeed}
          phase={phase}
          resolutionScale={resolutionScale}
          qualityMode={qualityMode}
          initialPacking={packingSelection}
          hudRefs={hudRefs}
          callbacks={callbacks}
          actionsRef={actionsRef}
          basket={basket}
        />
      </LazyChunkBoundary>

      {/* Physiology Edge Vignettes (pure compositor opacity, zero blur) */}
      <div
        ref={frostVignetteEl}
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-10 opacity-0 transition-opacity duration-200"
        style={{
          background:
            'radial-gradient(circle at center, rgba(160,210,245,0) 48%, rgba(125,188,232,0.52) 100%)',
        }}
      />
      <div
        ref={nauseaVignetteEl}
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-10 opacity-0 transition-opacity duration-200"
        style={{
          background:
            'radial-gradient(circle at center, rgba(95,120,55,0) 52%, rgba(92,118,46,0.55) 100%)',
        }}
      />
      <div
        ref={drowsyVignetteEl}
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-10 opacity-0 transition-opacity duration-200"
        style={{
          background:
            'radial-gradient(circle at center, rgba(6,10,8,0) 42%, rgba(4,7,5,0.78) 100%)',
        }}
      />

      {/* Lightning Flash Overlay */}
      <div
        ref={flashEl}
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-20 bg-white opacity-0"
      />

      {/* Active Gameplay HUD */}
      {phase === 'playing' && (
        <GameplayHud
          hudRefs={hudRefs}
          anyGameplayModalOpen={anyGameplayModalOpen}
          prompt={prompt}
          basket={basket}
          totalWorldMushrooms={totalWorldMushrooms}
          edibleCount={edibleCount}
          boleteEdibleCount={boleteEdibleCount}
          snapshot={snapshot}
          packWeightKg={packWeightKg}
          fullMapOpen={fullMapOpen}
          backpackOpen={backpackOpen}
          muted={muted}
          carryLabel={carryLabel}
          toastVisible={toastVisible}
          toastMsg={toastMsg}
          onToggleFullMap={handleToggleFullMapBtn}
          onToggleBackpack={handleToggleBackpackBtn}
          onToggleMute={handleToggleMute}
          onPause={handlePauseBtn}
          onOpenSleepForSeatedTent={handleOpenSleepForSeatedTent}
          onStandUpFromTent={handleStandUpFromTent}
        />
      )}

      {/* Expandable Backpack & Physiology Status Drawer */}
      {phase === 'playing' && backpackOpen && snapshot && (
        <LazyChunkBoundary
          fallback={<LazyOverlayLoadingFallback />}
          onRetry={() => LazyBackpackStatusDrawer.reset()}
          onClose={() => setBackpackOpen(false)}
        >
          <LazyBackpackStatusDrawer.Component
            survival={snapshot.survival}
            inventory={snapshot.inventory}
            discoveredPercent={snapshot.discoveredPercent}
            shelterLabel={snapshot.shelterLabel}
            nearLitFire={snapshot.nearLitCampfireFactor > 0.2}
            onClose={() => setBackpackOpen(false)}
            onDrinkBottle={(uid) => actionsRef.current?.drinkBottle(uid)}
            onEatItem={(itemId: ItemId) => actionsRef.current?.eatItem(itemId)}
            onLoadBattery={() => actionsRef.current?.loadBattery()}
            onPlaceCampfire={() => {
              setBackpackOpen(false);
              actionsRef.current?.placeCampfireFromWood();
            }}
            onPitchTent={() => {
              setBackpackOpen(false);
              actionsRef.current?.pitchTent();
            }}
            onSleepInBag={() => {
              setBackpackOpen(false);
              actionsRef.current?.sleepInSleepingBag();
            }}
            onToggleWearItem={(itemId: ItemId) => actionsRef.current?.toggleWearItem(itemId)}
            onOpenFullMap={() => {
              setBackpackOpen(false);
              setFullMapOpen(true);
            }}
            onDropItem={(itemId: ItemId) => actionsRef.current?.dropItem(itemId)}
            onDropBottle={(uid) => actionsRef.current?.dropBottleByUid(uid)}
            onDropBallast={() => actionsRef.current?.dropBallast()}
          />
        </LazyChunkBoundary>
      )}

      {/* Full Countryside Fog-of-War Map Modal */}
      {phase === 'playing' && fullMapOpen && snapshot && (
        <LazyChunkBoundary
          fallback={<LazyOverlayLoadingFallback />}
          onRetry={() => LazyFullMapModal.reset()}
          onClose={() => setFullMapOpen(false)}
        >
          <LazyFullMapModal.Component
            worldSeed={worldSeed}
            navigationMode={snapshot.navigationMode}
            discoveredPercent={snapshot.discoveredPercent}
            playerX={snapshot.playerX}
            playerZ={snapshot.playerZ}
            playerYaw={snapshot.playerYaw}
            fogVersion={snapshot.fogVersion}
            onRenderMap={handleRenderFullMap}
            onClose={() => setFullMapOpen(false)}
          />
        </LazyChunkBoundary>
      )}

      {/* Sleep Duration Picker Modal */}
      {phase === 'playing' && activeSleepSpot && snapshot && (
        <LazyChunkBoundary
          fallback={<LazyOverlayLoadingFallback />}
          onRetry={() => LazySleepModal.reset()}
          onClose={() => setActiveSleepSpot(null)}
        >
          <LazySleepModal.Component
            spot={activeSleepSpot}
            survival={snapshot.survival}
            inventory={snapshot.inventory}
            hourOfDay={snapshot.hourOfDay}
            weather={snapshot.weather}
            windStrength={snapshot.windStrength}
            nearLitCampfireFactor={
              activeSleepSpot.kind === 'campfire'
                ? Math.max(snapshot.nearLitCampfireFactor, 0.85)
                : snapshot.nearLitCampfireFactor
            }
            onConfirmSleep={handleConfirmSleep}
            onSitInTent={handleSitInTent}
            onClose={() => setActiveSleepSpot(null)}
          />
        </LazyChunkBoundary>
      )}

      {/* Campfire Hearth Modal */}
      {phase === 'playing' && activeCampfire && snapshot && (
        <LazyChunkBoundary
          fallback={<LazyOverlayLoadingFallback />}
          onRetry={() => LazyCampfireHearthModal.reset()}
          onClose={() => setActiveCampfire(null)}
        >
          <LazyCampfireHearthModal.Component
            campfire={activeCampfire}
            inventory={snapshot.inventory}
            onIgnite={handleIgniteActiveCampfire}
            onBank={handleBankActiveCampfire}
            onThrowLog={handleThrowLogActiveCampfire}
            onCook={(recipe) => actionsRef.current?.cookAtCampfire(recipe)}
            onBoilBottle={(uid) => actionsRef.current?.boilBottle(uid)}
            onOpenRest={handleOpenCampfireRest}
            onClose={() => setActiveCampfire(null)}
          />
        </LazyChunkBoundary>
      )}

      {/* Sleeping Time-Lapse Overlay (camera pans over bed/campfire while time fast-forwards) */}
      {phase === 'sleeping' && snapshot?.sleepProgress && (
        <SleepingOverlay
          sleepProgress={snapshot.sleepProgress}
          hourOfDay={snapshot.hourOfDay}
          survival={snapshot.survival}
          onWakeEarly={handleWakeEarly}
        />
      )}

      {/* Slow Eyelids-Closing & Collapse Summary */}
      {(phase === 'collapsing' || phase === 'collapsed') && snapshot && (
        <LazyChunkBoundary
          fallback={null}
          onRetry={() => LazyCollapseOverlay.reset()}
        >
          <LazyCollapseOverlay.Component
            phase={phase}
            collapseProgress={snapshot.collapseProgress}
            survival={snapshot.survival}
            basket={basket}
            worldSeed={worldSeed}
            onRespawn={handleRespawnAtHomestead}
            onNewMap={handleNewProceduralMap}
            onTitle={handleReturnToTitle}
          />
        </LazyChunkBoundary>
      )}

      {/* Pre-Departure Editable Packing List */}
      {phase === 'packing' && (
        <LazyChunkBoundary
          fallback={<LazyOverlayLoadingFallback />}
          onRetry={() => LazyPackingModal.reset()}
          onClose={handleReturnToTitle}
        >
          <LazyPackingModal.Component
            selection={packingSelection}
            onChange={setPackingSelection}
            onBack={handleReturnToTitle}
            onBegin={handleBeginFromPacking}
          />
        </LazyChunkBoundary>
      )}

      {/* Title Screen Overlay */}
      {phase === 'title' && (
        <TitleScreen
          worldSeed={worldSeed}
          fpsEl={fpsEl}
          resolutionSummary={resolutionSummary}
          effectiveResolutionScale={effectiveResolutionScale}
          isManualScale={resolutionScale !== null}
          qualityMode={qualityMode}
          activeTierName={activeQuality.tierName}
          onResolutionSliderChange={handleResolutionSliderChange}
          onResolutionAutoReset={handleResolutionAutoReset}
          onQualityModeChange={handleQualityModeChange}
          onStartPacking={handleOpenPacking}
        />
      )}

      {/* Pause Modal */}
      {phase === 'paused' && (
        <PauseModal
          worldSeed={worldSeed}
          edibleCount={edibleCount}
          basketTotal={basket.total}
          totalWorldMushrooms={totalWorldMushrooms}
          resolutionSummary={resolutionSummary}
          effectiveResolutionScale={effectiveResolutionScale}
          isManualScale={resolutionScale !== null}
          qualityMode={qualityMode}
          activeTierName={activeQuality.tierName}
          onResolutionSliderChange={handleResolutionSliderChange}
          onResolutionAutoReset={handleResolutionAutoReset}
          onQualityModeChange={handleQualityModeChange}
          onResume={handleResumeClick}
          onNewMap={handleNewProceduralMap}
          onRestart={handleRestartClick}
          onReturnToTitle={handleReturnToTitle}
        />
      )}

      {/* Non-blocking Soundscape Diagnostics Overlay (F9) */}
      {(phase === 'playing' || phase === 'paused') && diagnosticsOpen && (
        <LazyChunkBoundary
          fallback={<LazyOverlayLoadingFallback />}
          onRetry={() => LazySoundscapeDiagnosticsOverlay.reset()}
          onClose={() => setDiagnosticsOpen(false)}
        >
          <LazySoundscapeDiagnosticsOverlay.Component
            open={diagnosticsOpen}
            snapshot={diagSnapshot}
            onClose={() => setDiagnosticsOpen(false)}
            onTriggerEvent={(type, intensity) => {
              actionsRef.current?.triggerSoundscapeEvent(type, intensity);
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
            }}
            onAuditionSound={(soundId) => {
              const ok = actionsRef.current?.auditionSoundscapeSound(soundId) ?? false;
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
              return ok;
            }}
            onStopAudition={() => {
              const count = actionsRef.current?.stopSoundscapeAudition() ?? 0;
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
              return count;
            }}
            onClearQuotas={() => {
              actionsRef.current?.resetSoundscapeQuotas();
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
            }}
            onPauseVoice={(instanceId) => {
              const ok = actionsRef.current?.pauseSoundscapeVoice(instanceId) ?? false;
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
              return ok;
            }}
            onResumeVoice={(instanceId) => {
              const ok = actionsRef.current?.resumeSoundscapeVoice(instanceId) ?? false;
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
              return ok;
            }}
            onStopVoice={(instanceId) => {
              const ok = actionsRef.current?.stopSoundscapeVoice(instanceId) ?? false;
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
              return ok;
            }}
            onSetBusVolume={(busId, vol) => {
              actionsRef.current?.setSoundscapeBusVolume(busId, vol);
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
            }}
            onSetBusMuted={(busId, muted) => {
              actionsRef.current?.setSoundscapeBusMuted(busId, muted);
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
            }}
            onSetMusicEnabled={(enabled) => {
              actionsRef.current?.setSoundscapeMusicEnabled(enabled);
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
            }}
            onSetMusicVolume={(vol) => {
              actionsRef.current?.setSoundscapeMusicVolume(vol);
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
            }}
            onGetConfigJson={() => actionsRef.current?.getSoundscapeConfigJson() ?? '{}'}
            onReloadConfigJson={(json) => {
              const res = actionsRef.current?.reloadSoundscapeConfigJson(json) ?? {
                ok: false,
                issues: [
                  {
                    file: 'config.json',
                    definition: 'engine',
                    property: 'runtime',
                    message: 'Engine not initialized',
                    severity: 'error' as const,
                  },
                ],
              };
              setDiagSnapshot(actionsRef.current?.getSoundscapeDiagnostics() ?? null);
              return res;
            }}
          />
        </LazyChunkBoundary>
      )}

      {/* F8 Fixed-Corner Debug Inspector HUD & Console Overlay */}
      {(phase === 'playing' || phase === 'paused') &&
        (debugOverlayActive || Boolean(debugSnapshot?.overlayEnabled)) && (
          <LazyChunkBoundary fallback={null} onRetry={() => LazyDebugOverlayHud.reset()}>
            <LazyDebugOverlayHud.Component
              open={debugSnapshot?.overlayEnabled ?? false}
              consoleOpen={debugPanelOpen}
              snapshot={debugSnapshot}
            />
          </LazyChunkBoundary>
        )}
      {(phase === 'playing' || phase === 'paused') && debugPanelOpen && (
        <LazyChunkBoundary
          fallback={<LazyOverlayLoadingFallback />}
          onRetry={() => LazyDebugConsoleOverlay.reset()}
          onClose={() => setDebugPanelOpen(false)}
        >
          <LazyDebugConsoleOverlay.Component
            open={debugPanelOpen}
            snapshot={debugSnapshot}
            actions={actionsRef.current?.getDebugActions() ?? null}
            onClose={() => setDebugPanelOpen(false)}
          />
        </LazyChunkBoundary>
      )}

      {/* Recoverable World Initialization Error Overlay */}
      {worldError !== null && (
        <WorldErrorOverlay
          message={worldError}
          onRetry={handleRetryWorldInit}
          onNewMap={handleNewProceduralMap}
        />
      )}
    </div>
  );
}
