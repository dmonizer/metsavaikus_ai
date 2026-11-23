import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ACTIVE_GRID,
  CHUNK_COUNT,
  CHUNK_SIZE,
  distToRoadDetail,
  getActiveBlueprint,
  getDistanceToNearestVillage,
  getNearestSwampIsland,
  getSwampFactor,
  getTerrainHeight,
  getThicketFactor,
  isDryLandForPlanting,
  lerp,
  smoothNoise,
  SWAMP_WATER_Y,
  WORLD_HALF,
} from './terrainMath';
import { ActiveChunkSlot } from './terrainChunkManager';
import { WorldTextures } from './proceduralTextures';
import { CircleCollider } from './architectureAndProps';
import {
  classifySphereFrustum,
  commitCompactedInstancedMesh,
  FrustumCullStatus,
  sphereIntersectsFrustum,
} from './forestFrustumCuller';

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

const _upVec = new THREE.Vector3(0, 1, 0);
const _tmpDir = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

export interface ConnectedTubeSegment {
  start: THREE.Vector3;
  end: THREE.Vector3;
  rBot: number;
  rTop: number;
  radialSegs: number;
  overlapStart?: number;
  overlapEnd?: number;
}

export function buildConnectedTube(seg: ConnectedTubeSegment): THREE.BufferGeometry {
  _tmpDir.subVectors(seg.end, seg.start);
  const exactLen = _tmpDir.length();
  const unitDir = exactLen > 1e-5 ? _tmpDir.clone().divideScalar(exactLen) : _upVec.clone();
  const overlapStart = seg.overlapStart ?? 0.045;
  const overlapEnd = seg.overlapEnd ?? 0.025;
  const totalLen = exactLen + overlapStart + overlapEnd;
  const g = new THREE.CylinderGeometry(seg.rTop, seg.rBot, totalLen, seg.radialSegs, 1);
  g.translate(0, exactLen * 0.5 + (overlapEnd - overlapStart) * 0.5, 0);
  _tmpQuat.setFromUnitVectors(_upVec, unitDir);
  g.applyQuaternion(_tmpQuat);
  g.translate(seg.start.x, seg.start.y, seg.start.z);
  return prepGeo(g);
}

export interface TreeTopologyReport {
  segments: ConnectedTubeSegment[];
  trunkEnd: THREE.Vector3;
  branchCount: number;
}

