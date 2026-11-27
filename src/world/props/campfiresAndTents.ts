import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ShelterQuality } from '../../game/survivalEngine';
import { t } from '../../i18n/i18n';
import { createCampfireFireVisual } from '../campfireFire';
import { containsFootprint } from '../shelterGeometry';
import { BoxCollider } from '../spatialPhysics';
import { SWAMP_WATER_Y, clamp, getActiveBlueprint, getTerrainHeight } from '../terrainMath';
import { PropSharedAssets, prepNonIndexed } from './propMaterials';
import {
  CampfireEntry,
  CampfireInfo,
  InteractiveEntry,
  PropBuildContext,
  StructureAcousticsInfo,
  TentEntry,
  TentInfo,
  WorldEnvironmentAtPoint,
} from './propTypes';

export interface CampfiresSystem {
  campfires: CampfireEntry[];
  primaryCampfirePos: { x: number; y: number; z: number };
  buildCampfirePit: (
    id: string,
    label: string,
    fx: number,
    fz: number,
    initiallyLit: boolean
  ) => CampfireEntry;
  setCampfireLit: (id: string, lit: boolean) => boolean;
  getCampfireInfo: (id: string) => CampfireInfo | null;
  getCampfires: () => CampfireInfo[];
  throwFirewoodAtCampfire: (
    campfireId: string,
    startX: number,
    startY: number,
    startZ: number,
    spawnFirewoodLog: (x: number, z: number, yOverride?: number) => InteractiveEntry
  ) => { ok: boolean; campfire?: CampfireInfo };
  feedCampfireWithLog: (campfireId: string) => { ok: boolean; lit: boolean; campfire?: CampfireInfo };
  feedDynamicFirewoodIntoCampfires: () => Array<{
    campfire: CampfireInfo;
    lit: boolean;
    x: number;
    y: number;
    z: number;
  }>;
  spawnCampfireAt: (x: number, z: number, lit?: boolean) => CampfireInfo;
  getEnvironmentStateAt: (x: number, z: number) => WorldEnvironmentAtPoint;
  getStructureAcousticsAt: (x: number, z: number) => StructureAcousticsInfo;
}

