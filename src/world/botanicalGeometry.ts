import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lerp, smoothNoise } from './terrainMath';

function seededRand(seed: number): () => number {
  let s = (seed | 0) ^ 0x85ebca6b;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function prepGeo(
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
  if (!g.attributes.color) {
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    if (colorBottom && colorTop) {
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
    } else {
      cols.fill(1);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  return g;
}

export function applyHeightGradient(
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

function setUniformColor(geo: THREE.BufferGeometry, col: THREE.Color): THREE.BufferGeometry {
  const count = geo.attributes.position.count;
  const cols = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    cols[i * 3] = col.r;
    cols[i * 3 + 1] = col.g;
    cols[i * 3 + 2] = col.b;
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
  colorStart?: THREE.Color;
  colorEnd?: THREE.Color;
}

export function buildConnectedTube(seg: ConnectedTubeSegment): THREE.BufferGeometry {
  _tmpDir.subVectors(seg.end, seg.start);
  const exactLen = _tmpDir.length();
  const unitDir = exactLen > 1e-5 ? _tmpDir.clone().divideScalar(exactLen) : _upVec.clone();
  const overlapStart = seg.overlapStart ?? 0.045;
  const overlapEnd = seg.overlapEnd ?? 0.025;
  const totalLen = exactLen + overlapStart + overlapEnd;
  const g = new THREE.CylinderGeometry(seg.rTop, seg.rBot, totalLen, seg.radialSegs, 1);
  // Scale V proportionally to length so bark texture stays natural across long/short limbs
  const uv = g.attributes.uv;
  const vScale = Math.max(0.35, totalLen * 0.28);
  for (let i = 0; i < uv.count; i++) {
    uv.setY(i, uv.getY(i) * vScale);
  }
  g.translate(0, exactLen * 0.5 + (overlapEnd - overlapStart) * 0.5, 0);

  const nonIdx = g.toNonIndexed();
  g.dispose();
  if (seg.colorStart || seg.colorEnd) {
    const c0 = seg.colorStart ?? new THREE.Color(0xffffff);
    const c1 = seg.colorEnd ?? c0;
    const pos = nonIdx.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const invL = 1 / Math.max(0.05, exactLen);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getY(i) * invL));
      cols[i * 3] = lerp(c0.r, c1.r, t);
      cols[i * 3 + 1] = lerp(c0.g, c1.g, t);
      cols[i * 3 + 2] = lerp(c0.b, c1.b, t);
    }
    nonIdx.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }

  _tmpQuat.setFromUnitVectors(_upVec, unitDir);
  nonIdx.applyQuaternion(_tmpQuat);
  nonIdx.translate(seg.start.x, seg.start.y, seg.start.z);
  return prepGeo(nonIdx);
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

export interface ButtressedTrunkOpts {
  radialSegs: number;
  rootCount: number;
  rootFlare: number; // Extra radial flare multiplier at the base (e.g. 1.45 for spruce, 0.75 for birch)
  flareHeight: number; // Height over which root buttresses merge cleanly into the round trunk
  rootPhase?: number;
  uvYScale?: number;
  colRoot?: THREE.Color;
  colTrunk?: THREE.Color;
}

/**
 * Builds a continuous organic lofted tree trunk with fluted root-buttress flares
 * extending deep below ground (y < 0) so trees grip slopes without floating.
 */
export function buildButtressedTrunk(
  spine: THREE.Vector3[],
  radii: number[],
  opts: ButtressedTrunkOpts
): THREE.BufferGeometry {
  const ringCount = spine.length;
  const segs = Math.max(4, opts.radialSegs);
  const colsPerRing = segs + 1;
  const vertCount = ringCount * colsPerRing;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);

  const rootPhase = opts.rootPhase ?? 0.4;
  const uvYScale = opts.uvYScale ?? 0.28;
  const colRoot = opts.colRoot ?? new THREE.Color(0x88847c);
  const colTrunk = opts.colTrunk ?? new THREE.Color(0xffffff);

  const tangent = new THREE.Vector3();
  const sideA = new THREE.Vector3();
  const sideB = new THREE.Vector3();
  const refVec = new THREE.Vector3(1, 0, 0);

  let cumLen = 0;
  for (let r = 0; r < ringCount; r++) {
    const p = spine[r];
    if (r > 0) cumLen += p.distanceTo(spine[r - 1]);

    if (r === 0) {
      tangent.subVectors(spine[1], spine[0]).normalize();
    } else if (r === ringCount - 1) {
      tangent.subVectors(spine[r], spine[r - 1]).normalize();
    } else {
      tangent.subVectors(spine[r + 1], spine[r - 1]).normalize();
    }

    sideB.crossVectors(tangent, refVec).normalize();
    sideA.crossVectors(sideB, tangent).normalize();

    const baseRad = radii[r];
    const hAboveBase = Math.max(0, p.y);
    // Smooth exponential root-buttress falloff from below ground up through flareHeight
    const flareT =
      p.y <= 0
        ? 1.0
        : Math.pow(Math.max(0, 1 - hAboveBase / Math.max(0.2, opts.flareHeight)), 1.9);
    const rootColorT = Math.min(1, Math.max(0, (p.y + 0.1) / Math.max(0.35, opts.flareHeight * 0.85)));

    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const theta = u * Math.PI * 2;
      // Distinct organic root flutes + subtle natural trunk eccentricity
      const primaryLobe = Math.pow(0.5 + 0.5 * Math.cos(theta * opts.rootCount + rootPhase), 1.65);
      const secondaryLobe = 0.5 + 0.5 * Math.sin(theta * (opts.rootCount - 1) - rootPhase * 1.4);
      const rootFactor = 1.0 + flareT * opts.rootFlare * (0.32 + 0.68 * primaryLobe + 0.14 * secondaryLobe);
      const trunkOrganic = 1.0 + 0.045 * Math.sin(theta * 2 + r * 0.7) * (1 - flareT * 0.5);
      const rad = baseRad * rootFactor * trunkOrganic;

      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const vx = p.x + (sideA.x * cosT + sideB.x * sinT) * rad;
      const vy = p.y + (sideA.y * cosT + sideB.y * sinT) * rad;
      const vz = p.z + (sideA.z * cosT + sideB.z * sinT) * rad;

      const vi = r * colsPerRing + s;
      positions[vi * 3] = vx;
      positions[vi * 3 + 1] = vy;
      positions[vi * 3 + 2] = vz;

      uvs[vi * 2] = u;
      uvs[vi * 2 + 1] = cumLen * uvYScale;

      // Deepen AO slightly inside the flutes between roots
      const fluteAo = 1.0 - flareT * (1.0 - primaryLobe) * 0.22;
      colors[vi * 3] = lerp(colRoot.r, colTrunk.r, rootColorT) * fluteAo;
      colors[vi * 3 + 1] = lerp(colRoot.g, colTrunk.g, rootColorT) * fluteAo;
      colors[vi * 3 + 2] = lerp(colRoot.b, colTrunk.b, rootColorT) * fluteAo;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < ringCount - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * colsPerRing + s;
      const b = a + 1;
      const c = (r + 1) * colsPerRing + s;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const nonIdx = g.toNonIndexed();
  g.dispose();
  return nonIdx;
}

export type AtlasQuad = 0 | 1 | 2 | 3;

/**
 * Curved 3D arched & cupped photographic botanical sprig card (4 tris).
 * Supports both full-sheet UVs and 2x2 botanical atlas quadrants (0..3)
 * with mipmap-safe insets and volumetric outward-biased canopy normals.
 */
export function makeArchedSprigCard(
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
  crownCenterY?: number,
  atlasQuad?: AtlasQuad
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const midY = length * 0.52;
  const midZ = arch * 0.55;
  const tipZ = -arch * 0.65;

  let u0 = 0;
  let u1 = 1;
  let v0 = 0;
  let v1 = 1;
  if (atlasQuad !== undefined) {
    const pad = 0.008;
    const col = atlasQuad & 1;
    const isTopCanvas = atlasQuad < 2;
    u0 = col * 0.5 + pad;
    u1 = col * 0.5 + 0.5 - pad;
    // Canvas y=0 (top half of image) corresponds to WebGL v=[0.5..1.0] (flipY=true)
    v0 = (isTopCanvas ? 0.5 : 0.0) + pad;
    v1 = (isTopCanvas ? 1.0 : 0.5) - pad;
  }
  const vMid = lerp(v0, v1, 0.52);

  const positions = new Float32Array([
    -hw * 0.85, 0, 0,
     hw * 0.85, 0, 0,
    -hw,        midY, midZ,
     hw,        midY, midZ,
    -hw * 0.88, length, tipZ,
     hw * 0.88, length, tipZ,
  ]);
  const uvs = new Float32Array([
    u0, v0,
    u1, v0,
    u0, vMid,
    u1, vMid,
    u0, v1,
    u1, v1,
  ]);
  const localVs = [0, 0, 0.52, 0.52, 1, 1];
  const idx = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4];

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.rotateX(rx);
  g.rotateZ(rz);
  g.rotateY(ry);
  g.translate(px, py, pz);

  const nonIdx = g.toNonIndexed();
  g.dispose();
  const pos = nonIdx.attributes.position;
  const nrm = nonIdx.attributes.normal;
  const cols = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const lv = localVs[idx[i]];
    cols[i * 3] = lerp(colBase.r, colTip.r, lv);
    cols[i * 3 + 1] = lerp(colBase.g, colTip.g, lv);
    cols[i * 3 + 2] = lerp(colBase.b, colTip.b, lv);

    if (crownCenterY !== undefined) {
      const vx = pos.getX(i);
      const vy = pos.getY(i) - crownCenterY;
      const vz = pos.getZ(i);
      const len = Math.hypot(vx, vy + 1.2, vz) || 1;
      const sx = vx / len;
      const sy = (vy + 1.2) / len;
      const sz = vz / len;
      const nx = lerp(nrm.getX(i), sx, 0.66);
      const ny = lerp(nrm.getY(i), sy, 0.66);
      const nz = lerp(nrm.getZ(i), sz, 0.66);
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nrm.setXYZ(i, nx / nLen, ny / nLen, nz / nLen);
    }
  }
  nonIdx.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return nonIdx;
}