export function createBogPineSegments(): TreeTopologyReport {
  const p0 = new THREE.Vector3(0, -0.06, 0);
  const p1 = new THREE.Vector3(0.08, 1.05, 0.05);
  const p2 = new THREE.Vector3(-0.04, 1.94, 0.13);
  const p3 = new THREE.Vector3(-0.11, 2.62, 0.07);

  const b1Start = p1.clone().lerp(p2, 0.44);
  const b1End = b1Start.clone().add(new THREE.Vector3(-0.62, 0.62, -0.34));
  const b2Start = p1.clone().lerp(p2, 0.78);
  const b2End = b2Start.clone().add(new THREE.Vector3(0.58, 0.66, 0.26));
  const b3Start = p2.clone().lerp(p3, 0.42);
  const b3End = b3Start.clone().add(new THREE.Vector3(0.24, 0.56, -0.52));

  return {
    segments: [
      { start: p0, end: p1, rBot: 0.135, rTop: 0.095, radialSegs: 6, overlapStart: 0.02, overlapEnd: 0.04 },
      { start: p1, end: p2, rBot: 0.095, rTop: 0.062, radialSegs: 6, overlapStart: 0.04, overlapEnd: 0.04 },
      { start: p2, end: p3, rBot: 0.062, rTop: 0.025, radialSegs: 5, overlapStart: 0.04, overlapEnd: 0.02 },
      { start: b1Start, end: b1End, rBot: 0.052, rTop: 0.018, radialSegs: 5, overlapStart: 0.05, overlapEnd: 0.015 },
      { start: b2Start, end: b2End, rBot: 0.046, rTop: 0.016, radialSegs: 5, overlapStart: 0.05, overlapEnd: 0.015 },
      { start: b3Start, end: b3End, rBot: 0.036, rTop: 0.014, radialSegs: 5, overlapStart: 0.045, overlapEnd: 0.015 },
    ],
    trunkEnd: p3,
    branchCount: 3,
  };
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
 * Curved 2-segment arched photographic botanical sprig card (4 tris).
 * UV (0,0)-(1,1) maps stem at bottom (v=0) to leafy tips at top (v=1).
 * Uses soft upward-biased spherical canopy normals so crowns have lush volumetric shading.
 */
function makeArchedSprigCard(
  width: number,
  length: number,
  arch: number,
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
  colBase: THREE.Color,
  colTip: THREE.Color,
  crownCenterY?: number
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const midY = length * 0.52;
  const midZ = arch * 0.55;
  const tipZ = -arch * 0.65;

  // 6 vertices -> 2 quads (4 triangles) with gentle V-cup + downward droop arch
  const positions = new Float32Array([
    -hw * 0.85, 0, 0,
     hw * 0.85, 0, 0,
    -hw,        midY, midZ,
     hw,        midY, midZ,
    -hw * 0.88, length, tipZ,
     hw * 0.88, length, tipZ,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    0, 0.52,
    1, 0.52,
    0, 1,
    1, 1,
  ]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
  g.computeVertexNormals();
  g.rotateX(rx);
  g.rotateZ(rz);
  g.rotateY(ry);
  g.translate(px, py, pz);

  const nonIdx = prepGeo(g);
  const pos = nonIdx.attributes.position;
  const nrm = nonIdx.attributes.normal;
  const uvAttr = nonIdx.attributes.uv;
  const cols = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const v = uvAttr.getY(i);
    cols[i * 3] = lerp(colBase.r, colTip.r, v);
    cols[i * 3 + 1] = lerp(colBase.g, colTip.g, v);
    cols[i * 3 + 2] = lerp(colBase.b, colTip.b, v);

    // Blend surface normal with outward spherical crown normal for natural volumetric foliage lighting
    if (crownCenterY !== undefined) {
      const vx = pos.getX(i);
      const vy = pos.getY(i) - crownCenterY;
      const vz = pos.getZ(i);
      const len = Math.hypot(vx, vy + 1.2, vz) || 1;
      const sx = vx / len;
      const sy = (vy + 1.2) / len;
      const sz = vz / len;
      const nx = lerp(nrm.getX(i), sx, 0.68);
      const ny = lerp(nrm.getY(i), sy, 0.68);
      const nz = lerp(nrm.getZ(i), sz, 0.68);
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nrm.setXYZ(i, nx / nLen, ny / nLen, nz / nLen);
    }
  }
  nonIdx.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return nonIdx;
}

/**
 * Individual crisp 3D arched diamond leaf (2 opaque triangles) for small bilberry sub-shrubs.
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

// ============================================================================
// High-Fidelity Botanical Photo-Sprig Tree & Woodland Bush Geometries
// ============================================================================

function buildBirchGeometries() {
  const spine = [
    new THREE.Vector3(0, -0.1, 0),
    new THREE.Vector3(0.08, 2.05, -0.04),
    new THREE.Vector3(0.24, 4.2, 0.07),
    new THREE.Vector3(0.16, 6.35, 0.16),
    new THREE.Vector3(0.28, 8.5, 0.12),
  ];
  const radii = [0.22, 0.16, 0.12, 0.075, 0.032];
  const trunkParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < spine.length - 1; i++) {
    trunkParts.push(
      buildConnectedTube({
        start: spine[i],
        end: spine[i + 1],
        rBot: radii[i],
        rTop: radii[i + 1],
        radialSegs: 7,
        overlapStart: i === 0 ? 0.02 : 0.05,
        overlapEnd: 0.04,
      })
    );
  }
  const b1 = spine[2].clone().lerp(spine[3], 0.2);
  const b2 = spine[2].clone().lerp(spine[3], 0.48);
  const b3 = spine[2].clone().lerp(spine[3], 0.8);
  const b4 = spine[3].clone().lerp(spine[4], 0.14);
  const branchSpecs: ConnectedTubeSegment[] = [
    { start: b1, end: b1.clone().add(new THREE.Vector3(-0.95, 2.05, 0.65)), rBot: 0.06, rTop: 0.018, radialSegs: 5, overlapStart: 0.06 },
    { start: b2, end: b2.clone().add(new THREE.Vector3(0.95, 1.95, -0.62)), rBot: 0.056, rTop: 0.018, radialSegs: 5, overlapStart: 0.06 },
    { start: b3, end: b3.clone().add(new THREE.Vector3(0.72, 1.85, 0.78)), rBot: 0.05, rTop: 0.016, radialSegs: 5, overlapStart: 0.06 },
    { start: b4, end: b4.clone().add(new THREE.Vector3(-0.74, 1.65, -0.58)), rBot: 0.044, rTop: 0.016, radialSegs: 5, overlapStart: 0.06 },
  ];
  for (const bs of branchSpecs) trunkParts.push(buildConnectedTube(bs));

  const trunkLod0 = applyHeightGradient(
    mergeGeometries(trunkParts)!,
    0.2,
    2.2,
    new THREE.Color(0x3a3732),
    new THREE.Color(0xffffff)
  );

  // 18 airy wider photographic birch leaf-spray cards (47% less overdraw, richer silhouette!)
  const leafParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(11);
  const colInner = new THREE.Color(0x90a86a);
  const colMid = new THREE.Color(0xc0d48a);
  const colSun = new THREE.Color(0xeaf4aa);

  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 6 + rand() * 0.65;
    const t = i / 18;
    const r = (1 - t * 0.46) * (0.42 + rand() * 1.1);
    const y = 4.6 + t * 4.3 + (rand() - 0.5) * 0.45;
    const cardW = 1.95 + rand() * 0.78;
    const cardL = 2.15 + rand() * 0.85;
    const isOuter = r > 0.8 || y > 7.2;
    leafParts.push(
      makeArchedSprigCard(
        cardW,
        cardL,
        0.4,
        0.2 + Math.cos(a) * r,
        y,
        0.1 + Math.sin(a) * r,
        0.55 + (rand() - 0.5) * 0.65,
        a + (rand() - 0.5) * 0.9,
        (rand() - 0.5) * 0.5,
        isOuter ? colMid : colInner,
        isOuter ? colSun : colMid,
        7.1
      )
    );
  }
  const crownLod0 = mergeGeometries(leafParts)!;

  // LOD1: 8 broader crossed birch sprig sprays
  const lod1Bot = new THREE.Vector3(0, -0.1, 0);
  const lod1Top = new THREE.Vector3(0.26, 8.5, 0.1);
  const l1b1 = lod1Bot.clone().lerp(lod1Top, 0.6);
  const l1b2 = lod1Bot.clone().lerp(lod1Top, 0.64);
  const trunkLod1 = applyHeightGradient(
    mergeGeometries([
      buildConnectedTube({ start: lod1Bot, end: lod1Top, rBot: 0.21, rTop: 0.05, radialSegs: 5, overlapStart: 0.02 }),
      buildConnectedTube({ start: l1b1, end: l1b1.clone().add(new THREE.Vector3(-0.95, 2.0, 0.65)), rBot: 0.06, rTop: 0.025, radialSegs: 4, overlapStart: 0.05 }),
      buildConnectedTube({ start: l1b2, end: l1b2.clone().add(new THREE.Vector3(0.9, 1.95, -0.65)), rBot: 0.06, rTop: 0.025, radialSegs: 4, overlapStart: 0.05 }),
    ])!,
    0.2,
    2.2,
    new THREE.Color(0x3a3732),
    new THREE.Color(0xffffff)
  );
  const crownLod1Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 3.5 + rand() * 0.5;
    const t = i / 8;
    const r = (1 - t * 0.4) * (0.35 + rand() * 0.8);
    const y = 4.9 + t * 3.8;
    crownLod1Parts.push(
      makeArchedSprigCard(
        2.55 + rand() * 0.55,
        2.75 + rand() * 0.6,
        0.35,
        0.18 + Math.cos(a) * r,
        y,
        0.1 + Math.sin(a) * r,
        0.48 + (rand() - 0.5) * 0.55,
        a,
        (rand() - 0.5) * 0.4,
        t > 0.45 ? colMid : colInner,
        t > 0.45 ? colSun : colMid,
        7.1
      )
    );
  }
  const crownLod1 = mergeGeometries(crownLod1Parts)!;

  // LOD2: 3 crossed photo-sprig silhouettes (crisp far treeline, minimal overdraw!)
  const crownLod2Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    crownLod2Parts.push(
      makeArchedSprigCard(3.8, 5.2, 0.25, 0.16, 4.7, 0.08, 0.08, a, 0, colInner, colSun, 7.2)
    );
  }
  const crownLod2 = mergeGeometries(crownLod2Parts)!;
  const trunkLod2 = makeBranchCyl(0.06, 0.19, 7.6, 4, 0, -0.1, 0, 0, 0, -0.03);
  applyHeightGradient(trunkLod2, 0.2, 2.0, new THREE.Color(0x45423d), new THREE.Color(0xd8d3c9));

  return { trunkLod0, crownLod0, trunkLod1, crownLod1, trunkLod2, crownLod2 };
}

function buildPineGeometries() {
  const spine = [
    new THREE.Vector3(0, -0.12, 0),
    new THREE.Vector3(0.05, 3.38, 0.04),
    new THREE.Vector3(0.13, 6.88, -0.04),
    new THREE.Vector3(0.06, 10.38, -0.09),
    new THREE.Vector3(-0.02, 13.88, -0.04),
  ];
  const radii = [0.24, 0.2, 0.16, 0.115, 0.052];
  const trunkParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < spine.length - 1; i++) {
    trunkParts.push(
      buildConnectedTube({
        start: spine[i],
        end: spine[i + 1],
        rBot: radii[i],
        rTop: radii[i + 1],
        radialSegs: 7,
        overlapStart: i === 0 ? 0.02 : 0.05,
        overlapEnd: 0.04,
      })
    );
  }
  const pb1 = spine[3].clone().lerp(spine[4], 0.08);
  const pb2 = spine[3].clone().lerp(spine[4], 0.22);
  const pb3 = spine[3].clone().lerp(spine[4], 0.45);
  const pb4 = spine[3].clone().lerp(spine[4], 0.62);
  for (const seg of [
    { start: pb1, end: pb1.clone().add(new THREE.Vector3(-2.15, 1.25, 0.55)), rBot: 0.075, rTop: 0.025, radialSegs: 5, overlapStart: 0.06 },
    { start: pb2, end: pb2.clone().add(new THREE.Vector3(1.95, 1.22, -0.85)), rBot: 0.075, rTop: 0.025, radialSegs: 5, overlapStart: 0.06 },
    { start: pb3, end: pb3.clone().add(new THREE.Vector3(-0.55, 1.38, 1.7)), rBot: 0.068, rTop: 0.022, radialSegs: 5, overlapStart: 0.06 },
    { start: pb4, end: pb4.clone().add(new THREE.Vector3(0.75, 1.4, -1.55)), rBot: 0.065, rTop: 0.022, radialSegs: 5, overlapStart: 0.06 },
  ]) {
    trunkParts.push(buildConnectedTube(seg));
  }
  const trunkLod0 = applyHeightGradient(
    mergeGeometries(trunkParts)!,
    2.4,
    8.8,
    new THREE.Color(0x524c48),
    new THREE.Color(0xe69f70)
  );

  // 16 umbrella-tiered photographic Scots pine needle-bough sprays (38% less overdraw!)
  const needleParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(22);
  const pineInner = new THREE.Color(0x90aa7c);
  const pineMid = new THREE.Color(0xb4ce90);
  const pineSun = new THREE.Color(0xd6e8a6);

  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 6 + rand() * 0.5;
    const t = i / 16;
    const r = (1 - t * 0.5) * (0.45 + rand() * 1.3);
    const y = 10.6 + t * 3.1 + (rand() - 0.5) * 0.4;
    const w = 2.15 + rand() * 0.78;
    const l = 2.0 + rand() * 0.7;
    needleParts.push(
      makeArchedSprigCard(
        w,
        l,
        0.36,
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        0.88 + (rand() - 0.5) * 0.55,
        a,
        (rand() - 0.5) * 0.42,
        t < 0.4 ? pineInner : pineMid,
        t > 0.55 ? pineSun : pineMid,
        12.4
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
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 3.5 + rand() * 0.45;
    const t = i / 7;
    const r = (1 - t * 0.45) * (0.35 + rand() * 1.1);
    const y = 10.8 + t * 2.8;
    crownLod1Parts.push(
      makeArchedSprigCard(
        2.75 + rand() * 0.5,
        2.5 + rand() * 0.45,
        0.3,
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        0.85 + (rand() - 0.5) * 0.45,
        a,
        (rand() - 0.5) * 0.35,
        t < 0.4 ? pineInner : pineMid,
        t > 0.55 ? pineSun : pineMid,
        12.4
      )
    );
  }
  const crownLod1 = mergeGeometries(crownLod1Parts)!;

  const trunkLod2 = makeBranchCyl(0.07, 0.22, 13.2, 4, 0, -0.1, 0, 0, 0, 0);
  applyHeightGradient(trunkLod2, 2.4, 8.5, new THREE.Color(0x504944), new THREE.Color(0xd28d60));
  const crownLod2Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    crownLod2Parts.push(
      makeArchedSprigCard(4.5, 3.8, 0.28, 0, 10.6, 0, 0.14, a, 0, pineInner, pineSun, 12.5)
    );
  }
  const crownLod2 = mergeGeometries(crownLod2Parts)!;

  return { trunkLod0, crownLod0, trunkLod1, crownLod1, trunkLod2, crownLod2 };
}

function buildBogPineGeometries() {
  const topo = createBogPineSegments();
  const trunk = mergeGeometries(topo.segments.map((s) => buildConnectedTube(s)))!;

  const anchors = [
    topo.trunkEnd,
    topo.segments[3].end,
    topo.segments[4].end,
    topo.segments[5].end,
    topo.segments[2].start.clone().lerp(topo.segments[2].end, 0.6),
  ];
  const needleParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(29);
  const bogDark = new THREE.Color(0x6e8854);
  const bogTip = new THREE.Color(0xa4be72);
  for (let i = 0; i < 16; i++) {
    const anchor = anchors[i % anchors.length];
    const a = (i / 16) * Math.PI * 5 + rand() * 0.6;
    const r = 0.04 + rand() * 0.22;
    const dy = (rand() - 0.35) * 0.22;
    needleParts.push(
      makeArchedSprigCard(
        0.78 + rand() * 0.36,
        0.72 + rand() * 0.32,
        0.18,
        anchor.x + Math.cos(a) * r,
        anchor.y + dy - 0.15,
        anchor.z + Math.sin(a) * r,
        0.65 + (rand() - 0.5) * 0.6,
        a,
        (rand() - 0.5) * 0.45,
        bogDark,
        bogTip,
        2.6
      )
    );
  }
  return { trunk, crown: mergeGeometries(needleParts)! };
}

function buildSpruceGeometries() {
  const trunkLod0 = makeBranchCyl(0.03, 0.24, 11.2, 6, 0, -0.1, 0, 0, 0, 0);
  const boughParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(33);
  const spInner = new THREE.Color(0x829e74);
  const spMid = new THREE.Color(0xa6c28c);
  const spTip = new THREE.Color(0xcce2a4);

  const tiers = [
    { y: 2.15, r: 0.35, w: 2.1, l: 2.35, count: 5 },
    { y: 3.75, r: 0.28, w: 1.85, l: 2.05, count: 4 },
    { y: 5.35, r: 0.24, w: 1.6, l: 1.78, count: 4 },
    { y: 6.9, r: 0.18, w: 1.32, l: 1.48, count: 4 },
    { y: 8.4, r: 0.12, w: 0.98, l: 1.15, count: 3 },
    { y: 9.75, r: 0.08, w: 0.68, l: 0.9, count: 2 },
  ];

  // Drooping tiered Norway spruce photo-boughs (22 boughs -> 43% less overdraw!)
  for (let t = 0; t < tiers.length; t++) {
    const tier = tiers[t];
    for (let i = 0; i < tier.count; i++) {
      const a = (i / tier.count) * Math.PI * 2 + t * 0.58 + (rand() - 0.5) * 0.22;
      boughParts.push(
        makeArchedSprigCard(
          tier.w * (0.92 + rand() * 0.18),
          tier.l * (0.92 + rand() * 0.18),
          0.34,
          Math.sin(a) * tier.r,
          tier.y + (rand() - 0.5) * 0.24,
          Math.cos(a) * tier.r,
          1.34 + (rand() - 0.5) * 0.22,
          a,
          (rand() - 0.5) * 0.22,
          i % 2 === 0 ? spInner : spMid,
          spTip,
          6.0
        )
      );
    }
  }
  for (let k = 0; k < 2; k++) {
    const a = (k / 2) * Math.PI;
    boughParts.push(
      makeArchedSprigCard(0.54, 0.98, 0.1, 0, 10.3, 0, 0.2, a, 0, spMid, spTip, 10.6)
    );
  }
  const crownLod0 = mergeGeometries(boughParts)!;

  // LOD1: 9 tiered drooping photo-boughs
  const trunkLod1 = makeBranchCyl(0.04, 0.23, 11.0, 5, 0, -0.1, 0, 0, 0, 0);
  const c1Parts: THREE.BufferGeometry[] = [];
  const lod1Tiers = [
    { y: 2.4, w: 2.55, l: 2.55, count: 3 },
    { y: 5.0, w: 2.05, l: 2.15, count: 3 },
    { y: 7.6, w: 1.45, l: 1.65, count: 3 },
  ];
  for (let t = 0; t < lod1Tiers.length; t++) {
    const tier = lod1Tiers[t];
    for (let i = 0; i < tier.count; i++) {
      const a = (i / tier.count) * Math.PI * 2 + t * 0.78;
      c1Parts.push(
        makeArchedSprigCard(tier.w, tier.l, 0.28, 0, tier.y, 0, 1.28, a, 0, spInner, spTip, 6.0)
      );
    }
  }
  const crownLod1 = mergeGeometries(c1Parts)!;

  // LOD2: 4 crossed silhouette bough cards forming a realistic tapered spruce spire
  const trunkLod2 = makeBranchCyl(0.06, 0.22, 4.0, 4, 0, -0.1, 0, 0, 0, 0);
  const c2Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const a = (i / 2) * Math.PI;
    c2Parts.push(makeArchedSprigCard(4.3, 5.4, 0.18, 0, 1.8, 0, 0.08, a, 0, spInner, spMid, 6.0));
    c2Parts.push(makeArchedSprigCard(2.9, 5.2, 0.12, 0, 6.1, 0, 0.06, a + 0.7, 0, spMid, spTip, 8.2));
  }
  const crownLod2 = mergeGeometries(c2Parts)!;

  return { trunkLod0, crownLod0, trunkLod1, crownLod1, trunkLod2, crownLod2 };
}

function buildSpruceSaplingGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rand = seededRand(39);
  const spDark = new THREE.Color(0x88aa6c);
  const spTip = new THREE.Color(0xcce496);
  for (let t = 0; t < 4; t++) {
    const y = 0.32 + t * 0.36;
    const count = 4 - Math.floor(t * 0.5);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + t * 0.75;
      parts.push(
        makeArchedSprigCard(
          0.62 - t * 0.1,
          0.68 - t * 0.1 + rand() * 0.08,
          0.14,
          Math.sin(a) * 0.04,
          y,
          Math.cos(a) * 0.04,
          1.12,
          a,
          0,
          spDark,
          spTip,
          0.95
        )
      );
    }
  }
  parts.push(makeArchedSprigCard(0.32, 0.55, 0.05, 0, 1.48, 0, 0.1, 0.4, 0, spDark, spTip, 1.6));
  return mergeGeometries(parts)!;
}

// ============================================================================
// Solid Multi-Part Estonian Woodland Bushes with Photo-Sprig Foliage
// ============================================================================

function buildHazelBushGeometries() {
  const rand = seededRand(411);
  const stemParts: THREE.BufferGeometry[] = [];
  const leafParts: THREE.BufferGeometry[] = [];
  const darkG = new THREE.Color(0x86a866);
  const midG = new THREE.Color(0xb2cc7e);
  const brightG = new THREE.Color(0xdcf098);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.35;
    const tilt = 0.28 + rand() * 0.32;
    const len = 1.15 + rand() * 0.55;
    const pStart = new THREE.Vector3(Math.cos(a) * 0.08, -0.04, Math.sin(a) * 0.08);
    const pEnd = pStart.clone().add(
      new THREE.Vector3(
        Math.cos(a) * len * Math.sin(tilt),
        len * Math.cos(tilt),
        Math.sin(a) * len * Math.sin(tilt)
      )
    );
    stemParts.push(
      buildConnectedTube({
        start: pStart,
        end: pEnd,
        rBot: 0.038,
        rTop: 0.015,
        radialSegs: 4,
        overlapStart: 0.02,
        overlapEnd: 0.015,
      })
    );
    const forkStart = pStart.clone().lerp(pEnd, 0.48);
    const twigAngle = a + (rand() - 0.5) * 1.1;
    const forkEnd = forkStart.clone().add(
      new THREE.Vector3(
        Math.cos(twigAngle) * 0.42,
        0.48 + rand() * 0.16,
        Math.sin(twigAngle) * 0.42
      )
    );
    stemParts.push(
      buildConnectedTube({
        start: forkStart,
        end: forkEnd,
        rBot: 0.02,
        rTop: 0.008,
        radialSegs: 4,
        overlapStart: 0.03,
        overlapEnd: 0.01,
      })
    );
  }

  // 14 layered photographic bush-leaf sprig cards woven into the hazel twigs
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 4.5 + rand() * 0.55;
    const y = 0.24 + (i / 14) * 0.72 + (rand() - 0.5) * 0.14;
    const r = 0.12 + rand() * 0.38;
    const outer = r > 0.28 || y > 0.68;
    leafParts.push(
      makeArchedSprigCard(
        0.92 + rand() * 0.38,
        0.96 + rand() * 0.36,
        0.24,
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        0.65 + (rand() - 0.5) * 0.55,
        a,
        (rand() - 0.5) * 0.4,
        outer ? midG : darkG,
        outer ? brightG : midG,
        0.85
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
  const jDark = new THREE.Color(0x7c9c70);
  const jTip = new THREE.Color(0xb2d094);

  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 4.5 + rand() * 0.4;
    const t = i / 14;
    const y = 0.06 + t * 0.66;
    const r = (1 - t * 0.62) * (0.1 + rand() * 0.2);
    parts.push(
      makeArchedSprigCard(
        0.66 + rand() * 0.28,
        0.78 + rand() * 0.28,
        0.16,
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        0.48 + (rand() - 0.5) * 0.38,
        a,
        (rand() - 0.5) * 0.25,
        jDark,
        jTip,
        0.72
      )
    );
  }
  return mergeGeometries(parts)!;
}

// ============================================================================
// Multi-Blade Opaque Grass Tufts, Photographic Ferns, Bilberry & Moss Knolls
// ============================================================================

/**
 * Photorealistic 3-plane crossed Estonian meadow/forest grass, sedge & clover clump (6 tris total!).
 * Uses 512x512 photo-sampled grassClumpCard with upward-biased terrain-blended normals for seamless ground merging.
 */
function buildGrassTuftGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rootCol = new THREE.Color(0x6c7a52);
  const tipCol = new THREE.Color(0xeef4cc);
  const hw = 0.42;
  const h = 0.42;

  for (let p = 0; p < 3; p++) {
    const ang = (p / 3) * Math.PI + (p === 1 ? 0.14 : p === 2 ? -0.12 : 0);
    const tilt = 0.12;
    const positions = new Float32Array([
      -hw, -0.02, 0,
       hw, -0.02, 0,
       hw * 1.06, h, tilt,
      -hw * 1.06, h, tilt,
    ]);
    const uvs = new Float32Array([
      0.03, 0.0,
      0.97, 0.0,
      0.97, 0.98,
      0.03, 0.98,
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.rotateY(ang);
    const nonIdx = g.toNonIndexed();
    g.dispose();

    const pos = nonIdx.attributes.position;
    const nrms = new Float32Array(pos.count * 3);
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getY(i) / h));
      const c = rootCol.clone().lerp(tipCol, t);
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
      // Upward-biased terrain normal so clumps blend seamlessly into ground lighting from every angle
      nrms[i * 3] = 0;
      nrms[i * 3 + 1] = 1;
      nrms[i * 3 + 2] = 0;
    }
    nonIdx.setAttribute('normal', new THREE.BufferAttribute(nrms, 3));
    nonIdx.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    parts.push(nonIdx);
  }
  return mergeGeometries(parts)!;
}

