import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildBirchGeometries,
  buildBogPineGeometries,
  buildButtressedTrunk,
  buildErraticBoulderGeo,
  buildLoneSpruceGeometries,
  buildPineGeometries,
  buildSpruceGeometries,
  buildSpruceSaplingGeometries,
  classifySpruceGrowthForm,
  makeArchedSprigCard,
  measureGeometryBounds,
} from './botanicalGeometry';

function maxRadiusInYBand(geo: THREE.BufferGeometry, yMin: number, yMax: number): number {
  const pos = geo.attributes.position;
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y >= yMin && y <= yMax) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      if (r > maxR) maxR = r;
    }
  }
  return maxR;
}

function countAtlasQuadrantsUsed(geo: THREE.BufferGeometry): number {
  const uv = geo.attributes.uv;
  const quads = new Set<number>();
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, `UV out of [0,1] bounds: (${u}, ${v})`);
    const q = (u >= 0.5 ? 1 : 0) + (v < 0.5 ? 2 : 0);
    quads.add(q);
  }
  return quads.size;
}

test('buildButtressedTrunk flares roots cleanly below ground and produces finite attributes', () => {
  const spine = [
    new THREE.Vector3(0, -0.4, 0),
    new THREE.Vector3(0, 0.0, 0),
    new THREE.Vector3(0, 1.4, 0),
    new THREE.Vector3(0, 4.0, 0),
  ];
  const geo = buildButtressedTrunk(spine, [0.3, 0.25, 0.2, 0.14], {
    radialSegs: 10,
    rootCount: 5,
    rootFlare: 1.4,
    flareHeight: 1.2,
  });
  const b = measureGeometryBounds(geo);
  assert.equal(b.hasNaN, false);
  assert.ok(b.minY <= -0.35, `Expected root skirt below -0.35m, got ${b.minY}`);
  const rootR = maxRadiusInYBand(geo, -0.1, 0.25);
  const midR = maxRadiusInYBand(geo, 1.3, 2.2);
  assert.ok(rootR > midR * 1.8, `Expected fluted root flare (${rootR}) >> mid-trunk radius (${midR})`);
  geo.dispose();
});

test('Silver Birch has tall slender silhouette, dark-base height range, and 4-quadrant feathery crown', () => {
  const birch = buildBirchGeometries();
  const tb = measureGeometryBounds(birch.trunkLod0);
  const cb = measureGeometryBounds(birch.crownLod0);

  assert.equal(tb.hasNaN, false);
  assert.equal(cb.hasNaN, false);
  assert.ok(tb.minY <= -0.3, 'Birch root skirt should embed below ground');
  assert.ok(tb.maxY >= 11.8, `Expected tall Estonian birch >= 11.8m, got ${tb.maxY}`);
  // Lower trunk (1.5m - 3.8m) should stay clean and slender without low branches
  const lowerReach = maxRadiusInYBand(birch.trunkLod0, 1.5, 3.8);
  assert.ok(lowerReach < 0.35, `Expected clean slender lower birch trunk (<0.35m), got ${lowerReach}`);
  // Upper ascending branches should spread outward above 5.5m
  const upperBranchReach = maxRadiusInYBand(birch.trunkLod0, 5.5, 11.5);
  assert.ok(upperBranchReach > 1.0, `Expected visible ascending birch limbs (>1.0m), got ${upperBranchReach}`);
  assert.equal(countAtlasQuadrantsUsed(birch.crownLod0), 4, 'Birch LOD0 crown should sample all 4 atlas variants');

  for (const g of Object.values(birch)) g.dispose();
});

test('Scots Pine has flared stump, dead stubs, crooked wide upper boughs, and 4-quadrant umbrella crown', () => {
  const pine = buildPineGeometries();
  const tb = measureGeometryBounds(pine.trunkLod0);
  const cb = measureGeometryBounds(pine.crownLod0);

  assert.equal(tb.hasNaN, false);
  assert.equal(cb.hasNaN, false);
  assert.ok(tb.minY <= -0.32, 'Pine root skirt should embed below ground');
  assert.ok(tb.maxY >= 14.8, `Expected mature Scots pine >= 14.8m, got ${tb.maxY}`);
  const rootR = maxRadiusInYBand(pine.trunkLod0, -0.1, 0.25);
  const midR = maxRadiusInYBand(pine.trunkLod0, 2.0, 3.5);
  assert.ok(rootR > midR * 1.6, 'Pine base should flare into buttress roots');
  // Crooked upper boughs should reach wide under the umbrella canopy
  const upperBoughReach = maxRadiusInYBand(pine.trunkLod0, 9.5, 15.2);
  assert.ok(upperBoughReach > 2.4, `Expected wide crooked upper pine boughs (>2.4m), got ${upperBoughReach}`);
  assert.equal(countAtlasQuadrantsUsed(pine.crownLod0), 4, 'Pine LOD0 crown should sample all 4 atlas variants');

  for (const g of Object.values(pine)) g.dispose();
});

