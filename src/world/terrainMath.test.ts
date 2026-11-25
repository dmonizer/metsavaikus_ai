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
  isDryLandForPlanting,
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
import {
  buildMinimapTerrainPixels,
  computeCompassHeadingDeg,
  FogOfWarMap,
  formatCardinalDirection,
  formatCompassLabel,
  projectPointOnHeadingMinimap,
} from './minimapMath';
import {
  classifySphereFrustum,
  commitCompactedInstancedMesh,
  computeFogCullDistance,
  extractFrustumPlanes,
  FrustumCullStatus,
  sphereIntersectsFrustum,
} from './forestFrustumCuller';

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

test('Compass heading conversion matches Three.js yaw across all cardinal directions', () => {
  assert.equal(Math.round(computeCompassHeadingDeg(0)), 0);
  assert.equal(formatCompassLabel(0), 'N · 000°');
  assert.equal(formatCompassLabel(-Math.PI / 2), 'E · 090°');
  assert.equal(formatCompassLabel(Math.PI), 'S · 180°');
  assert.equal(formatCompassLabel(Math.PI / 2), 'W · 270°');
  assert.equal(formatCardinalDirection(44), 'NE');
  assert.equal(formatCardinalDirection(225), 'SW');
  assert.equal(formatCompassLabel(0.05), 'N · 357°');
});

test('Heading-up minimap projects North/East targets accurately and rasterizes world terrain', () => {
  const r = 60;
  // Facing North (yaw = 0): target due North (0, -50) sits straight ahead (up)
  const northFacingNorth = projectPointOnHeadingMinimap(0, -50, 0, 0, 0, r, 100);
  assert.ok(Math.abs(northFacingNorth.x - r) < 1e-6);
  assert.ok(northFacingNorth.y < r - 25);

  // Facing East (yaw = -PI/2): target due East (50, 0) sits straight ahead (up),
  // and target due North (0, -50) sits directly to the left (9 o'clock)
  const eastFacingEast = projectPointOnHeadingMinimap(50, 0, 0, 0, -Math.PI / 2, r, 100);
  assert.ok(Math.abs(eastFacingEast.x - r) < 1e-6);
  assert.ok(eastFacingEast.y < r - 25);

  const northFacingEast = projectPointOnHeadingMinimap(0, -50, 0, 0, -Math.PI / 2, r, 100);
  assert.ok(northFacingEast.x < r - 25);
  assert.ok(Math.abs(northFacingEast.y - r) < 1e-6);

  const bp = setActiveWorldSeed(2026);
  const pixels = buildMinimapTerrainPixels(64, bp);
  assert.equal(pixels.length, 64 * 64 * 4);
  const uniqueColors = new Set<string>();
  for (let i = 0; i < pixels.length; i += 4) {
    assert.equal(pixels[i + 3], 255);
    uniqueColors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
  }
  assert.ok(uniqueColors.size > 15, 'Rasterized terrain map should contain varied biome shades');
});