// ============================================================================
// 1. Silver Birch (Betula pendula) — Tall slender white trunk, dark fissured base,
//    fine ascending dark branches, tall airy columnar-oval feathery crown (kaasik.jpg)
// ============================================================================
export function buildBirchGeometries() {
  const spine = [
    new THREE.Vector3(0, -0.36, 0),
    new THREE.Vector3(0.01, 0.0, 0),
    new THREE.Vector3(0.03, 0.65, -0.02),
    new THREE.Vector3(0.08, 2.2, -0.04),
    new THREE.Vector3(0.18, 4.5, 0.05),
    new THREE.Vector3(0.24, 7.0, 0.14),
    new THREE.Vector3(0.17, 9.6, 0.11),
    new THREE.Vector3(0.26, 12.1, 0.06),
  ];
  const radii = [0.22, 0.175, 0.155, 0.138, 0.112, 0.082, 0.048, 0.018];
  const trunkParts: THREE.BufferGeometry[] = [
    buildButtressedTrunk(spine, radii, {
      radialSegs: 9,
      rootCount: 4,
      rootFlare: 0.72,
      flareHeight: 1.05,
      rootPhase: 0.35,
      uvYScale: 0.32,
      colRoot: new THREE.Color(0x9a9690),
      colTrunk: new THREE.Color(0xffffff),
    }),
  ];

  // 8 slender ascending dark-twigged birch limbs + secondary forks (kaasik2.webp)
  const twigBase = new THREE.Color(0xd2cbc2);
  const twigTip = new THREE.Color(0x4c4036);
  const branchSpecs: Array<{ tIdx: number; frac: number; dx: number; dy: number; dz: number; rBot: number }> = [
    { tIdx: 4, frac: 0.08, dx: -1.15, dy: 2.35, dz: 0.72, rBot: 0.048 },
    { tIdx: 4, frac: 0.36, dx: 1.18, dy: 2.25, dz: -0.68, rBot: 0.046 },
    { tIdx: 4, frac: 0.68, dx: 0.82, dy: 2.15, dz: 0.96, rBot: 0.042 },
    { tIdx: 4, frac: 0.94, dx: -0.88, dy: 2.05, dz: -0.82, rBot: 0.04 },
    { tIdx: 5, frac: 0.25, dx: -0.96, dy: 1.95, dz: 0.38, rBot: 0.036 },
    { tIdx: 5, frac: 0.56, dx: 0.92, dy: 1.85, dz: 0.44, rBot: 0.034 },
    { tIdx: 5, frac: 0.84, dx: -0.45, dy: 1.75, dz: -0.86, rBot: 0.03 },
    { tIdx: 6, frac: 0.28, dx: 0.64, dy: 1.55, dz: -0.52, rBot: 0.026 },
  ];

  const branchTips: THREE.Vector3[] = [];
  for (let i = 0; i < branchSpecs.length; i++) {
    const bs = branchSpecs[i];
    const start = spine[bs.tIdx].clone().lerp(spine[bs.tIdx + 1], bs.frac);
    const mid = start.clone().add(new THREE.Vector3(bs.dx * 0.52, bs.dy * 0.56, bs.dz * 0.52));
    const end = start.clone().add(new THREE.Vector3(bs.dx, bs.dy, bs.dz));
    trunkParts.push(
      buildConnectedTube({
        start,
        end: mid,
        rBot: bs.rBot,
        rTop: bs.rBot * 0.58,
        radialSegs: 5,
        overlapStart: 0.05,
        colorStart: twigBase,
        colorEnd: twigTip,
      }),
      buildConnectedTube({
        start: mid,
        end,
        rBot: bs.rBot * 0.58,
        rTop: 0.011,
        radialSegs: 4,
        overlapStart: 0.04,
        colorStart: twigTip,
        colorEnd: twigTip,
      })
    );
    // Secondary fine ascending fork off the mid-limb
    const forkEnd = mid.clone().add(new THREE.Vector3(-bs.dz * 0.42, bs.dy * 0.46, bs.dx * 0.42));
    trunkParts.push(
      buildConnectedTube({
        start: mid,
        end: forkEnd,
        rBot: bs.rBot * 0.42,
        rTop: 0.009,
        radialSegs: 4,
        overlapStart: 0.03,
        colorStart: twigTip,
        colorEnd: twigTip,
      })
    );
    branchTips.push(end, forkEnd);
  }
  const trunkLod0 = mergeGeometries(trunkParts)!;

  // 28 airy layered Silver Birch leaf sprays across all 4 atlas quadrants (tall feathery oval silhouette)
  const leafParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(11);
  const colInner = new THREE.Color(0x88a464);
  const colMid = new THREE.Color(0xbcd286);
  const colSun = new THREE.Color(0xeef6ac);

  for (let i = 0; i < 28; i++) {
    const t = i / 27;
    const a = i * 2.39996 + rand() * 0.45; // Golden-angle spiral around crown
    // Narrower elegant Baltic birch profile tapering smoothly at bottom & top
    const crownProfile = Math.sin(Math.pow(t, 0.78) * Math.PI * 0.92);
    const r = (0.28 + crownProfile * 1.18) * (0.72 + rand() * 0.46);
    const y = 4.65 + t * 6.85 + (rand() - 0.5) * 0.45;
    const cardW = 1.65 + (1 - Math.abs(t - 0.45)) * 0.72 + rand() * 0.35;
    const cardL = 1.95 + (1 - Math.abs(t - 0.4)) * 0.78 + rand() * 0.35;
    const isOuter = r > 0.85 || t > 0.68;
    // Choose botanically matched atlas quadrant: Q0 weeping outer/lower, Q1 airy mid-outer, Q2 core, Q3 crown tip
    const quad: AtlasQuad =
      t > 0.78 ? 3 : isOuter ? (i % 2 === 0 ? 0 : 1) : 2;
    const droopPitch = quad === 0 ? 0.88 + rand() * 0.36 : 0.46 + (rand() - 0.5) * 0.52;

    leafParts.push(
      makeArchedSprigCard(
        cardW,
        cardL,
        quad === 0 ? 0.52 : 0.36,
        0.2 + Math.cos(a) * r,
        y,
        0.09 + Math.sin(a) * r,
        droopPitch,
        a + (rand() - 0.5) * 0.7,
        (rand() - 0.5) * 0.45,
        isOuter ? colMid : colInner,
        isOuter ? colSun : colMid,
        8.6,
        quad
      )
    );
  }
  const crownLod0 = mergeGeometries(leafParts)!;

  // LOD1: Proportioned 12.0m slender birch trunk + 12 multi-quadrant sprays
  const trunkLod1 = mergeGeometries([
    buildButtressedTrunk(
      [
        new THREE.Vector3(0, -0.3, 0),
        new THREE.Vector3(0.02, 0.55, 0),
        new THREE.Vector3(0.14, 4.4, 0.04),
        new THREE.Vector3(0.22, 8.2, 0.1),
        new THREE.Vector3(0.25, 11.9, 0.06),
      ],
      [0.19, 0.145, 0.105, 0.065, 0.025],
      {
        radialSegs: 5,
        rootCount: 4,
        rootFlare: 0.55,
        flareHeight: 0.9,
        uvYScale: 0.32,
      }
    ),
    buildConnectedTube({
      start: new THREE.Vector3(0.18, 6.2, 0.08),
      end: new THREE.Vector3(-0.85, 8.5, 0.65),
      rBot: 0.042,
      rTop: 0.015,
      radialSegs: 4,
      colorStart: twigBase,
      colorEnd: twigTip,
    }),
    buildConnectedTube({
      start: new THREE.Vector3(0.2, 6.8, 0.09),
      end: new THREE.Vector3(0.95, 9.0, -0.62),
      rBot: 0.042,
      rTop: 0.015,
      radialSegs: 4,
      colorStart: twigBase,
      colorEnd: twigTip,
    }),
  ])!;
  const crownLod1Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const a = i * 2.39996;
    const r = Math.sin(t * Math.PI * 0.9) * 0.95 + 0.18;
    const y = 4.9 + t * 6.5;
    const quad = (i % 4) as AtlasQuad;
    crownLod1Parts.push(
      makeArchedSprigCard(
        2.65 + rand() * 0.45,
        2.95 + rand() * 0.45,
        0.34,
        0.2 + Math.cos(a) * r,
        y,
        0.08 + Math.sin(a) * r,
        0.52 + (rand() - 0.5) * 0.4,
        a,
        (rand() - 0.5) * 0.35,
        t > 0.45 ? colMid : colInner,
        t > 0.45 ? colSun : colMid,
        8.6,
        quad
      )
    );
  }
  const crownLod1 = mergeGeometries(crownLod1Parts)!;

  // LOD2: Slender distant silhouette matching 12m height
  const trunkLod2 = buildConnectedTube({
    start: new THREE.Vector3(0, -0.25, 0),
    end: new THREE.Vector3(0.22, 11.4, 0.06),
    rBot: 0.165,
    rTop: 0.032,
    radialSegs: 4,
  });
  const crownLod2Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    crownLod2Parts.push(
      makeArchedSprigCard(3.8, 6.8, 0.28, 0.2, 4.9, 0.08, 0.18, a, 0, colInner, colSun, 8.6, (i % 4) as AtlasQuad)
    );
  }
  const crownLod2 = mergeGeometries(crownLod2Parts)!;

  return { trunkLod0, crownLod0, trunkLod1, crownLod1, trunkLod2, crownLod2 };
}

