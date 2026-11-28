import {
  clamp,
  getActiveBlueprint,
  getNearestSwampIsland,
  getSwampFactor,
  getTerrainHeight,
  getThicketFactor,
  getWaterSurfaceAt,
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

      // Subtle NW hillshade scaled for 20-40m Estonian moraine hills
      const slope = (h - hRight) * 0.42 + (h - hDown) * 0.42;
      const shade = clamp(1 + slope * 0.12, 0.7, 1.26);

      const isl = getNearestSwampIsland(wx, wz, bp);
      const onIsland = isl.island !== null && isl.islandMask > 0.38;
      const swamp = onIsland ? 0 : getSwampFactor(wx, wz, bp);
      const thicket = getThicketFactor(wx, wz);
      const water = getWaterSurfaceAt(wx, wz, bp, h);

      let r = 56;
      let g = 88;
      let b = 44;

      if (water.hasWater) {
        if (water.kind === 'lake') {
          const depth = clamp(water.depth * 0.42, 0, 1);
          r = 46 - depth * 16;
          g = 112 - depth * 32;
          b = 138 - depth * 24;
        } else if (water.kind === 'stream') {
          r = 56;
          g = 124;
          b = 148;
        } else {
          // Dark reflective bog pool water (laugastik)
          const depth = clamp((SWAMP_WATER_Y - h) * 1.6, 0, 1);
          r = 25 - depth * 7;
          g = 51 - depth * 11;
          b = 60 - depth * 8;
        }
      } else if (swamp > 0.35 && !onIsland) {
        // Expansive flat sphagnum peat bog plain
        r = 86 + swamp * 16;
        g = 86 - swamp * 3;
        b = 45;
      } else if (onIsland) {
        // Raised dry bog island
        r = 70;
        g = 98;
        b = 49;
      } else if (thicket > 0.56) {
        // Dense spruce thicket with mild elevation lift on hillsides
        const t = clamp((thicket - 0.56) / 0.44, 0, 1);
        const elevLift = clamp((h - 4) * 0.45, 0, 14);
        r = 52 - t * 22 + elevLift * 0.65;
        g = 84 - t * 28 + elevLift * 0.7;
        b = 42 - t * 14 + elevLift * 0.4;
      } else {
        // Birch / pine / upland countryside with clear 20-40m elevation hypsometry
        const elevBoost = clamp((h - 1.5) * 1.15, -6, 30);
        r = 58 + elevBoost * 0.95;
        g = 91 + elevBoost * 0.75;
        b = 46 + elevBoost * 0.42;
      }

      // Crisp 6m topographic contour lines across dry hills & ridges
      let contourMult = 1.0;
      if (!water.hasWater && swamp < 0.35 && h > 1.5) {
        const band = Math.floor(h / 6);
        const bandRight = Math.floor(hRight / 6);
        const bandDown = Math.floor(hDown / 6);
        if (band !== bandRight || band !== bandDown) {
          contourMult = 0.84;
        }
      }

      const finalShade = water.hasWater ? 1.0 : shade * contourMult;
      const idx = (py * size + px) * 4;
      data[idx] = clamp(Math.round(r * finalShade), 0, 255);
      data[idx + 1] = clamp(Math.round(g * finalShade), 0, 255);
      data[idx + 2] = clamp(Math.round(b * finalShade), 0, 255);
      data[idx + 3] = 255;
    }
  }

  return data;
}

export const FOG_GRID_SIZE = 160; // 7.5m per cell across 1200x1200m countryside
export const DEFAULT_FOG_REVEAL_RADIUS_M = 84;
export const DEFAULT_FOG_FEATHER_M = 28;

export interface FullMapCampfireMarker {
  x: number;
  z: number;
  lit: boolean;
}

export interface FullMapDrawOptions {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  mode: 'none' | 'compass' | 'map' | 'both';
  zoom: number;
  panX: number; // world meters offset from world center (0, 0)
  panZ: number;
  campfires?: FullMapCampfireMarker[];
  tents?: Array<{ x: number; z: number }>;
  bogLabel?: string;
}

/**
 * Pure, high-resolution fog-of-war visibility mask covering the 1200x1200m world.
 * Stores 0 (unexplored fog) to 255 (fully revealed) with smooth radial feathering.
 */
export class FogOfWarMap {
  readonly gridSize: number;
  readonly cells: Uint8Array;
  private _version = 0;
  private revealedWeightSum = 0;

  constructor(gridSize = FOG_GRID_SIZE) {
    this.gridSize = gridSize;
    this.cells = new Uint8Array(gridSize * gridSize);
  }

  get version(): number {
    return this._version;
  }

