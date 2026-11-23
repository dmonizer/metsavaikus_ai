import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ACTIVE_GRID,
  CHUNK_COUNT,
  CHUNK_SIZE,
  clamp,
  distToRoadDetail,
  getActiveBlueprint,
  getDistanceToNearestVillage,
  getNearestSwampIsland,
  getSwampFactor,
  getTerrainHeight,
  getThicketFactor,
  lerp,
  smoothNoise,
  SWAMP_WATER_Y,
  WORLD_HALF,
} from './terrainMath';
import { ActiveChunkSlot } from './terrainChunkManager';
import { WorldTextures } from './proceduralTextures';
import { CircleCollider } from './architectureAndProps';

function seededRand(seed: number): () => number {
  let s = (seed | 0) ^ 0x85ebca6b;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashChunkSeed(worldSeed: number, vcx: number, vcz: number): number {
  let h = Math.imul(worldSeed | 0, 73856093);
  h ^= Math.imul(vcx | 0, 19349663);
  h ^= Math.imul(vcz | 0, 83492791);
  return (h ^ (h >>> 13)) | 0;
}

function prepGeo(
  geo: THREE.BufferGeometry,
  colorBottom?: THREE.Color,
  colorTop?: THREE.Color
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const count = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (colorBottom && colorTop && !g.attributes.color) {
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = Math.max(0.01, maxY - minY);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, (pos.getY(i) - minY) / span));
      cols[i * 3] = colorBottom.r + (colorTop.r - colorBottom.r) * t;
      cols[i * 3 + 1] = colorBottom.g + (colorTop.g - colorBottom.g) * t;
      cols[i * 3 + 2] = colorBottom.b + (colorTop.b - colorBottom.b) * t;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  return g;
}

function applyHeightGradient(
  geo: THREE.BufferGeometry,
  yLow: number,
  yHigh: number,
  colLow: THREE.Color,
  colHigh: THREE.Color
): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const span = Math.max(0.01, yHigh - yLow);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - yLow) / span));
    cols[i * 3] = colLow.r + (colHigh.r - colLow.r) * t;
    cols[i * 3 + 1] = colLow.g + (colHigh.g - colLow.g) * t;
    cols[i * 3 + 2] = colLow.b + (colHigh.b - colLow.b) * t;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

function makeBranchCyl(
  rTop: number,
  rBot: number,
  len: number,
  segs: number,
  x0: number,
  y0: number,
  z0: number,
  rx: number,
  ry: number,
  rz: number
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, segs, 1);
  g.translate(0, len * 0.5, 0);
  g.rotateX(rx);
  g.rotateZ(rz);
  g.rotateY(ry);
  g.translate(x0, y0, z0);
  return prepGeo(g);
}

/**
 * Individual crisp 3D arched diamond leaf (2 opaque triangles, zero alpha discard!).
 */
function makeSingle3DLeaf(
  len: number,
  wid: number,
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
  colBase: THREE.Color,
  colTip: THREE.Color
): THREE.BufferGeometry {
  const hw = wid * 0.5;
  const droop = -len * 0.14;
  const fold = wid * 0.12;
  const positions = new Float32Array([
    0, 0, 0,
    -hw, fold, len * 0.45,
    hw, fold, len * 0.45,
    0, droop, len,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.computeVertexNormals();
  g.rotateX(rx);
  g.rotateZ(rz);
  g.rotateY(ry);
  g.translate(px, py, pz);
  const nonIdx = prepGeo(g);
  const cols = new Float32Array(nonIdx.attributes.position.count * 3);
  // Vertex gradient: petiole darker, mid/tip sunlit
  const tVals = [0, 0.55, 0.55, 0.55, 1.0, 0.55];
  for (let i = 0; i < 6; i++) {
    const t = tVals[i];
    cols[i * 3] = lerp(colBase.r, colTip.r, t);
    cols[i * 3 + 1] = lerp(colBase.g, colTip.g, t);
    cols[i * 3 + 2] = lerp(colBase.b, colTip.b, t);
  }
  nonIdx.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return nonIdx;
}

/**
 * Individual 3D needle-shoot blade pair for pine/spruce/juniper (2-4 opaque triangles, zero alpha discard).
 */
function makeSingleNeedleShoot(
  len: number,
  wid: number,
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
  colBase: THREE.Color,
  colTip: THREE.Color
): THREE.BufferGeometry {
  const hw = wid * 0.5;
  const positions = new Float32Array([
    -hw * 0.35, 0, 0,
     hw * 0.35, 0, 0,
    -hw, len * 0.48, 0.04,
     hw, len * 0.48, -0.04,
     0, len, 0.08,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  g.computeVertexNormals();
  g.rotateX(rx);
  g.rotateZ(rz);
  g.rotateY(ry);
  g.translate(px, py, pz);
  const nonIdx = prepGeo(g);
  const cols = new Float32Array(9 * 3);
  const tVals = [0, 0, 0.55, 0, 0.55, 0.55, 0.55, 0.55, 1.0];
  for (let i = 0; i < 9; i++) {
    const t = tVals[i];
    cols[i * 3] = lerp(colBase.r, colTip.r, t);
    cols[i * 3 + 1] = lerp(colBase.g, colTip.g, t);
    cols[i * 3 + 2] = lerp(colBase.b, colTip.b, t);
  }
  nonIdx.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return nonIdx;
}

function makeVolumetricCluster(
  radius: number,
  px: number,
  py: number,
  pz: number,
  sx: number,
  sy: number,
  sz: number,
  colLow: THREE.Color,
  colHigh: THREE.Color
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, 0);
  g.scale(sx, sy, sz);
  g.translate(px, py, pz);
  return prepGeo(g, colLow, colHigh);
}

// ============================================================================
// High-Detail Individual-Leaf 3D Tree & Bush Geometries (Zero Alpha Discard!)
// ============================================================================

function buildBirchGeometries() {
  const trunkParts: THREE.BufferGeometry[] = [];
  const segH = 2.15;
  const radii = [0.22, 0.16, 0.12, 0.075, 0.032];
  const offX = [0, 0.08, 0.24, 0.16, 0.28];
  const offZ = [0, -0.04, 0.07, 0.16, 0.12];
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.CylinderGeometry(radii[i + 1], radii[i], segH + 0.08, 7, 1);
    seg.translate(0, segH * 0.5, 0);
    const dx = offX[i + 1] - offX[i];
    const dz = offZ[i + 1] - offZ[i];
    seg.rotateZ(-Math.atan2(dx, segH));
    seg.rotateX(Math.atan2(dz, segH));
    seg.translate(offX[i], i * segH - 0.1, offZ[i]);
    trunkParts.push(prepGeo(seg));
  }
  trunkParts.push(makeBranchCyl(0.02, 0.065, 3.0, 5, 0.16, 4.6, 0.08, 0.38, 0.2, 0.52));
  trunkParts.push(makeBranchCyl(0.02, 0.06, 2.8, 5, 0.18, 5.2, 0.1, -0.42, 1.1, -0.48));
  trunkParts.push(makeBranchCyl(0.018, 0.055, 2.6, 5, 0.15, 5.9, 0.12, 0.45, -0.8, -0.38));
  trunkParts.push(makeBranchCyl(0.018, 0.048, 2.3, 5, 0.22, 6.6, 0.12, -0.32, 2.1, 0.44));
  const trunkLod0 = applyHeightGradient(
    mergeGeometries(trunkParts)!,
    0.2,
    2.2,
    new THREE.Color(0x3a3732),
    new THREE.Color(0xffffff)
  );

  // 116 Individual 3D arched diamond birch leaves arranged along crown boughs
  const leafParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(11);
  const colDark = new THREE.Color(0x2d541c);
  const colMid = new THREE.Color(0x568b32);
  const colSun = new THREE.Color(0x8bb846);

  for (let i = 0; i < 116; i++) {
    const a = (i / 116) * Math.PI * 14 + rand() * 0.7;
    const t = i / 116;
    const r = (1 - t * 0.42) * (0.65 + rand() * 1.45);
    const y = 5.1 + t * 4.5 + (rand() - 0.5) * 0.7;
    const len = 0.42 + rand() * 0.26;
    const wid = len * (0.68 + rand() * 0.2);
    const isOuter = r > 1.1 || y > 7.8;
    leafParts.push(
      makeSingle3DLeaf(
        len,
        wid,
        0.18 + Math.cos(a) * r,
        y,
        0.1 + Math.sin(a) * r,
        0.35 + (rand() - 0.5) * 0.9,
        a + (rand() - 0.5) * 1.4,
        (rand() - 0.5) * 0.7,
        isOuter ? colMid : colDark,
        isOuter ? colSun : colMid
      )
    );
  }
  const crownLod0 = mergeGeometries(leafParts)!;

  // LOD1: crisp low-poly 3D volumetric leaf clusters (only ~84 tris)
  const trunkLod1 = applyHeightGradient(
    mergeGeometries([
      makeBranchCyl(0.05, 0.21, 8.6, 5, 0, -0.1, 0, 0, 0, -0.03),
      makeBranchCyl(0.025, 0.06, 2.4, 4, 0.1, 5.1, 0, 0.35, 0.4, 0.45),
      makeBranchCyl(0.025, 0.06, 2.4, 4, 0.1, 5.4, 0, -0.35, 1.4, -0.42),
    ])!,
    0.2,
    2.2,
    new THREE.Color(0x3a3732),
    new THREE.Color(0xffffff)
  );
  const crownLod1Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 6 + rand() * 0.6;
    const t = i / 22;
    const r = (1 - t * 0.35) * (0.55 + rand() * 1.15);
    const y = 5.4 + t * 3.9;
    crownLod1Parts.push(
      makeSingle3DLeaf(
        0.95 + rand() * 0.45,
        0.65 + rand() * 0.25,
        0.18 + Math.cos(a) * r,
        y,
        0.1 + Math.sin(a) * r,
        0.35 + (rand() - 0.5) * 0.85,
        a + (rand() - 0.5) * 1.1,
        (rand() - 0.5) * 0.6,
        t > 0.5 ? colMid : colDark,
        t > 0.5 ? colSun : colMid
      )
    );
  }
  const crownLod1 = mergeGeometries(crownLod1Parts)!;

  // LOD2: ultra-light opaque 3D silhouette (18 tris)
  const crownLod2 = prepGeo(
    (() => {
      const c = new THREE.OctahedronGeometry(1.75, 0);
      c.scale(1.1, 1.75, 1.05);
      c.translate(0.15, 7.2, 0.08);
      return c;
    })(),
    colDark,
    colMid
  );
  const trunkLod2 = makeBranchCyl(0.06, 0.19, 7.6, 4, 0, -0.1, 0, 0, 0, -0.03);
  applyHeightGradient(trunkLod2, 0.2, 2.0, new THREE.Color(0x45423d), new THREE.Color(0xd8d3c9));

  return { trunkLod0, crownLod0, trunkLod1, crownLod1, trunkLod2, crownLod2 };
}

function buildPineGeometries() {
  const trunkParts: THREE.BufferGeometry[] = [];
  const segH = 3.5;
  const radii = [0.24, 0.2, 0.16, 0.115, 0.052];
  const ox = [0, 0.05, 0.13, 0.06, -0.02];
  const oz = [0, 0.04, -0.04, -0.09, -0.04];
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.CylinderGeometry(radii[i + 1], radii[i], segH + 0.08, 7, 1);
    seg.translate(0, segH * 0.5, 0);
    seg.rotateZ(-Math.atan2(ox[i + 1] - ox[i], segH));
    seg.rotateX(Math.atan2(oz[i + 1] - oz[i], segH));
    seg.translate(ox[i], i * segH - 0.12, oz[i]);
    trunkParts.push(prepGeo(seg));
  }
  trunkParts.push(makeBranchCyl(0.025, 0.075, 2.7, 5, 0.05, 10.6, -0.06, 0.18, 0.3, 1.06));
  trunkParts.push(makeBranchCyl(0.025, 0.075, 2.6, 5, 0.03, 11.1, -0.08, -0.22, 1.9, -1.02));
  trunkParts.push(makeBranchCyl(0.022, 0.068, 2.3, 5, 0.01, 11.9, -0.06, 0.88, 0.9, 0.28));
  trunkParts.push(makeBranchCyl(0.022, 0.065, 2.2, 5, 0.0, 12.5, -0.05, -0.82, -0.5, -0.25));
  const trunkLod0 = applyHeightGradient(
    mergeGeometries(trunkParts)!,
    2.4,
    8.8,
    new THREE.Color(0x524c48),
    new THREE.Color(0xe69f70)
  );

  // 96 Individual 3D radiating pine-needle shoot clusters in the high umbrella crown
  const needleParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(22);
  const pineDark = new THREE.Color(0x1f3b1b);
  const pineMid = new THREE.Color(0x36612a);
  const pineSun = new THREE.Color(0x55843c);

  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 14 + rand() * 0.5;
    const t = i / 96;
    const r = (1 - t * 0.45) * (0.7 + rand() * 1.6);
    const y = 11.0 + t * 3.1 + (rand() - 0.5) * 0.45;
    const shootLen = 0.52 + rand() * 0.32;
    const shootWid = 0.36 + rand() * 0.22;
    needleParts.push(
      makeSingleNeedleShoot(
        shootLen,
        shootWid,
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        0.78 + (rand() - 0.5) * 0.75,
        a,
        (rand() - 0.5) * 0.5,
        t < 0.4 ? pineDark : pineMid,
        t > 0.65 ? pineSun : pineMid
      )
    );
  }
  const crownLod0 = mergeGeometries(needleParts)!;

  const trunkLod1 = applyHeightGradient(
    mergeGeometries([
      makeBranchCyl(0.055, 0.23, 13.6, 5, 0, -0.1, 0, 0, 0, 0),
      makeBranchCyl(0.025, 0.068, 2.2, 4, 0, 11.2, 0, 0.2, 0.5, 1.0),
      makeBranchCyl(0.025, 0.068, 2.2, 4, 0, 11.5, 0, -0.2, 2.1, -1.0),
    ])!,
    2.4,
    8.8,
    new THREE.Color(0x524c48),
    new THREE.Color(0xe69f70)
  );
  const crownLod1Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 6 + rand() * 0.45;
    const t = i / 24;
    const r = (1 - t * 0.38) * (0.55 + rand() * 1.35);
    const y = 11.2 + t * 2.8;
    crownLod1Parts.push(
      makeSingleNeedleShoot(
        1.05 + rand() * 0.42,
        0.72 + rand() * 0.28,
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        0.82 + (rand() - 0.5) * 0.68,
        a,
        (rand() - 0.5) * 0.45,
        t < 0.4 ? pineDark : pineMid,
        t > 0.6 ? pineSun : pineMid
      )
    );
  }
  const crownLod1 = mergeGeometries(crownLod1Parts)!;

  const trunkLod2 = makeBranchCyl(0.07, 0.22, 13.2, 4, 0, -0.1, 0, 0, 0, 0);
  applyHeightGradient(trunkLod2, 2.4, 8.5, new THREE.Color(0x504944), new THREE.Color(0xd28d60));
  const crownLod2 = makeVolumetricCluster(1.75, 0, 12.6, 0, 1.25, 0.75, 1.25, pineDark, pineMid);

  return { trunkLod0, crownLod0, trunkLod1, crownLod1, trunkLod2, crownLod2 };
}

