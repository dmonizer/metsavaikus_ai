import * as THREE from 'three';
import { MushroomSpecies } from '../game/gameLogic';
import { sphereIntersectsFrustum } from './forestFrustumCuller';
import { PointSpatialIndex } from './pointSpatialIndex';
import { WorldTextures } from './proceduralTextures';
import { buildSignpostAndBoardwalk } from './props/boardwalkBuilder';
import { buildBuildingsAndWells } from './props/buildingsAndWells';
import { createCampfiresSystem, createTentsSystem } from './props/campfiresAndTents';
import { createDynamicPropsSystem } from './props/dynamicPropsBuilder';
import { createMushroomSystem, MushroomSystem } from './props/mushroomBuilder';
import { createPropSharedAssets } from './props/propMaterials';
import {
  BoardwalkZone,
  CircleCollider,
  InteractiveEntry,
  PropBuildContext,
  StructureAcousticMeta,
  StructureNode,
  VirtualPointLight,
  WorldInteractionHandlers,
  WorldPropsContext,
} from './props/propTypes';
import { createSeededRandom } from './seededRandom';
import { ShelterGeometry } from './shelterGeometry';
import { SoundEngine } from './soundEngine';
import { BoxCollider } from './spatialPhysics';
import { clamp, getActiveBlueprint, getTerrainHeight, SWAMP_WATER_Y } from './terrainMath';
import { createFreshwaterSystem } from './freshwaterMeshes';
import { createReflectiveBogWater } from './waterSurface';
import { SkyFrameState, WeatherId } from './weatherAndSky';
import { HutDecayState } from './worldBlueprint';
import { WorldResources } from './worldResources';

export type { BoxCollider } from './props/propTypes';
export {
  isPointOnBoardwalkZone,
  type BoardwalkZone,
  type CampfireInfo,
  type CircleCollider,
  type InteractiveEntry,
  type SleepSpotInfo,
  type StructureAcousticsInfo,
  type TentInfo,
  type WorldEnvironmentAtPoint,
  type WorldInteractionHandlers,
  type WorldPropsContext,
} from './props/propTypes';

const seededRand = (seed: number) => createSeededRandom(seed, 0x517cc1b7);

const _obbGroupMat = new THREE.Matrix4();
const _obbLocalMat = new THREE.Matrix4();
const _obbTransMat = new THREE.Matrix4();
const _obbRotMat = new THREE.Matrix4();
const _obbWorldMat = new THREE.Matrix4();

