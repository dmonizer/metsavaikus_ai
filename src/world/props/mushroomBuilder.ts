import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MUSHROOM_SPECIES_INFO, MushroomSpecies } from '../../game/gameLogic';
import { getMushroomCopy, t } from '../../i18n/i18n';
import { sphereIntersectsFrustum } from '../forestFrustumCuller';
import { PointSpatialIndex } from '../pointSpatialIndex';
import { createSeededRandom } from '../seededRandom';
import {
  SWAMP_WATER_Y,
  WORLD_HALF,
  clamp,
  distToRoadDetail,
  getActiveBlueprint,
  getDistanceToNearestVillage,
  getNearestSwampIsland,
  getSwampFactor,
  getTerrainHeight,
  roadCenterX,
} from '../terrainMath';
import { prepNonIndexed } from './propMaterials';
import { InteractiveEntry, PropBuildContext } from './propTypes';

const seededRand = (seed: number) => createSeededRandom(seed, 0x517cc1b7);

export interface MushroomSystem {
  mushroomCountTotal: number;
  heroMushroomPos: { x: number; z: number } | null;
  spawnMushroom: (x: number, z: number, species: MushroomSpecies) => void;
  gatherMushroom: (entry: InteractiveEntry) => MushroomSpecies | null;
  updateVisibility: (
    camX: number,
    camZ: number,
    mushroomDist: number,
    frustumPlanes?: Float32Array
  ) => void;
  clear: () => void;
}

