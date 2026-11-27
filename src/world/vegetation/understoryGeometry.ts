import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  AtlasQuad,
  applyHeightGradient,
  buildConnectedTube,
  makeArchedSprigCard,
  prepGeo,
} from '../botanicalGeometry';
import { lerp, smoothNoise } from '../terrainMath';
import { seededRand } from './vegetationTypes';

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
// Solid Multi-Part Estonian Woodland Bushes with Photo-Sprig Foliage
// ============================================================================

export function buildHazelBushGeometries() {
  const rand = seededRand(411);
  const stemParts: THREE.BufferGeometry[] = [];
  const leafParts: THREE.BufferGeometry[] = [];
  const darkG = new THREE.Color(0x86a866);
  const midG = new THREE.Color(0xb2cc7e);
  const brightG = new THREE.Color(0xdcf098);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.35;
    const tilt = 0.34 + rand() * 0.34;
    const len = 0.68 + rand() * 0.32;
    const pStart = new THREE.Vector3(Math.cos(a) * 0.06, -0.05, Math.sin(a) * 0.06);
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
        rBot: 0.025,
        rTop: 0.007,
        radialSegs: 4,
        overlapStart: 0.02,
        overlapEnd: 0.01,
      })
    );
    const forkStart = pStart.clone().lerp(pEnd, 0.52);
    const twigAngle = a + (rand() - 0.5) * 1.1;
    const forkEnd = forkStart.clone().add(
      new THREE.Vector3(
        Math.cos(twigAngle) * 0.32,
        0.26 + rand() * 0.14,
        Math.sin(twigAngle) * 0.32
      )
    );
    stemParts.push(
      buildConnectedTube({
        start: forkStart,
        end: forkEnd,
        rBot: 0.014,
        rTop: 0.004,
        radialSegs: 4,
        overlapStart: 0.02,
        overlapEnd: 0.008,
      })
    );
  }

  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 5.0 + rand() * 0.55;
    const y = 0.22 + (i / 16) * 0.78 + (rand() - 0.5) * 0.14;
    const r = 0.12 + rand() * 0.42;
    const outer = r > 0.28 || y > 0.68;
    leafParts.push(
      makeArchedSprigCard(
        0.96 + rand() * 0.38,
        0.98 + rand() * 0.36,
        0.26,
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

export function buildJuniperBushGeo(): THREE.BufferGeometry {
  const rand = seededRand(412);
  const parts: THREE.BufferGeometry[] = [];
  const jDark = new THREE.Color(0x8ea884);
  const jTip = new THREE.Color(0xc2d8ae);

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
        0.72,
        (i % 4) as AtlasQuad
      )
    );
  }
  return mergeGeometries(parts)!;
}

// ============================================================================
// Multi-Blade Opaque Grass Tufts, Photographic Ferns, Bilberry & Moss Knolls
// ============================================================================

function makeBowedGrassArc(
  hw: number,
  h: number,
  tilt: number,
  bow: number,
  ang: number,
  ox: number,
  oz: number,
  rootCol: THREE.Color,
  tipCol: THREE.Color,
  yRoot = -0.025
): THREE.BufferGeometry {
  const topW = hw * 1.1;
  const positions = new Float32Array([
    -hw,   yRoot, -bow,
     0,    yRoot,  bow * 0.55,
     hw,   yRoot, -bow,
    -topW, h,      tilt - bow * 0.85,
     0,    h * 1.03, tilt + bow * 0.72,
     topW, h,      tilt - bow * 0.85,
  ]);
  const uvs = new Float32Array([
    0.03, 0.0,
    0.50, 0.0,
    0.97, 0.0,
    0.03, 0.98,
    0.50, 0.98,
    0.97, 0.98,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
  g.rotateY(ang);
  g.translate(ox, 0, oz);
  const nonIdx = g.toNonIndexed();
  g.dispose();

  const pos = nonIdx.attributes.position;
  const nrms = new Float32Array(pos.count * 3);
  const cols = new Float32Array(pos.count * 3);
  const invH = 1 / Math.max(0.05, h);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) * invH));
    cols[i * 3] = rootCol.r + (tipCol.r - rootCol.r) * t;
    cols[i * 3 + 1] = rootCol.g + (tipCol.g - rootCol.g) * t;
    cols[i * 3 + 2] = rootCol.b + (tipCol.b - rootCol.b) * t;
    nrms[i * 3] = 0;
    nrms[i * 3 + 1] = 1;
    nrms[i * 3 + 2] = 0;
  }
  nonIdx.setAttribute('normal', new THREE.BufferAttribute(nrms, 3));
  nonIdx.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return nonIdx;
}

