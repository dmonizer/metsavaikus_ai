import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSurfaceMaterial, type SurfaceSample } from './surfaceMaterial';
import type { SurfaceMaterial } from '../soundscape/types';

const base: SurfaceSample = { onBoardwalk: false, inWater: false, structure: null,
  swampWading: false, road: { dist: 50, isTrail: false }, biomeId: 'forest' };
const house = { id: 'house', quality: 'warm_house', floorMaterial: 'wooden_floor' as SurfaceMaterial };

test('shared surface precedence covers overlapping geometry and exact road thresholds', () => {
  const cases: Array<[Partial<SurfaceSample>, SurfaceMaterial]> = [
    [{ onBoardwalk: true, inWater: true, structure: house, swampWading: true }, 'wooden_boardwalk'],
    [{ inWater: true, structure: house, swampWading: true }, 'water'],
    [{ structure: house, swampWading: true, road: { dist: 0, isTrail: false } }, 'wooden_floor'],
    [{ structure: { ...house, quality: 'drafty_hut', floorMaterial: 'decrepit_wooden_floor' } }, 'decrepit_wooden_floor'],
    [{ structure: { ...house, quality: 'tent' } }, 'forest_floor'],
    [{ structure: { ...house, quality: 'outdoor' } }, 'forest_floor'],
    [{ structure: { ...house, id: null } }, 'forest_floor'],
    [{ swampWading: true, road: { dist: 0, isTrail: false }, biomeId: 'village' }, 'mud'],
    [{ road: { dist: 3.299, isTrail: false }, biomeId: 'village' }, 'gravel'],
    [{ road: { dist: 3.3, isTrail: false }, biomeId: 'village' }, 'grass'],
    [{ road: { dist: 0, isTrail: true } }, 'forest_floor'],
    [{ biomeId: 'village' }, 'grass'],
    [{ biomeId: 'abandoned' }, 'forest_floor'],
    [{}, 'forest_floor'],
  ];
  for (const [input, expected] of cases) assert.equal(resolveSurfaceMaterial({ ...base, ...input }), expected);
});

test('higher-priority surfaces avoid lower-priority geometry and terrain queries', () => {
  const unavailable = () => { throw new Error('Unnecessary lower-priority sampling'); };
  const covered = { ...base, get structure(): SurfaceSample['structure'] { return unavailable(); },
    get road(): SurfaceSample['road'] { return unavailable(); }, get biomeId(): string { return unavailable(); } };
  assert.equal(resolveSurfaceMaterial({ ...base, onBoardwalk: true,
    get structure() { return covered.structure; }, get road() { return covered.road; }, get biomeId() { return covered.biomeId; } }), 'wooden_boardwalk');
  assert.equal(resolveSurfaceMaterial({ ...base, inWater: true,
    get structure() { return covered.structure; }, get road() { return covered.road; }, get biomeId() { return covered.biomeId; } }), 'water');
  assert.equal(resolveSurfaceMaterial({ ...base, structure: house,
    get road() { return covered.road; }, get biomeId() { return covered.biomeId; } }), 'wooden_floor');
  assert.equal(resolveSurfaceMaterial({ ...base, road: { dist: 0, isTrail: false },
    get biomeId() { return covered.biomeId; } }), 'gravel');
});