// ============================================================================
// 2. Scots Pine (Pinus sylvestris) — Tall rugged trunk with flared stump,
//    dead lower stubs, crooked gnarly upper boughs, airy umbrella crown
// ============================================================================
export function buildPineGeometries() {
  const spine = [
    new THREE.Vector3(0, -0.38, 0),
    new THREE.Vector3(0, 0.0, 0),
    new THREE.Vector3(0.02, 0.8, 0.01),
    new THREE.Vector3(0.07, 3.6, 0.04),
    new THREE.Vector3(0.14, 7.2, -0.04),
    new THREE.Vector3(0.07, 10.8, -0.09),
    new THREE.Vector3(-0.02, 13.6, -0.04),
    new THREE.Vector3(-0.06, 15.1, 0.02),
  ];
  const radii = [0.32, 0.26, 0.225, 0.195, 0.162, 0.122, 0.072, 0.032];
  const trunkParts: THREE.BufferGeometry[] = [
    buildButtressedTrunk(spine, radii, {
      radialSegs: 9,
      rootCount: 5,
      rootFlare: 0.92,
      flareHeight: 1.35,
      rootPhase: 0.8,
      uvYScale: 0.26,
      colRoot: new THREE.Color(0x7c766e),
      colTrunk: new THREE.Color(0xffffff),
    }),
  ];

  // 5 weathered snapped dead lower stubs (pine-forest.webp)
  const deadStubCol = new THREE.Color(0x6e665e);
  const stubRand = seededRand(218);
  for (let i = 0; i < 5; i++) {
    const h = 4.4 + i * 1.05 + (stubRand() - 0.5) * 0.4;
    const t = Math.min(1, h / 10.8);
    const start = spine[3].clone().lerp(spine[5], Math.max(0, (h - 3.6) / 7.2));
    const a = i * 2.25 + 0.5;
    const len = 0.42 + stubRand() * 0.48;
    const end = start.clone().add(
      new THREE.Vector3(Math.cos(a) * len, -0.14 + stubRand() * 0.16, Math.sin(a) * len)
    );
    trunkParts.push(
      buildConnectedTube({
        start,
        end,
        rBot: 0.032 - t * 0.008,
        rTop: 0.011,
        radialSegs: 4,
        overlapStart: 0.05,
        colorStart: deadStubCol,
        colorEnd: deadStubCol,
      })
    );
  }

  // 8 crooked, gnarly multi-segment upper pine boughs + secondary forks (pine-forest.webp!)
  const boughConfigs = [
    { y: 9.8, ang: 0.4, reach: 2.95, rise: 1.05, kinkX: 0.35, kinkY: -0.22, rBot: 0.088 },
    { y: 10.4, ang: 2.45, reach: 2.85, rise: 1.15, kinkX: -0.32, kinkY: -0.18, rBot: 0.084 },
    { y: 11.1, ang: 4.55, reach: 2.65, rise: 1.28, kinkX: 0.28, kinkY: 0.14, rBot: 0.078 },
    { y: 11.7, ang: 1.38, reach: 2.5, rise: 1.2, kinkX: -0.26, kinkY: -0.12, rBot: 0.074 },
    { y: 12.3, ang: 3.62, reach: 2.32, rise: 1.25, kinkX: 0.25, kinkY: 0.18, rBot: 0.068 },
    { y: 12.9, ang: 5.58, reach: 2.05, rise: 1.18, kinkX: -0.22, kinkY: 0.12, rBot: 0.062 },
    { y: 13.5, ang: 0.92, reach: 1.72, rise: 1.12, kinkX: 0.18, kinkY: 0.16, rBot: 0.052 },
    { y: 14.0, ang: 3.12, reach: 1.42, rise: 0.96, kinkX: -0.16, kinkY: 0.18, rBot: 0.044 },
  ];

  const crownAnchors: Array<{ pos: THREE.Vector3; ang: number; tier: number; outer: boolean }> = [];
  for (let i = 0; i < boughConfigs.length; i++) {
    const bc = boughConfigs[i];
    // Interpolate origin along upper trunk spine
    const segT = Math.min(1, Math.max(0, (bc.y - 7.2) / 7.9));
    const baseX = lerp(0.14, -0.05, segT);
    const baseZ = lerp(-0.04, 0.01, segT);
    const start = new THREE.Vector3(baseX, bc.y, baseZ);
    const dirX = Math.cos(bc.ang);
    const dirZ = Math.sin(bc.ang);
    const perpX = -dirZ;
    const perpZ = dirX;

    // Gnarly crooked elbow + arching tip
    const mid = start.clone().add(
      new THREE.Vector3(
        dirX * bc.reach * 0.54 + perpX * bc.kinkX,
        bc.rise * 0.42 + bc.kinkY,
        dirZ * bc.reach * 0.54 + perpZ * bc.kinkX
      )
    );
    const end = start.clone().add(
      new THREE.Vector3(dirX * bc.reach, bc.rise, dirZ * bc.reach)
    );
    const forkEnd = mid.clone().add(
      new THREE.Vector3(
        dirX * bc.reach * 0.44 + perpX * (i % 2 === 0 ? 0.72 : -0.72),
        bc.rise * 0.58 + 0.25,
        dirZ * bc.reach * 0.44 + perpZ * (i % 2 === 0 ? 0.72 : -0.72)
      )
    );

    trunkParts.push(
      buildConnectedTube({
        start,
        end: mid,
        rBot: bc.rBot,
        rTop: bc.rBot * 0.62,
        radialSegs: 5,
        overlapStart: 0.07,
      }),
      buildConnectedTube({
        start: mid,
        end,
        rBot: bc.rBot * 0.62,
        rTop: 0.022,
        radialSegs: 5,
        overlapStart: 0.05,
      }),
      buildConnectedTube({
        start: mid,
        end: forkEnd,
        rBot: bc.rBot * 0.46,
        rTop: 0.016,
        radialSegs: 4,
        overlapStart: 0.04,
      })
    );

    const tier = i / (boughConfigs.length - 1);
    crownAnchors.push(
      { pos: end, ang: bc.ang, tier, outer: true },
      { pos: forkEnd, ang: bc.ang + (i % 2 === 0 ? 0.6 : -0.6), tier, outer: true },
      { pos: mid.clone().lerp(end, 0.55), ang: bc.ang + 0.25, tier, outer: false }
    );
  }
  const trunkLod0 = mergeGeometries(trunkParts)!;

  // 42 crossed 3D umbrella needle-cloud pillows anchored directly to crooked pine boughs (4-quadrant pine atlas!)
  const needleParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(22);
  const pineInner = new THREE.Color(0x96b280);
  const pineMid = new THREE.Color(0xc0d898);
  const pineSun = new THREE.Color(0xe4f2b4);

  for (let i = 0; i < crownAnchors.length; i++) {
    const anc = crownAnchors[i];
    const quad: AtlasQuad =
      anc.tier > 0.75 ? 3 : anc.outer ? ((i % 2 === 0 ? 0 : 1) as AtlasQuad) : 2;
    const w = (anc.outer ? 2.25 : 1.95) + rand() * 0.65;
    const l = (anc.outer ? 2.15 : 1.85) + rand() * 0.58;
    const cx = anc.pos.x + (rand() - 0.5) * 0.22;
    const cy = anc.pos.y - 0.16 + (rand() - 0.5) * 0.18;
    const cz = anc.pos.z + (rand() - 0.5) * 0.22;
    const baseYaw = anc.ang + (rand() - 0.5) * 0.55;

    // Primary arching umbrella pillow
    needleParts.push(
      makeArchedSprigCard(
        w,
        l,
        0.34,
        cx,
        cy,
        cz,
        0.96 + (rand() - 0.5) * 0.36,
        baseYaw,
        (rand() - 0.5) * 0.32,
        anc.outer ? pineMid : pineInner,
        anc.tier > 0.4 ? pineSun : pineMid,
        13.2,
        quad
      )
    );

    // Secondary crossed pitched 3D baffle on outer tips & upper tiers -> full tufted volume from underneath!
    if (anc.outer || i % 2 === 0) {
      const crossQuad = ((quad + 1) % 4) as AtlasQuad;
      needleParts.push(
        makeArchedSprigCard(
          w * 0.86,
          l * 0.84,
          0.26,
          cx + (rand() - 0.5) * 0.28,
          cy + 0.14,
          cz + (rand() - 0.5) * 0.28,
          0.52 + (rand() - 0.5) * 0.34,
          baseYaw + 1.38 + (rand() - 0.5) * 0.4,
          (rand() - 0.5) * 0.36,
          pineInner,
          anc.tier > 0.35 ? pineSun : pineMid,
          13.4,
          crossQuad
        )
      );
    }
  }
  // 4 crossed crown-top umbrella crest rosettes capping the leader
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.35;
    needleParts.push(
      makeArchedSprigCard(
        2.55,
        2.35,
        0.36,
        -0.04 + Math.cos(a) * 0.26,
        14.45 + (k % 2) * 0.26,
        0.02 + Math.sin(a) * 0.26,
        0.74 + (k % 2) * 0.22,
        a,
        0.1,
        pineMid,
        pineSun,
        14.2,
        k % 2 === 0 ? 3 : 1
      )
    );
  }
  const crownLod0 = mergeGeometries(needleParts)!;

  // LOD1: Proportioned 15m trunk + 3 bough ribs + 11 multi-quadrant umbrella sprays
  const trunkLod1 = mergeGeometries([
    buildButtressedTrunk(
      [
        new THREE.Vector3(0, -0.32, 0),
        new THREE.Vector3(0.02, 0.7, 0),
        new THREE.Vector3(0.12, 7.2, -0.04),
        new THREE.Vector3(-0.04, 14.8, 0),
      ],
      [0.27, 0.21, 0.15, 0.042],
      { radialSegs: 5, rootCount: 4, rootFlare: 0.65, flareHeight: 1.1, uvYScale: 0.26 }
    ),
    buildConnectedTube({
      start: new THREE.Vector3(0.05, 10.6, -0.04),
      end: new THREE.Vector3(-2.45, 11.9, 0.8),
      rBot: 0.068,
      rTop: 0.022,
      radialSegs: 4,
    }),
    buildConnectedTube({
      start: new THREE.Vector3(0.03, 11.2, -0.05),
      end: new THREE.Vector3(2.35, 12.5, -0.9),
      rBot: 0.066,
      rTop: 0.022,
      radialSegs: 4,
    }),
    buildConnectedTube({
      start: new THREE.Vector3(0.01, 12.1, -0.04),
      end: new THREE.Vector3(0.4, 13.4, 2.05),
      rBot: 0.06,
      rTop: 0.02,
      radialSegs: 4,
    }),
  ])!;
  const crownLod1Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const a = i * 2.39996;
    const r = (1 - t * 0.48) * (0.55 + rand() * 1.45);
    const y = 10.6 + t * 4.1;
    crownLod1Parts.push(
      makeArchedSprigCard(
        2.85 + rand() * 0.45,
        2.65 + rand() * 0.45,
        0.32,
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        0.86 + (rand() - 0.5) * 0.4,
        a,
        (rand() - 0.5) * 0.35,
        t < 0.4 ? pineInner : pineMid,
        t > 0.55 ? pineSun : pineMid,
        13.2,
        (i % 4) as AtlasQuad
      )
    );
  }
  const crownLod1 = mergeGeometries(crownLod1Parts)!;

  // LOD2: Distant 15m umbrella silhouette
  const trunkLod2 = buildConnectedTube({
    start: new THREE.Vector3(0, -0.25, 0),
    end: new THREE.Vector3(-0.04, 14.4, 0),
    rBot: 0.22,
    rTop: 0.048,
    radialSegs: 4,
  });
  const crownLod2Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    crownLod2Parts.push(
      makeArchedSprigCard(5.1, 4.6, 0.34, 0, 10.6, 0, 0.34, a, 0, pineInner, pineSun, 13.2, (i % 4) as AtlasQuad)
    );
  }
  const crownLod2 = mergeGeometries(crownLod2Parts)!;

  return { trunkLod0, crownLod0, trunkLod1, crownLod1, trunkLod2, crownLod2 };
}