export function buildGrassTuftGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rootCol = new THREE.Color(0x5b6c43);
  const tipCol = new THREE.Color(0xeef4cc);
  const arcConfigs = [
    { ang: 0.14, hw: 0.29, h: 0.43, tilt: 0.13, bow: 0.095, ox: 0.08, oz: 0.05 },
    { ang: 2.26, hw: 0.31, h: 0.49, tilt: 0.16, bow: 0.105, ox: -0.09, oz: 0.06 },
    { ang: 4.35, hw: 0.28, h: 0.54, tilt: 0.14, bow: 0.09, ox: 0.02, oz: -0.1 },
  ];
  for (let p = 0; p < arcConfigs.length; p++) {
    const c = arcConfigs[p];
    parts.push(makeBowedGrassArc(c.hw, c.h, c.tilt, c.bow, c.ang, c.ox, c.oz, rootCol, tipCol));
  }

  const skirtConfigs = [
    { ang: 1.18, hw: 0.27, h: 0.21, tilt: 0.27, ox: -0.05, oz: -0.04 },
    { ang: 3.42, hw: 0.28, h: 0.23, tilt: 0.29, ox: 0.06, oz: 0.03 },
  ];
  for (let p = 0; p < skirtConfigs.length; p++) {
    const c = skirtConfigs[p];
    const positions = new Float32Array([
      -c.hw, -0.02, 0,
       c.hw, -0.02, 0,
       c.hw * 1.14, c.h, c.tilt,
      -c.hw * 1.14, c.h, c.tilt,
    ]);
    const uvs = new Float32Array([0.04, 0.0, 0.96, 0.0, 0.96, 0.72, 0.04, 0.72]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.rotateY(c.ang);
    g.translate(c.ox, 0, c.oz);
    const nonIdx = g.toNonIndexed();
    g.dispose();
    const pos = nonIdx.attributes.position;
    const nrms = new Float32Array(pos.count * 3);
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getY(i) / c.h));
      cols[i * 3] = rootCol.r + (tipCol.r - rootCol.r) * t * 0.82;
      cols[i * 3 + 1] = rootCol.g + (tipCol.g - rootCol.g) * t * 0.82;
      cols[i * 3 + 2] = rootCol.b + (tipCol.b - rootCol.b) * t * 0.82;
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

export function buildShortGrassGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rootCol = new THREE.Color(0x56683c);
  const tipCol = new THREE.Color(0xdce8a8);

  const arcConfigs = [
    { ang: 0.32, hw: 0.29, h: 0.18, tilt: 0.16, bow: 0.095, ox: 0.08, oz: 0.04 },
    { ang: 2.41, hw: 0.31, h: 0.21, tilt: 0.18, bow: 0.105, ox: -0.07, oz: 0.07 },
    { ang: 4.52, hw: 0.28, h: 0.24, tilt: 0.17, bow: 0.09, ox: -0.01, oz: -0.09 },
  ];
  for (let p = 0; p < arcConfigs.length; p++) {
    const c = arcConfigs[p];
    parts.push(makeBowedGrassArc(c.hw, c.h, c.tilt, c.bow, c.ang, c.ox, c.oz, rootCol, tipCol, -0.02));
  }

  const lowSkirts = [
    { ang: 1.38, hw: 0.32, h: 0.14, tilt: 0.28, ox: -0.04, oz: -0.03 },
    { ang: 4.92, hw: 0.31, h: 0.15, tilt: 0.29, ox: 0.05, oz: 0.04 },
  ];
  for (let p = 0; p < lowSkirts.length; p++) {
    const c = lowSkirts[p];
    const positions = new Float32Array([
      -c.hw, -0.018, 0,
       c.hw, -0.018, 0,
       c.hw * 1.18, c.h, c.tilt,
      -c.hw * 1.18, c.h, c.tilt,
    ]);
    const uvs = new Float32Array([0.04, 0.0, 0.96, 0.0, 0.96, 0.85, 0.04, 0.85]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.rotateY(c.ang);
    g.translate(c.ox, 0, c.oz);
    const nonIdx = g.toNonIndexed();
    g.dispose();
    const pos = nonIdx.attributes.position;
    const nrms = new Float32Array(pos.count * 3);
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getY(i) / c.h));
      cols[i * 3] = rootCol.r + (tipCol.r - rootCol.r) * t * 0.9;
      cols[i * 3 + 1] = rootCol.g + (tipCol.g - rootCol.g) * t * 0.9;
      cols[i * 3 + 2] = rootCol.b + (tipCol.b - rootCol.b) * t * 0.9;
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

