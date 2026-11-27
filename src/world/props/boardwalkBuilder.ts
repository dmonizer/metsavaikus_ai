import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t } from '../../i18n/i18n';
import { SWAMP_WATER_Y, getActiveBlueprint, getTerrainHeight } from '../terrainMath';
import { makeBoxPart } from './propMaterials';
import { PropBuildContext } from './propTypes';

export function buildSignpostAndBoardwalk(
  ctx: PropBuildContext,
  timberTrimMat: THREE.Material
): void {
  const bp = getActiveBlueprint();

  function createSignpost(
    x: number,
    z: number,
    rotY: number,
    getTitle: () => string,
    getMessage: () => string
  ): void {
    const y = getTerrainHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    const postGeo = new THREE.BoxGeometry(0.14, 1.8, 0.14);
    const boardGeo = new THREE.BoxGeometry(1.25, 0.44, 0.08);
    ctx.resources.own(postGeo, boardGeo);
    const post = new THREE.Mesh(postGeo, timberTrimMat);
    post.position.y = 0.9;
    post.castShadow = ctx.shadows;
    const board = new THREE.Mesh(boardGeo, timberTrimMat);
    board.position.y = 1.55;
    board.castShadow = ctx.shadows;
    g.add(post, board);
    ctx.resources.add(g);
    ctx.circleColliders.push({ x, z, r: 0.22 });

    ctx.registerInteractive(board, {
      name: getTitle(),
      desc: t('prop.signpostDesc'),
      getName: getTitle,
      getDesc: () => t('prop.signpostDesc'),
      onUse: () => ctx.showToast(getMessage()),
      onTouch: () => ctx.showToast(getMessage()),
    });
  }

  const fwdX = -Math.sin(bp.spawnYaw);
  const fwdZ = -Math.cos(bp.spawnYaw);
  const rightX = Math.cos(bp.spawnYaw);
  const rightZ = -Math.sin(bp.spawnYaw);
  const mainSignX = bp.spawnX + fwdX * 11.5 - rightX * 3.8;
  const mainSignZ = bp.spawnZ + fwdZ * 11.5 - rightZ * 3.8;
  createSignpost(
    mainSignX,
    mainSignZ,
    bp.spawnYaw + 0.25,
    () => t('prop.signpostMainTitle'),
    () => t('prop.signpostMainMsg', { village: bp.villages[0].name })
  );

  const firstLink = bp.boardwalkLinks[0];
  const trailStart = firstLink
    ? { x: firstLink.ax, z: firstLink.az }
    : {
        x: bp.bogCenterX - bp.bogRadius * 0.55,
        z: bp.bogCenterZ - bp.bogRadius * 0.35,
      };
  const bogSignAngle = firstLink
    ? Math.atan2(firstLink.bx - firstLink.ax, firstLink.bz - firstLink.az)
    : -0.7;
  createSignpost(
    trailStart.x - Math.cos(bogSignAngle) * 2.2,
    trailStart.z + Math.sin(bogSignAngle) * 2.2,
    bogSignAngle - 0.5,
    () => t('prop.signpostBogTitle'),
    () => t('prop.signpostBogMsg')
  );

  const plankMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.plankWood,
    normalMap: ctx.textures.plankNormal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    color: 0xb2aa9c,
    roughness: 0.88,
    metalness: 0.0,
    envMapIntensity: 0.5,
  });
  const sleeperMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.plankWood,
    normalMap: ctx.textures.plankNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    color: 0x72695c,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.42,
  });

  interface BoardwalkSeg {
    px: number;
    pz: number;
    angle: number;
    deckY: number;
    segLen: number;
  }
  const allSegs: BoardwalkSeg[] = [];

  function appendBoardwalkPath(ax: number, az: number, bx: number, bz: number): void {
    const dxTotal = bx - ax;
    const dzTotal = bz - az;
    const totalLen = Math.hypot(dxTotal, dzTotal);
    if (totalLen < 2) return;
    const steps = Math.max(4, Math.round(totalLen / 1.85));
    const segLen = totalLen / steps + 0.06;

    for (let i = 0; i < steps; i++) {
      const tPos = (i + 0.5) / steps;
      const sway = Math.sin(tPos * Math.PI * 1.4) * Math.min(2.8, totalLen * 0.04);
      const px = ax + dxTotal * tPos - (dzTotal / totalLen) * sway;
      const pz = az + dzTotal * tPos + (dxTotal / totalLen) * sway;

      const tNext = Math.min(1, (i + 1.5) / steps);
      const swayNext = Math.sin(tNext * Math.PI * 1.4) * Math.min(2.8, totalLen * 0.04);
      const nx = ax + dxTotal * tNext - (dzTotal / totalLen) * swayNext;
      const nz = az + dzTotal * tNext + (dxTotal / totalLen) * swayNext;

      const angle = Math.atan2(nx - px, nz - pz);
      const groundY = getTerrainHeight(px, pz);
      const deckY = Math.max(SWAMP_WATER_Y + 0.32, groundY + 0.16);
      allSegs.push({ px, pz, angle, deckY, segLen });

      const halfW = 0.88;
      const halfL = segLen * 0.5 + 0.36;
      const cosYaw = Math.cos(angle);
      const sinYaw = Math.sin(angle);
      const extX = Math.abs(cosYaw) * halfW + Math.abs(sinYaw) * halfL;
      const extZ = Math.abs(sinYaw) * halfW + Math.abs(cosYaw) * halfL;
      ctx.boardwalkZones.push({
        minX: px - extX,
        maxX: px + extX,
        minZ: pz - extZ,
        maxZ: pz + extZ,
        y: deckY + 0.04,
        cx: px,
        cz: pz,
        cosYaw,
        sinYaw,
        halfW,
        halfL,
      });
    }
  }

  for (const link of bp.boardwalkLinks) {
    appendBoardwalkPath(link.ax, link.az, link.bx, link.bz);
  }

  if (allSegs.length > 0) {
    const avgLen = allSegs[0].segLen;
    const twinPlankGeo = mergeGeometries([
      makeBoxPart(0.46, 0.07, avgLen + 0.25, -0.26, 0, 0),
      makeBoxPart(0.46, 0.07, avgLen + 0.25, 0.26, 0, 0),
    ])!;
    const sleeperGeo = new THREE.BoxGeometry(1.55, 0.09, 0.16);
    const plankInst = new THREE.InstancedMesh(twinPlankGeo, plankMat, allSegs.length);
    const sleeperInst = new THREE.InstancedMesh(sleeperGeo, sleeperMat, allSegs.length);
    plankInst.userData.debugLayer = 'boardwalk';
    plankInst.userData.debugName = 'Swamp Boardwalk Planks';
    sleeperInst.userData.debugLayer = 'boardwalk';
    sleeperInst.userData.debugName = 'Swamp Boardwalk Sleepers';
    plankInst.receiveShadow = true;
    plankInst.castShadow = ctx.shadows;
    sleeperInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < allSegs.length; i++) {
      const s = allSegs[i];
      dummy.position.set(s.px, s.deckY, s.pz);
      dummy.rotation.set(0, s.angle, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      plankInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(s.px, s.deckY - 0.075, s.pz);
      dummy.updateMatrix();
      sleeperInst.setMatrixAt(i, dummy.matrix);
    }
    plankInst.instanceMatrix.needsUpdate = true;
    sleeperInst.instanceMatrix.needsUpdate = true;
    ctx.resources.add(plankInst, sleeperInst);
    // Instance transforms are world-space. Include the full trail in the fog-distance test.
    plankInst.computeBoundingBox();
    sleeperInst.computeBoundingBox();
    const bounds = plankInst.boundingBox!.clone().union(sleeperInst.boundingBox!);
    for (const obj of [plankInst, sleeperInst]) {
      ctx.structureNodes.push({ obj, bounds, maxDistSq: 450 * 450 });
    }
    ctx.resources.own(twinPlankGeo, sleeperGeo, plankMat, sleeperMat);
  } else {
    ctx.resources.own(plankMat, sleeperMat);
  }
}