export function createCampfiresSystem(
  ctx: PropBuildContext,
  assets: PropSharedAssets
): CampfiresSystem {
  const bp = getActiveBlueprint();
  const campfires: CampfireEntry[] = [];
  const campfireHitProxyGeo = new THREE.CylinderGeometry(0.86, 0.92, 0.95, 10);
  const campfireHitProxyMat = new THREE.MeshBasicMaterial({ visible: false });
  ctx.resources.own(campfireHitProxyGeo, campfireHitProxyMat);

  function buildCampfirePit(
    id: string,
    label: string,
    fx: number,
    fz: number,
    initiallyLit: boolean
  ): CampfireEntry {
    const fy = getTerrainHeight(fx, fz);
    const pit = new THREE.Group();
    pit.position.set(fx, fy, fz);
    pit.userData.debugLayer = 'campfire';
    pit.userData.debugName = `Campfire (${label})`;
    pit.userData.debugMeta = { id, initiallyLit };
    const stoneParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const sg = new THREE.DodecahedronGeometry(0.22, 0);
      sg.translate(Math.cos(a) * 0.72, 0.12, Math.sin(a) * 0.72);
      stoneParts.push(prepNonIndexed(sg));
    }
    const ringGeo = mergeGeometries(stoneParts)!;
    const ringMesh = new THREE.Mesh(ringGeo, assets.stonePlinthMat);
    ringMesh.castShadow = ctx.shadows;
    pit.add(ringMesh);
    ctx.resources.own(ringGeo);

    const ashBedGeo = new THREE.CircleGeometry(0.95, 16);
    ashBedGeo.rotateX(-Math.PI / 2);
    const ashBedMat = new THREE.MeshStandardMaterial({
      color: 0x26211c,
      roughness: 0.98,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const ashBed = new THREE.Mesh(ashBedGeo, ashBedMat);
    ashBed.position.y = 0.03;
    ashBed.receiveShadow = true;
    pit.add(ashBed);
    ctx.resources.own(ashBedGeo, ashBedMat);

    const hitProxy = new THREE.Mesh(campfireHitProxyGeo, campfireHitProxyMat);
    hitProxy.position.y = 0.48;
    pit.add(hitProxy);

    const fireSeed =
      (Math.round(fx * 37) * 73856093) ^ (Math.round(fz * 91) * 19349663) ^ campfires.length;
    const fire = createCampfireFireVisual(fireSeed, initiallyLit);
    pit.add(fire.group);
    ctx.resources.ownComposite(fire.group, fire);
    ctx.resources.add(pit);

    ctx.shelters.add({
      id: `clearing_${id}`,
      x: fx,
      z: fz,
      yaw: 0,
      halfW: 1.75,
      halfD: 1.75,
      floorY: fy,
      temporary: !id.startsWith('fire_v'),
      clearingOnly: true,
      shape: 'circle',
      vegetationMargin: 0.0,
    });

    const entry: CampfireEntry = {
      id,
      label,
      x: fx,
      y: fy,
      z: fz,
      lit: initiallyLit,
      fire,
      pitGroup: pit,
    };
    campfires.push(entry);

    ctx.virtualPointLights.push({
      anchor: pit,
      yOffset: 0.8,
      colorHex: 0xff7d2b,
      baseIntensity: 2.8,
      distance: 22,
      decay: 1.6,
      flicker: true,
      isLit: () => entry.lit,
    });

    const getCampfireLabel = () =>
      entry.label === 'Wilderness' ? t('prop.campfireWilderness') : entry.label;
    const toCampfireInfo = (): CampfireInfo => ({
      id: entry.id,
      label: entry.label,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      lit: entry.lit,
    });
    ctx.registerInteractive(pit, {
      name: t('prop.campfireName', { label: getCampfireLabel() }),
      desc: t('prop.campfireDesc'),
      getName: () => t('prop.campfireName', { label: getCampfireLabel() }),
      getDesc: () => t('prop.campfireDesc'),
      getSecondaryActionLabel: () =>
        ctx.handlers?.hasFirewoodInPack?.() ? t('prop.campfireThrowLogAction') : undefined,
      onUse: () => {
        if (ctx.handlers?.onOpenCampfire) {
          ctx.handlers.onOpenCampfire(toCampfireInfo());
        } else {
          entry.lit = !entry.lit;
          entry.fire.setLit(entry.lit);
          ctx.sound.playImpact(0.5);
          ctx.showToast(entry.lit ? t('prop.campfireStoke') : t('prop.campfireBank'));
        }
      },
      onSecondaryAction: () => {
        ctx.handlers?.onThrowFirewoodAtCampfire?.(toCampfireInfo());
      },
      onTouch: () =>
        ctx.showToast(entry.lit ? t('prop.campfireTouchLit') : t('prop.campfireTouchCold')),
    });

    return entry;
  }

  const primaryFire = buildCampfirePit(
    'fire_v0',
    bp.villages[0].name,
    bp.villages[0].x + 1.5,
    bp.villages[0].z + 10.5,
    true
  );
  for (let vi = 1; vi < bp.villages.length; vi++) {
    const v = bp.villages[vi];
    buildCampfirePit(`fire_v${vi}`, v.name, v.x + 2.0, v.z + 10.2, false);
  }

  return {
    campfires,
    primaryCampfirePos: { x: primaryFire.x, y: primaryFire.y, z: primaryFire.z },
    buildCampfirePit,
    setCampfireLit: (id, lit) => {
      const cf = campfires.find((c) => c.id === id);
      if (!cf) return false;
      cf.lit = lit;
      cf.fire.setLit(lit);
      return true;
    },
    getCampfireInfo: (id) => {
      const cf = campfires.find((c) => c.id === id);
      if (!cf) return null;
      return { id: cf.id, label: cf.label, x: cf.x, y: cf.y, z: cf.z, lit: cf.lit };
    },
    getCampfires: () =>
      campfires.map((c) => ({
        id: c.id,
        label: c.label,
        x: c.x,
        y: c.y,
        z: c.z,
        lit: c.lit,
      })),
    throwFirewoodAtCampfire: (campfireId, startX, startY, startZ, spawnFirewoodLog) => {
      const cf = campfires.find((c) => c.id === campfireId);
      if (!cf) return { ok: false };
      const info: CampfireInfo = {
        id: cf.id,
        label: cf.label,
        x: cf.x,
        y: cf.y,
        z: cf.z,
        lit: cf.lit,
      };

      const entry = spawnFirewoodLog(startX, startZ, startY);
      const tx = cf.x + (ctx.rand() - 0.5) * 0.28;
      const ty = cf.y + 0.18;
      const tz = cf.z + (ctx.rand() - 0.5) * 0.28;
      const dx = tx - startX;
      const dz = tz - startZ;
      const horizDist = Math.hypot(dx, dz);
      const flightTime = clamp(horizDist / 9.2, 0.28, 0.58);
      const gravity = 15.0;

      entry.resting = false;
      entry.vel.set(
        dx / flightTime,
        (ty - startY + 0.5 * gravity * flightTime * flightTime) / flightTime,
        dz / flightTime
      );
      entry.angVel.set((ctx.rand() - 0.5) * 9, (ctx.rand() - 0.5) * 7, (ctx.rand() - 0.5) * 9);
      return { ok: true, campfire: info };
    },
    feedCampfireWithLog: (campfireId) => {
      const cf = campfires.find((c) => c.id === campfireId);
      if (!cf) return { ok: false, lit: false };
      const info: CampfireInfo = {
        id: cf.id,
        label: cf.label,
        x: cf.x,
        y: cf.y,
        z: cf.z,
        lit: cf.lit,
      };
      const localX = (ctx.rand() - 0.5) * 0.34;
      const localZ = (ctx.rand() - 0.5) * 0.34;
      cf.fire.addFuelLog(localX, 0.16, localZ, ctx.rand() * Math.PI);
      if (cf.lit) {
        ctx.sound.playFireSparkBurst();
      } else if (!ctx.handlers?.onCampfireLogImpact || !ctx.sound.getSoundscapeEngine?.()) {
        ctx.sound.playPhysicalImpactFallback?.(0.55) ?? ctx.sound.playImpact(0.55);
      }
      ctx.handlers?.onCampfireLogImpact?.(info, cf.lit, cf.x + localX, cf.y + 0.18, cf.z + localZ);
      return { ok: true, lit: cf.lit, campfire: info };
    },
    feedDynamicFirewoodIntoCampfires: () => {
      const hits: Array<{
        campfire: CampfireInfo;
        lit: boolean;
        x: number;
        y: number;
        z: number;
      }> = [];
      if (campfires.length === 0) return hits;

      for (let i = 0; i < ctx.dynamicObjects.length; i++) {
        const obj = ctx.dynamicObjects[i];
        if (obj.gathered || obj.resting || obj.pickupItemId !== 'firewood') continue;
        const px = obj.mesh.position.x;
        const py = obj.mesh.position.y;
        const pz = obj.mesh.position.z;

        for (let c = 0; c < campfires.length; c++) {
          const cf = campfires[c];
          const dx = px - cf.x;
          const dz = pz - cf.z;
          if (dx * dx + dz * dz <= 0.88 * 0.88 && py <= cf.y + 0.72 && py >= cf.y - 0.35) {
            obj.gathered = true;
            obj.resting = true;
            obj.mesh.visible = false;
            ctx.interactiveIndex.delete(obj);
            ctx.markLightShadowsDirty();

            cf.fire.addFuelLog(dx, Math.max(0.12, py - cf.y), dz, obj.mesh.rotation.y);
            const cfInfo: CampfireInfo = {
              id: cf.id,
              label: cf.label,
              x: cf.x,
              y: cf.y,
              z: cf.z,
              lit: cf.lit,
            };
            if (cf.lit) {
              ctx.sound.playFireSparkBurst();
            } else if (!ctx.handlers?.onCampfireLogImpact || !ctx.sound.getSoundscapeEngine?.()) {
              ctx.sound.playPhysicalImpactFallback?.(0.55) ?? ctx.sound.playImpact(0.55);
            }
            ctx.handlers?.onCampfireLogImpact?.(cfInfo, cf.lit, px, py, pz);
            hits.push({ campfire: cfInfo, lit: cf.lit, x: px, y: py, z: pz });
            break;
          }
        }
      }
      return hits;
    },
    spawnCampfireAt: (x, z, lit = true) => {
      const id = `fire_debug_${campfires.length + 1}`;
      const created = buildCampfirePit(id, 'Debug', x, z, lit);
      ctx.markLightShadowsDirty();
      return {
        id: created.id,
        label: created.label,
        x: created.x,
        y: created.y,
        z: created.z,
        lit: created.lit,
      };
    },
    getEnvironmentStateAt: (px, pz) => {
      let shelter: ShelterQuality = 'outdoor';
      let shelterLabel: string | null = null;
      for (const area of ctx.shelters.footprints) {
        if (area.shelter && containsFootprint(area, px, pz, -0.1)) {
          shelter = area.shelter.quality;
          shelterLabel = area.shelter.label;
          break;
        }
      }

      let nearLitCampfireFactor = 0;
      let nearestCampfire: CampfireInfo | null = null;
      let nearestDistSq = 100;
      for (let i = 0; i < campfires.length; i++) {
        const cf = campfires[i];
        const dx = px - cf.x;
        const dz = pz - cf.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < nearestDistSq) {
          nearestDistSq = dSq;
          nearestCampfire = {
            id: cf.id,
            label: cf.label,
            x: cf.x,
            y: cf.y,
            z: cf.z,
            lit: cf.lit,
          };
        }
        if (cf.lit && dSq < 9.5 * 9.5) {
          const d = Math.sqrt(dSq);
          const factor = clamp(1 - (d - 1.5) / 7.5, 0, 1);
          if (factor > nearLitCampfireFactor) nearLitCampfireFactor = factor;
        }
      }

      return { shelter, shelterLabel, nearLitCampfireFactor, nearestCampfire };
    },
    getStructureAcousticsAt: (px, pz) => {
      let nearestShelterDist = Infinity;
      let nearestRoofedDrainage: { x: number; y: number; z: number } | undefined;
      let nearestHasRoof = false;

      for (const s of ctx.structureMetas) {
        const dx = px - s.x;
        const dz = pz - s.z;
        const dEdge = Math.max(0, Math.hypot(dx, dz) - Math.max(s.halfW, s.halfD));
        if (dEdge < nearestShelterDist) {
          nearestShelterDist = dEdge;
          if (s.roofDrainagePoint) {
            nearestRoofedDrainage = s.roofDrainagePoint;
            nearestHasRoof = true;
          }
        }
      }

      for (const area of ctx.shelters.footprints) {
        const distApprox = Math.max(
          0,
          Math.hypot(px - area.x, pz - area.z) - Math.max(area.halfW, area.halfD)
        );
        if (distApprox < nearestShelterDist) {
          nearestShelterDist = distApprox;
        }

        if (containsFootprint(area, px, pz, -0.05)) {
          if (area.shelter?.quality === 'tent') {
            return {
              id: area.id,
              quality: 'tent',
              profileId: 'tent',
              enclosure: 0.58,
              roofCoverage: 1.0,
              hasRoof: true,
              roofMaterial: 'canvas',
              wallMaterial: 'canvas',
              condition: 'intact',
              portalOpenness: 0.28,
              abandoned: false,
              floorMaterial: 'forest_floor',
              nearestShelterDistanceM: 0,
              roofDrainagePoint: { x: area.x + 1.1, y: area.floorY + 0.8, z: area.z },
            };
          }

          const meta = ctx.structureMetas.find((m) => m.id === area.id);
          if (meta) {
            const doorOpen = meta.hasDoor && meta.getDoorOpen();
            const decay = meta.decay;
            const profileId =
              decay === 'ruins'
                ? 'outdoor'
                : decay === 'roofless'
                  ? 'decrepit_missing_roof'
                  : meta.abandoned || decay === 'sagging'
                    ? 'drafty_hut'
                    : 'wooden_house';
            const enclosure =
              decay === 'ruins' ? 0.35 : decay === 'roofless' ? 0.5 : decay === 'sagging' ? 0.68 : 0.92;
            const roofCoverage =
              decay === 'ruins' ? 0 : decay === 'roofless' ? 0.15 : decay === 'sagging' ? 0.72 : 1.0;
            const portalOpenness = !meta.hasDoor ? 0.85 : doorOpen ? 0.68 : 0.08;
            return {
              id: meta.id,
              quality: meta.abandoned || decay !== 'intact' ? 'drafty_hut' : 'warm_house',
              profileId,
              enclosure,
              roofCoverage,
              hasRoof: roofCoverage > 0.3,
              roofMaterial: meta.roofMaterial,
              wallMaterial: meta.wallMaterial,
              condition:
                decay === 'ruins'
                  ? 'ruins'
                  : meta.abandoned
                    ? 'decrepit'
                    : decay === 'sagging'
                      ? 'sagging'
                      : 'intact',
              portalOpenness,
              abandoned: meta.abandoned,
              floorMaterial: meta.abandoned || decay !== 'intact' ? 'decrepit_wooden_floor' : 'wooden_floor',
              nearestShelterDistanceM: 0,
              roofDrainagePoint: meta.roofDrainagePoint ?? nearestRoofedDrainage,
            };
          }
        }
      }

      return {
        id: null,
        quality: 'outdoor',
        profileId: 'outdoor',
        enclosure: 0,
        roofCoverage: 0,
        hasRoof: nearestShelterDist <= 30 && nearestHasRoof,
        roofMaterial: 'none',
        wallMaterial: 'none',
        condition: 'intact',
        portalOpenness: 1,
        abandoned: false,
        floorMaterial: 'forest_floor',
        nearestShelterDistanceM: nearestShelterDist,
        roofDrainagePoint: nearestRoofedDrainage,
      };
    },
  };
}

