import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MushroomSpecies } from '../../game/gameLogic';
import { ITEM_CATALOG, ItemId, MUSHROOM_TO_ITEM_ID } from '../../game/itemCatalog';
import { getItemName, t } from '../../i18n/i18n';
import {
  SWAMP_WATER_Y,
  distToRoadDetail,
  getActiveBlueprint,
  getSwampFactor,
  getTerrainHeight,
  roadCenterX,
} from '../terrainMath';
import { makeCylPart, prepNonIndexed } from './propMaterials';
import { InteractiveEntry, PropBuildContext } from './propTypes';

export interface DynamicPropsSystem {
  spawnFirewoodLog: (x: number, z: number, yOverride?: number) => InteractiveEntry;
  shatterWoodAt: (x: number, y: number, z: number, yaw: number, pieceCount?: number) => number;
  collectPickupItem: (entry: InteractiveEntry) => ItemId | null;
  getBreakableStumps: () => Array<{ x: number; z: number; entry: InteractiveEntry }>;
  getPickupItems: () => Array<{ x: number; z: number; entry: InteractiveEntry }>;
  spawnPickupItemAt: (
    x: number,
    z: number,
    itemId: ItemId
  ) => { x: number; y: number; z: number; itemId: ItemId };
}

export function createDynamicPropsSystem(
  ctx: PropBuildContext,
  spawnMushroom: (x: number, z: number, species: MushroomSpecies) => void
): DynamicPropsSystem {
  const bp = getActiveBlueprint();

  const crateMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.plankWood,
    normalMap: ctx.textures.plankNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    color: 0x856a49,
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.48,
  });
  const barrelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.95, 14);
  const barrelMat = new THREE.MeshStandardMaterial({
    color: 0x5c372a,
    roughness: 0.58,
    metalness: 0.45,
  });
  const logGeo = new THREE.CylinderGeometry(0.11, 0.12, 0.65, 8);
  const logMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.birchBark,
    normalMap: ctx.textures.birchNormal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.88,
    metalness: 0.0,
  });
  const stonePropMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.boulderGranite,
    normalMap: ctx.textures.fieldstoneNormal,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughness: 0.86,
    metalness: 0.02,
  });
  const lanternMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1a1c1e,
    metalness: 0.78,
    roughness: 0.38,
    envMapIntensity: 1.1,
  });
  const lanternGlassMat = new THREE.MeshStandardMaterial({
    color: 0xdce4e6,
    roughness: 0.08,
    metalness: 0.12,
    envMapIntensity: 1.4,
    transparent: true,
    opacity: 0.45,
  });
  ctx.resources.own(
    crateMat,
    barrelGeo,
    barrelMat,
    logGeo,
    logMat,
    stonePropMat,
    lanternMetalMat,
    lanternGlassMat
  );

  const lanternMetalGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(makeCylPart(0.115, 0.135, 0.075, 14, 0, -0.145, 0));
    parts.push(makeCylPart(0.08, 0.115, 0.035, 14, 0, -0.09, 0));
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.11, -0.1, 0),
        new THREE.Vector3(side * 0.14, 0.02, 0),
        new THREE.Vector3(side * 0.11, 0.15, 0),
        new THREE.Vector3(side * 0.045, 0.19, 0),
      ]);
      parts.push(prepNonIndexed(new THREE.TubeGeometry(curve, 8, 0.012, 5, false)));
    }
    const wireRing1 = new THREE.TorusGeometry(0.095, 0.004, 4, 14);
    wireRing1.rotateX(Math.PI / 2);
    wireRing1.translate(0, 0.02, 0);
    parts.push(prepNonIndexed(wireRing1));
    parts.push(makeCylPart(0.06, 0.085, 0.055, 12, 0, 0.145, 0));
    parts.push(makeCylPart(0.045, 0.065, 0.04, 12, 0, 0.185, 0));
    parts.push(makeCylPart(0.09, 0.09, 0.012, 12, 0, 0.21, 0));
    const bailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.125, 0.06, 0),
      new THREE.Vector3(-0.12, 0.29, 0),
      new THREE.Vector3(0, 0.36, 0),
      new THREE.Vector3(0.12, 0.29, 0),
      new THREE.Vector3(0.125, 0.06, 0),
    ]);
    parts.push(prepNonIndexed(new THREE.TubeGeometry(bailCurve, 12, 0.005, 4, false)));
    return mergeGeometries(parts)!;
  })();
  const lanternGlobeGeo = new THREE.CylinderGeometry(0.072, 0.086, 0.17, 12);
  const lanternFlameGeo = new THREE.ConeGeometry(0.024, 0.065, 6);
  ctx.resources.own(lanternMetalGeo, lanternGlobeGeo, lanternFlameGeo);

  function spawnCrate(x: number, z: number, size = 0.72): void {
    const y = getTerrainHeight(x, z) + size / 2;
    const crateGeo = new THREE.BoxGeometry(size, size, size);
    ctx.resources.own(crateGeo);
    const mesh = new THREE.Mesh(crateGeo, crateMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = ctx.shadows;
    mesh.receiveShadow = true;
    ctx.resources.add(mesh);
    ctx.registerInteractive(mesh, {
      name: t('prop.woodenCrate'),
      desc: t('prop.woodenCrateDesc'),
      getName: () => t('prop.woodenCrate'),
      getDesc: () => t('prop.woodenCrateDesc'),
      carryable: true,
      kickable: true,
      breakable: true,
      isDynamic: true,
      materialType: 'wood',
      radius: size * 0.55,
      mass: 1.8,
      onGroundYOffset: size * 0.5,
    });
  }

  function spawnBarrel(x: number, z: number): void {
    const y = getTerrainHeight(x, z) + 0.95 / 2;
    const mesh = new THREE.Mesh(barrelGeo, barrelMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = ctx.shadows;
    mesh.receiveShadow = true;
    ctx.resources.add(mesh);
    ctx.registerInteractive(mesh, {
      name: t('prop.oilDrum'),
      desc: t('prop.oilDrumDesc'),
      getName: () => t('prop.oilDrum'),
      getDesc: () => t('prop.oilDrumDesc'),
      carryable: false,
      kickable: true,
      isDynamic: true,
      materialType: 'metal',
      radius: 0.42,
      mass: 2.5,
      onGroundYOffset: 0.95 / 2,
    });
  }

  function spawnLantern(x: number, z: number, initiallyLit = true): void {
    const y = getTerrainHeight(x, z) + 0.19;
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const chassis = new THREE.Mesh(lanternMetalGeo, lanternMetalMat);
    chassis.castShadow = ctx.shadows;
    const globe = new THREE.Mesh(lanternGlobeGeo, lanternGlassMat);
    globe.position.y = 0.02;

    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffba49 });
    ctx.resources.own(flameMat);
    const flame = new THREE.Mesh(lanternFlameGeo, flameMat);
    flame.position.y = -0.02;
    flame.visible = initiallyLit;

    group.add(chassis, globe, flame);
    ctx.resources.add(group);

    let lit = initiallyLit;
    ctx.virtualPointLights.push({
      anchor: group,
      yOffset: 0.04,
      colorHex: 0xffaa44,
      baseIntensity: 1.85,
      distance: 16,
      decay: 1.5,
      flicker: false,
      isLit: () => lit,
    });

    ctx.registerInteractive(group, {
      name: t('prop.lanternName'),
      desc: t('prop.lanternDesc'),
      getName: () => t('prop.lanternName'),
      getDesc: () => t('prop.lanternDesc'),
      carryable: true,
      kickable: true,
      isDynamic: true,
      radius: 0.22,
      mass: 0.7,
      onGroundYOffset: 0.18,
      onTouch: () => {
        lit = !lit;
        flame.visible = lit;
        ctx.showToast(lit ? t('prop.lanternLit') : t('prop.lanternDimmed'));
      },
    });
  }

  const splitWoodMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.birchBark,
    color: 0xd9c29c,
    roughness: 0.78,
  });
  const deadwoodBarkMat = new THREE.MeshStandardMaterial({
    map: ctx.textures.spruceBark,
    color: 0x76624e,
    roughness: 0.93,
  });
  const stumpMossMat = new THREE.MeshStandardMaterial({
    color: 0x4d6b38,
    roughness: 0.92,
  });
  const splitPieceGeo = new THREE.CylinderGeometry(0.068, 0.082, 0.56, 6);
  const barkCapGeo = new THREE.BoxGeometry(0.52, 0.04, 0.12);
  const chipGeo = new THREE.BoxGeometry(0.11, 0.035, 0.22);
  const woodHitProxyGeo = new THREE.SphereGeometry(0.42, 6, 6);
  const woodHitProxyMat = new THREE.MeshBasicMaterial({ visible: false });
  ctx.resources.own(
    splitWoodMat,
    deadwoodBarkMat,
    stumpMossMat,
    splitPieceGeo,
    barkCapGeo,
    chipGeo,
    woodHitProxyGeo,
    woodHitProxyMat
  );

  const breakableStumps: Array<{ x: number; z: number; entry: InteractiveEntry }> = [];
  const pickupItems: Array<{ x: number; z: number; entry: InteractiveEntry }> = [];

  function spawnSplitWoodPiece(
    x: number,
    y: number,
    z: number,
    vx = 0,
    vy = 0,
    vz = 0
  ): InteractiveEntry {
    const piece = new THREE.Group();
    const core = new THREE.Mesh(splitPieceGeo, splitWoodMat);
    core.rotation.z = Math.PI / 2;
    core.castShadow = ctx.shadows;
    core.receiveShadow = true;
    const barkCap = new THREE.Mesh(barkCapGeo, deadwoodBarkMat);
    barkCap.position.y = 0.065;
    const hitProxy = new THREE.Mesh(woodHitProxyGeo, woodHitProxyMat);
    hitProxy.position.y = 0.05;
    piece.add(core, barkCap, hitProxy);
    piece.position.set(x, y, z);
    piece.rotation.y = ctx.rand() * Math.PI * 2;
    ctx.resources.add(piece);

    const entry = ctx.registerInteractive(piece, {
      name: t('prop.splitFirewoodName'),
      desc: t('prop.splitFirewoodDesc'),
      getName: () => t('prop.splitFirewoodName'),
      getDesc: () => t('prop.splitFirewoodDesc'),
      pickupItemId: 'firewood',
      pickupLabel: t('prompt.takeWood'),
      getPickupLabel: () => t('prompt.takeWood'),
      carryable: false,
      kickable: true,
      isDynamic: true,
      radius: 0.16,
      mass: 0.75,
      onGroundYOffset: 0.09,
    });
    entry.vel.set(vx, vy, vz);
    entry.angVel.set((ctx.rand() - 0.5) * 6, (ctx.rand() - 0.5) * 6, (ctx.rand() - 0.5) * 6);
    entry.resting = vx === 0 && vy === 0 && vz === 0;
    pickupItems.push({ x, z, entry });
    return entry;
  }

  function shatterWoodAt(
    x: number,
    _y: number,
    z: number,
    yaw: number,
    pieceCount?: number
  ): number {
    const count = pieceCount ?? 3 + (ctx.rand() > 0.45 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const ang = yaw + (i / count) * Math.PI * 2 + (ctx.rand() - 0.5) * 0.5;
      const dist = 0.28 + ctx.rand() * 0.55;
      const px = x + Math.cos(ang) * dist;
      const pz = z + Math.sin(ang) * dist;
      const py = getTerrainHeight(px, pz) + 0.24;
      spawnSplitWoodPiece(
        px,
        py,
        pz,
        Math.cos(ang) * (1.7 + ctx.rand() * 1.3),
        1.7 + ctx.rand() * 1.0,
        Math.sin(ang) * (1.7 + ctx.rand() * 1.3)
      );
    }

    for (let c = 0; c < 4; c++) {
      const chip = new THREE.Mesh(chipGeo, c % 2 === 0 ? splitWoodMat : deadwoodBarkMat);
      const ca = ctx.rand() * Math.PI * 2;
      const cd = 0.15 + ctx.rand() * 0.72;
      const cx = x + Math.cos(ca) * cd;
      const cz = z + Math.sin(ca) * cd;
      chip.position.set(cx, getTerrainHeight(cx, cz) + 0.025, cz);
      chip.rotation.y = ctx.rand() * Math.PI;
      ctx.resources.add(chip);
    }
    return count;
  }

  function spawnLyingStump(x: number, z: number): void {
    const y = getTerrainHeight(x, z);
    if (y <= SWAMP_WATER_Y + 0.14) return;
    const yaw = ctx.rand() * Math.PI * 2;
    const scale = 0.88 + ctx.rand() * 0.34;

    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;

    const trunkLen = 1.65 * scale;
    const trunkR = 0.23 * scale;
    const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.82, trunkR * 1.12, trunkLen, 8);
    const trunk = new THREE.Mesh(trunkGeo, deadwoodBarkMat);
    trunk.rotation.z = Math.PI / 2;
    trunk.position.set(0, trunkR * 0.82, 0);
    trunk.castShadow = ctx.shadows;
    trunk.receiveShadow = true;

    const heartGeo = new THREE.CylinderGeometry(trunkR * 0.74, trunkR * 0.74, 0.04, 8);
    const heartEnd = new THREE.Mesh(heartGeo, splitWoodMat);
    heartEnd.rotation.z = Math.PI / 2;
    heartEnd.position.set(trunkLen * 0.5 + 0.01, trunkR * 0.82, 0);

    const rootGeo = new THREE.ConeGeometry(trunkR * 0.52, 0.62 * scale, 5);
    const rootA = new THREE.Mesh(rootGeo, deadwoodBarkMat);
    rootA.position.set(-trunkLen * 0.52, trunkR * 1.1, 0.22 * scale);
    rootA.rotation.set(0.55, 0, 1.05);
    const rootB = new THREE.Mesh(rootGeo, deadwoodBarkMat);
    rootB.position.set(-trunkLen * 0.52, trunkR * 0.75, -0.24 * scale);
    rootB.rotation.set(-0.6, 0, 1.25);

    const stubGeo = new THREE.CylinderGeometry(0.055 * scale, 0.085 * scale, 0.48 * scale, 6);
    const stub = new THREE.Mesh(stubGeo, deadwoodBarkMat);
    stub.position.set(0.2 * scale, trunkR * 1.45, 0.12 * scale);
    stub.rotation.set(0.35, 0, -0.55);

    const mossGeo = new THREE.BoxGeometry(0.68 * scale, 0.05, 0.24 * scale);
    const moss = new THREE.Mesh(mossGeo, stumpMossMat);
    moss.position.set(-0.12 * scale, trunkR * 1.62, 0);

    g.add(trunk, heartEnd, rootA, rootB, stub, moss);
    ctx.resources.add(g);
    ctx.resources.own(trunkGeo, heartGeo, rootGeo, stubGeo, mossGeo);

    let kicksRemaining = 2;
    const stumpEntry = ctx.registerInteractive(g, {
      name: t('prop.lyingStumpName'),
      desc: t('prop.lyingStumpDesc'),
      getName: () => t('prop.lyingStumpName'),
      getDesc: () => t('prop.lyingStumpDesc'),
      kickable: true,
      breakable: true,
      radius: 0.65 * scale,
      mass: 4.5,
      onTouch: () => ctx.showToast(t('prop.lyingStumpTouch')),
    });

    stumpEntry.onKick = () => {
      if (stumpEntry.gathered) return;
      kicksRemaining--;
      if (kicksRemaining > 0) {
        g.rotation.z += 0.12;
        g.rotation.y += 0.09;
        g.updateMatrixWorld(true);
        if (ctx.handlers?.onStumpKick) {
          ctx.handlers.onStumpKick({ broken: false, material: 'wood', x, y: y + 0.25, z });
        } else {
          ctx.sound.playImpact(1.1);
        }
        ctx.showToast(t('prop.stumpCracked'));
        return;
      }

      stumpEntry.gathered = true;
      ctx.interactiveIndex.delete(stumpEntry);
      g.visible = false;
      if (ctx.handlers?.onStumpKick) {
        ctx.handlers.onStumpKick({ broken: true, material: 'wood', x, y: y + 0.25, z });
      } else {
        ctx.sound.playImpact(1.45);
      }
      const pieceCount = shatterWoodAt(x, y, z, yaw);
      ctx.showToast(t('prop.stumpShattered', { count: pieceCount }));
    };

    breakableStumps.push({ x, z, entry: stumpEntry });
  }

  function spawnFirewoodLog(x: number, z: number, yOverride?: number): InteractiveEntry {
    const y = yOverride ?? getTerrainHeight(x, z) + 0.12;
    const logGroup = new THREE.Group();
    logGroup.position.set(x, y, z);
    logGroup.rotation.y = ctx.rand() * Math.PI;
    const mesh = new THREE.Mesh(logGeo, logMat);
    mesh.rotation.z = Math.PI / 2;
    mesh.castShadow = ctx.shadows;
    mesh.receiveShadow = true;
    const hitProxy = new THREE.Mesh(woodHitProxyGeo, woodHitProxyMat);
    hitProxy.position.y = 0.04;
    logGroup.add(mesh, hitProxy);
    ctx.resources.add(logGroup);
    const entry = ctx.registerInteractive(logGroup, {
      name: t('prop.birchFirewoodName'),
      desc: t('prop.birchFirewoodDesc'),
      getName: () => t('prop.birchFirewoodName'),
      getDesc: () => t('prop.birchFirewoodDesc'),
      pickupItemId: 'firewood',
      pickupLabel: t('prompt.takeWood'),
      getPickupLabel: () => t('prompt.takeWood'),
      carryable: false,
      kickable: true,
      isDynamic: true,
      radius: 0.2,
      mass: 0.9,
      onGroundYOffset: 0.12,
    });
    pickupItems.push({ x, z, entry });
    return entry;
  }

  function spawnStone(x: number, z: number): void {
    const r = 0.18 + ctx.rand() * 0.12;
    const y = getTerrainHeight(x, z) + r;
    const stoneGeo = new THREE.DodecahedronGeometry(r, 0);
    ctx.resources.own(stoneGeo);
    const mesh = new THREE.Mesh(stoneGeo, stonePropMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = ctx.shadows;
    mesh.receiveShadow = true;
    ctx.resources.add(mesh);
    ctx.registerInteractive(mesh, {
      name: t('prop.fieldstoneName'),
      desc: t('prop.fieldstoneDesc'),
      getName: () => t('prop.fieldstoneName'),
      getDesc: () => t('prop.fieldstoneDesc'),
      carryable: true,
      kickable: true,
      isDynamic: true,
      radius: r,
      mass: 1.2,
      onGroundYOffset: r,
    });
  }

  for (let vi = 0; vi < bp.villages.length; vi++) {
    const v = bp.villages[vi];
    spawnLantern(v.x + 1.8, v.z + 11.2, !v.abandoned);
    spawnCrate(v.x - 1.2, v.z + 5.2);
    spawnCrate(v.x - 2.0, v.z + 5.6, 0.58);
    spawnBarrel(v.x - 6.2, v.z + 4.8);
    for (let k = 0; k < 3; k++) {
      spawnFirewoodLog(v.x + 3.2 + (ctx.rand() - 0.5) * 1.4, v.z + 7.2 + (ctx.rand() - 0.5) * 1.4);
    }
    spawnLyingStump(v.x - 9.5, v.z + 15.0);
    spawnLyingStump(v.x + 11.5, v.z + 13.5);
  }
  spawnLyingStump(roadCenterX(0) - 4.4, -0.8);
  spawnLyingStump(roadCenterX(-8) + 4.8, -8.5);

  for (const isl of bp.swampIslands) {
    if (isl.hut) {
      spawnCrate(isl.x + 3.4, isl.z + 1.8, 0.58);
      if (isl.hut.decayState !== 'ruins') {
        spawnLantern(isl.x - 2.8, isl.z + 2.2, false);
      }
      spawnLyingStump(isl.x - 3.6, isl.z - 2.8);
    }
  }
  for (let i = 0; i < 55; i++) {
    const lx = (ctx.rand() - 0.5) * 920;
    const lz = (ctx.rand() - 0.5) * 920;
    if (getSwampFactor(lx, lz) < 0.32 && distToRoadDetail(lx, lz).dist > 4.2) {
      spawnLyingStump(lx, lz);
    }
  }
  for (let i = 0; i < 42; i++) {
    const sx = (ctx.rand() - 0.5) * 900;
    const sz = (ctx.rand() - 0.5) * 900;
    if (getSwampFactor(sx, sz) < 0.3 && distToRoadDetail(sx, sz).dist > 3.5) {
      spawnStone(sx, sz);
    }
  }

  return {
    spawnFirewoodLog,
    shatterWoodAt,
    collectPickupItem: (entry) => {
      if (!entry.pickupItemId || entry.gathered) return null;
      entry.gathered = true;
      ctx.interactiveIndex.delete(entry);
      ctx.markLightShadowsDirty();
      entry.resting = true;
      entry.mesh.visible = false;
      ctx.sound.playImpact(0.42);
      return entry.pickupItemId;
    },
    getBreakableStumps: () => breakableStumps.filter((s) => !s.entry.gathered),
    getPickupItems: () =>
      pickupItems
        .filter((p) => !p.entry.gathered)
        .map((p) => ({ x: p.entry.mesh.position.x, z: p.entry.mesh.position.z, entry: p.entry })),
    spawnPickupItemAt: (x, z, itemId) => {
      for (const [sp, mItemId] of Object.entries(MUSHROOM_TO_ITEM_ID) as Array<[MushroomSpecies, ItemId]>) {
        if (mItemId === itemId) {
          spawnMushroom(x, z, sp);
          return { x, y: getTerrainHeight(x, z), z, itemId };
        }
      }
      if (itemId === 'firewood') {
        spawnFirewoodLog(x, z);
        return { x, y: getTerrainHeight(x, z) + 0.12, z, itemId };
      }

      const def = ITEM_CATALOG[itemId];
      const y = getTerrainHeight(x, z) + 0.16;
      const itemGroup = new THREE.Group();
      itemGroup.position.set(x, y, z);
      itemGroup.rotation.y = ctx.rand() * Math.PI * 2;
      itemGroup.userData.debugLayer = 'pickup';
      itemGroup.userData.debugName = def.name;
      itemGroup.userData.debugMeta = { itemId, category: def.category, weightKg: def.weightKg };

      const catColor =
        def.category === 'water'
          ? 0x3b7699
          : def.category === 'food'
            ? 0x9c6538
            : def.category === 'clothing'
              ? 0x3c5942
              : def.category === 'camp'
                ? 0x5c6d45
                : def.category === 'navigation'
                  ? 0xb58d46
                  : 0x4f565d;
      const mat = new THREE.MeshStandardMaterial({
        color: catColor,
        roughness: def.category === 'water' ? 0.35 : 0.78,
        metalness: def.category === 'water' || def.category === 'gear' ? 0.25 : 0.04,
      });
      const bodyGeo =
        def.category === 'water'
          ? new THREE.CylinderGeometry(0.085, 0.085, 0.28, 12)
          : def.category === 'camp'
            ? new THREE.CylinderGeometry(0.14, 0.14, 0.42, 10)
            : new THREE.BoxGeometry(0.28, 0.16, 0.22);
      if (def.category === 'camp') {
        bodyGeo.rotateZ(Math.PI / 2);
      }
      const bodyMesh = new THREE.Mesh(bodyGeo, mat);
      bodyMesh.castShadow = ctx.shadows;
      bodyMesh.receiveShadow = true;
      const hitProxy = new THREE.Mesh(woodHitProxyGeo, woodHitProxyMat);
      itemGroup.add(bodyMesh, hitProxy);
      ctx.resources.add(itemGroup);
      ctx.resources.own(mat, bodyGeo);

      const entry = ctx.registerInteractive(itemGroup, {
        name: getItemName(itemId),
        desc: def.description,
        getName: () => getItemName(itemId),
        getDesc: () => def.description,
        pickupItemId: itemId,
        pickupLabel: getItemName(itemId),
        getPickupLabel: () => getItemName(itemId),
        carryable: false,
        kickable: true,
        isDynamic: true,
        radius: 0.2,
        mass: Math.max(0.3, def.weightKg),
        onGroundYOffset: 0.14,
      });
      entry.resting = true;
      pickupItems.push({ x, z, entry });
      ctx.markLightShadowsDirty();
      return { x, y, z, itemId };
    },
  };
}
