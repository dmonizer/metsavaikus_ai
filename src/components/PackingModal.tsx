import React from 'react';
import { Minus, Plus, Compass, Droplets, Flame, Utensils, RotateCcw, Tent, CloudRain } from 'lucide-react';
import {
  computePackingWeightKg,
  createDefaultPackingSelection,
  getPackedItemUnitWeightKg,
  ITEM_CATALOG,
  ItemCategory,
  ItemDefinition,
  PACKABLE_ITEMS,
  PackingSelection,
} from '../game/itemCatalog';
import { computeWeightBurden } from '../game/survivalEngine';
import {
  getItemDescription,
  getItemName,
  getItemSecondaryName,
  getLoadTierLabel,
  getStayingPowerLabel,
  TranslationKey,
  useLanguage,
} from '../i18n/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ItemArtwork } from './ItemArtwork';

interface PackingModalProps {
  selection: PackingSelection;
  onChange: (next: PackingSelection) => void;
  onBack: () => void;
  onBegin: () => void;
}

const GROUPS: Array<{
  key: ItemCategory;
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
  icon: React.ReactNode;
}> = [
  {
    key: 'navigation',
    titleKey: 'packing.group.navigation.title',
    subtitleKey: 'packing.group.navigation.subtitle',
    icon: <Compass className="w-4 h-4 text-[#9fc29b]" />,
  },
  {
    key: 'water',
    titleKey: 'packing.group.water.title',
    subtitleKey: 'packing.group.water.subtitle',
    icon: <Droplets className="w-4 h-4 text-[#86b8cc]" />,
  },
  {
    key: 'food',
    titleKey: 'packing.group.food.title',
    subtitleKey: 'packing.group.food.subtitle',
    icon: <Utensils className="w-4 h-4 text-[#d6b376]" />,
  },
  {
    key: 'gear',
    titleKey: 'packing.group.gear.title',
    subtitleKey: 'packing.group.gear.subtitle',
    icon: <Flame className="w-4 h-4 text-[#e09d62]" />,
  },
  {
    key: 'clothing',
    titleKey: 'packing.group.clothing.title',
    subtitleKey: 'packing.group.clothing.subtitle',
    icon: <CloudRain className="w-4 h-4 text-[#e2b85c]" />,
  },
  {
    key: 'camp',
    titleKey: 'packing.group.camp.title',
    subtitleKey: 'packing.group.camp.subtitle',
    icon: <Tent className="w-4 h-4 text-[#8eb88a]" />,
  },
];