export function buildArchitectureAndProps(
  scene: THREE.Scene,
  textures: WorldTextures,
  sound: SoundEngine,
  showToast: (msg: string) => void,
  isSoftwareGl: boolean,
  handlers?: WorldInteractionHandlers,
  isLowPowerGpu = false
): WorldPropsContext {
  const bp = getActiveBlueprint();
  const rand = seededRand(bp.seed + 1337);
  const circleColliders: CircleCollider[] = [];
  const boxColliders: BoxCollider[] = [];
  const shelters = new ShelterGeometry();
  let lightShadowsDirty = true;
  const boardwalkZones: BoardwalkZone[] = [];
  const interactiveObjects: InteractiveEntry[] = [];
  const interactiveMeshes: THREE.Object3D[] = [];
  const dynamicObjects: InteractiveEntry[] = [];
  const interactiveIndex = new PointSpatialIndex<InteractiveEntry>();
  const interactiveWorldPosition = new THREE.Vector3();
  const structureNodes: StructureNode[] = [];
  const structureMetas: StructureAcousticMeta[] = [];
  const virtualPointLights: VirtualPointLight[] = [];
  const resources = new WorldResources(scene);
  resources.own(shelters);

  const shadows = !isSoftwareGl;

  function addBoxCollider(
    cx: number,
    cz: number,
    w: number,
    d: number,
    groundY: number,
    heightAboveGround: number,
    jumpable = false
  ): BoxCollider {
    const box: BoxCollider = {
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
      groundY,
      heightAboveGround,
      jumpable,
      active: true,
    };
    boxColliders.push(box);
    return box;
  }

  function addLocalOrientedBoxCollider(
    groupX: number,
    groupY: number,
    groupZ: number,
    groupYaw: number,
    lx: number,
    ly: number,
    lz: number,
    w: number,
    h: number,
    d: number,
    rx = 0,
    ry = 0,
    rz = 0,
    overhead = true
  ): BoxCollider {
    _obbGroupMat.makeRotationY(groupYaw).setPosition(groupX, groupY, groupZ);
    // Matches makeBoxPart order: rotateX -> rotateY -> rotateZ -> translate(lx, ly, lz)
    _obbLocalMat.makeRotationX(rx);
    if (ry) {
      _obbRotMat.makeRotationY(ry);
      _obbLocalMat.premultiply(_obbRotMat);
    }
    if (rz) {
      _obbRotMat.makeRotationZ(rz);
      _obbLocalMat.premultiply(_obbRotMat);
    }
    _obbTransMat.makeTranslation(lx, ly, lz);
    _obbLocalMat.premultiply(_obbTransMat);
    _obbWorldMat.multiplyMatrices(_obbGroupMat, _obbLocalMat);
    const e = _obbWorldMat.elements;
    const cx = e[12];
    const cy = e[13];
    const cz = e[14];
    const hw = w * 0.5;
    const hh = h * 0.5;
    const hd = d * 0.5;
    const extentX = Math.abs(e[0]) * hw + Math.abs(e[4]) * hh + Math.abs(e[8]) * hd;
    const extentY = Math.abs(e[1]) * hw + Math.abs(e[5]) * hh + Math.abs(e[9]) * hd;
    const extentZ = Math.abs(e[2]) * hw + Math.abs(e[6]) * hh + Math.abs(e[10]) * hd;
    const box: BoxCollider = {
      minX: cx - extentX,
      maxX: cx + extentX,
      minZ: cz - extentZ,
      maxZ: cz + extentZ,
      groundY: cy - extentY,
      heightAboveGround: extentY * 2,
      jumpable: false,
      active: true,
      overhead,
      obb: {
        cx,
        cy,
        cz,
        invBasis: [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]],
        halfW: hw,
        halfH: hh,
        halfD: hd,
      },
    };
    boxColliders.push(box);
    return box;
  }

  function updateInteractivePosition(entry: InteractiveEntry): void {
    if (entry.gathered) {
      interactiveIndex.delete(entry);
      return;
    }
    entry.mesh.getWorldPosition(interactiveWorldPosition);
    interactiveIndex.set(entry, interactiveWorldPosition.x, interactiveWorldPosition.z);
  }

  function registerInteractive(
    mesh: THREE.Object3D,
    opts: Partial<InteractiveEntry> & { name: string; desc: string }
  ): InteractiveEntry {
    const entry: InteractiveEntry = {
      mesh,
      name: opts.name,
      desc: opts.desc,
      getName: opts.getName,
      getDesc: opts.getDesc,
      getPickupLabel: opts.getPickupLabel,
      getSecondaryActionLabel: opts.getSecondaryActionLabel,
      gatherable: !!opts.gatherable,
      species: opts.species,
      gathered: false,
      pickupItemId: opts.pickupItemId,
      pickupLabel: opts.pickupLabel,
      carryable: !!opts.carryable && !opts.gatherable && !opts.pickupItemId,
      kickable: !!opts.kickable && !opts.gatherable,
      breakable: !!opts.breakable,
      onKick: opts.onKick,
      onSecondaryAction: opts.onSecondaryAction,
      onTouch: opts.onTouch,
      onUse: opts.onUse
        ? () => {
            opts.onUse!();
            updateInteractivePosition(entry);
          }
        : undefined,
      radius: opts.radius ?? 0.35,
      mass: opts.mass ?? 1.0,
      vel: new THREE.Vector3(),
      angVel: new THREE.Vector3(),
      isDynamic: !!opts.isDynamic && !opts.gatherable,
      resting: false,
      onGroundYOffset: opts.onGroundYOffset ?? (opts.radius ?? 0.35),
      materialType: opts.materialType,
      ownCollider: opts.ownCollider,
    };
    mesh.updateMatrixWorld(true);
    mesh.userData.interactive = entry;
    mesh.traverse((child) => {
      child.userData.interactive = entry;
      if (child instanceof THREE.Mesh) child.receiveShadow = true;
    });
    updateInteractivePosition(entry);
    interactiveObjects.push(entry);
    interactiveMeshes.push(mesh);
    if (entry.isDynamic) dynamicObjects.push(entry);
    return entry;
  }

  // Wind-Responsive Planar-Reflective Peat-Bog Water tightly enclosing bp.bogPools
  let bogWaterX = bp.bogCenterX;
  let bogWaterZ = bp.bogCenterZ;
  let waterRadius = Math.min(230, bp.bogRadius + 24);
  if (bp.bogPools.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const pool of bp.bogPools) {
      const pr = Math.max(pool.rx, pool.rz) * 1.15;
      if (pool.x - pr < minX) minX = pool.x - pr;
      if (pool.x + pr > maxX) maxX = pool.x + pr;
      if (pool.z - pr < minZ) minZ = pool.z - pr;
      if (pool.z + pr > maxZ) maxZ = pool.z + pr;
    }
    bogWaterX = (minX + maxX) * 0.5;
    bogWaterZ = (minZ + maxZ) * 0.5;
    let maxExtent = 48;
    for (const pool of bp.bogPools) {
      const pr = Math.max(pool.rx, pool.rz) * 1.15;
      const d = Math.hypot(pool.x - bogWaterX, pool.z - bogWaterZ) + pr;
      if (d > maxExtent) maxExtent = d;
    }
    waterRadius = maxExtent + 24;
  }

  const bogWater = createReflectiveBogWater(
    bogWaterX,
    bogWaterZ,
    waterRadius,
    isSoftwareGl,
    isLowPowerGpu
  );
  const swampWater = bogWater.mesh;
  swampWater.userData.debugLayer = 'water';
  swampWater.userData.debugName = 'Rabajärv (Bog Lake Water)';
  swampWater.userData.debugMeta = { waterY: SWAMP_WATER_Y, radius: waterRadius };
  resources.addComposite(swampWater, bogWater);

  // Non-bog freshwater lakes and downhill streams
  const freshwaterSystem = createFreshwaterSystem(bp.lakes, bp.streams);
  resources.addComposite(freshwaterSystem.group, freshwaterSystem);

  const mistGeo = new THREE.PlaneGeometry(12, 12);
  mistGeo.rotateX(-Math.PI / 2);
  const mistMat = new THREE.MeshBasicMaterial({
    map: textures.bogMistTex,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  const mistCount = Math.max(6, Math.min(10, bp.bogPools.length * 2));
  const mistInst = new THREE.InstancedMesh(mistGeo, mistMat, mistCount);
  const mistDummy = new THREE.Object3D();
  for (let i = 0; i < mistCount; i++) {
    if (bp.bogPools.length > 0) {
      const pool = bp.bogPools[i % bp.bogPools.length];
      const a = rand() * Math.PI * 2;
      const rFrac = rand() * 0.62;
      mistDummy.position.set(
        pool.x + Math.cos(a) * pool.rx * rFrac,
        SWAMP_WATER_Y + 0.36 + rand() * 0.42,
        pool.z + Math.sin(a) * pool.rz * rFrac
      );
    } else {
      const a = (i / mistCount) * Math.PI * 2 + rand() * 0.45;
      const rad = 20 + rand() * (waterRadius * 0.65);
      mistDummy.position.set(
        bogWaterX + Math.cos(a) * rad,
        SWAMP_WATER_Y + 0.36 + rand() * 0.42,
        bogWaterZ + Math.sin(a) * rad
      );
    }
    mistDummy.rotation.set(0, rand() * Math.PI, 0);
    mistDummy.scale.set(0.85 + rand() * 0.4, 1, 0.85 + rand() * 0.4);
    mistDummy.updateMatrix();
    mistInst.setMatrixAt(i, mistDummy.matrix);
  }
  mistInst.instanceMatrix.needsUpdate = true;
  resources.add(mistInst);
  resources.own(mistGeo, mistMat);

  const assets = createPropSharedAssets(textures, resources);

  // Pooled 2-slot dynamic PointLight system (constant NUM_POINT_LIGHTS=2)
  const pooledPointLights: [THREE.PointLight, THREE.PointLight] = [
    new THREE.PointLight(0xff8c36, 0, 22, 1.6),
    new THREE.PointLight(0xffaa44, 0, 16, 1.5),
  ];
  for (const light of pooledPointLights) {
    light.castShadow = true;
    light.shadow.mapSize.set(isSoftwareGl ? 256 : 512, isSoftwareGl ? 256 : 512);
    light.shadow.camera.near = 0.05;
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.015;
    light.shadow.autoUpdate = false;
  }
  pooledPointLights[0].visible = true;
  pooledPointLights[1].visible = true;
  resources.add(pooledPointLights[0], pooledPointLights[1]);
  resources.own(...pooledPointLights);

  const buildCtx: PropBuildContext = {
    resources,
    textures,
    sound,
    showToast,
    handlers,
    rand,
    shadows,
    shelters,
    circleColliders,
    boxColliders,
    boardwalkZones,
    interactiveObjects,
    interactiveMeshes,
    dynamicObjects,
    interactiveIndex,
    structureNodes,
    structureMetas,
    virtualPointLights,
    markLightShadowsDirty: () => {
      lightShadowsDirty = true;
    },
    addBoxCollider,
    addLocalOrientedBoxCollider,
    registerInteractive,
    updateInteractivePosition,
  };

  // Preserve exact deterministic RNG initialization order across subsystems
  const buildings = buildBuildingsAndWells(buildCtx, assets);
  const campfiresSys = createCampfiresSystem(buildCtx, assets);
  buildSignpostAndBoardwalk(buildCtx, assets.timberTrimMat);

  let mushroomSystem!: MushroomSystem;
  const dynamicProps = createDynamicPropsSystem(buildCtx, (x, z, species) =>
    mushroomSystem.spawnMushroom(x, z, species)
  );
  mushroomSystem = createMushroomSystem(buildCtx);
  const tentsSys = createTentsSystem(buildCtx, assets, campfiresSys);

  let prevPropsElapsed: number | null = null;

  return {
    shelters,
    invalidateLightShadows: () => {
      lightShadowsDirty = true;
    },
    needsLightShadowUpdate: () =>
      pooledPointLights.some((light) => light.castShadow && light.intensity > 0 && light.shadow.needsUpdate),
    circleColliders,
    boxColliders,
    boardwalkZones,
    interactiveObjects,
    queryInteractiveObjects: (x, z, radius, out) => {
      interactiveIndex.queryRadius(x, z, radius, out);
      let count = 0;
      for (let i = 0; i < out.length; i++) {
        const entry = out[i];
        if (!entry.gathered && entry.mesh.visible) out[count++] = entry;
      }
      out.length = count;
    },
    updateInteractivePosition,
    interactiveMeshes,
    dynamicObjects,
    mushroomCountTotal: mushroomSystem.mushroomCountTotal,
    heroMushroomPos: mushroomSystem.heroMushroomPos,
    primaryCampfirePos: campfiresSys.primaryCampfirePos,
    updateDynamicProps: (
      elapsed: number,
      camX: number,
      camZ: number,
      skyState?: SkyFrameState,
      frustumPlanes?: Float32Array,
      maxRenderDist = 225,
      weather?: string,
      mushroomDist = 38
    ) => {
      const propsDt = prevPropsElapsed !== null ? clamp(elapsed - prevPropsElapsed, 0, 0.1) : 1 / 60;
      prevPropsElapsed = elapsed;

      let chosenBoost = 0;
      for (let i = 0; i < campfiresSys.campfires.length; i++) {
        const cf = campfiresSys.campfires[i];
        if (cf.lit) {
          const cfDx = cf.x - camX;
          const cfDz = cf.z - camZ;
          if (cfDx * cfDx + cfDz * cfDz <= (maxRenderDist + 20) * (maxRenderDist + 20)) {
            cf.fire.update(elapsed, propsDt, () => {
              sound.playFireLogCatch();
              handlers?.onCampfireLogCaughtFire?.({
                id: cf.id,
                label: cf.label,
                x: cf.x,
                y: cf.y,
                z: cf.z,
                lit: cf.lit,
              });
            });
          }
        }
      }

      // Bind pooled 2-slot PointLights to the 2 nearest lit campfires/lanterns within 38m (zero GC)
      let best0 = -1;
      let best0Sq = 38 * 38;
      let best1 = -1;
      let best1Sq = 38 * 38;
      for (let i = 0; i < virtualPointLights.length; i++) {
        const src = virtualPointLights[i];
        if (!src.isLit()) continue;
        const dx = src.anchor.position.x - camX;
        const dz = src.anchor.position.z - camZ;
        const dSq = dx * dx + dz * dz;
        if (dSq < best0Sq) {
          best1 = best0;
          best1Sq = best0Sq;
          best0 = i;
          best0Sq = dSq;
        } else if (dSq < best1Sq) {
          best1 = i;
          best1Sq = dSq;
        }
      }
      const chosen0 = best0 >= 0 ? virtualPointLights[best0] : null;
      const chosen1 = best1 >= 0 ? virtualPointLights[best1] : null;
      const flickerDelta =
        Math.sin(elapsed * 13.7) * 0.24 +
        Math.sin(elapsed * 23.3 + 1.1) * 0.16 +
        Math.sin(elapsed * 5.9) * 0.2;
      for (let slot = 0; slot < 2; slot++) {
        const pl = pooledPointLights[slot];
        const src = slot === 0 ? chosen0 : chosen1;
        if (src) {
          chosenBoost = 0;
          if (src.flicker) {
            for (let ci = 0; ci < campfiresSys.campfires.length; ci++) {
              const cf = campfiresSys.campfires[ci];
              if (cf.pitGroup === src.anchor) {
                chosenBoost = cf.fire.getIntensityBoost() * 1.4;
                break;
              }
            }
          }
          const nextX = src.anchor.position.x;
          const nextY = src.anchor.position.y + src.yOffset;
          const nextZ = src.anchor.position.z;
          const ldx = nextX - pl.position.x;
          const ldy = nextY - pl.position.y;
          const ldz = nextZ - pl.position.z;
          if (
            lightShadowsDirty ||
            ldx * ldx + ldy * ldy + ldz * ldz > 0.000001 ||
            pl.intensity === 0
          ) {
            pl.shadow.needsUpdate = true;
          }
          pl.position.set(nextX, nextY, nextZ);
          pl.color.setHex(src.colorHex);
          pl.distance = src.distance + chosenBoost * 3.0;
          pl.decay = src.decay;
          pl.intensity = src.flicker ? 2.55 + flickerDelta + chosenBoost : src.baseIntensity;
        } else {
          pl.intensity = 0;
        }
      }

      lightShadowsDirty = false;

      // Distance + frustum cull bog water & mist
      const bogDx = camX - bogWaterX;
      const bogDz = camZ - bogWaterZ;
      const bogDistSq = bogDx * bogDx + bogDz * bogDz;
      const bogVisLimit = waterRadius + maxRenderDist + 16;
      let nearBog = bogDistSq <= bogVisLimit * bogVisLimit;
      if (nearBog && frustumPlanes && bogDistSq > (waterRadius + 10) * (waterRadius + 10)) {
        nearBog = sphereIntersectsFrustum(
          frustumPlanes,
          bogWaterX,
          SWAMP_WATER_Y,
          bogWaterZ,
          waterRadius + 6
        );
      }
      swampWater.visible = nearBog;
      const isPrecip = weather === 'rain' || weather === 'storm';
      mistInst.visible = !isPrecip && nearBog && bogDistSq <= (waterRadius + 75) * (waterRadius + 75);

      if (nearBog) {
        bogWater.updateUniforms(elapsed, skyState, weather as WeatherId | undefined);
      }
      freshwaterSystem.updateUniforms(elapsed, skyState);
      if (skyState) {
        const duskGlow = THREE.MathUtils.clamp((0.86 - skyState.dayFactor) / 0.36, 0, 1);
        assets.activeWinMat.emissiveIntensity = 0.02 + duskGlow * 1.65;
      }

      mushroomSystem.updateVisibility(camX, camZ, mushroomDist, frustumPlanes);

      const fogCapSq = (maxRenderDist + 16) * (maxRenderDist + 16);
      for (let i = 0; i < structureNodes.length; i++) {
        const s = structureNodes[i];
        const capSq = Math.min(s.maxDistSq, fogCapSq);
        if ('bounds' in s) {
          const { min, max } = s.bounds;
          const dx = Math.max(min.x - camX, 0, camX - max.x);
          const dz = Math.max(min.z - camZ, 0, camZ - max.z);
          s.obj.visible = dx * dx + dz * dz < capSq;
          // Three.js frustum-culls the instance batch separately for each camera.
          continue;
        }
        const dx = s.x - camX;
        const dz = s.z - camZ;
        const dSq = dx * dx + dz * dz;
        if (dSq >= capSq) {
          s.obj.visible = false;
        } else if (frustumPlanes && dSq > 26 * 26) {
          s.obj.visible = sphereIntersectsFrustum(
            frustumPlanes,
            s.x,
            s.obj.position.y + 4.5,
            s.z,
            18.0
          );
        } else {
          s.obj.visible = true;
        }
      }
    },
    gatherMushroom: mushroomSystem.gatherMushroom,
    collectPickupItem: dynamicProps.collectPickupItem,
    shatterWoodAt: dynamicProps.shatterWoodAt,
    placePlayerCampfire: tentsSys.placePlayerCampfire,
    placePlayerTent: tentsSys.placePlayerTent,
    packUpPlayerTent: tentsSys.packUpPlayerTent,
    getTents: tentsSys.getTents,
    getBreakableStumps: dynamicProps.getBreakableStumps,
    getPickupItems: dynamicProps.getPickupItems,
    getEnvironmentStateAt: campfiresSys.getEnvironmentStateAt,
    getStructureAcousticsAt: campfiresSys.getStructureAcousticsAt,
    setCampfireLit: campfiresSys.setCampfireLit,
    getCampfireInfo: campfiresSys.getCampfireInfo,
    getCampfires: campfiresSys.getCampfires,
    throwFirewoodAtCampfire: (campfireId, startX, startY, startZ) =>
      campfiresSys.throwFirewoodAtCampfire(
        campfireId,
        startX,
        startY,
        startZ,
        dynamicProps.spawnFirewoodLog
      ),
    feedCampfireWithLog: campfiresSys.feedCampfireWithLog,
    feedDynamicFirewoodIntoCampfires: campfiresSys.feedDynamicFirewoodIntoCampfires,
    isWaterVisible: () => swampWater.visible,
    isMistVisible: () => mistInst.visible,
    getBogShoreDepthInfo: () => ({
      texture: bogWater.smoothDepthTex,
      centerX: bogWater.centerX,
      centerZ: bogWater.centerZ,
      radius: bogWater.radius,
    }),
    renderWaterReflection: (renderer, renderScene, cam, enabled) =>
      bogWater.renderReflection(renderer, renderScene, cam, enabled),
    spawnMushroomAt: (x: number, z: number, species: MushroomSpecies) => {
      mushroomSystem.spawnMushroom(x, z, species);
      lightShadowsDirty = true;
      return { x, y: getTerrainHeight(x, z), z, species };
    },
    spawnHutAt: (
      x: number,
      z: number,
      rotY = 0,
      decayState: HutDecayState = 'intact',
      name?: string
    ) => {
      buildings.buildEstonianLogHouse(x, z, rotY, {
        w: 6.4,
        d: 4.8,
        h: 2.55,
        roofStyle: decayState === 'intact' ? 'shingle' : 'thatch',
        warmWood: decayState === 'intact',
        abandoned: decayState !== 'intact',
        decayState,
        porch: decayState === 'intact',
        name: name ?? `Debug Hut (${decayState})`,
      });
      lightShadowsDirty = true;
      return { x, y: getTerrainHeight(x, z), z, decayState };
    },
    spawnCampfireAt: campfiresSys.spawnCampfireAt,
    spawnPickupItemAt: dynamicProps.spawnPickupItemAt,
    getInspectableMeshes: () => {
      const out: THREE.Object3D[] = [swampWater, ...freshwaterSystem.meshes];
      const seen = new Set<THREE.Object3D>(out);
      for (let i = 0; i < structureNodes.length; i++) {
        const obj = structureNodes[i].obj;
        if (obj.visible && !seen.has(obj)) {
          seen.add(obj);
          out.push(obj);
        }
      }
      for (let i = 0; i < interactiveObjects.length; i++) {
        const entry = interactiveObjects[i];
        if (entry.gathered || !entry.mesh.visible) continue;
        if (!seen.has(entry.mesh)) {
          seen.add(entry.mesh);
          out.push(entry.mesh);
        }
      }
      return out;
    },
    dispose: () => {
      interactiveIndex.clear();
      mushroomSystem.clear();
      resources.dispose();
    },
  };
}
