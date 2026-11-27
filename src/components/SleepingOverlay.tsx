import { Moon } from 'lucide-react';
import { formatGameHour, type PlayerSurvivalState } from '../game/survivalEngine';
import { useLanguage } from '../i18n/i18n';
import type { WorldSurvivalSnapshot } from './worldRuntimeContracts';

export interface SleepingOverlayProps {
  sleepProgress: NonNullable<WorldSurvivalSnapshot['sleepProgress']>;
  hourOfDay: number;
  survival: PlayerSurvivalState;
  onWakeEarly: () => void;
}

export function SleepingOverlay({
  sleepProgress,
  hourOfDay,
  survival,
  onWakeEarly,
}: SleepingOverlayProps) {
  const { t } = useLanguage();

  return (
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
              {sleepProgress.spotLabel}
            </div>
          </div>
          <div className="text-right font-mono tabular-nums">
            <div
              data-testid="sleep-clock"
              className="text-lg font-semibold text-[#f1e4c4]"
            >
              {formatGameHour(hourOfDay)}
            </div>
            <div className="text-[11px] text-[#9bb09a]">
              {sleepProgress.elapsedHours.toFixed(1)}h / {sleepProgress.totalHours}h
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
                  sleepProgress.elapsedHours / Math.max(0.1, sleepProgress.totalHours)
                )
              )})`,
            }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="font-mono tabular-nums text-[#b9cab8]">
            {t('sleepOverlay.stats', {
              energy: Math.round(survival.energy),
              temp: survival.bodyTempC.toFixed(1),
              food: Math.round(survival.stomachFullness),
            })}
          </span>
          <button
            type="button"
            data-testid="wake-early-btn"
            onClick={onWakeEarly}
            className="px-3 py-1 rounded bg-[#1c2a21] hover:bg-[#283b2e] border border-white/14 text-[#e7f0e5] cursor-pointer"
          >
            {t('sleepOverlay.wakeEarly')}
          </button>
        </div>
      </div>
    </div>
  );
}
