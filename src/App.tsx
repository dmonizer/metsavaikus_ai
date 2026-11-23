import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX, Pause } from 'lucide-react';
import {
  addMushroomToBasket,
  createEmptyBasket,
  InteractionPromptData,
  MushroomBasket,
  MushroomSpecies,
} from './game/gameLogic';
import {
  GamePhase,
  MetsavaikusWorld,
  WorldActions,
  WorldCallbacks,
  WorldHudRefs,
} from './components/MetsavaikusWorld';

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

export default function App() {
  const [worldSeed, setWorldSeed] = useState<number>(getInitialSeed);
  const [phase, setPhase] = useState<GamePhase>(getInitialPhase);
  const [basket, setBasket] = useState<MushroomBasket>(createEmptyBasket);
  const [totalWorldMushrooms, setTotalWorldMushrooms] = useState<number>(250);
  const [prompt, setPrompt] = useState<InteractionPromptData | null>(null);
  const [carryLabel, setCarryLabel] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string>('');
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(false);
  const [worldKey, setWorldKey] = useState<number>(0);

  const toastTimerRef = useRef<number | null>(null);
  const actionsRef = useRef<WorldActions | null>(null);

  const fpsEl = useRef<HTMLSpanElement | null>(null);
  const staminaFillEl = useRef<HTMLDivElement | null>(null);
  const biomeEl = useRef<HTMLDivElement | null>(null);
  const timeWeatherEl = useRef<HTMLDivElement | null>(null);
  const flashEl = useRef<HTMLDivElement | null>(null);
  const minimapCanvasEl = useRef<HTMLCanvasElement | null>(null);
  const compassHeadingEl = useRef<HTMLDivElement | null>(null);

  const hudRefs = useMemo<WorldHudRefs>(
    () => ({
      fpsEl,
      staminaFillEl,
      biomeEl,
      timeWeatherEl,
      flashEl,
      minimapCanvasEl,
      compassHeadingEl,
    }),
    []
  );

  useEffect(() => {
    document.body.dataset.state = phase;
  }, [phase]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastVisible(false);
    }, 3400);
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
    }),
    [showToast]
  );

  const handleStartClick = useCallback(() => {
    document.body.dataset.state = 'playing';
    setPhase('playing');
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    actionsRef.current?.startPlaying();
  }, []);

  const handleResumeClick = useCallback(() => {
    document.body.dataset.state = 'playing';
    setPhase('playing');
    actionsRef.current?.resumePlaying();
  }, []);

  const handleRestartClick = useCallback(() => {
    setBasket(createEmptyBasket());
    setCarryLabel('');
    setPrompt(null);
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
    setWorldKey((k) => k + 1);
    document.body.dataset.state = 'playing';
    setPhase('playing');
    showToast(`Generated procedural countryside #${nextSeed}`);
  }, [showToast]);

  const handleReturnToTitle = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    document.body.dataset.state = 'title';
    setPhase('title');
  }, []);

  const handleToggleMute = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (actionsRef.current) {
      setMuted(actionsRef.current.toggleMute());
    }
  }, []);

  const handlePauseBtn = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    document.body.dataset.state = 'paused';
    setPhase('paused');
  }, []);

  const edibleCount = basket.edible;
  const boleteEdibleCount = basket.bySpecies.kivipuravik + basket.bySpecies.kasepuravik;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0b100d] text-[#eef3ec]">
      {/* Isolated WebGL Canvas Viewport */}
      <MetsavaikusWorld
        key={`${worldKey}-${worldSeed}`}
        worldSeed={worldSeed}
        phase={phase}
        hudRefs={hudRefs}
        callbacks={callbacks}
        actionsRef={actionsRef}
        basket={basket}
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
          <div
            aria-hidden="true"
            className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-150 ${
              prompt
                ? 'w-2.5 h-2.5 bg-[#ffdca8] scale-125 shadow-[0_0_8px_rgba(255,220,168,0.75)]'
                : 'w-1.5 h-1.5 bg-white/75 shadow-[0_0_4px_rgba(0,0,0,0.8)]'
            }`}
          />

          {/* Top-Left: Biome, Time/Weather & Discreet FPS */}
          <div className="absolute top-4 left-5 bg-[#0c120e]/80 border border-white/10 rounded-md px-3.5 py-2.5 max-w-xs">
            <div
              ref={biomeEl}
              className="text-sm font-semibold text-[#e3ede0] leading-snug"
            >
              Kruusatee (Gravel Country Road)
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-[#a5b9a4]">
              <span ref={timeWeatherEl}>09:15 · Clear</span>
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
              className="bg-[#0c120e]/80 border border-white/10 rounded-md px-3.5 py-2 text-right"
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
                  Basket
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
                  Edible {edibleCount} (Kukeseen {basket.bySpecies.kukeseen} · Puravik{' '}
                  {boleteEdibleCount} · Riisikas {basket.bySpecies.kuuseriisikas})
                  {(basket.inedible > 0 || basket.poisonous > 0) && (
                    <div className="text-[#e78a78]">
                      {basket.inedible > 0 ? `Inedible ${basket.inedible}` : ''}
                      {basket.inedible > 0 && basket.poisonous > 0 ? ' · ' : ''}
                      {basket.poisonous > 0 ? `Poisonous ${basket.poisonous}` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 pointer-events-auto">
              <button
                type="button"
                tabIndex={-1}
                onClick={handleToggleMute}
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                className="w-9 h-9 flex items-center justify-center rounded-md bg-[#0c120e]/80 border border-white/10 text-[#cdd9cc] hover:bg-[#1a261e] hover:text-white transition-colors cursor-pointer"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={handlePauseBtn}
                aria-label="Pause game"
                className="w-9 h-9 flex items-center justify-center rounded-md bg-[#0c120e]/80 border border-white/10 text-[#cdd9cc] hover:bg-[#1a261e] hover:text-white transition-colors cursor-pointer"
              >
                <Pause className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Center-Below Interaction Prompt */}
          {prompt && (
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

          {/* Toast Feedback */}
          {toastVisible && (
            <div
              data-testid="game-toast"
              className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-[#0c120e]/92 border border-white/15 rounded-md px-4 py-2.5 text-sm text-[#eef2eb] max-w-lg text-center"
            >
              {toastMsg}
            </div>
          )}

          {/* Bottom-Left: Compass, Round Minimap & Stamina */}
          <div className="absolute bottom-5 left-5 flex flex-col items-center gap-1.5">
            {carryLabel && (
              <div className="self-start text-xs font-medium text-[#f0dfb4] bg-[#0c120e]/80 border border-white/10 rounded px-2.5 py-1 drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]">
                {carryLabel}
              </div>
            )}
            <div
              data-testid="minimap-compass"
              aria-label="Compass and minimap"
              className="relative w-[148px] h-[148px] rounded-full bg-[#0c120e]/85 border border-white/15 shadow-[0_6px_22px_rgba(0,0,0,0.55)] flex items-center justify-center"
            >
              <canvas
                ref={minimapCanvasEl}
                data-testid="minimap-canvas"
                width={148}
                height={148}
                className="w-[148px] h-[148px] rounded-full block"
              />
            </div>
            <div
              ref={compassHeadingEl}
              data-testid="compass-heading"
              className="px-2.5 py-0.5 rounded bg-[#0c120e]/90 border border-white/12 font-mono tabular-nums text-[10px] tracking-wider text-[#e5ede3] whitespace-nowrap"
            >
              N · 357°
            </div>
            <div className="w-[148px] h-1.5 bg-black/60 border border-white/15 rounded overflow-hidden">
              <div
                ref={staminaFillEl}
                className="w-full h-full origin-left bg-[#7fb382] transition-transform duration-75"
              />
            </div>
          </div>

          {/* Bottom-Right: Quiet Control Reminder */}
          <div className="hidden md:block absolute bottom-5 right-5 text-[11px] text-[#9eb09d] drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            Click canvas to look · WASD Move · Space Jump · E Gather/Use · L Light · T +2h · Y Weather · P Pause
          </div>
        </div>
      )}

      {/* Title Screen Overlay */}
      {phase === 'title' && (
        <div
          data-testid="title-screen"
          className="fixed inset-0 z-30 flex flex-col justify-between p-8 md:p-12 bg-gradient-to-r from-[#070b09]/74 via-[#080d0a]/36 to-transparent"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs tracking-[0.22em] uppercase text-[#a8bba7]">
              Estonian Countryside Simulation · Seed #{worldSeed}
            </span>
            <span
              ref={fpsEl}
              className="font-mono tabular-nums text-xs text-[#c8d8c6]"
            >
              60 FPS
            </span>
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

            <p className="text-sm md:text-base text-[#bfd0bd] leading-relaxed mb-7 max-w-md">
              Roam procedural birch groves, dense spruce thickets, four villages, and misty
              peat bog islands with decaying timber huts while foraging seven wild mushroom species.
            </p>

            <button
              type="button"
              data-start="true"
              onClick={handleStartClick}
              className="px-8 py-3.5 text-sm font-semibold tracking-wider uppercase rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#72997a] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c7dec2]"
            >
              Enter Countryside
            </button>
          </div>

          <div className="text-xs text-[#9cb09b] tracking-wide">
            WASD Walk · Shift Run · Space Jump Fences · C Crouch · E Gather / Use · F Kick · R Inspect · L Flashlight · T +2h · Y Weather
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {phase === 'paused' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Game Paused"
          className="fixed inset-0 z-30 flex items-center justify-center bg-[#070b09]/78 p-6"
        >
          <div className="w-full max-w-sm bg-[#101813] border border-white/12 rounded-lg p-7">
            <h2 className="font-display text-2xl text-[#e8f0e4] tracking-wide">
              Paused
            </h2>
            <p className="mt-1 text-xs text-[#9eb29d] tabular-nums">
              Seed #{worldSeed} · Edible: {edibleCount} · Total: {basket.total} / {totalWorldMushrooms}
            </p>

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleResumeClick}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#6e9476] transition-colors cursor-pointer"
              >
                Resume Exploration
              </button>
              <button
                type="button"
                onClick={handleNewProceduralMap}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#18231c] hover:bg-[#223127] text-[#dce7da] border border-white/12 transition-colors cursor-pointer"
              >
                New Procedural Map
              </button>
              <button
                type="button"
                onClick={handleRestartClick}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#18231c] hover:bg-[#223127] text-[#dce7da] border border-white/12 transition-colors cursor-pointer"
              >
                Restart World
              </button>
              <button
                type="button"
                onClick={handleReturnToTitle}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-transparent hover:bg-white/5 text-[#a9baa8] border border-white/10 transition-colors cursor-pointer"
              >
                Title Screen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
