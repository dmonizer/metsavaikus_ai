import test from 'node:test';
import assert from 'node:assert/strict';
import { PointSpatialIndex } from './pointSpatialIndex';
import { createSeededRandom } from './seededRandom';

test('spatial radius queries match a full scan through moves, boundaries and removals', () => {
  const index = new PointSpatialIndex<number>(16), random = createSeededRandom(2026);
  const points = new Map<number, { x: number; z: number }>(), out: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const point = { x: (random() - 0.5) * 1200, z: (random() - 0.5) * 1200 };
    points.set(i, point); index.set(i, point.x, point.z);
  }
  for (let i = 0; i < 500; i++) {
    const point = { x: (random() - 0.5) * 1200, z: (random() - 0.5) * 1200 };
    points.set(i, point); index.set(i, point.x, point.z);
    if (i % 3 === 0) { points.delete(i); index.delete(i); }
    const x = (random() - 0.5) * 1200, z = (random() - 0.5) * 1200, radius = i % 2 ? 6.5 : 38;
    index.queryRadius(x, z, radius, out);
    const expected = [...points].filter(([, p]) => (p.x - x) ** 2 + (p.z - z) ** 2 <= radius ** 2).map(([id]) => id);
    assert.deepEqual(new Set(out), new Set(expected));
    assert.ok(index.lastVisitedCount < points.size / 10);
  }
  index.set(-1, -16, 0); index.set(-2, 0, 0); index.set(-3, 16, 0);
  index.queryRadius(0, 0, 16, out);
  for (const id of [-1, -2, -3]) assert.ok(out.includes(id));
  index.clear(); assert.equal(index.size, 0); assert.equal(index.cellCount, 0);
});

test('moving and deleting an item releases empty cells instead of growing the index', () => {
  const index = new PointSpatialIndex<string>();
  for (let i = 0; i < 10000; i++) index.set('moving', i * 16, -i * 16);
  assert.equal(index.size, 1); assert.equal(index.cellCount, 1);
  index.delete('moving'); index.delete('moving');
  assert.equal(index.size, 0); assert.equal(index.cellCount, 0);
});
