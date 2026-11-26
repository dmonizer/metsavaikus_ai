import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FOG_GRID_SIZE, FogOfWarMap } from './minimapMath';

describe('FogOfWarMap', () => {
  it('starts unexplored and reveals 100% of cells when revealAll() is called', () => {
    const fog = new FogOfWarMap(FOG_GRID_SIZE);
    assert.equal(fog.getExploredPercent(), 0);
    const initialVersion = fog.version;

    fog.revealAt(0, 0);
    assert.ok(fog.version > initialVersion);
    assert.ok(fog.getExploredPercent() > 0 && fog.getExploredPercent() < 100);

    const beforeRevealAll = fog.version;
    fog.revealAll();
    assert.equal(fog.getExploredPercent(), 100);
    assert.equal(fog.isExploredAt(500, -500), true);
    assert.equal(fog.isExploredAt(-500, 500), true);
    assert.ok(fog.version > beforeRevealAll);

    fog.reset();
    assert.equal(fog.getExploredPercent(), 0);
  });
});
