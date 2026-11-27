import type { RefObject } from 'react';
import type { QualityMode, QualityTierName } from '../game/qualityGovernor';
import { useLanguage } from '../i18n/i18n';
import { QualityModeControl, ResolutionScaleControl } from './DisplaySettingsControls';
import { LanguageSwitcher } from './LanguageSwitcher';

export interface TitleScreenProps {
  worldSeed: number;
  fpsEl: RefObject<HTMLSpanElement | null>;
  resolutionSummary: string;
  effectiveResolutionScale: number;
  isManualScale: boolean;
  qualityMode: QualityMode;
  activeTierName: QualityTierName;
  onResolutionSliderChange: (nextScale: number) => void;
  onResolutionAutoReset: () => void;
  onQualityModeChange: (rawValue: string) => void;
  onStartPacking: () => void;
}

export function TitleScreen({
  worldSeed,
  fpsEl,
  resolutionSummary,
  effectiveResolutionScale,
  isManualScale,
  qualityMode,
  activeTierName,
  onResolutionSliderChange,
  onResolutionAutoReset,
  onQualityModeChange,
  onStartPacking,
}: TitleScreenProps) {
  const { t } = useLanguage();

  return (
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
          <ResolutionScaleControl
            sliderId="title-resolution-slider"
            sliderTestId="resolution-slider"
            readoutTestId="resolution-readout"
            label={t('title.renderResolution')}
            resolutionSummary={resolutionSummary}
            effectiveResolutionScale={effectiveResolutionScale}
            isManualScale={isManualScale}
            onResolutionSliderChange={onResolutionSliderChange}
            onResolutionAutoReset={onResolutionAutoReset}
            variant="title"
          />

          <div className="pt-2.5 border-t border-white/10">
            <QualityModeControl
              selectId="title-quality-select"
              selectTestId="quality-select"
              readoutTestId="quality-readout"
              label={t('title.quality')}
              qualityMode={qualityMode}
              activeTierName={activeTierName}
              onQualityModeChange={onQualityModeChange}
              variant="title"
            />
          </div>
        </div>

        <button
          type="button"
          data-start="true"
          onClick={onStartPacking}
          className="px-8 py-3.5 text-sm font-semibold tracking-wider uppercase rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#72997a] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c7dec2]"
        >
          {t('title.enterCountryside')}
        </button>
      </div>

      <div className="text-xs text-[#9cb09b] tracking-wide">
        {t('title.controls')}
      </div>
    </div>
  );
}
