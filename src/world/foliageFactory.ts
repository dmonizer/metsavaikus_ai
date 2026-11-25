import { ShelterGeometry, containsFootprint, excludeShelterVegetation } from './shelterGeometry';
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
import { computeTreeLodFadeBands } from '../game/qualityGovernor';
import {
  buildDeterministicShuffle,
  computeGrassClumpScale,
  computeMossCarpetScale,
  computeOpennessFactor,
  computeRoadVergeCoverage,
  computeRoadVergeFillerCoverage,
  computeShortGrassScale,
  computeTallUndergrowthScale,
  generateR2TileSamples,
  shouldKeepMossCarpet,
  shouldKeepTallUndergrowth,
} from './grassScatter';
import {
  AtlasQuad,
  applyHeightGradient,
  buildBirchGeometries,
  buildBogPineGeometries,
  buildConnectedTube,
  buildErraticBoulderGeo,
  buildPineGeometries,
  buildSpruceGeometries,
  buildSpruceSaplingGeometries,
  ConnectedTubeSegment,
  createBogPineSegments,
  makeArchedSprigCard,
  prepGeo,
  TreeTopologyReport,
} from './botanicalGeometry';

export { buildConnectedTube, createBogPineSegments };
export type { ConnectedTubeSegment, TreeTopologyReport };

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

const _upVec = new THREE.Vector3(0, 1, 0);
const _tmpQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _slopeNormal = new THREE.Vector3();

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

// Mature tree, sapling, and glacial erratic boulder builders live in ./botanicalGeometry.ts

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

  // 16 layered photographic bush-leaf sprig cards enveloping the hazel twigs
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

function buildJuniperBushGeo(): THREE.BufferGeometry {
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

/**
 * Builds a single horizontally bowed (curved arc) grass/sward strip (4 tris)
 * with upward-biased terrain normals. Horizontal curvature + radial offset
 * eliminates the ruler-straight "growing in lines" artifact of flat crossed cards.
 */
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
  // 6 vertices -> 2 angled sub-panels forming a smooth horizontal U/arc curve
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

/**
 * Compact volumetric Estonian meadow/forest grass tuft cluster:
 * 3 radially offset horizontally-curved arcs + 2 low outward-splayed basal sprays (16 tris).
 * Eliminates flat straight crossed-card lines while filling downward sightlines organically.
 */
function buildGrassTuftGeo(): THREE.BufferGeometry {
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

  // 2 low outward-splayed basal fans so looking down reveals rich overlapping turf volume
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

/**
 * Dense ground-hugging short turf grass & clover filler rosette (16 tris).
 * Knit-fills open ground spaces between medium/tall grass clumps and moss pillows.
 */
function buildShortGrassGeo(): THREE.BufferGeometry {
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

  // 2 wide outward-leaning clover/turf ground skirts to seal vertical sightlines cleanly
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

/**
 * Low, undulating, velvety 3D Baltic moss cushion pillow (opaque, zero alpha-test overdraw!).
 * Irregular multi-lobe silhouette with skirt tucked -0.04m below origin so it seats cleanly on slopes.
 */
function buildMossCarpetGeo(): THREE.BufferGeometry {
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
    // Planar top-down UVs avoid spherical pole pinching on velvety moss detail
    uvs[i * 2] = nx * 0.95 + 0.5;
    uvs[i * 2 + 1] = nz * 0.95 + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return prepGeo(g, new THREE.Color(0x8c967a), new THREE.Color(0xf4f8e4));
}

function buildTallUndergrowthGeo(): THREE.BufferGeometry {
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

interface FadeUniformPair {
  start: { value: number };
  end: { value: number };
}

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
  fade?: FadeUniformPair;
  lodIn?: FadeUniformPair;
  heightFadeScale?: number;
}

function buildDistFadeFragSnippet(hasFade: boolean, hasLodIn: boolean): string {
  const condParts: string[] = [];
  if (hasFade) condParts.push('vDistFade < 0.999');
  if (hasLodIn) condParts.push('vLodIn < 0.999');
  const checks: string[] = [];
  if (hasLodIn) {
    checks.push('if (vLodIn < 0.999 && (vLodIn <= 0.002 || fadeNoise > vLodIn)) discard;');
  }
  if (hasFade) {
    checks.push('if (vDistFade < 0.999 && (vDistFade <= 0.002 || fadeNoise > vDistFade)) discard;');
  }
  return `if (${condParts.join(' || ')}) {
  float fadeNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  ${checks.join('\n  ')}
}
`;
}

function addDistanceFade(
  mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  fade?: FadeUniformPair,
  lodIn?: FadeUniformPair
): void {
  if (!fade && !lodIn) return;
  const hasFade = Boolean(fade);
  const hasLodIn = Boolean(lodIn);
  const fragSnippet = buildDistFadeFragSnippet(hasFade, hasLodIn);
  mat.customProgramCacheKey = () => `dist_fade_v2_${hasFade ? 1 : 0}_${hasLodIn ? 1 : 0}`;
  mat.onBeforeCompile = (shader) => {
    if (fade) {
      shader.uniforms.uFadeStart = fade.start;
      shader.uniforms.uFadeEnd = fade.end;
    }
    if (lodIn) {
      shader.uniforms.uInStart = lodIn.start;
      shader.uniforms.uInEnd = lodIn.end;
    }

    const vertHeader =
      (fade ? `uniform float uFadeStart;\nuniform float uFadeEnd;\nvarying float vDistFade;\n` : '') +
      (lodIn ? `uniform float uInStart;\nuniform float uInEnd;\nvarying float vLodIn;\n` : '');
    const fragHeader =
      (fade ? `varying float vDistFade;\n` : '') +
      (lodIn ? `varying float vLodIn;\n` : '');

    shader.vertexShader =
      vertHeader +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 fadeOriginWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec2 fadePosXZ = fadeOriginWorld.xz;
        #else
          vec2 fadePosXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
        #endif
        float fadeCamDist = length(fadePosXZ - cameraPosition.xz);
        ${fade ? 'vDistFade = 1.0 - smoothstep(uFadeStart, max(uFadeStart + 1.0, uFadeEnd), fadeCamDist);' : ''}
        ${lodIn ? 'vLodIn = smoothstep(uInStart, max(uInStart + 1.0, uInEnd), fadeCamDist);' : ''}
        `
      );

    shader.fragmentShader =
      fragHeader +
      shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n${fragSnippet}`
      );
  };
}

function addWindSway(
  mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  uniforms: WindUniformSet,
  opts: WindShaderOpts
): void {
  const sss = opts.sssStrength ?? 0;
  const hasFade = opts.fade ? 1 : 0;
  const hasLodIn = opts.lodIn ? 1 : 0;
  const hasDistTest = hasFade || hasLodIn ? 1 : 0;
  const heightFadeScale = opts.heightFadeScale ?? 0;
  const cacheKey = `wind_sss_${opts.bendStart}_${opts.bendSpan}_${opts.bendAmp}_${opts.leafAmp}_${opts.leafFreq}_${sss}_fade_${hasFade}_in_${hasLodIn}_hf_${heightFadeScale}`;
  mat.customProgramCacheKey = () => cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uniforms.time;
    shader.uniforms.uWindStrength = uniforms.strength;
    shader.uniforms.uWindDir = uniforms.dir;
    shader.uniforms.uSssSunDir = uniforms.sunDir;
    shader.uniforms.uSssSunColor = uniforms.sunColor;
    if (opts.fade) {
      shader.uniforms.uFadeStart = opts.fade.start;
      shader.uniforms.uFadeEnd = opts.fade.end;
    }
    if (opts.lodIn) {
      shader.uniforms.uInStart = opts.lodIn.start;
      shader.uniforms.uInEnd = opts.lodIn.end;
    }

    shader.vertexShader =
      `uniform float uWindTime;\nuniform float uWindStrength;\nuniform vec2 uWindDir;\n` +
      (opts.fade
        ? `uniform float uFadeStart;\nuniform float uFadeEnd;\nvarying float vDistFade;\n`
        : '') +
      (opts.lodIn
        ? `uniform float uInStart;\nuniform float uInEnd;\nvarying float vLodIn;\n`
        : '') +
      (sss > 0
        ? `uniform vec3 uSssSunDir;\nuniform vec3 uSssSunColor;\nvarying vec3 vSssAdd;\n`
        : '') +
      shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 instOriginWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 wPosXZ = instOriginWorld.xz;
      #else
        vec2 wPosXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
      #endif
      #if ${hasDistTest}
        float fadeCamDist = length(wPosXZ - cameraPosition.xz);
        #if ${hasFade}
          vDistFade = 1.0 - smoothstep(uFadeStart, max(uFadeStart + 1.0, uFadeEnd), fadeCamDist);
          #if ${heightFadeScale > 0 ? 1 : 0}
            transformed.y *= mix(${heightFadeScale.toFixed(3)}, 1.0, vDistFade);
          #endif
        #endif
        #if ${hasLodIn}
          vLodIn = smoothstep(uInStart, max(uInStart + 1.0, uInEnd), fadeCamDist);
        #endif
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

    if (opts.fade || opts.lodIn) {
      const fragHeader =
        (opts.fade ? `varying float vDistFade;\n` : '') +
        (opts.lodIn ? `varying float vLodIn;\n` : '');
      const fragSnippet = buildDistFadeFragSnippet(Boolean(opts.fade), Boolean(opts.lodIn));
      shader.fragmentShader =
        fragHeader +
        shader.fragmentShader.replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>\n${fragSnippet}`
        );
    }

    if (sss > 0) {
      // Vertex-stage backlit SSS eliminates per-fragment normalize/dot/smoothstep across millions of overdrawn alpha-tested foliage pixels!
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 sssWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          sssWp = instanceMatrix * sssWp;
        #endif
        vec3 sssWorldPos = (modelMatrix * sssWp).xyz;
        vec3 sssViewDir = normalize(cameraPosition - sssWorldPos);
        float sssAlign = max(dot(sssViewDir, -uSssSunDir), 0.0);
        float sssDay = smoothstep(0.02, 0.26, uSssSunDir.y);
        float sssBack = (sssAlign * sssAlign) * ${sss.toFixed(3)} * sssDay;
        float sssWrap = ${(sss * 0.26).toFixed(3)} * sssDay;
        vSssAdd = uSssSunColor * (sssBack + sssWrap) * vec3(1.14, 1.2, 0.72) + vec3(0.09, 0.13, 0.14) * sssDay;`
      );

      shader.fragmentShader =
        `varying vec3 vSssAdd;\n` +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `outgoingLight += diffuseColor.rgb * vSssAdd;
          #include <opaque_fragment>`
        );
    }
  };
}

/**
 * Composes an additional shader modification cleanly on top of any existing onBeforeCompile
 * (such as addWindSway or addDistanceFade) while extending customProgramCacheKey.
 */
function composeMaterialShader(
  mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  keySuffix: string,
  hook: (shader: THREE.WebGLProgramParametersWithUniforms) => void
): void {
  const prevCompile = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => `${prevKey ? prevKey.call(mat) : 'base'}_${keySuffix}`;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile.call(mat, shader, renderer);
    hook(shader);
  };
}

/**
 * Height-based organic dual-bark PBR transition:
 * - Scots Pine: deeply fissured grey-brown lower plates -> warm foxy-orange flaking upper bark
 * - Silver Birch: dark charcoal diamond-fissured basal stump -> creamy papery white trunk
 */
