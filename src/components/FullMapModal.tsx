import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, Maximize2, Minus, Plus, X } from 'lucide-react';
import { NavigationMode } from '../game/itemCatalog';
import { formatCompassLabel } from '../world/minimapMath';
import { WORLD_HALF, WORLD_SIZE } from '../world/terrainMath';
import { getNavigationModeLabel, useLanguage } from '../i18n/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

interface FullMapModalProps {
  worldSeed: number;
  navigationMode: NavigationMode;
  discoveredPercent: number;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  fogVersion: number;
  onRenderMap: (canvas: HTMLCanvasElement, zoom: number, panX: number, panZ: number) => void;
  onClose: () => void;
}

const MIN_ZOOM = 1.0;
const MAX_ZOOM = 3.6;

export const FullMapModal: React.FC<FullMapModalProps> = ({
  worldSeed,
  navigationMode,
  discoveredPercent,
  playerX,
  playerZ,
  playerYaw,
  fogVersion,
  onRenderMap,
  onClose,
}) => {
  const { t, lang } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; z: number }>({ x: 0, z: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [viewportTick, setViewportTick] = useState<number>(0);

  const dragRef = useRef<{
    active: boolean;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanZ: number;
  }>({
    active: false,
    startClientX: 0,
    startClientY: 0,
    startPanX: 0,
    startPanZ: 0,
  });

  const hasPaperMap = navigationMode === 'map' || navigationMode === 'both';
  const hasCompass = navigationMode === 'compass' || navigationMode === 'both';
  const hasLivePos = navigationMode === 'both';

  const clampPan = useCallback((px: number, pz: number, z: number) => {
    const maxPan = WORLD_HALF * Math.max(0, 1 - 1 / z);
    return {
      x: Math.max(-maxPan, Math.min(maxPan, px)),
      z: Math.max(-maxPan, Math.min(maxPan, pz)),
    };
  }, []);

  // Re-render full map canvas whenever view transform, fog state, nav mode, language, or size changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onRenderMap(canvas, zoom, pan.x, pan.z);
  }, [onRenderMap, zoom, pan.x, pan.z, fogVersion, navigationMode, lang, viewportTick]);

  // Keep canvas crisp on container resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setViewportTick((n) => n + 1);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Drag-to-pan handlers
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.active || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const baseFitPx = Math.max(180, Math.min(rect.width - 56, rect.height - 56));
      const pxPerMeter = (baseFitPx * zoom) / WORLD_SIZE;
      const dxM = (e.clientX - dragRef.current.startClientX) / pxPerMeter;
      const dzM = (e.clientY - dragRef.current.startClientY) / pxPerMeter;
      setPan(clampPan(dragRef.current.startPanX - dxM, dragRef.current.startPanZ - dzM, zoom));
    };
    const onMouseUp = () => {
      if (dragRef.current.active) {
        dragRef.current.active = false;
        setIsDragging(false);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [zoom, clampPan]);

  const applyZoom = useCallback(
    (nextZoom: number) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(nextZoom * 100) / 100));
      setZoom(clamped);
      setPan((prev) => clampPan(prev.x, prev.z, clamped));
    },
    [clampPan]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      applyZoom(zoom * factor);
    },
    [zoom, applyZoom]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      dragRef.current = {
        active: true,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanZ: pan.z,
      };
      setIsDragging(true);
    },
    [pan.x, pan.z]
  );

  const handleRecenter = useCallback(() => {
    if (!hasLivePos) return;
    const nextZoom = Math.max(zoom, 1.8);
    setZoom(nextZoom);
    setPan(clampPan(playerX, playerZ, nextZoom));
  }, [hasLivePos, zoom, playerX, playerZ, clampPan]);

  const handleResetView = useCallback(() => {
    setZoom(1.0);
    setPan({ x: 0, z: 0 });
  }, []);

  return (
    <div
      data-testid="full-map-modal"
      data-nav-mode={navigationMode}
      data-explored-pct={discoveredPercent}
      role="dialog"
      aria-label={t('fullMap.ariaLabel')}
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#060a08]/78 px-4 py-4 pointer-events-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl h-[min(86vh,780px)] rounded-xl bg-[#0d1410]/96 border border-white/15 shadow-[0_24px_70px_rgba(0,0,0,0.72)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-white/10 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-[#edf3eb] leading-tight">
              {hasPaperMap ? t('fullMap.title') : t('fullMap.titleSketch')}
            </h2>
            <p
              data-testid="full-map-summary"
              className="mt-0.5 text-xs text-[#9cb09b] tabular-nums"
            >
              {t('fullMap.summary', {
                seed: worldSeed,
                pct: discoveredPercent,
                nav: getNavigationModeLabel(navigationMode, lang),
              })}
              {hasCompass ? ` · ${formatCompassLabel(playerYaw)}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="full-map-zoom-out"
              onClick={() => applyZoom(zoom - 0.4)}
              disabled={zoom <= MIN_ZOOM + 0.01}
              aria-label={t('fullMap.zoomOutAria')}
              className="w-8 h-8 flex items-center justify-center rounded-md bg-[#16201a] hover:bg-[#223027] disabled:opacity-40 border border-white/10 text-[#d4e0d3] cursor-pointer disabled:cursor-not-allowed"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span
              data-testid="full-map-zoom-readout"
              className="w-11 text-center font-mono tabular-nums text-xs text-[#dce7da]"
            >
              {zoom.toFixed(1)}×
            </span>
            <button
              type="button"
              data-testid="full-map-zoom-in"
              onClick={() => applyZoom(zoom + 0.4)}
              disabled={zoom >= MAX_ZOOM - 0.01}
              aria-label={t('fullMap.zoomInAria')}
              className="w-8 h-8 flex items-center justify-center rounded-md bg-[#16201a] hover:bg-[#223027] disabled:opacity-40 border border-white/10 text-[#d4e0d3] cursor-pointer disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>

            {hasLivePos && (
              <button
                type="button"
                data-testid="full-map-recenter-btn"
                onClick={handleRecenter}
                aria-label={t('fullMap.recenterAria')}
                className="h-8 px-2.5 flex items-center gap-1.5 rounded-md bg-[#1a2820] hover:bg-[#263a2e] border border-[#6c9273]/40 text-xs font-medium text-[#e3eee2] whitespace-nowrap cursor-pointer"
              >
                <Crosshair className="w-3.5 h-3.5 text-[#a9d0ad]" />
                {t('fullMap.recenter')}
              </button>
            )}

            <button
              type="button"
              data-testid="full-map-reset-btn"
              onClick={handleResetView}
              aria-label={t('fullMap.resetViewAria')}
              className="h-8 px-2.5 flex items-center gap-1.5 rounded-md bg-[#16201a] hover:bg-[#223027] border border-white/10 text-xs text-[#c7d6c6] whitespace-nowrap cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              {t('fullMap.resetView')}
            </button>

            <LanguageSwitcher compact />

            <button
              type="button"
              data-testid="full-map-close-btn"
              onClick={onClose}
              aria-label={t('fullMap.closeAria')}
              className="w-8 h-8 flex items-center justify-center rounded-md bg-[#18221c] hover:bg-[#243229] border border-white/10 text-[#cdd9cc] hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Diegetic Mode Notice (only when Map or Compass is missing) */}
        {!hasLivePos && (
          <div
            data-testid="full-map-mode-notice"
            className="px-5 py-2 bg-[#131c17] border-b border-white/8 text-xs text-[#c6c8b6] shrink-0"
          >
            {hasPaperMap ? t('fullMap.noticeNoCompass') : t('fullMap.noticeNoMap')}
          </div>
        )}

        {/* Interactive Full Map Canvas */}
        <div className="relative flex-1 min-h-0 bg-[#090e0b]">
          <canvas
            ref={canvasRef}
            data-testid="full-map-canvas"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onDoubleClick={() => applyZoom(zoom + 0.6)}
            className={`w-full h-full block select-none ${
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          />
        </div>

        {/* Footer Legend & Controls Hint */}
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-2.5 border-t border-white/10 bg-[#0b110d] text-[11px] text-[#9eb19d] shrink-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#587c4b] border border-white/25 inline-block" />
              {t('fullMap.legend.explored')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#131d17] border border-white/20 inline-block" />
              {t('fullMap.legend.fog')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-1 rounded-xs bg-[#d7be92] inline-block" />
              {t('fullMap.legend.road')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#f0ca8a] border border-[#181610] inline-block" />
              {t('fullMap.legend.village')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#2c4e59] border border-white/20 inline-block" />
              {t('fullMap.legend.bog')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff9d47] border border-[#121511] inline-block" />
              {t('fullMap.legend.campfire')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-0 h-0 border-l-[4.5px] border-l-transparent border-r-[4.5px] border-r-transparent border-b-[8px] border-b-[#8ad192] inline-block" />
              {t('fullMap.legend.tent')}
            </span>
            {hasLivePos && (
              <span className="inline-flex items-center gap-1.5 text-[#f4e5bf]">
                <span className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[7px] border-b-[#fff5d6] inline-block" />
                {t('fullMap.legend.player')}
              </span>
            )}
          </div>
          <span className="font-mono text-[10.5px] text-[#7f937e]">
            {t('fullMap.hintPanZoom')}
          </span>
        </div>
      </div>
    </div>
  );
};