  /**
   * Smoothly reveals terrain around (worldX, worldZ) with a soft feathered edge.
   * Returns true if at least one cell became more revealed.
   */
  revealAt(
    worldX: number,
    worldZ: number,
    radiusMeters = DEFAULT_FOG_REVEAL_RADIUS_M,
    featherMeters = DEFAULT_FOG_FEATHER_M
  ): boolean {
    const size = this.gridSize;
    const cellMeters = WORLD_SIZE / size;
    const innerR = Math.max(0, radiusMeters - featherMeters);
    const featherSpan = Math.max(0.001, radiusMeters - innerR);

    const minGx = clamp(
      Math.floor(((worldX - radiusMeters + WORLD_HALF) / WORLD_SIZE) * size),
      0,
      size - 1
    );
    const maxGx = clamp(
      Math.ceil(((worldX + radiusMeters + WORLD_HALF) / WORLD_SIZE) * size),
      0,
      size - 1
    );
    const minGz = clamp(
      Math.floor(((worldZ - radiusMeters + WORLD_HALF) / WORLD_SIZE) * size),
      0,
      size - 1
    );
    const maxGz = clamp(
      Math.ceil(((worldZ + radiusMeters + WORLD_HALF) / WORLD_SIZE) * size),
      0,
      size - 1
    );

    const rSq = radiusMeters * radiusMeters;
    let changed = false;

    for (let gz = minGz; gz <= maxGz; gz++) {
      const wz = -WORLD_HALF + (gz + 0.5) * cellMeters;
      const dz = wz - worldZ;
      const dzSq = dz * dz;
      const rowOffset = gz * size;
      for (let gx = minGx; gx <= maxGx; gx++) {
        const wx = -WORLD_HALF + (gx + 0.5) * cellMeters;
        const dx = wx - worldX;
        const distSq = dx * dx + dzSq;
        if (distSq >= rSq) continue;

        const dist = Math.sqrt(distSq);
        let alpha = 255;
        if (dist > innerR) {
          const t = clamp(1 - (dist - innerR) / featherSpan, 0, 1);
          const smooth = t * t * (3 - 2 * t);
          alpha = Math.round(smooth * 255);
        }

        const idx = rowOffset + gx;
        const prev = this.cells[idx];
        if (alpha > prev) {
          this.cells[idx] = alpha;
          this.revealedWeightSum += alpha - prev;
          changed = true;
        }
      }
    }

    if (changed) this._version++;
    return changed;
  }

  getAlphaAt(worldX: number, worldZ: number): number {
    const gx = clamp(
      Math.floor(((worldX + WORLD_HALF) / WORLD_SIZE) * this.gridSize),
      0,
      this.gridSize - 1
    );
    const gz = clamp(
      Math.floor(((worldZ + WORLD_HALF) / WORLD_SIZE) * this.gridSize),
      0,
      this.gridSize - 1
    );
    return this.cells[gz * this.gridSize + gx];
  }

  isExploredAt(worldX: number, worldZ: number, threshold = 110): boolean {
    return this.getAlphaAt(worldX, worldZ) >= threshold;
  }

  getExploredPercent(): number {
    if (this.revealedWeightSum <= 0) return 0;
    const raw = (this.revealedWeightSum / (this.cells.length * 255)) * 100;
    return clamp(Math.max(1, Math.round(raw)), 0, 100);
  }

  revealAll(): void {
    this.cells.fill(255);
    this.revealedWeightSum = this.cells.length * 255;
    this._version++;
  }

  reset(): void {
    this.cells.fill(0);
    this.revealedWeightSum = 0;
    this._version++;
  }
}

export interface MinimapRenderer {
  draw: (
    targetCanvas: HTMLCanvasElement,
    playerX: number,
    playerZ: number,
    playerYaw: number,
    mode?: 'none' | 'compass' | 'map' | 'both'
  ) => void;
  drawFullMap: (targetCanvas: HTMLCanvasElement, opts: FullMapDrawOptions) => void;
  dispose: () => void;
}

const BASE_MAP_PX = 600; // 2m per pixel across 1200x1200m countryside
const RASTER_PX = 260;

function fogNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => {
    let v = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ 0x27d4eb2d;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const n00 = h(ix, iy);
  const n10 = h(ix + 1, iy);
  const n01 = h(ix, iy + 1);
  const n11 = h(ix + 1, iy + 1);
  return n00 + (n10 - n00) * ux + (n01 - n00) * uy + (n00 - n10 - n01 + n11) * ux * uy;
}

