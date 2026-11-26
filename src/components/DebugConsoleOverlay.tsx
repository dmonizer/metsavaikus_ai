import React, { useMemo, useState } from 'react';
import {
  Activity,
  Backpack,
  Clock,
  Compass,
  Crosshair,
  Eye,
  HeartPulse,
  MapPin,
  Pause,
  Play,
  Plus,
  Minus,
  Radio,
  Shield,
  Sparkles,
  Trash2,
  Wind,
  X,
} from 'lucide-react';
import {
  buildSpawnCatalog,
  DebugActions,
  DebugEventSource,
  DebugSnapshot,
  SpawnCategory,
} from '../game/debugTypes';
import { ITEM_CATALOG, ItemId, WaterQuality } from '../game/itemCatalog';
import { DEFAULT_WEIGHT_THRESHOLDS } from '../game/survivalEngine';
import type { WeatherId } from '../world/weatherAndSky';

interface DebugConsoleOverlayProps {
  open: boolean;
  snapshot: DebugSnapshot | null;
  actions: DebugActions | null;
  onClose: () => void;
}

type DebugTab =
  | 'inspector'
  | 'vitals'
  | 'pack'
  | 'spawn'
  | 'time'
  | 'events'
  | 'perf'
  | 'map';

const SPAWN_CATALOG = buildSpawnCatalog();