test('FogOfWarMap gradually reveals explored terrain as player moves and resets cleanly', () => {
  const fog = new FogOfWarMap(80);
  assert.equal(fog.getExploredPercent(), 0);
  assert.equal(fog.getAlphaAt(0, 0), 0);
  assert.equal(fog.isExploredAt(0, 0), false);
  const v0 = fog.version;

  // Reveal around spawn (0, 0)
  const firstChanged = fog.revealAt(0, 0, 84, 28);
  assert.equal(firstChanged, true);
  assert.equal(fog.version, v0 + 1);
  assert.equal(fog.getAlphaAt(0, 0), 255);
  assert.equal(fog.isExploredAt(0, 0), true);
  assert.equal(fog.getAlphaAt(300, 300), 0);
  assert.equal(fog.isExploredAt(300, 300), false);

  // Soft feather edge should have intermediate alpha between 0 and 255
  const edgeAlpha = fog.getAlphaAt(70, 0);
  assert.ok(edgeAlpha > 0 && edgeAlpha < 255, `Expected feathered alpha at 70m, got ${edgeAlpha}`);

  // Standing still must not increment version or report changes
  const stillChanged = fog.revealAt(0, 0, 84, 28);
  assert.equal(stillChanged, false);
  assert.equal(fog.version, v0 + 1);

  const pctStart = fog.getExploredPercent();
  assert.ok(pctStart >= 1, `Expected explored % >= 1 after spawn reveal, got ${pctStart}`);

  // Walking north & east monotonically reveals more terrain while preserving prior explored area
  fog.revealAt(0, -140, 84, 28);
  fog.revealAt(140, -140, 84, 28);
  fog.revealAt(240, -140, 84, 28);
  assert.equal(fog.isExploredAt(0, 0), true, 'Previously explored origin remains revealed');
  assert.equal(fog.isExploredAt(240, -140), true, 'Newly explored destination is revealed');
  assert.ok(
    fog.getExploredPercent() > pctStart,
    `Expected explored % to grow after moving (${pctStart}% -> ${fog.getExploredPercent()}%)`
  );

  // Reset clears all fog back to 0%
  fog.reset();
  assert.equal(fog.getExploredPercent(), 0);
  assert.equal(fog.getAlphaAt(0, 0), 0);
  assert.equal(fog.isExploredAt(240, -140), false);
});

test('isDryLandForPlanting strictly excludes open lake water and flooded rims while accepting dry hills & islands', () => {
  const bp = setActiveWorldSeed(2026);
  // Every swamp island peak must be plantable dry land
  const isl0 = bp.swampIslands[0];
  assert.equal(isDryLandForPlanting(isl0.x, isl0.z, 0.34, 1.5, bp), true);

  // Sample across the bog basin: NO submerged point (h <= SWAMP_WATER_Y + 0.34) may ever pass
  let submergedCount = 0;
  let dryCount = 0;
  for (let dx = -bp.bogRadius; dx <= bp.bogRadius; dx += 14) {
    for (let dz = -bp.bogRadius; dz <= bp.bogRadius; dz += 14) {
      const x = bp.bogCenterX + dx;
      const z = bp.bogCenterZ + dz;
      const h = getTerrainHeight(x, z, bp);
      const plantable = isDryLandForPlanting(x, z, 0.34, 1.5, bp);
      if (h <= SWAMP_WATER_Y + 0.34) {
        submergedCount++;
        assert.equal(
          plantable,
          false,
          `Submerged/shoreline spot (${x.toFixed(1)}, ${z.toFixed(1)}, y=${h.toFixed(2)}) must never allow trees`
        );
      } else if (plantable) {
        dryCount++;
      }
    }
  }
  assert.ok(submergedCount > 20, `Expected open bog water spots to test, found ${submergedCount}`);
  assert.ok(dryCount > 5, `Expected dry bog islands/ridges to remain plantable, found ${dryCount}`);
});

