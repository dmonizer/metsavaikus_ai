import React, { useMemo, useRef, useState } from 'react';
import { X, AlertTriangle, Trash2, Flame, Droplets, Utensils, BatteryCharging, Map as MapIcon, Tent, Moon, CloudRain, Scale } from 'lucide-react';
import {
  CAMPFIRE_WOOD_COST,
  computeClothingBonuses,
  getBottleWeightKg,
  getNavigationMode,
  InventoryState,
  isWearingItem,
  ITEM_CATALOG,
  ItemId,
  WaterBottleInstance,
} from '../game/itemCatalog';
import { PlayerSurvivalState } from '../game/survivalEngine';
import {
  getHypothermiaLabel,
  getItemDescription,
  getItemName,
  getItemSecondaryName,
  getLoadTierLabel,
  getNavigationModeLabel,
  getPoisonLabel,
  getStayingPowerLabel,
  useLanguage,
} from '../i18n/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ItemArtwork } from './ItemArtwork';

interface BackpackStatusDrawerProps {
  survival: PlayerSurvivalState;
  inventory: InventoryState;
  discoveredPercent: number;
  shelterLabel: string | null;
  nearLitFire: boolean;
  onClose: () => void;
  onDrinkBottle: (uid: string) => void;
  onEatItem: (itemId: ItemId) => void;
  onLoadBattery: () => void;
  onPlaceCampfire: () => void;
  onPitchTent: () => void;
  onSleepInBag: () => void;
  onToggleWearItem: (itemId: ItemId) => void;
  onOpenFullMap: () => void;
  onDropItem: (itemId: ItemId) => void;
  onDropBottle: (uid: string) => void;
  onDropBallast?: () => void;
}

type WheelSlot =
  | {
      key: string;
      kind: 'bottle';
      itemId: ItemId;
      bottle: WaterBottleInstance;
      badge: string;
      accent: 'water' | 'warn' | 'danger';
    }
  | {
      key: string;
      kind: 'food' | 'gear';
      itemId: ItemId;
      qty: number;
      badge: string;
      accent: 'food' | 'gear' | 'worn' | 'danger' | 'warn';
    }
  | {
      key: string;
      kind: 'ballast';
      ballastKg: number;
      badge: string;
      accent: 'warn' | 'water';
    };