export function buildBogPineGeometries() {
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
        2.6,
        (i % 4) as AtlasQuad
      )
    );
  }
  return { trunk, crown: mergeGeometries(needleParts)! };
}

// ============================================================================
// 3. Norway Spruce (Picea abies) — Prominent 5-root flared mossy buttress stump,
//    reddish-mahogany scaly trunk, dense bare dead lower branch snags (kuusiku-alune.jpg),
//    layered horizontal/sweeping boughs with hanging comb curtains & sharp spire (lone-spruce.jpg)
// ============================================================================
export function buildSpruceGeometries() {
  const spine = [
    new THREE.Vector3(0, -0.42, 0),
    new THREE.Vector3(0, 0.0, 0),
    new THREE.Vector3(0, 0.72, 0),
    new THREE.Vector3(0.02, 2.5, 0.01),
    new THREE.Vector3(0.03, 5.4, -0.02),
    new THREE.Vector3(0.01, 8.6, 0.01),
    new THREE.Vector3(0, 11.4, 0),
    new THREE.Vector3(0, 13.8, 0),
  ];
  const radii = [0.34, 0.275, 0.23, 0.205, 0.17, 0.125, 0.068, 0.016];
  const trunkParts: THREE.BufferGeometry[] = [
    buildButtressedTrunk(spine, radii, {
      radialSegs: 10,
      rootCount: 5,
      rootFlare: 1.48, // Dramatic gripping surface root buttresses (kuusiku-alune.jpg!)
      flareHeight: 1.25,
      rootPhase: 0.22,
      uvYScale: 0.3,
      colRoot: new THREE.Color(0x6c7c52), // subtle damp mossy undertone on bottom root hollows
      colTrunk: new THREE.Color(0xffffff),
    }),
  ];

  // 18 iconic thin bare dead grey-brown lower Norway Spruce branch snags (kuusiku-alune.jpg understory!)
  const deadRand = seededRand(331);
  const deadStartCol = new THREE.Color(0x786e66);
  const deadTipCol = new THREE.Color(0x524c47);
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const h = 1.12 + t * 2.85 + (deadRand() - 0.5) * 0.18;
    const a = i * 2.39996 + (deadRand() - 0.5) * 0.45;
    const trunkR = lerp(0.22, 0.18, t);
    const start = new THREE.Vector3(Math.cos(a) * (trunkR * 0.65), h, Math.sin(a) * (trunkR * 0.65));
    const len = 0.48 + (0.4 + 0.6 * t) * (0.42 + deadRand() * 0.58);
    const droop = -0.08 - deadRand() * 0.28;
    const mid = start.clone().add(
      new THREE.Vector3(
        Math.cos(a) * len * 0.56,
        droop * 0.42 + (deadRand() - 0.5) * 0.08,
        Math.sin(a) * len * 0.56
      )
    );
    const end = start.clone().add(
      new THREE.Vector3(
        Math.cos(a + (deadRand() - 0.5) * 0.25) * len,
        droop,
        Math.sin(a + (deadRand() - 0.5) * 0.25) * len
      )
    );
    trunkParts.push(
      buildConnectedTube({
        start,
        end: mid,
        rBot: 0.022 + deadRand() * 0.008,
        rTop: 0.012,
        radialSegs: 4,
        overlapStart: 0.05,
        colorStart: deadStartCol,
        colorEnd: deadTipCol,
      }),
      buildConnectedTube({
        start: mid,
        end,
        rBot: 0.012,
        rTop: 0.005,
        radialSegs: 3,
        overlapStart: 0.025,
        colorStart: deadTipCol,
        colorEnd: deadTipCol,
      })
    );
  }

  // 10 visible woody live branch ribs under the lower/mid spruce boughs
  const liveRibCol = new THREE.Color(0x88766a);
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const h = 3.9 + t * 4.9;
    const a = i * 2.39996 + 0.8;
    const len = lerp(2.1, 1.05, t);
    const start = new THREE.Vector3(0, h, 0);
    const end = new THREE.Vector3(Math.cos(a) * len, h - 0.42 + t * 0.32, Math.sin(a) * len);
    trunkParts.push(
      buildConnectedTube({
        start,
        end,
        rBot: lerp(0.044, 0.024, t),
        rTop: 0.011,
        radialSegs: 4,
        overlapStart: 0.06,
        colorStart: liveRibCol,
        colorEnd: deadTipCol,
      })
    );
  }
  const trunkLod0 = mergeGeometries(trunkParts)!;

  // 42 layered sweeping feathery Norway Spruce boughs across 7 distinct whorls + sharp spire (lone-spruce.jpg!)
  const boughParts: THREE.BufferGeometry[] = [];
  const rand = seededRand(33);
  const spInner = new THREE.Color(0x94ae82);
  const spMid = new THREE.Color(0xb8d29a);
  const spTip = new THREE.Color(0xdff0b4);

  const tiers: Array<{ y: number; r: number; w: number; l: number; count: number; pitch: number; quad: AtlasQuad }> = [
    { y: 3.35, r: 0.30, w: 2.45, l: 2.85, count: 6, pitch: 1.48, quad: 0 },
    { y: 4.82, r: 0.26, w: 2.22, l: 2.55, count: 6, pitch: 1.42, quad: 0 },
    { y: 6.32, r: 0.22, w: 1.96, l: 2.28, count: 6, pitch: 1.36, quad: 1 },
    { y: 7.78, r: 0.18, w: 1.72, l: 1.96, count: 6, pitch: 1.28, quad: 1 },
    { y: 9.22, r: 0.15, w: 1.42, l: 1.64, count: 5, pitch: 1.18, quad: 1 },
    { y: 10.58, r: 0.11, w: 1.08, l: 1.32, count: 5, pitch: 1.02, quad: 2 },
    { y: 11.82, r: 0.07, w: 0.82, l: 1.08, count: 4, pitch: 0.84, quad: 2 },
  ];

  for (let t = 0; t < tiers.length; t++) {
    const tier = tiers[t];
    for (let i = 0; i < tier.count; i++) {
      const a = (i / tier.count) * Math.PI * 2 + t * 0.68 + (rand() - 0.5) * 0.24;
      const q: AtlasQuad =
        tier.quad === 0 ? (i % 3 === 0 ? 1 : 0) : tier.quad === 1 ? (i % 3 === 0 ? 0 : 1) : 2;
      const wScale = 0.84 + rand() * 0.32;
      const lScale = 0.84 + rand() * 0.32;
      boughParts.push(
        makeArchedSprigCard(
          tier.w * wScale,
          tier.l * lScale,
          0.26,
          Math.sin(a) * tier.r,
          tier.y + (rand() - 0.5) * 0.26,
          Math.cos(a) * tier.r,
          tier.pitch + (rand() - 0.5) * 0.2,
          a,
          (rand() - 0.5) * 0.24,
          i % 2 === 0 ? spInner : spMid,
          spTip,
          7.8,
          q
        )
      );
    }
  }
  // Sharp spiky Norway Spruce conical spire apex (using Q3 vertical leader!)
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    boughParts.push(
      makeArchedSprigCard(0.84, 2.05, 0.06, 0, 12.5, 0, 0.12, a, 0, spMid, spTip, 13.4, 3)
    );
  }
  const crownLod0 = mergeGeometries(boughParts)!;

  // LOD1: Proportioned 13.8m flared trunk + 13 multi-quadrant tiered boughs + spire
  const trunkLod1 = buildButtressedTrunk(
    [
      new THREE.Vector3(0, -0.35, 0),
      new THREE.Vector3(0, 0.7, 0),
      new THREE.Vector3(0, 6.8, 0),
      new THREE.Vector3(0, 13.5, 0),
    ],
    [0.29, 0.21, 0.14, 0.025],
    { radialSegs: 5, rootCount: 5, rootFlare: 1.0, flareHeight: 1.1, uvYScale: 0.3 }
  );
  const c1Parts: THREE.BufferGeometry[] = [];
  const lod1Tiers: Array<{ y: number; w: number; l: number; count: number; pitch: number; quad: AtlasQuad }> = [
    { y: 3.5, w: 2.95, l: 2.95, count: 4, pitch: 1.38, quad: 0 },
    { y: 6.4, w: 2.35, l: 2.45, count: 4, pitch: 1.3, quad: 1 },
    { y: 9.2, w: 1.75, l: 1.88, count: 3, pitch: 1.18, quad: 2 },
    { y: 11.4, w: 1.15, l: 1.45, count: 2, pitch: 0.9, quad: 2 },
  ];
  for (let t = 0; t < lod1Tiers.length; t++) {
    const tier = lod1Tiers[t];
    for (let i = 0; i < tier.count; i++) {
      const a = (i / tier.count) * Math.PI * 2 + t * 0.75;
      c1Parts.push(
        makeArchedSprigCard(tier.w, tier.l, 0.3, 0, tier.y, 0, tier.pitch, a, 0, spInner, spTip, 7.6, tier.quad)
      );
    }
  }
  c1Parts.push(
    makeArchedSprigCard(0.88, 2.0, 0.08, 0, 12.3, 0, 0.14, 0.3, 0, spMid, spTip, 13.3, 3),
    makeArchedSprigCard(0.88, 2.0, 0.08, 0, 12.3, 0, 0.14, 1.87, 0, spMid, spTip, 13.3, 3)
  );
  const crownLod1 = mergeGeometries(c1Parts)!;

  // LOD2: Distant 13.8m conical silhouette
  const trunkLod2 = buildConnectedTube({
    start: new THREE.Vector3(0, -0.25, 0),
    end: new THREE.Vector3(0, 12.6, 0),
    rBot: 0.22,
    rTop: 0.035,
    radialSegs: 4,
  });
  const c2Parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    c2Parts.push(makeArchedSprigCard(4.8, 6.2, 0.24, 0, 2.9, 0, 0.32, a, 0, spInner, spMid, 7.6, 0));
    c2Parts.push(makeArchedSprigCard(3.2, 6.0, 0.18, 0, 7.6, 0, 0.22, a + 0.52, 0, spMid, spTip, 10.6, 3));
  }
  const crownLod2 = mergeGeometries(c2Parts)!;

  return { trunkLod0, crownLod0, trunkLod1, crownLod1, trunkLod2, crownLod2 };
}

