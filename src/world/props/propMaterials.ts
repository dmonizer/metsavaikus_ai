import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { prepareGeometry } from '../geometryPreparation';
import { WorldTextures } from '../proceduralTextures';
import { clamp } from '../terrainMath';
import { WorldResources } from '../worldResources';

export function prepNonIndexed(
  geo: THREE.BufferGeometry,
  color?: THREE.Color
): THREE.BufferGeometry {
  return prepareGeometry(geo, { colors: color ? { mode: 'solid', color } : undefined });
}

export function makeBoxPart(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return prepNonIndexed(g);
}

export function makeCylPart(
  rt: number,
  rb: number,
  len: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, len, segs, 1);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return prepNonIndexed(g);
}

export function applyWallAoColors(geo: THREE.BufferGeometry, baseY: number, topY: number): void {
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const span = Math.max(0.2, topY - baseY);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp((pos.getY(i) - baseY) / span, 0, 1);
    const groundAo = 0.64 + 0.36 * Math.min(1, t / 0.28);
    const eaveAo = 0.44 + 0.56 * Math.min(1, (1 - t) / 0.28);
    const v = Math.min(groundAo, eaveAo);
    cols[i * 3] = v;
    cols[i * 3 + 1] = v * 0.99;
    cols[i * 3 + 2] = v * 0.96;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

export function addBatchedMesh(
  resources: Pick<WorldResources, 'own'>,
  parent: THREE.Group,
  parts: THREE.BufferGeometry[],
  mat: THREE.Material,
  castShadow: boolean,
  wallAo?: { baseY: number; topY: number }
): void {
  if (parts.length === 0) return;
  const merged = mergeGeometries(parts)!;
  if (wallAo) {
    applyWallAoColors(merged, wallAo.baseY, wallAo.topY);
  }
  const m = new THREE.Mesh(merged, mat);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  parent.add(m);
  resources.own(merged);
}

export interface PropSharedAssets {
  weatheredLogMat: THREE.MeshStandardMaterial;
  warmLogMat: THREE.MeshStandardMaterial;
  thatchMat: THREE.MeshStandardMaterial;
  shingleMat: THREE.MeshStandardMaterial;
  stonePlinthMat: THREE.MeshStandardMaterial;
  timberTrimMat: THREE.MeshStandardMaterial;
  gableMat: THREE.MeshStandardMaterial;
  darkInteriorMat: THREE.MeshStandardMaterial;
  chimneyWhiteMat: THREE.MeshStandardMaterial;
  activeWinMat: THREE.MeshStandardMaterial;
  darkWinMat: THREE.MeshStandardMaterial;
  contactShadowMat: THREE.MeshBasicMaterial;
  bedWoolMat: THREE.MeshStandardMaterial;
  bedLinenMat: THREE.MeshStandardMaterial;
  staleWellWaterMat: THREE.MeshStandardMaterial;
  cleanWellWaterMat: THREE.MeshStandardMaterial;
  crateWoodMat: THREE.MeshStandardMaterial;
}

export function createPropSharedAssets(
  textures: WorldTextures,
  resources: WorldResources
): PropSharedAssets {
  const weatheredLogMat = new THREE.MeshStandardMaterial({
    map: textures.logWallWeathered,
    normalMap: textures.logWallNormal,
    normalScale: new THREE.Vector2(1.9, 1.9),
    roughness: 0.93,
    metalness: 0.0,
    envMapIntensity: 0.24,
    vertexColors: true,
  });
  const warmLogMat = new THREE.MeshStandardMaterial({
    map: textures.logWallWarm,
    normalMap: textures.logWallNormal,
    normalScale: new THREE.Vector2(1.9, 1.9),
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.26,
    vertexColors: true,
  });
  const thatchMat = new THREE.MeshStandardMaterial({
    map: textures.thatchRoofMossy,
    normalMap: textures.thatchNormal,
    normalScale: new THREE.Vector2(2.2, 2.2),
    color: 0xd8d2c4,
    roughness: 0.97,
    metalness: 0.0,
    envMapIntensity: 0.18,
  });
  const shingleMat = new THREE.MeshStandardMaterial({
    map: textures.roofShingle,
    normalMap: textures.shingleNormal,
    normalScale: new THREE.Vector2(2.0, 2.0),
    color: 0xc8c2b8,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.22,
  });
  const stonePlinthMat = new THREE.MeshStandardMaterial({
    map: textures.fieldstone,
    normalMap: textures.fieldstoneNormal,
    normalScale: new THREE.Vector2(2.2, 2.2),
    roughness: 0.9,
    metalness: 0.02,
    envMapIntensity: 0.3,
  });
  const timberTrimMat = new THREE.MeshStandardMaterial({
    map: textures.plankWood,
    normalMap: textures.plankNormal,
    normalScale: new THREE.Vector2(1.5, 1.5),
    color: 0x867c6e,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.24,
  });
  const gableMat = new THREE.MeshStandardMaterial({
    map: textures.gableBoards,
    normalMap: textures.plankNormal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    color: 0xbeb5a6,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.24,
  });
  const darkInteriorMat = new THREE.MeshStandardMaterial({
    color: 0x1a130e,
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.15,
  });
  const chimneyWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xcbc6bc,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });
  const activeWinMat = new THREE.MeshStandardMaterial({
    color: 0x141e24,
    emissive: 0xffa64d,
    emissiveIntensity: 0.04,
    roughness: 0.1,
    metalness: 0.18,
    envMapIntensity: 1.55,
  });
  const darkWinMat = new THREE.MeshStandardMaterial({
    color: 0x101413,
    roughness: 0.16,
    metalness: 0.12,
    envMapIntensity: 1.15,
  });
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadowTex,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const bedWoolMat = new THREE.MeshStandardMaterial({
    color: 0x6f4b3e,
    roughness: 0.94,
    metalness: 0.0,
    envMapIntensity: 0.2,
  });
  const bedLinenMat = new THREE.MeshStandardMaterial({
    color: 0xd6cdb9,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.25,
  });
  const staleWellWaterMat = new THREE.MeshStandardMaterial({
    color: 0x2c3b20,
    roughness: 0.28,
    metalness: 0.05,
    envMapIntensity: 0.65,
  });
  const cleanWellWaterMat = new THREE.MeshStandardMaterial({
    color: 0x1a3846,
    roughness: 0.14,
    metalness: 0.08,
    envMapIntensity: 0.9,
  });
  const crateWoodMat = new THREE.MeshStandardMaterial({
    map: textures.plankWood,
    normalMap: textures.plankNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    color: 0x9b7952,
    roughness: 0.88,
    metalness: 0.0,
    envMapIntensity: 0.3,
  });

  resources.own(
    weatheredLogMat,
    warmLogMat,
    thatchMat,
    shingleMat,
    stonePlinthMat,
    timberTrimMat,
    gableMat,
    darkInteriorMat,
    chimneyWhiteMat,
    activeWinMat,
    darkWinMat,
    contactShadowMat,
    bedWoolMat,
    bedLinenMat,
    staleWellWaterMat,
    cleanWellWaterMat,
    crateWoodMat
  );

  return {
    weatheredLogMat,
    warmLogMat,
    thatchMat,
    shingleMat,
    stonePlinthMat,
    timberTrimMat,
    gableMat,
    darkInteriorMat,
    chimneyWhiteMat,
    activeWinMat,
    darkWinMat,
    contactShadowMat,
    bedWoolMat,
    bedLinenMat,
    staleWellWaterMat,
    cleanWellWaterMat,
    crateWoodMat,
  };
}