test('Norway Spruce has strong root buttresses, dense bare dead lower snags, and tiered conical crown', () => {
  const spruce = buildSpruceGeometries();
  const tb = measureGeometryBounds(spruce.trunkLod0);
  const cb = measureGeometryBounds(spruce.crownLod0);

  assert.equal(tb.hasNaN, false);
  assert.equal(cb.hasNaN, false);
  assert.ok(tb.minY <= -0.36, 'Spruce root buttress should embed deeply below ground');
  assert.ok(tb.maxY >= 13.5, `Expected stately Norway spruce >= 13.5m, got ${tb.maxY}`);
  const rootR = maxRadiusInYBand(spruce.trunkLod0, -0.1, 0.25);
  assert.ok(rootR >= 0.62, `Expected prominent Norway spruce buttress roots >= 0.62m, got ${rootR}`);
  // Dense dead lower branch snags radiating between 1.1m and 3.8m (kuusiku-alune.jpg)
  const snagReach = maxRadiusInYBand(spruce.trunkLod0, 1.1, 3.8);
  assert.ok(snagReach > 0.75, `Expected bare dead lower spruce snags reaching >0.75m, got ${snagReach}`);
  assert.ok(cb.maxY >= 14.0, `Expected sharp Norway spruce spire apex >= 14.0m, got ${cb.maxY}`);
  assert.equal(countAtlasQuadrantsUsed(spruce.crownLod0), 4, 'Spruce LOD0 crown should use all 4 atlas variants');
  assert.ok(
    spruce.crownLod0.attributes.position.count >= 1100,
    `Expected dense woodland spruce crown (>=1100 vertices), got ${spruce.crownLod0.attributes.position.count}`
  );

  for (const g of Object.values(spruce)) g.dispose();
});

test('Lone-standing Norway Spruce has ground-skirting dense pyramid, wider lower boughs than woodland spruce, and open-growth classifier', () => {
  const woodland = buildSpruceGeometries();
  const lone = buildLoneSpruceGeometries();
  const ltb = measureGeometryBounds(lone.trunkLod0);
  const lcb = measureGeometryBounds(lone.crownLod0);

  assert.equal(ltb.hasNaN, false);
  assert.equal(lcb.hasNaN, false);
  assert.ok(ltb.minY <= -0.36, 'Lone spruce roots should embed below ground');
  assert.ok(lcb.minY <= 0.65, `Expected lone spruce skirt draping near ground <= 0.65m, got ${lcb.minY}`);
  assert.ok(lcb.maxY >= 14.3, `Expected full lone spruce apex >= 14.3m, got ${lcb.maxY}`);
  assert.equal(countAtlasQuadrantsUsed(lone.crownLod0), 4, 'Lone spruce LOD0 crown should sample all 4 atlas variants');

  // Lone spruce must carry significantly thicker foliage and broader lower skirt than woodland spruce
  assert.ok(
    lone.crownLod0.attributes.position.count > woodland.crownLod0.attributes.position.count * 1.35,
    `Expected lone spruce crown (${lone.crownLod0.attributes.position.count} verts) much denser than woodland spruce (${woodland.crownLod0.attributes.position.count} verts)`
  );
  const loneLowR = maxRadiusInYBand(lone.crownLod0, 0.5, 4.0);
  const woodLowR = maxRadiusInYBand(woodland.crownLod0, 0.5, 4.0);
  assert.ok(
    loneLowR > woodLowR * 1.18,
    `Expected broader lone spruce lower skirt (${loneLowR.toFixed(2)}m) > woodland (${woodLowR.toFixed(2)}m)`
  );

  // Growth-form classifier: isolated or open-edge spruces -> lone; crowded woods / thickets -> woodland
  assert.equal(classifySpruceGrowthForm(0.85, 1, 0.1), 'lone');
  assert.equal(classifySpruceGrowthForm(0.65, 2, 0.2), 'lone');
  assert.equal(classifySpruceGrowthForm(0.05, 0, 0.2), 'lone');
  assert.equal(classifySpruceGrowthForm(0.05, 3, 0.25), 'woodland');
  assert.equal(classifySpruceGrowthForm(0.10, 4, 0.4), 'woodland');
  assert.equal(classifySpruceGrowthForm(0.70, 0, 0.65), 'woodland');

  for (const g of Object.values(woodland)) g.dispose();
  for (const g of Object.values(lone)) g.dispose();
});

