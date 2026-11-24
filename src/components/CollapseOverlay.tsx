import React from 'react';
import { MushroomBasket } from '../game/gameLogic';
import { PlayerSurvivalState } from '../game/survivalEngine';
import { useLanguage } from '../i18n/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

interface CollapseOverlayProps {
  phase: 'collapsing' | 'collapsed';
  collapseProgress: number; // 0 .. 1 during 'collapsing'
  survival: PlayerSurvivalState;
  basket: MushroomBasket;
  worldSeed: number;
  onRespawn: () => void;
  onNewMap: () => void;
  onTitle: () => void;
}

/**
 * Computes heavy-lidded blink curve (0 = open, 1 = completely shut):
 * two drowsy heavy blinks followed by a slow final closing into complete darkness.
 */
function computeEyelidClosure(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  if (t < 0.24) {
    // First heavy droop
    return Math.sin((t / 0.24) * Math.PI) * 0.52;
  }
  if (t < 0.44) {
    // Brief struggle to keep eyes open
    return 0.14 + Math.sin(((t - 0.24) / 0.2) * Math.PI) * 0.64;
  }
  // Slow final closing to complete dark
  const u = (t - 0.44) / 0.56;
  const smooth = u * u * (3 - 2 * u);
  return 0.22 + smooth * 0.78;
}

export const CollapseOverlay: React.FC<CollapseOverlayProps> = ({
  phase,
  collapseProgress,
  survival,
  basket,
  worldSeed,
  onRespawn,
  onNewMap,
  onTitle,
}) => {
  const { t } = useLanguage();
  const closure = phase === 'collapsed' ? 1 : computeEyelidClosure(collapseProgress);
  const lidTravelPct = (1 - closure) * 100; // 100% = offscreen open, 0% = sealed shut at midline
  const blackoutOpacity =
    phase === 'collapsed' ? 0.96 : Math.max(0, Math.min(1, (closure - 0.55) / 0.45));

  return (
    <div
      data-testid={phase === 'collapsing' ? 'collapsing-overlay' : 'collapsed-screen'}
      className="fixed inset-0 z-40 pointer-events-auto overflow-hidden"
    >
      {/* Upper dark curved eyelid (pure compositor transform) */}
      <div
        aria-hidden="true"
        className="fixed top-0 left-[-10%] w-[120%] h-[56vh] bg-[#040605] rounded-b-[45%] shadow-[0_24px_48px_rgba(0,0,0,0.95)] will-change-transform pointer-events-none"
        style={{ transform: `translateY(${-lidTravelPct}%)` }}
      />

      {/* Lower dark curved eyelid (pure compositor transform) */}
      <div
        aria-hidden="true"
        className="fixed bottom-0 left-[-10%] w-[120%] h-[56vh] bg-[#040605] rounded-t-[45%] shadow-[0_-24px_48px_rgba(0,0,0,0.95)] will-change-transform pointer-events-none"
        style={{ transform: `translateY(${lidTravelPct}%)` }}
      />

      {/* Full blackout veil */}
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[#040605] pointer-events-none"
        style={{ opacity: blackoutOpacity }}
      />

      {/* Post-blackout Collapse Summary Screen */}
      {phase === 'collapsed' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('collapse.ariaLabel')}
          className="relative z-10 w-full h-full flex items-center justify-center p-6"
        >
          <div className="w-full max-w-md bg-[#0d130f] border border-white/12 rounded-lg p-7 shadow-[0_24px_60px_rgba(0,0,0,0.75)]">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-[#c77d6d]">
                {t('collapse.eyebrow', { seed: worldSeed })}
              </div>
              <LanguageSwitcher compact />
            </div>
            <h2 className="font-display text-3xl text-[#edf3e9] tracking-wide mt-1">
              {t('collapse.title')}
            </h2>
            <p
              data-testid="collapse-cause"
              className="mt-2 text-sm text-[#e7a699] font-medium"
            >
              {t('collapse.primaryCause', {
                cause: survival.deathCause ?? t('collapse.defaultCause'),
              })}
            </p>

            {survival.deathFactors.length > 0 && (
              <div className="mt-3 text-xs text-[#a5b5a4] leading-relaxed">
                {t('collapse.compounding', { factors: survival.deathFactors.join(' · ') })}
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-white/10 grid grid-cols-2 gap-3 text-xs font-mono tabular-nums">
              <div>
                <div className="text-[#869985] font-sans">{t('collapse.timeSurvived')}</div>
                <div className="text-[#e7efe5] text-sm mt-0.5">
                  {survival.survivalHoursTotal.toFixed(1)}h
                </div>
              </div>
              <div>
                <div className="text-[#869985] font-sans">{t('collapse.mushroomsGathered')}</div>
                <div className="text-[#e7efe5] text-sm mt-0.5">
                  {t('collapse.edibleInline', { total: basket.total, edible: basket.edible })}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                data-testid="collapse-respawn-btn"
                onClick={onRespawn}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#6e9476] transition-colors cursor-pointer"
              >
                {t('collapse.respawn')}
              </button>
              <button
                type="button"
                onClick={onNewMap}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#18231c] hover:bg-[#223127] text-[#dce7da] border border-white/12 transition-colors cursor-pointer"
              >
                {t('collapse.newMap')}
              </button>
              <button
                type="button"
                onClick={onTitle}
                className="w-full py-2.5 px-4 text-sm font-medium rounded bg-transparent hover:bg-white/5 text-[#a9baa8] border border-white/10 transition-colors cursor-pointer"
              >
                {t('collapse.titleScreen')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
