import {
  RESOLUTION_SCALE_MAX,
  RESOLUTION_SCALE_MIN,
  RESOLUTION_SCALE_STEP,
} from '../game/gameLogic';
import type { QualityMode, QualityTierName } from '../game/qualityGovernor';
import { TranslationKey, useLanguage } from '../i18n/i18n';

interface ResolutionScaleControlProps {
  sliderId: string;
  sliderTestId?: string;
  readoutTestId?: string;
  label: string;
  resolutionSummary: string;
  effectiveResolutionScale: number;
  isManualScale: boolean;
  onResolutionSliderChange: (nextScale: number) => void;
  onResolutionAutoReset: () => void;
  variant: 'title' | 'pause';
}

export function ResolutionScaleControl({
  sliderId,
  sliderTestId,
  readoutTestId,
  label,
  resolutionSummary,
  effectiveResolutionScale,
  isManualScale,
  onResolutionSliderChange,
  onResolutionAutoReset,
  variant,
}: ResolutionScaleControlProps) {
  const { t } = useLanguage();
  const isTitle = variant === 'title';

  return (
    <div>
      <div className={`flex items-center justify-between gap-2 ${isTitle ? 'mb-2' : 'mb-1.5'}`}>
        <label
          htmlFor={sliderId}
          className={`text-[11px] uppercase text-[#a5b9a4] ${
            isTitle ? 'font-medium tracking-[0.14em]' : 'tracking-[0.12em]'
          }`}
        >
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span
            data-testid={readoutTestId}
            className={`font-mono tabular-nums text-[#e5efe3] ${
              isTitle ? 'text-xs' : 'text-[11px]'
            }`}
          >
            {resolutionSummary}
          </span>
          {isManualScale && (
            <button
              type="button"
              onClick={onResolutionAutoReset}
              className="text-[11px] text-[#98c29b] hover:text-[#cce6ce] underline underline-offset-2 cursor-pointer"
            >
              {t('title.auto')}
            </button>
          )}
        </div>
      </div>
      <input
        id={sliderId}
        data-testid={sliderTestId}
        type="range"
        min={RESOLUTION_SCALE_MIN}
        max={RESOLUTION_SCALE_MAX}
        step={RESOLUTION_SCALE_STEP}
        value={effectiveResolutionScale}
        onChange={(e) => onResolutionSliderChange(parseFloat(e.target.value))}
        aria-label={t('title.renderResolution')}
        className="w-full h-1.5 rounded-lg appearance-none bg-[#233328] accent-[#7fb382] cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#98c29b]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b110d]"
      />
      {isTitle && (
        <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono tabular-nums text-[#859984]">
          <span>{t('title.resFast')}</span>
          <span>{t('title.resNative')}</span>
          <span>{t('title.resSharp')}</span>
        </div>
      )}
    </div>
  );
}

interface QualityModeControlProps {
  selectId: string;
  selectTestId: string;
  readoutTestId: string;
  label: string;
  qualityMode: QualityMode;
  activeTierName: QualityTierName;
  onQualityModeChange: (rawValue: string) => void;
  variant: 'title' | 'pause';
}

export function QualityModeControl({
  selectId,
  selectTestId,
  readoutTestId,
  label,
  qualityMode,
  activeTierName,
  onQualityModeChange,
  variant,
}: QualityModeControlProps) {
  const { t } = useLanguage();
  const isTitle = variant === 'title';

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label
          htmlFor={selectId}
          className={`text-[11px] uppercase text-[#a5b9a4] ${
            isTitle ? 'font-medium tracking-[0.14em]' : 'tracking-[0.12em]'
          }`}
        >
          {label}
        </label>
        <span
          data-testid={readoutTestId}
          className="font-mono tabular-nums text-[11px] text-[#e5efe3]"
        >
          {t(`quality.${activeTierName}` as TranslationKey)}
        </span>
      </div>
      <select
        id={selectId}
        data-testid={selectTestId}
        value={qualityMode === 'auto' ? 'auto' : String(qualityMode)}
        onChange={(e) => onQualityModeChange(e.target.value)}
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
  );
}