const TAB_DEFS: Array<{ id: DebugTab; label: string; icon: React.ReactNode }> = [
  { id: 'inspector', label: 'Inspect', icon: <Crosshair className="w-3.5 h-3.5" /> },
  { id: 'vitals', label: 'Vitals', icon: <HeartPulse className="w-3.5 h-3.5" /> },
  { id: 'pack', label: 'Pack', icon: <Backpack className="w-3.5 h-3.5" /> },
  { id: 'spawn', label: 'Spawn', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { id: 'time', label: 'Time', icon: <Clock className="w-3.5 h-3.5" /> },
  { id: 'events', label: 'Events', icon: <Radio className="w-3.5 h-3.5" /> },
  { id: 'perf', label: 'Perf', icon: <Activity className="w-3.5 h-3.5" /> },
  { id: 'map', label: 'Map/TP', icon: <Compass className="w-3.5 h-3.5" /> },
];

function buildPolylinePoints(
  values: number[],
  width: number,
  height: number,
  maxVal: number
): string {
  if (values.length === 0) return '';
  if (values.length === 1) {
    const y = height - Math.min(1, Math.max(0, values[0] / maxVal)) * (height - 6) - 3;
    return `0,${y.toFixed(1)} ${width},${y.toFixed(1)}`;
  }
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const norm = Math.min(1, Math.max(0, v / maxVal));
      const y = height - norm * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export const DebugConsoleOverlay: React.FC<DebugConsoleOverlayProps> = ({
  open,
  snapshot,
  actions,
  onClose,
}) => {
  const [tab, setTab] = useState<DebugTab>('inspector');
  const [spawnFilter, setSpawnFilter] = useState('');
  const [spawnCat, setSpawnCat] = useState<'all' | SpawnCategory>('all');
  const [spawnScale, setSpawnScale] = useState(1.0);
  const [spawnFeedback, setSpawnFeedback] = useState<string | null>(null);
  const [packFilter, setPackFilter] = useState('');
  const [eventSourceFilter, setEventSourceFilter] = useState<'all' | DebugEventSource>('all');
  const [eventTextFilter, setEventTextFilter] = useState('');
  const [tpX, setTpX] = useState('0');
  const [tpZ, setTpZ] = useState('0');
  const [copiedDump, setCopiedDump] = useState(false);

  const filteredSpawn = useMemo(() => {
    const q = spawnFilter.trim().toLowerCase();
    return SPAWN_CATALOG.filter((entry) => {
      if (spawnCat !== 'all' && entry.category !== spawnCat) return false;
      if (!q) return true;
      return (
        entry.label.toLowerCase().includes(q) ||
        entry.sublabel.toLowerCase().includes(q) ||
        entry.id.toLowerCase().includes(q)
      );
    });
  }, [spawnFilter, spawnCat]);

  const filteredItems = useMemo(() => {
    const q = packFilter.trim().toLowerCase();
    return Object.values(ITEM_CATALOG).filter((def) => {
      if (!q) return true;
      return (
        def.name.toLowerCase().includes(q) ||
        def.id.toLowerCase().includes(q) ||
        def.category.toLowerCase().includes(q)
      );
    });
  }, [packFilter]);

  const filteredEvents = useMemo(() => {
    const evs = snapshot?.events ?? [];
    const q = eventTextFilter.trim().toLowerCase();
    const res = evs.filter((ev) => {
      if (eventSourceFilter !== 'all' && ev.source !== eventSourceFilter) return false;
      if (!q) return true;
      return (
        ev.type.toLowerCase().includes(q) ||
        ev.summary.toLowerCase().includes(q) ||
        ev.source.toLowerCase().includes(q)
      );
    });
    return res.slice().reverse();
  }, [snapshot?.events, eventSourceFilter, eventTextFilter]);

  if (!open || !snapshot || !actions) return null;

  const activeHit =
    snapshot.pickTargetActive && snapshot.pickedHit
      ? snapshot.pickedHit
      : snapshot.centerHit ?? snapshot.pickedHit;

  const handleSpawn = (spawnId: string, mode: 'in_front' | 'picked') => {
    actions.setSelectedSpawnId(spawnId);
    const res = actions.spawnEntry(spawnId, mode, { scale: spawnScale });
    setSpawnFeedback(res.message);
  };

  const handleCopyDump = () => {
    const txt = actions.dumpPerfText();
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(txt);
    }
    setCopiedDump(true);
    window.setTimeout(() => setCopiedDump(false), 1800);
  };

  const perf = snapshot.perf;
  const history = perf?.history ?? [];
  const fpsValues = history.map((h) => h.fps);
  const frameMsValues = history.map((h) => h.rawDtMs);
  const maxFrameMs = Math.max(33.3, ...frameMsValues);

  const subsystems = perf
    ? [
        { label: 'Render / WebGL', ms: perf.renderMs, color: 'bg-emerald-400' },
        { label: 'Terrain Chunks', ms: perf.terrainMs, color: 'bg-amber-400' },
        { label: 'Vegetation / Grass', ms: perf.vegMs, color: 'bg-lime-400' },
        { label: 'Sky & Weather', ms: perf.skyMs, color: 'bg-sky-400' },
        { label: 'Props & Raycast', ms: perf.propsMs, color: 'bg-orange-400' },
        { label: 'Player & Physics', ms: perf.playerMs, color: 'bg-cyan-400' },
        { label: 'Minimap 2D', ms: perf.minimapMs, color: 'bg-violet-400' },
        { label: 'GPU Sync / ExtWait', ms: perf.externalWaitMs, color: 'bg-rose-400' },
      ]
    : [];
  const totalBudgetRefMs = Math.max(16.6, perf?.rawDtMs ?? 16.6);

  return (
    <div
      data-testid="debug-console-overlay"
      className="fixed top-4 left-4 z-40 w-[572px] max-w-[95vw] h-[calc(100vh-2rem)] flex flex-col rounded-lg bg-[#090e0b]/95 border border-[#6e997a]/45 shadow-[0_22px_55px_rgba(0,0,0,0.78)] text-[#e5eee3] select-text"
    >
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#9ec79f]">
              Developer Console
            </span>
            <span className="px-1.5 py-0.5 rounded bg-white/8 text-[10px] font-mono text-[#c4d8c3]">
              F8
            </span>
            <span
              data-testid="debug-clock-readout"
              className="text-[11px] font-mono tabular-nums text-[#f0dfb4]"
            >
              Day {snapshot.simDay} · {snapshot.simTimeStr}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close developer console"
          className="w-7 h-7 flex items-center justify-center rounded bg-white/6 hover:bg-white/12 text-[#c9d7c7] cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Global Live Controls Bar */}
      <div className="px-3.5 py-2 border-b border-white/10 bg-[#0d1410] flex flex-wrap items-center gap-1.5 text-[11px]">
        <button
          type="button"
          data-testid="debug-pause-toggle-btn"
          onClick={() => actions.setSimPaused(!snapshot.simPaused)}
          className={`px-2.5 py-1 rounded border font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer ${
            snapshot.simPaused
              ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
              : 'bg-[#17231c] border-white/12 text-[#d5e3d4] hover:bg-[#213328]'
          }`}
        >
          {snapshot.simPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          {snapshot.simPaused ? 'Resume Sim' : 'Pause Sim'}
        </button>

        <button
          type="button"
          data-testid="debug-overlay-toggle-btn"
          onClick={() => actions.setOverlayEnabled(!snapshot.overlayEnabled)}
          className={`px-2.5 py-1 rounded border font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer ${
            snapshot.overlayEnabled
              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
              : 'bg-[#17231c] border-white/12 text-[#d5e3d4] hover:bg-[#213328]'
          }`}
        >
          <Eye className="w-3 h-3" />
          Overlay {snapshot.overlayEnabled ? 'ON' : 'OFF'}
        </button>

        <button
          type="button"
          data-testid="debug-pick-target-btn"
          onClick={() => actions.setPickTargetActive(!snapshot.pickTargetActive)}
          className={`px-2.5 py-1 rounded border font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer ${
            snapshot.pickTargetActive
              ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
              : 'bg-[#17231c] border-white/12 text-[#d5e3d4] hover:bg-[#213328]'
          }`}
        >
          <Crosshair className="w-3 h-3" />
          Pick Target {snapshot.pickTargetActive ? 'ON' : 'OFF'}
        </button>

        <button
          type="button"
          data-testid="debug-godmode-toggle-btn"
          onClick={() => actions.setGodMode(!snapshot.godMode)}
          className={`px-2.5 py-1 rounded border font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer ${
            snapshot.godMode
              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
              : 'bg-[#17231c] border-white/12 text-[#d5e3d4] hover:bg-[#213328]'
          }`}
        >
          <Shield className="w-3 h-3" />
          God {snapshot.godMode ? 'ON' : 'OFF'}
        </button>

        <span className="ml-auto font-mono tabular-nums text-[10.5px] text-[#9eb49d]">
          {perf ? `${Math.round(perf.fpsEma)} FPS` : '—'} · {snapshot.clockSpeedMultiplier}x
        </span>
      </div>

      {/* Tabs */}
      <div className="px-2.5 pt-2 border-b border-white/10 flex items-center gap-1 overflow-x-auto">
        {TAB_DEFS.map((tdef) => (
          <button
            key={tdef.id}
            type="button"
            data-testid={`debug-tab-${tdef.id}`}
            onClick={() => setTab(tdef.id)}
            className={`px-2.5 py-1.5 rounded-t text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer border-b-2 transition-colors ${
              tab === tdef.id
                ? 'bg-[#16231b] border-[#83bc89] text-[#eff6ed]'
                : 'border-transparent text-[#96ab95] hover:text-[#dbe8d9] hover:bg-white/5'
            }`}
          >
            {tdef.icon}
            {tdef.label}
          </button>
        ))}
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
        {/* ================= INSPECTOR TAB ================= */}
        {tab === 'inspector' && (
          <div className="space-y-3">
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                  Cursor / Aim Target Inspector
                </span>
                <span className="text-[10.5px] font-mono text-[#9bb09a]">
                  {snapshot.pickTargetActive
                    ? 'Click viewport to inspect point'
                    : 'Tracking center reticle'}
                </span>
              </div>

              {activeHit ? (
                <div className="space-y-2 font-mono tabular-nums text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-[#1a2b20] border border-[#5d8767]/40 text-[#b7e2ba] uppercase text-[10px]">
                      {activeHit.layer}
                    </span>
                    <span className="text-xs font-sans font-semibold text-[#f3f8f1] truncate flex-1">
                      {activeHit.name}
                    </span>
                    <span className="text-[#9bb09a]">{activeHit.distanceM.toFixed(2)}m</span>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-black/25 rounded p-2">
                    <div className="text-[#8ea38d]">Hit Point (X, Y, Z)</div>
                    <div className="text-right">
                      {activeHit.point.x.toFixed(2)}, {activeHit.point.y.toFixed(2)},{' '}
                      {activeHit.point.z.toFixed(2)}
                    </div>
                    <div className="text-[#8ea38d]">Terrain Y / Slope</div>
                    <div className="text-right">
                      {activeHit.terrainY.toFixed(2)}m / {activeHit.slopeDeg.toFixed(1)}°
                    </div>
                    <div className="text-[#8ea38d]">Surface Material</div>
                    <div className="text-right">{activeHit.surfaceMaterial}</div>
                    <div className="text-[#8ea38d]">Water Depth / Basin</div>
                    <div className="text-right">
                      {activeHit.waterDepthM.toFixed(2)}m ({activeHit.inWaterBasin ? 'Bog' : 'Dry'})
                    </div>
                    <div className="text-[#8ea38d]">Road Distance</div>
                    <div className="text-right">{activeHit.roadDistanceM.toFixed(1)}m</div>
                    <div className="text-[#8ea38d]">Shelter / Campfire</div>
                    <div className="text-right">
                      {activeHit.shelterLabel ?? activeHit.shelterQuality} ·{' '}
                      {Math.round(activeHit.nearCampfireFactor * 100)}%
                    </div>
                  </div>

                  {activeHit.biomeWeights.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {activeHit.biomeWeights.map((bw) => (
                        <span
                          key={bw.id}
                          className="px-1.5 py-0.5 rounded bg-white/6 text-[10px] text-[#cfe0ce]"
                        >
                          {bw.label}: {Math.round(bw.weight * 100)}%
                        </span>
                      ))}
                    </div>
                  )}

                  {Object.keys(activeHit.meta).length > 0 && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-white/10 pt-1.5 text-[10.5px]">
                      {Object.entries(activeHit.meta).map(([k, v]) => (
                        <React.Fragment key={k}>
                          <span className="text-[#879b86]">{k}</span>
                          <span className="text-right text-[#dce8da] truncate">{String(v)}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        actions.teleportTo(
                          activeHit.point.x,
                          activeHit.point.z,
                          `Hit (${activeHit.point.x.toFixed(0)}, ${activeHit.point.z.toFixed(0)})`
                        )
                      }
                      className="px-2.5 py-1 rounded bg-[#1d2e23] hover:bg-[#2a4233] border border-white/12 text-[#e6efe5] cursor-pointer whitespace-nowrap"
                    >
                      Teleport to Hit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSpawn(snapshot.selectedSpawnId, 'picked')}
                      className="px-2.5 py-1 rounded bg-[#1d2e23] hover:bg-[#2a4233] border border-white/12 text-[#e6efe5] cursor-pointer whitespace-nowrap"
                    >
                      Spawn Selected Here
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[#8fa38e]">
                  No raycast target in range. Enable Pick Target and click ground, water, trees, or structures.
                </div>
              )}
            </div>

            {/* Player Sandbox Movement & Cheats */}
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                Player State & Traversal Cheats
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => actions.setGodMode(!snapshot.godMode)}
                  className={`px-3 py-1.5 rounded border text-xs font-medium cursor-pointer whitespace-nowrap ${
                    snapshot.godMode
                      ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                      : 'bg-[#17231c] border-white/12 text-[#d5e3d4]'
                  }`}
                >
                  God Mode: {snapshot.godMode ? 'ACTIVE' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => actions.setNoClip(!snapshot.noClip)}
                  className={`px-3 py-1.5 rounded border text-xs font-medium cursor-pointer whitespace-nowrap ${
                    snapshot.noClip
                      ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                      : 'bg-[#17231c] border-white/12 text-[#d5e3d4]'
                  }`}
                >
                  No-Clip / Fly: {snapshot.noClip ? 'ACTIVE (Space/C)' : 'OFF'}
                </button>
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#17231c] border border-white/12 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={snapshot.autoSpawnOnPick}
                    onChange={(e) => actions.setAutoSpawnOnPick(e.target.checked)}
                    className="accent-[#7fb382]"
                  />
                  <span>Auto-spawn on Pick Click</span>
                </label>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#a9bca8]">Walk Speed Multiplier</span>
                  <span className="font-mono tabular-nums text-[#eef5ec]">
                    {snapshot.moveSpeedMultiplier.toFixed(2)}x
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0.25}
                    max={6}
                    step={0.25}
                    value={snapshot.moveSpeedMultiplier}
                    onChange={(e) => actions.setMoveSpeedMultiplier(parseFloat(e.target.value))}
                    className="flex-1 accent-[#7fb382]"
                  />
                  {[0.5, 1, 2, 4].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => actions.setMoveSpeedMultiplier(m)}
                      className={`px-2 py-0.5 rounded border font-mono text-[10.5px] cursor-pointer ${
                        Math.abs(snapshot.moveSpeedMultiplier - m) < 0.05
                          ? 'bg-[#2d4834] border-[#7fb382] text-white'
                          : 'bg-[#16221b] border-white/12 text-[#b9cab8]'
                      }`}
                    >
                      {m}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= VITALS & STATES TAB ================= */}
        {tab === 'vitals' && (
          <div className="space-y-3">
            {/* State Inducers */}
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                  Induce Player Conditions
                </span>
                <span className="text-[10px] font-mono text-[#9eb49d]">
                  God Mode: {snapshot.godMode ? 'Immortal' : 'Mortal'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['soaked', 'Soaked (95% Wet)'],
                    ['hypothermic', 'Hypothermic (33.5°C)'],
                    ['exhausted', 'Exhausted'],
                    ['starving', 'Starving (0% Food)'],
                    ['dehydrated', 'Dehydrated (0% Water)'],
                    ['poisoned', 'Poisoned (Fly Agaric)'],
                    ['cleanse', 'Cleanse / Full Restore'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={`preset-${id}`}
                    onClick={() => actions.applyStatePreset(id)}
                    className={`px-2.5 py-1 rounded border text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                      id === 'cleanse'
                        ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-200 hover:bg-emerald-500/30'
                        : 'bg-[#18241d] border-white/12 text-[#dce8da] hover:bg-[#24362b]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Direct Sliders + Number Inputs */}
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                Exact Survival Vitals
              </div>
              {(
                [
                  { key: 'health', label: 'Health', min: 0, max: 100, step: 1, val: snapshot.survival.health, unit: '%' },
                  { key: 'energy', label: 'Energy', min: 0, max: 100, step: 1, val: snapshot.survival.energy, unit: '%' },
                  { key: 'hydration', label: 'Hydration', min: 0, max: 100, step: 1, val: snapshot.survival.hydration, unit: '%' },
                  { key: 'stomachFullness', label: 'Stomach Fullness', min: 0, max: 100, step: 1, val: snapshot.survival.stomachFullness, unit: '%' },
                  { key: 'physicalTiredness', label: 'Physical Tiredness', min: 0, max: 100, step: 1, val: snapshot.survival.physicalTiredness, unit: '%' },
                  { key: 'bodyTempC', label: 'Core Body Temp', min: 32.0, max: 37.5, step: 0.1, val: snapshot.survival.bodyTempC, unit: '°C' },
                  { key: 'wetness', label: 'Wetness', min: 0, max: 100, step: 1, val: snapshot.survival.wetness, unit: '%' },
                  { key: 'nausea', label: 'Nausea', min: 0, max: 100, step: 1, val: snapshot.survival.nausea, unit: '%' },
                  { key: 'awakeHours', label: 'Awake Hours', min: 0, max: 36, step: 0.5, val: snapshot.survival.awakeHours, unit: 'h' },
                  { key: 'digestionBurnRate', label: 'Digestion Burn Rate', min: 0.4, max: 2.5, step: 0.05, val: snapshot.survival.digestionBurnRate, unit: 'x' },
                  { key: 'waterStomachLoadL', label: 'Stomach Water Load', min: 0, max: 2.0, step: 0.05, val: snapshot.survival.waterStomachLoadL, unit: 'L' },
                  { key: 'flashlightBattery', label: 'Flashlight Battery', min: 0, max: 100, step: 1, val: snapshot.inventory.flashlightBattery, unit: '%' },
                ] as const
              ).map((row) => (
                <div key={row.key} className="grid grid-cols-[128px_1fr_72px] items-center gap-2">
                  <span className="text-[11px] text-[#bfd1be] truncate">{row.label}</span>
                  <input
                    type="range"
                    min={row.min}
                    max={row.max}
                    step={row.step}
                    value={row.val}
                    onChange={(e) =>
                      actions.setVitalsPatch({ [row.key]: parseFloat(e.target.value) })
                    }
                    className="accent-[#7fb382]"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={row.min}
                      max={row.max}
                      step={row.step}
                      data-testid={`vital-input-${row.key}`}
                      value={Number(row.val.toFixed(row.step < 1 ? 2 : 0))}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        if (Number.isFinite(n)) actions.setVitalsPatch({ [row.key]: n });
                      }}
                      className="w-14 px-1.5 py-0.5 rounded bg-black/45 border border-white/14 font-mono tabular-nums text-[11px] text-right text-[#eef5ec]"
                    />
                    <span className="text-[10px] text-[#8ca18b]">{row.unit}</span>
                  </div>
                </div>
              ))}

              {snapshot.survival.poisons.length > 0 && (
                <div className="pt-2 border-t border-white/10 space-y-1">
                  <div className="text-[10.5px] uppercase tracking-wider text-rose-300">
                    Active Toxins ({snapshot.survival.poisons.length})
                  </div>
                  {snapshot.survival.poisons.map((p, idx) => (
                    <div
                      key={`${p.kind}-${idx}`}
                      className="flex justify-between font-mono text-[10.5px] text-rose-200 bg-rose-500/10 rounded px-2 py-1"
                    >
                      <span>{p.label}</span>
                      <span>
                        {p.delayHours > 0
                          ? `onset in ${p.delayHours.toFixed(1)}h`
                          : `${p.remainingHours.toFixed(1)}h left · ${p.damagePerHour.toFixed(0)} dmg/h`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= PACK, BALLAST & THRESHOLDS TAB ================= */}
        {tab === 'pack' && (
          <div className="space-y-3">
            {/* Weight Summary + Thresholds */}
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                  Weight & Burden Thresholds
                </span>
                <span
                  data-testid="debug-load-tier-badge"
                  className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                    snapshot.survival.loadTier === 'overburdened'
                      ? 'bg-rose-500/20 text-rose-200 border border-rose-400/40'
                      : snapshot.survival.loadTier === 'heavy'
                        ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                        : 'bg-[#1b2c22] text-[#b9dfba] border border-white/12'
                  }`}
                >
                  {snapshot.survival.loadTier} · {snapshot.survival.totalEffectiveWeightKg.toFixed(2)} kg eff
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-[10.5px] bg-black/25 rounded p-2">
                <div>
                  <div className="text-[#8ba08a]">Pack Weight</div>
                  <div className="text-[#eef5ec]">{snapshot.survival.backpackWeightKg.toFixed(2)} kg</div>
                </div>
                <div>
                  <div className="text-[#8ba08a]">Tiring Mult</div>
                  <div className="text-[#eef5ec]">{snapshot.survival.tiringMultiplier.toFixed(2)}x</div>
                </div>
                <div>
                  <div className="text-[#8ba08a]">Hunger Mult</div>
                  <div className="text-[#eef5ec]">{snapshot.survival.stomachDrainMultiplier.toFixed(2)}x</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1">
                  <span className="block text-[10px] text-[#9eb39d]">Moderate @ kg</span>
                  <input
                    type="number"
                    step={0.5}
                    min={0.5}
                    data-testid="threshold-moderate-input"
                    value={snapshot.weightThresholds.moderateKg}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v)) actions.setWeightThresholds({ moderateKg: v });
                    }}
                    className="w-full px-2 py-1 rounded bg-black/45 border border-white/14 font-mono tabular-nums text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[10px] text-[#9eb39d]">Heavy @ kg</span>
                  <input
                    type="number"
                    step={0.5}
                    min={1}
                    data-testid="threshold-heavy-input"
                    value={snapshot.weightThresholds.heavyKg}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v)) actions.setWeightThresholds({ heavyKg: v });
                    }}
                    className="w-full px-2 py-1 rounded bg-black/45 border border-white/14 font-mono tabular-nums text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[10px] text-[#f0dfb4]">Overburdened @ kg</span>
                  <input
                    type="number"
                    step={0.5}
                    min={1.5}
                    data-testid="threshold-overburdened-input"
                    value={snapshot.weightThresholds.overburdenedKg}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v)) actions.setWeightThresholds({ overburdenedKg: v });
                    }}
                    className="w-full px-2 py-1 rounded bg-black/45 border border-[#e0b265]/45 font-mono tabular-nums text-xs text-[#f6e7c3]"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => actions.setWeightThresholds(DEFAULT_WEIGHT_THRESHOLDS)}
                className="px-2 py-0.5 rounded bg-white/6 hover:bg-white/12 text-[10.5px] text-[#b9cab8] cursor-pointer"
              >
                Reset Weight Thresholds ({DEFAULT_WEIGHT_THRESHOLDS.moderateKg} /{' '}
                {DEFAULT_WEIGHT_THRESHOLDS.heavyKg} / {DEFAULT_WEIGHT_THRESHOLDS.overburdenedKg} kg)
              </button>
            </div>

            {/* Visible Debug Ballast */}
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                  Visible Debug Ballast (Positive / Negative)
                </span>
                <span
                  data-testid="debug-ballast-readout"
                  className="font-mono tabular-nums text-xs text-[#f0dfb4]"
                >
                  {(snapshot.inventory.debugBallastKg ?? 0) >= 0 ? '+' : ''}
                  {(snapshot.inventory.debugBallastKg ?? 0).toFixed(2)} kg
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[-5, -1, -0.5, 0.5, 1, 5].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    data-testid={`ballast-delta-${delta}`}
                    onClick={() => actions.adjustDebugBallastKg(delta)}
                    className="px-2 py-1 rounded bg-[#18241d] hover:bg-[#25382c] border border-white/12 font-mono tabular-nums text-[11px] cursor-pointer"
                  >
                    {delta > 0 ? `+${delta}` : delta} kg
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => actions.setDebugBallastKg(0)}
                  className="px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/35 text-[11px] text-rose-200 cursor-pointer"
                >
                  Clear Ballast
                </button>
              </div>
            </div>

            {/* Bottles */}
            {snapshot.inventory.bottles.length > 0 && (
              <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                  Carried Water Bottles ({snapshot.inventory.bottles.length})
                </div>
                {snapshot.inventory.bottles.map((b) => (
                  <div
                    key={b.uid}
                    className="flex flex-wrap items-center justify-between gap-2 bg-black/25 rounded p-2 text-[11px]"
                  >
                    <span className="font-medium text-[#dce8da]">
                      {ITEM_CATALOG[b.itemId].name} ({b.waterLiters.toFixed(2)}/{b.capacityLiters}L)
                    </span>
                    <div className="flex items-center gap-1">
                      <select
                        value={b.waterQuality}
                        onChange={(e) =>
                          actions.setBottleState(b.uid, {
                            waterQuality: e.target.value as WaterQuality,
                          })
                        }
                        className="px-1.5 py-0.5 rounded bg-[#141e18] border border-white/14 text-[10.5px]"
                      >
                        <option value="clean">Clean</option>
                        <option value="bog">Bog</option>
                        <option value="stale">Stale</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => actions.setBottleState(b.uid, { waterLiters: 0 })}
                        className="px-1.5 py-0.5 rounded bg-white/8 hover:bg-white/14 text-[10.5px] cursor-pointer"
                      >
                        Empty
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          actions.setBottleState(b.uid, { waterLiters: b.capacityLiters })
                        }
                        className="px-1.5 py-0.5 rounded bg-[#1f3428] hover:bg-[#2a4736] text-[10.5px] cursor-pointer"
                      >
                        Fill
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Catalog Stack Add / Remove */}
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                  Add / Remove Backpack Items
                </span>
                <input
                  type="text"
                  value={packFilter}
                  onChange={(e) => setPackFilter(e.target.value)}
                  placeholder="Filter items..."
                  className="px-2 py-1 rounded bg-black/45 border border-white/14 text-[11px] w-40"
                />
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-white/8">
                {filteredItems.map((def) => {
                  const qty = def.waterContainer
                    ? snapshot.inventory.bottles.filter((b) => b.itemId === def.id).length
                    : snapshot.inventory.stacks[def.id] ?? 0;
                  return (
                    <div key={def.id} className="py-1.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-[#e4ede2] truncate">
                          {def.name}
                        </div>
                        <div className="text-[10px] text-[#8ba08a]">
                          {def.category} · {def.weightKg.toFixed(2)}kg
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          data-testid={`pack-dec-${def.id}`}
                          onClick={() => actions.adjustInventoryItem(def.id as ItemId, -1)}
                          className="w-6 h-6 flex items-center justify-center rounded bg-white/8 hover:bg-white/16 cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center font-mono tabular-nums text-[11px]">
                          {qty}
                        </span>
                        <button
                          type="button"
                          data-testid={`pack-inc-${def.id}`}
                          onClick={() => actions.adjustInventoryItem(def.id as ItemId, 1)}
                          className="w-6 h-6 flex items-center justify-center rounded bg-[#233a2b] hover:bg-[#31503c] cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ================= WORLD SPAWNER TAB ================= */}
        {tab === 'spawn' && (
          <div className="space-y-3">
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input
                  type="text"
                  value={spawnFilter}
                  onChange={(e) => setSpawnFilter(e.target.value)}
                  placeholder="Search shrooms, trees, huts, gear..."
                  className="flex-1 min-w-[160px] px-2.5 py-1 rounded bg-black/45 border border-white/14 text-xs"
                />
                <div className="flex items-center gap-1">
                  {(['all', 'mushroom', 'flora', 'structure', 'item'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSpawnCat(c)}
                      className={`px-2 py-1 rounded text-[10.5px] uppercase cursor-pointer ${
                        spawnCat === c
                          ? 'bg-[#2d4834] text-white border border-[#7fb382]'
                          : 'bg-white/6 text-[#a7bca6]'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1">
                <label className="flex items-center gap-2">
                  <span className="text-[#9cb19b]">Flora Scale:</span>
                  <input
                    type="range"
                    min={0.5}
                    max={2.2}
                    step={0.1}
                    value={spawnScale}
                    onChange={(e) => setSpawnScale(parseFloat(e.target.value))}
                    className="w-24 accent-[#7fb382]"
                  />
                  <span className="font-mono">{spawnScale.toFixed(1)}x</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={snapshot.autoSpawnOnPick}
                    onChange={(e) => actions.setAutoSpawnOnPick(e.target.checked)}
                    className="accent-[#7fb382]"
                  />
                  <span>Auto-spawn on Pick Click</span>
                </label>
              </div>

              {spawnFeedback && (
                <div className="px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-400/35 text-[11px] text-emerald-200">
                  {spawnFeedback}
                </div>
              )}
            </div>

            <div className="rounded-md bg-[#0f1712] border border-white/10 divide-y divide-white/8 max-h-[420px] overflow-y-auto">
              {filteredSpawn.map((entry) => {
                const isSelected = snapshot.selectedSpawnId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className={`p-2 flex items-center justify-between gap-2 ${
                      isSelected ? 'bg-[#1a2b20]' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => actions.setSelectedSpawnId(entry.id)}
                      className="text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <div className="text-[11.5px] font-medium text-[#ebf3ea] truncate">
                        {entry.label}
                      </div>
                      <div className="text-[10px] text-[#8ca18b] truncate">
                        [{entry.category}] {entry.sublabel}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        data-testid={`spawn-front-${entry.id}`}
                        onClick={() => handleSpawn(entry.id, 'in_front')}
                        className="px-2 py-1 rounded bg-[#243a2c] hover:bg-[#31503c] border border-white/12 text-[10.5px] whitespace-nowrap cursor-pointer"
                      >
                        Near Me
                      </button>
                      <button
                        type="button"
                        data-testid={`spawn-pick-${entry.id}`}
                        disabled={!snapshot.pickedHit && !snapshot.centerHit}
                        onClick={() => handleSpawn(entry.id, 'picked')}
                        className="px-2 py-1 rounded bg-[#1a2920] hover:bg-[#273d30] disabled:opacity-45 border border-white/12 text-[10.5px] whitespace-nowrap cursor-pointer"
                      >
                        At Cursor
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= TIME, CLOCK & WEATHER TAB ================= */}
        {tab === 'time' && (
          <div className="space-y-3">
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                  In-Game Clock & Time Scale
                </span>
                <span className="font-mono tabular-nums text-sm font-semibold text-[#f3e4c3]">
                  Day {snapshot.simDay} · {snapshot.simTimeStr}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {[0, 1, 5, 20, 60, 240].map((mult) => (
                  <button
                    key={mult}
                    type="button"
                    data-testid={`clock-speed-${mult}`}
                    onClick={() => actions.setClockSpeedMultiplier(mult)}
                    className={`px-2.5 py-1 rounded border font-mono text-[11px] cursor-pointer whitespace-nowrap ${
                      Math.abs(snapshot.clockSpeedMultiplier - mult) < 0.05
                        ? 'bg-[#2e4936] border-[#7fb382] text-white'
                        : 'bg-[#17231c] border-white/12 text-[#c8d8c6]'
                    }`}
                  >
                    {mult}x
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#9eb39d] w-24">Custom Speed</span>
                <input
                  type="range"
                  min={0}
                  max={300}
                  step={1}
                  value={snapshot.clockSpeedMultiplier}
                  onChange={(e) => actions.setClockSpeedMultiplier(parseFloat(e.target.value))}
                  className="flex-1 accent-[#7fb382]"
                />
                <span className="font-mono tabular-nums text-[11px] w-12 text-right">
                  {snapshot.clockSpeedMultiplier}x
                </span>
              </div>

              <div className="pt-1 border-t border-white/10">
                <div className="text-[10.5px] text-[#9eb39d] mb-1.5">Jump to Hour</div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    [0, '00:00 Midnight'],
                    [5.25, '05:15 Dawn'],
                    [9.25, '09:15 Morning'],
                    [12.5, '12:30 Noon'],
                    [19.5, '19:30 Dusk'],
                    [22.5, '22:30 Night'],
                  ].map(([hr, label]) => (
                    <button
                      key={String(hr)}
                      type="button"
                      onClick={() => actions.setTimeOfDayHour(Number(hr))}
                      className="px-2 py-1 rounded bg-[#18241d] hover:bg-[#25382c] border border-white/12 font-mono text-[10.5px] cursor-pointer whitespace-nowrap"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Weather & Wind Override */}
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f] flex items-center gap-1.5">
                  <Wind className="w-3.5 h-3.5" />
                  Weather & Wind Override
                </span>
                <span className="font-mono text-[11px] text-[#c8d8c6]">
                  Live: {snapshot.weather} · wind {snapshot.windStrength.toFixed(2)}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => actions.setWeatherOverride(null)}
                  className={`px-2.5 py-1 rounded border text-[11px] cursor-pointer ${
                    snapshot.weatherOverride === null
                      ? 'bg-[#2e4936] border-[#7fb382] text-white'
                      : 'bg-[#17231c] border-white/12 text-[#c8d8c6]'
                  }`}
                >
                  Auto Weather
                </button>
                {(['clear', 'mist', 'rain', 'storm'] as WeatherId[]).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => actions.setWeatherOverride(w)}
                    className={`px-2.5 py-1 rounded border text-[11px] uppercase cursor-pointer ${
                      snapshot.weatherOverride === w
                        ? 'bg-[#2e4936] border-[#7fb382] text-white'
                        : 'bg-[#17231c] border-white/12 text-[#c8d8c6]'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    actions.setWindOverride(snapshot.windOverride === null ? 1.0 : null)
                  }
                  className={`px-2 py-1 rounded border text-[10.5px] cursor-pointer whitespace-nowrap ${
                    snapshot.windOverride !== null
                      ? 'bg-[#2e4936] border-[#7fb382] text-white'
                      : 'bg-[#17231c] border-white/12 text-[#c8d8c6]'
                  }`}
                >
                  {snapshot.windOverride !== null ? 'Manual Wind' : 'Auto Wind'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={snapshot.windOverride ?? snapshot.windStrength}
                  onChange={(e) => actions.setWindOverride(parseFloat(e.target.value))}
                  className="flex-1 accent-[#7fb382]"
                />
                <span className="font-mono tabular-nums text-[11px] w-10 text-right">
                  {(snapshot.windOverride ?? snapshot.windStrength).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ================= LIVE EVENTS TAB ================= */}
        {tab === 'events' && (
          <div className="space-y-3">
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {(['all', 'soundscape', 'survival', 'game', 'debug'] as const).map((src) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setEventSourceFilter(src)}
                      className={`px-2 py-1 rounded text-[10.5px] uppercase cursor-pointer ${
                        eventSourceFilter === src
                          ? 'bg-[#2d4834] text-white border border-[#7fb382]'
                          : 'bg-white/6 text-[#a7bca6]'
                      }`}
                    >
                      {src}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => actions.clearEvents()}
                  className="px-2 py-1 rounded bg-white/6 hover:bg-white/14 text-[10.5px] flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              </div>

              <input
                type="text"
                value={eventTextFilter}
                onChange={(e) => setEventTextFilter(e.target.value)}
                placeholder="Filter events by type or payload..."
                className="w-full px-2.5 py-1 rounded bg-black/45 border border-white/14 text-xs"
              />

              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    actions.emitDebugEvent('player.fall', { distanceM: 0.85, material: 'water', surface: 'water' }, 0.9)
                  }
                  className="px-2 py-1 rounded bg-[#18241d] hover:bg-[#24362b] border border-white/12 text-[10.5px] cursor-pointer"
                >
                  Emit player.fall (water)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    actions.emitDebugEvent('player.fall', { distanceM: 1.25, material: 'stone', surface: 'stone' }, 1.0)
                  }
                  className="px-2 py-1 rounded bg-[#18241d] hover:bg-[#24362b] border border-white/12 text-[10.5px] cursor-pointer"
                >
                  Emit player.fall (stone)
                </button>
                <button
                  type="button"
                  onClick={() => actions.emitDebugEvent('weather.thunder', { weather: 'storm' }, 1.0)}
                  className="px-2 py-1 rounded bg-[#18241d] hover:bg-[#24362b] border border-white/12 text-[10.5px] cursor-pointer"
                >
                  Emit thunder
                </button>
                <button
                  type="button"
                  onClick={() => actions.emitDebugEvent('wildlife.call', { species: 'wolf_howl' }, 0.9)}
                  className="px-2 py-1 rounded bg-[#18241d] hover:bg-[#24362b] border border-white/12 text-[10.5px] cursor-pointer"
                >
                  Emit wolf_howl
                </button>
              </div>
            </div>

            <div
              data-testid="debug-events-list"
              className="rounded-md bg-[#0b100d] border border-white/10 max-h-[410px] overflow-y-auto divide-y divide-white/6 font-mono text-[10.5px]"
            >
              {filteredEvents.length === 0 ? (
                <div className="p-3 text-[#8ca18b]">No events recorded yet.</div>
              ) : (
                filteredEvents.map((ev) => (
                  <div key={ev.id} className="px-2.5 py-1.5 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[#869c85]">{ev.simTimeStr}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9.5px] uppercase ${
                            ev.source === 'soundscape'
                              ? 'bg-sky-500/20 text-sky-200'
                              : ev.source === 'survival'
                                ? 'bg-amber-500/20 text-amber-200'
                                : ev.source === 'debug'
                                  ? 'bg-emerald-500/20 text-emerald-200'
                                  : 'bg-white/10 text-[#d4e3d2]'
                          }`}
                        >
                          {ev.source}
                        </span>
                        <span className="font-semibold text-[#eef5ec] truncate">{ev.type}</span>
                      </div>
                    </div>
                    {ev.summary && (
                      <div className="text-[#9cb19b] truncate">{ev.summary}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ================= PERFORMANCE GRAPHS TAB ================= */}
        {tab === 'perf' && (
          <div className="space-y-3">
            {perf ? (
              <>
                <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#9eb39d]">
                      Active Bottleneck Classification
                    </div>
                    <div
                      data-testid="debug-perf-bottleneck"
                      className="font-mono text-xs font-semibold text-[#f3d488] mt-0.5"
                    >
                      {perf.bottleneck}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyDump}
                    className="px-2.5 py-1.5 rounded bg-[#1d2e23] hover:bg-[#2a4233] border border-white/12 text-[11px] cursor-pointer whitespace-nowrap"
                  >
                    {copiedDump ? 'Copied!' : 'Copy Perf Dump'}
                  </button>
                </div>

                {/* Live 120-Frame Graphs */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-md bg-[#0f1712] border border-white/10 p-2.5 space-y-1.5">
                    <div className="flex justify-between font-mono tabular-nums text-[10.5px]">
                      <span className="text-[#9eb39d]">FPS History ({history.length})</span>
                      <span className="text-emerald-300 font-semibold">
                        {perf.fpsEma.toFixed(1)} EMA / {perf.fpsInstant.toFixed(0)} inst
                      </span>
                    </div>
                    <svg viewBox="0 0 240 68" className="w-full h-[68px] bg-black/35 rounded">
                      <line x1="0" y1="14" x2="240" y2="14" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                      <line x1="0" y1="39" x2="240" y2="39" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                      <polyline
                        fill="none"
                        stroke="#6ee7b7"
                        strokeWidth="1.6"
                        points={buildPolylinePoints(fpsValues, 240, 68, 70)}
                      />
                    </svg>
                  </div>

                  <div className="rounded-md bg-[#0f1712] border border-white/10 p-2.5 space-y-1.5">
                    <div className="flex justify-between font-mono tabular-nums text-[10.5px]">
                      <span className="text-[#9eb39d]">Frame Time (ms)</span>
                      <span className="text-amber-300 font-semibold">
                        {perf.rawDtMs.toFixed(1)}ms ({perf.tickCpuMs.toFixed(1)}ms CPU)
                      </span>
                    </div>
                    <svg viewBox="0 0 240 68" className="w-full h-[68px] bg-black/35 rounded">
                      <line
                        x1="0"
                        y1={(68 - (16.6 / maxFrameMs) * 62 - 3).toFixed(1)}
                        x2="240"
                        y2={(68 - (16.6 / maxFrameMs) * 62 - 3).toFixed(1)}
                        stroke="rgba(110,231,183,0.3)"
                        strokeDasharray="3 3"
                      />
                      <polyline
                        fill="none"
                        stroke="#fbbf24"
                        strokeWidth="1.6"
                        points={buildPolylinePoints(frameMsValues, 240, 68, maxFrameMs)}
                      />
                    </svg>
                  </div>
                </div>

                {/* Subsystem Time Breakdown */}
                <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2">
                  <div className="flex justify-between text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                    <span>Subsystem Cost Breakdown</span>
                    <span className="font-mono tabular-nums text-[#b8cbb7]">
                      CPU {perf.tickCpuMs.toFixed(2)}ms · Total {perf.rawDtMs.toFixed(1)}ms
                    </span>
                  </div>
                  <div className="space-y-1.5 font-mono tabular-nums text-[10.5px]">
                    {subsystems.map((sub) => {
                      const pct = Math.min(100, (sub.ms / totalBudgetRefMs) * 100);
                      return (
                        <div key={sub.label} className="space-y-0.5">
                          <div className="flex justify-between">
                            <span className="text-[#c9d8c7]">{sub.label}</span>
                            <span className="text-[#edf3ea]">
                              {sub.ms.toFixed(2)}ms ({pct.toFixed(0)}%)
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-black/55 rounded overflow-hidden">
                            <div
                              className={`h-full ${sub.color}`}
                              style={{ width: `${Math.max(1, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Draw Calls & Scene Counts */}
                <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 grid grid-cols-3 gap-2 font-mono tabular-nums text-[10.5px]">
                  <div>
                    <div className="text-[#8ba08a]">Draw Calls</div>
                    <div>{perf.calls}</div>
                  </div>
                  <div>
                    <div className="text-[#8ba08a]">Triangles</div>
                    <div>{perf.triangles.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[#8ba08a]">Chunks (L0/L1/L2)</div>
                    <div>
                      {perf.visibleChunks} ({perf.lodCounts.join('/')})
                    </div>
                  </div>
                  <div>
                    <div className="text-[#8ba08a]">Trees / Foliage</div>
                    <div>
                      {perf.treesRendered} / {perf.foliageRendered}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#8ba08a]">Grass / CullDist</div>
                    <div>
                      {perf.grassCount} / {perf.fogCullDist.toFixed(0)}m
                    </div>
                  </div>
                  <div>
                    <div className="text-[#8ba08a]">Res / Heap</div>
                    <div>
                      {perf.pixelRatio.toFixed(2)}x ·{' '}
                      {perf.jsHeapMB !== null ? `${perf.jsHeapMB.toFixed(0)}MB` : 'n/a'}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-[#9bb09a]">Collecting performance telemetry...</div>
            )}
          </div>
        )}

        {/* ================= MAP REVEAL & TELEPORT TAB ================= */}
        {tab === 'map' && (
          <div className="space-y-3">
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                  Fog-of-War & Cartography
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#b9cab8] mt-0.5">
                  Explored: {snapshot.discoveredPercent}%
                </div>
              </div>
              <button
                type="button"
                data-testid="reveal-whole-map-btn"
                onClick={() => actions.revealFullMap()}
                className="px-3 py-1.5 rounded bg-[#2d4a34] hover:bg-[#3a6043] border border-[#729e7a]/55 text-xs font-medium text-[#eef5ec] cursor-pointer whitespace-nowrap"
              >
                Reveal Whole Map (100%)
              </button>
            </div>

            {/* Custom Coordinates Teleport */}
            <div className="rounded-md bg-[#0f1712] border border-white/10 p-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9ec79f]">
                Custom Teleport Coordinates
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 flex-1">
                  <span className="font-mono text-[#9bb09a]">X</span>
                  <input
                    type="number"
                    data-testid="tp-x-input"
                    value={tpX}
                    onChange={(e) => setTpX(e.target.value)}
                    className="w-full px-2 py-1 rounded bg-black/45 border border-white/14 font-mono text-xs"
                  />
                </label>
                <label className="flex items-center gap-1.5 flex-1">
                  <span className="font-mono text-[#9bb09a]">Z</span>
                  <input
                    type="number"
                    data-testid="tp-z-input"
                    value={tpZ}
                    onChange={(e) => setTpZ(e.target.value)}
                    className="w-full px-2 py-1 rounded bg-black/45 border border-white/14 font-mono text-xs"
                  />
                </label>
                <button
                  type="button"
                  data-testid="tp-custom-btn"
                  onClick={() => {
                    const nx = parseFloat(tpX);
                    const nz = parseFloat(tpZ);
                    if (Number.isFinite(nx) && Number.isFinite(nz)) {
                      actions.teleportTo(nx, nz, `Custom (${nx.toFixed(0)}, ${nz.toFixed(0)})`);
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-[#243a2c] hover:bg-[#31503c] border border-white/12 text-xs font-medium cursor-pointer whitespace-nowrap"
                >
                  Teleport
                </button>
              </div>
            </div>

            {/* Procedural Landmarks */}
            <div className="rounded-md bg-[#0f1712] border border-white/10 divide-y divide-white/8 max-h-[340px] overflow-y-auto">
              {snapshot.teleportLocations.map((loc) => (
                <div key={loc.id} className="p-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-[#9ec79f] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11.5px] font-medium text-[#eef5ec] truncate">
                        {loc.label}
                      </div>
                      <div className="text-[10px] font-mono tabular-nums text-[#8ca18b]">
                        [{loc.kind}] X {loc.x.toFixed(1)}, Z {loc.z.toFixed(1)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`tp-loc-${loc.id}`}
                    onClick={() => actions.teleportTo(loc.x, loc.z, loc.label)}
                    className="px-2.5 py-1 rounded bg-[#1d2e23] hover:bg-[#2b4434] border border-white/12 text-[11px] font-medium cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    Teleport
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