function buildBilberrySubShrubGeo(): THREE.BufferGeometry {
  const rand = seededRand(802);
  const parts: THREE.BufferGeometry[] = [];
  const stemRoot = new THREE.Color(0x3a2f1e);
  const stemTop = new THREE.Color(0x526b2a);
  const leafDark = new THREE.Color(0x345c20);
  const leafBright = new THREE.Color(0x74a83a);

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
  const g = new THREE.SphereGeometry(0.65, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.48);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const n = smoothNoise(px * 4.2 + 3.1, pz * 4.2 - 1.9);
    pos.setX(i, px * (1.1 + n * 0.35));
    pos.setY(i, py * (0.14 + n * 0.1));
    pos.setZ(i, pz * (0.98 + n * 0.32));
  }
  g.computeVertexNormals();
  return prepGeo(g, new THREE.Color(0x3f5425), new THREE.Color(0x637d35));
}

function buildOpaqueReedClumpGeo(): THREE.BufferGeometry {
  const rand = seededRand(803);
  const parts: THREE.BufferGeometry[] = [];
  const rootCol = new THREE.Color(0x3f3c1f);
  const tipCol = new THREE.Color(0x9a8840);

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

/**
 * Lush woodland fern rosette built from 7 arched photographic pinnate fern fronds.
 */
function buildPhotoFernRosetteGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const darkF = new THREE.Color(0x527a3a);
  const tipF = new THREE.Color(0x96c458);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + (i % 2) * 0.22;
    const sc = i % 2 === 0 ? 1.0 : 0.78;
    parts.push(
      makeArchedSprigCard(
        0.54 * sc,
        0.96 * sc,
        0.34 * sc,
        Math.sin(a) * 0.05,
        0.02,
        Math.cos(a) * 0.05,
        0.86 + (i % 2) * 0.18,
        a,
        0,
        darkF,
        tipF,
        0.35
      )
    );
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
// Synchronized Traveling-Gust Wind + Backlit Subsurface Scattering Shader
// ============================================================================

interface WindUniformSet {
  time: { value: number };
  strength: { value: number };
  dir: { value: THREE.Vector2 };
  sunDir: { value: THREE.Vector3 };
  sunColor: { value: THREE.Color };
}

interface WindShaderOpts {
  bendStart: number;
  bendSpan: number;
  bendAmp: number;
  leafAmp: number;
  leafFreq: number;
  sssStrength?: number;
}

function addWindSway(
  mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  uniforms: WindUniformSet,
  opts: WindShaderOpts
): void {
  const sss = opts.sssStrength ?? 0;
  const cacheKey = `wind_sss_${opts.bendStart}_${opts.bendSpan}_${opts.bendAmp}_${opts.leafAmp}_${opts.leafFreq}_${sss}`;
  mat.customProgramCacheKey = () => cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uniforms.time;
    shader.uniforms.uWindStrength = uniforms.strength;
    shader.uniforms.uWindDir = uniforms.dir;
    shader.uniforms.uSssSunDir = uniforms.sunDir;
    shader.uniforms.uSssSunColor = uniforms.sunColor;

    shader.vertexShader =
      `uniform float uWindTime;\nuniform float uWindStrength;\nuniform vec2 uWindDir;\n` +
      (sss > 0 ? `varying vec3 vSssWorldPos;\n` : '') +
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

    if (sss > 0) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 sssWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          sssWp = instanceMatrix * sssWp;
        #endif
        vSssWorldPos = (modelMatrix * sssWp).xyz;`
      );

      shader.fragmentShader =
        `uniform vec3 uSssSunDir;\nuniform vec3 uSssSunColor;\nvarying vec3 vSssWorldPos;\n` +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `// View-dependent sunlit foliage translucency (backlit chartreuse-gold glow + cool Baltic sky bounce)
          vec3 sssViewDir = normalize(cameraPosition - vSssWorldPos);
          float sssAlign = clamp(dot(sssViewDir, -uSssSunDir), 0.0, 1.0);
          float sssDay = smoothstep(0.02, 0.26, uSssSunDir.y);
          float sssBack = pow(sssAlign, 2.6) * ${sss.toFixed(3)} * sssDay;
          float sssWrap = ${(sss * 0.26).toFixed(3)} * sssDay;
          outgoingLight += diffuseColor.rgb * uSssSunColor * (sssBack + sssWrap) * vec3(1.14, 1.2, 0.72);
          outgoingLight += diffuseColor.rgb * vec3(0.09, 0.13, 0.14) * sssDay;
          #include <opaque_fragment>`
        );
    }
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
  // Packed [cx, cy, cz, radius] per instance for exact per-instance frustum culling
  bounds: Float32Array;
}