// ============================================================================
// 4. Young Norway Spruce Sapling (matching young-spruce.jpg!)
//    Real woody central stem + ground-hugging conical whorls + tall spiky central leader spire
// ============================================================================
export function buildSpruceSaplingGeometries() {
  const trunkParts: THREE.BufferGeometry[] = [
    buildConnectedTube({
      start: new THREE.Vector3(0, -0.2, 0),
      end: new THREE.Vector3(0, 2.48, 0),
      rBot: 0.048,
      rTop: 0.008,
      radialSegs: 5,
      colorStart: new THREE.Color(0x7c5a44),
      colorEnd: new THREE.Color(0x9a6d4b),
    }),
  ];

  // Small ascending woody whorl twigs inside the young spruce
  const rand = seededRand(39);
  for (let w = 0; w < 4; w++) {
    const y = 0.28 + w * 0.42;
    const reach = lerp(0.55, 0.24, w / 3);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + w * 0.72;
      trunkParts.push(
        buildConnectedTube({
          start: new THREE.Vector3(0, y, 0),
          end: new THREE.Vector3(Math.cos(a) * reach, y + 0.18, Math.sin(a) * reach),
          rBot: 0.012,
          rTop: 0.004,
          radialSegs: 3,
          colorStart: new THREE.Color(0x765640),
          colorEnd: new THREE.Color(0x8c6448),
        })
      );
    }
  }
  const trunk = mergeGeometries(trunkParts)!;

  const parts: THREE.BufferGeometry[] = [];
  const spDark = new THREE.Color(0x88aa68);
  const spMid = new THREE.Color(0xb2d282);
  const spTip = new THREE.Color(0xe0f2aa);

  // 6 radiating finely-feathered horizontal/gently-upturned whorls extending to ground level (young-spruce.jpg!)
  const whorls: Array<{ y: number; w: number; l: number; count: number; pitch: number; quad: AtlasQuad }> = [
    { y: 0.16, w: 0.64, l: 0.96, count: 6, pitch: 1.38, quad: 1 },
    { y: 0.48, w: 0.58, l: 0.88, count: 6, pitch: 1.28, quad: 2 },
    { y: 0.80, w: 0.50, l: 0.78, count: 5, pitch: 1.18, quad: 2 },
    { y: 1.12, w: 0.42, l: 0.66, count: 5, pitch: 1.04, quad: 2 },
    { y: 1.44, w: 0.34, l: 0.54, count: 4, pitch: 0.88, quad: 3 },
    { y: 1.72, w: 0.26, l: 0.42, count: 4, pitch: 0.68, quad: 3 },
  ];
  for (let t = 0; t < whorls.length; t++) {
    const wh = whorls[t];
    for (let i = 0; i < wh.count; i++) {
      const a = (i / wh.count) * Math.PI * 2 + t * 0.78 + (rand() - 0.5) * 0.28;
      parts.push(
        makeArchedSprigCard(
          wh.w * (0.86 + rand() * 0.28),
          wh.l * (0.86 + rand() * 0.28),
          0.06,
          Math.sin(a) * 0.03,
          wh.y + (rand() - 0.5) * 0.06,
          Math.cos(a) * 0.03,
          wh.pitch + (rand() - 0.5) * 0.16,
          a,
          (rand() - 0.5) * 0.22,
          t < 2 ? spDark : spMid,
          spTip,
          1.25,
          wh.quad
        )
      );
    }
  }
  // Signature tall spiky vertical central leader spire protruding cleanly at the top (young-spruce.jpg!)
  for (let k = 0; k < 3; k++) {
    parts.push(
      makeArchedSprigCard(0.42, 0.98, 0.03, 0, 1.82, 0, 0.04, (k / 3) * Math.PI + 0.2, 0, spMid, spTip, 2.35, 3)
    );
  }
  const foliage = mergeGeometries(parts)!;

  return { trunk, foliage };
}