function addDualBarkBlend(
  mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  altTex: THREE.Texture,
  opts: {
    id: string;
    yLow: number;
    yHigh: number;
    noiseAmp: number;
    invert?: boolean;
    uvScaleX?: number;
    uvScaleY?: number;
  }
): void {
  const invert = opts.invert ? 1.0 : 0.0;
  const uvSX = opts.uvScaleX ?? 1.0;
  const uvSY = opts.uvScaleY ?? 1.0;
  composeMaterialShader(mat, `dualbark_${opts.id}`, (shader) => {
    shader.uniforms.uAltBarkTex = { value: altTex };
    shader.vertexShader =
      `varying vec3 vBarkLocalPos;\nvarying vec2 vBarkRawUv;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBarkLocalPos = position;
        vBarkRawUv = uv;`
      );
    shader.fragmentShader =
      `uniform sampler2D uAltBarkTex;\nvarying vec3 vBarkLocalPos;\nvarying vec2 vBarkRawUv;\n` +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          float barkNoise = sin(vBarkLocalPos.x * 13.0 + vBarkLocalPos.z * 11.0 + vBarkLocalPos.y * 1.6) * 0.55
                          + cos(vBarkLocalPos.x * 27.0 - vBarkLocalPos.z * 21.0 + vBarkLocalPos.y * 3.1) * 0.25;
          float barkT = smoothstep(${opts.yLow.toFixed(3)}, ${opts.yHigh.toFixed(3)}, vBarkLocalPos.y + barkNoise * ${opts.noiseAmp.toFixed(3)});
          float altW = ${invert > 0.5 ? '(1.0 - barkT)' : 'barkT'};
          if (altW > 0.01) {
            vec3 altCol = texture2D(uAltBarkTex, vBarkRawUv * vec2(${uvSX.toFixed(2)}, ${uvSY.toFixed(2)})).rgb;
            diffuseColor.rgb = mix(diffuseColor.rgb, altCol, altW);
          }
        #endif`
      );
  });
}

/**
 * World-normal moss & Nordic reindeer lichen drape PBR shader for cleaved glacial erratic boulders:
 * - Steep fractured rock sides expose crisp dark crystalline granite
 * - Upward-facing shelves, crests & dripping shoulders carry thick shaggy emerald moss (moss-covered-stone.jpg)
 *   or silvery-pale reindeer lichen + olive moss (different-moss-covered-stone.webp) per boulder!
 */