test('forestFrustumCuller classifies spheres accurately, tightens fog horizon, and uses partial InstancedMesh upload ranges', () => {
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.5, 220);
  cam.position.set(0, 2, 0);
  cam.lookAt(0, 2, -50);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();

  const planes = extractFrustumPlanes(cam, new Float32Array(24));

  // Center-frustum tree -> INSIDE
  assert.equal(classifySphereFrustum(planes, 0, 2, -45, 4), FrustumCullStatus.INSIDE);
  assert.equal(sphereIntersectsFrustum(planes, 0, 2, -45, 4), true);

  // Behind camera -> OUTSIDE
  assert.equal(classifySphereFrustum(planes, 0, 2, 24, 4), FrustumCullStatus.OUTSIDE);
  assert.equal(sphereIntersectsFrustum(planes, 0, 2, 24, 4), false);

  // Far to the right outside FOV -> OUTSIDE
  assert.equal(classifySphereFrustum(planes, 120, 2, -30, 5), FrustumCullStatus.OUTSIDE);

  // Straddling the right frustum plane -> INTERSECTING
  const halfWidthAt40 = Math.tan(THREE.MathUtils.degToRad(35)) * (16 / 9) * 40;
  assert.equal(
    classifySphereFrustum(planes, halfWidthAt40, 2, -40, 6),
    FrustumCullStatus.INTERSECTING
  );
  assert.equal(sphereIntersectsFrustum(planes, halfWidthAt40, 2, -40, 6), true);

  // Fog cull distance stays generous in clear air and tightens automatically in rain/storm
  const clearDist = computeFogCullDistance(0.0052);
  const rainDist = computeFogCullDistance(0.0137);
  const stormDist = computeFogCullDistance(0.024);
  assert.equal(clearDist, 225);
  assert.ok(rainDist < 160 && rainDist > 135, `Expected rain fog cutoff ~151.8m, got ${rainDist}`);
  assert.equal(stormDist, 96);

  // commitCompactedInstancedMesh hides empty meshes and uploads only active ranges
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const inst = new THREE.InstancedMesh(geo, mat, 200);
  inst.setColorAt(0, new THREE.Color(0xffffff));

  inst.count = 0;
  commitCompactedInstancedMesh(inst);
  assert.equal(inst.visible, false);

  inst.count = 37;
  commitCompactedInstancedMesh(inst);
  assert.equal(inst.visible, true);
  assert.equal(inst.instanceMatrix.updateRanges.length, 1);
  assert.deepEqual(inst.instanceMatrix.updateRanges[0], { start: 0, count: 37 * 16 });
  assert.equal(inst.instanceColor!.updateRanges.length, 1);
  assert.deepEqual(inst.instanceColor!.updateRanges[0], { start: 0, count: 37 * 3 });

  // Shared-buffer follower updates visibility without duplicating matrix/color upload triggers
  inst.instanceMatrix.clearUpdateRanges();
  inst.count = 15;
  commitCompactedInstancedMesh(inst, true);
  assert.equal(inst.visible, true);
  assert.equal(inst.instanceMatrix.updateRanges.length, 0);

  geo.dispose();
  mat.dispose();
  inst.dispose();
});

test('Non-bog valleys and bog water disc perimeter stay cleanly above SWAMP_WATER_Y across seeds (no straight water cutoff edge)', () => {
  for (const seed of [2026, 4042, 7777, 9999]) {
    const bp = setActiveWorldSeed(seed);
    const waterRadius = bp.bogRadius + 28;
    let bogWaterCount = 0;

    for (let z = -540; z <= 540; z += 12) {
      for (let x = -540; x <= 540; x += 12) {
        const h = getTerrainHeight(x, z, bp);
        const swamp = getSwampFactor(x, z, undefined, bp);
        const distBog = Math.hypot(x - bp.bogCenterX, z - bp.bogCenterZ);

        if (swamp === 0) {
          assert.ok(
            h > SWAMP_WATER_Y + 0.25,
            `Seed ${seed}: non-bog terrain at (${x}, ${z}) dipped to ${h.toFixed(2)} <= water ${SWAMP_WATER_Y}`
          );
        }
        if (distBog >= waterRadius - 12 && distBog <= waterRadius + 12) {
          assert.ok(
            h > SWAMP_WATER_Y + 0.2,
            `Seed ${seed}: terrain near bog water disc rim (dist=${distBog.toFixed(1)}, r=${waterRadius.toFixed(1)}) dipped to ${h.toFixed(2)}`
          );
        }
        if (swamp > 0.4 && h < SWAMP_WATER_Y - 0.15) {
          bogWaterCount++;
        }
      }
    }

    assert.ok(
      bogWaterCount > 25,
      `Seed ${seed}: bog basin should retain organic water pools, found ${bogWaterCount}`
    );
  }

  setActiveWorldSeed(2026);
});