// ============================================================================
// 5. Cleaved Glacial Erratic Granite Boulders (moss-covered-stone.jpg & different-moss-covered-stone.webp)
//    Deterministic planar half-space fracture cleavage + sharp rock crests + grounded flat base
// ============================================================================
function buildSingleCleavedRock(
  seed: number,
  radiusX: number,
  radiusY: number,
  radiusZ: number,
  planeCount: number,
  offsetX = 0,
  offsetY = 0,
  offsetZ = 0
): THREE.BufferGeometry {
  const rand = seededRand(seed);
  // 320 faces -> crisp angular rock fractures without smooth balloon look or excessive poly count
  const g = new THREE.IcosahedronGeometry(1.0, 2);
  const pos = g.attributes.position;

  // Deterministic fracture planes (unit normals + cleave distances)
  const planes: Array<{ nx: number; ny: number; nz: number; d: number; bevel: number }> = [];
  for (let i = 0; i < planeCount; i++) {
    // Fibonacci-jittered sphere directions so planes cleave all sides + top ledges organically
    const u = (i + 0.5) / planeCount;
    const phi = Math.acos(1 - 2 * u);
    const theta = i * 2.39996 + (rand() - 0.5) * 0.55;
    let nx = Math.sin(phi) * Math.cos(theta);
    let ny = Math.cos(phi);
    let nz = Math.sin(phi) * Math.sin(theta);
    // Keep planes slightly biased toward angled rock ledges & steep cleaved side walls
    if (ny < -0.35) ny = -0.35 + rand() * 0.4;
    const inv = 1 / Math.hypot(nx, ny, nz);
    nx *= inv;
    ny *= inv;
    nz *= inv;
    planes.push({
      nx,
      ny,
      nz,
      d: 0.62 + rand() * 0.34,
      bevel: 0.04 + rand() * 0.06,
    });
  }

  for (let i = 0; i < pos.count; i++) {
    let vx = pos.getX(i);
    let vy = pos.getY(i);
    let vz = pos.getZ(i);

    // Apply planar half-space clipping with subtle geological bevel so facets meet in crisp ridges
    for (let p = 0; p < planes.length; p++) {
      const pl = planes[p];
      const dot = vx * pl.nx + vy * pl.ny + vz * pl.nz;
      if (dot > pl.d) {
        const excess = dot - pl.d;
        // Softly compress beyond plane so rock stays watertight & forms authentic stepped shelves
        const push = excess * 0.88;
        vx -= pl.nx * push;
        vy -= pl.ny * push;
        vz -= pl.nz * push;
      }
    }

    // Multi-frequency granite surface cragginess & clefts
    const n1 = smoothNoise(vx * 2.4 + seed * 0.13, vz * 2.4 - vy * 1.9 + seed * 0.07) * 2 - 1;
    const n2 = smoothNoise(vx * 5.8 - vy * 4.2 + seed * 0.31, vz * 5.8 + seed * 0.23) * 2 - 1;
    const crag = 1.0 + n1 * 0.14 + n2 * 0.065;

    vx = vx * radiusX * crag;
    vy = vy * radiusY * crag;
    vz = vz * radiusZ * crag;

    // Ground-embed skirt: flatten underside gently & extend bottom down below y=0 so rock sits heavily in soil
    if (vy < -radiusY * 0.18) {
      vy = -radiusY * 0.18 + (vy + radiusY * 0.18) * 0.45;
    }
    // Shift rock slightly up so ~30% sits buried below y=0 and ~70% rises proudly above mossy soil
    vy += radiusY * 0.22;

    pos.setXYZ(i, vx + offsetX, vy + offsetY, vz + offsetZ);
  }

  // Convert to non-indexed only if indexed so we never trigger Three.js console warnings
  g.computeVertexNormals();
  const smoothGeo = g.index ? g.toNonIndexed() : g.clone();
  g.dispose();

  const pAttr = smoothGeo.attributes.position;
  const smoothNrm = smoothGeo.attributes.normal;
  const outNrms = new Float32Array(pAttr.count * 3);
  const outUvs = new Float32Array(pAttr.count * 2);
  const outCols = new Float32Array(pAttr.count * 3);

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const faceN = new THREE.Vector3();

  for (let i = 0; i < pAttr.count; i += 3) {
    vA.fromBufferAttribute(pAttr, i);
    vB.fromBufferAttribute(pAttr, i + 1);
    vC.fromBufferAttribute(pAttr, i + 2);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    faceN.crossVectors(e1, e2).normalize();

    const ax = Math.abs(faceN.x);
    const ay = Math.abs(faceN.y);
    const az = Math.abs(faceN.z);

    for (let k = 0; k < 3; k++) {
      const vi = i + k;
      const vx = pAttr.getX(vi);
      const vy = pAttr.getY(vi);
      const vz = pAttr.getZ(vi);

      // Blend 58% flat fracture normal + 42% smooth normal -> chiseled cleaved granite facets without flat-shaded artifacts!
      const nx = lerp(smoothNrm.getX(vi), faceN.x, 0.58);
      const ny = lerp(smoothNrm.getY(vi), faceN.y, 0.58);
      const nz = lerp(smoothNrm.getZ(vi), faceN.z, 0.58);
      const nLen = Math.hypot(nx, ny, nz) || 1;
      outNrms[vi * 3] = nx / nLen;
      outNrms[vi * 3 + 1] = ny / nLen;
      outNrms[vi * 3 + 2] = nz / nLen;

      // Crisp triplanar-axis box UVs scaled to physical rock meters (~0.85 tile/m)
      const uvScale = 0.82;
      if (ay >= ax && ay >= az) {
        outUvs[vi * 2] = vx * uvScale;
        outUvs[vi * 2 + 1] = vz * uvScale;
      } else if (ax >= az) {
        outUvs[vi * 2] = vz * uvScale;
        outUvs[vi * 2 + 1] = vy * uvScale;
      } else {
        outUvs[vi * 2] = vx * uvScale;
        outUvs[vi * 2 + 1] = vy * uvScale;
      }

      // Ground-contact AO darkening around the buried base & crevices
      const baseAo = lerp(0.54, 1.0, Math.min(1, Math.max(0, (vy + 0.15) / Math.max(0.35, radiusY * 0.72))));
      outCols[vi * 3] = baseAo;
      outCols[vi * 3 + 1] = baseAo;
      outCols[vi * 3 + 2] = baseAo;
    }
  }

  smoothGeo.setAttribute('normal', new THREE.BufferAttribute(outNrms, 3));
  smoothGeo.setAttribute('uv', new THREE.BufferAttribute(outUvs, 2));
  smoothGeo.setAttribute('color', new THREE.BufferAttribute(outCols, 3));
  return smoothGeo;
}