function addBoulderMossLichenShader(
  mat: THREE.MeshStandardMaterial,
  mossTex: THREE.Texture,
  lichenTex: THREE.Texture
): void {
  composeMaterialShader(mat, 'glacial_moss_lichen_v1', (shader) => {
    shader.uniforms.uRockMossTex = { value: mossTex };
    shader.uniforms.uRockLichenTex = { value: lichenTex };

    shader.vertexShader =
      `varying vec3 vRockWorldPos;\nvarying vec3 vRockWorldNorm;\nvarying float vRockLocalY;\nvarying float vRockSeed;\n` +
      shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vRockLocalY = position.y;
        #ifdef USE_INSTANCING
          vec4 rockWp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vec3 rockInstOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vRockSeed = fract(sin(dot(rockInstOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);
          vRockWorldNorm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vec4 rockWp = modelMatrix * vec4(transformed, 1.0);
          vRockSeed = 0.35;
          vRockWorldNorm = normalize(mat3(modelMatrix) * objectNormal);
        #endif
        vRockWorldPos = rockWp.xyz;`
      );

    shader.fragmentShader =
      `uniform sampler2D uRockMossTex;\nuniform sampler2D uRockLichenTex;\nvarying vec3 vRockWorldPos;\nvarying vec3 vRockWorldNorm;\nvarying float vRockLocalY;\nvarying float vRockSeed;\n` +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          #ifdef USE_MAP
            vec3 rN = normalize(vRockWorldNorm);
            vec2 rockTopUv = vRockWorldPos.xz * 0.62;
            float nMacro = sin(vRockWorldPos.x * 2.1 + cos(vRockWorldPos.z * 1.9)) * 0.5 + 0.5;
            float nDrip = cos(vRockWorldPos.x * 6.4 - vRockWorldPos.z * 5.8 + vRockWorldPos.y * 2.2) * 0.5 + 0.5;
            // Moss drapes thickly over horizontal shelves & shoulders and drips down steep faces
            float mossBias = 0.24 + vRockSeed * 0.22;
            float mossCov = smoothstep(0.34, 0.72, rN.y + (nMacro - 0.45) * 0.34 + (nDrip - 0.5) * 0.2 + mossBias * 0.32);
            // Slightly less moss right inside buried soil collar
            mossCov *= smoothstep(-0.18, 0.06, vRockLocalY);
            if (mossCov > 0.01) {
              vec3 mossCol = texture2D(uRockMossTex, rockTopUv).rgb;
              vec3 lichenCol = texture2D(uRockLichenTex, rockTopUv * 1.15).rgb;
              // Vary per boulder between lush emerald forest moss & silvery Nordic reindeer lichen crust
              float lichenMix = smoothstep(0.46, 0.84, vRockSeed + (nMacro - 0.5) * 0.28);
              vec3 coatCol = mix(mossCol, lichenCol, lichenMix);
              diffuseColor.rgb = mix(diffuseColor.rgb, coatCol, mossCov * 0.94);
            }
            // Damp earthy darkening right at soil contact seam
            float soilCollar = 1.0 - smoothstep(-0.08, 0.16, vRockLocalY);
            diffuseColor.rgb *= mix(1.0, 0.74, soilCollar * 0.65);
          #endif`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float mossRoughT = smoothstep(0.42, 0.74, normalize(vRockWorldNorm).y);
          roughnessFactor = mix(0.84, 0.97, mossRoughT);`
        );
  });
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
  boulderOutcrop: BakedSlab;
  deadfall: BakedSlab;
  totalInstances: number;
}

export interface DeadfallLogTarget {
  id: string;
  vcx: number;
  vcz: number;
  cellIdx: number;
  slabIdx: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  kicksRemaining: number;
  broken: boolean;
}

interface ChunkBucketBaked {
  cells: SubCellBaked[];
  colliders: CircleCollider[];
  deadfallLogs: DeadfallLogTarget[];
}

interface GrassTileBaked {
  slab: BakedSlab;
  shortSlab: BakedSlab;
  mossSlab: BakedSlab;
  tallSlab: BakedSlab;
  cx: number;
  cy: number;
  cz: number;
  r: number;
}

const EMPTY_GRASS_TILE: GrassTileBaked = {
  slab: EMPTY_SLAB,
  shortSlab: EMPTY_SLAB,
  mossSlab: EMPTY_SLAB,
  tallSlab: EMPTY_SLAB,
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

export interface VegetationQualityOptions {
  lod0Dist?: number;
  lod1Dist?: number;
  bushDist?: number;
  understoryDist?: number;
  boulderDist?: number;
  bogDist?: number;
  grassMaxRing?: 1 | 2 | 3 | 4;
  grassRing1Step?: 1 | 2 | 3;
  grassRing2Step?: 1 | 2 | 3;
  grassRing3Step?: 1 | 2 | 3;
  grassRing4Step?: 1 | 2 | 3;
}

const CAP_LOD0 = 960;
const CAP_LOD1 = 1850;
const CAP_LOD2 = 2400;
const CAP_BOG_PINE = 680;
const CAP_SAPLING = 1800;
const CAP_HAZEL = 2400;
const CAP_JUNIPER = 1600;
const CAP_FERN = 3600;
const CAP_SHRUB = 5600;
const CAP_MOSS = 1800;
const CAP_REED = 2200;
const CAP_BOULDER = 650;
const CAP_DEADFALL = 480;

// Compact curved 3D grass tufts + dense short filler grass + velvety 3D moss pillows
// Isotropic Halton(2,3) + polar jitter + Fisher-Yates tile shuffling eliminates all line patterns.
const GRASS_BLADE_CAP = 16500;
const SHORT_GRASS_CAP = 22000;
const MOSS_CARPET_CAP = 12000;
const TALL_UNDERGROWTH_CAP = 5800;
const GRASS_TILE_SIZE = 16;
const GRASS_TILE_RADIUS = 2; // Baseline 5x5; High expands to ring 3 (~48m), Ultra to ring 4 (~64m)
const MAX_GRASS_TILE_CACHE = 420;
const GRASS_TILE_SAMPLES = 580;
const SHORT_GRASS_TILE_SAMPLES = 860;
const MOSS_TILE_SAMPLES = 420;
const TALL_TILE_SAMPLES = 200;
const MAX_CHUNK_CACHE = 450;
const COLLIDER_CELL_SIZE = 8;

export class WorldVegetationSystem {
  readonly group = new THREE.Group();
  readonly windTimeUniform = { value: 0 };
  readonly windStrengthUniform = { value: 0.9 };
  readonly windDirUniform = { value: new THREE.Vector2(0.86, 0.51) };
  readonly sunDirUniform = { value: new THREE.Vector3(0.5, 0.6, 0.35).normalize() };
  readonly sunColorUniform = { value: new THREE.Color(0xfff1d6) };

  private readonly lod0InFadeUniforms: FadeUniformPair = { start: { value: 50 }, end: { value: 56 } };
  private readonly lod0OutFadeUniforms: FadeUniformPair = { start: { value: 56 }, end: { value: 62 } };
  private readonly lod1InFadeUniforms: FadeUniformPair = { start: { value: 124 }, end: { value: 132 } };
  private readonly lod1OutFadeUniforms: FadeUniformPair = { start: { value: 132 }, end: { value: 140 } };
  private readonly treeFadeUniforms: FadeUniformPair = { start: { value: 184 }, end: { value: 226 } };
  private readonly bogFadeUniforms: FadeUniformPair = { start: { value: 114 }, end: { value: 150 } };
  private readonly bushFadeUniforms: FadeUniformPair = { start: { value: 88 }, end: { value: 124 } };
  private readonly underFadeUniforms: FadeUniformPair = { start: { value: 54 }, end: { value: 86 } };
  private readonly boulderFadeUniforms: FadeUniformPair = { start: { value: 112 }, end: { value: 146 } };
  private readonly grassFadeUniforms: FadeUniformPair = { start: { value: 18 }, end: { value: 30 } };
  private readonly shortGrassFadeUniforms: FadeUniformPair = { start: { value: 14 }, end: { value: 26 } };
  private readonly mossCarpetFadeUniforms: FadeUniformPair = { start: { value: 16 }, end: { value: 28 } };
  private readonly tallGrassFadeUniforms: FadeUniformPair = { start: { value: 22 }, end: { value: 38 } };

  private readonly chunkCache = new Map<string, ChunkBucketBaked>();
  private readonly grassTileCache = new Map<string, GrassTileBaked>();
  private readonly indexedColliderChunks = new Set<string>();
  private readonly colliderGrid = new Map<string, CircleCollider[]>();
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private lastVisibilitySig = '';
  private lastCullCamX = 999999;
  private lastCullCamZ = 999999;
  private lastCullFwdX = 0;
  private lastCullFwdZ = 0;
  private lastFogCullDist = 225;
  private lastQualitySig = '';
  private lastGrassTileX = 999999;
  private lastGrassTileZ = 999999;
  private lastGrassFwdX = 0;
  private lastGrassFwdZ = 0;
  private lastGrassQualitySig = '';
  private grassHasPendingTiles = true;
  private readonly brokenDeadfallIds = new Set<string>();
  private readonly deadfallKicksRemaining = new Map<string, number>();
  private forceVisRebuild = false;

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

  private saplingTrunkMesh!: THREE.InstancedMesh;
  private saplingLeafMesh!: THREE.InstancedMesh;
  private deadfallMesh!: THREE.InstancedMesh;

  // Solid Woodland Bushes
  private hazelStemMesh!: THREE.InstancedMesh;
  private hazelLeafMesh!: THREE.InstancedMesh;
  private juniperMesh!: THREE.InstancedMesh;

  // Ground Coverage + Player-Centered Frustum-Culled Grass, Short Turf, Velvety Moss & Tall Undergrowth
  private grassBladeMesh!: THREE.InstancedMesh;
  private shortGrassMesh!: THREE.InstancedMesh;
  private mossCarpetMesh!: THREE.InstancedMesh;
  private tallUndergrowthMesh!: THREE.InstancedMesh;
  private fernMesh!: THREE.InstancedMesh;
  private shrubMesh!: THREE.InstancedMesh;
  private mossHummockMesh!: THREE.InstancedMesh;
  private reedMesh!: THREE.InstancedMesh;
  private boulderMesh!: THREE.InstancedMesh;
  private boulderOutcropMesh!: THREE.InstancedMesh;

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

  private readonly isLowPowerGpu: boolean;
  private readonly grassCap: number;
  private readonly shortGrassCap: number;
  private readonly mossCarpetCap: number;
  private readonly tallCap: number;
  private lastGrassMaxRing = GRASS_TILE_RADIUS;
  private readonly grassRingSortBuf: Array<{ tx: number; tz: number; dSq: number }> = [];

  constructor(textures: WorldTextures, isSoftwareGl: boolean, isLowPowerGpu: boolean, private readonly shelters: ShelterGeometry) {
    this.isLowPowerGpu = isLowPowerGpu;
    this.grassCap = isSoftwareGl ? 2200 : isLowPowerGpu ? 9500 : GRASS_BLADE_CAP;
    this.shortGrassCap = isSoftwareGl ? 3200 : isLowPowerGpu ? 13000 : SHORT_GRASS_CAP;
    this.mossCarpetCap = isSoftwareGl ? 1800 : isLowPowerGpu ? 7000 : MOSS_CARPET_CAP;
    this.tallCap = isSoftwareGl ? 750 : isLowPowerGpu ? 3400 : TALL_UNDERGROWTH_CAP;
    this.buildInstancedLayers(textures, isSoftwareGl);
    this.group.traverse(node => {
      if (node instanceof THREE.InstancedMesh) node.receiveShadow = true;
    });
    const groundLayers = [
      this.grassBladeMesh,
      this.shortGrassMesh,
      this.mossCarpetMesh,
      this.tallUndergrowthMesh,
      this.fernMesh,
      this.shrubMesh,
      this.mossHummockMesh,
      this.reedMesh,
      this.hazelStemMesh,
      this.hazelLeafMesh,
      this.juniperMesh,
    ];
    for (const mesh of groundLayers) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        excludeShelterVegetation(material, shelters);
      }
    }
  }

  private isInsideBuilding(x: number, z: number): boolean {
    return this.shelters.footprints.some(
      (area) => !area.temporary && !area.clearingOnly && containsFootprint(area, x, z, 1.2)
    );
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
    const boulderOutcrop: InstanceRecord[] = [];
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
        deadfallLogs: [],
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

    // 3. Multi-Layered Forest Understory (denser natural drifts of varied low-to-tall ferns, bilberry & moss)
    for (let i = 0; i < 200; i++) {
      const gx = minX + rand() * CHUNK_SIZE;
      const gz = minZ + rand() * CHUNK_SIZE;
      if (Math.abs(gx) > WORLD_HALF - 3 || Math.abs(gz) > WORLD_HALF - 3) continue;
      if (distToRoadDetail(gx, gz).dist < 2.1) continue;
      if (this.isInsideBuilding(gx, gz)) continue;

      const gy = getTerrainHeight(gx, gz);
      if (gy < SWAMP_WATER_Y - 0.12) continue;

      const isl = getNearestSwampIsland(gx, gz);
      const onIsland = isl.island !== null && isl.islandMask > 0.35;
      const swamp = onIsland ? 0 : getSwampFactor(gx, gz);
      const patch = smoothNoise(gx * 0.09, gz * 0.09);

      if (swamp > 0.36) {
        if (gy <= SWAMP_WATER_Y + 0.35 && rand() < 0.68) {
          reed.push({
            x: gx,
            y: gy - 0.04,
            z: gz,
            scale: 0.72 + rand() * 0.92,
            rotY: rand() * Math.PI * 2,
            r: 0.74 + rand() * 0.22,
            g: 0.72 + rand() * 0.18,
            b: 0.42 + rand() * 0.12,
          });
        } else if (gy > SWAMP_WATER_Y + 0.14 && rand() < 0.26) {
          mossHummock.push({
            x: gx,
            y: gy - 0.05,
            z: gz,
            scale: 0.8 + rand() * 0.78,
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

      if (patch > 0.5 && rand() < 0.58) {
        fern.push({
          x: gx,
          y: gy - 0.03,
          z: gz,
          scale: 0.72 + rand() * 0.92,
          rotY: rand() * Math.PI * 2,
          r: 0.8 + rand() * 0.22,
          g: 0.9 + rand() * 0.16,
          b: 0.72 + rand() * 0.14,
        });
      } else if (rand() < 0.62) {
        shrub.push({
          x: gx,
          y: gy - 0.03,
          z: gz,
          scale: 0.78 + rand() * 0.94,
          rotY: rand() * Math.PI * 2,
          r: 0.84 + rand() * 0.22,
          g: 0.92 + rand() * 0.18,
          b: 0.76 + rand() * 0.14,
        });
      } else if (rand() < 0.42 && getDistanceToNearestVillage(gx, gz).dist > 14) {
        mossHummock.push({
          x: gx,
          y: gy - 0.04,
          z: gz,
          scale: 0.78 + rand() * 0.78,
          rotY: rand() * Math.PI * 2,
          r: 0.8 + rand() * 0.18,
          g: 0.9 + rand() * 0.14,
          b: 0.68 + rand() * 0.12,
        });
      }
    }

    // 4. Deadfall logs & Glacial Granite Boulders
    const deadfallIds: string[] = [];
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
      const scale = 0.75 + rand() * 0.55;
      const rotY = rand() * Math.PI * 2;
      const rCol = 0.72 + rand() * 0.2;
      const gCol = 0.78 + rand() * 0.22;
      const bCol = 0.64 + rand() * 0.14;
      const logId = `${vcx}_${vcz}_${i}`;
      if (this.brokenDeadfallIds.has(logId)) continue;
      deadfallIds.push(logId);
      deadfall.push({
        x: dx,
        y: dy - 0.04,
        z: dz,
        scale,
        rotY,
        r: rCol,
        g: gCol,
        b: bCol,
      });
    }

    for (let i = 0; i < 5; i++) {
      const bx = minX + rand() * CHUNK_SIZE;
      const bz = minZ + rand() * CHUNK_SIZE;
      if (distToRoadDetail(bx, bz).dist < 4.5) continue;
      if (this.isInsideBuilding(bx, bz)) continue;
      const nearV = getDistanceToNearestVillage(bx, bz);
      if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.68) continue;
      const by = getTerrainHeight(bx, bz);
      if (by < SWAMP_WATER_Y + 0.18) continue;
      const s = 0.56 + rand() * 0.96;
      const isOutcrop = rand() < 0.45;
      const rec: InstanceRecord = {
        x: bx,
        y: by - 0.05, // Grounded deeply into mossy earth (cleaved rock skirt extends below y=0)
        z: bz,
        scale: s,
        rotY: rand() * Math.PI * 2,
        r: 0.86 + rand() * 0.16,
        g: 0.88 + rand() * 0.14,
        b: 0.84 + rand() * 0.14,
      };
      if (isOutcrop) {
        boulderOutcrop.push(rec);
      } else {
        boulder.push(rec);
      }
      if (s > 0.68) colliders.push({ x: bx, z: bz, r: s * (isOutcrop ? 0.86 : 0.78) });
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
    const qBoulderOutcrop = partitionByQuadrant(boulderOutcrop, centerX, centerZ);
    const qDeadfall: [InstanceRecord[], InstanceRecord[], InstanceRecord[], InstanceRecord[]] = [
      [],
      [],
      [],
      [],
    ];
    const qDeadfallIds: [string[], string[], string[], string[]] = [[], [], [], []];
    for (let i = 0; i < deadfall.length; i++) {
      const rec = deadfall[i];
      const idx = (rec.z >= centerZ ? 2 : 0) + (rec.x >= centerX ? 1 : 0);
      qDeadfall[idx].push(rec);
      qDeadfallIds[idx].push(deadfallIds[i]);
    }

    const quarter = CHUNK_SIZE * 0.25;
    const cells: SubCellBaked[] = [];
    const deadfallLogs: DeadfallLogTarget[] = [];
    for (let q = 0; q < 4; q++) {
      const sBirch = bakeRecords(qBirch[q], 6.6, 8.4);
      const sPine = bakeRecords(qPine[q], 8.0, 9.4);
      const sBogPine = bakeRecords(qBogPine[q], 1.6, 2.5);
      const sSpruce = bakeRecords(qSpruce[q], 7.2, 8.6);
      const sSapling = bakeRecords(qSapling[q], 1.3, 2.0);
      const sHazel = bakeRecords(qHazel[q], 1.1, 1.9);
      const sJuniper = bakeRecords(qJuniper[q], 0.9, 1.6);
      const sFern = bakeRecords(qFern[q], 0.4, 1.2);
      const sShrub = bakeRecords(qShrub[q], 0.35, 1.1);
      const sMoss = bakeRecords(qMoss[q], 0.25, 1.2);
      const sReed = bakeRecords(qReed[q], 0.7, 1.4);
      const sBoulder = bakeRecords(qBoulder[q], 0.4, 1.8);
      const sBoulderOutcrop = bakeRecords(qBoulderOutcrop[q], 0.35, 1.9);
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
        sBoulderOutcrop.count +
        sDeadfall.count;
      if (totalInstances === 0) continue;

      const cellIdx = cells.length;
      for (let di = 0; di < qDeadfall[q].length; di++) {
        const rec = qDeadfall[q][di];
        const id = qDeadfallIds[q][di];
        deadfallLogs.push({
          id,
          vcx,
          vcz,
          cellIdx,
          slabIdx: di,
          x: rec.x,
          y: rec.y,
          z: rec.z,
          scale: rec.scale,
          rotY: rec.rotY,
          kicksRemaining: this.deadfallKicksRemaining.get(id) ?? 2,
          broken: false,
        });
      }

      const qx = minX + ((q & 1) ? quarter * 3 : quarter);
      const qz = minZ + ((q & 2) ? quarter * 3 : quarter);
      const baseH = getTerrainHeight(qx, qz);
      const hasTallTrees = sBirch.count + sPine.count + sSpruce.count > 0;
      const cy = baseH + (hasTallTrees ? 7.5 : 1.5);
      // Half-diagonal of 24x24m quadrant (~17m) + crown overhang
      const r = hasTallTrees ? 22.5 : 18.5;

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
        boulderOutcrop: sBoulderOutcrop,
        deadfall: sDeadfall,
        totalInstances,
      });
    }

    const baked: ChunkBucketBaked = {
      cells,
      colliders,
      deadfallLogs,
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
    const sapling = buildSpruceSaplingGeometries();
    const hazel = buildHazelBushGeometries();
    const juniperGeo = buildJuniperBushGeo();
    const deadfallGeo = buildFallenLogGeo();

    // PBR Normal-Mapped Bark Materials (LOD0) + Dual-Bark Height Transitions + Complementary LOD Crossfading
    const birchBark0Mat = new THREE.MeshStandardMaterial({
      map: textures.birchBark,
      normalMap: textures.birchNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.86,
      metalness: 0.0,
      envMapIntensity: 0.45,
      vertexColors: true,
    });
    addWindSway(birchBark0Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      fade: this.lod0OutFadeUniforms,
    });
    addDualBarkBlend(birchBark0Mat, textures.birchBarkBase, {
      id: 'birch_base',
      yLow: 0.48,
      yHigh: 1.72,
      noiseAmp: 0.48,
      invert: true,
      uvScaleX: 1.8,
      uvScaleY: 1.8,
    });

    const birchLeaf0Mat = new THREE.MeshLambertMaterial({
      map: textures.birchLeafCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(birchLeaf0Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0.13,
      leafFreq: 3.6,
      sssStrength: 0.48,
      fade: this.lod0OutFadeUniforms,
    });

    const birchLeaf1Mat = new THREE.MeshLambertMaterial({
      map: textures.birchLeafCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(birchLeaf1Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0.12,
      leafFreq: 3.6,
      sssStrength: 0.48,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });

    const birchLeaf2Mat = new THREE.MeshLambertMaterial({
      map: textures.birchLeafCard,
      alphaTest: 0.44,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(birchLeaf2Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0.1,
      leafFreq: 3.4,
      sssStrength: 0.48,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });

    const pineBark0Mat = new THREE.MeshStandardMaterial({
      map: textures.pineBark,
      normalMap: textures.pineNormal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.93,
      metalness: 0.0,
      envMapIntensity: 0.42,
      vertexColors: true,
    });
    addWindSway(pineBark0Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      fade: this.lod0OutFadeUniforms,
    });
    addDualBarkBlend(pineBark0Mat, textures.pineBarkUpper, {
      id: 'pine_upper',
      yLow: 4.5,
      yHigh: 8.6,
      noiseAmp: 1.55,
      invert: false,
      uvScaleX: 1.2,
      uvScaleY: 1.2,
    });

    const pineLeaf0Mat = new THREE.MeshLambertMaterial({
      map: textures.pineNeedleCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(pineLeaf0Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0.08,
      leafFreq: 3.0,
      sssStrength: 0.38,
      fade: this.lod0OutFadeUniforms,
    });

    const pineLeaf1Mat = new THREE.MeshLambertMaterial({
      map: textures.pineNeedleCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(pineLeaf1Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0.08,
      leafFreq: 3.0,
      sssStrength: 0.38,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });

    const pineLeaf2Mat = new THREE.MeshLambertMaterial({
      map: textures.pineNeedleCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(pineLeaf2Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0.07,
      leafFreq: 2.9,
      sssStrength: 0.38,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
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
      fade: this.bogFadeUniforms,
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
      fade: this.bogFadeUniforms,
    });

    const spruceBark0Mat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.spruceNormal,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.4,
      vertexColors: true,
    });
    addWindSway(spruceBark0Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0,
      leafFreq: 0,
      fade: this.lod0OutFadeUniforms,
    });

    const spruceLeaf0Mat = new THREE.MeshLambertMaterial({
      map: textures.spruceBoughCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(spruceLeaf0Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0.075,
      leafFreq: 2.9,
      sssStrength: 0.36,
      fade: this.lod0OutFadeUniforms,
    });

    const spruceLeaf1Mat = new THREE.MeshLambertMaterial({
      map: textures.spruceBoughCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(spruceLeaf1Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0.075,
      leafFreq: 2.9,
      sssStrength: 0.36,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });

    const spruceLeaf2Mat = new THREE.MeshLambertMaterial({
      map: textures.spruceBoughCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(spruceLeaf2Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0.06,
      leafFreq: 2.8,
      sssStrength: 0.36,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });

    const saplingTrunkMat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.spruceNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.36,
      vertexColors: true,
    });
    addWindSway(saplingTrunkMat, windUniforms, {
      bendStart: 0.12,
      bendSpan: 2.4,
      bendAmp: 0.14,
      leafAmp: 0,
      leafFreq: 0,
      fade: this.bushFadeUniforms,
    });
    const saplingLeafMat = new THREE.MeshLambertMaterial({
      map: textures.spruceBoughCard,
      alphaTest: 0.45,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(saplingLeafMat, windUniforms, {
      bendStart: 0.12,
      bendSpan: 2.4,
      bendAmp: 0.14,
      leafAmp: 0.055,
      leafFreq: 3.6,
      sssStrength: 0.52,
      fade: this.bushFadeUniforms,
    });

    const hazelStemMat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.spruceNormal,
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
      fade: this.bushFadeUniforms,
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
      fade: this.bushFadeUniforms,
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
      fade: this.bushFadeUniforms,
    });

    const shadows = !isSoftwareGl;

    // Lightweight Lambert bark materials for LOD1 & LOD2 with matched dual-bark, wind sway & complementary LOD crossfade
    const birchBark1Mat = new THREE.MeshLambertMaterial({
      map: textures.birchBark,
      vertexColors: true,
    });
    addWindSway(birchBark1Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });
    addDualBarkBlend(birchBark1Mat, textures.birchBarkBase, {
      id: 'birch_base_l1',
      yLow: 0.48,
      yHigh: 1.72,
      noiseAmp: 0.48,
      invert: true,
      uvScaleX: 1.8,
      uvScaleY: 1.8,
    });
    const birchBark2Mat = new THREE.MeshLambertMaterial({
      map: textures.birchBark,
      vertexColors: true,
    });
    addWindSway(birchBark2Mat, windUniforms, {
      bendStart: 0.3,
      bendSpan: 12.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });
    addDualBarkBlend(birchBark2Mat, textures.birchBarkBase, {
      id: 'birch_base_l2',
      yLow: 0.48,
      yHigh: 1.72,
      noiseAmp: 0.48,
      invert: true,
      uvScaleX: 1.8,
      uvScaleY: 1.8,
    });

    const pineBark1Mat = new THREE.MeshLambertMaterial({
      map: textures.pineBark,
      vertexColors: true,
    });
    addWindSway(pineBark1Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });
    addDualBarkBlend(pineBark1Mat, textures.pineBarkUpper, {
      id: 'pine_upper_l1',
      yLow: 4.5,
      yHigh: 8.6,
      noiseAmp: 1.55,
      invert: false,
      uvScaleX: 1.2,
      uvScaleY: 1.2,
    });
    const pineBark2Mat = new THREE.MeshLambertMaterial({
      map: textures.pineBark,
      vertexColors: true,
    });
    addWindSway(pineBark2Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 15.0,
      bendAmp: 0.28,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });
    addDualBarkBlend(pineBark2Mat, textures.pineBarkUpper, {
      id: 'pine_upper_l2',
      yLow: 4.5,
      yHigh: 8.6,
      noiseAmp: 1.55,
      invert: false,
      uvScaleX: 1.2,
      uvScaleY: 1.2,
    });

    const spruceBark1Mat = new THREE.MeshLambertMaterial({
      map: textures.spruceBark,
      vertexColors: true,
    });
    addWindSway(spruceBark1Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod0InFadeUniforms,
      fade: this.lod1OutFadeUniforms,
    });
    const spruceBark2Mat = new THREE.MeshLambertMaterial({
      map: textures.spruceBark,
      vertexColors: true,
    });
    addWindSway(spruceBark2Mat, windUniforms, {
      bendStart: 0.4,
      bendSpan: 13.6,
      bendAmp: 0.22,
      leafAmp: 0,
      leafFreq: 0,
      lodIn: this.lod1InFadeUniforms,
      fade: this.treeFadeUniforms,
    });

    // Trees: ONLY close LOD0 trunks cast & receive shadows; paired crowns share trunk GPU buffers (0 duplicate uploads)!
    this.birchTrunk0 = this.createInstanced(birch.trunkLod0, birchBark0Mat, CAP_LOD0, shadows, true);
    this.birchCrown0 = this.createPairedFollower(this.birchTrunk0, birch.crownLod0, birchLeaf0Mat, CAP_LOD0);
    this.birchTrunk1 = this.createInstanced(birch.trunkLod1, birchBark1Mat, CAP_LOD1, false, false);
    this.birchCrown1 = this.createPairedFollower(this.birchTrunk1, birch.crownLod1, birchLeaf1Mat, CAP_LOD1);
    this.birchTrunk2 = this.createInstanced(birch.trunkLod2, birchBark2Mat, CAP_LOD2, false, false);
    this.birchCrown2 = this.createPairedFollower(this.birchTrunk2, birch.crownLod2, birchLeaf2Mat, CAP_LOD2);

    this.pineTrunk0 = this.createInstanced(pine.trunkLod0, pineBark0Mat, CAP_LOD0, shadows, true);
    this.pineCrown0 = this.createPairedFollower(this.pineTrunk0, pine.crownLod0, pineLeaf0Mat, CAP_LOD0);
    this.pineTrunk1 = this.createInstanced(pine.trunkLod1, pineBark1Mat, CAP_LOD1, false, false);
    this.pineCrown1 = this.createPairedFollower(this.pineTrunk1, pine.crownLod1, pineLeaf1Mat, CAP_LOD1);
    this.pineTrunk2 = this.createInstanced(pine.trunkLod2, pineBark2Mat, CAP_LOD2, false, false);
    this.pineCrown2 = this.createPairedFollower(this.pineTrunk2, pine.crownLod2, pineLeaf2Mat, CAP_LOD2);

    this.bogPineTrunk = this.createInstanced(bogPine.trunk, bogPineBarkMat, CAP_BOG_PINE, shadows, true);
    this.bogPineCrown = this.createPairedFollower(this.bogPineTrunk, bogPine.crown, bogPineLeafMat, CAP_BOG_PINE);

    this.spruceTrunk0 = this.createInstanced(spruce.trunkLod0, spruceBark0Mat, CAP_LOD0, shadows, true);
    this.spruceCrown0 = this.createPairedFollower(this.spruceTrunk0, spruce.crownLod0, spruceLeaf0Mat, CAP_LOD0);
    this.spruceTrunk1 = this.createInstanced(spruce.trunkLod1, spruceBark1Mat, CAP_LOD1, false, false);
    this.spruceCrown1 = this.createPairedFollower(this.spruceTrunk1, spruce.crownLod1, spruceLeaf1Mat, CAP_LOD1);
    this.spruceTrunk2 = this.createInstanced(spruce.trunkLod2, spruceBark2Mat, CAP_LOD2, false, false);
    this.spruceCrown2 = this.createPairedFollower(this.spruceTrunk2, spruce.crownLod2, spruceLeaf2Mat, CAP_LOD2);

    this.saplingTrunkMesh = this.createInstanced(sapling.trunk, saplingTrunkMat, CAP_SAPLING, false, true);
    this.saplingLeafMesh = this.createPairedFollower(this.saplingTrunkMesh, sapling.foliage, saplingLeafMat, CAP_SAPLING);
    const deadfallMat = new THREE.MeshStandardMaterial({
      map: textures.spruceBark,
      normalMap: textures.spruceNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.3,
    });
    addDistanceFade(deadfallMat, this.bushFadeUniforms);
    this.deadfallMesh = this.createInstanced(deadfallGeo, deadfallMat, CAP_DEADFALL, false, true);

    // Solid Woodland Bushes (hazel leaves share hazel stem GPU buffers!)
    this.hazelStemMesh = this.createInstanced(hazel.stems, hazelStemMat, CAP_HAZEL, false, false);
    this.hazelLeafMesh = this.createPairedFollower(this.hazelStemMesh, hazel.leaves, hazelLeafMat, CAP_HAZEL);
    this.juniperMesh = this.createInstanced(juniperGeo, juniperMat, CAP_JUNIPER, false, false);

    // Photorealistic Bowed 3D Grass, Sedge & Wild Clover Tufts (compact curved arcs, backlit SSS!)
    const bladeGeo = buildGrassTuftGeo();
    const bladeMat = new THREE.MeshLambertMaterial({
      map: textures.grassClumpCard,
      alphaTest: 0.38,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(bladeMat, windUniforms, {
      bendStart: 0.02,
      bendSpan: 0.48,
      bendAmp: 0.16,
      leafAmp: 0.05,
      leafFreq: 5.0,
      sssStrength: 0.44,
      fade: this.grassFadeUniforms,
      heightFadeScale: 0.34,
    });
    this.grassBladeMesh = this.createInstanced(bladeGeo, bladeMat, this.grassCap, false, false, false);

    // Dense Ground-Hugging Short Grass & Woodland Clover Carpet (fills inter-clump spaces!)
    const shortGrassGeo = buildShortGrassGeo();
    const shortGrassMat = new THREE.MeshLambertMaterial({
      map: textures.shortGrassCard,
      alphaTest: 0.36,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(shortGrassMat, windUniforms, {
      bendStart: 0.015,
      bendSpan: 0.24,
      bendAmp: 0.075,
      leafAmp: 0.028,
      leafFreq: 5.4,
      sssStrength: 0.4,
      fade: this.shortGrassFadeUniforms,
      heightFadeScale: 0.3,
    });
    this.shortGrassMesh = this.createInstanced(shortGrassGeo, shortGrassMat, this.shortGrassCap, false, false, false);

    // Opaque Velvety 3D Moss Cushion Carpet (zero alpha-test overdraw, carpets between grass clumps!)
    const mossCarpetGeo = buildMossCarpetGeo();
    const mossCarpetMat = new THREE.MeshStandardMaterial({
      map: textures.mossCarpetTex,
      normalMap: textures.mossNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.32,
      vertexColors: true,
    });
    addDistanceFade(mossCarpetMat, this.mossCarpetFadeUniforms);
    this.mossCarpetMesh = this.createInstanced(mossCarpetGeo, mossCarpetMat, this.mossCarpetCap, false, true, false);

    // Randomized Taller Undergrowth Layer (tall wild grasses, feathery plumes, woodland herbs & sedges)
    const tallGeo = buildTallUndergrowthGeo();
    const tallMat = new THREE.MeshLambertMaterial({
      map: textures.tallUndergrowthCard,
      alphaTest: 0.40,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    addWindSway(tallMat, windUniforms, {
      bendStart: 0.06,
      bendSpan: 1.05,
      bendAmp: 0.24,
      leafAmp: 0.065,
      leafFreq: 4.3,
      sssStrength: 0.46,
      fade: this.tallGrassFadeUniforms,
      heightFadeScale: 0.36,
    });
    this.tallUndergrowthMesh = this.createInstanced(tallGeo, tallMat, this.tallCap, false, false, false);

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
      fade: this.underFadeUniforms,
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
      fade: this.underFadeUniforms,
    });
    this.shrubMesh = this.createInstanced(shrubGeo, shrubMat, CAP_SHRUB, false, false);

    const mossGeo = buildMossHummockGeo();
    const mossMat = new THREE.MeshStandardMaterial({
      map: textures.mossCarpetTex,
      normalMap: textures.mossNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.34,
      vertexColors: true,
    });
    addDistanceFade(mossMat, this.underFadeUniforms);
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
      fade: this.bogFadeUniforms,
    });
    this.reedMesh = this.createInstanced(reedGeo, reedMat, CAP_REED, false, false);

    // Cleaved Glacial Erratic Granite Boulders with World-Normal Shaggy Moss & Reindeer Lichen Drape
    const boulderGeo0 = buildErraticBoulderGeo(0);
    const boulderGeo1 = buildErraticBoulderGeo(1);
    const boulderMat = new THREE.MeshStandardMaterial({
      map: textures.boulderGranite,
      normalMap: textures.boulderNormal,
      normalScale: new THREE.Vector2(1.25, 1.25),
      roughness: 0.86,
      metalness: 0.02,
      envMapIntensity: 0.42,
      vertexColors: true,
    });
    addDistanceFade(boulderMat, this.boulderFadeUniforms);
    addBoulderMossLichenShader(boulderMat, textures.boulderMossCoat, textures.boulderLichenCoat);
    this.boulderMesh = this.createInstanced(boulderGeo0, boulderMat, CAP_BOULDER, shadows, true);
    this.boulderOutcropMesh = this.createInstanced(boulderGeo1, boulderMat, CAP_BOULDER, shadows, true);
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
    const localBuildings = this.shelters.footprints.filter(area => {
      if (area.temporary) return false;
      const reach = Math.hypot(area.halfW, area.halfD) + GRASS_TILE_SIZE * 0.72 + 1.2;
      return Math.hypot(tileCx - area.x, tileCz - area.z) <= reach;
    });

    const randSeed = getActiveBlueprint().seed | 0;
    const grassSamples = generateR2TileSamples(tx, tz, randSeed, GRASS_TILE_SIZE, GRASS_TILE_SAMPLES, 13);
    const shortSamples = generateR2TileSamples(tx, tz, randSeed, GRASS_TILE_SIZE, SHORT_GRASS_TILE_SAMPLES, 41);
    const mossSamples = generateR2TileSamples(tx, tz, randSeed, GRASS_TILE_SIZE, MOSS_TILE_SAMPLES, 73);
    const tallSamples = generateR2TileSamples(tx, tz, randSeed, GRASS_TILE_SIZE, TALL_TILE_SAMPLES, 97);

    const rawMat = new Float32Array(grassSamples.length * 16);
    const rawCol = new Float32Array(grassSamples.length * 3);
    let grassCount = 0;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < grassSamples.length; i++) {
      const s = grassSamples[i];
      const px = minX + s.lx;
      const pz = minZ + s.lz;
      if (px < minWorld || px > maxWorld || pz < minWorld || pz > maxWorld) continue;
      if (localBuildings.some(area => containsFootprint(area, px, pz, 1.2))) continue;

      const roadInfo = distToRoadDetail(px, pz);
      const vergeJitter =
        (smoothNoise(px * 0.42, pz * 0.42) * 0.65 + smoothNoise(px * 1.15, pz * 1.15) * 0.35) * 2 - 1;
      const verge = computeRoadVergeCoverage(roadInfo.dist, roadInfo.isTrail, vergeJitter, s.r4, false);
      if (!verge.keep) continue;

      const py = getTerrainHeight(px, pz);
      if (py < SWAMP_WATER_Y + 0.12) continue;

      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      const isl = getNearestSwampIsland(px, pz);
      const swamp = isl.islandMask > 0.35 ? 0 : getSwampFactor(px, pz);
      const nearVillage = getDistanceToNearestVillage(px, pz);
      const gladeNoise = smoothNoise(px * 0.045 - 5.3, pz * 0.045 + 3.7);
      const openness = computeOpennessFactor(
        nearVillage.dist,
        nearVillage.village?.clearingRadius ?? 0,
        roadInfo.dist,
        roadInfo.isTrail,
        swamp,
        isl.islandMask,
        gladeNoise
      );
      const patchNoise = smoothNoise(px * 0.11, pz * 0.11);
      const { sxz, sy } = computeGrassClumpScale(
        swamp,
        patchNoise,
        s.r1,
        s.r2,
        s.r3,
        verge.heightScale,
        openness
      );

      _bakeDummy.position.set(px, py - 0.03, pz);
      _bakeDummy.rotation.set((s.r4 - 0.5) * 0.24, s.r1 * Math.PI * 2, (s.r2 - 0.5) * 0.24);
      _bakeDummy.scale.set(sxz, sy, sxz);
      _bakeDummy.updateMatrix();
      _bakeDummy.matrix.toArray(rawMat, grassCount * 16);

      const cOff = grassCount * 3;
      const tone = 0.74 + s.r2 * 0.34;
      if (swamp > 0.35) {
        rawCol[cOff] = tone * (0.98 + s.r4 * 0.12);
        rawCol[cOff + 1] = tone * (0.84 + s.r3 * 0.1);
        rawCol[cOff + 2] = tone * 0.50;
      } else {
        rawCol[cOff] = tone * (0.78 + s.r1 * 0.2);
        rawCol[cOff + 1] = tone * (0.9 + s.r3 * 0.18);
        rawCol[cOff + 2] = tone * (0.58 + s.r4 * 0.12);
      }
      grassCount++;
    }

    // Dense ground-hugging short turf grass & clover filler layer (fills every space between tufts!)
    const rawShortMat = new Float32Array(shortSamples.length * 16);
    const rawShortCol = new Float32Array(shortSamples.length * 3);
    let shortCount = 0;

    for (let i = 0; i < shortSamples.length; i++) {
      const s = shortSamples[i];
      const px = minX + s.lx;
      const pz = minZ + s.lz;
      if (px < minWorld || px > maxWorld || pz < minWorld || pz > maxWorld) continue;
      if (localBuildings.some(area => containsFootprint(area, px, pz, 1.1))) continue;

      const roadInfo = distToRoadDetail(px, pz);
      const vergeJitter =
        (smoothNoise(px * 0.45 + 3.1, pz * 0.45 - 2.4) * 0.65 +
          smoothNoise(px * 1.25 - 1.7, pz * 1.25 + 4.2) * 0.35) *
          2 -
        1;
      const verge = computeRoadVergeFillerCoverage(roadInfo.dist, roadInfo.isTrail, vergeJitter, s.r4);
      if (!verge.keep) continue;

      const py = getTerrainHeight(px, pz);
      if (py < SWAMP_WATER_Y + 0.1) continue;

      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      const isl = getNearestSwampIsland(px, pz);
      const swamp = isl.islandMask > 0.35 ? 0 : getSwampFactor(px, pz);
      const nearVillage = getDistanceToNearestVillage(px, pz);
      const gladeNoise = smoothNoise(px * 0.045 - 5.3, pz * 0.045 + 3.7);
      const openness = computeOpennessFactor(
        nearVillage.dist,
        nearVillage.village?.clearingRadius ?? 0,
        roadInfo.dist,
        roadInfo.isTrail,
        swamp,
        isl.islandMask,
        gladeNoise
      );
      const patchNoise = smoothNoise(px * 0.14 + 4.7, pz * 0.14 - 3.3);
      const { sxz, sy } = computeShortGrassScale(
        swamp,
        patchNoise,
        s.r1,
        s.r2,
        s.r3,
        verge.heightScale,
        openness
      );

      _bakeDummy.position.set(px, py - 0.02, pz);
      _bakeDummy.rotation.set((s.r4 - 0.5) * 0.22, s.r1 * Math.PI * 2, (s.r2 - 0.5) * 0.22);
      _bakeDummy.scale.set(sxz, sy, sxz);
      _bakeDummy.updateMatrix();
      _bakeDummy.matrix.toArray(rawShortMat, shortCount * 16);

      const cOff = shortCount * 3;
      const tone = 0.72 + s.r2 * 0.32;
      if (swamp > 0.35) {
        rawShortCol[cOff] = tone * (0.94 + s.r4 * 0.12);
        rawShortCol[cOff + 1] = tone * (0.86 + s.r3 * 0.1);
        rawShortCol[cOff + 2] = tone * 0.52;
      } else {
        rawShortCol[cOff] = tone * (0.76 + s.r1 * 0.18);
        rawShortCol[cOff + 1] = tone * (0.92 + s.r3 * 0.16);
        rawShortCol[cOff + 2] = tone * (0.56 + s.r4 * 0.12);
      }
      shortCount++;
    }

    // Velvety 3D moss cushions carpeting inter-clump spaces in forest, verges, and shaded meadow patches
    const rawMossMat = new Float32Array(mossSamples.length * 16);
    const rawMossCol = new Float32Array(mossSamples.length * 3);
    let mossCount = 0;

    for (let i = 0; i < mossSamples.length; i++) {
      const s = mossSamples[i];
      const px = minX + s.lx;
      const pz = minZ + s.lz;
      if (px < minWorld || px > maxWorld || pz < minWorld || pz > maxWorld) continue;
      if (localBuildings.some(area => containsFootprint(area, px, pz, 1.1))) continue;

      const roadInfo = distToRoadDetail(px, pz);
      const vergeJitter =
        (smoothNoise(px * 0.4 - 6.2, pz * 0.4 + 2.1) * 0.65 +
          smoothNoise(px * 1.1 + 3.8, pz * 1.1 - 5.1) * 0.35) *
          2 -
        1;
      const verge = computeRoadVergeFillerCoverage(roadInfo.dist, roadInfo.isTrail, vergeJitter, s.r4);
      if (!verge.keep) continue;

      const py = getTerrainHeight(px, pz);
      if (py < SWAMP_WATER_Y + 0.08) continue;

      const isl = getNearestSwampIsland(px, pz);
      const swamp = isl.islandMask > 0.35 ? 0 : getSwampFactor(px, pz);
      const nearVillage = getDistanceToNearestVillage(px, pz);
      const gladeNoise = smoothNoise(px * 0.045 - 5.3, pz * 0.045 + 3.7);
      const openness = computeOpennessFactor(
        nearVillage.dist,
        nearVillage.village?.clearingRadius ?? 0,
        roadInfo.dist,
        roadInfo.isTrail,
        swamp,
        isl.islandMask,
        gladeNoise
      );

      const mossNoise =
        smoothNoise(px * 0.13 + 11.4, pz * 0.13 - 8.2) * 0.64 +
        smoothNoise(px * 0.34 - 4.5, pz * 0.34 + 6.7) * 0.36;
      if (!shouldKeepMossCarpet(openness, mossNoise, swamp, s.r1, s.r4)) continue;

      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      const { sxz, sy } = computeMossCarpetScale(
        swamp,
        mossNoise,
        s.r1,
        s.r2,
        s.r3,
        verge.heightScale,
        openness
      );
      // Align moss pillow exactly to terrain normal, then apply random local yaw around that normal
      const slopeX = (getTerrainHeight(px - 0.35, pz) - getTerrainHeight(px + 0.35, pz)) / 0.7;
      const slopeZ = (getTerrainHeight(px, pz - 0.35) - getTerrainHeight(px, pz + 0.35)) / 0.7;
      _slopeNormal
        .set(
          Math.max(-0.48, Math.min(0.48, slopeX)),
          1,
          Math.max(-0.48, Math.min(0.48, slopeZ))
        )
        .normalize();
      _tmpQuat.setFromUnitVectors(_upVec, _slopeNormal);
      _yawQuat.setFromAxisAngle(_upVec, s.r1 * Math.PI * 2);

      _bakeDummy.position.set(px, py - 0.028, pz);
      _bakeDummy.quaternion.copy(_tmpQuat).multiply(_yawQuat);
      _bakeDummy.scale.set(sxz, sy, sxz * (0.86 + s.r3 * 0.28));
      _bakeDummy.updateMatrix();
      _bakeDummy.matrix.toArray(rawMossMat, mossCount * 16);

      const cOff = mossCount * 3;
      const tone = 0.78 + s.r2 * 0.3;
      if (swamp > 0.32) {
        // Golden-olive Baltic bog sphagnum cushions
        rawMossCol[cOff] = tone * (0.98 + s.r3 * 0.16);
        rawMossCol[cOff + 1] = tone * (0.92 + s.r1 * 0.12);
        rawMossCol[cOff + 2] = tone * (0.54 + s.r4 * 0.1);
      } else {
        // Rich velvety emerald-chartreuse Pleurozium woodland moss
        rawMossCol[cOff] = tone * (0.78 + s.r3 * 0.22);
        rawMossCol[cOff + 1] = tone * (0.96 + s.r1 * 0.16);
        rawMossCol[cOff + 2] = tone * (0.54 + s.r4 * 0.14);
      }
      mossCount++;
    }

    const rawTallMat = new Float32Array(tallSamples.length * 16);
    const rawTallCol = new Float32Array(tallSamples.length * 3);
    let tallCount = 0;

    for (let i = 0; i < tallSamples.length; i++) {
      const s = tallSamples[i];
      const px = minX + s.lx;
      const pz = minZ + s.lz;
      if (px < minWorld || px > maxWorld || pz < minWorld || pz > maxWorld) continue;
      if (localBuildings.some(area => containsFootprint(area, px, pz, 1.35))) continue;

      const roadInfo = distToRoadDetail(px, pz);
      const vergeJitter =
        (smoothNoise(px * 0.38, pz * 0.38) * 0.65 + smoothNoise(px * 1.05, pz * 1.05) * 0.35) * 2 - 1;
      const verge = computeRoadVergeCoverage(roadInfo.dist, roadInfo.isTrail, vergeJitter, s.r4, true);
      if (!verge.keep) continue;

      const py = getTerrainHeight(px, pz);
      if (py < SWAMP_WATER_Y + 0.16) continue;

      const isl = getNearestSwampIsland(px, pz);
      const swamp = isl.islandMask > 0.35 ? 0 : getSwampFactor(px, pz);
      if (swamp > 0.42) continue;

      const nearVillage = getDistanceToNearestVillage(px, pz);
      const gladeNoise = smoothNoise(px * 0.045 - 5.3, pz * 0.045 + 3.7);
      const openness = computeOpennessFactor(
        nearVillage.dist,
        nearVillage.village?.clearingRadius ?? 0,
        roadInfo.dist,
        roadInfo.isTrail,
        swamp,
        isl.islandMask,
        gladeNoise
      );

      // Natural organic drift clustering in open areas, thinned to scattered wild long tufts in forest
      const driftNoise =
        smoothNoise(px * 0.095 + 7.2, pz * 0.095 - 4.1) * 0.62 +
        smoothNoise(px * 0.25 - 2.5, pz * 0.25 + 9.4) * 0.38;
      if (!shouldKeepTallUndergrowth(openness, driftNoise, s.r1, s.r4)) continue;
      if (roadInfo.dist < 4.6 && s.r2 > 0.48) continue;

      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      const { sxz, sy } = computeTallUndergrowthScale(
        driftNoise,
        s.r1,
        s.r2,
        s.r3,
        verge.heightScale,
        openness
      );
      _bakeDummy.position.set(px, py - 0.035, pz);
      _bakeDummy.rotation.set((s.r4 - 0.5) * 0.22, s.r2 * Math.PI * 2, (s.r3 - 0.5) * 0.22);
      _bakeDummy.scale.set(sxz, sy, sxz);
      _bakeDummy.updateMatrix();
      _bakeDummy.matrix.toArray(rawTallMat, tallCount * 16);

      const cOff = tallCount * 3;
      const tone = 0.76 + s.r3 * 0.32;
      const goldenShift = s.r4 > 0.72 ? 0.12 : 0;
      rawTallCol[cOff] = tone * (0.82 + s.r1 * 0.16 + goldenShift);
      rawTallCol[cOff + 1] = tone * (0.92 + s.r2 * 0.14);
      rawTallCol[cOff + 2] = tone * (0.56 + s.r4 * 0.1);
      tallCount++;
    }

    if (grassCount === 0 && shortCount === 0 && mossCount === 0 && tallCount === 0) {
      return EMPTY_GRASS_TILE;
    }

    const shuffleSeed = (tx * 73856093) ^ (tz * 19349663) ^ randSeed;
    const packShuffled = (matSrc: Float32Array, colSrc: Float32Array, count: number, seedOffset: number): BakedSlab => {
      if (count === 0) return EMPTY_SLAB;
      const order = buildDeterministicShuffle(count, shuffleSeed + seedOffset);
      const matrices = new Float32Array(count * 16);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const srcIdx = order[i];
        const sM = srcIdx * 16;
        const dM = i * 16;
        for (let k = 0; k < 16; k++) matrices[dM + k] = matSrc[sM + k];
        const sC = srcIdx * 3;
        const dC = i * 3;
        colors[dC] = colSrc[sC];
        colors[dC + 1] = colSrc[sC + 1];
        colors[dC + 2] = colSrc[sC + 2];
      }
      return { count, matrices, colors, bounds: new Float32Array(0) };
    };

    const cy = (minY + maxY) * 0.5 + 0.45;
    const halfY = (maxY - minY) * 0.5 + 1.25;
    const halfXZ = GRASS_TILE_SIZE * 0.5 + 0.8;
    return {
      slab: packShuffled(rawMat, rawCol, grassCount, 1),
      shortSlab: packShuffled(rawShortMat, rawShortCol, shortCount, 3),
      mossSlab: packShuffled(rawMossMat, rawMossCol, mossCount, 5),
      tallSlab: packShuffled(rawTallMat, rawTallCol, tallCount, 2),
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
    bakeBudget = 2,
    maxRenderDist = 225,
    qualityOpts?: VegetationQualityOptions
  ): void {
    const ptx = Math.floor(camX / GRASS_TILE_SIZE);
    const ptz = Math.floor(camZ / GRASS_TILE_SIZE);
    const fallbackRing: 1 | 2 =
      this.isLowPowerGpu && maxRenderDist < 115 ? 1 : GRASS_TILE_RADIUS;
    const maxRing = qualityOpts?.grassMaxRing ?? fallbackRing;
    const ring1Step = qualityOpts?.grassRing1Step ?? (this.isLowPowerGpu ? 2 : 1);
    const ring2Step = qualityOpts?.grassRing2Step ?? (this.isLowPowerGpu ? 3 : 2);
    const ring3Step = qualityOpts?.grassRing3Step ?? 2;
    const ring4Step = qualityOpts?.grassRing4Step ?? 2;
    const grassEnd = Math.max(14, maxRing * GRASS_TILE_SIZE - 2);
    this.grassFadeUniforms.end.value = grassEnd;
    this.grassFadeUniforms.start.value = Math.max(6, grassEnd * 0.54);
    const shortEnd = Math.max(12, grassEnd * 0.84);
    this.shortGrassFadeUniforms.end.value = shortEnd;
    this.shortGrassFadeUniforms.start.value = Math.max(5, shortEnd * 0.52);
    const mossEnd = Math.max(14, grassEnd * 0.9);
    this.mossCarpetFadeUniforms.end.value = mossEnd;
    this.mossCarpetFadeUniforms.start.value = Math.max(6, mossEnd * 0.56);
    const tallEnd = grassEnd + 10;
    this.tallGrassFadeUniforms.end.value = tallEnd;
    this.tallGrassFadeUniforms.start.value = Math.max(10, tallEnd * 0.56);
    const grassQualitySig = `${maxRing}_${ring1Step}_${ring2Step}_${ring3Step}_${ring4Step}`;

    const tileMoved =
      ptx !== this.lastGrassTileX ||
      ptz !== this.lastGrassTileZ ||
      maxRing !== this.lastGrassMaxRing ||
      grassQualitySig !== this.lastGrassQualitySig;

    let rotChanged = false;
    if (camForward) {
      const fl = Math.hypot(camForward.x, camForward.z) || 1;
      const fx = camForward.x / fl;
      const fz = camForward.z / fl;
      const dot = fx * this.lastGrassFwdX + fz * this.lastGrassFwdZ;
      if (dot < 0.996) {
        rotChanged = true;
        this.lastGrassFwdX = fx;
        this.lastGrassFwdZ = fz;
      }
    }

    if (!tileMoved && !rotChanged && !this.grassHasPendingTiles) return;

    this.lastGrassTileX = ptx;
    this.lastGrassTileZ = ptz;
    this.lastGrassMaxRing = maxRing;
    this.lastGrassQualitySig = grassQualitySig;

    let bakedThisCall = 0;
    let missingTiles = 0;
    const matArr = this.grassBladeMesh.instanceMatrix.array as Float32Array;
    const colArr = this.grassBladeMesh.instanceColor!.array as Float32Array;
    const shortMatArr = this.shortGrassMesh.instanceMatrix.array as Float32Array;
    const shortColArr = this.shortGrassMesh.instanceColor!.array as Float32Array;
    const mossMatArr = this.mossCarpetMesh.instanceMatrix.array as Float32Array;
    const mossColArr = this.mossCarpetMesh.instanceColor!.array as Float32Array;
    const tallMatArr = this.tallUndergrowthMesh.instanceMatrix.array as Float32Array;
    const tallColArr = this.tallUndergrowthMesh.instanceColor!.array as Float32Array;
    const grassCap = this.grassCap;
    const shortGrassCap = this.shortGrassCap;
    const mossCarpetCap = this.mossCarpetCap;
    const tallCap = this.tallCap;
    const sortBuf = this.grassRingSortBuf;
    let count = 0;
    let shortCount = 0;
    let mossCount = 0;
    let tallCount = 0;

    const appendShuffledSlab = (
      slab: BakedSlab,
      dstMat: Float32Array,
      dstCol: Float32Array,
      curCount: number,
      cap: number,
      ring: number,
      step: number
    ): number => {
      if (slab.count === 0) return curCount;
      const avail = cap - curCount;
      if (avail <= 0) return curCount;

      // Ring 0 (0-16m): full shuffled density, culling only clumps >2.2m behind camera
      if (ring === 0 && camForward) {
        const fx = camForward.x;
        const fz = camForward.z;
        const srcM = slab.matrices;
        const srcC = slab.colors;
        let outCount = curCount;
        for (let i = 0; i < slab.count && outCount < cap; i++) {
          const mOff = i * 16;
          const gx = srcM[mOff + 12] - camX;
          const gz = srcM[mOff + 14] - camZ;
          if (gx * fx + gz * fz < -1.8 && gx * gx + gz * gz > 4.84) continue;
          const dstM = outCount * 16;
          for (let k = 0; k < 16; k++) dstMat[dstM + k] = srcM[mOff + k];
          const cOff = i * 3;
          const dstC = outCount * 3;
          dstCol[dstC] = srcC[cOff];
          dstCol[dstC + 1] = srcC[cOff + 1];
          dstCol[dstC + 2] = srcC[cOff + 2];
          outCount++;
        }
        return outCount;
      }

      // Pre-shuffled slab: taking floor(count / step) contiguous entries yields 100% stripe-free 2D random thinning!
      const desired = step > 1 ? Math.max(1, Math.floor(slab.count / step)) : slab.count;
      const take = desired <= avail ? desired : avail;
      dstMat.set(take === slab.count ? slab.matrices : slab.matrices.subarray(0, take * 16), curCount * 16);
      dstCol.set(take === slab.count ? slab.colors : slab.colors.subarray(0, take * 3), curCount * 3);
      return curCount + take;
    };

    for (let ring = 0; ring <= maxRing; ring++) {
      sortBuf.length = 0;
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const tx = ptx + dx;
          const tz = ptz + dz;
          const tileCx = (tx + 0.5) * GRASS_TILE_SIZE;
          const tileCz = (tz + 0.5) * GRASS_TILE_SIZE;
          const dSq = (tileCx - camX) * (tileCx - camX) + (tileCz - camZ) * (tileCz - camZ);
          sortBuf.push({ tx, tz, dSq });
        }
      }
      if (sortBuf.length > 1) {
        sortBuf.sort((a, b) => a.dSq - b.dSq);
      }

      const ringStep =
        ring === 0
          ? 1
          : ring === 1
            ? ring1Step
            : ring === 2
              ? ring2Step
              : ring === 3
                ? ring3Step
                : ring4Step;
      const fillerStep = ring <= 1 ? ringStep : Math.min(4, ringStep + 1);

      for (let s = 0; s < sortBuf.length; s++) {
        const tx = sortBuf[s].tx;
        const tz = sortBuf[s].tz;
        const tileCx = (tx + 0.5) * GRASS_TILE_SIZE;
        const tileCz = (tz + 0.5) * GRASS_TILE_SIZE;

        // Custom Frustum Culling on outer grass tiles with generous peripheral padding
        if (ring > 0 && frustumPlanes) {
          const cached = this.grassTileCache.get(`${tx}_${tz}`);
          const cy = cached ? cached.cy : getTerrainHeight(tileCx, tileCz) + 0.5;
          const r = (cached ? cached.r : 11.8) + 3.4;
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

        count = appendShuffledSlab(tile.slab, matArr, colArr, count, grassCap, ring, ringStep);
        shortCount = appendShuffledSlab(
          tile.shortSlab,
          shortMatArr,
          shortColArr,
          shortCount,
          shortGrassCap,
          ring,
          fillerStep
        );
        mossCount = appendShuffledSlab(
          tile.mossSlab,
          mossMatArr,
          mossColArr,
          mossCount,
          mossCarpetCap,
          ring,
          fillerStep
        );
        tallCount = appendShuffledSlab(
          tile.tallSlab,
          tallMatArr,
          tallColArr,
          tallCount,
          tallCap,
          ring,
          ringStep
        );
      }
    }

    this.grassHasPendingTiles = missingTiles > 0;
    this.diagGrassRebuilds++;
    this.grassBladeMesh.count = count;
    commitCompactedInstancedMesh(this.grassBladeMesh);
    this.shortGrassMesh.count = shortCount;
    commitCompactedInstancedMesh(this.shortGrassMesh);
    this.mossCarpetMesh.count = mossCount;
    commitCompactedInstancedMesh(this.mossCarpetMesh);
    this.tallUndergrowthMesh.count = tallCount;
    commitCompactedInstancedMesh(this.tallUndergrowthMesh);
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
    margin = 6.5
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

  /**
   * Temporarily marks all instanced foliage layers visible during boot renderer.compile()
   * so every bark, leaf, bog-pine, reed, and grass shader compiles once up front (0 mid-game stalls!).
   */
  setShaderCompilePreview(enabled: boolean): void {
    const apply = (mesh: THREE.InstancedMesh) => {
      if (enabled) {
        mesh.userData._prevVis = mesh.visible;
        mesh.userData._prevCount = mesh.count;
        mesh.visible = true;
        if (mesh.count === 0) mesh.count = 1;
      } else {
        mesh.visible = Boolean(mesh.userData._prevVis);
        mesh.count = Number(mesh.userData._prevCount ?? 0);
      }
    };
    for (let i = 0; i < this.primaryChunkMeshes.length; i++) {
      apply(this.primaryChunkMeshes[i]);
    }
    for (let i = 0; i < this.pairedFollowers.length; i++) {
      apply(this.pairedFollowers[i].follower);
    }
    apply(this.grassBladeMesh);
    apply(this.shortGrassMesh);
    apply(this.mossCarpetMesh);
    apply(this.tallUndergrowthMesh);
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
    maxRenderDist = 225,
    qualityOpts?: VegetationQualityOptions
  ): void {
    this.windTimeUniform.value = elapsedTime;
    this.windStrengthUniform.value = windStrength;
    if (sunDir) this.sunDirUniform.value.copy(sunDir);
    if (sunColor) this.sunColorUniform.value.copy(sunColor);

    void chunkLods;
    const grassBudget = (qualityOpts?.grassMaxRing ?? 2) >= 3 ? 10 : 5;
    this.updateGrassCarpet(camPos.x, camPos.z, frustumPlanes, camForward, grassBudget, maxRenderDist, qualityOpts);

    const fogDist = Math.max(72, Math.min(264, maxRenderDist));
    const fogChunkCutoffSq = (fogDist + 36) * (fogDist + 36);

    const lod0Dist = qualityOpts?.lod0Dist ?? (this.isLowPowerGpu ? 28 : 36);
    const lod1Dist = qualityOpts?.lod1Dist ?? (this.isLowPowerGpu ? 74 : 92);
    const bushDist = Math.min(qualityOpts?.bushDist ?? 124, fogDist);
    const understoryDist = Math.min(qualityOpts?.understoryDist ?? 86, fogDist);
    const boulderDist = Math.min(qualityOpts?.boulderDist ?? 146, fogDist);
    const bogDist = Math.min(qualityOpts?.bogDist ?? 150, fogDist);

    const bands = computeTreeLodFadeBands(lod0Dist, lod1Dist, fogDist);
    this.lod0InFadeUniforms.start.value = bands.lod0InStart;
    this.lod0InFadeUniforms.end.value = bands.lod0InEnd;
    this.lod0OutFadeUniforms.start.value = bands.lod0OutStart;
    this.lod0OutFadeUniforms.end.value = bands.lod0OutEnd;
    this.lod1InFadeUniforms.start.value = bands.lod1InStart;
    this.lod1InFadeUniforms.end.value = bands.lod1InEnd;
    this.lod1OutFadeUniforms.start.value = bands.lod1OutStart;
    this.lod1OutFadeUniforms.end.value = bands.lod1OutEnd;
    this.treeFadeUniforms.start.value = bands.treeFadeStart;
    this.treeFadeUniforms.end.value = bands.treeFadeEnd;

    const treeFadeEnd = bands.treeFadeEnd;
    const bogFadeEnd = Math.min(bogDist, treeFadeEnd);
    this.bogFadeUniforms.end.value = bogFadeEnd;
    this.bogFadeUniforms.start.value = Math.max(24, bogFadeEnd - 36);

    const bushFadeEnd = Math.min(bushDist, treeFadeEnd);
    this.bushFadeUniforms.end.value = bushFadeEnd;
    this.bushFadeUniforms.start.value = Math.max(20, bushFadeEnd - 36);

    const underFadeEnd = Math.min(understoryDist, treeFadeEnd);
    this.underFadeUniforms.end.value = underFadeEnd;
    this.underFadeUniforms.start.value = Math.max(16, underFadeEnd - 32);

    const boulderFadeEnd = Math.min(boulderDist, treeFadeEnd);
    this.boulderFadeUniforms.end.value = boulderFadeEnd;
    this.boulderFadeUniforms.start.value = Math.max(22, boulderFadeEnd - 34);

    const qualitySig = `${Math.round(lod0Dist)}_${Math.round(lod1Dist)}_${Math.round(bushDist)}_${Math.round(understoryDist)}_${Math.round(boulderDist)}_${Math.round(bogDist)}`;

    // Build chunk slot signature using distance & world-bounds (independent of ground-only chunkLods culling!)
    let sig = '';
    for (let c = 0; c < CHUNK_COUNT; c++) {
      const sb = c * 4;
      if (chunkSpheres[sb + 1] > 9000) continue;
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
      // Re-cull whenever camera turns > ~2.3 degrees to eliminate peripheral edge popping
      rotDirty = fwdX * this.lastCullFwdX + fwdZ * this.lastCullFwdZ < 0.9992;
    }
    const moveSq =
      (camPos.x - this.lastCullCamX) * (camPos.x - this.lastCullCamX) +
      (camPos.z - this.lastCullCamZ) * (camPos.z - this.lastCullCamZ);
    const fogDirty = Math.abs(fogDist - this.lastFogCullDist) > 4;
    const qualityDirty = qualitySig !== this.lastQualitySig;

    if (
      !this.forceVisRebuild &&
      sig === this.lastVisibilitySig &&
      moveSq < 0.5 &&
      !rotDirty &&
      !fogDirty &&
      !qualityDirty
    ) {
      if (stats) {
        stats.treesRendered = this.cachedTreesCount;
        stats.foliageRendered =
          this.cachedFoliageCount +
          this.grassBladeMesh.count +
          this.shortGrassMesh.count +
          this.mossCarpetMesh.count +
          this.tallUndergrowthMesh.count;
        stats.culledInstances = this.cachedCulledCount;
        stats.candidateInstances = this.cachedCandidateCount;
      }
      return;
    }

    this.forceVisRebuild = false;
    this.lastVisibilitySig = sig;
    this.lastCullCamX = camPos.x;
    this.lastCullCamZ = camPos.z;
    this.lastCullFwdX = fwdX;
    this.lastCullFwdZ = fwdZ;
    this.lastFogCullDist = fogDist;
    this.lastQualitySig = qualitySig;
    this.diagVisRebuilds++;

    for (let i = 0; i < this.primaryChunkMeshes.length; i++) {
      this.primaryChunkMeshes[i].count = 0;
    }

    // Pad 24x24m sub-cell inclusion by +22m past LOD crossfade & fade bands so both LODs overlap smoothly without popping
    const lod0MaxDist = bands.lod0OutEnd + 22;
    const lod0MaxSq = lod0MaxDist * lod0MaxDist;
    const lod1MinDist = Math.max(0, bands.lod0InStart - 22);
    const lod1MinSq = lod1MinDist * lod1MinDist;
    const lod1MaxDist = bands.lod1OutEnd + 22;
    const lod1MaxSq = lod1MaxDist * lod1MaxDist;
    const lod2MinDist = Math.max(0, bands.lod1InStart - 22);
    const lod2MinSq = lod2MinDist * lod2MinDist;

    const fogCellSq = (treeFadeEnd + 22) * (treeFadeEnd + 22);
    const bogDistSq = (bogFadeEnd + 22) * (bogFadeEnd + 22);
    const bushDistSq = (bushFadeEnd + 22) * (bushFadeEnd + 22);
    const underDistSq = (underFadeEnd + 22) * (underFadeEnd + 22);
    const boulderDistSq = (boulderFadeEnd + 22) * (boulderFadeEnd + 22);

    let candidateInstances = 0;
    let renderedInstances = 0;

    for (let c = 0; c < CHUNK_COUNT; c++) {
      const sb = c * 4;
      if (chunkSpheres[sb + 1] > 9000) continue;

      const cdx = chunkSpheres[sb] - camPos.x;
      const cdz = chunkSpheres[sb + 2] - camPos.z;
      if (cdx * cdx + cdz * cdz > fogChunkCutoffSq) continue;

      // Tier 1: Chunk-level crown-padded frustum test (independent of terrain ground-only chunkLods culling!)
      if (
        frustumPlanes &&
        !sphereIntersectsFrustum(
          frustumPlanes,
          chunkSpheres[sb],
          chunkSpheres[sb + 1] + 6.5,
          chunkSpheres[sb + 2],
          chunkSpheres[sb + 3] + 10.5
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
            cell.r + 6.5
          );
          if (cellStatus === FrustumCullStatus.OUTSIDE) continue;
        }

        if (dSq <= lod0MaxSq) {
          renderedInstances += this.appendSlabSmart(cell.birch, this.birchTrunk0, CAP_LOD0, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.pine, this.pineTrunk0, CAP_LOD0, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.spruce, this.spruceTrunk0, CAP_LOD0, cellStatus, frustumPlanes);
        }
        if (dSq >= lod1MinSq && dSq <= lod1MaxSq) {
          renderedInstances += this.appendSlabSmart(cell.birch, this.birchTrunk1, CAP_LOD1, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.pine, this.pineTrunk1, CAP_LOD1, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.spruce, this.spruceTrunk1, CAP_LOD1, cellStatus, frustumPlanes);
        }
        if (dSq >= lod2MinSq) {
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
          renderedInstances += this.appendSlabSmart(cell.sapling, this.saplingTrunkMesh, CAP_SAPLING, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.deadfall, this.deadfallMesh, CAP_DEADFALL, cellStatus, frustumPlanes);
        }
        if (dSq < underDistSq) {
          renderedInstances += this.appendSlabSmart(cell.mossHummock, this.mossHummockMesh, CAP_MOSS, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.fern, this.fernMesh, CAP_FERN, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.shrub, this.shrubMesh, CAP_SHRUB, cellStatus, frustumPlanes);
        }
        if (dSq < boulderDistSq) {
          renderedInstances += this.appendSlabSmart(cell.boulder, this.boulderMesh, CAP_BOULDER, cellStatus, frustumPlanes);
          renderedInstances += this.appendSlabSmart(cell.boulderOutcrop, this.boulderOutcropMesh, CAP_BOULDER, cellStatus, frustumPlanes);
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
      this.saplingTrunkMesh.count +
      this.hazelStemMesh.count +
      this.juniperMesh.count;

    this.cachedFoliageCount =
      this.fernMesh.count +
      this.shrubMesh.count +
      this.mossHummockMesh.count +
      this.reedMesh.count +
      this.boulderMesh.count +
      this.boulderOutcropMesh.count +
      this.deadfallMesh.count;

    this.cachedCandidateCount = candidateInstances;
    this.cachedCulledCount = Math.max(0, candidateInstances - renderedInstances);

    if (stats) {
      stats.treesRendered = this.cachedTreesCount;
      stats.foliageRendered =
        this.cachedFoliageCount +
        this.grassBladeMesh.count +
        this.shortGrassMesh.count +
        this.mossCarpetMesh.count +
        this.tallUndergrowthMesh.count;
      stats.culledInstances = this.cachedCulledCount;
      stats.candidateInstances = this.cachedCandidateCount;
    }
  }

  findTargetDeadfall(
    camPos: THREE.Vector3,
    camDir: THREE.Vector3,
    maxDist = 4.8
  ): DeadfallLogTarget | null {
    const baseVcx = Math.floor(camPos.x / CHUNK_SIZE);
    const baseVcz = Math.floor(camPos.z / CHUNK_SIZE);
    let best: DeadfallLogTarget | null = null;
    let bestProj = maxDist + 1;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.chunkCache.get(`${baseVcx + dx}_${baseVcz + dz}`);
        if (!bucket || bucket.deadfallLogs.length === 0) continue;
        const logs = bucket.deadfallLogs;
        for (let i = 0; i < logs.length; i++) {
          const log = logs[i];
          if (log.broken) continue;
          // Quick bounding distance check (log half-length = 2.2 * scale)
          const approxDx = log.x - camPos.x;
          const approxDz = log.z - camPos.z;
          const reach = maxDist + 2.4 * log.scale;
          if (approxDx * approxDx + approxDz * approxDz > reach * reach) continue;

          // Sample 5 points along the 4.4m fallen log spine in world space
          const ax = Math.cos(log.rotY) * 2.1 * log.scale;
          const az = -Math.sin(log.rotY) * 2.1 * log.scale;
          const ly = log.y + 0.2 * log.scale;
          const hitRadiusSq = (0.64 * log.scale) * (0.64 * log.scale);

          for (let s = -2; s <= 2; s++) {
            const frac = s * 0.45;
            const px = log.x + ax * frac;
            const pz = log.z + az * frac;
            const vx = px - camPos.x;
            const vy = ly - camPos.y;
            const vz = pz - camPos.z;
            const proj = vx * camDir.x + vy * camDir.y + vz * camDir.z;
            if (proj < 0.25 || proj > maxDist || proj >= bestProj) continue;
            const rx = vx - camDir.x * proj;
            const ry = vy - camDir.y * proj;
            const rz = vz - camDir.z * proj;
            if (rx * rx + ry * ry + rz * rz <= hitRadiusSq) {
              bestProj = proj;
              best = log;
            }
          }
        }
      }
    }
    return best;
  }

  getNearestDeadfall(px: number, pz: number): DeadfallLogTarget | null {
    const baseVcx = Math.floor(px / CHUNK_SIZE);
    const baseVcz = Math.floor(pz / CHUNK_SIZE);
    let best: DeadfallLogTarget | null = null;
    let bestSq = Infinity;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const bucket = this.getOrBakeChunk(baseVcx + dx, baseVcz + dz);
        for (let i = 0; i < bucket.deadfallLogs.length; i++) {
          const log = bucket.deadfallLogs[i];
          if (log.broken) continue;
          const dSq = (log.x - px) * (log.x - px) + (log.z - pz) * (log.z - pz);
          if (dSq < bestSq) {
            bestSq = dSq;
            best = log;
          }
        }
      }
    }
    return best;
  }

  kickDeadfall(
    id: string
  ): { hit: boolean; broken: boolean; x: number; y: number; z: number; rotY: number; scale: number } | null {
    const parts = id.split('_');
    if (parts.length < 3) return null;
    const key = `${parts[0]}_${parts[1]}`;
    const bucket = this.chunkCache.get(key);
    if (!bucket) return null;
    const log = bucket.deadfallLogs.find((l) => l.id === id);
    if (!log || log.broken) return null;

    log.kicksRemaining -= 1;
    this.deadfallKicksRemaining.set(id, log.kicksRemaining);
    const slab = bucket.cells[log.cellIdx]?.deadfall;

    if (log.kicksRemaining > 0) {
      // First kick cracks & jolts the fallen log
      log.rotY += 0.12;
      if (slab && log.slabIdx < slab.count) {
        _bakeDummy.position.set(log.x, log.y + 0.03, log.z);
        _bakeDummy.rotation.set(0.06, log.rotY, 0.1);
        _bakeDummy.scale.setScalar(log.scale);
        _bakeDummy.updateMatrix();
        _bakeDummy.matrix.toArray(slab.matrices, log.slabIdx * 16);
      }
      this.forceVisRebuild = true;
      return {
        hit: true,
        broken: false,
        x: log.x,
        y: log.y,
        z: log.z,
        rotY: log.rotY,
        scale: log.scale,
      };
    }

    // Second kick shatters the fallen log completely
    log.broken = true;
    this.brokenDeadfallIds.add(id);
    this.deadfallKicksRemaining.delete(id);
    if (slab && log.slabIdx < slab.count) {
      const mOff = log.slabIdx * 16;
      for (let k = 0; k < 16; k++) slab.matrices[mOff + k] = 0;
      slab.bounds[log.slabIdx * 4 + 3] = 0;
    }
    this.forceVisRebuild = true;
    return {
      hit: true,
      broken: true,
      x: log.x,
      y: log.y,
      z: log.z,
      rotY: log.rotY,
      scale: log.scale,
    };
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
      grassCount:
        this.grassBladeMesh.count +
        this.shortGrassMesh.count +
        this.mossCarpetMesh.count +
        this.tallUndergrowthMesh.count,
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
