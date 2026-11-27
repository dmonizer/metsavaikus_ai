import { Backpack, Map as MapIcon, Moon, Pause, Tent, Volume2, VolumeX } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { InteractionPromptData, MushroomBasket } from '../game/gameLogic';
import { useLanguage } from '../i18n/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import type { WorldHudRefs, WorldSurvivalSnapshot } from './worldRuntimeContracts';

export interface GameplayHudProps {
  hudRefs: WorldHudRefs;
  anyGameplayModalOpen: boolean;
  prompt: InteractionPromptData | null;
  basket: MushroomBasket;
  totalWorldMushrooms: number;
  edibleCount: number;
  boleteEdibleCount: number;
  snapshot: WorldSurvivalSnapshot | null;
  packWeightKg: number;
  fullMapOpen: boolean;
  backpackOpen: boolean;
  muted: boolean;
  carryLabel: string;
  toastVisible: boolean;
  toastMsg: string;
  onToggleFullMap: (e?: MouseEvent<HTMLElement>) => void;
  onToggleBackpack: (e: MouseEvent<HTMLButtonElement>) => void;
  onToggleMute: (e: MouseEvent<HTMLButtonElement>) => void;
  onPause: (e: MouseEvent<HTMLButtonElement>) => void;
  onOpenSleepForSeatedTent: () => void;
  onStandUpFromTent: () => void;
}

export function GameplayHud({
  hudRefs,
  anyGameplayModalOpen,
  prompt,
  basket,
  totalWorldMushrooms,
  edibleCount,
  boleteEdibleCount,
  snapshot,
  packWeightKg,
  fullMapOpen,
  backpackOpen,
  muted,
  carryLabel,
  toastVisible,
  toastMsg,
  onToggleFullMap,
  onToggleBackpack,
  onToggleMute,
  onPause,
  onOpenSleepForSeatedTent,
  onStandUpFromTent,
}: GameplayHudProps) {
  const { t } = useLanguage();
  const navMode = snapshot?.navigationMode ?? 'both';
  const showNavCanvas = navMode !== 'none';
  const showCompassHeading = navMode === 'compass' || navMode === 'both';

  return (
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
          ref={hudRefs.biomeEl}
          className="text-sm font-semibold text-[#e3ede0] leading-snug min-h-[1.25rem]"
        />
        <div className="mt-0.5 flex items-center gap-2 text-xs text-[#a5b9a4]">
          <span ref={hudRefs.timeWeatherEl} className="min-w-[4.5rem]" />
          <span aria-hidden="true" className="text-white/25">
            ·
          </span>
          <span
            ref={hudRefs.fpsEl}
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
              <span className="text-[#8a9b88] font-normal">/{totalWorldMushrooms}</span>
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
            onClick={onToggleFullMap}
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
            onClick={onToggleBackpack}
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
            onClick={onToggleMute}
            aria-label={muted ? t('hud.unmuteAria') : t('hud.muteAria')}
            className="w-9 h-9 flex items-center justify-center rounded-md bg-[#0c120e]/82 border border-white/10 text-[#cdd9cc] hover:bg-[#1a261e] hover:text-white transition-colors cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={onPause}
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
          <div className="text-sm font-semibold text-[#f3e4c3]">{prompt.title}</div>
          <div className="mt-0.5 text-xs text-[#c4d1c2]">{prompt.actionsText}</div>
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
              onClick={onOpenSleepForSeatedTent}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-[#2d4a34] hover:bg-[#3a6043] text-[#eef5ec] border border-[#729e7a]/55 flex items-center gap-1.5 cursor-pointer"
            >
              <Moon className="w-3.5 h-3.5" />
              {t('tentSeated.sleepBtn')}
            </button>
            <button
              type="button"
              data-testid="seated-stand-btn"
              onClick={onStandUpFromTent}
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
              onClick={navMode === 'map' || navMode === 'both' ? onToggleFullMap : undefined}
              title={
                navMode === 'map' || navMode === 'both' ? t('hud.minimapClickHint') : undefined
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
                ref={hudRefs.minimapCanvasEl}
                data-testid="minimap-canvas"
                width={148}
                height={148}
                className="w-[148px] h-[148px] rounded-full block"
              />
            </div>
            {showCompassHeading ? (
              <div
                ref={hudRefs.compassHeadingEl}
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
            <span className="uppercase tracking-wider text-[#9db19c]">{t('hud.vitals')}</span>
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
              <span ref={hudRefs.bodyTempEl} data-testid="body-temp-readout">
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
                  ref={hudRefs.healthFillEl}
                  data-testid="vital-health-bar"
                  className="w-full h-full origin-left bg-[#c95b50] transition-transform duration-100"
                />
              </div>
            </div>

            {/* Energy — Flexed Arm */}
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
                  ref={hudRefs.energyFillEl}
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
                  ref={hudRefs.hydrationFillEl}
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
                <path
                  d="M2.2 2.4v3.1M3.2 2.4v3.1M2.7 5.5v8.1"
                  stroke="currentColor"
                  strokeWidth="1.15"
                  strokeLinecap="round"
                />
                <circle cx="8" cy="8.2" r="3.2" stroke="currentColor" strokeWidth="1.25" />
                <circle cx="8" cy="8.2" r="1.45" fill="currentColor" fillOpacity="0.45" />
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
                  ref={hudRefs.fullnessFillEl}
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
                  ref={hudRefs.tirednessFillEl}
                  data-testid="vital-tiredness-bar"
                  className="w-full h-full origin-left bg-[#b87c66] transition-transform duration-100"
                  style={{ transform: 'scaleX(0.04)' }}
                />
              </div>
            </div>
          </div>

          <div
            ref={hudRefs.conditionsEl}
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
  );
}
