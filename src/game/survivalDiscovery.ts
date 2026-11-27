import { TOTAL_CHUNK_GRID, worldToVirtualChunk } from '../world/terrainMath';

/**
 * Lightweight 25x25 chunk discovery bitmask tracking explored countryside cells
 * so a Full Map view renders filled when Paper Map is carried or discovered-only when not.
 */
export class DiscoveryTracker {
  readonly gridSize = TOTAL_CHUNK_GRID;
  readonly cells: Uint8Array;
  private discoveredCount = 0;

  constructor() {
    this.cells = new Uint8Array(this.gridSize * this.gridSize);
  }

  markAroundWorldPos(worldX: number, worldZ: number, radiusChunks = 1): number {
    const { vcx, vcz } = worldToVirtualChunk(worldX, worldZ);
    const half = Math.floor(this.gridSize / 2);
    const gx0 = vcx + half;
    const gz0 = vcz + half;
    let newlyFound = 0;
    for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
      for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
        const gx = gx0 + dx;
        const gz = gz0 + dz;
        if (gx < 0 || gx >= this.gridSize || gz < 0 || gz >= this.gridSize) continue;
        const idx = gz * this.gridSize + gx;
        if (this.cells[idx] === 0) {
          this.cells[idx] = 1;
          this.discoveredCount++;
          newlyFound++;
        }
      }
    }
    return newlyFound;
  }

  getDiscoveredPercent(): number {
    return Math.round((this.discoveredCount / this.cells.length) * 100);
  }

  revealAll(): void {
    this.cells.fill(1);
    this.discoveredCount = this.cells.length;
  }

  reset(): void {
    this.cells.fill(0);
    this.discoveredCount = 0;
  }
}

export function formatGameHour(hour: number): string {
  const norm = ((hour % 24) + 24) % 24;
  const h = Math.floor(norm);
  const m = Math.floor((norm - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
