import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_COUNT,
  CHUNK_SIZE,
  getActiveBlueprint,
  getBiomeInfo,
  getDistanceToNearestVillage,
  getNearestSwampIsland,
  getSwampFactor,
  getTerrainHeight,
  getThicketFactor,
  hash2i,
  setActiveWorldSeed,
  smoothNoise,
  SWAMP_WATER_Y,
  TOTAL_CHUNK_GRID,
  WORLD_SIZE,
  worldToVirtualChunk,
} from './terrainMath';
import * as THREE from 'three';
import { generateWorldBlueprint } from './worldBlueprint';
import { ComputeEngine } from './wasmCompute';
import { TerrainChunkManager } from './terrainChunkManager';
import { buildConnectedTube, createBogPineSegments } from './foliageFactory';

test('World constants scale to 1200x1200m procedural streaming', () => {
  assert.equal(WORLD_SIZE, 1200);
  assert.equal(CHUNK_SIZE, 48);
  assert.equal(CHUNK_COUNT, 121);
  assert.equal(TOTAL_CHUNK_GRID, 25);
  assert.deepEqual(worldToVirtualChunk(0, 0), { vcx: 0, vcz: 0 });
  assert.deepEqual(worldToVirtualChunk(520, -520), { vcx: 10, vcz: -11 });
});

test('Procedural blueprint builds 4 villages, large bog, and swamp islands with decayed huts', () => {
  const bpA = generateWorldBlueprint(2026);
  const bpA2 = generateWorldBlueprint(2026);
  const bpB = generateWorldBlueprint(7777);

  assert.equal(bpA.villages.length, 4);
  assert.equal(bpA.villages[0].id, 'vana-kase');
  assert.ok(bpA.swampIslands.length >= 6);
  assert.ok(bpA.bogRadius >= 115);

  const states = new Set(
    bpA.swampIslands.filter((i) => i.hut !== null).map((i) => i.hut!.decayState)
  );
  assert.ok(states.has('roofless'), 'At least one swamp island hut should be roofless');
  assert.ok(states.has('ruins'), 'At least one swamp island hut should be in ruins');

  // Seed determinism & cross-seed variation
  assert.deepEqual(bpA, bpA2);
  assert.notEqual(bpA.villages[1].x, bpB.villages[1].x);
  assert.notEqual(bpA.bogCenterX, bpB.bogCenterX);
});

test('ComputeEngine initializes WebAssembly module cleanly and matches JS noise', async () => {
  const engine = await ComputeEngine.create();
  assert.equal(engine.isWasmActive, true, 'WASM module should compile and instantiate');
  const raw = engine.getRawExports();
  assert.ok(raw, 'WASM exports should be exposed');

  for (const [ix, iz] of [
    [0, 0],
    [13, -7],
    [-124, 88],
    [409, 211],
  ]) {
    const wasmVal = raw!.hash2i(ix, iz);
    const jsVal = hash2i(ix, iz);
    assert.ok(Math.abs(wasmVal - jsVal) < 1e-6, `hash2i(${ix}, ${iz}) mismatch: ${wasmVal} vs ${jsVal}`);
  }

  for (const [x, z] of [
    [1.25, 3.75],
    [-18.4, 22.9],
    [0.01, -0.99],
  ]) {
    const wasmN = raw!.smoothNoise(x, z);
    const jsN = smoothNoise(x, z);
    assert.ok(Math.abs(wasmN - jsN) < 1e-5, `smoothNoise(${x}, ${z}) mismatch: ${wasmN} vs ${jsN}`);
  }
});

