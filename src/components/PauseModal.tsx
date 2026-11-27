import type { QualityMode, QualityTierName } from '../game/qualityGovernor';
import { useLanguage } from '../i18n/i18n';
import { QualityModeControl, ResolutionScaleControl } from './DisplaySettingsControls';
import { LanguageSwitcher } from './LanguageSwitcher';

export interface PauseModalProps {
  worldSeed: number;
  edibleCount: number;
  basketTotal: number;
  totalWorldMushrooms: number;
  resolutionSummary: string;
  effectiveResolutionScale: number;
  isManualScale: boolean;
  qualityMode: QualityMode;
  activeTierName: QualityTierName;
  onResolutionSliderChange: (nextScale: number) => void;
  onResolutionAutoReset: () => void;
  onQualityModeChange: (rawValue: string) => void;
  onResume: () => void;
  onNewMap: () => void;
  onRestart: () => void;
  onReturnToTitle: () => void;
}

export function PauseModal({
  worldSeed,
  edibleCount,
  basketTotal,
  totalWorldMushrooms,
  resolutionSummary,
  effectiveResolutionScale,
  isManualScale,
  qualityMode,
  activeTierName,
  onResolutionSliderChange,
  onResolutionAutoReset,
  onQualityModeChange,
  onResume,
  onNewMap,
  onRestart,
  onReturnToTitle,
}: PauseModalProps) {
  const { t } = useLanguage();

  return (
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
                total: basketTotal,
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
          <ResolutionScaleControl
            sliderId="pause-resolution-slider"
            label={t('pause.resolution')}
            resolutionSummary={resolutionSummary}
            effectiveResolutionScale={effectiveResolutionScale}
            isManualScale={isManualScale}
            onResolutionSliderChange={onResolutionSliderChange}
            onResolutionAutoReset={onResolutionAutoReset}
            variant="pause"
          />
        </div>

        <div className="mt-3 rounded-md bg-[#0b110d] border border-white/10 px-3.5 py-2.5">
          <QualityModeControl
            selectId="pause-quality-select"
            selectTestId="pause-quality-select"
            readoutTestId="pause-quality-readout"
            label={t('pause.quality')}
            qualityMode={qualityMode}
            activeTierName={activeTierName}
            onQualityModeChange={onQualityModeChange}
            variant="pause"
          />
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#6e9476] transition-colors cursor-pointer"
          >
            {t('pause.resume')}
          </button>
          <button
            type="button"
            onClick={onNewMap}
            className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#18231c] hover:bg-[#223127] text-[#dce7da] border border-white/12 transition-colors cursor-pointer"
          >
            {t('pause.newMap')}
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="w-full py-2.5 px-4 text-sm font-medium rounded bg-[#18231c] hover:bg-[#223127] text-[#dce7da] border border-white/12 transition-colors cursor-pointer"
          >
            {t('pause.restartSameSeed')}
          </button>
          <button
            type="button"
            onClick={onReturnToTitle}
            className="w-full py-2.5 px-4 text-sm font-medium rounded bg-transparent hover:bg-white/5 text-[#a9baa8] border border-white/10 transition-colors cursor-pointer"
          >
            {t('pause.titleScreen')}
          </button>
        </div>
      </div>
    </div>
  );
}