export const PackingModal: React.FC<PackingModalProps> = ({
  selection,
  onChange,
  onBack,
  onBegin,
}) => {
  const { lang, t } = useLanguage();
  const totalWeightKg = computePackingWeightKg(selection);
  const burden = computeWeightBurden(totalWeightKg, 0);

  const getNavigationSummary = (sel: PackingSelection): string => {
    const hasCompass = (sel.compass ?? 0) > 0;
    const hasMap = (sel.paper_map ?? 0) > 0;
    if (hasCompass && hasMap) return t('packing.navSummary.both');
    if (hasCompass) return t('packing.navSummary.compass');
    if (hasMap) return t('packing.navSummary.map');
    return t('packing.navSummary.none');
  };

  const adjustQty = (item: ItemDefinition, delta: number) => {
    const cur = selection[item.id] ?? 0;
    const nextQty = Math.max(0, Math.min(item.maxPackQty, cur + delta));
    onChange({ ...selection, [item.id]: nextQty });
  };

  const applyPreset = (preset: 'light' | 'balanced' | 'expedition') => {
    if (preset === 'balanced') {
      onChange(createDefaultPackingSelection());
      return;
    }
    const base: PackingSelection = {};
    for (const it of PACKABLE_ITEMS) base[it.id] = 0;
    if (preset === 'light') {
      base.compass = 1;
      base.bottle_05l = 1;
      base.chocolate_bar = 2;
      base.dried_berries = 1;
      base.matches = 1;
      base.flashlight = 1;
    } else {
      base.compass = 1;
      base.paper_map = 1;
      base.bottle_2l = 1;
      base.raw_steak = 2;
      base.smoked_sausage = 1;
      base.rye_bread = 1;
      base.chocolate_bar = 2;
      base.flashlight = 1;
      base.extra_battery = 2;
      base.lighter = 1;
      base.matches = 1;
      base.rain_jacket = 1;
      base.tent = 1;
      base.sleeping_bag = 1;
    }
    onChange(base);
  };

  const loadColor =
    burden.loadTier === 'overburdened'
      ? 'text-[#e38674]'
      : burden.loadTier === 'heavy'
        ? 'text-[#dfb56b]'
        : burden.loadTier === 'moderate'
          ? 'text-[#d3dec9]'
          : 'text-[#95c498]';

  return (
    <div
      data-testid="packing-screen"
      role="dialog"
      aria-modal="true"
      aria-label={t('packing.ariaLabel')}
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#070b09]/84 p-4 md:p-6"
    >
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-[#0e1511] border border-white/12 rounded-lg overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.65)]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#8fa58e]">
              {t('packing.eyebrow')}
            </div>
            <h2 className="font-display text-2xl text-[#ecf3e8] tracking-wide mt-0.5">
              {t('packing.title')}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => applyPreset('light')}
              className="px-2.5 py-1.5 rounded bg-[#16211a] hover:bg-[#1f2e24] border border-white/10 text-[#c9d7c8] transition-colors cursor-pointer"
            >
              {t('packing.preset.light')}
            </button>
            <button
              type="button"
              onClick={() => applyPreset('balanced')}
              className="px-2.5 py-1.5 rounded bg-[#16211a] hover:bg-[#1f2e24] border border-white/10 text-[#c9d7c8] transition-colors cursor-pointer"
            >
              {t('packing.preset.balanced')}
            </button>
            <button
              type="button"
              onClick={() => applyPreset('expedition')}
              className="px-2.5 py-1.5 rounded bg-[#16211a] hover:bg-[#1f2e24] border border-white/10 text-[#c9d7c8] transition-colors cursor-pointer"
            >
              {t('packing.preset.expedition')}
            </button>
            <button
              type="button"
              onClick={() => onChange(createDefaultPackingSelection())}
              title={t('packing.resetTitle')}
              className="p-1.5 rounded bg-[#16211a] hover:bg-[#1f2e24] border border-white/10 text-[#a8bba7] hover:text-white transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <LanguageSwitcher compact />
          </div>
        </div>

        {/* Scrollable Item Catalog with Pictures */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {GROUPS.map((group) => {
            const items = PACKABLE_ITEMS.filter((it) => it.category === group.key);
            if (items.length === 0) return null;
            return (
              <section key={group.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2 border-b border-white/8 pb-1.5">
                  <div className="flex items-center gap-2">
                    {group.icon}
                    <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#d9e5d7]">
                      {t(group.titleKey)}
                    </h3>
                  </div>
                  <span className="text-[11px] text-[#8ca08b]">{t(group.subtitleKey)}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {items.map((item) => {
                    const qty = selection[item.id] ?? 0;
                    const unitKg = getPackedItemUnitWeightKg(item);
                    const subKg = qty * unitKg;
                    const def = ITEM_CATALOG[item.id];
                    const itemName = getItemName(item.id, lang);
                    const secondary = getItemSecondaryName(item.id, lang);
                    const itemDesc = getItemDescription(item.id, lang);
                    return (
                      <div
                        key={item.id}
                        data-testid={`pack-item-${item.id}`}
                        className={`flex items-center justify-between gap-3 rounded border px-3 py-2.5 transition-colors ${
                          qty > 0
                            ? 'bg-[#152019] border-[#5f8264]/55'
                            : 'bg-[#0b110d] border-white/8'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            data-testid={`pack-art-${item.id}`}
                            className={`w-13 h-13 shrink-0 rounded-md flex items-center justify-center border ${
                              qty > 0
                                ? 'bg-[#0c140f] border-[#698f6e]/50'
                                : 'bg-[#090e0b] border-white/8 opacity-80'
                            }`}
                          >
                            <ItemArtwork itemId={item.id} className="w-10 h-10" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="text-sm font-medium text-[#e9f0e6]">
                                {itemName}
                              </span>
                              {secondary && (
                                <span className="text-[11px] text-[#879d86] italic">
                                  {secondary}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#9eb19d] leading-snug mt-0.5">
                              {itemDesc}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono tabular-nums text-[#8ea48d]">
                              <span>
                                {unitKg.toFixed(2)} kg{' '}
                                {def.waterContainer ? t('packing.unitFull') : t('packing.unitEach')}
                              </span>
                              {def.food && (
                                <span className="text-[#cbb282]">
                                  {t('packing.fill', { pct: def.food.fullness })} ·{' '}
                                  {getStayingPowerLabel(def.food.stayingPower, lang)}
                                </span>
                              )}
                              {def.sleepGear && (
                                <span className="text-[#a8cfa6]">
                                  {t('backpack.sleepWarmthBonus', {
                                    temp: def.sleepGear.outdoorWarmthBonusC.toFixed(1),
                                  })}
                                </span>
                              )}
                              {def.clothing && (
                                <span className="text-[#e6c478]">
                                  {t('packing.rainProtect', {
                                    pct: Math.round(def.clothing.rainResistance * 100),
                                    temp: def.clothing.warmthBonusC.toFixed(1),
                                  })}
                                </span>
                              )}
                              {qty > 0 && (
                                <span className="text-[#c8dcc7]">
                                  {t('packing.subtotal', { kg: subKg.toFixed(2) })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            data-testid={`pack-dec-${item.id}`}
                            disabled={qty <= 0}
                            onClick={() => adjustQty(item, -1)}
                            aria-label={t('packing.removeItem', { name: itemName })}
                            className="w-7 h-7 flex items-center justify-center rounded bg-[#1b271f] hover:bg-[#26382c] disabled:opacity-35 border border-white/10 text-[#dce8da] cursor-pointer disabled:cursor-not-allowed"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span
                            data-testid={`pack-qty-${item.id}`}
                            className="w-6 text-center font-mono tabular-nums text-sm font-semibold text-[#f1f6ef]"
                          >
                            {qty}
                          </span>
                          <button
                            type="button"
                            data-testid={`pack-inc-${item.id}`}
                            disabled={qty >= item.maxPackQty}
                            onClick={() => adjustQty(item, 1)}
                            aria-label={t('packing.addItem', { name: itemName })}
                            className="w-7 h-7 flex items-center justify-center rounded bg-[#1b271f] hover:bg-[#26382c] disabled:opacity-35 border border-white/10 text-[#dce8da] cursor-pointer disabled:cursor-not-allowed"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {/* Footer Pack Weight Summary & CTA */}
        <div className="px-6 py-4 border-t border-white/10 bg-[#0b100d] flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs font-mono tabular-nums">
              <span className="text-[#a5b8a4]">
                {t('packing.packWeight')}{' '}
                <strong
                  data-testid="packing-total-weight"
                  className={`text-sm font-semibold ${loadColor}`}
                >
                  {totalWeightKg.toFixed(2)} kg
                </strong>{' '}
                <span className={`uppercase text-[10px] ${loadColor}`}>
                  ({getLoadTierLabel(burden.loadTier, lang)})
                </span>
              </span>
              <span className="text-[#9bb09a]">
                {t('packing.tiring')}{' '}
                <strong className="text-[#dce8da]">{burden.tiringMultiplier.toFixed(2)}×</strong>
              </span>
              <span className="text-[#9bb09a]">
                {t('packing.calorieBurn')}{' '}
                <strong className="text-[#dce8da]">
                  {burden.stomachDrainMultiplier.toFixed(2)}×
                </strong>
              </span>
            </div>
            <div className="text-[11px] text-[#8da38c]">
              {t('packing.hudNavigation')}{' '}
              <span className="text-[#d4e1d2]">{getNavigationSummary(selection)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider rounded bg-transparent hover:bg-white/5 text-[#a9baa8] border border-white/12 transition-colors cursor-pointer"
            >
              {t('packing.back')}
            </button>
            <button
              type="button"
              data-testid="packing-begin-btn"
              onClick={onBegin}
              className="px-6 py-2.5 text-xs font-semibold uppercase tracking-wider rounded bg-[#3b5a42] hover:bg-[#4b7254] text-[#f4f7f2] border border-[#72997a] transition-colors cursor-pointer"
            >
              {t('packing.begin')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
