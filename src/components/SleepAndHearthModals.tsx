import React, { useState } from 'react';
import { Flame, Moon, Droplets, Utensils, X, AlertTriangle, Tent } from 'lucide-react';
import {
  countEdibleMushrooms,
  InventoryState,
} from '../game/itemCatalog';
import {
  formatGameHour,
  PlayerSurvivalState,
  previewSleepOutcome,
} from '../game/survivalEngine';
import { CampfireInfo, SleepSpotInfo } from '../world/architectureAndProps';
import { getItemName, getWaterQualityShort, useLanguage } from '../i18n/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ItemArtwork } from './ItemArtwork';

interface SleepModalProps {
  spot: SleepSpotInfo;
  survival: PlayerSurvivalState;
  inventory: InventoryState;
  hourOfDay: number;
  weather: 'clear' | 'mist' | 'rain' | 'storm';
  windStrength: number;
  nearLitCampfireFactor: number;
  onConfirmSleep: (hours: number) => void;
  onSitInTent?: (spot: SleepSpotInfo) => void;
  onClose: () => void;
}

export const SleepModal: React.FC<SleepModalProps> = ({
  spot,
  survival,
  inventory,
  hourOfDay,
  weather,
  windStrength,
  nearLitCampfireFactor,
  onConfirmSleep,
  onSitInTent,
  onClose,
}) => {
  const { t } = useLanguage();
  const [hours, setHours] = useState<number>(6);
  const preview = previewSleepOutcome(
    survival,
    inventory,
    hours,
    hourOfDay,
    weather,
    windStrength,
    spot.shelter,
    nearLitCampfireFactor
  );

  const hourLabel =
    hours === 1
      ? t('sleepModal.hourSingular', { n: hours })
      : t('sleepModal.hourPlural', { n: hours });

  return (
    <div
      data-testid="sleep-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('sleepModal.ariaLabel')}
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#070b09]/78 p-5"
    >
      <div className="w-full max-w-md bg-[#0f1612] border border-white/12 rounded-lg p-6 shadow-[0_24px_60px_rgba(0,0,0,0.65)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-[#9eb59c]">
              <Moon className="w-3.5 h-3.5 text-[#d9c48c]" />
              {spot.kind === 'bed'
                ? t('sleepModal.shelteredBed')
                : spot.kind === 'tent'
                  ? t('sleepModal.tentShelter')
                  : spot.kind === 'sleeping_bag'
                    ? t('sleepModal.sleepingBagRest')
                    : t('sleepModal.campfireRest')}
            </div>
            <h2 className="font-display text-2xl text-[#ecf3e8] mt-0.5">{spot.label}</h2>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <button
              type="button"
              onClick={onClose}
              aria-label={t('sleepModal.closeAria')}
              className="w-8 h-8 flex items-center justify-center rounded bg-[#17221b] hover:bg-[#223127] border border-white/10 text-[#c9d7c8] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Hours Slider */}
        <div className="mt-5 rounded border border-white/10 bg-[#0b110d] p-4">
          <div className="flex items-baseline justify-between mb-2">
            <label
              htmlFor="sleep-hours-slider"
              className="text-xs uppercase tracking-wider text-[#a5b9a4]"
            >
              {t('sleepModal.duration')}
            </label>
            <span
              data-testid="sleep-hours-readout"
              className="font-mono tabular-nums text-sm font-semibold text-[#f1e4c4]"
            >
              {hourLabel} ({formatGameHour(preview.startHour)} → {formatGameHour(preview.wakeHour)})
            </span>
          </div>
          <input
            id="sleep-hours-slider"
            data-testid="sleep-hours-slider"
            type="range"
            min={1}
            max={10}
            step={1}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-full h-1.5 rounded-lg appearance-none bg-[#233328] accent-[#8fc092] cursor-pointer"
          />
          <div className="mt-1.5 flex justify-between text-[10px] font-mono tabular-nums text-[#859a84]">
            <span>{t('sleepModal.nap')}</span>
            <span>{t('sleepModal.rest')}</span>
            <span>{t('sleepModal.fullNight')}</span>
          </div>
        </div>

        {/* Projected Outcome */}
        <div className="mt-4 space-y-1.5 text-xs font-mono tabular-nums">
          <div className="flex justify-between gap-2">
            <span className="text-[#98ad97] font-sans">{t('sleepModal.projectedEnergy')}</span>
            <span className="text-[#eaf2e8] text-right">
              {preview.startEnergy}% → <strong>{preview.projectedEnergy}%</strong>
              {preview.energyCap < 100 && (
                <span className="text-[#dfb46e]">
                  {' '}
                  {t('sleepModal.cappedAt', { cap: preview.energyCap })}
                </span>
              )}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#98ad97] font-sans">{t('sleepModal.stomachHydration')}</span>
            <span className="text-[#d6e2d4] text-right">
              {t('sleepModal.fillHyd', {
                fill: preview.projectedFullness,
                hyd: preview.projectedHydration,
              })}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#98ad97] font-sans">{t('sleepModal.conditions')}</span>
            <span className="text-[#d6e2d4] text-right">
              {t('sleepModal.feelsCore', {
                feels: preview.avgFeelsLikeC.toFixed(1),
                core: preview.projectedBodyTempC.toFixed(1),
              })}
            </span>
          </div>
          {spot.shelter === 'tent' && (
            <div
              data-testid="sleep-tent-waterproof-note"
              className="text-[11px] font-sans text-[#9bc79e] pt-1"
            >
              {t('sleepModal.tentWaterproofNote')}
            </div>
          )}
          {preview.hasSleepingBag && (
            <div
              data-testid="sleep-bag-active-note"
              className="text-[11px] font-sans text-[#dfb889] pt-0.5"
            >
              {t('sleepModal.sleepingBagActive', {
                temp: preview.sleepGearWarmthBonusC.toFixed(1),
              })}
            </div>
          )}
        </div>

        {preview.warnings.length > 0 && (
          <div className="mt-4 rounded border border-[#b88642]/45 bg-[#211a10] p-3 space-y-1">
            {preview.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-[#ebd1a0]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#e0a853]" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium uppercase tracking-wider rounded bg-transparent hover:bg-white/5 text-[#a9baa8] border border-white/12 cursor-pointer"
          >
            {t('sleepModal.cancel')}
          </button>
          {spot.kind === 'tent' && onSitInTent && (
            <button
              type="button"
              data-testid="sit-in-tent-btn"
              onClick={() => onSitInTent(spot)}
              className="px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded bg-[#233a40] hover:bg-[#2d4c54] text-[#e8f5f7] border border-[#6ca3b0]/55 flex items-center gap-1.5 cursor-pointer"
            >
              <Tent className="w-3.5 h-3.5" />
              {t('sleepModal.sitInsideBtn')}
            </button>
          )}
          <button
            type="button"
            data-testid="confirm-sleep-btn"
            onClick={() => onConfirmSleep(hours)}
            className="px-5 py-2 text-xs font-semibold uppercase tracking-wider rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#72997a] cursor-pointer"
          >
            {t('sleepModal.sleepBtn', { hours })}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CampfireHearthModalProps {
  campfire: CampfireInfo;
  inventory: InventoryState;
  onIgnite: () => void;
  onBank: () => void;
  onThrowLog?: () => void;
  onCook: (recipe: 'seared_steak' | 'roasted_mushrooms') => void;
  onBoilBottle: (uid: string) => void;
  onOpenRest: () => void;
  onClose: () => void;
}

export const CampfireHearthModal: React.FC<CampfireHearthModalProps> = ({
  campfire,
  inventory,
  onIgnite,
  onBank,
  onThrowLog,
  onCook,
  onBoilBottle,
  onOpenRest,
  onClose,
}) => {
  const { lang, t } = useLanguage();
  const rawSteaks = inventory.stacks.raw_steak ?? 0;
  const firewoodCount = inventory.stacks.firewood ?? 0;
  const edibleMush = countEdibleMushrooms(inventory);
  const nonEmptyBottles = inventory.bottles.filter((b) => b.waterLiters > 0.001);
  const hasFireStarter = inventory.lighterUses > 0 || inventory.matchStrikes > 0;
  const hearthLabel =
    campfire.label === 'Wilderness' ? t('prop.campfireWilderness') : campfire.label;

  return (
    <div
      data-testid="campfire-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('hearth.ariaLabel')}
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#070b09]/78 p-5"
    >
      <div className="w-full max-w-lg bg-[#0f1612] border border-white/12 rounded-lg p-6 shadow-[0_24px_60px_rgba(0,0,0,0.65)] space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-[#d6a26d]">
              <Flame className="w-3.5 h-3.5" />
              {campfire.lit ? t('hearth.lit') : t('hearth.unlit')}
            </div>
            <h2 className="font-display text-2xl text-[#ecf3e8] mt-0.5">
              {t('hearth.title', { label: hearthLabel })}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <button
              type="button"
              onClick={onClose}
              aria-label={t('hearth.closeAria')}
              className="w-8 h-8 flex items-center justify-center rounded bg-[#17221b] hover:bg-[#223127] border border-white/10 text-[#c9d7c8] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Fire Control */}
        <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-[#0b110d] px-4 py-3">
          <div className="text-xs text-[#b8c8b7]">
            {campfire.lit
              ? t('hearth.litDesc')
              : hasFireStarter
                ? inventory.lighterUses > 0
                  ? t('hearth.useLighter', { count: inventory.lighterUses })
                  : t('hearth.useMatches', { count: inventory.matchStrikes })
                : t('hearth.noStarter')}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onThrowLog && (
              <button
                type="button"
                data-testid="throw-log-campfire-btn"
                disabled={firewoodCount < 1}
                onClick={onThrowLog}
                className="px-3 py-1.5 text-xs font-medium rounded bg-[#4a2f18] hover:bg-[#5e3c1f] disabled:opacity-40 text-[#fbe8d2] border border-[#b87a42]/50 shrink-0 cursor-pointer disabled:cursor-not-allowed"
              >
                {t('hearth.throwLog', { count: firewoodCount })}
              </button>
            )}
            {campfire.lit ? (
              <button
                type="button"
                onClick={onBank}
                className="px-3.5 py-1.5 text-xs font-medium rounded bg-[#232b24] hover:bg-[#313b32] text-[#d7e2d5] border border-white/12 shrink-0 cursor-pointer"
              >
                {t('hearth.bankFire')}
              </button>
            ) : (
              <button
                type="button"
                data-testid="ignite-campfire-btn"
                disabled={!hasFireStarter}
                onClick={onIgnite}
                className="px-3.5 py-1.5 text-xs font-semibold rounded bg-[#6b4423] hover:bg-[#82532b] disabled:opacity-40 text-[#fdf3e6] border border-[#c98b51]/50 shrink-0 cursor-pointer disabled:cursor-not-allowed"
              >
                {t('hearth.igniteFire')}
              </button>
            )}
          </div>
        </div>

        {/* Cooking */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-[#d6b376] font-semibold">
            <Utensils className="w-3.5 h-3.5" />
            {t('hearth.cookHeading')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              data-testid="cook-steak-btn"
              disabled={!campfire.lit || rawSteaks < 1}
              onClick={() => onCook('seared_steak')}
              className="text-left rounded border border-white/10 bg-[#131d17] hover:bg-[#1a2820] disabled:opacity-40 px-3 py-2.5 flex items-center gap-2.5 cursor-pointer disabled:cursor-not-allowed"
            >
              <ItemArtwork itemId="seared_steak" className="w-9 h-9 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-[#edf3ea]">{t('hearth.searSteak')}</div>
                <div className="text-[11px] text-[#9eb19d] mt-0.5">
                  {t('hearth.searSteakDesc', { count: rawSteaks })}
                </div>
              </div>
            </button>
            <button
              type="button"
              data-testid="cook-mushrooms-btn"
              disabled={!campfire.lit || edibleMush < 3}
              onClick={() => onCook('roasted_mushrooms')}
              className="text-left rounded border border-white/10 bg-[#131d17] hover:bg-[#1a2820] disabled:opacity-40 px-3 py-2.5 flex items-center gap-2.5 cursor-pointer disabled:cursor-not-allowed"
            >
              <ItemArtwork itemId="roasted_mushrooms" className="w-9 h-9 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-[#edf3ea]">
                  {t('hearth.roastMushrooms')}
                </div>
                <div className="text-[11px] text-[#9eb19d] mt-0.5">
                  {t('hearth.roastMushroomsDesc', { count: edibleMush })}
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Boil & Purify Water */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-[#86b8cc] font-semibold">
            <Droplets className="w-3.5 h-3.5" />
            {t('hearth.boilHeading')}
          </div>
          {nonEmptyBottles.length === 0 ? (
            <div className="text-xs text-[#869985]">{t('hearth.noFilledBottles')}</div>
          ) : (
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {nonEmptyBottles.map((b) => (
                <div
                  key={b.uid}
                  className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[#131d17] px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ItemArtwork
                      itemId={b.itemId}
                      waterFillRatio={b.waterLiters / Math.max(0.1, b.capacityLiters)}
                      waterQuality={b.waterQuality}
                      className="w-7 h-7 shrink-0"
                    />
                    <div className="truncate">
                      <span className="text-[#eaf1e7] font-medium">
                        {getItemName(b.itemId, lang)}
                      </span>{' '}
                      <span className="font-mono tabular-nums text-[#96b9c8]">
                        ({b.waterLiters.toFixed(2)}L · {getWaterQualityShort(b.waterQuality, lang)},{' '}
                        {Math.round(b.waterTempC)}°C)
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`boil-btn-${b.uid}`}
                    disabled={!campfire.lit}
                    onClick={() => onBoilBottle(b.uid)}
                    className="px-2.5 py-1 rounded bg-[#274857] hover:bg-[#325d70] disabled:opacity-40 text-[#edf6fa] border border-[#6ca6bf]/45 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {b.waterQuality === 'clean' ? t('hearth.warmWater') : t('hearth.boilPurify')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-3">
          <button
            type="button"
            data-testid="campfire-rest-btn"
            onClick={onOpenRest}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#72997a] cursor-pointer"
          >
            {t('hearth.restByFire')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium uppercase tracking-wider rounded bg-transparent hover:bg-white/5 text-[#a9baa8] border border-white/12 cursor-pointer"
          >
            {t('hearth.leaveHearth')}
          </button>
        </div>
      </div>
    </div>
  );
};