test('Young Norway Spruce sapling has woody stem, low conical whorls, and tall spiky leader spire', () => {
  const sapling = buildSpruceSaplingGeometries();
  const tb = measureGeometryBounds(sapling.trunk);
  const fb = measureGeometryBounds(sapling.foliage);

  assert.equal(tb.hasNaN, false);
  assert.equal(fb.hasNaN, false);
  assert.ok(tb.minY <= -0.15, 'Sapling stem should root into the ground');
  assert.ok(tb.maxY >= 2.35, `Expected woody sapling stem >= 2.35m, got ${tb.maxY}`);
  assert.ok(fb.minY <= 0.25, `Expected dense low whorls near ground <= 0.25m, got ${fb.minY}`);
  assert.ok(fb.maxY >= 2.65, `Expected prominent spiky leader spire >= 2.65m, got ${fb.maxY}`);

  sapling.trunk.dispose();
  sapling.foliage.dispose();
});

test('Bog Pine and makeArchedSprigCard respect atlas quadrant UV insets cleanly', () => {
  const bog = buildBogPineGeometries();
  assert.equal(measureGeometryBounds(bog.trunk).hasNaN, false);
  assert.equal(measureGeometryBounds(bog.crown).hasNaN, false);
  assert.equal(countAtlasQuadrantsUsed(bog.crown), 4);
  bog.trunk.dispose();
  bog.crown.dispose();

  for (const q of [0, 1, 2, 3] as const) {
    const card = makeArchedSprigCard(1, 1, 0.2, 0, 0, 0, 0, 0, 0, new THREE.Color(0x224422), new THREE.Color(0x88cc44), undefined, q);
    const uv = card.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (q === 0) assert.ok(u < 0.5 && v > 0.5);
      if (q === 1) assert.ok(u > 0.5 && v > 0.5);
      if (q === 2) assert.ok(u < 0.5 && v < 0.5);
      if (q === 3) assert.ok(u > 0.5 && v < 0.5);
    }
    card.dispose();
  }
});

test('Glacial erratic boulders (variants 0 & 1) are angular, grounded, distinct, and finite', () => {
  const b0 = buildErraticBoulderGeo(0);
  const b1 = buildErraticBoulderGeo(1);
  const m0 = measureGeometryBounds(b0);
  const m1 = measureGeometryBounds(b1);

  assert.equal(m0.hasNaN, false);
  assert.equal(m1.hasNaN, false);
  assert.ok(m0.minY <= -0.15, `Boulder variant 0 should embed below y=0, got ${m0.minY}`);
  assert.ok(m1.minY <= -0.15, `Boulder variant 1 should embed below y=0, got ${m1.minY}`);
  assert.ok(m0.maxY > 0.55, `Boulder variant 0 should rise prominently above soil, got ${m0.maxY}`);
  assert.ok(m1.maxY > 0.42, `Boulder variant 1 should rise clearly above soil, got ${m1.maxY}`);
  // Variant 1 should have a wider low-profile outcrop aspect than variant 0
  const aspect0 = (m0.maxX - m0.minX) / Math.max(0.1, m0.maxY - m0.minY);
  const aspect1 = (m1.maxX - m1.minX) / Math.max(0.1, m1.maxY - m1.minY);
  assert.ok(aspect1 > aspect0, `Expected outcrop variant 1 (${aspect1.toFixed(2)}) to be broader/flatter than erratic variant 0 (${aspect0.toFixed(2)})`);

  // Verify UVs and unit-length normals
  for (const geo of [b0, b1]) {
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) {
      const len = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      assert.ok(Math.abs(len - 1.0) < 0.02, `Expected unit normal, got length ${len}`);
    }
    geo.dispose();
  }
});