export interface TentsSystem {
  tents: TentEntry[];
  placePlayerCampfire: (x: number, z: number) => { ok: boolean; campfire?: CampfireInfo; message: string };
  placePlayerTent: (x: number, z: number, yaw: number) => { ok: boolean; tent?: TentInfo; message: string };
  packUpPlayerTent: (tentId: string) => boolean;
  getTents: () => TentInfo[];
}

export function createTentsSystem(
  ctx: PropBuildContext,
  assets: PropSharedAssets,
  campfiresSys: CampfiresSystem
): TentsSystem {
  const tents: TentEntry[] = [];
  let tentCounter = 0;

  const tentRainflyMat = new THREE.MeshStandardMaterial({
    color: 0x4b6e47,
    emissive: 0x1b2b1a,
    emissiveIntensity: 0.65,
    roughness: 0.78,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const tentInnerMat = new THREE.MeshStandardMaterial({
    color: 0x202b22,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const tentGroundsheetMat = new THREE.MeshStandardMaterial({
    color: 0x2a312c,
    roughness: 0.68,
    metalness: 0.06,
  });
  const tentPadMat = new THREE.MeshStandardMaterial({
    color: 0xc27b3c,
    roughness: 0.86,
    metalness: 0.0,
  });
  const tentPoleMat = new THREE.MeshStandardMaterial({
    color: 0xbac4c9,
    roughness: 0.28,
    metalness: 0.78,
  });
  const tentGuyLineMat = new THREE.MeshStandardMaterial({
    color: 0xd6c79c,
    roughness: 0.82,
    metalness: 0.05,
  });
  ctx.resources.own(
    tentRainflyMat,
    tentInnerMat,
    tentGroundsheetMat,
    tentPadMat,
    tentPoleMat,
    tentGuyLineMat
  );

  function packUpPlayerTent(tentId: string): boolean {
    const idx = tents.findIndex((tt) => tt.id === tentId);
    if (idx < 0) return false;
    const target = tents[idx];
    tents.splice(idx, 1);
    ctx.shelters.remove(tentId);
    ctx.markLightShadowsDirty();

    for (const col of target.colliders) {
      col.active = false;
      const cIdx = ctx.boxColliders.indexOf(col);
      if (cIdx >= 0) ctx.boxColliders.splice(cIdx, 1);
    }

    target.interactiveEntry.gathered = true;
    ctx.interactiveIndex.delete(target.interactiveEntry);
    ctx.resources.detach(target.group);

    const ioIdx = ctx.interactiveObjects.indexOf(target.interactiveEntry);
    if (ioIdx >= 0) ctx.interactiveObjects.splice(ioIdx, 1);
    const imIdx = ctx.interactiveMeshes.indexOf(target.group);
    if (imIdx >= 0) ctx.interactiveMeshes.splice(imIdx, 1);

    for (const geo of target.geometries) {
      geo.dispose();
    }
    return true;
  }

  function placePlayerTent(
    x: number,
    z: number,
    yaw: number
  ): { ok: boolean; tent?: TentInfo; message: string } {
    const groundY = getTerrainHeight(x, z);
    if (groundY <= SWAMP_WATER_Y + 0.14) {
      return { ok: false, message: t('prop.tentTooWet') };
    }
    if (ctx.shelters.footprints.some((area) => containsFootprint(area, x, z, 2.1))) {
      return { ok: false, message: t('prop.tentBlocked') };
    }
    for (let i = 0; i < ctx.boxColliders.length; i++) {
      const b = ctx.boxColliders[i];
      if (!b.active) continue;
      if (x >= b.minX - 1.15 && x <= b.maxX + 1.15 && z >= b.minZ - 1.15 && z <= b.maxZ + 1.15) {
        return { ok: false, message: t('prop.tentBlocked') };
      }
    }
    for (let i = 0; i < ctx.circleColliders.length; i++) {
      const c = ctx.circleColliders[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const minR = c.r + 1.05;
      if (dx * dx + dz * dz < minR * minR) {
        return { ok: false, message: t('prop.tentBlocked') };
      }
    }
    for (let i = 0; i < campfiresSys.campfires.length; i++) {
      const dx = x - campfiresSys.campfires[i].x;
      const dz = z - campfiresSys.campfires[i].z;
      if (dx * dx + dz * dz < 2.2 * 2.2) {
        return { ok: false, message: t('prop.tentBlocked') };
      }
    }
    for (let i = 0; i < tents.length; i++) {
      const dx = x - tents[i].x;
      const dz = z - tents[i].z;
      if (dx * dx + dz * dz < 3.0 * 3.0) {
        return { ok: false, message: t('prop.tentBlocked') };
      }
    }

    const id = `tent_player_${++tentCounter}`;
    ctx.shelters.add({
      id,
      x,
      z,
      yaw,
      temporary: true,
      halfW: 1.06,
      halfD: 1.33,
      floorY: groundY + 0.08,
      shelter: { quality: 'tent', label: t('prop.tentSpotLabel') },
      roof: { eaveY: groundY + 0.08, rise: 1.3, axis: 'x' },
    });
    const tentGroup = new THREE.Group();
    tentGroup.position.set(x, groundY, z);
    tentGroup.rotation.y = yaw;
    const geos: THREE.BufferGeometry[] = [];

    const shadowGeo = new THREE.PlaneGeometry(3.2, 3.6);
    shadowGeo.rotateX(-Math.PI / 2);
    geos.push(shadowGeo);
    const shadowMesh = new THREE.Mesh(shadowGeo, assets.contactShadowMat);
    shadowMesh.position.y = 0.025;
    tentGroup.add(shadowMesh);

    const floorGeo = new THREE.BoxGeometry(1.92, 0.08, 2.48);
    geos.push(floorGeo);
    const floorMesh = new THREE.Mesh(floorGeo, tentGroundsheetMat);
    floorMesh.position.set(0, 0.04, 0);
    floorMesh.receiveShadow = true;
    tentGroup.add(floorMesh);

    const padGeo = new THREE.BoxGeometry(0.84, 0.055, 1.92);
    geos.push(padGeo);
    const padMesh = new THREE.Mesh(padGeo, tentPadMat);
    padMesh.position.set(-0.18, 0.1, -0.05);
    padMesh.receiveShadow = true;
    tentGroup.add(padMesh);

    const ridgeH = 1.38;
    const halfSpan = 1.06;
    const slopeLen = Math.hypot(halfSpan, ridgeH - 0.08);
    const slopeAngle = Math.atan2(halfSpan, ridgeH - 0.08);
    const flyLen = 2.66;

    const panelGeo = new THREE.BoxGeometry(slopeLen, 0.035, flyLen);
    geos.push(panelGeo);
    const leftFly = new THREE.Mesh(panelGeo, tentRainflyMat);
    leftFly.position.set(-halfSpan * 0.5, 0.08 + (ridgeH - 0.08) * 0.5, 0);
    leftFly.rotation.z = Math.PI * 0.5 - slopeAngle;
    leftFly.castShadow = ctx.shadows;
    leftFly.receiveShadow = true;

    const rightFly = new THREE.Mesh(panelGeo, tentRainflyMat);
    rightFly.position.set(halfSpan * 0.5, 0.08 + (ridgeH - 0.08) * 0.5, 0);
    rightFly.rotation.z = -(Math.PI * 0.5 - slopeAngle);
    rightFly.castShadow = ctx.shadows;
    rightFly.receiveShadow = true;
    tentGroup.add(leftFly, rightFly);

    const gableShape = new THREE.Shape();
    gableShape.moveTo(-0.98, 0.06);
    gableShape.lineTo(0.98, 0.06);
    gableShape.lineTo(0, ridgeH - 0.02);
    gableShape.closePath();
    const gableGeo = new THREE.ShapeGeometry(gableShape);
    geos.push(gableGeo);

    const rearGable = new THREE.Mesh(gableGeo, tentRainflyMat);
    rearGable.position.set(0, 0, -1.24);
    rearGable.castShadow = ctx.shadows;
    rearGable.receiveShadow = true;
    tentGroup.add(rearGable);

    const innerBack = new THREE.Mesh(gableGeo, tentInnerMat);
    innerBack.position.set(0, 0, -1.2);
    tentGroup.add(innerBack);

    const frontPortalShape = new THREE.Shape();
    frontPortalShape.moveTo(-0.98, 0.06);
    frontPortalShape.lineTo(0.98, 0.06);
    frontPortalShape.lineTo(0, ridgeH - 0.02);
    frontPortalShape.closePath();
    const doorHole = new THREE.Path();
    doorHole.moveTo(-0.56, 0.08);
    doorHole.lineTo(0.56, 0.08);
    doorHole.lineTo(0, ridgeH - 0.24);
    doorHole.closePath();
    frontPortalShape.holes.push(doorHole);
    const frontPortalGeo = new THREE.ShapeGeometry(frontPortalShape);
    geos.push(frontPortalGeo);
    const frontPortal = new THREE.Mesh(frontPortalGeo, tentRainflyMat);
    frontPortal.position.set(0, 0, 1.24);
    frontPortal.castShadow = ctx.shadows;
    tentGroup.add(frontPortal);

    const flapGeo = new THREE.CylinderGeometry(0.065, 0.075, 1.18, 8);
    geos.push(flapGeo);
    const rolledFlap = new THREE.Mesh(flapGeo, tentRainflyMat);
    rolledFlap.position.set(0.32, 0.64, 1.27);
    rolledFlap.rotation.z = 0.48;
    tentGroup.add(rolledFlap);

    const ridgePoleGeo = new THREE.CylinderGeometry(0.024, 0.024, flyLen + 0.08, 8);
    ridgePoleGeo.rotateX(Math.PI / 2);
    geos.push(ridgePoleGeo);
    const ridgePole = new THREE.Mesh(ridgePoleGeo, tentPoleMat);
    ridgePole.position.set(0, ridgeH + 0.01, 0);
    tentGroup.add(ridgePole);

    const endPoleGeo = new THREE.CylinderGeometry(0.02, 0.022, ridgeH, 8);
    const doorPoleLen = Math.hypot(0.56, ridgeH - 0.16);
    const doorPoleGeo = new THREE.CylinderGeometry(0.017, 0.019, doorPoleLen, 8);
    geos.push(endPoleGeo, doorPoleGeo);
    const frontLeftPole = new THREE.Mesh(doorPoleGeo, tentPoleMat);
    frontLeftPole.position.set(-0.3, (ridgeH - 0.04) * 0.5, 1.27);
    frontLeftPole.rotation.z = -Math.atan2(0.56, ridgeH - 0.16);
    const frontRightPole = new THREE.Mesh(doorPoleGeo, tentPoleMat);
    frontRightPole.position.set(0.3, (ridgeH - 0.04) * 0.5, 1.27);
    frontRightPole.rotation.z = Math.atan2(0.56, ridgeH - 0.16);
    const rearPole = new THREE.Mesh(endPoleGeo, tentPoleMat);
    rearPole.position.set(0, ridgeH * 0.5, -1.29);
    tentGroup.add(frontLeftPole, frontRightPole, rearPole);

    const stakeGeo = new THREE.CylinderGeometry(0.015, 0.01, 0.24, 6);
    const guyGeo = new THREE.CylinderGeometry(0.008, 0.008, 1.18, 5);
    geos.push(stakeGeo, guyGeo);
    const corners: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [sx, sz] of corners) {
      const stake = new THREE.Mesh(stakeGeo, tentPoleMat);
      stake.position.set(sx * 1.48, 0.08, sz * 1.12);
      stake.rotation.z = sx * 0.28;
      tentGroup.add(stake);

      const guy = new THREE.Mesh(guyGeo, tentGuyLineMat);
      guy.position.set(sx * 1.12, 0.44, sz * 1.12);
      guy.rotation.z = sx * 0.72;
      tentGroup.add(guy);
    }

    ctx.resources.add(tentGroup);
    ctx.markLightShadowsDirty();

    const interactiveEntry = ctx.registerInteractive(tentGroup, {
      name: t('prop.tentName'),
      desc: t('prop.tentDesc'),
      getName: () => t('prop.tentName'),
      getDesc: () => t('prop.tentDesc'),
      getPickupLabel: () => t('prop.tentSleepAction'),
      getSecondaryActionLabel: () => t('prop.tentPackUpAction'),
      onUse: () => {
        if (ctx.handlers?.onOpenSleep) {
          ctx.handlers.onOpenSleep({
            kind: 'tent',
            label: t('prop.tentSpotLabel'),
            x,
            y: groundY + 0.15,
            z,
            shelter: 'tent',
            tentId: id,
          });
        }
      },
      onKick: () => {
        if (packUpPlayerTent(id)) {
          ctx.handlers?.onPackUpTent?.(id);
        }
      },
      onTouch: () => ctx.showToast(t('prop.tentTouch')),
    });

    const tentColliders: BoxCollider[] = [
      ctx.addLocalOrientedBoxCollider(
        x, groundY, z, yaw,
        -halfSpan * 0.5, 0.08 + (ridgeH - 0.08) * 0.5, 0,
        slopeLen, 0.06, flyLen,
        0, 0, Math.PI * 0.5 - slopeAngle, true
      ),
      ctx.addLocalOrientedBoxCollider(
        x, groundY, z, yaw,
        halfSpan * 0.5, 0.08 + (ridgeH - 0.08) * 0.5, 0,
        slopeLen, 0.06, flyLen,
        0, 0, -(Math.PI * 0.5 - slopeAngle), true
      ),
      ctx.addLocalOrientedBoxCollider(
        x, groundY, z, yaw,
        0, 0.06 + (ridgeH - 0.08) * 0.36, -1.24,
        1.15, (ridgeH - 0.08) * 0.72, 0.08,
        0, 0, 0, true
      ),
    ];

    tents.push({
      id,
      x,
      y: groundY,
      z,
      yaw,
      group: tentGroup,
      interactiveEntry,
      geometries: geos,
      colliders: tentColliders,
    });

    ctx.sound.playImpact(0.65);
    return {
      ok: true,
      tent: { id, x, y: groundY, z, yaw },
      message: t('prop.tentPitched'),
    };
  }

  return {
    tents,
    placePlayerCampfire: (x, z) => {
      const nearbyTent = tents
        .filter((tt) => Math.hypot(x - tt.x, z - tt.z) < 7)
        .sort((a, b) => Math.hypot(x - a.x, z - a.z) - Math.hypot(x - b.x, z - b.z))[0];
      if (nearbyTent) {
        x = nearbyTent.x + Math.sin(nearbyTent.yaw) * 3.8;
        z = nearbyTent.z + Math.cos(nearbyTent.yaw) * 3.8;
      }
      if (
        ctx.shelters.footprints.some((area) => !area.clearingOnly && containsFootprint(area, x, z, 0.9)) ||
        ctx.circleColliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.9)
      ) {
        return { ok: false, message: t('prop.campfireBlocked') };
      }
      const groundY = getTerrainHeight(x, z);
      if (groundY <= SWAMP_WATER_Y + 0.08) {
        return {
          ok: false,
          message: t('prop.campfireTooWet'),
        };
      }
      for (let i = 0; i < campfiresSys.campfires.length; i++) {
        const dx = campfiresSys.campfires[i].x - x;
        const dz = campfiresSys.campfires[i].z - z;
        if (dx * dx + dz * dz < 3.2 * 3.2) {
          return {
            ok: false,
            message: t('prop.campfireTooClose'),
          };
        }
      }
      const id = `fire_player_${campfiresSys.campfires.length + 1}`;
      const created = campfiresSys.buildCampfirePit(id, 'Wilderness', x, z, false);
      ctx.sound.playImpact(0.75);
      return {
        ok: true,
        campfire: {
          id: created.id,
          label: created.label,
          x: created.x,
          y: created.y,
          z: created.z,
          lit: created.lit,
        },
        message: t('prop.campfireStacked'),
      };
    },
    placePlayerTent,
    packUpPlayerTent,
    getTents: () =>
      tents.map((tt) => ({
        id: tt.id,
        x: tt.x,
        y: tt.y,
        z: tt.z,
        yaw: tt.yaw,
      })),
  };
}
