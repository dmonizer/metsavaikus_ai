import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX, Pause, Backpack, Moon, Map as MapIcon, Tent } from 'lucide-react';
import {
  addMushroomToBasket,
  clampResolutionScale,
  createEmptyBasket,
  formatResolutionSummary,
  InteractionPromptData,
  MushroomBasket,
  MushroomSpecies,
  RESOLUTION_SCALE_MAX,
  RESOLUTION_SCALE_MIN,
  RESOLUTION_SCALE_STEP,
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
import { formatGameHour } from './game/survivalEngine';
import { CampfireInfo, SleepSpotInfo } from './world/architectureAndProps';
import {
  GamePhase,
  MetsavaikusWorld,
  WorldActions,
  WorldCallbacks,
  WorldHudRefs,
  WorldSurvivalSnapshot,
} from './components/MetsavaikusWorld';
import { PackingModal } from './components/PackingModal';
import { BackpackStatusDrawer } from './components/BackpackStatusDrawer';
import { CampfireHearthModal, SleepModal } from './components/SleepAndHearthModals';
import { CollapseOverlay } from './components/CollapseOverlay';
import { FullMapModal } from './components/FullMapModal';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { SoundscapeDiagnosticsOverlay } from './components/SoundscapeDiagnosticsOverlay';
import { SOUNDSCAPE_SOUNDS } from './config/soundscape/sounds';
import type { DiagnosticsSnapshot } from './soundscape/types';
import { t as translate, TranslationKey, useLanguage } from './i18n/i18n';

function getInitialPhase(): GamePhase {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') return 'playing';
  }
  return 'title';
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
  return 2026;
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
  const { t } = useLanguage();
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

  const availableSoundIds = useMemo(() => SOUNDSCAPE_SOUNDS.map((s) => s.id), []);

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
    if (phase !== 'playing') {
      setBackpackOpen(false);
      setFullMapOpen(false);
      setActiveSleepSpot(null);
      setActiveCampfire(null);
      if (phase !== 'paused') {
        setDiagnosticsOpen(false);
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
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyGameplayModalOpen, diagnosticsOpen]);

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
        setTotalWorldMushrooms(totalMushrooms);
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

  const handleRestartClick = useCallback(() => {
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
    const nextSeed = 1000 + Math.floor(Math.random() * 89000);
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

  const handleToggleMute = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (actionsRef.current) {
      setMuted(actionsRef.current.toggleMute());
    }
  }, []);

  const handleToggleBackpackBtn = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
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

  const handleToggleFullMapBtn = useCallback((e?: React.MouseEvent<HTMLElement>) => {
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

  const handlePauseBtn = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
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

  const navMode = snapshot?.navigationMode ?? 'both';
  const showNavCanvas = navMode !== 'none';
  const showCompassHeading = navMode === 'compass' || navMode === 'both';
  const packWeightKg = snapshot ? computeInventoryWeightKg(snapshot.inventory) : 0;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0b100d] text-[#eef3ec]">
      {/* Isolated WebGL Canvas Viewport */}
      <MetsavaikusWorld
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
        <div
          data-testid="gameplay-hud"
          className="fixed inset-0 pointer-events-none z-10"
        >
          {/* Center Crosshair */}
          {!anyGameplayModalOpen && (
            <div
              aria-hidden="true"
              className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-150 ${
                prompt
                  ? 'w-2.5 h-2.5 bg-[#ffdca8] scale-125 shadow-[0_0_8px_rgba(255,220,168,0.75)]'
                  : 'w-1.5 h-1.5 bg-white/75 shadow-[0_0_4px_rgba(0,0,0,0.8)]'
              }`}
            />
          )}

          {/* Top-Left: Biome, Time/Weather & Discreet FPS */}
          <div className="absolute top-4 left-5 bg-[#0c120e]/82 border border-white/10 rounded-md px-3.5 py-2.5 max-w-xs">
            <div
              ref={biomeEl}
              className="text-sm font-semibold text-[#e3ede0] leading-snug min-h-[1.25rem]"
            />
            <div className="mt-0.5 flex items-center gap-2 text-xs text-[#a5b9a4]">
              <span ref={timeWeatherEl} className="min-w-[4.5rem]" />
              <span aria-hidden="true" className="text-white/25">
                ·
              </span>
              <span
                ref={fpsEl}
                data-testid="fps-display"
                aria-label="Frame rate"
                className="font-mono tabular-nums text-[11px] text-[#c8d8c6]"
              >
                60 FPS
              </span>
            </div>
          </div>

          {/* Top-Right: Mushroom Basket Counter & Utility Controls */}
          <div className="absolute top-4 right-5 flex items-start gap-2.5">
            <div
              data-testid="mushroom-basket"
              className="bg-[#0c120e]/82 border border-white/10 rounded-md px-3.5 py-2 text-right"
            >
              <div className="flex items-center justify-end gap-2">
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4 shrink-0"
                  aria-hidden="true"
                >
                  <path
                    d="M12 3C7.2 3 3.5 6.4 4.2 9.4C4.6 11.1 7.6 11.4 9.5 11.6L10.3 20.5H13.7L14.5 11.6C16.4 11.4 19.4 11.1 19.8 9.4C20.5 6.4 16.8 3 12 3Z"
                    fill="#e6a129"
                    stroke="#21180b"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M9.8 11.6C10.8 12 13.2 12 14.2 11.6"
                    stroke="#f7dc9c"
                    strokeWidth="1.2"
                  />
                </svg>
                <span className="text-xs uppercase tracking-wider text-[#b6c7b5]">
                  {t('hud.basket')}
                </span>
                <span
                  data-testid="mushroom-count"
                  className="font-mono tabular-nums text-sm font-semibold text-[#f3d488]"
                >
                  {basket.total}
                  <span className="text-[#8a9b88] font-normal">
                    /{totalWorldMushrooms}
                  </span>
                </span>
              </div>
              {basket.total > 0 && (
                <div className="mt-0.5 text-[11px] text-[#9eb09c] tabular-nums">
                  {t('hud.basketEdibleSummary', {
                    edible: edibleCount,
                    kukeseen: basket.bySpecies.kukeseen,
                    bolete: boleteEdibleCount,
                    riisikas: basket.bySpecies.kuuseriisikas,
                  })}
                  {(basket.inedible > 0 || basket.poisonous > 0) && (
                    <div className="text-[#e78a78]">
                      {basket.inedible > 0
                        ? t('hud.basketInedible', { count: basket.inedible })
                        : ''}
                      {basket.inedible > 0 && basket.poisonous > 0 ? ' · ' : ''}
                      {basket.poisonous > 0
                        ? t('hud.basketPoisonous', { count: basket.poisonous })
                        : ''}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 pointer-events-auto">
              <LanguageSwitcher compact />
              <button
                type="button"
                tabIndex={-1}
                data-testid="open-full-map-btn"
                onClick={handleToggleFullMapBtn}
                aria-label={t('hud.openMapAria')}
                title={t('hud.mapTooltip')}
                className={`h-9 px-2.5 flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                  fullMapOpen
                    ? 'bg-[#2e4835] border-[#78a180] text-[#f3f8f1]'
                    : 'bg-[#0c120e]/82 border-white/10 text-[#cdd9cc] hover:bg-[#1a261e] hover:text-white'
                }`}
              >
                <MapIcon className="w-4 h-4" />
                <span className="font-mono tabular-nums text-[11px]">
                  {snapshot?.discoveredPercent ?? 0}%
                </span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-testid="open-backpack-btn"
                aria-disabled={snapshot?.isSwimming ? 'true' : undefined}
                onClick={handleToggleBackpackBtn}
                aria-label={t('hud.openBackpackAria')}
                title={
                  snapshot?.isSwimming
                    ? t('hud.backpackDisabledSwimming')
                    : t('hud.backpackTooltip', { kg: packWeightKg.toFixed(1) })
                }
                className={`h-9 px-2.5 flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors ${
                  snapshot?.isSwimming
                    ? 'bg-[#0c120e]/55 border-white/10 text-[#809182] opacity-65 cursor-not-allowed'
                    : backpackOpen
                      ? 'bg-[#2e4835] border-[#78a180] text-[#f3f8f1] cursor-pointer'
                      : 'bg-[#0c120e]/82 border-white/10 text-[#cdd9cc] hover:bg-[#1a261e] hover:text-white cursor-pointer'
                }`}
              >
                <Backpack className="w-4 h-4" />
                <span className="font-mono tabular-nums text-[11px]">
                  {packWeightKg.toFixed(1)}kg
                </span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={handleToggleMute}
                aria-label={muted ? t('hud.unmuteAria') : t('hud.muteAria')}
                className="w-9 h-9 flex items-center justify-center rounded-md bg-[#0c120e]/82 border border-white/10 text-[#cdd9cc] hover:bg-[#1a261e] hover:text-white transition-colors cursor-pointer"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={handlePauseBtn}
                aria-label={t('hud.pauseAria')}
                className="w-9 h-9 flex items-center justify-center rounded-md bg-[#0c120e]/82 border border-white/10 text-[#cdd9cc] hover:bg-[#1a261e] hover:text-white transition-colors cursor-pointer"
              >
                <Pause className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Center-Below Interaction Prompt */}
          {prompt && !anyGameplayModalOpen && (
            <div
              data-testid="interact-prompt"
              className="absolute top-[56%] left-1/2 -translate-x-1/2 bg-[#0a0f0c]/88 border border-white/15 rounded-md px-4 py-2 text-center max-w-md"
            >
              <div className="text-sm font-semibold text-[#f3e4c3]">
                {prompt.title}
              </div>
              <div className="mt-0.5 text-xs text-[#c4d1c2]">
                {prompt.actionsText}
              </div>
            </div>
          )}

          {/* Seated in Field Tent Bottom Action Bar */}
          {snapshot?.seatedInTent && !anyGameplayModalOpen && (
            <div
              data-testid="tent-seated-bar"
              className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#0c1410]/90 border border-[#6e997a]/45 rounded-lg px-4 py-2.5 shadow-[0_14px_34px_rgba(0,0,0,0.58)] flex flex-wrap items-center gap-3 max-w-[92vw]"
            >
              <div className="flex items-center gap-2.5">
                <Tent className="w-4 h-4 text-[#99c79c] shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-[#ebf3e9]">
                    {snapshot.weather === 'rain' || snapshot.weather === 'storm'
                      ? t('tentSeated.statusRain')
                      : t('tentSeated.statusDry')}
                  </div>
                  <div className="text-[10.5px] text-[#98ae97]">{t('tentSeated.hint')}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="seated-sleep-btn"
                  onClick={() => actionsRef.current?.openSleepForSeatedTent()}
                  className="px-3 py-1.5 text-xs font-semibold rounded bg-[#2d4a34] hover:bg-[#3a6043] text-[#eef5ec] border border-[#729e7a]/55 flex items-center gap-1.5 cursor-pointer"
                >
                  <Moon className="w-3.5 h-3.5" />
                  {t('tentSeated.sleepBtn')}
                </button>
                <button
                  type="button"
                  data-testid="seated-stand-btn"
                  onClick={() => actionsRef.current?.standUpFromTent()}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-[#18241d] hover:bg-[#23342a] text-[#dce8da] border border-white/14 cursor-pointer"
                >
                  {t('tentSeated.standUpBtn')}
                </button>
              </div>
            </div>
          )}

          {/* Toast Feedback */}
          {toastVisible && (
            <div
              data-testid="game-toast"
              className={`absolute ${
                snapshot?.seatedInTent && !anyGameplayModalOpen ? 'bottom-24' : 'bottom-20'
              } left-1/2 -translate-x-1/2 bg-[#0c120e]/92 border border-white/15 rounded-md px-4 py-2.5 text-sm text-[#eef2eb] max-w-lg text-center`}
            >
              {toastMsg}
            </div>
          )}

          {/* Bottom-Left: Diegetic Navigation + Minimal 5-Bar Survival Vitals */}
          <div className="absolute bottom-5 left-5 flex flex-col items-start gap-2">
            {carryLabel && (
              <div className="text-xs font-medium text-[#f0dfb4] bg-[#0c120e]/84 border border-white/10 rounded px-2.5 py-1 drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]">
                {carryLabel}
              </div>
            )}

            {/* Diegetic Navigation Widget (none | compass | map | both) */}
            {showNavCanvas && (
              <div className="flex flex-col items-center gap-1">
                <div
                  data-testid="minimap-compass"
                  data-nav-mode={navMode}
                  role={navMode === 'map' || navMode === 'both' ? 'button' : undefined}
                  tabIndex={navMode === 'map' || navMode === 'both' ? -1 : undefined}
                  onClick={
                    navMode === 'map' || navMode === 'both' ? handleToggleFullMapBtn : undefined
                  }
                  title={
                    navMode === 'map' || navMode === 'both'
                      ? t('hud.minimapClickHint')
                      : undefined
                  }
                  aria-label={
                    navMode === 'compass'
                      ? t('hud.navAria.compass')
                      : navMode === 'map'
                        ? t('hud.navAria.map')
                        : t('hud.navAria.both')
                  }
                  className={`relative w-[148px] h-[148px] rounded-full bg-[#0c120e]/85 border shadow-[0_6px_22px_rgba(0,0,0,0.55)] flex items-center justify-center transition-colors ${
                    navMode === 'map' || navMode === 'both'
                      ? 'pointer-events-auto cursor-pointer border-white/18 hover:border-[#a7cda9]/65'
                      : 'border-white/15'
                  }`}
                >
                  <canvas
                    ref={minimapCanvasEl}
                    data-testid="minimap-canvas"
                    width={148}
                    height={148}
                    className="w-[148px] h-[148px] rounded-full block"
                  />
                </div>
                {showCompassHeading ? (
                  <div
                    ref={compassHeadingEl}
                    data-testid="compass-heading"
                    className="px-2.5 py-0.5 rounded bg-[#0c120e]/90 border border-white/12 font-mono tabular-nums text-[10px] tracking-wider text-[#e5ede3] whitespace-nowrap"
                  >
                    N · 357°
                  </div>
                ) : (
                  <div
                    data-testid="map-mode-caption"
                    className="px-2 py-0.5 font-mono text-[10px] tracking-wider text-[#c9d4c4] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                  >
                    {t('hud.paperMapCaption')}
                  </div>
                )}
              </div>
            )}

            {/* Quiet 5-Bar Vitals Stack + Core Temp + Unboxed Inline Conditions */}
            <div
              data-testid="vitals-hud"
              className="w-[172px] rounded-md bg-[#0c120e]/82 border border-white/10 px-2.5 py-2 space-y-1.5"
            >
              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                <span className="uppercase tracking-wider text-[#9db19c]">
                  {t('hud.vitals')}
                </span>
                <span className="inline-flex items-center gap-1 text-[#dce9db]">
                  <svg
                    viewBox="0 0 16 16"
                    className="w-3 h-3 text-[#9ec4d6] shrink-0"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M8 2a1.75 1.75 0 0 0-1.75 1.75v5.3a3 3 0 1 0 3.5 0v-5.3A1.75 1.75 0 0 0 8 2Z"
                      stroke="currentColor"
                      strokeWidth="1.35"
                    />
                    <circle cx="8" cy="11.5" r="1.45" fill="currentColor" />
                    <path d="M8 6.5v4.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
                  </svg>
                  <span
                    ref={bodyTempEl}
                    data-testid="body-temp-readout"
                  >
                    37.0°C
                  </span>
                </span>
              </div>

              <div className="space-y-1.5">
                {/* Health — Heart */}
                <div
                  className="flex items-center gap-2"
                  title={t('hud.vital.health')}
                  aria-label={t('hud.vital.health')}
                  data-testid="vital-row-health"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="w-3.5 h-3.5 shrink-0 text-[#dc6f63]"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M8 14.1 2.2 8.7A3.65 3.65 0 0 1 7.35 3.5L8 4.2l.65-.7a3.65 3.65 0 0 1 5.15 5.2L8 14.1Z" />
                  </svg>
                  <div className="flex-1 h-1.5 bg-black/60 rounded-sm overflow-hidden">
                    <div
                      ref={healthFillEl}
                      data-testid="vital-health-bar"
                      className="w-full h-full origin-left bg-[#c95b50] transition-transform duration-100"
                    />
                  </div>
                </div>

                {/* Energy — Flexed Arm (💪) */}
                <div
                  className="flex items-center gap-2"
                  title={t('hud.vital.energy')}
                  aria-label={t('hud.vital.energy')}
                  data-testid="vital-row-energy"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="w-3.5 h-3.5 shrink-0 text-[#8ec991]"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M4.2 12.6c-.8-.3-1.4-1.1-1.4-2.1 0-1.6.9-3.9 2.2-5.6.5-.7 1.3-1.1 2.1-1 .8.1 1.4.7 1.4 1.4 0 .6-.4 1.1-1.1 1.2l-.7.1-.6 2.1c.7-.8 1.9-1.2 3.1-1.1 1.8.1 3.3 1.2 3.6 2.7.3 1.4-.6 2.6-2.2 2.9-2.2.4-4.7.2-6.4-.6Z"
                      fill="currentColor"
                    />
                    <path
                      d="M7.6 9.3c.7-.4 1.6-.4 2.3 0"
                      stroke="#0c120e"
                      strokeWidth="1.1"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="flex-1 h-1.5 bg-black/60 rounded-sm overflow-hidden">
                    <div
                      ref={energyFillEl}
                      data-testid="vital-energy-bar"
                      className="w-full h-full origin-left bg-[#7fb382] transition-transform duration-100"
                    />
                  </div>
                </div>

                {/* Water — Droplet */}
                <div
                  className="flex items-center gap-2"
                  title={t('hud.vital.water')}
                  aria-label={t('hud.vital.water')}
                  data-testid="vital-row-water"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="w-3.5 h-3.5 shrink-0 text-[#72b8da]"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M8 1.5C6.1 4.4 3.4 7.2 3.4 10a4.6 4.6 0 0 0 9.2 0c0-2.8-2.7-5.6-4.6-8.5Z" />
                    <path
                      d="M6.1 10.2a2.1 2.1 0 0 0 1.4 1.9"
                      stroke="#d7f1fc"
                      strokeWidth="1.1"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                  <div className="flex-1 h-1.5 bg-black/60 rounded-sm overflow-hidden">
                    <div
                      ref={hydrationFillEl}
                      data-testid="vital-hydration-bar"
                      className="w-full h-full origin-left bg-[#66a9c9] transition-transform duration-100"
                    />
                  </div>
                </div>

                {/* Food — Plate with Fork & Knife */}
                <div
                  className="flex items-center gap-2"
                  title={t('hud.vital.food')}
                  aria-label={t('hud.vital.food')}
                  data-testid="vital-row-food"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="w-3.5 h-3.5 shrink-0 text-[#e0b265]"
                    fill="none"
                    aria-hidden="true"
                  >
                    {/* Fork (left) */}
                    <path
                      d="M2.2 2.4v3.1M3.2 2.4v3.1M2.7 5.5v8.1"
                      stroke="currentColor"
                      strokeWidth="1.15"
                      strokeLinecap="round"
                    />
                    {/* Plate (center) */}
                    <circle cx="8" cy="8.2" r="3.2" stroke="currentColor" strokeWidth="1.25" />
                    <circle cx="8" cy="8.2" r="1.45" fill="currentColor" fillOpacity="0.45" />
                    {/* Knife (right) */}
                    <path
                      d="M13.5 2.4c.7 1.2.8 3.2 0 4.8v6.4"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div className="flex-1 h-1.5 bg-black/60 rounded-sm overflow-hidden">
                    <div
                      ref={fullnessFillEl}
                      data-testid="vital-fullness-bar"
                      className="w-full h-full origin-left bg-[#d4a55a] transition-transform duration-100"
                    />
                  </div>
                </div>

                {/* Fatigue — Zz Sleepiness */}
                <div
                  className="flex items-center gap-2"
                  title={t('hud.vital.fatigue')}
                  aria-label={t('hud.vital.fatigue')}
                  data-testid="vital-row-fatigue"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="w-3.5 h-3.5 shrink-0 text-[#ca8c75]"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.5 5.2h4.4l-4.4 5.2h4.6"
                      stroke="currentColor"
                      strokeWidth="1.45"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M9.6 8.2h3.8l-3.8 4.4h4"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div className="flex-1 h-1.5 bg-black/60 rounded-sm overflow-hidden">
                    <div
                      ref={tirednessFillEl}
                      data-testid="vital-tiredness-bar"
                      className="w-full h-full origin-left bg-[#b87c66] transition-transform duration-100"
                      style={{ transform: 'scaleX(0.04)' }}
                    />
                  </div>
                </div>
              </div>

              <div
                ref={conditionsEl}
                data-testid="hud-conditions"
                className="text-[10px] leading-tight text-[#e8be8c] empty:hidden pt-0.5"
              />
            </div>
          </div>

          {/* Bottom-Right: Quiet Control Reminder */}
          {!snapshot?.seatedInTent && (
            <div className="hidden md:block absolute bottom-5 right-5 text-[11px] text-[#9eb09d] drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              {t('hud.controlsHint')}
            </div>
          )}
        </div>
      )}

      {/* Expandable Backpack & Physiology Status Drawer */}
      {phase === 'playing' && backpackOpen && snapshot && (
        <BackpackStatusDrawer
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
        />
      )}

      {/* Full Countryside Fog-of-War Map Modal */}
      {phase === 'playing' && fullMapOpen && snapshot && (
        <FullMapModal
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
      )}

      {/* Sleep Duration Picker Modal */}
      {phase === 'playing' && activeSleepSpot && snapshot && (
        <SleepModal
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
      )}

      {/* Campfire Hearth Modal */}
      {phase === 'playing' && activeCampfire && snapshot && (
        <CampfireHearthModal
          campfire={activeCampfire}
          inventory={snapshot.inventory}
          onIgnite={handleIgniteActiveCampfire}
          onBank={handleBankActiveCampfire}
          onCook={(recipe) => actionsRef.current?.cookAtCampfire(recipe)}
          onBoilBottle={(uid) => actionsRef.current?.boilBottle(uid)}
          onOpenRest={handleOpenCampfireRest}
          onClose={() => setActiveCampfire(null)}
        />
      )}

      {/* Sleeping Time-Lapse Overlay (camera pans over bed/campfire while time fast-forwards) */}
      {phase === 'sleeping' && snapshot?.sleepProgress && (
        <div
          data-testid="sleeping-overlay"
          className="fixed inset-x-0 bottom-8 z-30 flex justify-center px-5 pointer-events-none"
        >
          <div className="pointer-events-auto w-full max-w-md rounded-lg bg-[#0b110d]/90 border border-white/14 px-5 py-4 shadow-[0_18px_45px_rgba(0,0,0,0.65)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-[#a7bca5]">
                  <Moon className="w-3.5 h-3.5 text-[#dfca8f]" />
                  {t('sleepOverlay.eyebrow')}
                </div>
                <div className="text-sm font-medium text-[#edf3ea] mt-0.5">
                  {snapshot.sleepProgress.spotLabel}
                </div>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div
                  data-testid="sleep-clock"
                  className="text-lg font-semibold text-[#f1e4c4]"
                >
                  {formatGameHour(snapshot.hourOfDay)}
                </div>
                <div className="text-[11px] text-[#9bb09a]">
                  {snapshot.sleepProgress.elapsedHours.toFixed(1)}h /{' '}
                  {snapshot.sleepProgress.totalHours}h
                </div>
              </div>
            </div>

            <div className="mt-3 w-full h-1.5 bg-black/60 rounded overflow-hidden">
              <div
                className="h-full origin-left bg-[#8fc092] transition-transform duration-100"
                style={{
                  transform: `scaleX(${Math.max(
                    0.02,
                    Math.min(
                      1,
                      snapshot.sleepProgress.elapsedHours /
                        Math.max(0.1, snapshot.sleepProgress.totalHours)
                    )
                  )})`,
                }}
              />
            </div>

            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="font-mono tabular-nums text-[#b9cab8]">
                {t('sleepOverlay.stats', {
                  energy: Math.round(snapshot.survival.energy),
                  temp: snapshot.survival.bodyTempC.toFixed(1),
                  food: Math.round(snapshot.survival.stomachFullness),
                })}
              </span>
              <button
                type="button"
                data-testid="wake-early-btn"
                onClick={() => actionsRef.current?.wakeEarly()}
                className="px-3 py-1 rounded bg-[#1c2a21] hover:bg-[#283b2e] border border-white/14 text-[#e7f0e5] cursor-pointer"
              >
                {t('sleepOverlay.wakeEarly')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slow Eyelids-Closing & Collapse Summary */}
      {(phase === 'collapsing' || phase === 'collapsed') && snapshot && (
        <CollapseOverlay
          phase={phase}
          collapseProgress={snapshot.collapseProgress}
          survival={snapshot.survival}
          basket={basket}
          worldSeed={worldSeed}
          onRespawn={handleRespawnAtHomestead}
          onNewMap={handleNewProceduralMap}
          onTitle={handleReturnToTitle}
        />
      )}

      {/* Pre-Departure Editable Packing List */}
      {phase === 'packing' && (
        <PackingModal
          selection={packingSelection}
          onChange={setPackingSelection}
          onBack={handleReturnToTitle}
          onBegin={handleBeginFromPacking}
        />
      )}

      {/* Title Screen Overlay */}
      {phase === 'title' && (
        <div
          data-testid="title-screen"
          className="fixed inset-0 z-30 flex flex-col justify-between p-8 md:p-12 bg-gradient-to-r from-[#070b09]/74 via-[#080d0a]/36 to-transparent"
        >
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs tracking-[0.22em] uppercase text-[#a8bba7]">
              {t('title.eyebrow', { seed: worldSeed })}
            </span>
            <div className="flex items-center gap-3">
              <LanguageSwitcher />
              <span
                ref={fpsEl}
                className="font-mono tabular-nums text-xs text-[#c8d8c6]"
              >
                60 FPS
              </span>
            </div>
          </div>

          <div className="max-w-xl my-auto">
            <svg
              viewBox="0 0 380 86"
              className="w-full max-w-[380px] h-auto mb-3"
              aria-label="Metsavaikus"
            >
              <g opacity="0.88" fill="#89aa84">
                <polygon points="18,44 26,18 34,44" />
                <polygon points="15,56 26,28 37,56" />
                <rect x="24.5" y="56" width="3" height="10" fill="#6f5e4b" />
                <polygon points="40,48 46,27 52,48" fill="#6f926c" />
                <rect x="44.8" y="48" width="2.4" height="14" fill="#6f5e4b" />
              </g>
              <text
                x="68"
                y="54"
                fill="#edf3e8"
                fontFamily="Georgia, Palatino, serif"
                fontSize="36"
                letterSpacing="6"
                fontWeight="400"
              >
                METSAVAIKUS
              </text>
              <line
                x1="68"
                y1="67"
                x2="368"
                y2="67"
                stroke="rgba(182, 206, 178, 0.35)"
                strokeWidth="1"
              />
            </svg>

            <p className="text-sm md:text-base text-[#bfd0bd] leading-relaxed mb-6 max-w-md">
              {t('title.tagline')}
            </p>

            {/* Render Resolution & Adaptive Detail Configuration */}
            <div className="mb-6 max-w-sm space-y-3 rounded-md bg-[#0c120e]/78 border border-white/12 px-4 py-3">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label
                    htmlFor="title-resolution-slider"
                    className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#a5b9a4]"
                  >
                    {t('title.renderResolution')}
                  </label>
                  <div className="flex items-center gap-2">
                    <span
                      data-testid="resolution-readout"
                      className="font-mono tabular-nums text-xs text-[#e5efe3]"
                    >
                      {resolutionSummary}
                    </span>
                    {resolutionScale !== null && (
                      <button
                        type="button"
                        onClick={handleResolutionAutoReset}
                        className="text-[11px] text-[#98c29b] hover:text-[#cce6ce] underline underline-offset-2 cursor-pointer"
                      >
                        {t('title.auto')}
                      </button>
                    )}
                  </div>
                </div>
                <input
                  id="title-resolution-slider"
                  data-testid="resolution-slider"
                  type="range"
                  min={RESOLUTION_SCALE_MIN}
                  max={RESOLUTION_SCALE_MAX}
                  step={RESOLUTION_SCALE_STEP}
                  value={effectiveResolutionScale}
                  onChange={(e) => handleResolutionSliderChange(parseFloat(e.target.value))}
                  aria-label={t('title.renderResolution')}
                  className="w-full h-1.5 rounded-lg appearance-none bg-[#233328] accent-[#7fb382] cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#98c29b]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b110d]"
                />
                <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono tabular-nums text-[#859984]">
                  <span>{t('title.resFast')}</span>
                  <span>{t('title.resNative')}</span>
                  <span>{t('title.resSharp')}</span>
                </div>
              </div>

              <div className="pt-2.5 border-t border-white/10">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="title-quality-select"
                    className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#a5b9a4]"
                  >
                    {t('title.quality')}
                  </label>
                  <span
                    data-testid="quality-readout"
                    className="font-mono tabular-nums text-[11px] text-[#e5efe3]"
                  >
                    {t(`quality.${activeQuality.tierName}` as TranslationKey)}
                  </span>
                </div>
                <select
                  id="title-quality-select"
                  data-testid="quality-select"
                  value={qualityMode === 'auto' ? 'auto' : String(qualityMode)}
                  onChange={(e) => handleQualityModeChange(e.target.value)}
                  className="w-full rounded bg-[#141f18] border border-white/14 px-2.5 py-1.5 text-xs text-[#e8f0e4] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#98c29b]/80 cursor-pointer"
                >
                  <option value="auto">{t('quality.auto')}</option>
                  <option value="0">{t('quality.minimal')}</option>
                  <option value="1">{t('quality.low')}</option>
                  <option value="2">{t('quality.balanced')}</option>
                  <option value="3">{t('quality.high')}</option>
                  <option value="4">{t('quality.ultra')}</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              data-start="true"
              onClick={handleOpenPacking}
              className="px-8 py-3.5 text-sm font-semibold tracking-wider uppercase rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#72997a] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c7dec2]"
            >
              {t('title.enterCountryside')}
            </button>
          </div>

          <div className="text-xs text-[#9cb09b] tracking-wide">
            {t('title.controls')}
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {phase === 'paused' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('pause.ariaLabel')}
          className="fixed inset-0 z-30 flex items-center justify-center bg-[#070b09]/78 p-6"
        >
          <div className="w-full max-w-sm bg-[#101813] border border-white/12 rounded-lg p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl text-[#e8f0e4] tracking-wide">
                  {t('pause.title')}
                </h2>
                <p className="mt-1 text-xs text-[#9eb29d] tabular-nums">
                  {t('pause.summary', {
                    seed: worldSeed,
                    edible: edibleCount,
                    total: basket.total,
                    max: totalWorldMushrooms,
                  })}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2 rounded-md bg-[#0b110d] border border-white/10 px-3.5 py-2">
              <span className="text-[11px] uppercase tracking-[0.12em] text-[#a5b9a4]">
                {t('lang.label')}
              </span>
              <LanguageSwitcher compact />
            </div>

            <div className="mt-3 rounded-md bg-[#0b110d] border border-white/10 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="pause-resolution-slider"
                  className="text-[11px] uppercase tracking-[0.12em] text-[#a5b9a4]"
                >
                  {t('pause.resolution')}
                </label>
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-[11px] text-[#e5efe3]">
                    {resolutionSummary}
                  </span>
                  {resolutionScale !== null && (
                    <button
                      type="button"
                      onClick={handleResolutionAutoReset}
                      className="text-[11px] text-[#98c29b] hover:text-[#cce6ce] underline underline-offset-2 cursor-pointer"
                    >
                      {t('title.auto')}
                    </button>
                  )}
                </div>
              </div>
              <input
                id="pause-resolution-slider"
                type="range"
                min={RESOLUTION_SCALE_MIN}
                max={RESOLUTION_SCALE_MAX}
                step={RESOLUTION_SCALE_STEP}
                value={effectiveResolutionScale}
                onChange={(e) => handleResolutionSliderChange(parseFloat(e.target.value))}
                aria-label={t('title.renderResolution')}
                className="w-full h-1.5 rounded-lg appearance-none bg-[#233328] accent-[#7fb382] cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#98c29b]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b110d]"
              />
            </div>

            <div className="mt-3 rounded-md bg-[#0b110d] border border-white/10 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="pause-quality-select"
                  className="text-[11px] uppercase tracking-[0.12em] text-[#a5b9a4]"
                >
                  {t('pause.quality')}
                </label>
                <span
                  data-testid="pause-quality-readout"
                  className="font-mono tabular-nums text-[11px] text-[#e5efe3]"
                >
                  {t(`quality.${activeQuality.tierName}` as TranslationKey)}
                </span>
              </div>
              <select
                id="pause-quality-select"
                data-testid="pause-quality-select"
                value={qualityMode === 'auto' ? 'auto' : String(qualityMode)}
                onChange={(e) => handleQualityModeChange(e.target.value)}
                className="w-full rounded bg-[#141f18] border border-white/14 px-2.5 py-1.5 text-xs text-[#e8f0e4] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#98c29b]/80 cursor-pointer"
              >
                <option value="auto">{t('quality.auto')}</option>
                <option value="0">{t('quality.minimal')}</option>
                <option value="1">{t('quality.low')}</option>
                <option value="2">{t('quality.balanced')}</option>
                <option value="3">{t('quality.high')}</option>
                <option value="4">{t('quality.ultra')}</option>
              </select>
            </div>

            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleResumeClick}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#6e9476] transition-colors cursor-pointer"
              >
                {t('pause.resume')}
              </button>
              <button
                type="button"
                onClick={handleNewProceduralMap}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#18231c] hover:bg-[#223127] text-[#dce7da] border border-white/12 transition-colors cursor-pointer"
              >
                {t('pause.newMap')}
              </button>
              <button
                type="button"
                onClick={handleRestartClick}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#18231c] hover:bg-[#223127] text-[#dce7da] border border-white/12 transition-colors cursor-pointer"
              >
                {t('pause.restartSameSeed')}
              </button>
              <button
                type="button"
                onClick={handleReturnToTitle}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-transparent hover:bg-white/5 text-[#a9baa8] border border-white/10 transition-colors cursor-pointer"
              >
                {t('pause.titleScreen')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Non-blocking Soundscape Diagnostics Overlay (F9) */}
      {(phase === 'playing' || phase === 'paused') && (
        <SoundscapeDiagnosticsOverlay
          open={diagnosticsOpen}
          snapshot={diagSnapshot}
          availableSoundIds={availableSoundIds}
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
      )}
    </div>
  );
}