function VitalRow({
  label,
  value,
  max = 100,
  displayText,
  barColor,
  subText,
}: {
  label: string;
  value: number;
  max?: number;
  displayText: string;
  barColor: string;
  subText?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-[#c5d4c4]">{label}</span>
        <span className="font-mono tabular-nums text-[#edf3ea]">{displayText}</span>
      </div>
      <div className="w-full h-1.5 bg-black/55 border border-white/10 rounded-sm overflow-hidden">
        <div
          className="h-full origin-left transition-transform duration-150"
          style={{
            transform: `scaleX(${(pct / 100).toFixed(3)})`,
            backgroundColor: barColor,
          }}
        />
      </div>
      {subText && <div className="text-[11px] text-[#8fa48e]">{subText}</div>}
    </div>
  );
}

/**
 * Generates an SVG annular sector path for the highlighted radial wheel wedge.
 */
function describeSectorPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number
): string {
  const x1 = cx + Math.cos(startAngle) * outerR;
  const y1 = cy + Math.sin(startAngle) * outerR;
  const x2 = cx + Math.cos(endAngle) * outerR;
  const y2 = cy + Math.sin(endAngle) * outerR;
  const x3 = cx + Math.cos(endAngle) * innerR;
  const y3 = cy + Math.sin(endAngle) * innerR;
  const x4 = cx + Math.cos(startAngle) * innerR;
  const y4 = cy + Math.sin(startAngle) * innerR;
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export const BackpackStatusDrawer: React.FC<BackpackStatusDrawerProps> = ({
  survival,
  inventory,
  discoveredPercent,
  shelterLabel,
  nearLitFire,
  onClose,
  onDrinkBottle,
  onEatItem,
  onLoadBattery,
  onPlaceCampfire,
  onPitchTent,
  onSleepInBag,
  onToggleWearItem,
  onOpenFullMap,
  onDropItem,
  onDropBottle,
  onDropBallast,
}) => {
  const { lang, t } = useLanguage();
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const slots = useMemo<WheelSlot[]>(() => {
    const list: WheelSlot[] = [];

    for (const b of inventory.bottles) {
      const empty = b.waterLiters <= 0.001;
      list.push({
        key: `bottle:${b.uid}`,
        kind: 'bottle',
        itemId: b.itemId,
        bottle: b,
        badge: empty ? '0L' : `${b.waterLiters.toFixed(1)}L`,
        accent: empty
          ? 'warn'
          : b.waterQuality === 'stale'
            ? 'danger'
            : b.waterQuality === 'bog'
              ? 'warn'
              : 'water',
      });
    }

    const foodEntries: Array<{ id: ItemId; qty: number }> = [];
    const gearEntries: Array<{ id: ItemId; qty: number }> = [];
    for (const [rawId, qty] of Object.entries(inventory.stacks)) {
      if (!qty || qty <= 0) continue;
      const id = rawId as ItemId;
      const def = ITEM_CATALOG[id];
      if (!def) continue;
      if (def.food) foodEntries.push({ id, qty });
      else gearEntries.push({ id, qty });
    }

    for (const { id, qty } of foodEntries) {
      const food = ITEM_CATALOG[id].food!;
      list.push({
        key: `stack:${id}`,
        kind: 'food',
        itemId: id,
        qty,
        badge: `×${qty}`,
        accent: food.poison ? 'danger' : 'food',
      });
    }

    for (const { id, qty } of gearEntries) {
      const def = ITEM_CATALOG[id];
      const worn = !!(def.clothing && isWearingItem(inventory, id));
      let badge = `×${qty}`;
      if (id === 'flashlight') badge = `${Math.round(inventory.flashlightBattery)}%`;
      else if (id === 'lighter') badge = `${inventory.lighterUses}`;
      else if (id === 'matches') badge = `${inventory.matchStrikes}`;
      else if (worn) badge = t('backpack.badgeWorn');
      list.push({
        key: `stack:${id}`,
        kind: 'gear',
        itemId: id,
        qty,
        badge,
        accent: worn ? 'worn' : 'gear',
      });
    }

    if (inventory.debugBallastKg && Math.abs(inventory.debugBallastKg) >= 0.01) {
      const kg = inventory.debugBallastKg;
      list.push({
        key: 'debug:ballast',
        kind: 'ballast',
        ballastKg: kg,
        badge: `${kg >= 0 ? '+' : ''}${kg.toFixed(1)}kg`,
        accent: kg < 0 ? 'water' : 'warn',
      });
    }

    return list;
  }, [inventory, t]);

  const activeIndex = useMemo(() => {
    if (slots.length === 0) return -1;
    if (selectedKey) {
      const found = slots.findIndex((s) => s.key === selectedKey);
      if (found >= 0) return found;
    }
    return 0;
  }, [slots, selectedKey]);

  const activeSlot = activeIndex >= 0 ? slots[activeIndex] : null;

  const WHEEL_SIZE = 468;
  const CX = WHEEL_SIZE / 2;
  const CY = WHEEL_SIZE / 2;
  const HUB_RADIUS = 122;
  const RING_RADIUS = 180;
  const OUTER_WEDGE_R = 224;
  const NODE_SIZE = slots.length > 12 ? 52 : slots.length > 9 ? 58 : 64;

  // Mouse movement over the radial ring continuously moves selection by polar angle;
  // entering the inner hub preserves current selection so buttons inside are effortless to click.
  const handleWheelMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (slots.length <= 1 || !wheelRef.current) return;
    const rect = wheelRef.current.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    const scaledHubR = (HUB_RADIUS / WHEEL_SIZE) * rect.width;
    if (dist < scaledHubR * 0.94) return;

    // 0 radians at top (-PI/2), clockwise 0..2PI
    let theta = Math.atan2(dy, dx) + Math.PI / 2;
    if (theta < 0) theta += Math.PI * 2;
    const step = (Math.PI * 2) / slots.length;
    const idx = Math.floor((theta + step / 2) / step) % slots.length;
    const nextSlot = slots[idx];
    if (nextSlot && nextSlot.key !== selectedKey) {
      setSelectedKey(nextSlot.key);
    }
  };

  const navMode = getNavigationMode(inventory);
  const hypoLabel = getHypothermiaLabel(survival.hypothermiaStage, lang);
  const burnDesc =
    survival.digestionBurnRate > 1.35
      ? t('backpack.burnFast')
      : survival.digestionBurnRate < 0.78
        ? t('backpack.burnSlow')
        : t('backpack.burnSteady');

  // Render active slot details & actions inside the center of the wheel
  const renderCenterHub = () => {
    if (!activeSlot) {
      return (
        <div className="flex flex-col items-center justify-center text-center px-4">
          <div className="text-sm font-medium text-[#b5c4b4]">{t('backpack.wheelEmpty')}</div>
          <div className="mt-1 text-[11px] text-[#7f947e]">{t('backpack.noFood')}</div>
        </div>
      );
    }

    if (activeSlot.kind === 'ballast') {
      const kg = activeSlot.ballastKg;
      const sign = kg >= 0 ? '+' : '';
      return (
        <div className="flex flex-col items-center text-center px-3 w-full">
          <Scale className="w-10 h-10 text-[#d8c182] shrink-0" />
          <div className="mt-1 text-sm font-semibold text-[#eef4ec] leading-tight">
            Debug Ballast
          </div>
          <div className="mt-0.5 font-mono tabular-nums text-[11px] text-[#e3cb8c]">
            {sign}
            {kg.toFixed(2)} kg
          </div>
          <div className="mt-1 text-[10.5px] text-[#98ac97] leading-snug line-clamp-2">
            {kg < 0
              ? 'Anti-gravity debug weight offsetting total pack burden.'
              : 'Calibration ballast weight added to backpack load.'}
          </div>
          {onDropBallast && (
            <div className="mt-2.5 flex items-center gap-1.5">
              <button
                type="button"
                data-testid="drop-btn-ballast"
                onClick={onDropBallast}
                className="px-3 py-1.5 text-xs rounded bg-[#18221c] hover:bg-[#2a1c19] border border-white/10 text-[#b4c4b3] hover:text-[#ebb1a4] flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove Ballast
              </button>
            </div>
          )}
        </div>
      );
    }

    const def = ITEM_CATALOG[activeSlot.itemId];
    const itemName = getItemName(activeSlot.itemId, lang);
    const secondary = getItemSecondaryName(activeSlot.itemId, lang);
    const itemDesc = getItemDescription(activeSlot.itemId, lang);

    if (activeSlot.kind === 'bottle') {
      const b = activeSlot.bottle;
      const wt = getBottleWeightKg(b);
      const empty = b.waterLiters <= 0.001;
      const qualityText = empty
        ? t('backpack.bottleEmpty')
        : b.waterQuality === 'clean'
          ? t('backpack.bottleClean', { temp: Math.round(b.waterTempC) })
          : b.waterQuality === 'stale'
            ? t('backpack.bottleStale', { temp: Math.round(b.waterTempC) })
            : t('backpack.bottleBog', { temp: Math.round(b.waterTempC) });

      return (
        <div className="flex flex-col items-center text-center px-3 w-full">
          <ItemArtwork
            itemId={b.itemId}
            waterFillRatio={b.waterLiters / Math.max(0.1, b.capacityLiters)}
            waterQuality={b.waterQuality}
            className="w-12 h-12 shrink-0"
          />
          <div className="mt-1 text-sm font-semibold text-[#eef4ec] leading-tight line-clamp-1">
            {itemName}
          </div>
          <div className="mt-0.5 font-mono tabular-nums text-[11px] text-[#9ac2d1]">
            {b.waterLiters.toFixed(2)} / {b.capacityLiters.toFixed(1)} L · {wt.toFixed(2)} kg
          </div>
          <div
            className={`mt-1 text-[11px] leading-snug line-clamp-2 ${
              b.waterQuality === 'stale' && !empty
                ? 'text-[#eb8b7a] font-medium'
                : b.waterQuality === 'bog' && !empty
                  ? 'text-[#deb772]'
                  : 'text-[#9cb19b]'
            }`}
          >
            {qualityText}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              data-testid={`drink-btn-${b.uid}`}
              disabled={empty}
              onClick={() => onDrinkBottle(b.uid)}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#274857] hover:bg-[#325d70] disabled:opacity-35 text-[#edf6fa] border border-[#6ca6bf]/45 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
            >
              <Droplets className="w-3.5 h-3.5" />
              {t('backpack.drinkSip')}
            </button>
            <button
              type="button"
              onClick={() => onDropBottle(b.uid)}
              aria-label={t('backpack.dropAria', { name: itemName })}
              title={t('backpack.drop')}
              className="p-1.5 rounded bg-[#18221c] hover:bg-[#2a1c19] border border-white/10 text-[#98aa97] hover:text-[#ebb1a4] cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    if (activeSlot.kind === 'food') {
      const food = def.food!;
      const isPoison = !!food.poison;
      const poisonTag =
        food.poison?.kind === 'destroying_angel'
          ? t('backpack.poisonLethal')
          : food.poison?.kind === 'fly_agaric'
            ? t('backpack.poisonVomiting')
            : t('backpack.poisonBitter');

      return (
        <div className="flex flex-col items-center text-center px-3 w-full">
          <ItemArtwork itemId={activeSlot.itemId} className="w-12 h-12 shrink-0" />
          <div className="mt-1 text-sm font-semibold text-[#eef4ec] leading-tight line-clamp-1">
            {itemName}{' '}
            <span className="font-mono text-xs text-[#d6c294]">×{activeSlot.qty}</span>
          </div>
          {secondary && (
            <div className="text-[10px] italic text-[#8da38c] leading-none mt-0.5">
              {secondary}
            </div>
          )}
          <div className="mt-1 font-mono tabular-nums text-[10px] text-[#a7bca6]">
            {t('packing.fill', { pct: food.fullness })} ·{' '}
            {t('backpack.stay', { power: getStayingPowerLabel(food.stayingPower, lang) })} ·{' '}
            {(def.weightKg * activeSlot.qty).toFixed(2)} kg
          </div>
          {isPoison ? (
            <div className="mt-1 text-[11px] font-semibold text-[#eb8b7a]">{poisonTag}</div>
          ) : (
            <div className="mt-1 text-[10.5px] text-[#98ac97] leading-snug line-clamp-2">
              {itemDesc}
            </div>
          )}

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              data-testid={`eat-btn-${activeSlot.itemId}`}
              onClick={() => onEatItem(activeSlot.itemId)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded border flex items-center gap-1.5 cursor-pointer ${
                isPoison
                  ? 'bg-[#4f261f] hover:bg-[#663128] text-[#fdebe7] border-[#b86657]/55'
                  : 'bg-[#35523b] hover:bg-[#44684c] text-[#f2f7f1] border-[#6d9674]/55'
              }`}
            >
              <Utensils className="w-3.5 h-3.5" />
              {t('backpack.eat')}
            </button>
            <button
              type="button"
              data-testid={`drop-btn-${activeSlot.itemId}`}
              onClick={() => onDropItem(activeSlot.itemId)}
              aria-label={t('backpack.dropAria', { name: itemName })}
              title={t('backpack.drop')}
              className="p-1.5 rounded bg-[#18221c] hover:bg-[#2a1c19] border border-white/10 text-[#98aa97] hover:text-[#ebb1a4] cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    // Gear / camp / clothing item
    const isWorn = !!(def.clothing && isWearingItem(inventory, activeSlot.itemId));
    let extra = '';
    if (activeSlot.itemId === 'flashlight') {
      extra = t('backpack.battery', { pct: Math.round(inventory.flashlightBattery) });
    } else if (activeSlot.itemId === 'lighter') {
      extra = t('backpack.lighterLeft', { count: inventory.lighterUses });
    } else if (activeSlot.itemId === 'matches') {
      extra = t('backpack.matchesLeft', { count: inventory.matchStrikes });
    } else if (def.sleepGear) {
      extra = t('backpack.sleepWarmthBonus', {
        temp: def.sleepGear.outdoorWarmthBonusC.toFixed(1),
      });
    } else if (def.clothing) {
      extra = isWorn ? t('backpack.statusWorn') : t('backpack.statusInPack');
    }

    return (
      <div className="flex flex-col items-center text-center px-3 w-full">
        <ItemArtwork itemId={activeSlot.itemId} className="w-12 h-12 shrink-0" />
        <div className="mt-1 text-sm font-semibold text-[#eef4ec] leading-tight line-clamp-1">
          {itemName}{' '}
          <span className="font-mono text-xs text-[#a8bba7]">×{activeSlot.qty}</span>
        </div>
        <div className="mt-0.5 font-mono tabular-nums text-[10.5px] text-[#9eb29d]">
          {(def.weightKg * activeSlot.qty).toFixed(2)} kg{extra ? ` · ${extra}` : ''}
        </div>
        <div className="mt-1 text-[10.5px] text-[#98ac97] leading-snug line-clamp-2">
          {itemDesc}
        </div>

        <div className="mt-2.5 flex items-center gap-1.5">
          {activeSlot.itemId === 'firewood' && (
            <button
              type="button"
              data-testid="place-campfire-btn"
              disabled={activeSlot.qty < CAMPFIRE_WOOD_COST}
              onClick={onPlaceCampfire}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#5c3d22] hover:bg-[#734d2c] disabled:opacity-40 text-[#fcecd9] border border-[#b57d47]/55 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
            >
              <Flame className="w-3.5 h-3.5" />
              {t('backpack.placeCampfire', { cost: CAMPFIRE_WOOD_COST })}
            </button>
          )}
          {activeSlot.itemId === 'tent' && (
            <button
              type="button"
              data-testid="pitch-tent-btn"
              onClick={onPitchTent}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#2d4a34] hover:bg-[#3a6043] text-[#eef5ec] border border-[#729e7a]/55 flex items-center gap-1.5 cursor-pointer"
            >
              <Tent className="w-3.5 h-3.5" />
              {t('backpack.pitchTent')}
            </button>
          )}
          {activeSlot.itemId === 'sleeping_bag' && (
            <button
              type="button"
              data-testid="sleep-in-bag-btn"
              onClick={onSleepInBag}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#522e26] hover:bg-[#693b31] text-[#f9ece7] border border-[#b86d5c]/55 flex items-center gap-1.5 cursor-pointer"
            >
              <Moon className="w-3.5 h-3.5" />
              {t('backpack.sleepInBag')}
            </button>
          )}
          {def.clothing && (
            <button
              type="button"
              data-testid="toggle-rain-jacket-btn"
              onClick={() => onToggleWearItem(activeSlot.itemId)}
              className={`px-3 py-1.5 text-xs font-medium rounded border flex items-center gap-1.5 cursor-pointer ${
                isWorn
                  ? 'bg-[#4f3d1d] hover:bg-[#664f25] text-[#f9eed6] border-[#d9aa4e]/60'
                  : 'bg-[#2a4a3a] hover:bg-[#365f4b] text-[#eef6f1] border-[#6ca889]/55'
              }`}
            >
              <CloudRain className="w-3.5 h-3.5" />
              {isWorn ? t('backpack.takeOffItem') : t('backpack.wearItem')}
            </button>
          )}
          {activeSlot.itemId === 'paper_map' && (
            <button
              type="button"
              data-testid="open-full-map-from-pack-btn"
              onClick={onOpenFullMap}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#274031] hover:bg-[#335340] text-[#eef5ec] border border-[#729c7a]/55 flex items-center gap-1.5 cursor-pointer"
            >
              <MapIcon className="w-3.5 h-3.5" />
              {t('backpack.openFullMap')}
            </button>
          )}
          {activeSlot.itemId === 'extra_battery' && (inventory.stacks.flashlight ?? 0) > 0 && (
            <button
              type="button"
              onClick={onLoadBattery}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#364d3b] hover:bg-[#46634c] text-[#eef5ec] border border-[#6e9476]/50 flex items-center gap-1.5 cursor-pointer"
            >
              <BatteryCharging className="w-3.5 h-3.5" />
              {t('backpack.loadBattery')}
            </button>
          )}
          <button
            type="button"
            data-testid={`drop-btn-${activeSlot.itemId}`}
            onClick={() => onDropItem(activeSlot.itemId)}
            aria-label={t('backpack.dropAria', { name: itemName })}
            title={t('backpack.drop')}
            className="px-2.5 py-1.5 text-xs rounded bg-[#18221c] hover:bg-[#2a1c19] border border-white/10 text-[#b4c4b3] hover:text-[#ebb1a4] flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('backpack.drop')}
          </button>
        </div>
      </div>
    );
  };

  // Highlighted radial wedge geometry
  const stepAngle = slots.length > 0 ? (Math.PI * 2) / slots.length : Math.PI * 2;
  const activeStartAngle =
    activeIndex >= 0 ? -Math.PI / 2 + activeIndex * stepAngle - stepAngle / 2 : 0;
  const activeEndAngle = activeStartAngle + stepAngle;

  return (
    <div
      data-testid="backpack-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={t('backpack.ariaLabel')}
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#070b09]/76 p-4 md:p-6"
    >
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-[#0e1511] border border-white/12 rounded-lg overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.65)]">
        {/* Top Bar */}
        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-[#ecf3e8] tracking-wide">
              {t('backpack.title')}
            </h2>
            <div className="text-[11px] font-mono tabular-nums text-[#95aa94] mt-0.5">
              {t('backpack.summary', {
                kg: survival.backpackWeightKg.toFixed(2),
                tier: getLoadTierLabel(survival.loadTier, lang),
                tiring: survival.tiringMultiplier.toFixed(2),
                cal: survival.stomachDrainMultiplier.toFixed(2),
                pct: discoveredPercent,
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <button
              type="button"
              data-testid="backpack-close-btn"
              onClick={onClose}
              aria-label={t('backpack.closeAria')}
              className="w-8 h-8 flex items-center justify-center rounded bg-[#16211a] hover:bg-[#223227] border border-white/10 text-[#d0ddd0] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Two-Column Body: Physiology Left + Circular Radial Wheel Right */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-white/10">
          {/* Left: Physiology Diagnostics */}
          <div className="lg:col-span-4 p-5 space-y-3 bg-[#0b110d]">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#8ea48d] font-semibold">
              {t('backpack.physiology')}
            </div>

            <VitalRow
              label={t('backpack.health')}
              value={survival.health}
              displayText={`${Math.round(survival.health)}%`}
              barColor={survival.health < 35 ? '#d96b59' : '#7fb382'}
            />
            <VitalRow
              label={t('backpack.energy')}
              value={survival.energy}
              displayText={`${Math.round(survival.energy)}%`}
              barColor={survival.energy < 25 ? '#d6a45b' : '#94be8b'}
              subText={t('backpack.energySub', { hours: survival.awakeHours.toFixed(1) })}
            />
            <VitalRow
              label={t('backpack.hydration')}
              value={survival.hydration}
              displayText={`${Math.round(survival.hydration)}%`}
              barColor={survival.hydration < 25 ? '#d97c59' : '#69a7c2'}
              subText={
                survival.waterStomachLoadL > 0.45
                  ? t('backpack.hydrationHeavy', {
                      kg: (survival.waterStomachLoadL * 1.45).toFixed(1),
                    })
                  : t('backpack.hydrationSub')
              }
            />
            <VitalRow
              label={t('backpack.stomachFullness')}
              value={survival.stomachFullness}
              displayText={`${Math.round(survival.stomachFullness)}%`}
              barColor={survival.stomachFullness < 22 ? '#d68356' : '#c7a467'}
              subText={`${burnDesc} (${survival.digestionBurnRate.toFixed(2)}×)`}
            />
            <VitalRow
              label={t('backpack.physicalTiredness')}
              value={survival.physicalTiredness}
              displayText={`${Math.round(survival.physicalTiredness)}%`}
              barColor={survival.physicalTiredness > 75 ? '#d98a5b' : '#a49b76'}
              subText={
                survival.physicalTiredness > 70 ? t('backpack.tiredHigh') : t('backpack.tiredSub')
              }
            />

            <div className="pt-2 border-t border-white/10 space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-[#9bb09a]">{t('backpack.coreTemp')}</span>
                <span
                  data-testid="drawer-body-temp"
                  className={`font-mono tabular-nums font-medium text-right ${
                    survival.bodyTempC < 35.0
                      ? 'text-[#7ac5e0]'
                      : survival.bodyTempC < 35.8
                        ? 'text-[#a5d2e3]'
                        : 'text-[#e8efe5]'
                  }`}
                >
                  {survival.bodyTempC.toFixed(1)}°C · {hypoLabel}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#9bb09a]">{t('backpack.feelsLike')}</span>
                <span className="font-mono tabular-nums text-[#d6e2d4]">
                  {survival.feelsLikeC.toFixed(1)}°C
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#9bb09a]">{t('backpack.wetness')}</span>
                <span className="font-mono tabular-nums text-[#d6e2d4]">
                  {Math.round(survival.wetness)}%
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#9bb09a]">{t('backpack.shelter')}</span>
                <span className="text-[#d6e2d4] text-right">
                  {nearLitFire
                    ? t('backpack.shelterFire')
                    : shelterLabel
                      ? t('backpack.shelterInside', { label: shelterLabel })
                      : t('backpack.shelterOutdoor')}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#9bb09a]">{t('backpack.rainGear')}</span>
                <span
                  data-testid="drawer-rain-gear"
                  className={
                    computeClothingBonuses(inventory).rainResistance > 0
                      ? 'text-[#ecc572] font-medium'
                      : 'text-[#8ea48d]'
                  }
                >
                  {computeClothingBonuses(inventory).rainResistance > 0
                    ? t('backpack.rainGearWorn', {
                        pct: Math.round(computeClothingBonuses(inventory).rainResistance * 100),
                      })
                    : t('backpack.rainGearNone')}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#9bb09a]">{t('backpack.navigationAid')}</span>
                <span className="text-[#d6e2d4]">
                  {getNavigationModeLabel(navMode, lang)}
                </span>
              </div>
            </div>

            {survival.poisons.length > 0 && (
              <div className="rounded border border-[#b34c3c]/55 bg-[#26120f] p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#f09b8c]">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('backpack.activePoison')}
                </div>
                {survival.poisons.map((p, idx) => (
                  <div key={`${p.kind}-${idx}`} className="text-[11px] text-[#e8c1b8]">
                    {t('backpack.poisonRemaining', {
                      label: getPoisonLabel(p.kind, lang),
                      hours: p.remainingHours.toFixed(1),
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Circular Radial Backpack Wheel */}
          <div className="lg:col-span-8 p-4 md:p-5 flex flex-col items-center justify-center bg-[#0d1410]">
            <div className="w-full flex items-center justify-between text-[11px] text-[#8da38c] mb-2 px-1">
              <span>{t('backpack.wheelHint')}</span>
              <span className="font-mono tabular-nums text-[#b5c7b4]">
                {t('backpack.wheelItemsCount', { count: slots.length })}
              </span>
            </div>

            <div
              ref={wheelRef}
              data-testid="radial-wheel"
              onMouseMove={handleWheelMouseMove}
              className="relative select-none"
              style={{ width: `${WHEEL_SIZE}px`, height: `${WHEEL_SIZE}px`, maxWidth: '100%' }}
            >
              {/* Concentric Radial Dial & Active Sector Wedge SVG */}
              <svg
                viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
                className="absolute inset-0 w-full h-full pointer-events-none"
                aria-hidden="true"
              >
                {/* Outer Ring Track */}
                <circle
                  cx={CX}
                  cy={CY}
                  r={OUTER_WEDGE_R}
                  fill="#0a100c"
                  stroke="rgba(255,255,255,0.10)"
                  strokeWidth="1.5"
                />
                <circle
                  cx={CX}
                  cy={CY}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="rgba(165,195,163,0.12)"
                  strokeWidth="1"
                  strokeDasharray="4 5"
                />

                {/* Radial sector dividers */}
                {slots.length > 1 &&
                  slots.map((s, idx) => {
                    const a = -Math.PI / 2 + idx * stepAngle - stepAngle / 2;
                    return (
                      <line
                        key={s.key}
                        x1={CX + Math.cos(a) * HUB_RADIUS}
                        y1={CY + Math.sin(a) * HUB_RADIUS}
                        x2={CX + Math.cos(a) * OUTER_WEDGE_R}
                        y2={CY + Math.sin(a) * OUTER_WEDGE_R}
                        stroke="rgba(255,255,255,0.06)"
                        strokeWidth="1"
                      />
                    );
                  })}

                {/* Active Highlighted Sector Wedge */}
                {activeSlot && slots.length > 1 && (
                  <path
                    d={describeSectorPath(
                      CX,
                      CY,
                      HUB_RADIUS,
                      OUTER_WEDGE_R - 1,
                      activeStartAngle,
                      activeEndAngle
                    )}
                    fill="rgba(79, 122, 88, 0.24)"
                    stroke="rgba(143, 192, 146, 0.55)"
                    strokeWidth="1.5"
                  />
                )}
                {activeSlot && slots.length === 1 && (
                  <circle
                    cx={CX}
                    cy={CY}
                    r={(HUB_RADIUS + OUTER_WEDGE_R) / 2}
                    fill="none"
                    stroke="rgba(143, 192, 146, 0.35)"
                    strokeWidth={OUTER_WEDGE_R - HUB_RADIUS}
                  />
                )}
              </svg>

              {/* Circular Item Picture Nodes around the Wheel */}
              {slots.map((slot, idx) => {
                const angle = -Math.PI / 2 + idx * stepAngle;
                const x = CX + Math.cos(angle) * RING_RADIUS;
                const y = CY + Math.sin(angle) * RING_RADIUS;
                const isSelected = idx === activeIndex;
                const itemName =
                  slot.kind === 'ballast' ? 'Debug Ballast' : getItemName(slot.itemId, lang);

                const borderCls = isSelected
                  ? 'border-[#9ad09e] bg-[#1e3224] shadow-[0_0_18px_rgba(127,179,130,0.38)] scale-110 z-20'
                  : slot.accent === 'worn'
                    ? 'border-[#ddb055]/85 bg-[#292213] hover:border-[#f0c76e] z-10'
                    : slot.accent === 'danger'
                      ? 'border-[#b05646]/60 bg-[#1c1311] hover:border-[#d67563] z-10'
                      : slot.accent === 'warn'
                        ? 'border-[#c49c4f]/65 bg-[#211b11] hover:border-[#e8be6b] z-10'
                        : slot.accent === 'water'
                          ? 'border-[#5c94ad]/50 bg-[#101c21] hover:border-[#85bfd6] z-10'
                          : 'border-white/14 bg-[#121c16] hover:border-white/35 z-10';

                return (
                  <button
                    key={slot.key}
                    type="button"
                    data-testid={
                      slot.kind === 'bottle'
                        ? `wheel-node-${slot.bottle.uid}`
                        : slot.kind === 'ballast'
                          ? 'wheel-node-ballast'
                          : `wheel-node-${slot.itemId}`
                    }
                    aria-label={itemName}
                    aria-pressed={isSelected}
                    title={itemName}
                    onMouseEnter={() => setSelectedKey(slot.key)}
                    onClick={() => setSelectedKey(slot.key)}
                    style={{
                      left: `${x}px`,
                      top: `${y}px`,
                      width: `${NODE_SIZE}px`,
                      height: `${NODE_SIZE}px`,
                    }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 flex items-center justify-center transition-transform duration-120 cursor-pointer ${borderCls}`}
                  >
                    {slot.kind === 'ballast' ? (
                      <Scale className={slots.length > 12 ? 'w-6 h-6 text-[#e3cb8c]' : 'w-8 h-8 text-[#e3cb8c]'} />
                    ) : (
                      <ItemArtwork
                        itemId={slot.itemId}
                        waterFillRatio={
                          slot.kind === 'bottle'
                            ? slot.bottle.waterLiters / Math.max(0.1, slot.bottle.capacityLiters)
                            : 1
                        }
                        waterQuality={slot.kind === 'bottle' ? slot.bottle.waterQuality : 'clean'}
                        className={slots.length > 12 ? 'w-8 h-8' : 'w-10 h-10'}
                      />
                    )}
                    <span className="absolute -bottom-1.5 right-0 px-1.5 py-0.25 rounded bg-[#090f0b] border border-white/15 font-mono tabular-nums text-[9.5px] font-semibold text-[#e6efe4] leading-tight">
                      {slot.badge}
                    </span>
                  </button>
                );
              })}

              {/* Center Hub: Selected Item Description & Actions */}
              <div
                data-testid="wheel-center-hub"
                style={{
                  width: `${HUB_RADIUS * 2 - 6}px`,
                  height: `${HUB_RADIUS * 2 - 6}px`,
                }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0e1611] border border-white/16 shadow-[inset_0_0_28px_rgba(0,0,0,0.65)] flex items-center justify-center z-30"
              >
                {renderCenterHub()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
