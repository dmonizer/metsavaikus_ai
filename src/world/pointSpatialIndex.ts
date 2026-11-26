/** Mutable point index for local world queries. Each item occupies exactly one cell. */
export class PointSpatialIndex<T> {
  private readonly cells = new Map<string, Set<T>>();
  private readonly points = new Map<T, { x: number; z: number; key: string }>();
  private visited = 0;

  constructor(private readonly cellSize = 16) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('cellSize must be positive');
  }

  get size(): number { return this.points.size; }
  get cellCount(): number { return this.cells.size; }
  get lastVisitedCount(): number { return this.visited; }

  set(item: T, x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Point must be finite');
    const previous = this.points.get(item);
    if (previous?.x === x && previous.z === z) return;
    const key = `${Math.floor(x / this.cellSize)}_${Math.floor(z / this.cellSize)}`;
    if (previous?.key === key) {
      previous.x = x;
      previous.z = z;
      return;
    }
    this.delete(item);
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, cell = new Set());
    cell.add(item);
    this.points.set(item, { x, z, key });
  }

  delete(item: T): void {
    const point = this.points.get(item);
    if (!point) return;
    const cell = this.cells.get(point.key)!;
    cell.delete(item);
    if (cell.size === 0) this.cells.delete(point.key);
    this.points.delete(item);
  }

  queryRadius(x: number, z: number, radius: number, out: T[]): void {
    out.length = 0;
    this.visited = 0;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0) return;
    const radiusSq = radius * radius;
    for (let cx = Math.floor((x - radius) / this.cellSize); cx <= Math.floor((x + radius) / this.cellSize); cx++) {
      for (let cz = Math.floor((z - radius) / this.cellSize); cz <= Math.floor((z + radius) / this.cellSize); cz++) {
        const cell = this.cells.get(`${cx}_${cz}`);
        if (!cell) continue;
        for (const item of cell) {
          this.visited++;
          const point = this.points.get(item)!;
          const dx = point.x - x, dz = point.z - z;
          if (dx * dx + dz * dz <= radiusSq) out.push(item);
        }
      }
    }
  }

  clear(): void {
    this.points.clear();
    this.cells.clear();
    this.visited = 0;
  }
}