const EMPTY_SLAB: BakedSlab = {
  count: 0,
  matrices: new Float32Array(0),
  colors: new Float32Array(0),
  bounds: new Float32Array(0),
};

const _bakeDummy = new THREE.Object3D();

function bakeRecords(
  records: InstanceRecord[],
  centerYOffset: number,
  boundRadius: number
): BakedSlab {
  const n = records.length;
  if (n === 0) return EMPTY_SLAB;
  const matrices = new Float32Array(n * 16);
  const colors = new Float32Array(n * 3);
  const bounds = new Float32Array(n * 4);
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
    const bOff = i * 4;
    bounds[bOff] = rec.x;
    bounds[bOff + 1] = rec.y + centerYOffset * rec.scale;
    bounds[bOff + 2] = rec.z;
    bounds[bOff + 3] = boundRadius * rec.scale;
  }
  return { count: n, matrices, colors, bounds };
}

interface SubCellBaked {
  cx: number;
  cy: number;
  cz: number;
  r: number;
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
  totalInstances: number;
}

interface ChunkBucketBaked {
  cells: SubCellBaked[];
  colliders: CircleCollider[];
}

interface GrassTileBaked {
  slab: BakedSlab;
  cx: number;
  cy: number;
  cz: number;
  r: number;
}

const EMPTY_GRASS_TILE: GrassTileBaked = {
  slab: EMPTY_SLAB,
  cx: 0,
  cy: 0,
  cz: 0,
  r: 0,
};

function partitionByQuadrant(
  records: InstanceRecord[],
  midX: number,
  midZ: number
): [InstanceRecord[], InstanceRecord[], InstanceRecord[], InstanceRecord[]] {
  const q: [InstanceRecord[], InstanceRecord[], InstanceRecord[], InstanceRecord[]] = [
    [],
    [],
    [],
    [],
  ];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const idx = (rec.z >= midZ ? 2 : 0) + (rec.x >= midX ? 1 : 0);
    q[idx].push(rec);
  }
  return q;
}

export interface VegetationStats {
  treesRendered: number;
  foliageRendered: number;
  culledInstances?: number;
  candidateInstances?: number;
}

const CAP_LOD0 = 420;
const CAP_LOD1 = 760;
const CAP_LOD2 = 1280;
const CAP_BOG_PINE = 300;
const CAP_SAPLING = 720;
const CAP_HAZEL = 880;
const CAP_JUNIPER = 640;
const CAP_FERN = 1040;
const CAP_SHRUB = 1800;
const CAP_MOSS = 680;
const CAP_REED = 960;
const CAP_BOULDER = 220;
const CAP_DEADFALL = 180;