/**
 * Generates 2 distinct Baltic glacial erratic granite formations:
 * - Variant 0: Dramatic angular cleaved erratic boulder + nestled satellite rock chunk (moss-covered-stone.jpg)
 * - Variant 1: Broad stepped low-profile split granite outcrop with mossy ledges (different-moss-covered-stone.webp)
 */
export function buildErraticBoulderGeo(variant: 0 | 1): THREE.BufferGeometry {
  if (variant === 0) {
    const mainRock = buildSingleCleavedRock(701, 0.96, 0.74, 0.84, 13, -0.08, 0.0, 0.02);
    const companionRock = buildSingleCleavedRock(719, 0.48, 0.36, 0.44, 10, 0.74, -0.05, 0.28);
    return mergeGeometries([mainRock, companionRock])!;
  }
  const broadLedge = buildSingleCleavedRock(743, 1.18, 0.56, 0.86, 14, 0.0, -0.03, 0.0);
  const splitCap = buildSingleCleavedRock(757, 0.58, 0.44, 0.52, 11, -0.46, 0.06, -0.26);
  return mergeGeometries([broadLedge, splitCap])!;
}

/**
 * Computes geometry bounding summary for automated geometry verification tests.
 */
export function measureGeometryBounds(geo: THREE.BufferGeometry): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  vertexCount: number;
  hasNaN: boolean;
} {
  const pos = geo.attributes.position;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let hasNaN = false;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      hasNaN = true;
      continue;
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, vertexCount: pos.count, hasNaN };
}