export function buildMossCarpetGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.46, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const pos = g.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const ang = Math.atan2(pz, px);
    const lobe = 0.88 + 0.16 * Math.sin(ang * 3 + 0.6) + 0.11 * Math.cos(ang * 2 - 0.9);
    const n1 = smoothNoise(px * 4.8 + 2.3, pz * 4.8 - 1.7);
    const n2 = smoothNoise(px * 9.5 - 4.1, pz * 9.5 + 3.4);
    const nx = px * lobe * (0.94 + n1 * 0.24);
    const nz = pz * lobe * (0.92 + n2 * 0.26);
    const rimFrac = Math.min(1, Math.hypot(px, pz) / 0.46);
    const skirtDrop = rimFrac > 0.78 ? -0.058 * ((rimFrac - 0.78) / 0.22) : 0;
    const ny = Math.max(-0.06, py * (0.19 + n1 * 0.08 + n2 * 0.05) + skirtDrop);
    pos.setXYZ(i, nx, ny, nz);
    uvs[i * 2] = nx * 0.95 + 0.5;
    uvs[i * 2 + 1] = nz * 0.95 + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return prepGeo(g, new THREE.Color(0x8c967a), new THREE.Color(0xf4f8e4));
}

export function buildTallUndergrowthGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rootCol = new THREE.Color(0x52643c);
  const tipCol = new THREE.Color(0xf2f4d4);
  const arcConfigs = [
    { ang: 0.2, hw: 0.35, h: 0.88, tilt: 0.19, bow: 0.11, ox: 0.09, oz: 0.05 },
    { ang: 2.32, hw: 0.38, h: 1.04, tilt: 0.22, bow: 0.12, ox: -0.09, oz: 0.07 },
    { ang: 4.44, hw: 0.34, h: 1.2, tilt: 0.24, bow: 0.105, ox: 0.01, oz: -0.11 },
  ];
  for (let p = 0; p < arcConfigs.length; p++) {
    const c = arcConfigs[p];
    parts.push(makeBowedGrassArc(c.hw, c.h, c.tilt, c.bow, c.ang, c.ox, c.oz, rootCol, tipCol, -0.03));
  }
  return mergeGeometries(parts)!;
}

export function buildBilberrySubShrubGeo(): THREE.BufferGeometry {
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

export function buildMossHummockGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.65, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const pos = g.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const n = smoothNoise(px * 4.2 + 3.1, pz * 4.2 - 1.9);
    const nx = px * (1.1 + n * 0.35);
    const nz = pz * (0.98 + n * 0.32);
    const rimFrac = Math.min(1, Math.hypot(px, pz) / 0.65);
    const skirtDrop = rimFrac > 0.8 ? -0.055 * ((rimFrac - 0.8) / 0.2) : 0;
    pos.setXYZ(i, nx, Math.max(-0.058, py * (0.15 + n * 0.1) + skirtDrop), nz);
    uvs[i * 2] = nx * 0.72 + 0.5;
    uvs[i * 2 + 1] = nz * 0.72 + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return prepGeo(g, new THREE.Color(0x828e72), new THREE.Color(0xeef4dc));
}

export function buildOpaqueReedClumpGeo(): THREE.BufferGeometry {
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

export function buildPhotoFernRosetteGeo(): THREE.BufferGeometry {
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

export function buildFallenLogGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.21, 4.4, 7, 1);
  trunk.rotateZ(Math.PI * 0.5);
  trunk.translate(0, 0.14, 0);
  const stub = new THREE.CylinderGeometry(0.03, 0.06, 0.9, 5, 1);
  stub.rotateZ(-0.45);
  stub.rotateX(0.35);
  stub.translate(0.9, 0.38, 0.15);
  return mergeGeometries([prepGeo(trunk), prepGeo(stub)])!;
}