// Each instanced photographic grass clump renders 3 crossed curved photo-cards (6 tris!)
// Frustum culling trims 360-degree carpet to only camera-visible tiles (~65% fewer GPU instances!)
const GRASS_BLADE_CAP = 5200;
const GRASS_TILE_SIZE = 16;
const GRASS_TILE_RADIUS = 2; // 5x5 minus 4 far corners = 21 tiles (~34-42m carpet radius)
const GRASS_BLADE_SPACING = 0.68;
const MAX_GRASS_TILE_CACHE = 180;
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
  readonly sunDirUniform = { value: new THREE.Vector3(0.5, 0.6, 0.35).normalize() };
  readonly sunColorUniform = { value: new THREE.Color(0xfff1d6) };

  private readonly chunkCache = new Map<string, ChunkBucketBaked>();
  private readonly grassTileCache = new Map<string, GrassTileBaked>();
  private readonly indexedColliderChunks = new Set<string>();
  private readonly colliderGrid = new Map<string, CircleCollider[]>();
  private readonly buildingRects: BuildingRect[];
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private lastVisibilitySig = '';
  private lastCullCamX = 999999;
  private lastCullCamZ = 999999;
  private lastCullFwdX = 0;
  private lastCullFwdZ = 0;
  private lastFogCullDist = 225;
  private lastGrassTileX = 999999;
  private lastGrassTileZ = 999999;
  private lastGrassFwdX = 0;
  private lastGrassFwdZ = 0;
  private grassHasPendingTiles = true;

  // Tree LOD InstancedMeshes (paired trunk+crown share identical instanceMatrix & instanceColor buffers!)
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

  // Solid Woodland Bushes
  private hazelStemMesh!: THREE.InstancedMesh;
  private hazelLeafMesh!: THREE.InstancedMesh;
  private juniperMesh!: THREE.InstancedMesh;

  // Ground Coverage + Player-Centered Frustum-Culled Grass Carpet
  private grassBladeMesh!: THREE.InstancedMesh;
  private fernMesh!: THREE.InstancedMesh;
  private shrubMesh!: THREE.InstancedMesh;
  private mossHummockMesh!: THREE.InstancedMesh;
  private reedMesh!: THREE.InstancedMesh;
  private boulderMesh!: THREE.InstancedMesh;

  private primaryChunkMeshes: THREE.InstancedMesh[] = [];
  private pairedFollowers: Array<{ primary: THREE.InstancedMesh; follower: THREE.InstancedMesh }> = [];
  private cachedTreesCount = 0;
  private cachedFoliageCount = 0;
  private cachedCulledCount = 0;
  private cachedCandidateCount = 0;
  private diagChunkBakes = 0;
  private diagChunkEvictions = 0;
  private diagVisRebuilds = 0;
  private diagGrassRebuilds = 0;

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

    const centerX = minX + CHUNK_SIZE * 0.5;
    const centerZ = minZ + CHUNK_SIZE * 0.5;
    if (
      Math.abs(centerX) > WORLD_HALF + CHUNK_SIZE * 0.5 ||
      Math.abs(centerZ) > WORLD_HALF + CHUNK_SIZE * 0.5
    ) {
      const empty: ChunkBucketBaked = {
        cells: [],
        colliders: [],
      };
      this.chunkCache.set(key, empty);
      return empty;
    }

    // 1. Dense Estonian Forest Trees
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
        if (isDryLandForPlanting(tx, tz, 0.24, 1.1) && rand() < 0.45) {
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

      // Never allow forest trees inside lakes, flooded basins, or submerged island rims
      if (!isDryLandForPlanting(tx, tz, 0.34, 1.5)) continue;

      if (onIsland && isl.island!.hut && isl.dist < 6.8) continue;

      const groveNoise = smoothNoise(tx * 0.032, tz * 0.032);
      const s = 0.82 + rand() * 0.56;
      const tint = 0.84 + rand() * 0.24;
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

    // 2. Thicket Density Boost & Solid Woodland Bushes (Põõsad)
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
      if (thicket < 0.45 && rand() > 0.55) continue;

      const by = getTerrainHeight(bx, bz);
      if (!isDryLandForPlanting(bx, bz, 0.24, 0.95)) continue;
      const s = 0.78 + rand() * 0.65;

      const roll = rand();
      if (roll < 0.48) {
        hazelBush.push({
          x: bx,
          y: by - 0.04,
          z: bz,
          scale: s,
          rotY: rand() * Math.PI * 2,
          r: 0.85 + rand() * 0.2,
          g: 0.92 + rand() * 0.14,
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
          r: 0.82 + rand() * 0.18,
          g: 0.92 + rand() * 0.14,
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
          r: 0.84 + rand() * 0.18,
          g: 0.94 + rand() * 0.14,
          b: 0.78 + rand() * 0.12,
        });
        if (thicket > 0.62) {
          colliders.push({ x: bx, z: bz, r: 0.45 * s });
        }
      }
    }

    if (getThicketFactor(centerX, centerZ) > 0.58) {
      for (let i = 0; i < 24; i++) {
        const tx = minX + rand() * CHUNK_SIZE;
        const tz = minZ + rand() * CHUNK_SIZE;
        if (distToRoadDetail(tx, tz).dist < 3.6) continue;
        const nearV = getDistanceToNearestVillage(tx, tz);
        if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.7) continue;
        if (this.isInsideBuilding(tx, tz)) continue;
        if (getSwampFactor(tx, tz) > 0.36) continue;
        if (!isDryLandForPlanting(tx, tz, 0.32, 1.35)) continue;
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

    // 3. Multi-Layered Forest Understory
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
        if (gy <= SWAMP_WATER_Y + 0.35 && rand() < 0.65) {
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
        } else if (gy > SWAMP_WATER_Y + 0.14 && rand() < 0.22) {
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

      // Dry-land forest floor understory must sit cleanly above lake water level
      if (gy < SWAMP_WATER_Y + 0.16) continue;

      if (patch > 0.62 && rand() < 0.48) {
        fern.push({
          x: gx,
          y: gy - 0.03,
          z: gz,
          scale: 0.82 + rand() * 0.58,
          rotY: rand() * Math.PI * 2,
          r: 0.82 + rand() * 0.2,
          g: 0.92 + rand() * 0.14,
          b: 0.75 + rand() * 0.14,
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
      } else if (rand() < 0.28 && getDistanceToNearestVillage(gx, gz).dist > 34) {
        mossHummock.push({
          x: gx,
          y: gy - 0.04,
          z: gz,
          scale: 0.78 + rand() * 0.72,
          rotY: rand() * Math.PI * 2,
          r: 0.78 + rand() * 0.18,
          g: 0.88 + rand() * 0.14,
          b: 0.68 + rand() * 0.12,
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
      if (!isDryLandForPlanting(dx, dz, 0.24, 1.15)) continue;
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
      if (by < SWAMP_WATER_Y + 0.18) continue;
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

    // Partition into 2x2 spatial sub-cells (24x24m quadrants) for hierarchical frustum culling!
    const qBirch = partitionByQuadrant(birch, centerX, centerZ);
    const qPine = partitionByQuadrant(pine, centerX, centerZ);
    const qBogPine = partitionByQuadrant(bogPine, centerX, centerZ);
    const qSpruce = partitionByQuadrant(spruce, centerX, centerZ);
    const qSapling = partitionByQuadrant(sapling, centerX, centerZ);
    const qHazel = partitionByQuadrant(hazelBush, centerX, centerZ);
    const qJuniper = partitionByQuadrant(juniperBush, centerX, centerZ);
    const qFern = partitionByQuadrant(fern, centerX, centerZ);
    const qShrub = partitionByQuadrant(shrub, centerX, centerZ);
    const qMoss = partitionByQuadrant(mossHummock, centerX, centerZ);
    const qReed = partitionByQuadrant(reed, centerX, centerZ);
    const qBoulder = partitionByQuadrant(boulder, centerX, centerZ);
    const qDeadfall = partitionByQuadrant(deadfall, centerX, centerZ);

    const quarter = CHUNK_SIZE * 0.25;
    const cells: SubCellBaked[] = [];
    for (let q = 0; q < 4; q++) {
      const sBirch = bakeRecords(qBirch[q], 6.0, 7.6);
      const sPine = bakeRecords(qPine[q], 7.4, 8.6);
      const sBogPine = bakeRecords(qBogPine[q], 1.6, 2.5);
      const sSpruce = bakeRecords(qSpruce[q], 5.6, 6.8);
      const sSapling = bakeRecords(qSapling[q], 1.1, 1.8);
      const sHazel = bakeRecords(qHazel[q], 1.1, 1.9);
      const sJuniper = bakeRecords(qJuniper[q], 0.9, 1.6);
      const sFern = bakeRecords(qFern[q], 0.4, 1.2);
      const sShrub = bakeRecords(qShrub[q], 0.35, 1.1);
      const sMoss = bakeRecords(qMoss[q], 0.25, 1.2);
      const sReed = bakeRecords(qReed[q], 0.7, 1.4);
      const sBoulder = bakeRecords(qBoulder[q], 0.3, 1.3);
      const sDeadfall = bakeRecords(qDeadfall[q], 0.35, 2.2);

      const totalInstances =
        sBirch.count +
        sPine.count +
        sBogPine.count +
        sSpruce.count +
        sSapling.count +
        sHazel.count +
        sJuniper.count +
        sFern.count +
        sShrub.count +
        sMoss.count +
        sReed.count +
        sBoulder.count +
        sDeadfall.count;
      if (totalInstances === 0) continue;

      const qx = minX + ((q & 1) ? quarter * 3 : quarter);
      const qz = minZ + ((q & 2) ? quarter * 3 : quarter);
      const baseH = getTerrainHeight(qx, qz);
      const hasTallTrees = sBirch.count + sPine.count + sSpruce.count > 0;
      const cy = baseH + (hasTallTrees ? 6.5 : 1.5);
      // Half-diagonal of 24x24m quadrant (~17m) + crown overhang
      const r = hasTallTrees ? 21.5 : 18.5;

      cells.push({
        cx: qx,
        cy,
        cz: qz,
        r,
        birch: sBirch,
        pine: sPine,
        bogPine: sBogPine,
        spruce: sSpruce,
        sapling: sSapling,
        hazelBush: sHazel,
        juniperBush: sJuniper,
        fern: sFern,
        shrub: sShrub,
        mossHummock: sMoss,
        reed: sReed,
        boulder: sBoulder,
        deadfall: sDeadfall,
        totalInstances,
      });
    }

    const baked: ChunkBucketBaked = {
      cells,
      colliders,
    };

    if (!this.indexedColliderChunks.has(key)) {
      this.indexedColliderChunks.add(key);
      this.indexChunkColliders(colliders);
    }
    this.chunkCache.set(key, baked);
    this.diagChunkBakes++;
    if (this.chunkCache.size > MAX_CHUNK_CACHE) {
      const oldestKey = this.chunkCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.chunkCache.delete(oldestKey);
        this.diagChunkEvictions++;
      }
    }

    return baked;
  }

  private createInstanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    maxCapacity: number,
    castShadow: boolean,
    receiveShadow = false,
    registerInChunkMeshes = true
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, maxCapacity);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colors = new Float32Array(maxCapacity * 3);
    colors.fill(1);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    if (registerInChunkMeshes) this.primaryChunkMeshes.push(mesh);
    this.disposables.push(geo, mat);
    return mesh;
  }

  /**
   * Creates a paired InstancedMesh (e.g. crown sharing trunk's instanceMatrix & instanceColor GPU buffers)
   * cutting CPU matrix/color copies, VRAM, and WebGL bufferSubData uploads in half!
   */
  private createPairedFollower(
    primary: THREE.InstancedMesh,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    maxCapacity: number,
    castShadow = false,
    receiveShadow = false
  ): THREE.InstancedMesh {
    const follower = new THREE.InstancedMesh(geo, mat, maxCapacity);
    follower.count = 0;
    follower.visible = false;
    follower.frustumCulled = false;
    follower.castShadow = castShadow;
    follower.receiveShadow = receiveShadow;
    // Share exact GPU InstancedBufferAttributes with primary trunk/stem mesh
    follower.instanceMatrix = primary.instanceMatrix;
    follower.instanceColor = primary.instanceColor;
    this.group.add(follower);
    this.pairedFollowers.push({ primary, follower });
    this.disposables.push(geo, mat);
    return follower;
  }

  private buildInstancedLayers(textures: WorldTextures, isSoftwareGl: boolean): void {
    const windUniforms: WindUniformSet = {
      time: this.windTimeUniform,
      strength: this.windStrengthUniform,
      dir: this.windDirUniform,
      sunDir: this.sunDirUniform,
      sunColor: this.sunColorUniform,
    };

    const birch = buildBirchGeometries();
    const pine = buildPineGeometries();
    const bogPine = buildBogPineGeometries();
    const spruce = buildSpruceGeometries();
    const saplingGeo = buildSpruceSaplingGeo();
    const hazel = buildHazelBushGeometries();
    const juniperGeo = buildJuniperBushGeo();
    const deadfallGeo = buildFallenLogGeo();

    // PBR Normal-Mapped Bark Materials (Crisp woody relief!)
    const birchBarkMat = new THREE.MeshStandardMaterial({
      map: textures.birchBark,
      normalMap: textures.birchNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.45,
      vertexColors: true,
    });
    addWindSway(birchBarkMat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 9.0,
      bendAmp: 0.24,
      leafAmp: 0,
      leafFreq: 0,
    });

    // Photographic Alpha-Tested Botanical Sprig Canopies with Backlit SSS
    const birchLeafMat = new THREE.MeshLambertMaterial({
      map: textures.birchLeafCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(birchLeafMat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 9.0,
      bendAmp: 0.24,
      leafAmp: 0.12,
      leafFreq: 3.6,
      sssStrength: 0.48,
    });

    const pineBarkMat = new THREE.MeshStandardMaterial({
      map: textures.pineBark,
      normalMap: textures.pineNormal,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughness: 0.93,
      metalness: 0.0,
      envMapIntensity: 0.42,
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
      map: textures.pineNeedleCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(pineLeafMat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.5,
      bendAmp: 0.26,
      leafAmp: 0.08,
      leafFreq: 3.0,
      sssStrength: 0.38,
    });

    const bogPineBarkMat = new THREE.MeshStandardMaterial({
      map: textures.pineBark,
      normalMap: textures.pineNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.4,
    });
    addWindSway(bogPineBarkMat, windUniforms, {
      bendStart: 0.2,
      bendSpan: 2.8,
      bendAmp: 0.14,
      leafAmp: 0,
      leafFreq: 0,
    });
    const bogPineLeafMat = new THREE.MeshLambertMaterial({
      map: textures.pineNeedleCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(bogPineLeafMat, windUniforms, {
      bendStart: 0.2,
      bendSpan: 2.8,
      bendAmp: 0.14,
      leafAmp: 0.06,
      leafFreq: 3.2,
      sssStrength: 0.42,
    });

    const spruceBarkMat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.pineNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.4,
    });
    addWindSway(spruceBarkMat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 10.5,
      bendAmp: 0.21,
      leafAmp: 0,
      leafFreq: 0,
    });
    const spruceLeafMat = new THREE.MeshLambertMaterial({
      map: textures.spruceBoughCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(spruceLeafMat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 10.5,
      bendAmp: 0.21,
      leafAmp: 0.075,
      leafFreq: 2.9,
      sssStrength: 0.36,
    });

    const saplingMat = new THREE.MeshLambertMaterial({
      map: textures.spruceBoughCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(saplingMat, windUniforms, {
      bendStart: 0.12,
      bendSpan: 1.5,
      bendAmp: 0.12,
      leafAmp: 0.05,
      leafFreq: 3.6,
      sssStrength: 0.52,
    });

    const hazelStemMat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.pineNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.4,
    });
    addWindSway(hazelStemMat, windUniforms, {
      bendStart: 0.08,
      bendSpan: 1.5,
      bendAmp: 0.14,
      leafAmp: 0,
      leafFreq: 0,
    });
    const hazelLeafMat = new THREE.MeshLambertMaterial({
      map: textures.bushLeafCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(hazelLeafMat, windUniforms, {
      bendStart: 0.08,
      bendSpan: 1.5,
      bendAmp: 0.14,
      leafAmp: 0.08,
      leafFreq: 4.3,
      sssStrength: 0.5,
    });

    const juniperMat = new THREE.MeshLambertMaterial({
      map: textures.pineNeedleCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(juniperMat, windUniforms, {
      bendStart: 0.08,
      bendSpan: 1.35,
      bendAmp: 0.11,
      leafAmp: 0.045,
      leafFreq: 3.4,
      sssStrength: 0.36,
    });

    const shadows = !isSoftwareGl;

    // Lightweight Lambert bark materials for mid/far LOD1 & LOD2 trunks (zero IBL/normal-map GPU waste at 70-200m!)
    const birchBarkFarMat = new THREE.MeshLambertMaterial({
      map: textures.birchBark,
      vertexColors: true,
    });
    const pineBarkFarMat = new THREE.MeshLambertMaterial({
      map: textures.pineBark,
      vertexColors: true,
    });
    const spruceBarkFarMat = new THREE.MeshLambertMaterial({
      map: textures.spruceBark,
    });

    // Trees: ONLY close LOD0 trunks cast & receive shadows; paired crowns share trunk GPU buffers (0 duplicate uploads)!
    this.birchTrunk0 = this.createInstanced(birch.trunkLod0, birchBarkMat, CAP_LOD0, shadows, true);
    this.birchCrown0 = this.createPairedFollower(this.birchTrunk0, birch.crownLod0, birchLeafMat, CAP_LOD0);
    this.birchTrunk1 = this.createInstanced(birch.trunkLod1, birchBarkFarMat, CAP_LOD1, false, false);
    this.birchCrown1 = this.createPairedFollower(this.birchTrunk1, birch.crownLod1, birchLeafMat, CAP_LOD1);
    this.birchTrunk2 = this.createInstanced(birch.trunkLod2, birchBarkFarMat, CAP_LOD2, false, false);
    this.birchCrown2 = this.createPairedFollower(this.birchTrunk2, birch.crownLod2, birchLeafMat, CAP_LOD2);

    this.pineTrunk0 = this.createInstanced(pine.trunkLod0, pineBarkMat, CAP_LOD0, shadows, true);
    this.pineCrown0 = this.createPairedFollower(this.pineTrunk0, pine.crownLod0, pineLeafMat, CAP_LOD0);
    this.pineTrunk1 = this.createInstanced(pine.trunkLod1, pineBarkFarMat, CAP_LOD1, false, false);
    this.pineCrown1 = this.createPairedFollower(this.pineTrunk1, pine.crownLod1, pineLeafMat, CAP_LOD1);
    this.pineTrunk2 = this.createInstanced(pine.trunkLod2, pineBarkFarMat, CAP_LOD2, false, false);
    this.pineCrown2 = this.createPairedFollower(this.pineTrunk2, pine.crownLod2, pineLeafMat, CAP_LOD2);

    this.bogPineTrunk = this.createInstanced(bogPine.trunk, bogPineBarkMat, CAP_BOG_PINE, shadows, true);
    this.bogPineCrown = this.createPairedFollower(this.bogPineTrunk, bogPine.crown, bogPineLeafMat, CAP_BOG_PINE);

    this.spruceTrunk0 = this.createInstanced(spruce.trunkLod0, spruceBarkMat, CAP_LOD0, shadows, true);
    this.spruceCrown0 = this.createPairedFollower(this.spruceTrunk0, spruce.crownLod0, spruceLeafMat, CAP_LOD0);
    this.spruceTrunk1 = this.createInstanced(spruce.trunkLod1, spruceBarkFarMat, CAP_LOD1, false, false);
    this.spruceCrown1 = this.createPairedFollower(this.spruceTrunk1, spruce.crownLod1, spruceLeafMat, CAP_LOD1);
    this.spruceTrunk2 = this.createInstanced(spruce.trunkLod2, spruceBarkFarMat, CAP_LOD2, false, false);
    this.spruceCrown2 = this.createPairedFollower(this.spruceTrunk2, spruce.crownLod2, spruceLeafMat, CAP_LOD2);

    this.saplingMesh = this.createInstanced(saplingGeo, saplingMat, CAP_SAPLING, false, false);
    const deadfallMat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.pineNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.3,
    });
    this.deadfallMesh = this.createInstanced(deadfallGeo, deadfallMat, CAP_DEADFALL, false, true);

    // Solid Woodland Bushes (hazel leaves share hazel stem GPU buffers!)
    this.hazelStemMesh = this.createInstanced(hazel.stems, hazelStemMat, CAP_HAZEL, false, false);
    this.hazelLeafMesh = this.createPairedFollower(this.hazelStemMesh, hazel.leaves, hazelLeafMat, CAP_HAZEL);
    this.juniperMesh = this.createInstanced(juniperGeo, juniperMat, CAP_JUNIPER, false, false);

    // Photorealistic Multi-Blade Grass, Sedge & Wild Clover Carpet (6 tris/clump, 1 draw call, backlit SSS!)
    const bladeGeo = buildGrassTuftGeo();
    const bladeMat = new THREE.MeshLambertMaterial({
      map: textures.grassClumpCard,
      alphaTest: 0.42,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(bladeMat, windUniforms, {
      bendStart: 0.02,
      bendSpan: 0.42,
      bendAmp: 0.14,
      leafAmp: 0.045,
      leafFreq: 5.0,
      sssStrength: 0.44,
    });
    this.grassBladeMesh = this.createInstanced(bladeGeo, bladeMat, GRASS_BLADE_CAP, false, false, false);

    const fernGeo = buildPhotoFernRosetteGeo();
    const fernMat = new THREE.MeshLambertMaterial({
      map: textures.fernFrondCard,
      alphaTest: 0.42,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(fernMat, windUniforms, {
      bendStart: 0.04,
      bendSpan: 0.56,
      bendAmp: 0.11,
      leafAmp: 0.035,
      leafFreq: 3.9,
      sssStrength: 0.52,
    });
    this.fernMesh = this.createInstanced(fernGeo, fernMat, CAP_FERN, false, false);

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
      sssStrength: 0.36,
    });
    this.shrubMesh = this.createInstanced(shrubGeo, shrubMat, CAP_SHRUB, false, false);

    const mossGeo = buildMossHummockGeo();
    const mossMat = new THREE.MeshStandardMaterial({
      map: textures.terrainForestTex,
      normalMap: textures.groundNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.35,
      vertexColors: true,
    });
    this.mossHummockMesh = this.createInstanced(mossGeo, mossMat, CAP_MOSS, false, true);

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
      sssStrength: 0.4,
    });
    this.reedMesh = this.createInstanced(reedGeo, reedMat, CAP_REED, false, false);

    const boulderGeo = new THREE.DodecahedronGeometry(0.65, 1);
    boulderGeo.scale(1.15, 0.72, 1.0);
    const boulderMat = new THREE.MeshStandardMaterial({
      map: textures.boulderGranite,
      normalMap: textures.fieldstoneNormal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.88,
      metalness: 0.02,
      envMapIntensity: 0.4,
    });
    this.boulderMesh = this.createInstanced(boulderGeo, boulderMat, CAP_BOULDER, shadows, true);
  }

  private bakeGrassTile(tx: number, tz: number): GrassTileBaked {
    const minX = tx * GRASS_TILE_SIZE;
    const minZ = tz * GRASS_TILE_SIZE;
    const maxX = minX + GRASS_TILE_SIZE;
    const maxZ = minZ + GRASS_TILE_SIZE;
    const minWorld = -WORLD_HALF + 2;
    const maxWorld = WORLD_HALF - 2;
    if (maxX < minWorld || minX > maxWorld || maxZ < minWorld || minZ > maxWorld) {
      return EMPTY_GRASS_TILE;
    }

    const tileCx = minX + GRASS_TILE_SIZE * 0.5;
    const tileCz = minZ + GRASS_TILE_SIZE * 0.5;
    const localBuildings: BuildingRect[] = [];
    for (let i = 0; i < this.buildingRects.length; i++) {
      const r = this.buildingRects[i];
      const maxReach = Math.hypot(r.hw, r.hd) + GRASS_TILE_SIZE * 0.72;
      const dx = tileCx - r.cx;
      const dz = tileCz - r.cz;
      if (dx * dx + dz * dz <= maxReach * maxReach) {
        localBuildings.push(r);
      }
    }

    const cellsPerSide = Math.ceil(GRASS_TILE_SIZE / GRASS_BLADE_SPACING);
    const maxTileBlades = cellsPerSide * cellsPerSide;
    const tmpMat = new Float32Array(maxTileBlades * 16);
    const tmpCol = new Float32Array(maxTileBlades * 3);
    const randSeed = getActiveBlueprint().seed | 0;
    const baseIx = tx * cellsPerSide;
    const baseIz = tz * cellsPerSide;

    let count = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let gz = 0; gz < cellsPerSide; gz++) {
      const bz = minZ + (gz + 0.5) * GRASS_BLADE_SPACING;
      if (bz >= maxZ || bz < minWorld || bz > maxWorld) continue;
      const iz = baseIz + gz;
      for (let gx = 0; gx < cellsPerSide; gx++) {
        const bx = minX + (gx + 0.5) * GRASS_BLADE_SPACING;
        if (bx >= maxX || bx < minWorld || bx > maxWorld) continue;
        const ix = baseIx + gx;

        let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ randSeed;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        const r1 = ((h >>> 0) % 1000) / 1000;
        const r2 = (((h >>> 10) >>> 0) % 1000) / 1000;
        const r3 = (((h >>> 20) >>> 0) % 1000) / 1000;

        const px = bx + (r1 - 0.5) * GRASS_BLADE_SPACING * 0.92;
        const pz = bz + (r2 - 0.5) * GRASS_BLADE_SPACING * 0.92;

        const roadInfo = distToRoadDetail(px, pz);
        if (roadInfo.dist < (roadInfo.isTrail ? 1.55 : 2.35)) continue;

        let insideBuilding = false;
        for (let b = 0; b < localBuildings.length; b++) {
          const r = localBuildings[b];
          const dx = px - r.cx;
          const dz = pz - r.cz;
          const lx = dx * r.cosR - dz * r.sinR;
          const lz = dx * r.sinR + dz * r.cosR;
          if (Math.abs(lx) < r.hw && Math.abs(lz) < r.hd) {
            insideBuilding = true;
            break;
          }
        }
        if (insideBuilding) continue;

        const py = getTerrainHeight(px, pz);
        if (py < SWAMP_WATER_Y + 0.12) continue;

        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        const isl = getNearestSwampIsland(px, pz);
        const swamp = isl.islandMask > 0.35 ? 0 : getSwampFactor(px, pz);
        const sy = swamp > 0.35 ? 0.65 + r3 * 0.68 : 0.68 + r3 * 0.78;
        const sxz = 0.88 + r2 * 0.48;
        const rotY = r1 * Math.PI * 2;
        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);

        const mOff = count * 16;
        tmpMat[mOff] = cosY * sxz;
        tmpMat[mOff + 1] = 0;
        tmpMat[mOff + 2] = -sinY * sxz;
        tmpMat[mOff + 3] = 0;
        tmpMat[mOff + 4] = 0;
        tmpMat[mOff + 5] = sy;
        tmpMat[mOff + 6] = 0;
        tmpMat[mOff + 7] = 0;
        tmpMat[mOff + 8] = sinY * sxz;
        tmpMat[mOff + 9] = 0;
        tmpMat[mOff + 10] = cosY * sxz;
        tmpMat[mOff + 11] = 0;
        tmpMat[mOff + 12] = px;
        tmpMat[mOff + 13] = py - 0.03;
        tmpMat[mOff + 14] = pz;
        tmpMat[mOff + 15] = 1;

        const cOff = count * 3;
        const tone = 0.78 + r2 * 0.3;
        if (swamp > 0.35) {
          tmpCol[cOff] = tone * 1.04;
          tmpCol[cOff + 1] = tone * 0.88;
          tmpCol[cOff + 2] = tone * 0.52;
        } else {
          tmpCol[cOff] = tone * (0.82 + r1 * 0.16);
          tmpCol[cOff + 1] = tone * (0.94 + r3 * 0.14);
          tmpCol[cOff + 2] = tone * 0.64;
        }
        count++;
      }
    }

    if (count === 0) return EMPTY_GRASS_TILE;
    const cy = (minY + maxY) * 0.5 + 0.35;
    const halfY = (maxY - minY) * 0.5 + 0.8;
    const halfXZ = GRASS_TILE_SIZE * 0.5 + 0.6;
    return {
      slab: {
        count,
        matrices: tmpMat.slice(0, count * 16),
        colors: tmpCol.slice(0, count * 3),
        bounds: new Float32Array(0),
      },
      cx: tileCx,
      cy,
      cz: tileCz,
      r: Math.hypot(halfXZ, halfY, halfXZ),
    };
  }

  private updateGrassCarpet(
    camX: number,
    camZ: number,
    frustumPlanes?: Float32Array,
    camForward?: THREE.Vector3,
    bakeBudget = 2
  ): void {
    const ptx = Math.floor(camX / GRASS_TILE_SIZE);
    const ptz = Math.floor(camZ / GRASS_TILE_SIZE);
    const tileMoved = ptx !== this.lastGrassTileX || ptz !== this.lastGrassTileZ;

    let rotChanged = false;
    if (camForward) {
      const fl = Math.hypot(camForward.x, camForward.z) || 1;
      const fx = camForward.x / fl;
      const fz = camForward.z / fl;
      const dot = fx * this.lastGrassFwdX + fz * this.lastGrassFwdZ;
      if (dot < 0.99) {
        rotChanged = true;
        this.lastGrassFwdX = fx;
        this.lastGrassFwdZ = fz;
      }
    }

    if (!tileMoved && !rotChanged && !this.grassHasPendingTiles) return;

    this.lastGrassTileX = ptx;
    this.lastGrassTileZ = ptz;

    let bakedThisCall = 0;
    let missingTiles = 0;
    const matArr = this.grassBladeMesh.instanceMatrix.array as Float32Array;
    const colArr = this.grassBladeMesh.instanceColor!.array as Float32Array;
    let count = 0;

    for (let ring = 0; ring <= GRASS_TILE_RADIUS; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          if (Math.abs(dx) === GRASS_TILE_RADIUS && Math.abs(dz) === GRASS_TILE_RADIUS) continue;

          const tx = ptx + dx;
          const tz = ptz + dz;
          const tileCx = (tx + 0.5) * GRASS_TILE_SIZE;
          const tileCz = (tz + 0.5) * GRASS_TILE_SIZE;

          // Custom Frustum Culling on grass tiles (always retain ring 0 underfoot so looking down never clips!)
          if (ring > 0 && frustumPlanes) {
            const cached = this.grassTileCache.get(`${tx}_${tz}`);
            const cy = cached ? cached.cy : getTerrainHeight(tileCx, tileCz) + 0.4;
            const r = (cached ? cached.r : 12.6) + 3.2;
            if (!sphereIntersectsFrustum(frustumPlanes, tileCx, cy, tileCz, r)) {
              continue;
            }
          }

          const key = `${tx}_${tz}`;
          let tile = this.grassTileCache.get(key);
          if (tile) {
            this.grassTileCache.delete(key);
            this.grassTileCache.set(key, tile);
          } else if (bakedThisCall < bakeBudget) {
            tile = this.bakeGrassTile(tx, tz);
            this.grassTileCache.set(key, tile);
            bakedThisCall++;
            if (this.grassTileCache.size > MAX_GRASS_TILE_CACHE) {
              const oldest = this.grassTileCache.keys().next().value;
              if (oldest !== undefined) this.grassTileCache.delete(oldest);
            }
          } else {
            missingTiles++;
            continue;
          }

          const slab = tile.slab;
          if (slab.count === 0) continue;
          const avail = GRASS_BLADE_CAP - count;
          if (avail <= 0) continue;
          const take = slab.count <= avail ? slab.count : avail;
          matArr.set(
            take === slab.count ? slab.matrices : slab.matrices.subarray(0, take * 16),
            count * 16
          );
          colArr.set(
            take === slab.count ? slab.colors : slab.colors.subarray(0, take * 3),
            count * 3
          );
          count += take;
        }
      }
    }

    this.grassHasPendingTiles = missingTiles > 0;
    this.diagGrassRebuilds++;
    this.grassBladeMesh.count = count;
    commitCompactedInstancedMesh(this.grassBladeMesh);
  }

  /**
   * Fast-path bulk memcpy when a 24x24m sub-cell is completely INSIDE all 6 frustum planes.
   * Only writes to `primary` (paired crowns share primary's GPU buffers!).
   */
  private appendSlabBulk(
    slab: BakedSlab,
    primary: THREE.InstancedMesh,
    maxCap: number
  ): number {
    const n = slab.count;
    if (n === 0) return 0;
    const avail = maxCap - primary.count;
    if (avail <= 0) return 0;
    const take = n <= avail ? n : avail;
    const matSrc = take === n ? slab.matrices : slab.matrices.subarray(0, take * 16);
    const colSrc = take === n ? slab.colors : slab.colors.subarray(0, take * 3);

    const matArr = primary.instanceMatrix.array as Float32Array;
    matArr.set(matSrc, primary.count * 16);
    const colArr = primary.instanceColor!.array as Float32Array;
    colArr.set(colSrc, primary.count * 3);
    primary.count += take;
    return take;
  }

  /**
   * Exact per-instance sphere vs. 6-plane frustum culling for sub-cells straddling frustum borders.
   */
  private appendSlabCulled(
    slab: BakedSlab,
    primary: THREE.InstancedMesh,
    maxCap: number,
    frustumPlanes: Float32Array,
    margin = 2.8
  ): number {
    const n = slab.count;
    if (n === 0) return 0;
    let dst = primary.count;
    if (dst >= maxCap) return 0;

    const bounds = slab.bounds;
    const srcMat = slab.matrices;
    const srcCol = slab.colors;
    const dstMat = primary.instanceMatrix.array as Float32Array;
    const dstCol = primary.instanceColor!.array as Float32Array;
    let added = 0;

    for (let i = 0; i < n; i++) {
      const bOff = i * 4;
      if (
        !sphereIntersectsFrustum(
          frustumPlanes,
          bounds[bOff],
          bounds[bOff + 1],
          bounds[bOff + 2],
          bounds[bOff + 3] + margin
        )
      ) {
        continue;
      }
      const sm = i * 16;
      const dm = dst * 16;
      dstMat[dm] = srcMat[sm];
      dstMat[dm + 1] = srcMat[sm + 1];
      dstMat[dm + 2] = srcMat[sm + 2];
      dstMat[dm + 3] = srcMat[sm + 3];
      dstMat[dm + 4] = srcMat[sm + 4];
      dstMat[dm + 5] = srcMat[sm + 5];
      dstMat[dm + 6] = srcMat[sm + 6];
      dstMat[dm + 7] = srcMat[sm + 7];
      dstMat[dm + 8] = srcMat[sm + 8];
      dstMat[dm + 9] = srcMat[sm + 9];
      dstMat[dm + 10] = srcMat[sm + 10];
      dstMat[dm + 11] = srcMat[sm + 11];
      dstMat[dm + 12] = srcMat[sm + 12];
      dstMat[dm + 13] = srcMat[sm + 13];
      dstMat[dm + 14] = srcMat[sm + 14];
      dstMat[dm + 15] = srcMat[sm + 15];

      const sc = i * 3;
      const dc = dst * 3;
      dstCol[dc] = srcCol[sc];
      dstCol[dc + 1] = srcCol[sc + 1];
      dstCol[dc + 2] = srcCol[sc + 2];

      dst++;
      added++;
      if (dst >= maxCap) break;
    }
    primary.count = dst;
    return added;
  }

  private appendSlabSmart(
    slab: BakedSlab,
    primary: THREE.InstancedMesh,
    maxCap: number,
    cellStatus: FrustumCullStatus,
    frustumPlanes?: Float32Array
  ): number {
    if (slab.count === 0) return 0;
    if (cellStatus === FrustumCullStatus.INSIDE || !frustumPlanes) {
      return this.appendSlabBulk(slab, primary, maxCap);
    }
    return this.appendSlabCulled(slab, primary, maxCap, frustumPlanes);
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
    this.updateGrassCarpet(x, z, undefined, undefined, 25);
    void half;
  }

  update(
    activeSlots: ActiveChunkSlot[],
    chunkLods: Int32Array,
    chunkSpheres: Float32Array,
    camPos: THREE.Vector3,
    elapsedTime: number,
    windStrength = 0.9,
    stats?: VegetationStats,
    sunDir?: THREE.Vector3,
    sunColor?: THREE.Color,
    frustumPlanes?: Float32Array,
    camForward?: THREE.Vector3,
    maxRenderDist = 225
  ): void {
    this.windTimeUniform.value = elapsedTime;
    this.windStrengthUniform.value = windStrength;
    if (sunDir) this.sunDirUniform.value.copy(sunDir);
    if (sunColor) this.sunColorUniform.value.copy(sunColor);

    this.updateGrassCarpet(camPos.x, camPos.z, frustumPlanes, camForward);

    const fogDist = Math.max(96, Math.min(225, maxRenderDist));
    const fogChunkCutoffSq = (fogDist + 32) * (fogDist + 32);

    // Build chunk visibility signature (rejects fog-culled and off-frustum chunks)
    let sig = '';
    for (let c = 0; c < CHUNK_COUNT; c++) {
      const lod = chunkLods[c];
      if (lod < 0 || chunkSpheres[c * 4 + 1] > 9000) continue;
      const sb = c * 4;
      const dx = chunkSpheres[sb] - camPos.x;
      const dz = chunkSpheres[sb + 2] - camPos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > fogChunkCutoffSq) continue;
      const slot = activeSlots[c];
      sig += `${slot.vcx},${slot.vcz};`;
    }

    let fwdX = this.lastCullFwdX;
    let fwdZ = this.lastCullFwdZ;
    let rotDirty = false;
    if (camForward) {
      const fl = Math.hypot(camForward.x, camForward.z) || 1;
      fwdX = camForward.x / fl;
      fwdZ = camForward.z / fl;
      // Re-cull whenever camera turns > ~4.5 degrees
      rotDirty = fwdX * this.lastCullFwdX + fwdZ * this.lastCullFwdZ < 0.9968;
    }
    const moveSq =
      (camPos.x - this.lastCullCamX) * (camPos.x - this.lastCullCamX) +
      (camPos.z - this.lastCullCamZ) * (camPos.z - this.lastCullCamZ);
    const fogDirty = Math.abs(fogDist - this.lastFogCullDist) > 6;

    if (sig === this.lastVisibilitySig && moveSq < 1.2 && !rotDirty && !fogDirty) {
      if (stats) {
        stats.treesRendered = this.cachedTreesCount;
        stats.foliageRendered = this.cachedFoliageCount + this.grassBladeMesh.count;
        stats.culledInstances = this.cachedCulledCount;
        stats.candidateInstances = this.cachedCandidateCount;
      }
      return;
    }

    this.lastVisibilitySig = sig;
    this.lastCullCamX = camPos.x;
    this.lastCullCamZ = camPos.z;
    this.lastCullFwdX = fwdX;
    this.lastCullFwdZ = fwdZ;
    this.lastFogCullDist = fogDist;
    this.diagVisRebuilds++;

    for (let i = 0; i < this.primaryChunkMeshes.length; i++) {
      this.primaryChunkMeshes[i].count = 0;
    }

    const lod0Sq = 36 * 36;
    const lod1Sq = 92 * 92;
    const fogCellSq = (fogDist + 16) * (fogDist + 16);
    const bogDistSq = Math.min(108, fogDist) * Math.min(108, fogDist);
    const bushDistSq = Math.min(80, fogDist) * Math.min(80, fogDist);
    const underDistSq = 58 * 58;
    const boulderDistSq = Math.min(115, fogDist) * Math.min(115, fogDist);

    let candidateInstances = 0;
    let renderedInstances = 0;

    for (let c = 0; c < CHUNK_COUNT; c++) {
      const lod = chunkLods[c];
      if (lod < 0 || chunkSpheres[c * 4 + 1] > 9000) continue;

      const sb = c * 4;
      const cdx = chunkSpheres[sb] - camPos.x;
      const cdz = chunkSpheres[sb + 2] - camPos.z;
      if (cdx * cdx + cdz * cdz > fogChunkCutoffSq) continue;

      // Tier 1: Chunk-level frustum test (padded for tall crowns) so behind-camera chunks are never processed
      if (
        frustumPlanes &&
        !sphereIntersectsFrustum(
          frustumPlanes,
          chunkSpheres[sb],
          chunkSpheres[sb + 1] + 5.0,
          chunkSpheres[sb + 2],
          chunkSpheres[sb + 3] + 7.5
        )
      ) {
        continue;
      }

      const slot = activeSlots[c];
      const bucket = this.getOrBakeChunk(slot.vcx, slot.vcz);
      const cells = bucket.cells;

      for (let qi = 0; qi < cells.length; qi++) {
        const cell = cells[qi];
        candidateInstances += cell.totalInstances;

        const dx = cell.cx - camPos.x;
        const dz = cell.cz - camPos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > fogCellSq) continue;

        // Tier 2: 24x24m Sub-Cell 3-State Frustum Classification (OUTSIDE / INTERSECTING / INSIDE)
        let cellStatus = FrustumCullStatus.INSIDE;
        if (frustumPlanes) {
          cellStatus = classifySphereFrustum(
            frustumPlanes,
            cell.cx,
            cell.cy,
            cell.cz,
            cell.r + 3.0
          );
          if (cellStatus === FrustumCullStatus.OUTSIDE) continue;
        }

        if (dSq < lod0Sq) {
          renderedInstances += this.appendSlabSmart(cell.birch, this.birchTrunk0, CAP_LOD0, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.pine, this.pineTrunk0, CAP_LOD0, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.spruce, this.spruceTrunk0, CAP_LOD0, cellStatus, frustumPlanes);
        } else if (dSq < lod1Sq) {
          renderedInstances += this.appendSlabSmart(cell.birch, this.birchTrunk1, CAP_LOD1, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.pine, this.pineTrunk1, CAP_LOD1, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.spruce, this.spruceTrunk1, CAP_LOD1, cellStatus, frustumPlanes);
        } else {
          renderedInstances += this.appendSlabSmart(cell.birch, this.birchTrunk2, CAP_LOD2, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.pine, this.pineTrunk2, CAP_LOD2, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.spruce, this.spruceTrunk2, CAP_LOD2, cellStatus, frustumPlanes);
        }

        if (dSq < bogDistSq) {
          renderedInstances += this.appendSlabSmart(cell.bogPine, this.bogPineTrunk, CAP_BOG_PINE, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.reed, this.reedMesh, CAP_REED, cellStatus, frustumPlanes);
        }
        if (dSq < bushDistSq) {
          renderedInstances += this.appendSlabSmart(cell.hazelBush, this.hazelStemMesh, CAP_HAZEL, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.juniperBush, this.juniperMesh, CAP_JUNIPER, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.sapling, this.saplingMesh, CAP_SAPLING, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.deadfall, this.deadfallMesh, CAP_DEADFALL, cellStatus, frustumPlanes);
        }
        if (dSq < underDistSq) {
          renderedInstances += this.appendSlabSmart(cell.mossHummock, this.mossHummockMesh, CAP_MOSS, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.fern, this.fernMesh, CAP_FERN, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.shrub, this.shrubMesh, CAP_SHRUB, cellStatus, frustumPlanes);
        }
        if (dSq < boulderDistSq) {
          renderedInstances += this.appendSlabSmart(cell.boulder, this.boulderMesh, CAP_BOULDER, cellStatus, frustumPlanes);
        }
      }
    }

    // Commit ONLY active ranges [0..count) to GPU and hide empty layers (0 draw calls!)
    for (let i = 0; i < this.primaryChunkMeshes.length; i++) {
      commitCompactedInstancedMesh(this.primaryChunkMeshes[i], false);
    }
    for (let i = 0; i < this.pairedFollowers.length; i++) {
      const pair = this.pairedFollowers[i];
      pair.follower.count = pair.primary.count;
      pair.follower.visible = pair.primary.count > 0;
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

    this.cachedCandidateCount = candidateInstances;
    this.cachedCulledCount = Math.max(0, candidateInstances - renderedInstances);

    if (stats) {
      stats.treesRendered = this.cachedTreesCount;
      stats.foliageRendered = this.cachedFoliageCount + this.grassBladeMesh.count;
      stats.culledInstances = this.cachedCulledCount;
      stats.candidateInstances = this.cachedCandidateCount;
    }
  }

  consumeDiagnostics(): {
    chunkCacheSize: number;
    chunkBakes: number;
    chunkEvictions: number;
    visRebuilds: number;
    grassRebuilds: number;
    grassCount: number;
    colliderCells: number;
  } {
    const out = {
      chunkCacheSize: this.chunkCache.size,
      chunkBakes: this.diagChunkBakes,
      chunkEvictions: this.diagChunkEvictions,
      visRebuilds: this.diagVisRebuilds,
      grassRebuilds: this.diagGrassRebuilds,
      grassCount: this.grassBladeMesh.count,
      colliderCells: this.colliderGrid.size,
    };
    this.diagChunkBakes = 0;
    this.diagChunkEvictions = 0;
    this.diagVisRebuilds = 0;
    this.diagGrassRebuilds = 0;
    return out;
  }

  dispose(): void {
    this.chunkCache.clear();
    this.grassTileCache.clear();
    this.colliderGrid.clear();
    for (const d of this.disposables) d.dispose();
  }
}