test('WASM fillTerrainChunk matches getTerrainHeight across seeds and outer map chunks', async () => {
  const engine = await ComputeEngine.create();
  const segs = 12;
  const count = (segs + 1) * (segs + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (const seed of [2026, 9999]) {
    const bp = setActiveWorldSeed(seed);
    for (const [minX, minZ] of [
      [-48, -48],
      [Math.floor(bp.bogCenterX / 48) * 48, Math.floor(bp.bogCenterZ / 48) * 48],
      [480, -528],
    ]) {
      engine.fillTerrainChunk(minX, minZ, CHUNK_SIZE, segs, positions, normals, colors);
      for (let i = 0; i < count; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const expectedY = getTerrainHeight(x, z);
        assert.ok(
          Math.abs(y - expectedY) < 1e-4,
          `Seed ${seed} height mismatch at (${x}, ${z}): WASM=${y}, JS=${expectedY}`
        );

        const nLen = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
        assert.ok(Math.abs(nLen - 1) < 1e-3, `Normal should be unit length, got ${nLen}`);
      }
    }
  }
  setActiveWorldSeed(2026);
});

test('WASM cullChunks classifies frustum visibility and tight LOD cutoffs accurately', async () => {
  const engine = await ComputeEngine.create();

  const spheres = new Float32Array([
    0, 0, -20, 5,
    0, 0, -80, 5,
    0, 0, -140, 5,
    0, 0, 30, 5,
    0, 0, -220, 5,
  ]);

  const planes = new Float32Array([
    0, 0, -1, -0.1,
    0, 0, 1, 200,
    1, 0, 0, 100,
    -1, 0, 0, 100,
    0, 1, 0, 100,
    0, -1, 0, 100,
  ]);

  const outLods = new Int32Array(5);
  const visCount = engine.cullChunks(
    spheres,
    5,
    planes,
    0,
    0,
    0,
    185 * 185,
    58 * 58,
    115 * 115,
    outLods
  );

  assert.equal(visCount, 3);
  assert.deepEqual(Array.from(outLods), [0, 1, 2, -1, -1]);
});

test('Dynamic biomes reflect procedural villages, bog depths, swamp islands, and thickets', () => {
  const bp = setActiveWorldSeed(2026);
  const v0 = bp.villages[0];
  const abandonedVillage = bp.villages.find((v) => v.abandoned)!;

  assert.equal(getBiomeInfo(v0.x, v0.z).id, 'village');
  assert.equal(getBiomeInfo(abandonedVillage.x, abandonedVillage.z).id, 'abandoned');
  assert.equal(getDistanceToNearestVillage(v0.x, v0.z).village?.id, v0.id);

  // Check bog depression around center (away from islands)
  const isl0 = bp.swampIslands[0];
  assert.equal(getBiomeInfo(isl0.x, isl0.z).id, 'island');
  assert.equal(getNearestSwampIsland(isl0.x, isl0.z).island?.id, isl0.id);
  assert.ok(getTerrainHeight(isl0.x, isl0.z) > SWAMP_WATER_Y + 0.8);

  // Sample bog edge away from any island
  let bogSpotX = bp.bogCenterX + bp.bogRadius * 0.45;
  let bogSpotZ = bp.bogCenterZ + bp.bogRadius * 0.45;
  if (getNearestSwampIsland(bogSpotX, bogSpotZ).dist < 22) {
    bogSpotX = bp.bogCenterX - bp.bogRadius * 0.45;
    bogSpotZ = bp.bogCenterZ + bp.bogRadius * 0.45;
  }
  assert.ok(getSwampFactor(bogSpotX, bogSpotZ) > 0.5);
  assert.equal(getBiomeInfo(bogSpotX, bogSpotZ).id, 'swamp');

  // Verify thicket factor stays bounded [0, 1] across outer forests
  const tf = getThicketFactor(380, -410);
  assert.ok(tf >= 0 && tf <= 1);
  assert.equal(getActiveBlueprint().seed, 2026);
});

test('TerrainChunkManager keeps active geometries valid and avoids eviction thrashing at map edge', async () => {
  const engine = await ComputeEngine.create();
  const dummyTex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  const manager = new TerrainChunkManager(engine, dummyTex);
  const cam = new THREE.PerspectiveCamera(72, 16 / 9, 0.12, 220);
  cam.updateProjectionMatrix();
  const stats = { visibleChunks: 0, lod0: 0, lod1: 0, lod2: 0 };

  // Traverse from center (0, 0) out to map edge (585, 585) and back to force >420 cached geometries
  const steps = 20;
  for (let pass = 0; pass <= steps * 2; pass++) {
    const t = pass <= steps ? pass / steps : 1 - (pass - steps) / steps;
    const pos = t * 585;
    cam.position.set(pos, getTerrainHeight(pos, pos) + 1.65, pos);
    cam.lookAt(pos - 18, cam.position.y - 0.5, pos - 18);
    cam.updateMatrixWorld();
    manager.update(cam, stats);
    assert.ok(stats.visibleChunks > 0, `Expected visible chunks at (${pos}, ${pos})`);
  }

  for (const child of manager.group.children) {
    const mesh = child as THREE.Mesh;
    if (mesh.visible) {
      const posAttr = mesh.geometry.getAttribute('position');
      assert.ok(posAttr && posAttr.count > 0, 'Visible terrain mesh must retain valid geometry');
    }
  }

  manager.dispose();
  dummyTex.dispose();
});

test('Bog pine trunk spine and side branches remain strictly connected with no floating segments', () => {
  const { segments, branchCount } = createBogPineSegments();
  const trunkCount = segments.length - branchCount;
  assert.ok(trunkCount >= 3);
  assert.equal(branchCount, 3);

  // Trunk spine segments must meet end-to-start with zero air gap
  for (let i = 0; i < trunkCount - 1; i++) {
    const gap = segments[i].end.distanceTo(segments[i + 1].start);
    assert.ok(gap < 1e-6, `Trunk gap at joint ${i}: ${gap}`);
  }

  // Every branch start must lie directly on one of the parent trunk spine segments
  const line = new THREE.Line3();
  const closest = new THREE.Vector3();
  for (let b = trunkCount; b < segments.length; b++) {
    const bStart = segments[b].start;
    let minDist = Infinity;
    for (let t = 0; t < trunkCount; t++) {
      line.set(segments[t].start, segments[t].end);
      line.closestPointToPoint(bStart, true, closest);
      minDist = Math.min(minDist, closest.distanceTo(bStart));
    }
    assert.ok(minDist < 1e-5, `Branch ${b} root detached from trunk by ${minDist}m`);
  }

  // Ensure every tube builds cleanly with finite vertices enclosing its start and end
  for (const seg of segments) {
    const geo = buildConnectedTube(seg);
    const pos = geo.getAttribute('position');
    assert.ok(pos && pos.count > 0);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    assert.ok(
      box.distanceToPoint(seg.start) <= seg.rBot + 0.02 &&
        box.distanceToPoint(seg.end) <= seg.rTop + 0.02,
      'Tube geometry must cover both endpoints cleanly'
    );
    geo.dispose();
  }
});