export function createMushroomSystem(ctx: PropBuildContext): MushroomSystem {
  const bp = getActiveBlueprint();
  const mushroomIndex = new PointSpatialIndex<InteractiveEntry>();
  const nearbyMushrooms: InteractiveEntry[] = [];
  const visibleMushrooms: InteractiveEntry[] = [];

  const chanterelleMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.chanterelleTex,
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.0,
    envMapIntensity: 0.72,
  });
  const saffronCapMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.saffronCapTex,
    roughness: 0.34,
    metalness: 0.0,
    envMapIntensity: 0.78,
  });
  const porciniCapMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.boleteCap,
    normalMap: ctx.textures.boleteNormal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    color: 0xd4966c,
    roughness: 0.3,
    metalness: 0.0,
    envMapIntensity: 0.85,
  });
  const porciniStemMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.boleteStem,
    roughness: 0.74,
    metalness: 0.0,
    envMapIntensity: 0.5,
  });
  const birchBoleteCapMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.boleteCap,
    normalMap: ctx.textures.boleteNormal,
    normalScale: new THREE.Vector2(0.65, 0.65),
    color: 0xbda38a,
    roughness: 0.36,
    metalness: 0.0,
    envMapIntensity: 0.75,
  });
  const birchBoleteStemMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.birchBoleteStem,
    roughness: 0.78,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });
  const boletePoreMat = new THREE.MeshStandardMaterial({
    color: 0xdccda4,
    roughness: 0.88,
    metalness: 0.0,
  });
  const bitterCapMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.boleteCap,
    normalMap: ctx.textures.boleteNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    color: 0x9c8260,
    roughness: 0.38,
    metalness: 0.0,
  });
  const bitterPoreMat = new THREE.MeshStandardMaterial({
    color: 0xdca0a4,
    roughness: 0.84,
    metalness: 0.0,
  });
  const flyAgaricCapMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.flyAgaricCap,
    normalMap: ctx.textures.flyAgaricNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.24,
    metalness: 0.02,
    envMapIntensity: 1.0,
  });
  const destroyingAngelCapMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.destroyingAngelCap,
    roughness: 0.22,
    metalness: 0.02,
    envMapIntensity: 0.95,
  });
  const amanitaGillsMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.amanitaGills,
    roughness: 0.72,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const amanitaStemMat = new THREE.MeshStandardMaterial({
    color: 0xf6f3ea,
    roughness: 0.68,
    metalness: 0.0,
    envMapIntensity: 0.55,
  });
  const amanitaWartMat = new THREE.MeshStandardMaterial({
    color: 0xf2ead6,
    roughness: 0.82,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });

  const mushShadowMat = new THREE.MeshBasicMaterial({
    map: ctx.textures.contactShadowTex,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const hitProxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitProxyGeo = new THREE.SphereGeometry(0.32, 6, 6);
  const mushShadowGeo = new THREE.PlaneGeometry(0.46, 0.46);
  mushShadowGeo.rotateX(-Math.PI / 2);
  mushShadowGeo.translate(0, 0.012, 0);

  ctx.resources.own(
    chanterelleMat,
    saffronCapMat,
    porciniCapMat,
    porciniStemMat,
    birchBoleteCapMat,
    birchBoleteStemMat,
    boletePoreMat,
    bitterCapMat,
    bitterPoreMat,
    flyAgaricCapMat,
    destroyingAngelCapMat,
    amanitaGillsMat,
    amanitaStemMat,
    amanitaWartMat,
    mushShadowMat,
    hitProxyMat,
    hitProxyGeo,
    mushShadowGeo
  );

  const chanterelleBodyGeo = (() => {
    const funnelPts = [
      new THREE.Vector2(0.0, 0.02),
      new THREE.Vector2(0.017, 0.0),
      new THREE.Vector2(0.023, 0.058),
      new THREE.Vector2(0.056, 0.115),
      new THREE.Vector2(0.098, 0.142),
      new THREE.Vector2(0.082, 0.148),
      new THREE.Vector2(0.032, 0.12),
      new THREE.Vector2(0.0, 0.106),
    ];
    const g = prepNonIndexed(new THREE.LatheGeometry(funnelPts, 16));
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const stemCol = new THREE.Color(0xf4d478);
    const rimCol = new THREE.Color(0xee9c1a);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const r = Math.hypot(px, pz);
      if (r > 0.038 && py > 0.095) {
        const ang = Math.atan2(pz, px);
        const wave = Math.sin(ang * 5.0) * 0.018 + Math.cos(ang * 3.0) * 0.01;
        pos.setY(i, py + wave * (r / 0.098));
      }
      const tPos = clamp((py - 0.015) / 0.13, 0, 1);
      cols[i * 3] = stemCol.r + (rimCol.r - stemCol.r) * tPos;
      cols[i * 3 + 1] = stemCol.g + (rimCol.g - stemCol.g) * tPos;
      cols[i * 3 + 2] = stemCol.b + (rimCol.b - stemCol.b) * tPos;
    }
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  })();

  const saffronBodyGeo = (() => {
    const pts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.024, 0.0),
      new THREE.Vector2(0.026, 0.092),
      new THREE.Vector2(0.114, 0.104),
      new THREE.Vector2(0.128, 0.126),
      new THREE.Vector2(0.064, 0.132),
      new THREE.Vector2(0.0, 0.114),
    ];
    const g = prepNonIndexed(new THREE.LatheGeometry(pts, 16));
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = clamp(pos.getX(i) / 0.26 + 0.5, 0, 1);
      uvs[i * 2 + 1] = clamp(pos.getZ(i) / 0.26 + 0.5, 0, 1);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return g;
  })();

  const porciniStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.056, 0.0),
      new THREE.Vector2(0.078, 0.055),
      new THREE.Vector2(0.06, 0.118),
      new THREE.Vector2(0.046, 0.158),
      new THREE.Vector2(0.0, 0.158),
    ],
    16
  );
  const porciniCapGeo = (() => {
    const g = new THREE.SphereGeometry(0.138, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
    g.scale(1.0, 0.78, 1.0);
    g.translate(0, 0.136, 0);
    return g;
  })();
  const porciniPoreGeo = (() => {
    const g = new THREE.SphereGeometry(0.132, 16, 6, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48);
    g.scale(1.0, 0.18, 1.0);
    g.translate(0, 0.136, 0);
    return g;
  })();

  const birchBoleteStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.038, 0.0),
      new THREE.Vector2(0.032, 0.09),
      new THREE.Vector2(0.024, 0.185),
      new THREE.Vector2(0.0, 0.185),
    ],
    14
  );
  const birchBoleteCapGeo = (() => {
    const g = new THREE.SphereGeometry(0.108, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58);
    g.scale(1.0, 0.82, 1.0);
    g.translate(0, 0.165, 0);
    return g;
  })();
  const birchBoletePoreGeo = (() => {
    const g = new THREE.CircleGeometry(0.104, 14);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.164, 0);
    return g;
  })();

  const flyAgaricStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.052, 0.0),
      new THREE.Vector2(0.064, 0.028),
      new THREE.Vector2(0.056, 0.048),
      new THREE.Vector2(0.044, 0.056),
      new THREE.Vector2(0.032, 0.078),
      new THREE.Vector2(0.027, 0.148),
      new THREE.Vector2(0.054, 0.136),
      new THREE.Vector2(0.048, 0.158),
      new THREE.Vector2(0.025, 0.172),
      new THREE.Vector2(0.024, 0.232),
      new THREE.Vector2(0.0, 0.232),
    ],
    16
  );

  const flyAgaricCapGeo = (() => {
    const g = prepNonIndexed(
      new THREE.SphereGeometry(0.138, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.54)
    );
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const ang = Math.atan2(pz, px);
      const rFrac = Math.hypot(px, pz) / 0.138;
      const rimWave = Math.sin(ang * 4.0 + 0.5) * 0.0045 * rFrac * rFrac;
      pos.setY(i, py * 0.62 + 0.214 + rimWave);
      uvs[i * 2] = clamp(px / (0.138 * 2.02) + 0.5, 0.01, 0.99);
      uvs[i * 2 + 1] = clamp(pz / (0.138 * 2.02) + 0.5, 0.01, 0.99);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  })();

  const flyAgaricGillsGeo = (() => {
    const g = new THREE.CircleGeometry(0.134, 20);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.213, 0);
    return g;
  })();

  const flyAgaricWartsGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const wr = seededRand(777);
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const nVec = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      const phi = Math.acos(1 - ((i + 0.45) / 24) * 0.78);
      const theta = i * 2.39996 + wr() * 0.28;
      const rad = 0.138;
      const wx = Math.sin(phi) * Math.cos(theta) * rad;
      const wy = Math.cos(phi) * rad * 0.62 + 0.214;
      const wz = Math.sin(phi) * Math.sin(theta) * rad;
      nVec.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi) / 0.62, Math.sin(phi) * Math.sin(theta)).normalize();
      q.setFromUnitVectors(up, nVec);

      const sz = (0.008 + wr() * 0.007) * (1.15 - phi * 0.35);
      const pebble = new THREE.IcosahedronGeometry(sz, 0);
      pebble.scale(1.15 + wr() * 0.45, 0.44 + wr() * 0.18, 0.95 + wr() * 0.4);
      pebble.applyQuaternion(q);
      pebble.translate(wx, wy, wz);
      parts.push(prepNonIndexed(pebble));
    }
    return mergeGeometries(parts)!;
  })();

  const flyAgaricButtonCapGeo = (() => {
    const g = prepNonIndexed(new THREE.SphereGeometry(0.068, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.74));
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      pos.setY(i, py * 0.95 + 0.088);
      uvs[i * 2] = clamp(px / 0.15 + 0.5, 0.02, 0.98);
      uvs[i * 2 + 1] = clamp(pz / 0.15 + 0.5, 0.02, 0.98);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  })();
  const flyAgaricButtonStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.056, 0.0),
      new THREE.Vector2(0.062, 0.042),
      new THREE.Vector2(0.052, 0.072),
      new THREE.Vector2(0.036, 0.095),
      new THREE.Vector2(0.0, 0.095),
    ],
    14
  );

  const destroyingAngelStemGeo = (() => {
    const g = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.046, 0.0),
        new THREE.Vector2(0.056, 0.036),
        new THREE.Vector2(0.058, 0.076),
        new THREE.Vector2(0.042, 0.072),
        new THREE.Vector2(0.026, 0.056),
        new THREE.Vector2(0.022, 0.175),
        new THREE.Vector2(0.044, 0.168),
        new THREE.Vector2(0.038, 0.194),
        new THREE.Vector2(0.018, 0.205),
        new THREE.Vector2(0.017, 0.278),
        new THREE.Vector2(0.0, 0.278),
      ],
      22
    );
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      if (py > 0.078 && py < 0.265) {
        const px = pos.getX(i);
        const pz = pos.getZ(i);
        const ang = Math.atan2(pz, px);
        const shag = 1.0 + Math.sin(py * 95.0 + ang * 3.0) * 0.05;
        pos.setX(i, px * shag);
        pos.setZ(i, pz * shag);
      }
    }
    g.computeVertexNormals();
    return g;
  })();

  const destroyingAngelCapGeo = (() => {
    const pts = [
      new THREE.Vector2(0.112, 0.236),
      new THREE.Vector2(0.106, 0.252),
      new THREE.Vector2(0.088, 0.285),
      new THREE.Vector2(0.062, 0.326),
      new THREE.Vector2(0.034, 0.354),
      new THREE.Vector2(0.012, 0.368),
      new THREE.Vector2(0.0, 0.371),
    ];
    const g = new THREE.LatheGeometry(pts, 28);
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const ang = Math.atan2(pz, px);
      const rFrac = Math.hypot(px, pz) / 0.112;
      const tilt = Math.sin(ang + 0.8) * 0.01 * rFrac;
      const lobe = Math.cos(ang * 3.0) * 0.005 * rFrac * rFrac;
      pos.setY(i, py + tilt + lobe);
      uvs[i * 2] = clamp(px / 0.23 + 0.5, 0.01, 0.99);
      uvs[i * 2 + 1] = clamp(pz / 0.23 + 0.5, 0.01, 0.99);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  })();

  const destroyingAngelGillsGeo = (() => {
    const g = new THREE.CircleGeometry(0.109, 18);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.242, 0);
    return g;
  })();

  ctx.resources.own(
    chanterelleBodyGeo,
    saffronBodyGeo,
    porciniStemGeo,
    porciniCapGeo,
    porciniPoreGeo,
    birchBoleteStemGeo,
    birchBoleteCapGeo,
    birchBoletePoreGeo,
    flyAgaricStemGeo,
    flyAgaricCapGeo,
    flyAgaricGillsGeo,
    flyAgaricWartsGeo,
    flyAgaricButtonCapGeo,
    flyAgaricButtonStemGeo,
    destroyingAngelStemGeo,
    destroyingAngelCapGeo,
    destroyingAngelGillsGeo
  );

  let mushroomCountTotal = 0;

  function spawnMushroom(x: number, z: number, species: MushroomSpecies): void {
    const y = getTerrainHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);

    const padMesh = new THREE.Mesh(mushShadowGeo, mushShadowMat);
    g.add(padMesh);

    if (species === 'kukeseen' || species === 'kuuseriisikas') {
      const baseGeo = species === 'kukeseen' ? chanterelleBodyGeo : saffronBodyGeo;
      const mat = species === 'kukeseen' ? chanterelleMat : saffronCapMat;
      const count = species === 'kukeseen' ? 6 : 3;
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < count; i++) {
        const clone = baseGeo.clone();
        const s = i === 0 ? 1.18 : 0.68 + ctx.rand() * 0.42;
        const ang = (i / count) * Math.PI * 2 + ctx.rand() * 0.6;
        const off = i === 0 ? 0 : 0.08 + ctx.rand() * 0.11;
        clone.scale(s, s, s);
        clone.rotateX((ctx.rand() - 0.5) * 0.16);
        clone.rotateZ((ctx.rand() - 0.5) * 0.16);
        clone.rotateY(ctx.rand() * Math.PI * 2);
        clone.translate(Math.cos(ang) * off, 0, Math.sin(ang) * off);
        parts.push(clone);
      }
      const clusterGeo = mergeGeometries(parts)!;
      ctx.resources.own(clusterGeo);
      const m = new THREE.Mesh(clusterGeo, mat);
      m.castShadow = ctx.shadows;
      m.receiveShadow = true;
      g.add(m);
    } else if (species === 'punakarbseseen') {
      const stemParts: THREE.BufferGeometry[] = [];
      const capParts: THREE.BufferGeometry[] = [];
      const gillParts: THREE.BufferGeometry[] = [];
      const wartParts: THREE.BufferGeometry[] = [];

      const specs = [
        { s: 1.22, off: 0, ang: 0, isButton: false },
        { s: 0.84, off: 0.17, ang: ctx.rand() * Math.PI * 2, isButton: false },
        { s: 0.95, off: 0.14, ang: ctx.rand() * Math.PI * 2 + 2.2, isButton: true },
      ];
      for (const sp of specs) {
        const rx = (ctx.rand() - 0.5) * 0.1;
        const ry = ctx.rand() * Math.PI * 2;
        const rz = (ctx.rand() - 0.5) * 0.1;
        const dx = Math.cos(sp.ang) * sp.off;
        const dz = Math.sin(sp.ang) * sp.off;
        const xf = (src: THREE.BufferGeometry) => {
          const c = prepNonIndexed(src.clone());
          c.scale(sp.s, sp.s, sp.s);
          c.rotateX(rx);
          c.rotateZ(rz);
          c.rotateY(ry);
          c.translate(dx, 0, dz);
          return c;
        };
        if (sp.isButton) {
          stemParts.push(xf(flyAgaricButtonStemGeo));
          capParts.push(xf(flyAgaricButtonCapGeo));
        } else {
          stemParts.push(xf(flyAgaricStemGeo));
          capParts.push(xf(flyAgaricCapGeo));
          gillParts.push(xf(flyAgaricGillsGeo));
          wartParts.push(xf(flyAgaricWartsGeo));
        }
      }
      const mStem = mergeGeometries(stemParts)!;
      const mCap = mergeGeometries(capParts)!;
      const mGills = mergeGeometries(gillParts)!;
      const mWarts = mergeGeometries(wartParts)!;
      ctx.resources.own(mStem, mCap, mGills, mWarts);
      const capMesh = new THREE.Mesh(mCap, flyAgaricCapMat);
      capMesh.castShadow = ctx.shadows;
      capMesh.receiveShadow = true;
      g.add(
        new THREE.Mesh(mStem, amanitaStemMat),
        capMesh,
        new THREE.Mesh(mGills, amanitaGillsMat),
        new THREE.Mesh(mWarts, amanitaWartMat)
      );
    } else if (species === 'valgekarbseseen') {
      const stemParts: THREE.BufferGeometry[] = [];
      const capParts: THREE.BufferGeometry[] = [];
      const gillParts: THREE.BufferGeometry[] = [];

      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1.16 : 0.76 + ctx.rand() * 0.18;
        const ang = ctx.rand() * Math.PI * 2;
        const off = i === 0 ? 0 : 0.14 + ctx.rand() * 0.06;
        const rx = (ctx.rand() - 0.5) * 0.11;
        const ry = ctx.rand() * Math.PI * 2;
        const rz = (ctx.rand() - 0.5) * 0.11;
        const dx = Math.cos(ang) * off;
        const dz = Math.sin(ang) * off;
        const xf = (src: THREE.BufferGeometry) => {
          const c = prepNonIndexed(src.clone());
          c.scale(s, s, s);
          c.rotateX(rx);
          c.rotateZ(rz);
          c.rotateY(ry);
          c.translate(dx, 0, dz);
          return c;
        };
        stemParts.push(xf(destroyingAngelStemGeo));
        capParts.push(xf(destroyingAngelCapGeo));
        gillParts.push(xf(destroyingAngelGillsGeo));
      }
      const mStem = mergeGeometries(stemParts)!;
      const mCap = mergeGeometries(capParts)!;
      const mGills = mergeGeometries(gillParts)!;
      ctx.resources.own(mStem, mCap, mGills);
      const capMesh = new THREE.Mesh(mCap, destroyingAngelCapMat);
      capMesh.castShadow = ctx.shadows;
      capMesh.receiveShadow = true;
      g.add(
        new THREE.Mesh(mStem, amanitaStemMat),
        capMesh,
        new THREE.Mesh(mGills, amanitaGillsMat)
      );
    } else {
      const isBirch = species === 'kasepuravik';
      const isBitter = species === 'sapipuravik';
      const stemGeo = isBirch ? birchBoleteStemGeo : porciniStemGeo;
      const capGeo = isBirch ? birchBoleteCapGeo : porciniCapGeo;
      const poreGeo = isBirch ? birchBoletePoreGeo : porciniPoreGeo;
      const stemMat = isBirch ? birchBoleteStemMat : porciniStemMat;
      const capMat = isBitter ? bitterCapMat : isBirch ? birchBoleteCapMat : porciniCapMat;
      const poreMat = isBitter ? bitterPoreMat : boletePoreMat;

      const stemParts: THREE.BufferGeometry[] = [];
      const capParts: THREE.BufferGeometry[] = [];
      const poreParts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1.18 : 0.68 + ctx.rand() * 0.24;
        const ang = ctx.rand() * Math.PI * 2;
        const off = i === 0 ? 0 : 0.12 + ctx.rand() * 0.06;
        const rx = (ctx.rand() - 0.5) * 0.12;
        const ry = ctx.rand() * Math.PI * 2;
        const rz = (ctx.rand() - 0.5) * 0.12;
        const dx = Math.cos(ang) * off;
        const dz = Math.sin(ang) * off;
        const xf = (src: THREE.BufferGeometry) => {
          const c = prepNonIndexed(src.clone());
          c.scale(s, s, s);
          c.rotateX(rx);
          c.rotateZ(rz);
          c.rotateY(ry);
          c.translate(dx, 0, dz);
          return c;
        };
        stemParts.push(xf(stemGeo));
        capParts.push(xf(capGeo));
        poreParts.push(xf(poreGeo));
      }
      const mStem = mergeGeometries(stemParts)!;
      const mCap = mergeGeometries(capParts)!;
      const mPore = mergeGeometries(poreParts)!;
      ctx.resources.own(mStem, mCap, mPore);
      const capMesh = new THREE.Mesh(mCap, capMat);
      capMesh.castShadow = ctx.shadows;
      capMesh.receiveShadow = true;
      g.add(new THREE.Mesh(mStem, stemMat), capMesh, new THREE.Mesh(mPore, poreMat));
    }

    const hitProxy = new THREE.Mesh(hitProxyGeo, hitProxyMat);
    hitProxy.position.y = 0.16;
    g.add(hitProxy);

    ctx.resources.add(g);
    mushroomCountTotal++;

    const info = MUSHROOM_SPECIES_INFO[species];
    const getMushroomTitle = () => {
      const copy = getMushroomCopy(species);
      const tag =
        info.edibility === 'poisonous'
          ? t('prop.mushroomTagPoison')
          : info.edibility === 'inedible'
            ? t('prop.mushroomTagInedible')
            : '';
      return `${copy.name}${tag}`;
    };
    const entry = ctx.registerInteractive(g, {
      name: getMushroomTitle(),
      desc: getMushroomCopy(species).note,
      getName: getMushroomTitle,
      getDesc: () => getMushroomCopy(species).note,
      gatherable: true,
      species,
      carryable: false,
      kickable: false,
      radius: 0.18,
      onTouch: () => {
        const copy = getMushroomCopy(species);
        ctx.showToast(`${copy.name}: ${copy.note}`);
      },
    });
    g.userData.debugLayer = 'mushroom';
    g.userData.debugName = MUSHROOM_SPECIES_INFO[species].estonian;
    g.userData.debugMeta = { species, edibility: MUSHROOM_SPECIES_INFO[species].edibility };
    g.visible = false;
    mushroomIndex.set(entry, x, z);
  }

  const allSpecies: MushroomSpecies[] = [
    'kukeseen',
    'kivipuravik',
    'kasepuravik',
    'kuuseriisikas',
    'sapipuravik',
    'punakarbseseen',
    'valgekarbseseen',
  ];

  const pickWeightedSpecies = (): MushroomSpecies => {
    const r = ctx.rand();
    if (r < 0.24) return 'kukeseen';
    if (r < 0.42) return 'kivipuravik';
    if (r < 0.57) return 'kasepuravik';
    if (r < 0.72) return 'kuuseriisikas';
    if (r < 0.83) return 'sapipuravik';
    if (r < 0.93) return 'punakarbseseen';
    return 'valgekarbseseen';
  };

  for (const isl of bp.swampIslands) {
    for (let k = 0; k < 3; k++) {
      const a = ctx.rand() * Math.PI * 2;
      const rad = 4.2 + ctx.rand() * Math.max(2, isl.radius - 5.5);
      const mx = isl.x + Math.cos(a) * rad;
      const mz = isl.z + Math.sin(a) * rad;
      if (getTerrainHeight(mx, mz) > SWAMP_WATER_Y + 0.18) {
        spawnMushroom(mx, mz, pickWeightedSpecies());
      }
    }
  }

  let heroMushroomPos: { x: number; z: number } | null = null;
  const gladeZ = 24.5;
  const gladeBaseX = roadCenterX(gladeZ) - 11.5;
  const starterOffsets: Array<[number, number, MushroomSpecies]> = [
    [gladeBaseX, gladeZ, 'punakarbseseen'],
    [gladeBaseX + 0.68, gladeZ - 0.35, 'valgekarbseseen'],
    [gladeBaseX - 0.72, gladeZ - 0.48, 'kivipuravik'],
    [gladeBaseX + 0.25, gladeZ - 0.95, 'kukeseen'],
    [gladeBaseX - 1.35, gladeZ + 0.4, 'kuuseriisikas'],
  ];
  for (const [ox, oz, sp] of starterOffsets) {
    if (getDistanceToNearestVillage(ox, oz).dist >= 28 && distToRoadDetail(ox, oz).dist > 3.5) {
      spawnMushroom(ox, oz, sp);
      if (sp === 'punakarbseseen') {
        heroMushroomPos = { x: ox, z: oz };
      }
    }
  }

  let placed = 0;
  let attempts = 0;
  while (placed < 240 && attempts < 1400) {
    attempts++;
    const mx = (ctx.rand() - 0.5) * (WORLD_HALF * 1.9);
    const mz = (ctx.rand() - 0.5) * (WORLD_HALF * 1.9);
    const nearV = getDistanceToNearestVillage(mx, mz);
    if (nearV.dist < 36 && ctx.rand() < 0.96) continue;
    const isl = getNearestSwampIsland(mx, mz);
    if (getSwampFactor(mx, mz) > 0.28 && isl.islandMask < 0.4) continue;
    if (distToRoadDetail(mx, mz).dist < 3.6) continue;
    if (getTerrainHeight(mx, mz) < SWAMP_WATER_Y + 0.16) continue;

    spawnMushroom(mx, mz, placed < 7 ? allSpecies[placed] : pickWeightedSpecies());
    placed++;
  }

  return {
    mushroomCountTotal,
    heroMushroomPos,
    spawnMushroom,
    gatherMushroom: (entry) => {
      if (!entry.gatherable || entry.gathered || !entry.species) return null;
      entry.gathered = true;
      ctx.interactiveIndex.delete(entry);
      mushroomIndex.delete(entry);
      entry.mesh.visible = false;
      const idx = ctx.interactiveMeshes.indexOf(entry.mesh);
      if (idx !== -1) ctx.interactiveMeshes.splice(idx, 1);
      ctx.sound.playGatherMushroom();
      return entry.species;
    },
    updateVisibility: (camX, camZ, mushroomDist, frustumPlanes) => {
      const maxMushSq = mushroomDist * mushroomDist;
      const mushFadeStart = Math.max(8, mushroomDist - 10);
      const mushFadeStartSq = mushFadeStart * mushFadeStart;
      const mushFadeSpan = Math.max(1, mushroomDist - mushFadeStart);
      for (const entry of visibleMushrooms) entry.mesh.visible = false;
      visibleMushrooms.length = 0;
      mushroomIndex.queryRadius(camX, camZ, mushroomDist, nearbyMushrooms);
      for (let i = 0; i < nearbyMushrooms.length; i++) {
        const m = nearbyMushrooms[i];
        const dx = m.mesh.position.x - camX;
        const dz = m.mesh.position.z - camZ;
        const dSq = dx * dx + dz * dz;
        if (dSq >= maxMushSq) {
          m.mesh.visible = false;
        } else {
          const isVis =
            frustumPlanes && dSq > 25
              ? sphereIntersectsFrustum(
                  frustumPlanes,
                  m.mesh.position.x,
                  m.mesh.position.y + 0.25,
                  m.mesh.position.z,
                  1.2
                )
              : true;
          m.mesh.visible = isVis;
          if (isVis) {
            visibleMushrooms.push(m);
            if (dSq <= mushFadeStartSq) {
              m.mesh.scale.setScalar(1.0);
            } else {
              const tScale = Math.min(1, Math.max(0, (mushroomDist - Math.sqrt(dSq)) / mushFadeSpan));
              m.mesh.scale.setScalar(0.05 + 0.95 * tScale * tScale * (3 - 2 * tScale));
            }
          }
        }
      }
    },
    clear: () => {
      mushroomIndex.clear();
      nearbyMushrooms.length = 0;
      visibleMushrooms.length = 0;
    },
  };
}