export function createMinimapRenderer(
  bp: WorldBlueprint = getActiveBlueprint(),
  boardwalkZones: MinimapBoardwalkRect[] = [],
  fogOfWar?: FogOfWarMap
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

  // Subtle paper topographic map warmth & faint coordinate gridlines
  bCtx.fillStyle = 'rgba(232, 218, 184, 0.22)';
  bCtx.fillRect(0, 0, BASE_MAP_PX, BASE_MAP_PX);
  bCtx.strokeStyle = 'rgba(240, 232, 206, 0.18)';
  bCtx.lineWidth = 1.4;
  for (let g = 1; g < 6; g++) {
    const pos = (g / 6) * BASE_MAP_PX;
    bCtx.beginPath();
    bCtx.moveTo(pos, 0);
    bCtx.lineTo(pos, BASE_MAP_PX);
    bCtx.stroke();
    bCtx.beginPath();
    bCtx.moveTo(0, pos);
    bCtx.lineTo(BASE_MAP_PX, pos);
    bCtx.stroke();
  }

  // Draw flowing downhill streams cleanly on top of terrain raster
  bCtx.lineCap = 'round';
  bCtx.lineJoin = 'round';
  for (const stream of bp.streams) {
    if (stream.points.length < 2) continue;
    bCtx.strokeStyle = 'rgba(66, 152, 184, 0.88)';
    bCtx.lineWidth = 1.9;
    bCtx.beginPath();
    for (let i = 0; i < stream.points.length; i++) {
      const pt = worldToBaseMapPixel(stream.points[i].x, stream.points[i].z, BASE_MAP_PX);
      if (i === 0) bCtx.moveTo(pt.px, pt.pz);
      else bCtx.lineTo(pt.px, pt.pz);
    }
    bCtx.stroke();
  }

  // Draw forest trails first, then main gravel roads on top (supports any road topology)
  for (const seg of bp.roadSegments) {
    if (!seg.isTrail) continue;
    const a = worldToBaseMapPixel(seg.ax, seg.az, BASE_MAP_PX);
    const b = worldToBaseMapPixel(seg.bx, seg.bz, BASE_MAP_PX);
    bCtx.strokeStyle = '#b69c73';
    bCtx.lineWidth = 3.4;
    bCtx.beginPath();
    bCtx.moveTo(a.px, a.pz);
    bCtx.lineTo(b.px, b.pz);
    bCtx.stroke();
  }
  for (const seg of bp.roadSegments) {
    if (seg.isTrail) continue;
    const a = worldToBaseMapPixel(seg.ax, seg.az, BASE_MAP_PX);
    const b = worldToBaseMapPixel(seg.bx, seg.bz, BASE_MAP_PX);
    bCtx.strokeStyle = 'rgba(34, 28, 20, 0.42)';
    bCtx.lineWidth = seg.isMainRoad ? 8.2 : 6.8;
    bCtx.beginPath();
    bCtx.moveTo(a.px, a.pz);
    bCtx.lineTo(b.px, b.pz);
    bCtx.stroke();
    bCtx.strokeStyle = '#dcc598';
    bCtx.lineWidth = seg.isMainRoad ? 6.2 : 4.8;
    bCtx.beginPath();
    bCtx.moveTo(a.px, a.pz);
    bCtx.lineTo(b.px, b.pz);
    bCtx.stroke();
  }

  // Draw bog boardwalks
  bCtx.fillStyle = '#e5bd7c';
  for (const bw of boardwalkZones) {
    const minP = worldToBaseMapPixel(bw.minX, bw.minZ, BASE_MAP_PX);
    const maxP = worldToBaseMapPixel(bw.maxX, bw.maxZ, BASE_MAP_PX);
    bCtx.fillRect(
      minP.px,
      minP.pz,
      Math.max(2.6, maxP.px - minP.px),
      Math.max(2.6, maxP.pz - minP.pz)
    );
  }

  // Draw per-house village clearings and all spread-out village building footprints
  for (const v of bp.villages) {
    for (const bld of v.buildings) {
      const hx = v.x + bld.offsetX;
      const hz = v.z + bld.offsetZ;
      const bpPos = worldToBaseMapPixel(hx, hz, BASE_MAP_PX);
      const clearR = (bld.clearingRadius / WORLD_SIZE) * BASE_MAP_PX;
      bCtx.fillStyle = 'rgba(182, 192, 130, 0.34)';
      bCtx.beginPath();
      bCtx.arc(bpPos.px, bpPos.pz, clearR, 0, Math.PI * 2);
      bCtx.fill();

      const wPx = Math.max(5.0, (bld.w / WORLD_SIZE) * BASE_MAP_PX);
      const dPx = Math.max(4.0, (bld.d / WORLD_SIZE) * BASE_MAP_PX);
      bCtx.save();
      bCtx.translate(bpPos.px, bpPos.pz);
      bCtx.rotate(-bld.rotY);
      bCtx.fillStyle =
        bld.decayState === 'ruins'
          ? '#979488'
          : bld.abandoned
            ? '#bcb6a6'
            : '#f0ca8a';
      bCtx.strokeStyle = 'rgba(24, 22, 16, 0.88)';
      bCtx.lineWidth = 1.2;
      bCtx.fillRect(-wPx * 0.5, -dPx * 0.5, wPx, dPx);
      bCtx.strokeRect(-wPx * 0.5, -dPx * 0.5, wPx, dPx);
      bCtx.restore();
    }
  }

  // Draw swamp island huts
  for (const isl of bp.swampIslands) {
    if (!isl.hut) continue;
    const hp = worldToBaseMapPixel(isl.x, isl.z, BASE_MAP_PX);
    const wPx = Math.max(4.6, (isl.hut.w / WORLD_SIZE) * BASE_MAP_PX);
    const dPx = Math.max(3.8, (isl.hut.d / WORLD_SIZE) * BASE_MAP_PX);
    bCtx.save();
    bCtx.translate(hp.px, hp.pz);
    bCtx.rotate(-isl.hut.rotY);
    bCtx.fillStyle = isl.hut.decayState === 'ruins' ? '#a5a092' : '#ddb078';
    bCtx.strokeStyle = 'rgba(24, 22, 16, 0.8)';
    bCtx.lineWidth = 1;
    bCtx.fillRect(-wPx * 0.5, -dPx * 0.5, wPx, dPx);
    bCtx.strokeRect(-wPx * 0.5, -dPx * 0.5, wPx, dPx);
    bCtx.restore();
  }

  // Draw trail-less abandoned decrepit forest huts
  for (const fh of bp.forestHuts) {
    const fp = worldToBaseMapPixel(fh.x, fh.z, BASE_MAP_PX);
    const wPx = Math.max(4.4, (fh.w / WORLD_SIZE) * BASE_MAP_PX);
    const dPx = Math.max(3.6, (fh.d / WORLD_SIZE) * BASE_MAP_PX);
    bCtx.save();
    bCtx.translate(fp.px, fp.pz);
    bCtx.rotate(-fh.rotY);
    bCtx.fillStyle = fh.decayState === 'ruins' ? '#928d82' : '#baa88c';
    bCtx.strokeStyle = 'rgba(20, 18, 14, 0.85)';
    bCtx.lineWidth = 1.1;
    bCtx.fillRect(-wPx * 0.5, -dPx * 0.5, wPx, dPx);
    bCtx.strokeRect(-wPx * 0.5, -dPx * 0.5, wPx, dPx);
    bCtx.restore();
  }

  // Subtle boundary border
  bCtx.strokeStyle = 'rgba(235, 210, 165, 0.38)';
  bCtx.lineWidth = 2.5;
  bCtx.strokeRect(2, 2, BASE_MAP_PX - 4, BASE_MAP_PX - 4);

  // Bake atmospheric Unexplored Fog-of-War backdrop once (deep pine mist + subtle survey grid)
  const fogBackdropLow = document.createElement('canvas');
  fogBackdropLow.width = 160;
  fogBackdropLow.height = 160;
  const fblCtx = fogBackdropLow.getContext('2d')!;
  const fblData = fblCtx.createImageData(160, 160);
  for (let py = 0; py < 160; py++) {
    for (let px = 0; px < 160; px++) {
      const n1 = fogNoise2D(px * 0.075, py * 0.075);
      const n2 = fogNoise2D(px * 0.19 + 17.3, py * 0.19 - 11.7);
      const mist = n1 * 0.68 + n2 * 0.32;
      const idx = (py * 160 + px) * 4;
      fblData.data[idx] = Math.round(13 + mist * 11);
      fblData.data[idx + 1] = Math.round(20 + mist * 14);
      fblData.data[idx + 2] = Math.round(16 + mist * 11);
      fblData.data[idx + 3] = 255;
    }
  }
  fblCtx.putImageData(fblData, 0, 0);

  const unexploredCanvas = document.createElement('canvas');
  unexploredCanvas.width = BASE_MAP_PX;
  unexploredCanvas.height = BASE_MAP_PX;
  const uCtx = unexploredCanvas.getContext('2d')!;
  uCtx.imageSmoothingEnabled = true;
  uCtx.drawImage(fogBackdropLow, 0, 0, BASE_MAP_PX, BASE_MAP_PX);

  // Faint cartographic survey grid visible through the mist
  uCtx.strokeStyle = 'rgba(182, 204, 178, 0.08)';
  uCtx.lineWidth = 1.1;
  for (let g = 1; g < 6; g++) {
    const pos = (g / 6) * BASE_MAP_PX;
    uCtx.beginPath();
    uCtx.moveTo(pos, 0);
    uCtx.lineTo(pos, BASE_MAP_PX);
    uCtx.stroke();
    uCtx.beginPath();
    uCtx.moveTo(0, pos);
    uCtx.lineTo(BASE_MAP_PX, pos);
    uCtx.stroke();
  }
  uCtx.strokeStyle = 'rgba(186, 202, 180, 0.16)';
  uCtx.lineWidth = 2;
  uCtx.strokeRect(2, 2, BASE_MAP_PX - 4, BASE_MAP_PX - 4);

  // Reusable Fog-of-War mask & compositing canvases (zero per-frame allocations)
  const fogGrid = fogOfWar ? fogOfWar.gridSize : FOG_GRID_SIZE;
  const fogMaskCanvas = document.createElement('canvas');
  fogMaskCanvas.width = fogGrid;
  fogMaskCanvas.height = fogGrid;
  const fmCtx = fogMaskCanvas.getContext('2d')!;
  const fogMaskImg = fmCtx.createImageData(fogGrid, fogGrid);

  const maskedTerrainCanvas = document.createElement('canvas');
  maskedTerrainCanvas.width = BASE_MAP_PX;
  maskedTerrainCanvas.height = BASE_MAP_PX;
  const mtCtx = maskedTerrainCanvas.getContext('2d')!;

  const compositedCanvas = document.createElement('canvas');
  compositedCanvas.width = BASE_MAP_PX;
  compositedCanvas.height = BASE_MAP_PX;
  const compCtx = compositedCanvas.getContext('2d')!;

  let lastSyncedFogVersion = -1;

  function getActiveMapCanvas(): HTMLCanvasElement {
    if (!fogOfWar) return baseCanvas;
    if (fogOfWar.version !== lastSyncedFogVersion) {
      lastSyncedFogVersion = fogOfWar.version;
      const cells = fogOfWar.cells;
      const d = fogMaskImg.data;
      for (let i = 0; i < cells.length; i++) {
        const o = i * 4;
        d[o] = 255;
        d[o + 1] = 255;
        d[o + 2] = 255;
        d[o + 3] = cells[i];
      }
      fmCtx.putImageData(fogMaskImg, 0, 0);

      // Mask the full terrain map by smooth upscaled fog alpha
      mtCtx.globalCompositeOperation = 'source-over';
      mtCtx.clearRect(0, 0, BASE_MAP_PX, BASE_MAP_PX);
      mtCtx.drawImage(baseCanvas, 0, 0);
      mtCtx.globalCompositeOperation = 'destination-in';
      mtCtx.imageSmoothingEnabled = true;
      mtCtx.drawImage(fogMaskCanvas, 0, 0, BASE_MAP_PX, BASE_MAP_PX);
      mtCtx.globalCompositeOperation = 'source-over';

      // Composite revealed terrain cleanly over the atmospheric unexplored mist
      compCtx.clearRect(0, 0, BASE_MAP_PX, BASE_MAP_PX);
      compCtx.drawImage(unexploredCanvas, 0, 0);
      compCtx.drawImage(maskedTerrainCanvas, 0, 0);
    }
    return compositedCanvas;
  }

  const cssSize = 148;
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  function drawCompassRing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    innerR: number,
    playerYaw: number
  ): void {
    const tickInner = innerR + 1.5;
    for (let deg = 0; deg < 360; deg += 15) {
      const screenAngle = -Math.PI * 0.5 + (deg * Math.PI) / 180 + playerYaw;
      const isCardinal = deg % 90 === 0;
      const isIntercardinal = deg % 45 === 0 && !isCardinal;
      const tickLen = isCardinal ? 0 : isIntercardinal ? 4.8 : 2.6;
      if (tickLen > 0) {
        const cosA = Math.cos(screenAngle);
        const sinA = Math.sin(screenAngle);
        ctx.strokeStyle = isIntercardinal
          ? 'rgba(222, 232, 210, 0.6)'
          : 'rgba(176, 194, 172, 0.34)';
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
    const labelRadius = innerR + 7.4;
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

    // Fixed 12-o'clock forward lubber notch
    ctx.fillStyle = '#f3d89b';
    ctx.beginPath();
    ctx.moveTo(cx, cy - innerR + 5.5);
    ctx.lineTo(cx - 3.2, cy - innerR + 0.5);
    ctx.lineTo(cx + 3.2, cy - innerR + 0.5);
    ctx.closePath();
    ctx.fill();
  }

  return {
    draw(
      targetCanvas: HTMLCanvasElement,
      playerX: number,
      playerZ: number,
      playerYaw: number,
      mode: 'none' | 'compass' | 'map' | 'both' = 'both'
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

      if (mode === 'none') {
        ctx.restore();
        return;
      }

      const cx = cssSize * 0.5;
      const cy = cssSize * 0.5;
      const outerR = cssSize * 0.5 - 2;

      if (mode === 'compass') {
        // Pure magnetic compass dial — NO terrain map!
        const dialR = outerR - 14;
        ctx.fillStyle = '#0d1410';
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.fill();

        const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, dialR);
        grad.addColorStop(0, '#18241c');
        grad.addColorStop(1, '#0b110d');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, dialR, 0, Math.PI * 2);
        ctx.fill();

        // Subtle inner crosshair & concentric compass rings
        ctx.strokeStyle = 'rgba(186, 206, 180, 0.14)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(cx, cy, dialR * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - dialR * 0.8, cy);
        ctx.lineTo(cx + dialR * 0.8, cy);
        ctx.moveTo(cx, cy - dialR * 0.8);
        ctx.lineTo(cx, cy + dialR * 0.8);
        ctx.stroke();

        // Magnetic needle pointing toward world North (rotates live with playerYaw)
        const northAngle = -Math.PI * 0.5 + playerYaw;
        const needleLen = dialR * 0.72;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(northAngle + Math.PI * 0.5);

        // Red North tip
        ctx.fillStyle = '#c84b38';
        ctx.beginPath();
        ctx.moveTo(0, -needleLen);
        ctx.lineTo(5.2, 0);
        ctx.lineTo(-5.2, 0);
        ctx.closePath();
        ctx.fill();

        // Pale steel South tail
        ctx.fillStyle = '#cfd9cd';
        ctx.beginPath();
        ctx.moveTo(0, needleLen * 0.82);
        ctx.lineTo(4.6, 0);
        ctx.lineTo(-4.6, 0);
        ctx.closePath();
        ctx.fill();

        // Brass pivot pin
        ctx.fillStyle = '#e5c685';
        ctx.beginPath();
        ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.strokeStyle = 'rgba(210, 224, 200, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, dialR, 0, Math.PI * 2);
        ctx.stroke();

        drawCompassRing(ctx, cx, cy, dialR, playerYaw);
        ctx.restore();
        return;
      }

      const mapSource = getActiveMapCanvas();

      if (mode === 'map') {
        // Static North-up Paper Topographic Map with Fog-of-War — NO rotation, NO GPS player position!
        const mapR = outerR - 3;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
        ctx.clip();

        ctx.drawImage(mapSource, cx - mapR, cy - mapR, mapR * 2, mapR * 2);

        // Soft paper vignette around rim
        const vig = ctx.createRadialGradient(cx, cy, mapR * 0.65, cx, cy, mapR);
        vig.addColorStop(0, 'rgba(12, 16, 12, 0)');
        vig.addColorStop(1, 'rgba(10, 14, 10, 0.5)');
        ctx.fillStyle = vig;
        ctx.beginPath();
        ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
        ctx.fill();

        // Fixed printed cartographic North mark at top of paper sheet
        ctx.fillStyle = 'rgba(16, 22, 17, 0.78)';
        ctx.beginPath();
        ctx.arc(cx, cy - mapR + 12, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = '#e9dec2';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', cx, cy - mapR + 12.4);

        ctx.restore();

        ctx.strokeStyle = 'rgba(222, 208, 176, 0.42)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
        return;
      }

      // mode === 'both': Live Player-Centered Heading-Up Topographic Map with Fog-of-War + Rotating Compass Ring
      const mapR = outerR - 14;
      const viewRadiusMeters = 210;
      const pxPerMeter = mapR / viewRadiusMeters;
      const basePxPerMeter = BASE_MAP_PX / WORLD_SIZE;
      const drawScale = pxPerMeter / basePxPerMeter;
      const playerBase = worldToBaseMapPixel(playerX, playerZ, BASE_MAP_PX);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
      ctx.clip();

      // Deep uncharted forest backdrop outside world border
      ctx.fillStyle = '#0e1611';
      ctx.fillRect(cx - mapR, cy - mapR, mapR * 2, mapR * 2);

      // Translate to center, orient heading-up by playerYaw, and shift fog-masked map to player's exact position
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(playerYaw);
      ctx.scale(drawScale, drawScale);
      ctx.drawImage(mapSource, -playerBase.px, -playerBase.pz);
      ctx.restore();

      // Subtle forward viewing cone
      const coneGrad = ctx.createRadialGradient(cx, cy, 3, cx, cy, mapR * 0.56);
      coneGrad.addColorStop(0, 'rgba(248, 228, 168, 0.24)');
      coneGrad.addColorStop(1, 'rgba(248, 228, 168, 0)');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, mapR * 0.56, -Math.PI * 0.5 - 0.46, -Math.PI * 0.5 + 0.46);
      ctx.closePath();
      ctx.fill();

      // Rim vignette
      const vig = ctx.createRadialGradient(cx, cy, mapR * 0.62, cx, cy, mapR);
      vig.addColorStop(0, 'rgba(8, 12, 9, 0)');
      vig.addColorStop(1, 'rgba(8, 12, 9, 0.52)');
      ctx.fillStyle = vig;
      ctx.beginPath();
      ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
      ctx.fill();

      // Crisp player position chevron at center (pointing forward / up)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = '#fff5d6';
      ctx.strokeStyle = '#111612';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -7.2);
      ctx.lineTo(5.2, 5.2);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-5.2, 5.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.restore();

      ctx.strokeStyle = 'rgba(210, 224, 200, 0.34)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
      ctx.stroke();

      drawCompassRing(ctx, cx, cy, mapR, playerYaw);

      ctx.restore();
    },

    drawFullMap(targetCanvas: HTMLCanvasElement, opts: FullMapDrawOptions): void {
      const rect = targetCanvas.getBoundingClientRect();
      const cssW = Math.max(240, Math.round(rect.width || targetCanvas.clientWidth || 720));
      const cssH = Math.max(240, Math.round(rect.height || targetCanvas.clientHeight || 560));
      const fullDpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      const pxW = Math.round(cssW * fullDpr);
      const pxH = Math.round(cssH * fullDpr);
      if (targetCanvas.width !== pxW || targetCanvas.height !== pxH) {
        targetCanvas.width = pxW;
        targetCanvas.height = pxH;
      }

      const ctx = targetCanvas.getContext('2d');
      if (!ctx) return;

      const mapSource = getActiveMapCanvas();
      const hasPaperMap = opts.mode === 'map' || opts.mode === 'both';
      const hasLivePos = opts.mode === 'both';
      const zoom = clamp(opts.zoom, 1, 3.6);

      // Fit full 1200x1200m world comfortably inside viewport at zoom = 1
      const pad = 28;
      const baseFitPx = Math.max(180, Math.min(cssW - pad * 2, cssH - pad * 2));
      const pxPerMeter = (baseFitPx * zoom) / WORLD_SIZE;
      const worldDrawSize = WORLD_SIZE * pxPerMeter;

      // Clamp pan so map stays nicely framed
      const maxPanM = WORLD_HALF * Math.max(0, 1 - 1 / zoom);
      const panX = clamp(opts.panX, -maxPanM, maxPanM);
      const panZ = clamp(opts.panZ, -maxPanM, maxPanM);

      const centerX = cssW * 0.5;
      const centerY = cssH * 0.5;
      const worldToScreen = (wx: number, wz: number) => ({
        sx: centerX + (wx - panX) * pxPerMeter,
        sy: centerY + (wz - panZ) * pxPerMeter,
      });

      ctx.save();
      ctx.scale(fullDpr, fullDpr);

      // Deep cartographic table backdrop outside map sheet
      ctx.fillStyle = '#090e0b';
      ctx.fillRect(0, 0, cssW, cssH);

      const topLeft = worldToScreen(-WORLD_HALF, -WORLD_HALF);

      // Draw Fog-of-War masked world sheet
      ctx.save();
      ctx.beginPath();
      ctx.rect(topLeft.sx, topLeft.sy, worldDrawSize, worldDrawSize);
      ctx.clip();

      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mapSource, topLeft.sx, topLeft.sy, worldDrawSize, worldDrawSize);

      // Without Paper Map equipped, tint revealed terrain as a muted hand-remembered field sketch
      if (!hasPaperMap) {
        ctx.fillStyle = 'rgba(18, 25, 20, 0.38)';
        ctx.fillRect(topLeft.sx, topLeft.sy, worldDrawSize, worldDrawSize);
      }

      // Subtle coordinate gridlines every 200m on Paper Map
      if (hasPaperMap) {
        ctx.strokeStyle = 'rgba(228, 220, 194, 0.11)';
        ctx.lineWidth = 1;
        for (let m = -400; m <= 400; m += 200) {
          const vLine = worldToScreen(m, -WORLD_HALF);
          ctx.beginPath();
          ctx.moveTo(vLine.sx, topLeft.sy);
          ctx.lineTo(vLine.sx, topLeft.sy + worldDrawSize);
          ctx.stroke();

          const hLine = worldToScreen(-WORLD_HALF, m);
          ctx.beginPath();
          ctx.moveTo(topLeft.sx, hLine.sy);
          ctx.lineTo(topLeft.sx + worldDrawSize, hLine.sy);
          ctx.stroke();
        }
      }

      // Draw discovered Bog Region label if explored
      if (!fogOfWar || fogOfWar.isExploredAt(bp.bogCenterX, bp.bogCenterZ, 95)) {
        const bogPt = worldToScreen(bp.bogCenterX, bp.bogCenterZ);
        ctx.save();
        ctx.font = 'italic 600 12px Georgia, "Times New Roman", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(8, 14, 14, 0.72)';
        const label = opts.bogLabel ?? 'Peat Bog';
        ctx.fillText(label, bogPt.sx + 1, bogPt.sy + 1);
        ctx.fillStyle = 'rgba(166, 208, 218, 0.85)';
        ctx.fillText(label, bogPt.sx, bogPt.sy);
        ctx.restore();
      }

      const placedLabels: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
      const overlapsLabel = (x0: number, y0: number, x1: number, y1: number): boolean => {
        for (let i = 0; i < placedLabels.length; i++) {
          const b = placedLabels[i];
          if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0) return true;
        }
        return false;
      };

      // Draw discovered Village labels (hidden under fog until explored!)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (const v of bp.villages) {
        const revealed = !fogOfWar || fogOfWar.isExploredAt(v.x, v.z, 110);
        if (!revealed) continue;
        const vp = worldToScreen(v.x, v.z);
        const baseOffset = Math.max(10, v.clearingRadius * 0.45 * pxPerMeter);

        ctx.font = '600 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
        const textW = ctx.measureText(v.name).width;
        const boxW = textW + 10;
        const boxH = 16;
        // Try above village first, then below, then shifted further if crowded
        const candidateYs = [
          vp.sy - baseOffset,
          vp.sy + baseOffset + boxH,
          vp.sy - baseOffset - boxH - 3,
          vp.sy + baseOffset + boxH * 2 + 3,
        ];
        let labelY = candidateYs[0];
        for (const cy of candidateYs) {
          if (!overlapsLabel(vp.sx - boxW * 0.5 - 2, cy - boxH - 1, vp.sx + boxW * 0.5 + 2, cy + 3)) {
            labelY = cy;
            break;
          }
        }
        placedLabels.push({
          x0: vp.sx - boxW * 0.5 - 2,
          y0: labelY - boxH - 1,
          x1: vp.sx + boxW * 0.5 + 2,
          y1: labelY + 3,
        });

        ctx.fillStyle = 'rgba(10, 15, 11, 0.78)';
        ctx.fillRect(vp.sx - boxW * 0.5, labelY - 14, boxW, boxH);
        ctx.strokeStyle = v.abandoned
          ? 'rgba(182, 178, 162, 0.35)'
          : 'rgba(235, 200, 132, 0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(vp.sx - boxW * 0.5, labelY - 14, boxW, boxH);

        ctx.fillStyle = v.abandoned ? '#d4d0c2' : '#f4ddb0';
        ctx.fillText(v.name, vp.sx, labelY - 2);
      }

      // Draw discovered Freshwater Lake labels
      for (const lk of bp.lakes) {
        const revealed = !fogOfWar || fogOfWar.isExploredAt(lk.x, lk.z, 100);
        if (!revealed) continue;
        const lp = worldToScreen(lk.x, lk.z);
        ctx.save();
        ctx.font = 'italic 600 11px Georgia, "Times New Roman", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lw = ctx.measureText(lk.name).width + 6;
        const ly = overlapsLabel(lp.sx - lw * 0.5, lp.sy - 8, lp.sx + lw * 0.5, lp.sy + 8)
          ? lp.sy + 14
          : lp.sy;
        placedLabels.push({ x0: lp.sx - lw * 0.5, y0: ly - 8, x1: lp.sx + lw * 0.5, y1: ly + 8 });
        ctx.fillStyle = 'rgba(8, 16, 20, 0.78)';
        ctx.fillText(lk.name, lp.sx + 1, ly + 1);
        ctx.fillStyle = '#9dd4e4';
        ctx.fillText(lk.name, lp.sx, ly);
        ctx.restore();
      }

      // Draw discovered Swamp Island labels (prioritize hut islands & larger islands, avoid overlap)
      const sortedIslands = [...bp.swampIslands].sort((a, b) => {
        if (Boolean(a.hut) !== Boolean(b.hut)) return a.hut ? -1 : 1;
        return b.radius - a.radius;
      });
      for (const isl of sortedIslands) {
        if (!isl.hut && isl.radius < 22) continue;
        const revealed = !fogOfWar || fogOfWar.isExploredAt(isl.x, isl.z, 110);
        if (!revealed) continue;
        const ip = worldToScreen(isl.x, isl.z);
        const shortName = isl.name.split(' (')[0];
        ctx.font = '500 10px ui-sans-serif, system-ui, -apple-system, sans-serif';
        const iw = ctx.measureText(shortName).width + 6;
        let labelY = ip.sy - 8;
        if (overlapsLabel(ip.sx - iw * 0.5, labelY - 11, ip.sx + iw * 0.5, labelY + 2)) {
          labelY = ip.sy + 14;
          if (overlapsLabel(ip.sx - iw * 0.5, labelY - 11, ip.sx + iw * 0.5, labelY + 2)) {
            continue;
          }
        }
        placedLabels.push({
          x0: ip.sx - iw * 0.5,
          y0: labelY - 11,
          x1: ip.sx + iw * 0.5,
          y1: labelY + 2,
        });
        ctx.fillStyle = 'rgba(10, 15, 11, 0.72)';
        ctx.fillText(shortName, ip.sx + 1, labelY + 1);
        ctx.fillStyle = '#c5d9bd';
        ctx.fillText(shortName, ip.sx, labelY);
      }

      // Draw discovered Campfire markers
      if (opts.campfires) {
        for (const cf of opts.campfires) {
          if (fogOfWar && !fogOfWar.isExploredAt(cf.x, cf.z, 100)) continue;
          const cp = worldToScreen(cf.x, cf.z);
          if (cf.lit) {
            const glow = ctx.createRadialGradient(cp.sx, cp.sy, 1, cp.sx, cp.sy, 10);
            glow.addColorStop(0, 'rgba(255, 166, 76, 0.75)');
            glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(cp.sx, cp.sy, 10, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = cf.lit ? '#ff9d47' : '#8c8a80';
          ctx.strokeStyle = '#121511';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(cp.sx, cp.sy, 3.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Draw discovered Pitched Tent markers
      if (opts.tents) {
        for (const tent of opts.tents) {
          if (fogOfWar && !fogOfWar.isExploredAt(tent.x, tent.z, 100)) continue;
          const tp = worldToScreen(tent.x, tent.z);
          ctx.save();
          ctx.translate(tp.sx, tp.sy);
          ctx.fillStyle = '#8ad192';
          ctx.strokeStyle = '#101712';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, -6.4);
          ctx.lineTo(6.2, 4.4);
          ctx.lineTo(-6.2, 4.4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          // Doorway dark notch
          ctx.fillStyle = '#18241b';
          ctx.beginPath();
          ctx.moveTo(0, -1.2);
          ctx.lineTo(2.2, 4.4);
          ctx.lineTo(-2.2, 4.4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // Live Player Position & Heading Cone (ONLY when both Map + Compass are equipped!)
      if (hasLivePos) {
        const pp = worldToScreen(opts.playerX, opts.playerZ);
        // Forward direction in world XZ: (-sin(yaw), -cos(yaw))
        const headingAngle = -Math.PI * 0.5 - opts.playerYaw;

        // Soft directional view cone
        const coneR = Math.max(26, 56 * pxPerMeter);
        const coneGrad = ctx.createRadialGradient(pp.sx, pp.sy, 4, pp.sx, pp.sy, coneR);
        coneGrad.addColorStop(0, 'rgba(248, 228, 168, 0.34)');
        coneGrad.addColorStop(1, 'rgba(248, 228, 168, 0)');
        ctx.fillStyle = coneGrad;
        ctx.beginPath();
        ctx.moveTo(pp.sx, pp.sy);
        ctx.arc(pp.sx, pp.sy, coneR, headingAngle - 0.44, headingAngle + 0.44);
        ctx.closePath();
        ctx.fill();

        // Outer halo ring
        ctx.strokeStyle = 'rgba(255, 244, 210, 0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(pp.sx, pp.sy, 11, 0, Math.PI * 2);
        ctx.stroke();

        // Directional chevron pointing toward player facing direction
        ctx.save();
        ctx.translate(pp.sx, pp.sy);
        ctx.rotate(-opts.playerYaw);
        ctx.fillStyle = '#fff5d6';
        ctx.strokeStyle = '#111612';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(0, -8.5);
        ctx.lineTo(6.2, 6.2);
        ctx.lineTo(0, 2.8);
        ctx.lineTo(-6.2, 6.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore(); // end map sheet clip

      // Crisp border around the 1200x1200m map sheet
      ctx.strokeStyle = hasPaperMap
        ? 'rgba(222, 206, 170, 0.42)'
        : 'rgba(176, 192, 174, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(topLeft.sx, topLeft.sy, worldDrawSize, worldDrawSize);

      // Fixed Cartographic North Rose in top-right corner of viewport
      const roseX = cssW - 34;
      const roseY = 36;
      ctx.save();
      ctx.fillStyle = 'rgba(11, 17, 13, 0.86)';
      ctx.strokeStyle = 'rgba(210, 224, 202, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(roseX, roseY, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // North arrow pointer
      ctx.fillStyle = '#c84b38';
      ctx.beginPath();
      ctx.moveTo(roseX, roseY - 13);
      ctx.lineTo(roseX + 4.5, roseY - 2);
      ctx.lineTo(roseX - 4.5, roseY - 2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#cfd9cd';
      ctx.beginPath();
      ctx.moveTo(roseX, roseY + 12);
      ctx.lineTo(roseX + 3.8, roseY - 2);
      ctx.lineTo(roseX - 3.8, roseY - 2);
      ctx.closePath();
      ctx.fill();

      ctx.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#f5e9cf';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', roseX, roseY - 26);
      ctx.restore();

      // Dynamic Scale Bar in bottom-right corner of viewport
      const targetBarMeters = zoom >= 2.2 ? 50 : zoom >= 1.4 ? 100 : 200;
      const barPx = Math.round(targetBarMeters * pxPerMeter);
      const sbX = cssW - 22 - barPx;
      const sbY = cssH - 22;
      ctx.save();
      ctx.fillStyle = 'rgba(10, 15, 12, 0.84)';
      ctx.fillRect(sbX - 10, sbY - 19, barPx + 20, 28);
      ctx.strokeStyle = 'rgba(216, 228, 210, 0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sbX - 10, sbY - 19, barPx + 20, 28);

      ctx.strokeStyle = '#e8dfc4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sbX, sbY - 4);
      ctx.lineTo(sbX, sbY);
      ctx.lineTo(sbX + barPx, sbY);
      ctx.lineTo(sbX + barPx, sbY - 4);
      ctx.stroke();

      ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#e8dfc4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${targetBarMeters} m`, sbX + barPx * 0.5, sbY - 4);
      ctx.restore();

      ctx.restore();
    },

    dispose(): void {
      rasterCanvas.width = 0;
      rasterCanvas.height = 0;
      baseCanvas.width = 0;
      baseCanvas.height = 0;
      fogBackdropLow.width = 0;
      fogBackdropLow.height = 0;
      unexploredCanvas.width = 0;
      unexploredCanvas.height = 0;
      fogMaskCanvas.width = 0;
      fogMaskCanvas.height = 0;
      maskedTerrainCanvas.width = 0;
      maskedTerrainCanvas.height = 0;
      compositedCanvas.width = 0;
      compositedCanvas.height = 0;
    },
  };
}
