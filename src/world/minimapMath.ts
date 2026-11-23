import {
  clamp,
  getActiveBlueprint,
  getNearestSwampIsland,
  getSwampFactor,
  getTerrainHeight,
  getThicketFactor,
  roadCenterX,
  SWAMP_WATER_Y,
  WORLD_HALF,
  WORLD_SIZE,
} from './terrainMath';
import { WorldBlueprint } from './worldBlueprint';

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export interface MinimapBoardwalkRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Converts Three.js player yaw (radians; 0 = -Z North, -PI/2 = +X East)
 * to clockwise compass bearing in [0, 360).
 */
export function computeCompassHeadingDeg(yaw: number): number {
  const deg = ((-yaw * 180) / Math.PI) % 360;
  const norm = deg < 0 ? deg + 360 : deg;
  return norm === 0 ? 0 : norm;
}

export function formatCardinalDirection(headingDeg: number): string {
  const norm = ((headingDeg % 360) + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  return CARDINALS[idx];
}

export function formatCompassLabel(yaw: number): string {
  const deg = computeCompassHeadingDeg(yaw);
  const rounded = Math.round(deg) % 360;
  const cardinal = formatCardinalDirection(rounded);
  return `${cardinal} · ${String(rounded).padStart(3, '0')}°`;
}

export function worldToBaseMapPixel(
  worldX: number,
  worldZ: number,
  mapSize: number
): { px: number; pz: number } {
  return {
    px: ((worldX + WORLD_HALF) / WORLD_SIZE) * mapSize,
    pz: ((worldZ + WORLD_HALF) / WORLD_SIZE) * mapSize,
  };
}

/**
 * Projects a world coordinate onto a heading-up circular minimap canvas
 * centered at (radiusPx, radiusPx).
 */
export function projectPointOnHeadingMinimap(
  targetX: number,
  targetZ: number,
  playerX: number,
  playerZ: number,
  playerYaw: number,
  radiusPx: number,
  viewRadiusMeters: number
): { x: number; y: number } {
  const dx = targetX - playerX;
  const dz = targetZ - playerZ;
  const scale = radiusPx / viewRadiusMeters;
  const cosY = Math.cos(playerYaw);
  const sinY = Math.sin(playerYaw);
  // Matches canvas ctx.rotate(playerYaw): world (-Z North) up when yaw=0,
  // world (+X East) up when yaw=-PI/2.
  const rx = (dx * cosY - dz * sinY) * scale;
  const ry = (dx * sinY + dz * cosY) * scale;
  return { x: radiusPx + rx, y: radiusPx + ry };
}

/**
 * Pure RGBA pixel rasterizer for the 1200x1200m terrain & biome base map.
 * Works identically in Node tests and browser Offscreen/Canvas contexts.
 */
export function buildMinimapTerrainPixels(
  size: number,
  bp: WorldBlueprint = getActiveBlueprint()
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const stepMeters = WORLD_SIZE / size;

  for (let py = 0; py < size; py++) {
    const wz = -WORLD_HALF + (py + 0.5) * stepMeters;
    for (let px = 0; px < size; px++) {
      const wx = -WORLD_HALF + (px + 0.5) * stepMeters;
      const h = getTerrainHeight(wx, wz, bp);
      const hRight = getTerrainHeight(wx + stepMeters, wz, bp);
      const hDown = getTerrainHeight(wx, wz + stepMeters, bp);

      // Subtle NW hillshade
      const slope = (h - hRight) * 0.45 + (h - hDown) * 0.45;
      const shade = clamp(1 + slope * 0.14, 0.72, 1.24);

      const isl = getNearestSwampIsland(wx, wz, bp);
      const onIsland = isl.island !== null && isl.islandMask > 0.38;
      const swamp = onIsland ? 0 : getSwampFactor(wx, wz, undefined, bp);
      const thicket = getThicketFactor(wx, wz);

      let r = 56;
      let g = 88;
      let b = 44;

      if (h < SWAMP_WATER_Y + 0.03) {
        // Dark reflective bog pool water
        const depth = clamp((SWAMP_WATER_Y - h) * 1.8, 0, 1);
        r = 25 - depth * 6;
        g = 49 - depth * 9;
        b = 58 - depth * 6;
      } else if (swamp > 0.35 && !onIsland) {
        // Sphagnum peat bog & heather
        r = 74 + swamp * 16;
        g = 84 - swamp * 4;
        b = 42;
      } else if (onIsland) {
        // Raised dry bog island
        r = 72;
        g = 94;
        b = 48;
      } else if (thicket > 0.56) {
        // Dense spruce thicket
        const t = clamp((thicket - 0.56) / 0.44, 0, 1);
        r = 52 - t * 22;
        g = 84 - t * 28;
        b = 42 - t * 14;
      } else {
        // Birch / meadow countryside with elevation warmth
        const elevBoost = clamp((h - 1.5) * 2.2, -8, 14);
        r = 58 + elevBoost * 0.7;
        g = 92 + elevBoost * 0.9;
        b = 46 + elevBoost * 0.4;
      }

      const idx = (py * size + px) * 4;
      data[idx] = clamp(Math.round(r * shade), 0, 255);
      data[idx + 1] = clamp(Math.round(g * shade), 0, 255);
      data[idx + 2] = clamp(Math.round(b * shade), 0, 255);
      data[idx + 3] = 255;
    }
  }

  return data;
}

export interface MinimapRenderer {
  draw: (
    targetCanvas: HTMLCanvasElement,
    playerX: number,
    playerZ: number,
    playerYaw: number
  ) => void;
  dispose: () => void;
}

const BASE_MAP_PX = 600; // 2m per pixel across 1200x1200m countryside
const RASTER_PX = 260;
const MINIMAP_VIEW_RADIUS_METERS = 115;

export function createMinimapRenderer(
  bp: WorldBlueprint = getActiveBlueprint(),
  boardwalkZones: MinimapBoardwalkRect[] = []
): MinimapRenderer {
  const rasterCanvas = document.createElement('canvas');
  rasterCanvas.width = RASTER_PX;
  rasterCanvas.height = RASTER_PX;
  const rCtx = rasterCanvas.getContext('2d')!;
  const pixels = buildMinimapTerrainPixels(RASTER_PX, bp);
  const imgData = rCtx.createImageData(RASTER_PX, RASTER_PX);
  imgData.data.set(pixels);
  rCtx.putImageData(imgData, 0, 0);

  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = BASE_MAP_PX;
  baseCanvas.height = BASE_MAP_PX;
  const bCtx = baseCanvas.getContext('2d')!;
  bCtx.imageSmoothingEnabled = true;
  bCtx.drawImage(rasterCanvas, 0, 0, BASE_MAP_PX, BASE_MAP_PX);

  // Draw winding main gravel road
  bCtx.lineCap = 'round';
  bCtx.lineJoin = 'round';
  bCtx.strokeStyle = '#9a896e';
  bCtx.lineWidth = 3.2;
  bCtx.beginPath();
  for (let z = -WORLD_HALF + 8; z <= WORLD_HALF - 8; z += 8) {
    const x = roadCenterX(z, bp);
    const pt = worldToBaseMapPixel(x, z, BASE_MAP_PX);
    if (z === -WORLD_HALF + 8) bCtx.moveTo(pt.px, pt.pz);
    else bCtx.lineTo(pt.px, pt.pz);
  }
  bCtx.stroke();

  // Draw spur roads and forest trails
  for (const seg of bp.roadSegments) {
    const a = worldToBaseMapPixel(seg.ax, seg.az, BASE_MAP_PX);
    const b = worldToBaseMapPixel(seg.bx, seg.bz, BASE_MAP_PX);
    bCtx.strokeStyle = seg.isTrail ? '#7f6e52' : '#9a896e';
    bCtx.lineWidth = seg.isTrail ? 1.8 : 2.8;
    bCtx.beginPath();
    bCtx.moveTo(a.px, a.pz);
    bCtx.lineTo(b.px, b.pz);
    bCtx.stroke();
  }

  // Draw bog boardwalks
  bCtx.fillStyle = '#c49d68';
  for (const bw of boardwalkZones) {
    const minP = worldToBaseMapPixel(bw.minX, bw.minZ, BASE_MAP_PX);
    const maxP = worldToBaseMapPixel(bw.maxX, bw.maxZ, BASE_MAP_PX);
    bCtx.fillRect(
      minP.px,
      minP.pz,
      Math.max(1.2, maxP.px - minP.px),
      Math.max(1.2, maxP.pz - minP.pz)
    );
  }

  // Draw village clearing tints and building footprints
  for (const v of bp.villages) {
    const vc = worldToBaseMapPixel(v.x, v.z, BASE_MAP_PX);
    const clearR = (v.clearingRadius / WORLD_SIZE) * BASE_MAP_PX;
    bCtx.fillStyle = 'rgba(130, 142, 92, 0.24)';
    bCtx.beginPath();
    bCtx.arc(vc.px, vc.pz, clearR, 0, Math.PI * 2);
    bCtx.fill();

    for (const bld of v.buildings) {
      const bpPos = worldToBaseMapPixel(v.x + bld.offsetX, v.z + bld.offsetZ, BASE_MAP_PX);
      const wPx = Math.max(2.6, (bld.w / WORLD_SIZE) * BASE_MAP_PX);
      const dPx = Math.max(2.2, (bld.d / WORLD_SIZE) * BASE_MAP_PX);
      bCtx.save();
      bCtx.translate(bpPos.px, bpPos.pz);
      bCtx.rotate(-bld.rotY);
      bCtx.fillStyle = bld.abandoned ? '#989990' : '#d2aa74';
      bCtx.strokeStyle = 'rgba(20, 22, 18, 0.75)';
      bCtx.lineWidth = 0.6;
      bCtx.fillRect(-wPx * 0.5, -dPx * 0.5, wPx, dPx);
      bCtx.strokeRect(-wPx * 0.5, -dPx * 0.5, wPx, dPx);
      bCtx.restore();
    }
  }

  // Draw swamp island huts
  for (const isl of bp.swampIslands) {
    if (!isl.hut) continue;
    const hp = worldToBaseMapPixel(isl.x, isl.z, BASE_MAP_PX);
    const wPx = Math.max(2.2, (isl.hut.w / WORLD_SIZE) * BASE_MAP_PX);
    const dPx = Math.max(2.0, (isl.hut.d / WORLD_SIZE) * BASE_MAP_PX);
    bCtx.save();
    bCtx.translate(hp.px, hp.pz);
    bCtx.rotate(-isl.hut.rotY);
    bCtx.fillStyle = isl.hut.decayState === 'ruins' ? '#8f8b80' : '#b89468';
    bCtx.fillRect(-wPx * 0.5, -dPx * 0.5, wPx, dPx);
    bCtx.restore();
  }

  // Subtle boundary border
  bCtx.strokeStyle = 'rgba(235, 210, 165, 0.35)';
  bCtx.lineWidth = 2;
  bCtx.strokeRect(2, 2, BASE_MAP_PX - 4, BASE_MAP_PX - 4);

  const cssSize = 148;
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  return {
    draw(
      targetCanvas: HTMLCanvasElement,
      playerX: number,
      playerZ: number,
      playerYaw: number
    ): void {
      const targetPx = Math.round(cssSize * dpr);
      if (targetCanvas.width !== targetPx || targetCanvas.height !== targetPx) {
        targetCanvas.width = targetPx;
        targetCanvas.height = targetPx;
      }

      const ctx = targetCanvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssSize, cssSize);

      const cx = cssSize * 0.5;
      const cy = cssSize * 0.5;
      const outerR = cssSize * 0.5 - 2;
      const mapR = outerR - 14; // Leaves clean 14px annular ring for compass ticks & N/E/S/W

      // 1. Clipped heading-up rotating terrain disc
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
      ctx.clip();

      // Void background outside playable 1200x1200m map edge
      ctx.fillStyle = '#0a100c';
      ctx.fillRect(0, 0, cssSize, cssSize);

      const pxPerMeter = mapR / MINIMAP_VIEW_RADIUS_METERS;
      const mapDrawScale = (WORLD_SIZE / BASE_MAP_PX) * pxPerMeter;
      const pBase = worldToBaseMapPixel(playerX, playerZ, BASE_MAP_PX);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(playerYaw);
      ctx.scale(mapDrawScale, mapDrawScale);
      ctx.drawImage(baseCanvas, -pBase.px, -pBase.pz);
      ctx.restore();

      // View-cone wedge pointing straight ahead (12 o'clock)
      const coneGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, mapR * 0.72);
      coneGrad.addColorStop(0, 'rgba(246, 230, 186, 0.24)');
      coneGrad.addColorStop(1, 'rgba(246, 230, 186, 0.0)');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, mapR * 0.72, -Math.PI * 0.5 - 0.58, -Math.PI * 0.5 + 0.58);
      ctx.closePath();
      ctx.fill();

      // Soft inner disc rim shadow
      const vig = ctx.createRadialGradient(cx, cy, mapR * 0.62, cx, cy, mapR);
      vig.addColorStop(0, 'rgba(8, 12, 9, 0)');
      vig.addColorStop(1, 'rgba(8, 12, 9, 0.55)');
      ctx.fillStyle = vig;
      ctx.beginPath();
      ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
      ctx.fill();

      // Center player directional chevron
      ctx.fillStyle = '#f7e5b4';
      ctx.strokeStyle = '#141a14';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 6.5);
      ctx.lineTo(cx + 4.8, cy + 5.0);
      ctx.lineTo(cx, cy + 2.4);
      ctx.lineTo(cx - 4.8, cy + 5.0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();

      // Inner disc ring
      ctx.strokeStyle = 'rgba(210, 224, 200, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
      ctx.stroke();

      // 2. Rotating Compass Degree Ticks & Cardinal Markers (N, E, S, W)
      const tickInner = mapR + 1.5;
      for (let deg = 0; deg < 360; deg += 15) {
        // Angle on screen in heading-up mode: North is -PI/2 + playerYaw
        const screenAngle = -Math.PI * 0.5 + (deg * Math.PI) / 180 + playerYaw;
        const isCardinal = deg % 90 === 0;
        const isIntercardinal = deg % 45 === 0 && !isCardinal;
        const tickLen = isCardinal ? 0 : isIntercardinal ? 4.5 : 2.6;
        if (tickLen > 0) {
          const cosA = Math.cos(screenAngle);
          const sinA = Math.sin(screenAngle);
          ctx.strokeStyle = isIntercardinal
            ? 'rgba(218, 228, 206, 0.55)'
            : 'rgba(176, 194, 172, 0.32)';
          ctx.lineWidth = isIntercardinal ? 1.2 : 0.9;
          ctx.beginPath();
          ctx.moveTo(cx + cosA * tickInner, cy + sinA * tickInner);
          ctx.lineTo(cx + cosA * (tickInner + tickLen), cy + sinA * (tickInner + tickLen));
          ctx.stroke();
        }
      }

      const cardinals: Array<{ label: string; deg: number; isNorth: boolean }> = [
        { label: 'N', deg: 0, isNorth: true },
        { label: 'E', deg: 90, isNorth: false },
        { label: 'S', deg: 180, isNorth: false },
        { label: 'W', deg: 270, isNorth: false },
      ];
      const labelRadius = mapR + 7.4;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const c of cardinals) {
        const screenAngle = -Math.PI * 0.5 + (c.deg * Math.PI) / 180 + playerYaw;
        const lx = cx + Math.cos(screenAngle) * labelRadius;
        const ly = cy + Math.sin(screenAngle) * labelRadius;

        if (c.isNorth) {
          ctx.fillStyle = '#c44937';
          ctx.beginPath();
          ctx.arc(lx, ly, 6.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillStyle = '#fff5ee';
        } else {
          ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillStyle = '#d3e0cf';
        }
        ctx.fillText(c.label, lx, ly + 0.4);
      }

      // 3. Fixed 12-o'clock forward lubber notch on inner map rim (never overlaps N badge)
      ctx.fillStyle = '#f3d89b';
      ctx.beginPath();
      ctx.moveTo(cx, cy - mapR + 5.5);
      ctx.lineTo(cx - 3.2, cy - mapR + 0.5);
      ctx.lineTo(cx + 3.2, cy - mapR + 0.5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    },

    dispose(): void {
      rasterCanvas.width = 0;
      rasterCanvas.height = 0;
      baseCanvas.width = 0;
      baseCanvas.height = 0;
    },
  };
}
