import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ItemId } from '../../game/itemCatalog';
import { ShelterQuality } from '../../game/survivalEngine';
import { t } from '../../i18n/i18n';
import { buildPantry } from '../pantry';
import { BoxCollider } from '../spatialPhysics';
import { SWAMP_WATER_Y, getActiveBlueprint, getTerrainHeight } from '../terrainMath';
import { HutDecayState } from '../worldBlueprint';
import { PropSharedAssets, addBatchedMesh, makeBoxPart, makeCylPart, prepNonIndexed } from './propMaterials';
import { PropBuildContext } from './propTypes';

export interface BuildingsSystem {
  buildEstonianLogHouse: (
    x: number,
    z: number,
    rotY: number,
    opts?: {
      w?: number;
      d?: number;
      h?: number;
      roofStyle?: 'thatch' | 'shingle';
      warmWood?: boolean;
      abandoned?: boolean;
      decayState?: HutDecayState;
      porch?: boolean;
      name?: string;
      pantry?: boolean;
    }
  ) => void;
}

export function buildBuildingsAndWells(
  ctx: PropBuildContext,
  assets: PropSharedAssets
): BuildingsSystem {
  let crateCounter = 0;
  const bp = getActiveBlueprint();

  function buildEstonianLogHouse(
    x: number,
    z: number,
    rotY: number,
    opts: {
      w?: number;
      d?: number;
      h?: number;
      roofStyle?: 'thatch' | 'shingle';
      warmWood?: boolean;
      abandoned?: boolean;
      decayState?: HutDecayState;
      porch?: boolean;
      name?: string;
      pantry?: boolean;
    } = {}
  ): void {
    const w = opts.w ?? 8.4;
    const d = opts.d ?? 5.6;
    const h = opts.h ?? 2.75;
    const roofStyle = opts.roofStyle ?? 'thatch';
    const roofOverhang = 0.84;
    const roofH = roofStyle === 'thatch' ? 2.95 : 2.55;
    const wallMat = opts.warmWood ? assets.warmLogMat : assets.weatheredLogMat;
    const abandoned = !!opts.abandoned;
    const decay: HutDecayState = opts.decayState ?? 'intact';
    const name = opts.name ?? 'Rehemaja';

    const y = getTerrainHeight(x, z);
    const buildingId = `house_${x}_${z}`;
    let doorOpenRef = false;
    ctx.shelters.add({
      id: buildingId,
      x,
      z,
      yaw: rotY,
      halfW: w / 2,
      halfD: d / 2,
      floorY: y + 0.43,
      shelter:
        decay === 'intact' || decay === 'sagging'
          ? {
              quality: !abandoned && decay === 'intact' ? 'warm_house' : 'drafty_hut',
              label: name,
            }
          : undefined,
      roof:
        decay === 'intact'
          ? {
              eaveY: y + 0.4 + h - 0.16 + (roofH * roofOverhang) / (d / 2 + roofOverhang),
              rise: (roofH * (d / 2)) / (d / 2 + roofOverhang),
              axis: 'z',
            }
          : undefined,
    });
    if (decay === 'intact') {
      ctx.shelters.add({
        id: `${buildingId}_overhang`,
        x,
        z,
        yaw: rotY,
        halfW: w / 2 + roofOverhang * 0.95,
        halfD: d / 2 + roofOverhang,
        floorY: y + 0.43,
        roofOnly: true,
        roof: {
          eaveY: y + 0.4 + h - 0.16,
          rise: roofH,
          axis: 'z',
        },
      });
    }
    const drainageX = x + Math.cos(rotY) * (w / 2 + 0.4);
    const drainageZ = z - Math.sin(rotY) * (w / 2 + 0.4);
    ctx.structureMetas.push({
      id: buildingId,
      x,
      z,
      yaw: rotY,
      halfW: w / 2,
      halfD: d / 2,
      abandoned,
      decay,
      roofMaterial: roofStyle,
      wallMaterial: 'wood',
      hasDoor: decay !== 'ruins',
      getDoorOpen: () => doorOpenRef,
      roofDrainagePoint:
        decay === 'intact' || decay === 'sagging'
          ? { x: drainageX, y: y + 2.4, z: drainageZ }
          : undefined,
    });
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = rotY;
    group.userData.debugLayer = 'structure';
    group.userData.debugName = name;
    group.userData.debugMeta = { buildingId, decay, abandoned, roofStyle };
    ctx.resources.add(group);
    ctx.structureNodes.push({ obj: group, x, z, maxDistSq: 255 * 255 });

    const shadowGeo = new THREE.PlaneGeometry(w + 2.4, d + 2.4);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowQuad = new THREE.Mesh(shadowGeo, assets.contactShadowMat);
    shadowQuad.position.y = 0.03;
    group.add(shadowQuad);
    ctx.resources.own(shadowGeo);

    const plinthParts: THREE.BufferGeometry[] = [];
    const wallParts: THREE.BufferGeometry[] = [];
    const roofParts: THREE.BufferGeometry[] = [];
    const gableParts: THREE.BufferGeometry[] = [];
    const trimParts: THREE.BufferGeometry[] = [];
    const interiorParts: THREE.BufferGeometry[] = [];
    const winParts: THREE.BufferGeometry[] = [];
    const chimneyParts: THREE.BufferGeometry[] = [];

    plinthParts.push(makeBoxPart(w + 0.22, 0.46, d + 0.22, 0, 0.16, 0));
    const frontStoneCount = Math.max(5, Math.floor(w / 1.15));
    for (let i = 0; i <= frontStoneCount; i++) {
      const sx = -w * 0.5 + (i / frontStoneCount) * w;
      for (const sz of [-d * 0.5 - 0.06, d * 0.5 + 0.06]) {
        const sr = 0.2 + (i % 3) * 0.04;
        const sb = new THREE.DodecahedronGeometry(sr, 0);
        sb.scale(1.25, 0.72, 0.95);
        sb.rotateY(i * 1.1);
        sb.translate(sx, 0.12, sz);
        plinthParts.push(prepNonIndexed(sb));
      }
    }
    const sideStoneCount = Math.max(3, Math.floor(d / 1.15));
    for (let i = 1; i < sideStoneCount; i++) {
      const sz = -d * 0.5 + (i / sideStoneCount) * d;
      for (const sx of [-w * 0.5 - 0.06, w * 0.5 + 0.06]) {
        const sr = 0.2 + (i % 2) * 0.05;
        const sb = new THREE.DodecahedronGeometry(sr, 0);
        sb.scale(0.95, 0.72, 1.25);
        sb.rotateY(i * 0.9);
        sb.translate(sx, 0.12, sz);
        plinthParts.push(prepNonIndexed(sb));
      }
    }

    interiorParts.push(makeBoxPart(w - 0.2, 0.14, d - 0.2, 0, 0.36, 0));

    const wallThick = 0.28;
    const doorWidth = 1.25;
    const sideSegW = (w - doorWidth) / 2;

    const hBack = decay === 'ruins' ? h * 0.52 : decay === 'roofless' ? h * 0.88 : h;
    const hLeft = decay === 'ruins' ? h * 0.72 : h;
    const hRight = decay === 'ruins' ? h * 0.42 : decay === 'roofless' ? h * 0.84 : h;
    const hFrontL = decay === 'ruins' ? h * 0.62 : h;
    const hFrontR = decay === 'ruins' ? h * 0.55 : h;

    wallParts.push(makeBoxPart(w, hBack, wallThick, 0, 0.4 + hBack / 2, -d / 2 + wallThick / 2));
    wallParts.push(makeBoxPart(wallThick, hLeft, d, -w / 2 + wallThick / 2, 0.4 + hLeft / 2, 0));
    wallParts.push(makeBoxPart(wallThick, hRight, d, w / 2 - wallThick / 2, 0.4 + hRight / 2, 0));
    wallParts.push(
      makeBoxPart(sideSegW, hFrontL, wallThick, -w / 2 + sideSegW / 2, 0.4 + hFrontL / 2, d / 2 - wallThick / 2)
    );
    wallParts.push(
      makeBoxPart(sideSegW, hFrontR, wallThick, w / 2 - sideSegW / 2, 0.4 + hFrontR / 2, d / 2 - wallThick / 2)
    );

    if (decay !== 'ruins') {
      wallParts.push(makeBoxPart(doorWidth, 0.62, wallThick, 0, 0.4 + h - 0.31, d / 2 - wallThick / 2));
    }

    const maxWallH = decay === 'ruins' ? h * 0.55 : h;
    const logCourses = decay === 'ruins' ? 4 : 8;
    for (let c = 0; c < logCourses; c++) {
      const ly = 0.52 + (c / logCourses) * (maxWallH - 0.16);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          wallParts.push(
            makeCylPart(
              0.11,
              0.115,
              0.46,
              7,
              sx * (w / 2 + 0.11),
              ly,
              sz * (d / 2 - wallThick / 2),
              0,
              0,
              Math.PI / 2
            )
          );
          wallParts.push(
            makeCylPart(
              0.11,
              0.115,
              0.46,
              7,
              sx * (w / 2 - wallThick / 2),
              ly + 0.085,
              sz * (d / 2 + 0.11),
              Math.PI / 2,
              0,
              0
            )
          );
        }
      }
    }

    const slopeRun = d / 2 + roofOverhang;
    const slopeLen = Math.hypot(slopeRun, roofH);
    const slopeAngle = Math.atan2(roofH, slopeRun);
    const roofThick = roofStyle === 'thatch' ? 0.34 : 0.18;

    if (decay === 'intact' || decay === 'sagging') {
      const sagAngle = decay === 'sagging' ? 0.09 : 0;
      const frontRoofW = w + roofOverhang * 1.95;
      roofParts.push(
        makeBoxPart(
          frontRoofW,
          roofThick,
          slopeLen,
          0,
          0.4 + h + roofH / 2 - 0.16,
          slopeRun / 2,
          slopeAngle,
          0,
          sagAngle
        )
      );
      const backW = decay === 'sagging' ? frontRoofW * 0.58 : frontRoofW;
      const backShiftX = decay === 'sagging' ? -frontRoofW * 0.2 : 0;
      roofParts.push(
        makeBoxPart(
          backW,
          roofThick,
          slopeLen,
          backShiftX,
          0.4 + h + roofH / 2 - 0.16,
          -slopeRun / 2,
          -slopeAngle,
          0,
          -sagAngle * 0.8
        )
      );

      const eaveCount = Math.max(5, Math.floor(w / 1.35));
      for (let i = 0; i < eaveCount; i++) {
        const ex = -w * 0.46 + (i / (eaveCount - 1)) * w * 0.92;
        trimParts.push(makeBoxPart(0.11, 0.12, 0.95, ex, 0.4 + h - 0.04, d / 2 + 0.32, 0.24, 0, 0));
        trimParts.push(makeBoxPart(0.11, 0.12, 0.95, ex, 0.4 + h - 0.04, -d / 2 - 0.32, -0.24, 0, 0));
      }

      const gableShape = new THREE.Shape();
      gableShape.moveTo(-d / 2, 0);
      gableShape.lineTo(d / 2, 0);
      gableShape.lineTo(0, roofH * 0.88);
      gableShape.closePath();

      const makeGableGeo = (xPos: number) => {
        const geo = new THREE.ExtrudeGeometry(gableShape, { depth: 0.22, bevelEnabled: false });
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) * 0.34, uv.getY(i) * 0.34);
        }
        geo.rotateY(Math.PI / 2);
        geo.translate(xPos, 0.4 + h, 0);
        return prepNonIndexed(geo);
      };
      gableParts.push(makeGableGeo(-w / 2));
      if (decay === 'intact') {
        gableParts.push(makeGableGeo(w / 2 - 0.22));
      }

      if (roofStyle === 'thatch') {
        const poleCount = Math.max(6, Math.floor(w / 0.85));
        const nx = Math.sin(slopeAngle) * 0.22;
        const ny = Math.cos(slopeAngle) * 0.22;
        for (let i = 0; i < poleCount; i++) {
          if (decay === 'sagging' && i > poleCount * 0.6) continue;
          const px = -w * 0.46 + (i / (poleCount - 1)) * w * 0.92;
          trimParts.push(
            makeCylPart(
              0.036,
              0.048,
              slopeLen + 0.62,
              5,
              px - 0.045,
              0.4 + h + roofH * 0.56 + ny,
              slopeRun * 0.44 + nx,
              Math.PI * 0.5 + slopeAngle,
              0,
              0
            )
          );
          trimParts.push(
            makeCylPart(
              0.036,
              0.048,
              slopeLen + 0.62,
              5,
              px + 0.045,
              0.4 + h + roofH * 0.56 + ny,
              -(slopeRun * 0.44 + nx),
              Math.PI * 0.5 - slopeAngle,
              0,
              0
            )
          );
        }
        trimParts.push(
          makeCylPart(0.06, 0.06, frontRoofW * 0.94, 6, 0, 0.4 + h + roofH + 0.06, 0, 0, 0, Math.PI / 2)
        );
      } else if (decay === 'intact') {
        chimneyParts.push(makeBoxPart(0.72, 1.55, 0.72, -w * 0.22, 0.4 + h + roofH - 0.16, -0.35));
        trimParts.push(makeBoxPart(0.84, 0.14, 0.84, -w * 0.22, 0.4 + h + roofH + 0.62, -0.35));
      }
    } else if (decay === 'roofless') {
      trimParts.push(makeCylPart(0.08, 0.09, w * 0.86, 5, -w * 0.04, 0.4 + h + 0.04, 0, 0, 0, Math.PI / 2 + 0.04));
      const rafterCount = 4;
      for (let i = 0; i < rafterCount; i++) {
        const rxPos = -w * 0.35 + (i / (rafterCount - 1)) * w * 0.7;
        trimParts.push(
          makeCylPart(
            0.055,
            0.065,
            slopeLen * (0.45 + (i % 2) * 0.25),
            5,
            rxPos,
            0.4 + h + 0.55,
            d * 0.26,
            Math.PI * 0.5 + slopeAngle - (i % 2) * 0.14,
            0,
            0.08 * (i % 2 ? 1 : -1)
          )
        );
        if (i !== 2) {
          trimParts.push(
            makeCylPart(
              0.055,
              0.065,
              slopeLen * 0.52,
              5,
              rxPos,
              0.4 + h + 0.5,
              -d * 0.26,
              Math.PI * 0.5 - slopeAngle,
              0,
              -0.06
            )
          );
        }
      }
      trimParts.push(makeCylPart(0.08, 0.095, w * 0.75, 5, 0.15, 0.62, -0.35, 0.18, 0.42, Math.PI / 2 - 0.14));
    } else if (decay === 'ruins') {
      trimParts.push(makeCylPart(0.09, 0.1, w * 0.72, 5, -0.2, 0.58, 0.2, 0.1, -0.35, Math.PI / 2 - 0.08));
      trimParts.push(makeCylPart(0.08, 0.09, d * 0.85, 5, 0.65, 0.64, -0.1, Math.PI / 2 - 0.12, 0.4, 0));
    }

    if (decay !== 'ruins') {
      const doorFz = d / 2 - wallThick / 2 + 0.04;
      trimParts.push(makeBoxPart(0.11, h - 0.65, 0.32, -doorWidth / 2 - 0.05, 0.4 + (h - 0.65) / 2, doorFz));
      trimParts.push(makeBoxPart(0.11, h - 0.65, 0.32, doorWidth / 2 + 0.05, 0.4 + (h - 0.65) / 2, doorFz));
      trimParts.push(makeBoxPart(doorWidth + 0.22, 0.11, 0.32, 0, 0.4 + h - 0.66, doorFz));

      for (const wx of [-w * 0.28, w * 0.28]) {
        const wy = 0.4 + 1.42;
        const wz = d / 2 - wallThick / 2;
        winParts.push(makeBoxPart(0.86, 0.86, 0.24, wx, wy, wz - 0.02));
        trimParts.push(makeBoxPart(1.04, 0.09, 0.36, wx, wy + 0.45, wz + 0.02));
        trimParts.push(makeBoxPart(1.08, 0.1, 0.4, wx, wy - 0.45, wz + 0.04));
        trimParts.push(makeBoxPart(0.09, 0.9, 0.36, wx - 0.46, wy, wz + 0.02));
        trimParts.push(makeBoxPart(0.09, 0.9, 0.36, wx + 0.46, wy, wz + 0.02));
        trimParts.push(makeBoxPart(0.05, 0.86, 0.32, wx, wy, wz + 0.02));
        trimParts.push(makeBoxPart(0.86, 0.05, 0.32, wx, wy, wz + 0.02));
      }

      if (opts.porch) {
        trimParts.push(makeBoxPart(w * 0.68, 0.16, 1.2, 0, 0.32, d / 2 + 0.58));
        trimParts.push(makeBoxPart(1.9, 0.1, 0.38, -w * 0.16, 0.72, d / 2 + 0.54));
        trimParts.push(makeBoxPart(1.18, 0.12, 0.32, 0, 0.16, d / 2 + 1.15));
      }

      interiorParts.push(makeBoxPart(1.4, 0.76, 0.82, 0, 0.4 + 0.38, -0.5));
    }

    addBatchedMesh(ctx.resources, group, plinthParts, assets.stonePlinthMat, true);
    addBatchedMesh(ctx.resources, group, wallParts, wallMat, true, { baseY: 0.4, topY: 0.4 + h });
    addBatchedMesh(ctx.resources, group, roofParts, roofStyle === 'thatch' ? assets.thatchMat : assets.shingleMat, true);
    addBatchedMesh(ctx.resources, group, gableParts, assets.gableMat, true);
    addBatchedMesh(ctx.resources, group, trimParts, assets.timberTrimMat, ctx.shadows);
    addBatchedMesh(ctx.resources, group, interiorParts, assets.darkInteriorMat, true);
    addBatchedMesh(ctx.resources, group, winParts, abandoned ? assets.darkWinMat : assets.activeWinMat, false);
    addBatchedMesh(ctx.resources, group, chimneyParts, assets.chimneyWhiteMat, ctx.shadows);

    let doorCollider: BoxCollider | null = null;
    if (decay !== 'ruins') {
      const doorPivot = new THREE.Group();
      doorPivot.position.set(-doorWidth / 2, 0.4, d / 2 - wallThick / 2);
      const doorMat = new THREE.MeshStandardMaterial({
        map: ctx.textures.plankWood,
        normalMap: ctx.textures.plankNormal,
        normalScale: new THREE.Vector2(0.9, 0.9),
        color: abandoned ? 0x544c42 : 0x6f5438,
        roughness: 0.9,
        metalness: 0.0,
        envMapIntensity: 0.45,
      });
      const doorGeo = new THREE.BoxGeometry(doorWidth - 0.04, h - 0.72, 0.1);
      ctx.resources.own(doorMat, doorGeo);
      const doorMesh = new THREE.Mesh(doorGeo, doorMat);
      doorMesh.position.set(doorWidth / 2, (h - 0.72) / 2, 0);
      doorMesh.castShadow = true;
      doorMesh.receiveShadow = true;
      doorPivot.add(doorMesh);
      group.add(doorPivot);

      let doorOpen = abandoned && ctx.rand() > 0.3;
      doorOpenRef = doorOpen;
      doorPivot.rotation.y = doorOpen ? -Math.PI * 0.58 : 0;

      const c = Math.cos(rotY);
      const s = Math.sin(rotY);
      const lx = 0;
      const lz = d / 2 - wallThick / 2;
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      const ww = Math.abs(doorWidth * c) + Math.abs(wallThick * s);
      const wd = Math.abs(doorWidth * s) + Math.abs(wallThick * c);
      doorCollider = ctx.addBoxCollider(wx, wz, ww, wd, y + 0.4, h - 0.72, false);
      doorCollider.frame = { x: wx, z: wz, yaw: rotY, halfW: doorWidth / 2, halfD: wallThick / 2 };
      doorCollider.active = !doorOpen;

      const doorId = `door_${buildingId}`;
      doorMesh.userData.debugLayer = 'door';
      doorMesh.userData.debugName = abandoned ? 'Old Cabin Door' : `${name} Door`;
      doorMesh.userData.debugMeta = { doorId, buildingId, abandoned };
      ctx.registerInteractive(doorMesh, {
        name: abandoned ? t('prop.oldCabinDoor') : t('prop.namedDoor', { name }),
        desc: abandoned ? t('prop.doorDescAbandoned') : t('prop.doorDescIntact'),
        getName: () => (abandoned ? t('prop.oldCabinDoor') : t('prop.namedDoor', { name })),
        getDesc: () => (abandoned ? t('prop.doorDescAbandoned') : t('prop.doorDescIntact')),
        ownCollider: doorCollider ?? undefined,
        onUse: () => {
          doorOpen = !doorOpen;
          doorOpenRef = doorOpen;
          ctx.markLightShadowsDirty();
          if (doorCollider) doorCollider.active = !doorOpen;
          doorPivot.rotation.y = doorOpen ? -Math.PI * 0.58 : 0;
          if (ctx.handlers?.onDoorToggle) {
            ctx.handlers.onDoorToggle({
              doorId,
              buildingId,
              open: doorOpen,
              abandoned,
              x: wx,
              y: y + 1.25,
              z: wz,
            });
          } else {
            ctx.sound.playImpact(0.7);
          }
          ctx.showToast(doorOpen ? t('prop.doorOpened') : t('prop.doorClosed'));
        },
        onTouch: () =>
          ctx.showToast(abandoned ? t('prop.doorTouchAbandoned') : t('prop.doorTouchIntact')),
      });
    }

    if (opts.pantry && !abandoned && decay === 'intact') {
      buildPantry(group, w, d, ctx.registerInteractive, ctx.resources);
    }

    if (decay === 'intact' || decay === 'sagging') {
      const bedShelter: ShelterQuality =
        !abandoned && decay === 'intact' ? 'warm_house' : 'drafty_hut';
      const bedGroup = new THREE.Group();
      const bedLx = -w * 0.28;
      const bedLz = -d * 0.12;
      bedGroup.position.set(bedLx, 0.43, bedLz);

      const frameGeo = new THREE.BoxGeometry(1.05, 0.34, 1.95);
      const blanketGeo = new THREE.BoxGeometry(0.98, 0.16, 1.52);
      const pillowGeo = new THREE.BoxGeometry(0.76, 0.14, 0.36);
      ctx.resources.own(frameGeo, blanketGeo, pillowGeo);

      const frameMesh = new THREE.Mesh(frameGeo, assets.timberTrimMat);
      frameMesh.position.y = 0.17;
      const blanketMesh = new THREE.Mesh(blanketGeo, assets.bedWoolMat);
      blanketMesh.position.set(0, 0.39, 0.18);
      const pillowMesh = new THREE.Mesh(pillowGeo, assets.bedLinenMat);
      pillowMesh.position.set(0, 0.42, -0.72);
      bedGroup.add(frameMesh, blanketMesh, pillowMesh);
      group.add(bedGroup);

      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const bedWorldX = x + bedLx * cosR + bedLz * sinR;
      const bedWorldZ = z - bedLx * sinR + bedLz * cosR;

      ctx.registerInteractive(bedGroup, {
        name: abandoned ? t('prop.bunkName', { name }) : t('prop.bedName', { name }),
        desc: bedShelter === 'warm_house' ? t('prop.bedDescWarm') : t('prop.bedDescDrafty'),
        getName: () => (abandoned ? t('prop.bunkName', { name }) : t('prop.bedName', { name })),
        getDesc: () =>
          bedShelter === 'warm_house' ? t('prop.bedDescWarm') : t('prop.bedDescDrafty'),
        onUse: () => {
          ctx.handlers?.onOpenSleep?.({
            kind: 'bed',
            label: abandoned ? t('prop.bunkName', { name }) : t('prop.bedSpotLabel', { name }),
            x: bedWorldX,
            y: y + 0.85,
            z: bedWorldZ,
            shelter: bedShelter,
          });
        },
        onTouch: () =>
          ctx.showToast(
            bedShelter === 'warm_house' ? t('prop.bedTouchWarm') : t('prop.bedTouchDrafty')
          ),
      });

      if (!abandoned || decay === 'intact') {
        const crateId = `crate_${crateCounter++}`;
        const crateLx = w * 0.27;
        const crateLz = -d * 0.24;
        const crateGeo = new THREE.BoxGeometry(0.74, 0.56, 0.54);
        ctx.resources.own(crateGeo);
        const crateMesh = new THREE.Mesh(crateGeo, assets.crateWoodMat);
        crateMesh.position.set(crateLx, 0.43 + 0.28, crateLz);
        group.add(crateMesh);

        const lootPool: Array<Array<{ itemId: ItemId; qty: number }>> = [
          [
            { itemId: 'rye_bread', qty: 1 },
            { itemId: 'smoked_sausage', qty: 1 },
            { itemId: 'matches', qty: 1 },
          ],
          [
            { itemId: 'raw_steak', qty: 1 },
            { itemId: 'chocolate_bar', qty: 1 },
            { itemId: 'extra_battery', qty: 1 },
          ],
          [
            { itemId: 'dried_berries', qty: 1 },
            { itemId: 'chocolate_bar', qty: 1 },
            { itemId: 'matches', qty: 1 },
          ],
          [
            { itemId: 'smoked_sausage', qty: 1 },
            { itemId: 'extra_battery', qty: 1 },
          ],
        ];
        const crateLoot = lootPool[crateCounter % lootPool.length];
        let looted = false;

        ctx.registerInteractive(crateMesh, {
          name: abandoned ? t('prop.oldSupplyBox') : t('prop.pantryCrate', { name }),
          desc: t('prop.crateDesc'),
          getName: () => (abandoned ? t('prop.oldSupplyBox') : t('prop.pantryCrate', { name })),
          getDesc: () => t('prop.crateDesc'),
          onUse: () => {
            if (looted) {
              ctx.showToast(t('prop.crateEmpty'));
              return;
            }
            looted = true;
            crateMesh.scale.y = 0.72;
            crateMesh.position.y = 0.43 + 0.2;
            ctx.sound.playImpact(0.5);
            ctx.handlers?.onLootCrate?.(
              crateId,
              abandoned ? t('prop.oldSupplyBox') : t('prop.pantryCrate', { name }),
              crateLoot
            );
          },
          onTouch: () =>
            ctx.showToast(looted ? t('prop.crateTouchEmpty') : t('prop.crateTouchFull')),
        });
      }
    }

    function addLocalWallCollider(
      lx: number,
      lz: number,
      lw: number,
      ld: number,
      wallHeight: number,
      bottom = 0.4
    ): void {
      const c = Math.cos(rotY);
      const s = Math.sin(rotY);
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      const ww = Math.abs(lw * c) + Math.abs(ld * s);
      const wd = Math.abs(lw * s) + Math.abs(ld * c);
      const collider = ctx.addBoxCollider(wx, wz, ww, wd, y + bottom, wallHeight, false);
      collider.frame = { x: wx, z: wz, yaw: rotY, halfW: lw / 2, halfD: ld / 2 };
    }

    addLocalWallCollider(0, -d / 2 + wallThick / 2, w, wallThick, hBack);
    addLocalWallCollider(-w / 2 + wallThick / 2, 0, wallThick, d, hLeft);
    addLocalWallCollider(w / 2 - wallThick / 2, 0, wallThick, d, hRight);
    addLocalWallCollider(-w / 2 + sideSegW / 2, d / 2 - wallThick / 2, sideSegW, wallThick, hFrontL);
    addLocalWallCollider(w / 2 - sideSegW / 2, d / 2 - wallThick / 2, sideSegW, wallThick, hFrontR);
    if (decay !== 'ruins') {
      addLocalWallCollider(0, d / 2 - wallThick / 2, doorWidth, wallThick, 0.62, 0.4 + h - 0.62);
    }

    if (decay === 'intact' || decay === 'sagging') {
      const sagAngle = decay === 'sagging' ? 0.09 : 0;
      const frontRoofW = w + roofOverhang * 1.95;
      ctx.addLocalOrientedBoxCollider(
        x, y, z, rotY,
        0, 0.4 + h + roofH / 2 - 0.16, slopeRun / 2,
        frontRoofW, roofThick, slopeLen,
        slopeAngle, 0, sagAngle, true
      );
      const backW = decay === 'sagging' ? frontRoofW * 0.58 : frontRoofW;
      const backShiftX = decay === 'sagging' ? -frontRoofW * 0.2 : 0;
      ctx.addLocalOrientedBoxCollider(
        x, y, z, rotY,
        backShiftX, 0.4 + h + roofH / 2 - 0.16, -slopeRun / 2,
        backW, roofThick, slopeLen,
        -slopeAngle, 0, -sagAngle * 0.8, true
      );
      const gableBaseY = 0.4 + h;
      const gableBand1H = roofH * 0.42;
      const gableBand2H = roofH * 0.36;
      ctx.addLocalOrientedBoxCollider(
        x, y, z, rotY,
        -w / 2 + 0.11, gableBaseY + gableBand1H * 0.5, 0,
        0.22, gableBand1H, d * 0.72, 0, 0, 0, true
      );
      ctx.addLocalOrientedBoxCollider(
        x, y, z, rotY,
        -w / 2 + 0.11, gableBaseY + gableBand1H + gableBand2H * 0.5, 0,
        0.22, gableBand2H, d * 0.36, 0, 0, 0, true
      );
      if (decay === 'intact') {
        ctx.addLocalOrientedBoxCollider(
          x, y, z, rotY,
          w / 2 - 0.11, gableBaseY + gableBand1H * 0.5, 0,
          0.22, gableBand1H, d * 0.72, 0, 0, 0, true
        );
        ctx.addLocalOrientedBoxCollider(
          x, y, z, rotY,
          w / 2 - 0.11, gableBaseY + gableBand1H + gableBand2H * 0.5, 0,
          0.22, gableBand2H, d * 0.36, 0, 0, 0, true
        );
        ctx.addLocalOrientedBoxCollider(
          x, y, z, rotY,
          -w * 0.22, 0.4 + h + roofH - 0.16, -0.35,
          0.72, 1.55, 0.72, 0, 0, 0, true
        );
      }
    }
  }

  function buildSplitPoleFence(x0: number, z0: number, x1: number, z1: number): void {
    const parts: THREE.BufferGeometry[] = [];
    const totalLen = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / totalLen;
    const dz = (z1 - z0) / totalLen;
    const yaw = Math.atan2(dx, dz);
    const bays = Math.max(2, Math.floor(totalLen / 1.9));

    for (let i = 0; i <= bays; i++) {
      const px = x0 + dx * (i / bays) * totalLen;
      const pz = z0 + dz * (i / bays) * totalLen;
      const py = getTerrainHeight(px, pz);
      for (const side of [-0.07, 0.07]) {
        const sx = px - dz * side;
        const sz = pz + dx * side;
        parts.push(makeCylPart(0.036, 0.044, 1.18, 5, sx, py + 0.54, sz, 0, 0, 0));
      }
      if (i < bays) {
        const nx = x0 + dx * ((i + 0.5) / bays) * totalLen;
        const nz = z0 + dz * ((i + 0.5) / bays) * totalLen;
        const ny = getTerrainHeight(nx, nz);
        for (let r = 0; r < 3; r++) {
          const g = new THREE.CylinderGeometry(0.025, 0.032, 2.45, 5, 1);
          g.rotateX(Math.PI * 0.5 - 0.22);
          g.rotateY(yaw);
          g.translate(nx, ny + 0.32 + r * 0.25, nz);
          parts.push(prepNonIndexed(g));
        }

        const segLen = totalLen / bays;
        const bw = Math.abs(dx * segLen) + Math.abs(dz * 0.34);
        const bd = Math.abs(dz * segLen) + Math.abs(dx * 0.34);
        ctx.addBoxCollider(nx, nz, bw, bd, ny, 0.92, true);
      }
    }

    const fenceGeo = mergeGeometries(parts)!;
    const fenceMesh = new THREE.Mesh(fenceGeo, assets.timberTrimMat);
    fenceMesh.castShadow = ctx.shadows;
    fenceMesh.receiveShadow = true;
    ctx.resources.add(fenceMesh);
    ctx.structureNodes.push({
      obj: fenceMesh,
      x: (x0 + x1) * 0.5,
      z: (z0 + z1) * 0.5,
      maxDistSq: 220 * 220,
    });
    ctx.resources.own(fenceGeo);
  }

  function buildWaterWell(wx: number, wz: number, label: string, stale: boolean): void {
    const wy = getTerrainHeight(wx, wz);
    const wellGroup = new THREE.Group();
    wellGroup.position.set(wx, wy, wz);
    wellGroup.userData.debugLayer = 'well';
    wellGroup.userData.debugName = stale ? `Decrepit Well (${label})` : `Spring Well (${label})`;
    wellGroup.userData.debugMeta = { stale, label };

    const wellShadowGeo = new THREE.PlaneGeometry(3.2, 3.2);
    wellShadowGeo.rotateX(-Math.PI / 2);
    const wellShadow = new THREE.Mesh(wellShadowGeo, assets.contactShadowMat);
    wellShadow.position.y = 0.03;
    wellGroup.add(wellShadow);
    ctx.resources.own(wellShadowGeo);

    const stoneGeo = new THREE.CylinderGeometry(0.92, 1.04, stale ? 0.84 : 1.0, 12);
    const stoneCyl = new THREE.Mesh(stoneGeo, assets.stonePlinthMat);
    stoneCyl.position.y = stale ? 0.42 : 0.5;
    if (stale) stoneCyl.rotation.z = 0.07;
    stoneCyl.castShadow = ctx.shadows;
    stoneCyl.receiveShadow = true;
    wellGroup.add(stoneCyl);
    ctx.resources.own(stoneGeo);

    const waterDiscGeo = new THREE.CircleGeometry(0.76, 12);
    waterDiscGeo.rotateX(-Math.PI / 2);
    const waterDisc = new THREE.Mesh(
      waterDiscGeo,
      stale ? assets.staleWellWaterMat : assets.cleanWellWaterMat
    );
    waterDisc.position.y = stale ? 0.72 : 0.84;
    wellGroup.add(waterDisc);
    ctx.resources.own(waterDiscGeo);

    if (!stale) {
      const postGeo = new THREE.BoxGeometry(0.14, 2.0, 0.14);
      const roofGeo = new THREE.ConeGeometry(1.42, 0.96, 4);
      ctx.resources.own(postGeo, roofGeo);
      [-0.85, 0.85].forEach((px) => {
        const post = new THREE.Mesh(postGeo, assets.timberTrimMat);
        post.position.set(px, 1.5, 0);
        post.castShadow = ctx.shadows;
        wellGroup.add(post);
      });
      const wellRoof = new THREE.Mesh(roofGeo, assets.shingleMat);
      wellRoof.position.y = 2.85;
      wellRoof.rotation.y = Math.PI / 4;
      wellRoof.castShadow = ctx.shadows;
      wellGroup.add(wellRoof);
      ctx.shelters.add({
        id: `well_roof_${wx.toFixed(1)}_${wz.toFixed(1)}`,
        x: wx,
        z: wz,
        yaw: 0,
        halfW: 1.38,
        halfD: 1.38,
        floorY: wy,
        shape: 'circle',
        roofOnly: true,
        roof: { eaveY: wy + 2.37, rise: 0.96, axis: 'x' },
      });
      const wellRoofCol = ctx.addBoxCollider(wx, wz, 1.9, 1.9, wy + 2.37, 0.96, false);
      wellRoofCol.overhead = true;
    } else {
      const brokenPostGeo = new THREE.BoxGeometry(0.13, 1.25, 0.13);
      ctx.resources.own(brokenPostGeo);
      const post = new THREE.Mesh(brokenPostGeo, assets.timberTrimMat);
      post.position.set(-0.82, 1.0, 0);
      post.rotation.z = 0.22;
      wellGroup.add(post);
    }

    ctx.resources.add(wellGroup);
    ctx.structureNodes.push({ obj: wellGroup, x: wx, z: wz, maxDistSq: 220 * 220 });
    ctx.circleColliders.push({ x: wx, z: wz, r: 1.1 });

    ctx.registerInteractive(stoneCyl, {
      name: stale ? t('prop.wellDecrepitName', { label }) : t('prop.wellCleanName', { label }),
      desc: stale ? t('prop.wellDecrepitDesc') : t('prop.wellCleanDesc'),
      getName: () =>
        stale ? t('prop.wellDecrepitName', { label }) : t('prop.wellCleanName', { label }),
      getDesc: () => (stale ? t('prop.wellDecrepitDesc') : t('prop.wellCleanDesc')),
      onUse: () => {
        ctx.sound.playFootstep('water');
        if (ctx.handlers?.onRefillWell) {
          ctx.handlers.onRefillWell(stale ? 'stale_well' : 'clean_well', label);
        } else {
          ctx.showToast(stale ? t('prop.wellDecrepitUse') : t('prop.wellCleanUse'));
        }
      },
      onTouch: () => ctx.showToast(stale ? t('prop.wellDecrepitTouch') : t('prop.wellCleanTouch')),
    });
  }

  // Build all 4 Procedural Villages
  for (let vi = 0; vi < bp.villages.length; vi++) {
    const v = bp.villages[vi];
    for (const b of v.buildings) {
      buildEstonianLogHouse(v.x + b.offsetX, v.z + b.offsetZ, b.rotY, {
        w: b.w,
        d: b.d,
        h: b.h,
        roofStyle: b.roofStyle,
        warmWood: b.warmWood,
        porch: b.porch,
        abandoned: b.abandoned,
        decayState: b.decayState,
        name: b.name,
        pantry: b === v.buildings[0],
      });
    }
    for (const f of v.fences) {
      buildSplitPoleFence(f.x0, f.z0, f.x1, f.z1);
    }
    buildWaterWell(v.x - 4.5, v.z + 9.5, v.name, false);
  }

  // Build Abandoned Decay Huts on Elevated Swamp Islands + Usable or Decrepit Wells
  for (const isl of bp.swampIslands) {
    if (!isl.hut) continue;
    buildEstonianLogHouse(isl.x, isl.z, isl.hut.rotY, {
      w: isl.hut.w,
      d: isl.hut.d,
      h: isl.hut.h,
      roofStyle: isl.hut.roofStyle,
      abandoned: true,
      decayState: isl.hut.decayState,
      porch: isl.hut.decayState === 'intact',
      name: `${isl.name} — ${isl.hut.name}`,
    });

    const wellX = isl.x + Math.cos(isl.hut.rotY + 0.7) * (isl.hut.w * 0.5 + 3.2);
    const wellZ = isl.z + Math.sin(isl.hut.rotY + 0.7) * (isl.hut.d * 0.5 + 3.2);
    if (getTerrainHeight(wellX, wellZ) > SWAMP_WATER_Y + 0.08) {
      const isDecrepit = isl.hut.decayState !== 'intact';
      buildWaterWell(wellX, wellZ, isl.name, isDecrepit);
    }
  }

  return { buildEstonianLogHouse };
}
