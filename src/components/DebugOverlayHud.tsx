import React from 'react';
import type { DebugSnapshot } from '../game/debugTypes';

interface DebugOverlayHudProps {
  open: boolean;
  consoleOpen: boolean;
  snapshot: DebugSnapshot | null;
}

export const DebugOverlayHud: React.FC<DebugOverlayHudProps> = ({
  open,
  consoleOpen,
  snapshot,
}) => {
  if (!open || !snapshot) return null;

  const hit =
    snapshot.pickTargetActive && snapshot.pickedHit
      ? snapshot.pickedHit
      : snapshot.centerHit ?? snapshot.pickedHit;

  const positionClass = consoleOpen ? 'top-4 left-[596px]' : 'top-24 left-5';

  return (
    <div
      data-testid="debug-overlay-hud"
      className={`fixed ${positionClass} z-30 pointer-events-none w-[340px] max-w-[calc(100vw-2rem)] rounded-md bg-[#080d0a]/90 border border-[#6e997a]/40 px-3 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.6)] text-[11px] font-mono tabular-nums text-[#dce8da] space-y-2`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9ec79f]">
          Inspector HUD
        </span>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {snapshot.simPaused && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/35 text-[9.5px]">
              PAUSED
            </span>
          )}
          {snapshot.godMode && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-400/35 text-[9.5px]">
              GOD
            </span>
          )}
          {snapshot.noClip && (
            <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-200 border border-sky-400/35 text-[9.5px]">
              NOCLIP
            </span>
          )}
          {snapshot.pickTargetActive && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/35 text-[9.5px]">
              PICK
            </span>
          )}
          <span className="text-[10px] text-[#b4c8b2]">
            {snapshot.clockSpeedMultiplier}x · {snapshot.simTimeStr}
          </span>
        </div>
      </div>

      {hit ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="px-1.5 py-0.5 rounded bg-[#1a2b20] border border-[#5d8767]/40 text-[#b7e2ba] uppercase text-[9.5px]">
              {hit.layer}
            </span>
            <span className="text-[10px] text-[#9bb09a]">
              {hit.source === 'cursor' ? 'Cursor Pick' : 'Center Aim'} · {hit.distanceM.toFixed(2)}m
            </span>
          </div>

          <div className="text-xs font-sans font-semibold text-[#f3f8f1] truncate">
            {hit.name}
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10.5px]">
            <div className="text-[#91a690]">Hit XYZ</div>
            <div className="text-right text-[#e5eee3]">
              {hit.point.x.toFixed(1)}, {hit.point.y.toFixed(2)}, {hit.point.z.toFixed(1)}
            </div>
            <div className="text-[#91a690]">Ground / Slope</div>
            <div className="text-right text-[#e5eee3]">
              {hit.terrainY.toFixed(2)}m · {hit.slopeDeg.toFixed(1)}°
            </div>
            <div className="text-[#91a690]">Surface / Water</div>
            <div className="text-right text-[#e5eee3]">
              {hit.surfaceMaterial} · {hit.waterDepthM.toFixed(2)}m
            </div>
            <div className="text-[#91a690]">Road / Shelter</div>
            <div className="text-right text-[#e5eee3] truncate">
              {hit.roadDistanceM.toFixed(1)}m · {hit.shelterLabel ?? hit.shelterQuality}
            </div>
          </div>

          {hit.biomeWeights.length > 0 && (
            <div className="text-[10px] text-[#a5b9a4] truncate">
              Biome:{' '}
              {hit.biomeWeights
                .slice(0, 3)
                .map((b) => `${b.label} ${Math.round(b.weight * 100)}%`)
                .join(' · ')}
            </div>
          )}

          {Object.keys(hit.meta).length > 0 && (
            <div className="pt-1 border-t border-white/10 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
              {Object.entries(hit.meta)
                .slice(0, 8)
                .map(([k, v]) => (
                  <React.Fragment key={k}>
                    <span className="text-[#869b85] truncate">{k}</span>
                    <span className="text-right text-[#d4e3d2] truncate">{String(v)}</span>
                  </React.Fragment>
                ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[#8fa38e] italic">Aim at terrain, water, foliage, or props (max 140m).</div>
      )}

      <div className="pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px] text-[#a7bca6]">
        <span>
          Pos {snapshot.playerPos.x.toFixed(1)}, {snapshot.playerPos.y.toFixed(2)},{' '}
          {snapshot.playerPos.z.toFixed(1)}
        </span>
        <span>
          {snapshot.perf
            ? `${Math.round(snapshot.perf.fpsEma)} FPS · ${snapshot.perf.tickCpuMs.toFixed(1)}ms`
            : ''}
        </span>
      </div>
    </div>
  );
};