function buildBogPineGeometries() {
  const trunk = mergeGeometries([
    makeBranchCyl(0.09, 0.14, 1.4, 6, 0, -0.05, 0, 0.14, 0.2, -0.12),
    makeBranchCyl(0.05, 0.09, 1.5, 6, -0.16, 1.25, 0.18, -0.18, 0.5, 0.22),
    makeBranchCyl(0.022, 0.052, 1.3, 5, 0.1, 1.75, 0.04, 0.45, 0.8, 0.85),
    makeBranchCyl(0.02, 0.048, 1.15, 5, 0.05, 2.0, 0.05, -0.35, 2.2, -0.75),
  ])!;
  const needleParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(29);
  const bogDark = new THREE.Color(0x28411f);
  const bogTip = new THREE.Color(0x557536);
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 8 + rand() * 0.5;
    const r = 0.25 + rand() * 0.85;
    const y = 2.0 + rand() * 1.15;
    needleParts.push(
      makeSingleNeedleShoot(
        0.38 + rand() * 0.22,
        0.26 + rand() * 0.14,
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        0.72 + (rand() - 0.5) * 0.7,
        a,
        (rand() - 0.5) * 0.4,
        bogDark,
        bogTip
      )
    );
  }
  return { trunk, crown: mergeGeometries(needleParts)! };
}

function buildSpruceGeometries() {
  const trunkLod0 = makeBranchCyl(0.03, 0.24, 11.2, 6, 0, -0.1, 0, 0, 0, 0);
  const boughParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(33);
  const spDark = new THREE.Color(0x162d16);
  const spMid = new THREE.Color(0x274d24);
  const spTip = new THREE.Color(0x416e33);

  const tiers = [
    { y: 2.0, r: 1.5, count: 16 },
    { y: 3.3, r: 1.32, count: 15 },
    { y: 4.6, r: 1.14, count: 14 },
    { y: 5.9, r: 0.94, count: 12 },
    { y: 7.2, r: 0.72, count: 10 },
    { y: 8.5, r: 0.52, count: 8 },
    { y: 9.7, r: 0.3, count: 6 },
  ];

  // Drooping 3D needle boughs & individual spruce needle shoots per tier
  for (let t = 0; t < tiers.length; t++) {
    const tier = tiers[t];
    for (let i = 0; i < tier.count; i++) {
      const a = (i / tier.count) * Math.PI * 2 + t * 0.43 + (rand() - 0.5) * 0.2;
      const dist = tier.r * (0.45 + rand() * 0.65);
      const len = 0.65 + (1 - t / tiers.length) * 0.7;
      const wid = 0.32 + (1 - t / tiers.length) * 0.22;
      boughParts.push(
        makeSingleNeedleShoot(
          len,
          wid,
          Math.sin(a) * dist * 0.5,
          tier.y + (rand() - 0.5) * 0.25,
          Math.cos(a) * dist * 0.5,
          1.22 + (rand() - 0.5) * 0.3, // drooping outward downward
          a,
          (rand() - 0.5) * 0.35,
          i % 2 === 0 ? spDark : spMid,
          spTip
        )
      );
    }
  }
  // Top spire shoots
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    boughParts.push(
      makeSingleNeedleShoot(0.65, 0.24, Math.sin(a) * 0.1, 10.6, Math.cos(a) * 0.1, 0.38, a, 0, spMid, spTip)
    );
  }
  const crownLod0 = mergeGeometries(boughParts)!;

  const trunkLod1 = makeBranchCyl(0.04, 0.23, 11.0, 5, 0, -0.1, 0, 0, 0, 0);
  const c1Parts: THREE.BufferGeometry[] = [];
  for (const [y, rad, h] of [
    [3.2, 2.05, 3.2],
    [5.6, 1.65, 3.0],
    [7.8, 1.2, 2.8],
    [9.6, 0.72, 2.2],
  ]) {
    const cone = new THREE.ConeGeometry(rad, h, 7, 1);
    cone.translate(0, y, 0);
    c1Parts.push(prepGeo(cone, spDark, spMid));
  }
  const crownLod1 = mergeGeometries(c1Parts)!;

  const trunkLod2 = makeBranchCyl(0.06, 0.22, 4.0, 4, 0, -0.1, 0, 0, 0, 0);
  const cone2 = new THREE.ConeGeometry(2.1, 9.6, 6, 1);
  cone2.translate(0, 6.4, 0);
  const crownLod2 = prepGeo(cone2, spDark, spMid);

  return { trunkLod0, crownLod0, trunkLod1, crownLod1, trunkLod2, crownLod2 };
}

function buildSpruceSaplingGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rand = seededRand(39);
  const spDark = new THREE.Color(0x214420);
  const spTip = new THREE.Color(0x528238);
  parts.push(prepGeo(makeBranchCyl(0.015, 0.04, 1.65, 4, 0, -0.05, 0, 0, 0, 0), new THREE.Color(0x3a2a1d), new THREE.Color(0x3a2a1d)));
  for (let t = 0; t < 4; t++) {
    const y = 0.42 + t * 0.34;
    const count = 8 - t;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + t * 0.5;
      parts.push(
        makeSingleNeedleShoot(
          0.42 - t * 0.05 + rand() * 0.08,
          0.22 - t * 0.02,
          Math.sin(a) * 0.06,
          y,
          Math.cos(a) * 0.06,
          1.12,
          a,
          0,
          spDark,
          spTip
        )
      );
    }
  }
  return mergeGeometries(parts)!;
}

// ============================================================================
// Solid Multi-Part Estonian Woodland Bushes with Individual 3D Leaves!
// ============================================================================

function buildHazelBushGeometries() {
  const rand = seededRand(411);
  const stemParts: THREE.BufferGeometry[] = [];
  const leafParts: THREE.BufferGeometry[] = [];
  const darkG = new THREE.Color(0x2c521c);
  const midG = new THREE.Color(0x4d822c);
  const brightG = new THREE.Color(0x7fb03e);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.35;
    const tilt = 0.28 + rand() * 0.32;
    const len = 1.15 + rand() * 0.55;
    const sx = Math.cos(a) * 0.08;
    const sz = Math.sin(a) * 0.08;
    stemParts.push(
      makeBranchCyl(0.015, 0.038, len, 4, sx, -0.04, sz, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt)
    );
    const midX = sx + Math.cos(a) * len * 0.48 * Math.sin(tilt);
    const midZ = sz + Math.sin(a) * len * 0.48 * Math.sin(tilt);
    const midY = len * 0.48 * Math.cos(tilt);
    stemParts.push(
      makeBranchCyl(0.008, 0.02, 0.65, 4, midX, midY, midZ, (rand() - 0.5) * 0.8, a, (rand() - 0.5) * 0.8)
    );
  }

  // 72 individual 3D folded hazel leaves arranged around the shrub twigs
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 10 + rand() * 0.65;
    const y = 0.36 + Math.pow(rand(), 0.72) * 1.15;
    const maxR = 0.82 * (1 - Math.abs(y - 0.9) * 0.55);
    const r = 0.16 + rand() * maxR;
    const len = 0.22 + rand() * 0.14;
    const wid = len * 0.74;
    const outer = r > 0.48 || y > 1.1;
    leafParts.push(
      makeSingle3DLeaf(
        len,
        wid,
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        0.3 + (rand() - 0.5) * 0.9,
        a + (rand() - 0.5) * 1.1,
        (rand() - 0.5) * 0.6,
        outer ? midG : darkG,
        outer ? brightG : midG
      )
    );
  }

  return {
    stems: mergeGeometries(stemParts)!,
    leaves: mergeGeometries(leafParts)!,
  };
}

function buildJuniperBushGeo(): THREE.BufferGeometry {
  const rand = seededRand(412);
  const parts: THREE.BufferGeometry[] = [];
  const jDark = new THREE.Color(0x213d22);
  const jTip = new THREE.Color(0x4b723f);

  // Woody central core
  for (let s = 0; s < 3; s++) {
    parts.push(
      prepGeo(
        makeBranchCyl(0.015, 0.036, 0.85, 4, (s - 1) * 0.08, -0.02, 0, (rand() - 0.5) * 0.3, s, (rand() - 0.5) * 0.3),
        new THREE.Color(0x3a2b1f),
        new THREE.Color(0x4a3929)
      )
    );
  }
  // 52 Individual 3D conifer plumes/shoots (no alpha discard!)
  for (let i = 0; i < 52; i++) {
    const a = (i / 52) * Math.PI * 10 + rand() * 0.4;
    const t = i / 52;
    const y = 0.18 + t * 1.08;
    const r = (1 - t * 0.68) * (0.14 + rand() * 0.34);
    parts.push(
      makeSingleNeedleShoot(
        0.34 + rand() * 0.22,
        0.2 + rand() * 0.1,
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        0.52 + (rand() - 0.5) * 0.5,
        a,
        (rand() - 0.5) * 0.35,
        jDark,
        jTip
      )
    );
  }
  return mergeGeometries(parts)!;
}

// ============================================================================
// Individual 3D Grass Blades, Bilberry Sprigs, Ferns & Moss Knolls (No Alpha!)
// ============================================================================

function buildSingleGrassBladeGeo(): THREE.BufferGeometry {
  // Single arched 3D grass blade (3 triangles, vertex colored root-to-tip)
  const w = 0.044;
  const h = 0.42;
  const lean = 0.13;
  const positions = new Float32Array([
    -w * 0.5, 0, 0,
     w * 0.5, 0, 0,
    -w * 0.28, h * 0.52, lean * 0.35,
     w * 0.28, h * 0.52, lean * 0.35,
     0, h, lean,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  g.computeVertexNormals();
  const nonIdx = prepGeo(g);
  const rootCol = new THREE.Color(0x233816);
  const midCol = new THREE.Color(0x446c26);
  const tipCol = new THREE.Color(0x749e3d);
  const pos = nonIdx.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / h));
    const c =
      t < 0.5
        ? rootCol.clone().lerp(midCol, t / 0.5)
        : midCol.clone().lerp(tipCol, (t - 0.5) / 0.5);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  nonIdx.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return nonIdx;
}

function buildBilberrySubShrubGeo(): THREE.BufferGeometry {
  const rand = seededRand(802);
  const parts: THREE.BufferGeometry[] = [];
  const stemRoot = new THREE.Color(0x3a2f1e);
  const stemTop = new THREE.Color(0x526b2a);
  const leafDark = new THREE.Color(0x345c20);
  const leafBright = new THREE.Color(0x6da136);

  for (let s = 0; s < 5; s++) {
    const a = (s / 5) * Math.PI * 2 + rand() * 0.4;
    const r = 0.06 + rand() * 0.18;
    const sx = Math.cos(a) * r;
    const sz = Math.sin(a) * r;
    const stemH = 0.34 + rand() * 0.22;
    const stem = makeBranchCyl(0.008, 0.014, stemH, 3, sx, 0, sz, (rand() - 0.5) * 0.45, a, (rand() - 0.5) * 0.45);
    applyHeightGradient(stem, 0, stemH, stemRoot, stemTop);
    parts.push(stem);

    for (let l = 0; l < 5; l++) {
      const la = a + l * 2.1 + rand() * 0.5;
      const ly = stemH * (0.45 + (l / 5) * 0.52);
      parts.push(
        makeSingle3DLeaf(
          0.16 + rand() * 0.07,
          0.11 + rand() * 0.05,
          sx + Math.cos(la) * 0.04,
          ly,
          sz + Math.sin(la) * 0.04,
          -0.25 + (rand() - 0.5) * 0.35,
          la,
          0,
          leafDark,
          leafBright
        )
      );
    }
  }
  return mergeGeometries(parts)!;
}

function buildMossHummockGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.75, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const n = smoothNoise(px * 2.7 + 3.1, pz * 2.7 - 1.9);
    pos.setX(i, px * (1.18 + n * 0.28));
    pos.setY(i, py * (0.28 + n * 0.14));
    pos.setZ(i, pz * (1.02 + n * 0.25));
  }
  g.computeVertexNormals();
  return prepGeo(g, new THREE.Color(0x4a5e2c), new THREE.Color(0x6e8a3b));
}

function buildOpaqueReedClumpGeo(): THREE.BufferGeometry {
  const rand = seededRand(803);
  const parts: THREE.BufferGeometry[] = [];
  const rootCol = new THREE.Color(0x3f3c1f);
  const tipCol = new THREE.Color(0x94823d);

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rand() * 0.35;
    const h = 0.88 + rand() * 0.62;
    const w = 0.045;
    const lean = 0.18 + rand() * 0.28;
    const r = 0.05 + rand() * 0.14;
    const positions = new Float32Array([
      -w * 0.5, 0, 0,
       w * 0.5, 0, 0,
      -w * 0.3, h * 0.5, lean * 0.32,
       w * 0.3, h * 0.5, lean * 0.32,
       0, h, lean,
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    g.rotateY(a);
    g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    parts.push(prepGeo(g, rootCol, tipCol));
  }
  return mergeGeometries(parts)!;
}

function buildOpaqueFernRosetteGeo(): THREE.BufferGeometry {
  // Real 3D segmented fern rosette (zero alpha discard!)
  const parts: THREE.BufferGeometry[] = [];
  const darkF = new THREE.Color(0x28541e);
  const tipF = new THREE.Color(0x66a336);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + (i % 2) * 0.16;
    const sc = i % 2 === 0 ? 1.0 : 0.82;
    for (let seg = 0; seg < 4; seg++) {
      const dist = 0.12 + seg * 0.21 * sc;
      const elev = Math.sin(((seg + 0.5) / 4) * Math.PI * 0.72) * 0.48 * sc;
      const pWid = (0.28 - seg * 0.045) * sc;
      parts.push(
        makeSingle3DLeaf(
          0.26 * sc,
          pWid,
          Math.sin(a) * dist,
          elev,
          Math.cos(a) * dist,
          0.35 + seg * 0.15,
          a,
          0,
          darkF,
          tipF
        )
      );
    }
  }
  return mergeGeometries(parts)!;
}

function buildFallenLogGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.21, 4.4, 7, 1);
  trunk.rotateZ(Math.PI * 0.5);
  trunk.translate(0, 0.14, 0);
  const stub = new THREE.CylinderGeometry(0.03, 0.06, 0.9, 5, 1);
  stub.rotateZ(-0.45);
  stub.rotateX(0.35);
  stub.translate(0.9, 0.38, 0.15);
  return mergeGeometries([prepGeo(trunk), prepGeo(stub)])!;
}

// ============================================================================
// Synchronized Traveling-Gust Wind Shader System
// ============================================================================

interface WindUniformSet {
  time: { value: number };
  strength: { value: number };
  dir: { value: THREE.Vector2 };
}

interface WindShaderOpts {
  bendStart: number;
  bendSpan: number;
  bendAmp: number;
  leafAmp: number;
  leafFreq: number;
}

function addWindSway(
  mat: THREE.MeshLambertMaterial,
  uniforms: WindUniformSet,
  opts: WindShaderOpts
): void {
  const cacheKey = `wind_${opts.bendStart}_${opts.bendSpan}_${opts.bendAmp}_${opts.leafAmp}_${opts.leafFreq}`;
  mat.customProgramCacheKey = () => cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uniforms.time;
    shader.uniforms.uWindStrength = uniforms.strength;
    shader.uniforms.uWindDir = uniforms.dir;

    shader.vertexShader =
      `uniform float uWindTime;\nuniform float uWindStrength;\nuniform vec2 uWindDir;\n` +
      shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 wPosXZ = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      #else
        vec2 wPosXZ = vec2(0.0);
      #endif
      float instSeed = wPosXZ.x * 0.31 + wPosXZ.y * 0.47;

      float gustCoord = dot(wPosXZ, uWindDir) * 0.14 - uWindTime * 1.95;
      float gustWave = 0.58 + 0.42 * sin(gustCoord) + 0.22 * sin(gustCoord * 2.1 + 1.3);
      float hNorm = clamp((position.y - ${opts.bendStart.toFixed(3)}) / ${Math.max(0.1, opts.bendSpan).toFixed(3)}, 0.0, 1.5);
      float bendCurve = pow(hNorm, 1.55);
      float trunkOsc = 0.42 + 0.58 * sin(uWindTime * 1.45 + instSeed * 0.8 + gustCoord * 0.4);
      vec2 primarySway = uWindDir * (${opts.bendAmp.toFixed(3)} * bendCurve * gustWave * trunkOsc * uWindStrength);
      vec2 perpDir = vec2(-uWindDir.y, uWindDir.x);
      primarySway += perpDir * (${(opts.bendAmp * 0.32).toFixed(3)} * bendCurve * cos(uWindTime * 1.15 + instSeed) * uWindStrength);

      transformed.x += primarySway.x;
      transformed.z += primarySway.y;

      #if ${opts.leafAmp > 0 ? 1 : 0}
        float leafMask = smoothstep(${Math.max(0.0, opts.bendStart * 0.5).toFixed(3)}, ${(opts.bendStart + opts.bendSpan * 0.35).toFixed(3)}, position.y);
        float phase = uWindTime * ${opts.leafFreq.toFixed(2)} + position.x * 1.9 + position.y * 1.4 + position.z * 2.1 + instSeed;
        float flutter = sin(phase) * ${opts.leafAmp.toFixed(3)} * leafMask * uWindStrength;
        transformed.x += flutter;
        transformed.y += cos(phase * 1.18) * ${(opts.leafAmp * 0.48).toFixed(3)} * leafMask * uWindStrength;
        transformed.z += sin(phase * 0.85 + 1.1) * ${(opts.leafAmp * 0.85).toFixed(3)} * leafMask * uWindStrength;
      #endif
      `
    );
  };
}

// ============================================================================
// Streaming Pre-Baked Per-Chunk Matrix & Color Slabs + Spatial Hash Colliders
// ============================================================================

interface InstanceRecord {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  r: number;
  g: number;
  b: number;
}

interface BakedSlab {
  count: number;
  matrices: Float32Array;
  colors: Float32Array;
}

const EMPTY_SLAB: BakedSlab = {
  count: 0,
  matrices: new Float32Array(0),
  colors: new Float32Array(0),
};

const _bakeDummy = new THREE.Object3D();

function bakeRecords(records: InstanceRecord[]): BakedSlab {
  const n = records.length;
  if (n === 0) return EMPTY_SLAB;
  const matrices = new Float32Array(n * 16);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const rec = records[i];
    _bakeDummy.position.set(rec.x, rec.y, rec.z);
    _bakeDummy.rotation.set(0, rec.rotY, 0);
    _bakeDummy.scale.setScalar(rec.scale);
    _bakeDummy.updateMatrix();
    _bakeDummy.matrix.toArray(matrices, i * 16);
    colors[i * 3] = rec.r;
    colors[i * 3 + 1] = rec.g;
    colors[i * 3 + 2] = rec.b;
  }
  return { count: n, matrices, colors };
}

interface ChunkBucketBaked {
  birch: BakedSlab;
  pine: BakedSlab;
  bogPine: BakedSlab;
  spruce: BakedSlab;
  sapling: BakedSlab;
  hazelBush: BakedSlab;
  juniperBush: BakedSlab;
  fern: BakedSlab;
  shrub: BakedSlab;
  mossHummock: BakedSlab;
  reed: BakedSlab;
  boulder: BakedSlab;
  deadfall: BakedSlab;
  colliders: CircleCollider[];
}

export interface VegetationStats {
  treesRendered: number;
  foliageRendered: number;
}

const CAP_LOD0 = 560;
const CAP_LOD1 = 980;
const CAP_LOD2 = 1600;
const CAP_BOG_PINE = 360;
const CAP_SAPLING = 950;
const CAP_HAZEL = 1150;
const CAP_JUNIPER = 800;
const CAP_FERN = 1400;
const CAP_SHRUB = 2400;
const CAP_MOSS = 900;
const CAP_REED = 1200;
const CAP_BOULDER = 260;
const CAP_DEADFALL = 200;

const GRASS_BLADE_CAP = 13500;
const MAX_CHUNK_CACHE = 450;
const COLLIDER_CELL_SIZE = 8;

interface BuildingRect {
  cx: number;
  cz: number;
  cosR: number;
  sinR: number;
  hw: number;
  hd: number;
}

function buildExclusionRects(): BuildingRect[] {
  const bp = getActiveBlueprint();
  const rects: BuildingRect[] = [];
  for (const v of bp.villages) {
    for (const b of v.buildings) {
      rects.push({
        cx: v.x + b.offsetX,
        cz: v.z + b.offsetZ,
        cosR: Math.cos(-b.rotY),
        sinR: Math.sin(-b.rotY),
        hw: b.w * 0.5 + 1.1,
        hd: b.d * 0.5 + 1.4,
      });
    }
  }
  for (const isl of bp.swampIslands) {
    if (isl.hut) {
      rects.push({
        cx: isl.x,
        cz: isl.z,
        cosR: Math.cos(-isl.hut.rotY),
        sinR: Math.sin(-isl.hut.rotY),
        hw: isl.hut.w * 0.5 + 1.0,
        hd: isl.hut.d * 0.5 + 1.2,
      });
    }
  }
  return rects;
}

export class WorldVegetationSystem {
  readonly group = new THREE.Group();
  readonly windTimeUniform = { value: 0 };
  readonly windStrengthUniform = { value: 0.9 };
  readonly windDirUniform = { value: new THREE.Vector2(0.86, 0.51) };

  private readonly chunkCache = new Map<string, ChunkBucketBaked>();
  private readonly indexedColliderChunks = new Set<string>();
  private readonly colliderGrid = new Map<string, CircleCollider[]>();
  private readonly buildingRects: BuildingRect[];
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private lastVisibilitySig = '';
  private lastGrassAnchorX = 999999;
  private lastGrassAnchorZ = 999999;

  // Tree LOD InstancedMeshes (all opaque — zero alphaTest discard!)
  private birchTrunk0!: THREE.InstancedMesh;
  private birchCrown0!: THREE.InstancedMesh;
  private birchTrunk1!: THREE.InstancedMesh;
  private birchCrown1!: THREE.InstancedMesh;
  private birchTrunk2!: THREE.InstancedMesh;
  private birchCrown2!: THREE.InstancedMesh;

  private pineTrunk0!: THREE.InstancedMesh;
  private pineCrown0!: THREE.InstancedMesh;
  private pineTrunk1!: THREE.InstancedMesh;
  private pineCrown1!: THREE.InstancedMesh;
  private pineTrunk2!: THREE.InstancedMesh;
  private pineCrown2!: THREE.InstancedMesh;

  private bogPineTrunk!: THREE.InstancedMesh;
  private bogPineCrown!: THREE.InstancedMesh;

  private spruceTrunk0!: THREE.InstancedMesh;
  private spruceCrown0!: THREE.InstancedMesh;
  private spruceTrunk1!: THREE.InstancedMesh;
  private spruceCrown1!: THREE.InstancedMesh;
  private spruceTrunk2!: THREE.InstancedMesh;
  private spruceCrown2!: THREE.InstancedMesh;

  private saplingMesh!: THREE.InstancedMesh;
  private deadfallMesh!: THREE.InstancedMesh;

  // Solid Woodland Bushes (individual 3D leaves!)
  private hazelStemMesh!: THREE.InstancedMesh;
  private hazelLeafMesh!: THREE.InstancedMesh;
  private juniperMesh!: THREE.InstancedMesh;

  // Ground Coverage + Player-Centered Continuous 3D Grass Blade Carpet
  private grassBladeMesh!: THREE.InstancedMesh;
  private fernMesh!: THREE.InstancedMesh;
  private shrubMesh!: THREE.InstancedMesh;
  private mossHummockMesh!: THREE.InstancedMesh;
  private reedMesh!: THREE.InstancedMesh;
  private boulderMesh!: THREE.InstancedMesh;

  private allChunkMeshes: THREE.InstancedMesh[] = [];
  private cachedTreesCount = 0;
  private cachedFoliageCount = 0;

  constructor(textures: WorldTextures, isSoftwareGl: boolean) {
    this.buildingRects = buildExclusionRects();
    this.buildInstancedLayers(textures, isSoftwareGl);
  }

  private isInsideBuilding(x: number, z: number): boolean {
    for (let i = 0; i < this.buildingRects.length; i++) {
      const r = this.buildingRects[i];
      const dx = x - r.cx;
      const dz = z - r.cz;
      const lx = dx * r.cosR - dz * r.sinR;
      const lz = dx * r.sinR + dz * r.cosR;
      if (Math.abs(lx) < r.hw && Math.abs(lz) < r.hd) return true;
    }
    return false;
  }

  private indexChunkColliders(colliders: CircleCollider[]): void {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const gx = Math.floor(c.x / COLLIDER_CELL_SIZE);
      const gz = Math.floor(c.z / COLLIDER_CELL_SIZE);
      const key = `${gx}_${gz}`;
      let list = this.colliderGrid.get(key);
      if (!list) {
        list = [];
        this.colliderGrid.set(key, list);
      }
      // Avoid duplicates if chunk re-baked after LRU eviction
      if (!list.some((ex) => Math.abs(ex.x - c.x) < 0.05 && Math.abs(ex.z - c.z) < 0.05)) {
        list.push(c);
      }
    }
  }

  queryNearbyColliders(x: number, z: number, out: CircleCollider[]): void {
    out.length = 0;
    const cx = Math.floor(x / COLLIDER_CELL_SIZE);
    const cz = Math.floor(z / COLLIDER_CELL_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.colliderGrid.get(`${cx + dx}_${cz + dz}`);
        if (list) {
          for (let i = 0; i < list.length; i++) out.push(list[i]);
        }
      }
    }
  }

  private getOrBakeChunk(vcx: number, vcz: number): ChunkBucketBaked {
    const key = `${vcx}_${vcz}`;
    const cached = this.chunkCache.get(key);
    if (cached) {
      this.chunkCache.delete(key);
      this.chunkCache.set(key, cached);
      return cached;
    }

    const minX = vcx * CHUNK_SIZE;
    const minZ = vcz * CHUNK_SIZE;
    const bp = getActiveBlueprint();
    const rand = seededRand(hashChunkSeed(bp.seed, vcx, vcz));

    const birch: InstanceRecord[] = [];
    const pine: InstanceRecord[] = [];
    const bogPine: InstanceRecord[] = [];
    const spruce: InstanceRecord[] = [];
    const sapling: InstanceRecord[] = [];
    const hazelBush: InstanceRecord[] = [];
    const juniperBush: InstanceRecord[] = [];
    const fern: InstanceRecord[] = [];
    const shrub: InstanceRecord[] = [];
    const mossHummock: InstanceRecord[] = [];
    const reed: InstanceRecord[] = [];
    const boulder: InstanceRecord[] = [];
    const deadfall: InstanceRecord[] = [];
    const colliders: CircleCollider[] = [];

    // Out-of-bounds sky margin stays empty
    const centerX = minX + CHUNK_SIZE * 0.5;
    const centerZ = minZ + CHUNK_SIZE * 0.5;
    if (
      Math.abs(centerX) > WORLD_HALF + CHUNK_SIZE * 0.5 ||
      Math.abs(centerZ) > WORLD_HALF + CHUNK_SIZE * 0.5
    ) {
      const empty: ChunkBucketBaked = {
        birch: EMPTY_SLAB,
        pine: EMPTY_SLAB,
        bogPine: EMPTY_SLAB,
        spruce: EMPTY_SLAB,
        sapling: EMPTY_SLAB,
        hazelBush: EMPTY_SLAB,
        juniperBush: EMPTY_SLAB,
        fern: EMPTY_SLAB,
        shrub: EMPTY_SLAB,
        mossHummock: EMPTY_SLAB,
        reed: EMPTY_SLAB,
        boulder: EMPTY_SLAB,
        deadfall: EMPTY_SLAB,
        colliders: [],
      };
      this.chunkCache.set(key, empty);
      return empty;
    }

    // 1. Dense Estonian Forest Trees (extended full-density all the way to [-600, 600] edges!)
    const treeSamples = 46;
    for (let i = 0; i < treeSamples; i++) {
      const tx = minX + rand() * CHUNK_SIZE;
      const tz = minZ + rand() * CHUNK_SIZE;
      if (Math.abs(tx) > WORLD_HALF - 4 || Math.abs(tz) > WORLD_HALF - 4) continue;
      if (distToRoadDetail(tx, tz).dist < 4.2) continue;

      const nearV = getDistanceToNearestVillage(tx, tz);
      if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.72) continue;
      if (this.isInsideBuilding(tx, tz)) continue;

      const thicket = getThicketFactor(tx, tz);
      const isl = getNearestSwampIsland(tx, tz);
      const onIsland = isl.island !== null && isl.islandMask > 0.42;
      const swamp = onIsland ? 0 : getSwampFactor(tx, tz);
      const y = getTerrainHeight(tx, tz);

      if (swamp > 0.35) {
        if (y > SWAMP_WATER_Y + 0.06 && rand() < 0.5) {
          const s = 0.65 + rand() * 0.6;
          bogPine.push({
            x: tx,
            y: y - 0.06,
            z: tz,
            scale: s,
            rotY: rand() * Math.PI * 2,
            r: 0.85 + rand() * 0.16,
            g: 0.9 + rand() * 0.14,
            b: 0.82 + rand() * 0.12,
          });
          colliders.push({ x: tx, z: tz, r: 0.24 * s });
        }
        continue;
      }

      // Skip some island center trees if island holds a hut
      if (onIsland && isl.island!.hut && isl.dist < 6.8) continue;

      const groveNoise = smoothNoise(tx * 0.032, tz * 0.032);
      const s = 0.82 + rand() * 0.56;
      const tint = 0.84 + rand() * 0.28;
      const rec: InstanceRecord = {
        x: tx,
        y: y - 0.12,
        z: tz,
        scale: s,
        rotY: rand() * Math.PI * 2,
        r: tint * (0.94 + rand() * 0.12),
        g: tint * (0.96 + rand() * 0.1),
        b: tint * (0.88 + rand() * 0.1),
      };

      if (groveNoise > 0.56) {
        birch.push(rec);
        colliders.push({ x: tx, z: tz, r: 0.24 * s });
      } else if (groveNoise > 0.3 && thicket < 0.65) {
        pine.push(rec);
        colliders.push({ x: tx, z: tz, r: 0.26 * s });
      } else {
        spruce.push(rec);
        colliders.push({ x: tx, z: tz, r: 0.28 * s });
      }
    }

    // 2. Thicket Density Boost & Solid Woodland Bushes (Põõsad — cannot walk through!)
    const bushAttempts = 28;
    for (let i = 0; i < bushAttempts; i++) {
      const bx = minX + rand() * CHUNK_SIZE;
      const bz = minZ + rand() * CHUNK_SIZE;
      if (Math.abs(bx) > WORLD_HALF - 4 || Math.abs(bz) > WORLD_HALF - 4) continue;
      if (distToRoadDetail(bx, bz).dist < 3.4) continue;
      const nearV = getDistanceToNearestVillage(bx, bz);
      if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.66) continue;
      if (this.isInsideBuilding(bx, bz)) continue;

      const isl = getNearestSwampIsland(bx, bz);
      const onIsland = isl.island !== null && isl.islandMask > 0.36;
      if (onIsland && isl.island!.hut && isl.dist < 5.5) continue;
      const swamp = onIsland ? 0 : getSwampFactor(bx, bz);
      if (swamp > 0.38) continue;

      const thicket = getThicketFactor(bx, bz);
      // Thickets spawn bushes & dense saplings aggressively so passage becomes nearly impenetrable
      if (thicket < 0.45 && rand() > 0.55) continue;

      const by = getTerrainHeight(bx, bz);
      if (by < SWAMP_WATER_Y + 0.05) continue;
      const s = 0.78 + rand() * 0.65;

      const roll = rand();
      if (roll < 0.48) {
        hazelBush.push({
          x: bx,
          y: by - 0.04,
          z: bz,
          scale: s,
          rotY: rand() * Math.PI * 2,
          r: 0.85 + rand() * 0.22,
          g: 0.92 + rand() * 0.16,
          b: 0.78 + rand() * 0.12,
        });
        colliders.push({ x: bx, z: bz, r: 0.68 * s });
      } else if (roll < 0.76) {
        juniperBush.push({
          x: bx,
          y: by - 0.03,
          z: bz,
          scale: s,
          rotY: rand() * Math.PI * 2,
          r: 0.82 + rand() * 0.2,
          g: 0.92 + rand() * 0.16,
          b: 0.76 + rand() * 0.12,
        });
        colliders.push({ x: bx, z: bz, r: 0.58 * s });
      } else {
        sapling.push({
          x: bx,
          y: by - 0.05,
          z: bz,
          scale: 0.75 + rand() * 0.85,
          rotY: rand() * Math.PI * 2,
          r: 0.84 + rand() * 0.2,
          g: 0.94 + rand() * 0.16,
          b: 0.78 + rand() * 0.12,
        });
        if (thicket > 0.62) {
          colliders.push({ x: bx, z: bz, r: 0.45 * s });
        }
      }
    }

    // Extra dense thicket trunks + bushes when chunk has thicket patches (near-impenetrable)
    if (getThicketFactor(centerX, centerZ) > 0.58) {
      for (let i = 0; i < 24; i++) {
        const tx = minX + rand() * CHUNK_SIZE;
        const tz = minZ + rand() * CHUNK_SIZE;
        if (distToRoadDetail(tx, tz).dist < 3.6) continue;
        const nearV = getDistanceToNearestVillage(tx, tz);
        if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.7) continue;
        if (this.isInsideBuilding(tx, tz)) continue;
        if (getSwampFactor(tx, tz) > 0.36) continue;
        const ty = getTerrainHeight(tx, tz);
        const s = 0.85 + rand() * 0.55;
        if (i % 2 === 0) {
          spruce.push({
            x: tx,
            y: ty - 0.1,
            z: tz,
            scale: s * 0.82,
            rotY: rand() * Math.PI * 2,
            r: 0.82 + rand() * 0.18,
            g: 0.9 + rand() * 0.16,
            b: 0.76 + rand() * 0.14,
          });
          colliders.push({ x: tx, z: tz, r: 0.38 * s });
        } else {
          hazelBush.push({
            x: tx,
            y: ty - 0.04,
            z: tz,
            scale: s,
            rotY: rand() * Math.PI * 2,
            r: 0.84 + rand() * 0.2,
            g: 0.9 + rand() * 0.16,
            b: 0.76 + rand() * 0.12,
          });
          colliders.push({ x: tx, z: tz, r: 0.74 * s });
        }
      }
    }

    // 3. Multi-Layered Forest Understory (Ferns, Bilberry Sprigs, Moss Hummocks, Swamp Reeds)
    for (let i = 0; i < 120; i++) {
      const gx = minX + rand() * CHUNK_SIZE;
      const gz = minZ + rand() * CHUNK_SIZE;
      if (Math.abs(gx) > WORLD_HALF - 3 || Math.abs(gz) > WORLD_HALF - 3) continue;
      if (distToRoadDetail(gx, gz).dist < 2.2) continue;
      if (this.isInsideBuilding(gx, gz)) continue;

      const gy = getTerrainHeight(gx, gz);
      if (gy < SWAMP_WATER_Y - 0.12) continue;

      const isl = getNearestSwampIsland(gx, gz);
      const onIsland = isl.island !== null && isl.islandMask > 0.35;
      const swamp = onIsland ? 0 : getSwampFactor(gx, gz);
      const patch = smoothNoise(gx * 0.09, gz * 0.09);

      if (swamp > 0.36) {
        if (rand() < 0.65) {
          reed.push({
            x: gx,
            y: gy - 0.04,
            z: gz,
            scale: 0.78 + rand() * 0.72,
            rotY: rand() * Math.PI * 2,
            r: 0.74 + rand() * 0.22,
            g: 0.72 + rand() * 0.18,
            b: 0.42 + rand() * 0.12,
          });
        } else if (gy > SWAMP_WATER_Y + 0.04 && rand() < 0.22) {
          mossHummock.push({
            x: gx,
            y: gy - 0.05,
            z: gz,
            scale: 0.8 + rand() * 0.7,
            rotY: rand() * Math.PI * 2,
            r: 0.85,
            g: 0.88,
            b: 0.7,
          });
        }
        continue;
      }

      if (patch > 0.65 && rand() < 0.45) {
        fern.push({
          x: gx,
          y: gy - 0.04,
          z: gz,
          scale: 0.78 + rand() * 0.56,
          rotY: rand() * Math.PI * 2,
          r: 0.82 + rand() * 0.22,
          g: 0.9 + rand() * 0.18,
          b: 0.75 + rand() * 0.16,
        });
      } else if (rand() < 0.52) {
        shrub.push({
          x: gx,
          y: gy - 0.03,
          z: gz,
          scale: 0.85 + rand() * 0.68,
          rotY: rand() * Math.PI * 2,
          r: 0.86 + rand() * 0.2,
          g: 0.94 + rand() * 0.18,
          b: 0.78 + rand() * 0.14,
        });
      } else if (rand() < 0.32) {
        mossHummock.push({
          x: gx,
          y: gy - 0.05,
          z: gz,
          scale: 0.82 + rand() * 0.9,
          rotY: rand() * Math.PI * 2,
          r: 0.8 + rand() * 0.2,
          g: 0.9 + rand() * 0.16,
          b: 0.72 + rand() * 0.14,
        });
      }
    }

    // 4. Deadfall logs & Glacial Granite Boulders
    for (let i = 0; i < 4; i++) {
      const dx = minX + rand() * CHUNK_SIZE;
      const dz = minZ + rand() * CHUNK_SIZE;
      if (distToRoadDetail(dx, dz).dist < 4.4) continue;
      if (this.isInsideBuilding(dx, dz)) continue;
      const nearV = getDistanceToNearestVillage(dx, dz);
      if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.7) continue;
      if (getSwampFactor(dx, dz) > 0.32) continue;
      const dy = getTerrainHeight(dx, dz);
      deadfall.push({
        x: dx,
        y: dy - 0.04,
        z: dz,
        scale: 0.75 + rand() * 0.55,
        rotY: rand() * Math.PI * 2,
        r: 0.72 + rand() * 0.2,
        g: 0.78 + rand() * 0.22,
        b: 0.64 + rand() * 0.14,
      });
    }

    for (let i = 0; i < 4; i++) {
      const bx = minX + rand() * CHUNK_SIZE;
      const bz = minZ + rand() * CHUNK_SIZE;
      if (distToRoadDetail(bx, bz).dist < 4.5) continue;
      if (this.isInsideBuilding(bx, bz)) continue;
      const nearV = getDistanceToNearestVillage(bx, bz);
      if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.68) continue;
      const by = getTerrainHeight(bx, bz);
      if (by < SWAMP_WATER_Y + 0.1) continue;
      const s = 0.48 + rand() * 1.05;
      boulder.push({
        x: bx,
        y: by + s * 0.22,
        z: bz,
        scale: s,
        rotY: rand() * Math.PI * 2,
        r: 0.76 + rand() * 0.2,
        g: 0.79 + rand() * 0.18,
        b: 0.72 + rand() * 0.16,
      });
      if (s > 0.72) colliders.push({ x: bx, z: bz, r: s * 0.65 });
    }

    const baked: ChunkBucketBaked = {
      birch: bakeRecords(birch),
      pine: bakeRecords(pine),
      bogPine: bakeRecords(bogPine),
      spruce: bakeRecords(spruce),
      sapling: bakeRecords(sapling),
      hazelBush: bakeRecords(hazelBush),
      juniperBush: bakeRecords(juniperBush),
      fern: bakeRecords(fern),
      shrub: bakeRecords(shrub),
      mossHummock: bakeRecords(mossHummock),
      reed: bakeRecords(reed),
      boulder: bakeRecords(boulder),
      deadfall: bakeRecords(deadfall),
      colliders,
    };

    if (!this.indexedColliderChunks.has(key)) {
      this.indexedColliderChunks.add(key);
      this.indexChunkColliders(colliders);
    }
    this.chunkCache.set(key, baked);
    if (this.chunkCache.size > MAX_CHUNK_CACHE) {
      const oldestKey = this.chunkCache.keys().next().value;
      if (oldestKey !== undefined) this.chunkCache.delete(oldestKey);
    }

    return baked;
  }

  private createInstanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    maxCapacity: number,
    castShadow: boolean,
    registerInChunkMeshes = true
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, maxCapacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colors = new Float32Array(maxCapacity * 3);
    colors.fill(1);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    if (registerInChunkMeshes) this.allChunkMeshes.push(mesh);
    this.disposables.push(geo, mat);
    return mesh;
  }

  private buildInstancedLayers(textures: WorldTextures, isSoftwareGl: boolean): void {
    const windUniforms: WindUniformSet = {
      time: this.windTimeUniform,
      strength: this.windStrengthUniform,
      dir: this.windDirUniform,
    };

    const birch = buildBirchGeometries();
    const pine = buildPineGeometries();
    const bogPine = buildBogPineGeometries();
    const spruce = buildSpruceGeometries();
    const saplingGeo = buildSpruceSaplingGeo();
    const hazel = buildHazelBushGeometries();
    const juniperGeo = buildJuniperBushGeo();
    const deadfallGeo = buildFallenLogGeo();

    // All materials are OPAQUE (alphaTest: 0) -> Zero alpha-discard fragment overdraw!
    const birchBarkMat = new THREE.MeshLambertMaterial({
      map: textures.birchBark,
      vertexColors: true,
    });
    addWindSway(birchBarkMat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 9.0,
      bendAmp: 0.24,
      leafAmp: 0,
      leafFreq: 0,
    });
    const birchLeafMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(birchLeafMat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 9.0,
      bendAmp: 0.24,
      leafAmp: 0.11,
      leafFreq: 3.6,
    });

    const pineBarkMat = new THREE.MeshLambertMaterial({
      map: textures.pineBark,
      vertexColors: true,
    });
    addWindSway(pineBarkMat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.5,
      bendAmp: 0.26,
      leafAmp: 0,
      leafFreq: 0,
    });
    const pineLeafMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(pineLeafMat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.5,
      bendAmp: 0.26,
      leafAmp: 0.08,
      leafFreq: 3.0,
    });

    const bogPineBarkMat = new THREE.MeshLambertMaterial({
      map: textures.pineBark,
    });
    addWindSway(bogPineBarkMat, windUniforms, {
      bendStart: 0.2,
      bendSpan: 2.8,
      bendAmp: 0.14,
      leafAmp: 0,
      leafFreq: 0,
    });
    const bogPineLeafMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(bogPineLeafMat, windUniforms, {
      bendStart: 0.2,
      bendSpan: 2.8,
      bendAmp: 0.14,
      leafAmp: 0.06,
      leafFreq: 3.2,
    });

    const spruceBarkMat = new THREE.MeshLambertMaterial({
      map: textures.spruceBark,
    });
    addWindSway(spruceBarkMat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 10.5,
      bendAmp: 0.21,
      leafAmp: 0,
      leafFreq: 0,
    });
    const spruceLeafMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(spruceLeafMat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 10.5,
      bendAmp: 0.21,
      leafAmp: 0.07,
      leafFreq: 2.9,
    });

    const saplingMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(saplingMat, windUniforms, {
      bendStart: 0.12,
      bendSpan: 1.5,
      bendAmp: 0.12,
      leafAmp: 0.045,
      leafFreq: 3.6,
    });

    const hazelStemMat = new THREE.MeshLambertMaterial({
      map: textures.spruceBark,
    });
    addWindSway(hazelStemMat, windUniforms, {
      bendStart: 0.08,
      bendSpan: 1.5,
      bendAmp: 0.14,
      leafAmp: 0,
      leafFreq: 0,
    });
    const hazelLeafMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(hazelLeafMat, windUniforms, {
      bendStart: 0.08,
      bendSpan: 1.5,
      bendAmp: 0.14,
      leafAmp: 0.075,
      leafFreq: 4.3,
    });

    const juniperMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(juniperMat, windUniforms, {
      bendStart: 0.08,
      bendSpan: 1.35,
      bendAmp: 0.11,
      leafAmp: 0.045,
      leafFreq: 3.4,
    });

    const shadows = !isSoftwareGl;

    // Trees
    this.birchTrunk0 = this.createInstanced(birch.trunkLod0, birchBarkMat, CAP_LOD0, shadows);
    this.birchCrown0 = this.createInstanced(birch.crownLod0, birchLeafMat, CAP_LOD0, false);
    this.birchTrunk1 = this.createInstanced(birch.trunkLod1, birchBarkMat, CAP_LOD1, false);
    this.birchCrown1 = this.createInstanced(birch.crownLod1, birchLeafMat, CAP_LOD1, false);
    this.birchTrunk2 = this.createInstanced(birch.trunkLod2, birchBarkMat, CAP_LOD2, false);
    this.birchCrown2 = this.createInstanced(birch.crownLod2, birchLeafMat, CAP_LOD2, false);

    this.pineTrunk0 = this.createInstanced(pine.trunkLod0, pineBarkMat, CAP_LOD0, shadows);
    this.pineCrown0 = this.createInstanced(pine.crownLod0, pineLeafMat, CAP_LOD0, false);
    this.pineTrunk1 = this.createInstanced(pine.trunkLod1, pineBarkMat, CAP_LOD1, false);
    this.pineCrown1 = this.createInstanced(pine.crownLod1, pineLeafMat, CAP_LOD1, false);
    this.pineTrunk2 = this.createInstanced(pine.trunkLod2, pineBarkMat, CAP_LOD2, false);
    this.pineCrown2 = this.createInstanced(pine.crownLod2, pineLeafMat, CAP_LOD2, false);

    this.bogPineTrunk = this.createInstanced(bogPine.trunk, bogPineBarkMat, CAP_BOG_PINE, shadows);
    this.bogPineCrown = this.createInstanced(bogPine.crown, bogPineLeafMat, CAP_BOG_PINE, false);

    this.spruceTrunk0 = this.createInstanced(spruce.trunkLod0, spruceBarkMat, CAP_LOD0, shadows);
    this.spruceCrown0 = this.createInstanced(spruce.crownLod0, spruceLeafMat, CAP_LOD0, false);
    this.spruceTrunk1 = this.createInstanced(spruce.trunkLod1, spruceBarkMat, CAP_LOD1, false);
    this.spruceCrown1 = this.createInstanced(spruce.crownLod1, spruceLeafMat, CAP_LOD1, false);
    this.spruceTrunk2 = this.createInstanced(spruce.trunkLod2, spruceBarkMat, CAP_LOD2, false);
    this.spruceCrown2 = this.createInstanced(spruce.crownLod2, spruceLeafMat, CAP_LOD2, false);

    this.saplingMesh = this.createInstanced(saplingGeo, saplingMat, CAP_SAPLING, false);
    const deadfallMat = new THREE.MeshLambertMaterial({ map: textures.spruceBark });
    this.deadfallMesh = this.createInstanced(deadfallGeo, deadfallMat, CAP_DEADFALL, shadows);

    // Solid Woodland Bushes
    this.hazelStemMesh = this.createInstanced(hazel.stems, hazelStemMat, CAP_HAZEL, shadows);
    this.hazelLeafMesh = this.createInstanced(hazel.leaves, hazelLeafMat, CAP_HAZEL, false);
    this.juniperMesh = this.createInstanced(juniperGeo, juniperMat, CAP_JUNIPER, false);

    // Continuous Everywhere Individual 3D Grass Blades (1 single draw call!)
    const bladeGeo = buildSingleGrassBladeGeo();
    const bladeMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(bladeMat, windUniforms, {
      bendStart: 0.02,
      bendSpan: 0.44,
      bendAmp: 0.14,
      leafAmp: 0.045,
      leafFreq: 5.0,
    });
    this.grassBladeMesh = this.createInstanced(bladeGeo, bladeMat, GRASS_BLADE_CAP, false, false);

    const fernGeo = buildOpaqueFernRosetteGeo();
    const fernMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(fernMat, windUniforms, {
      bendStart: 0.04,
      bendSpan: 0.52,
      bendAmp: 0.11,
      leafAmp: 0.035,
      leafFreq: 3.9,
    });
    this.fernMesh = this.createInstanced(fernGeo, fernMat, CAP_FERN, false);

    const shrubGeo = buildBilberrySubShrubGeo();
    const shrubMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(shrubMat, windUniforms, {
      bendStart: 0.05,
      bendSpan: 0.48,
      bendAmp: 0.08,
      leafAmp: 0.025,
      leafFreq: 4.2,
    });
    this.shrubMesh = this.createInstanced(shrubGeo, shrubMat, CAP_SHRUB, false);

    const mossGeo = buildMossHummockGeo();
    const mossMat = new THREE.MeshLambertMaterial({
      map: textures.groundDetail,
      vertexColors: true,
    });
    this.mossHummockMesh = this.createInstanced(mossGeo, mossMat, CAP_MOSS, false);

    const reedGeo = buildOpaqueReedClumpGeo();
    const reedMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(reedMat, windUniforms, {
      bendStart: 0.06,
      bendSpan: 1.15,
      bendAmp: 0.22,
      leafAmp: 0.05,
      leafFreq: 4.1,
    });
    this.reedMesh = this.createInstanced(reedGeo, reedMat, CAP_REED, false);

    const boulderGeo = new THREE.DodecahedronGeometry(0.65, 1);
    boulderGeo.scale(1.15, 0.72, 1.0);
    const boulderMat = new THREE.MeshLambertMaterial({
      map: textures.boulderGranite,
    });
    this.boulderMesh = this.createInstanced(boulderGeo, boulderMat, CAP_BOULDER, shadows);
  }

  /**
   * Populates 13,500 individual 3D grass blades uniformly on a world-snapped jittered grid
   * around the camera, skipping only roads and water, eliminating patchy bare ground.
   */
  private updateGrassCarpet(camX: number, camZ: number): void {
    const snapStep = 1.6;
    const ax = Math.floor(camX / snapStep) * snapStep;
    const az = Math.floor(camZ / snapStep) * snapStep;
    if (ax === this.lastGrassAnchorX && az === this.lastGrassAnchorZ) return;
    this.lastGrassAnchorX = ax;
    this.lastGrassAnchorZ = az;

    const spacing = 0.46;
    const halfGrid = 28.5; // 57m x 57m continuous carpet around player
    const matArr = this.grassBladeMesh.instanceMatrix.array as Float32Array;
    const colArr = this.grassBladeMesh.instanceColor!.array as Float32Array;
    const minWorld = -WORLD_HALF + 2;
    const maxWorld = WORLD_HALF - 2;

    let count = 0;
    const randSeed = getActiveBlueprint().seed | 0;

    for (let gz = -halfGrid; gz <= halfGrid; gz += spacing) {
      const bz = az + gz;
      if (bz < minWorld || bz > maxWorld) continue;
      for (let gx = -halfGrid; gx <= halfGrid; gx += spacing) {
        if (count >= GRASS_BLADE_CAP) break;
        if (gx * gx + gz * gz > 28.0 * 28.0) continue;

        const bx = ax + gx;
        if (bx < minWorld || bx > maxWorld) continue;

        const ix = Math.round(bx / spacing);
        const iz = Math.round(bz / spacing);
        let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ randSeed;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        const r1 = ((h >>> 0) % 1000) / 1000;
        const r2 = (((h >>> 10) >>> 0) % 1000) / 1000;
        const r3 = (((h >>> 20) >>> 0) % 1000) / 1000;

        const px = bx + (r1 - 0.5) * spacing * 0.9;
        const pz = bz + (r2 - 0.5) * spacing * 0.9;

        const roadInfo = distToRoadDetail(px, pz);
        if (roadInfo.dist < (roadInfo.isTrail ? 1.5 : 2.3)) continue;
        if (this.isInsideBuilding(px, pz)) continue;

        const py = getTerrainHeight(px, pz);
        if (py < SWAMP_WATER_Y + 0.04) continue;

        const isl = getNearestSwampIsland(px, pz);
        const swamp = isl.islandMask > 0.35 ? 0 : getSwampFactor(px, pz);
        const scale = swamp > 0.35 ? 0.65 + r3 * 0.72 : 0.68 + r3 * 0.85;

        _bakeDummy.position.set(px, py - 0.03, pz);
        _bakeDummy.rotation.set(0, r1 * Math.PI * 2, 0);
        _bakeDummy.scale.set(0.88 + r2 * 0.45, scale, 0.88 + r2 * 0.45);
        _bakeDummy.updateMatrix();
        _bakeDummy.matrix.toArray(matArr, count * 16);

        const tone = 0.78 + r2 * 0.3;
        if (swamp > 0.35) {
          colArr[count * 3] = tone * 1.04;
          colArr[count * 3 + 1] = tone * 0.88;
          colArr[count * 3 + 2] = tone * 0.52;
        } else {
          colArr[count * 3] = tone * (0.82 + r1 * 0.16);
          colArr[count * 3 + 1] = tone * (0.94 + r3 * 0.14);
          colArr[count * 3 + 2] = tone * 0.66;
        }
        count++;
      }
      if (count >= GRASS_BLADE_CAP) break;
    }

    this.grassBladeMesh.count = count;
    this.grassBladeMesh.instanceMatrix.needsUpdate = true;
    this.grassBladeMesh.instanceColor!.needsUpdate = true;
  }

  private appendSlab(
    slab: BakedSlab,
    meshA: THREE.InstancedMesh,
    meshB: THREE.InstancedMesh | null,
    maxCap: number
  ): void {
    if (slab.count === 0) return;
    const avail = maxCap - meshA.count;
    if (avail <= 0) return;
    const take = slab.count <= avail ? slab.count : avail;
    const matSrc = take === slab.count ? slab.matrices : slab.matrices.subarray(0, take * 16);
    const colSrc = take === slab.count ? slab.colors : slab.colors.subarray(0, take * 3);

    const matArrA = meshA.instanceMatrix.array as Float32Array;
    matArrA.set(matSrc, meshA.count * 16);
    const colArrA = meshA.instanceColor!.array as Float32Array;
    colArrA.set(colSrc, meshA.count * 3);
    meshA.count += take;

    if (meshB) {
      const matArrB = meshB.instanceMatrix.array as Float32Array;
      matArrB.set(matSrc, meshB.count * 16);
      const colArrB = meshB.instanceColor!.array as Float32Array;
      colArrB.set(colSrc, meshB.count * 3);
      meshB.count += take;
    }
  }

  prewarmAround(x: number, z: number): void {
    const half = Math.floor(ACTIVE_GRID / 2);
    const pcx = Math.floor(x / CHUNK_SIZE);
    const pcz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.getOrBakeChunk(pcx + dx, pcz + dz);
      }
    }
    this.updateGrassCarpet(x, z);
    void half;
  }

  update(
    activeSlots: ActiveChunkSlot[],
    chunkLods: Int32Array,
    chunkSpheres: Float32Array,
    camPos: THREE.Vector3,
    elapsedTime: number,
    windStrength = 0.9,
    stats?: VegetationStats
  ): void {
    this.windTimeUniform.value = elapsedTime;
    this.windStrengthUniform.value = windStrength;

    this.updateGrassCarpet(camPos.x, camPos.z);

    let sig = '';
    for (let c = 0; c < CHUNK_COUNT; c++) {
      const lod = chunkLods[c];
      if (lod < 0 || chunkSpheres[c * 4 + 1] > 9000) continue;
      const sb = c * 4;
      const dx = chunkSpheres[sb] - camPos.x;
      const dz = chunkSpheres[sb + 2] - camPos.z;
      const dSq = dx * dx + dz * dz;
      const tier =
        dSq < 46 * 46 ? 4 : dSq < 74 * 74 ? 3 : dSq < 110 * 110 ? 2 : dSq < 150 * 150 ? 1 : 0;
      const slot = activeSlots[c];
      sig += `${slot.vcx},${slot.vcz}:${lod}:${tier};`;
    }

    if (sig === this.lastVisibilitySig) {
      if (stats) {
        stats.treesRendered = this.cachedTreesCount;
        stats.foliageRendered = this.cachedFoliageCount + this.grassBladeMesh.count;
      }
      return;
    }
    this.lastVisibilitySig = sig;

    for (let i = 0; i < this.allChunkMeshes.length; i++) {
      this.allChunkMeshes[i].count = 0;
    }

    for (let c = 0; c < CHUNK_COUNT; c++) {
      const lod = chunkLods[c];
      if (lod < 0 || chunkSpheres[c * 4 + 1] > 9000) continue;

      const sb = c * 4;
      const dx = chunkSpheres[sb] - camPos.x;
      const dz = chunkSpheres[sb + 2] - camPos.z;
      const dSq = dx * dx + dz * dz;
      const slot = activeSlots[c];
      const bucket = this.getOrBakeChunk(slot.vcx, slot.vcz);

      // Tight LOD0 cutoff (46m) keeps high-leaf trees razor sharp nearby without GPU bottleneck
      if (dSq < 46 * 46) {
        this.appendSlab(bucket.birch, this.birchTrunk0, this.birchCrown0, CAP_LOD0);
        this.appendSlab(bucket.pine, this.pineTrunk0, this.pineCrown0, CAP_LOD0);
        this.appendSlab(bucket.spruce, this.spruceTrunk0, this.spruceCrown0, CAP_LOD0);
      } else if (dSq < 110 * 110) {
        this.appendSlab(bucket.birch, this.birchTrunk1, this.birchCrown1, CAP_LOD1);
        this.appendSlab(bucket.pine, this.pineTrunk1, this.pineCrown1, CAP_LOD1);
        this.appendSlab(bucket.spruce, this.spruceTrunk1, this.spruceCrown1, CAP_LOD1);
      } else {
        this.appendSlab(bucket.birch, this.birchTrunk2, this.birchCrown2, CAP_LOD2);
        this.appendSlab(bucket.pine, this.pineTrunk2, this.pineCrown2, CAP_LOD2);
        this.appendSlab(bucket.spruce, this.spruceTrunk2, this.spruceCrown2, CAP_LOD2);
      }

      if (dSq < 115 * 115) {
        this.appendSlab(bucket.bogPine, this.bogPineTrunk, this.bogPineCrown, CAP_BOG_PINE);
        this.appendSlab(bucket.reed, this.reedMesh, null, CAP_REED);
      }
      if (dSq < 92 * 92) {
        this.appendSlab(bucket.hazelBush, this.hazelStemMesh, this.hazelLeafMesh, CAP_HAZEL);
        this.appendSlab(bucket.juniperBush, this.juniperMesh, null, CAP_JUNIPER);
        this.appendSlab(bucket.sapling, this.saplingMesh, null, CAP_SAPLING);
        this.appendSlab(bucket.deadfall, this.deadfallMesh, null, CAP_DEADFALL);
      }
      if (dSq < 68 * 68) {
        this.appendSlab(bucket.mossHummock, this.mossHummockMesh, null, CAP_MOSS);
        this.appendSlab(bucket.fern, this.fernMesh, null, CAP_FERN);
        this.appendSlab(bucket.shrub, this.shrubMesh, null, CAP_SHRUB);
      }
      if (dSq < 130 * 130) {
        this.appendSlab(bucket.boulder, this.boulderMesh, null, CAP_BOULDER);
      }
    }

    for (let i = 0; i < this.allChunkMeshes.length; i++) {
      const m = this.allChunkMeshes[i];
      if (m.count > 0) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }

    this.cachedTreesCount =
      this.birchTrunk0.count +
      this.birchTrunk1.count +
      this.birchTrunk2.count +
      this.pineTrunk0.count +
      this.pineTrunk1.count +
      this.pineTrunk2.count +
      this.bogPineTrunk.count +
      this.spruceTrunk0.count +
      this.spruceTrunk1.count +
      this.spruceTrunk2.count +
      this.saplingMesh.count +
      this.hazelStemMesh.count +
      this.juniperMesh.count;

    this.cachedFoliageCount =
      this.fernMesh.count +
      this.shrubMesh.count +
      this.mossHummockMesh.count +
      this.reedMesh.count +
      this.boulderMesh.count +
      this.deadfallMesh.count;

    if (stats) {
      stats.treesRendered = this.cachedTreesCount;
      stats.foliageRendered = this.cachedFoliageCount + this.grassBladeMesh.count;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
