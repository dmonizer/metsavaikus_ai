import * as THREE from 'three';
import {
  buildInteractionPrompt,
  InteractionPromptData,
  MUSHROOM_SPECIES_INFO,
  MushroomSpecies,
} from '../../game/gameLogic';
import {
  addItemToInventory,
  CAMPFIRE_WOOD_COST,
  InventoryState,
  ITEM_CATALOG,
  MUSHROOM_TO_ITEM_ID,
} from '../../game/itemCatalog';
import { PlayerSurvivalState, refillBottlesFromSource } from '../../game/survivalEngine';
import { evaluateBogWaterFocusTarget, SWIM_ENTER_DEPTH, SWIM_EXIT_DEPTH } from '../../game/waterPhysics';
import { getItemName, getMushroomCopy, t } from '../../i18n/i18n';
import type { SurfaceMaterial } from '../../soundscape/types';
import type { InteractiveEntry, WorldPropsContext } from '../../world/architectureAndProps';
import type { DeadfallLogTarget, WorldVegetationSystem } from '../../world/foliageFactory';
import { selectUnobstructedInteractiveHit } from '../../world/interactionTargeting';
import type { SoundEngine } from '../../world/soundEngine';
import type { SimulatorSoundscape } from '../../world/soundscapeAdapter';
import { findNearestColliderObstructionDistance, moveSphere, sweepSphere } from '../../world/spatialPhysics';
import { getActiveBlueprint, getTerrainHeight, getWaterSurfaceAt } from '../../world/terrainMath';
import type { GamePhase } from '../worldRuntimeContracts';
import type { PlayerController } from './playerController';

const _rayCenter = new THREE.Vector2(0, 0);
const _camForward = new THREE.Vector3(0, 0, -1);
const _lookDir = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _waterAimHit = new THREE.Vector3();

export const getEntryName = (entry: InteractiveEntry): string =>
  entry.getName ? entry.getName() : entry.name;
export const getEntryDesc = (entry: InteractiveEntry): string =>
  entry.getDesc ? entry.getDesc() : entry.desc;
export const getEntryPickupLabel = (entry: InteractiveEntry): string | undefined =>
  entry.getPickupLabel ? entry.getPickupLabel() : entry.pickupLabel;
export const getEntrySecondaryActionLabel = (entry: InteractiveEntry): string | undefined =>
  entry.getSecondaryActionLabel ? entry.getSecondaryActionLabel() : undefined;

export interface InteractionControllerDeps {
  camera: THREE.PerspectiveCamera;
  player: PlayerController;
  sound: SoundEngine;
  soundscape: SimulatorSoundscape;
  getPhase: () => GamePhase;
  getUiModalOpen: () => boolean;
  getPropsCtx: () => WorldPropsContext | null;
  getVegetation: () => WorldVegetationSystem | null;
  getInventory: () => InventoryState;
  getSurvival: () => PlayerSurvivalState;
  getElapsed: () => number;
  getSimClockMs: () => number;
  onPromptChange: (prompt: InteractionPromptData | null) => void;
  onCarryChange: (label: string) => void;
  onToast: (msg: string) => void;
  onGatherMushroom: (species: MushroomSpecies) => void;
  onFinishInventoryChange: (beforePublish?: () => void) => void;
  onSyncHudAndSnapshot: () => void;
}

export class InteractionController {
  hoveredObj: InteractiveEntry | null = null;
  hoveredDeadfall: DeadfallLogTarget | null = null;
  canRefillBogWater = false;
  lastPromptKey = '';

  private readonly raycaster = new THREE.Raycaster();
  private readonly nearbyInteractiveEntries: InteractiveEntry[] = [];
  private readonly nearbyInteractives: THREE.Object3D[] = [];

  constructor(private readonly deps: InteractionControllerDeps) {
    this.raycaster.far = 4.2;
  }

  clearPrompt(forceNotify = false): void {
    this.canRefillBogWater = false;
    if (
      forceNotify ||
      this.hoveredObj !== null ||
      this.hoveredDeadfall !== null ||
      this.lastPromptKey !== ''
    ) {
      this.hoveredObj = null;
      this.hoveredDeadfall = null;
      this.lastPromptKey = '';
      this.deps.onPromptChange(null);
    }
  }

  emitPhysicalOutcome(opts: {
    type: 'object.impact' | 'object.break';
    origin: 'player' | 'environment';
    x: number;
    y: number;
    z: number;
    intensity: number;
    fallbackStrength: number;
    material: SurfaceMaterial;
    breakable: boolean;
    broken: boolean;
    correlationId?: string;
    dedupeKey?: string;
  }): void {
    this.deps.soundscape.engine.emitEvent({
      type: opts.type,
      origin: opts.origin,
      simulationTimestamp: this.deps.getSimClockMs(),
      position: { x: opts.x, y: opts.y, z: opts.z },
      intensity: opts.intensity,
      correlationId: opts.correlationId,
      dedupeKey: opts.dedupeKey,
      dedupeWindowMs: 120,
      payload: {
        material: opts.material,
        breakable: opts.breakable,
        broken: opts.broken,
      },
    });
    this.deps.sound.playPhysicalImpactFallback(opts.fallbackStrength);
  }

  updateInteractionHover(): void {
    const { camera, player, getPhase, getUiModalOpen, getPropsCtx, getVegetation, getInventory } =
      this.deps;
    const propsCtx = getPropsCtx();
    const vegetation = getVegetation();
    const inventory = getInventory();

    if (!propsCtx || getPhase() !== 'playing' || getUiModalOpen() || player.carrying || player.seatedTent) {
      this.clearPrompt();
      return;
    }

    this.nearbyInteractives.length = 0;
    propsCtx.queryInteractiveObjects(
      camera.position.x,
      camera.position.z,
      6.5,
      this.nearbyInteractiveEntries
    );
    for (const entry of this.nearbyInteractiveEntries) {
      this.nearbyInteractives.push(entry.mesh);
    }

    let nextHover: InteractiveEntry | null = null;
    if (this.nearbyInteractives.length > 0) {
      this.raycaster.setFromCamera(_rayCenter, camera);
      const hits = this.raycaster.intersectObjects(this.nearbyInteractives, true);
      nextHover = selectUnobstructedInteractiveHit(camera.position, hits, propsCtx.boxColliders);
    }
    this.hoveredObj = nextHover;

    this.hoveredDeadfall = null;
    camera.getWorldDirection(_camForward);
    if (!this.hoveredObj && vegetation) {
      const colliders = propsCtx.boxColliders;
      this.hoveredDeadfall = vegetation.findTargetDeadfall(
        camera.position,
        _camForward,
        4.8,
        (hitDist) =>
          findNearestColliderObstructionDistance(
            camera.position,
            _camForward,
            Math.max(0, hitDist - 0.02),
            colliders
          ) !== null
      );
    }

    this.canRefillBogWater = false;
    if (!this.hoveredObj && !this.hoveredDeadfall && inventory.bottles.length > 0) {
      const bp = getActiveBlueprint();
      const waterRadius = bp.bogRadius + 28;
      const onBoardwalkNow = player.isOnBoardwalk(player.pos.x, player.pos.z);
      const rawGroundYNow = getTerrainHeight(player.pos.x, player.pos.z);
      const waterNow = getWaterSurfaceAt(player.pos.x, player.pos.z, bp, rawGroundYNow);
      const waterDepthNow = onBoardwalkNow || !waterNow.hasWater ? 0 : waterNow.depth;
      const swimThreshold = player.lastIsSwimming ? SWIM_EXIT_DEPTH : SWIM_ENTER_DEPTH;
      const isSwimmingNow = !onBoardwalkNow && waterDepthNow >= swimThreshold;
      const colliders = propsCtx.boxColliders;

      this.canRefillBogWater = evaluateBogWaterFocusTarget({
        playerX: player.pos.x,
        playerZ: player.pos.z,
        onGround: player.onGround,
        onBoardwalk: onBoardwalkNow,
        isSwimming: isSwimmingNow,
        waterDepth: waterDepthNow,
        rawGroundY: rawGroundYNow,
        camX: camera.position.x,
        camY: camera.position.y,
        camZ: camera.position.z,
        dirX: _camForward.x,
        dirY: _camForward.y,
        dirZ: _camForward.z,
        bogCenterX: bp.bogCenterX,
        bogCenterZ: bp.bogCenterZ,
        waterRadius,
        getTerrainHeightAt: getTerrainHeight,
        getSurfaceHeightAt: (x, z) => player.getSurfaceHeightAt(x, z),
        getWaterSurfaceAt: (x, z) => getWaterSurfaceAt(x, z, bp),
        isSegmentBlocked: (hitX, hitY, hitZ) => {
          _waterAimHit.set(hitX, hitY, hitZ);
          for (let i = 0; i < colliders.length; i++) {
            if (sweepSphere(camera.position, _waterAimHit, 0, colliders[i])) {
              return true;
            }
          }
          return false;
        },
      });
    }

    let nextPrompt: InteractionPromptData | null = null;
    if (this.hoveredObj) {
      nextPrompt = buildInteractionPrompt(
        {
          name: getEntryName(this.hoveredObj),
          desc: getEntryDesc(this.hoveredObj),
          gatherable: this.hoveredObj.gatherable,
          carryable: this.hoveredObj.carryable,
          kickable: this.hoveredObj.kickable,
          breakable: this.hoveredObj.breakable,
          pickupLabel: getEntryPickupLabel(this.hoveredObj),
          secondaryActionLabel: getEntrySecondaryActionLabel(this.hoveredObj),
          hasUse: !!this.hoveredObj.onUse,
        },
        false
      );
    } else if (this.hoveredDeadfall) {
      nextPrompt = {
        title: t('prompt.fallenLogTitle'),
        actionsText:
          this.hoveredDeadfall.kicksRemaining <= 1
            ? t('prompt.fallenLogShatter')
            : t('prompt.fallenLogBreak'),
      };
    } else if (this.canRefillBogWater && inventory.bottles.length > 0) {
      const bp = getActiveBlueprint();
      const nearestStream = bp.streams.find((st) =>
        st.points.some((pt) => Math.hypot(pt.x - player.pos.x, pt.z - player.pos.z) < 6.5)
      );
      const nearestLake = !nearestStream
        ? bp.lakes.find((lk) => Math.hypot(lk.x - player.pos.x, lk.z - player.pos.z) < Math.max(lk.rx, lk.rz) * 1.35 + 8)
        : undefined;
      nextPrompt = {
        title: nearestStream
          ? `${nearestStream.name} (Forest Stream)`
          : nearestLake
            ? `${nearestLake.name} (Forest Lake)`
            : t('prompt.bogWaterTitle'),
        actionsText: t('prompt.bogWaterAction'),
      };
    }

    const key = nextPrompt ? `${nextPrompt.title}|${nextPrompt.actionsText}` : '';
    if (key !== this.lastPromptKey) {
      this.lastPromptKey = key;
      this.deps.onPromptChange(nextPrompt);
    }
  }

  handleInteractE(): void {
    const { player, sound, getPropsCtx, getInventory, getSurvival } = this.deps;
    const propsCtx = getPropsCtx();
    const inventory = getInventory();
    const survival = getSurvival();

    if (player.carrying) {
      player.dropCarried(1.5);
      sound.playImpact(0.4);
      return;
    }
    this.updateInteractionHover();
    if (!this.hoveredObj) {
      if (!this.hoveredDeadfall && this.canRefillBogWater && inventory.bottles.length > 0) {
        const res = refillBottlesFromSource(inventory, 'bog_lake');
        this.deps.onToast(res.message);
        if (res.refilledCount > 0) {
          sound.playFootstep('water');
          this.deps.onFinishInventoryChange();
        }
      }
      return;
    }

    if (this.hoveredObj.gatherable && propsCtx) {
      const gatheredSpecies = propsCtx.gatherMushroom(this.hoveredObj);
      if (gatheredSpecies) {
        const meta = MUSHROOM_SPECIES_INFO[gatheredSpecies];
        const localizedName = getMushroomCopy(gatheredSpecies).name;
        addItemToInventory(inventory, MUSHROOM_TO_ITEM_ID[gatheredSpecies], 1);
        this.deps.onGatherMushroom(gatheredSpecies);
        if (meta.edibility === 'poisonous') {
          this.deps.onToast(t('toast.gatherPoisonous', { name: localizedName }));
        } else if (meta.edibility === 'inedible') {
          this.deps.onToast(t('toast.gatherInedible', { name: localizedName }));
        } else {
          this.deps.onToast(t('toast.gatherEdible', { name: localizedName }));
        }
        this.hoveredObj = null;
        this.lastPromptKey = '';
        this.deps.onPromptChange(null);
        this.deps.onFinishInventoryChange();
      }
      return;
    }

    if (this.hoveredObj.pickupItemId && propsCtx) {
      const pickedId = propsCtx.collectPickupItem(this.hoveredObj);
      if (pickedId) {
        addItemToInventory(inventory, pickedId, 1);
        this.deps.onFinishInventoryChange(() => {
          const woodCount = inventory.stacks.firewood ?? 0;
          const totalKg = survival.backpackWeightKg.toFixed(2);
          const readyHint =
            pickedId === 'firewood' && woodCount >= CAMPFIRE_WOOD_COST
              ? t('toast.packedWoodReady')
              : pickedId === 'firewood'
                ? t('toast.packedWoodCount', { have: woodCount, need: CAMPFIRE_WOOD_COST })
                : '';
          this.deps.onToast(
            t('toast.packedItem', {
              name: getItemName(pickedId),
              unitKg: ITEM_CATALOG[pickedId].weightKg.toFixed(2),
              totalKg,
              hint: readyHint,
            })
          );
          this.hoveredObj = null;
          this.lastPromptKey = '';
          this.deps.onPromptChange(null);
        });
      }
      return;
    }

    if (this.hoveredObj.carryable) {
      player.carrying = this.hoveredObj;
      this.deps.onCarryChange(t('hud.carrying', { name: getEntryName(this.hoveredObj) }));
      sound.playImpact(0.35);
    } else if (this.hoveredObj.onUse) {
      this.hoveredObj.onUse();
    }
  }

  handleInteractF(): void {
    const { player, camera, soundscape, getPropsCtx, getVegetation, getSurvival, getElapsed, getSimClockMs } =
      this.deps;
    const propsCtx = getPropsCtx();
    const vegetation = getVegetation();
    const survival = getSurvival();
    const elapsed = getElapsed();
    const simClockMs = getSimClockMs();

    if (player.carrying) {
      const thrownMaterial = player.carrying.materialType ?? 'wood';
      player.dropCarried(11.5);
      this.emitPhysicalOutcome({
        type: 'object.impact',
        origin: 'player',
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        intensity: 0.7,
        fallbackStrength: 1.1,
        material: thrownMaterial,
        breakable: false,
        broken: false,
        dedupeKey: `throw_${Math.floor(elapsed * 5)}`,
      });
      return;
    }
    this.updateInteractionHover();
    if (!this.hoveredObj && this.hoveredDeadfall && vegetation && propsCtx) {
      survival.physicalTiredness = Math.min(100, survival.physicalTiredness + 3.5);
      const res = vegetation.kickDeadfall(this.hoveredDeadfall.id);
      if (res && res.hit) {
        const corrId = `kick_deadfall_${this.hoveredDeadfall.id}_${Math.round(simClockMs)}`;
        soundscape.engine.emitEvent({
          type: 'player.kick',
          origin: 'player',
          simulationTimestamp: simClockMs,
          position: { x: res.x, y: res.y, z: res.z },
          intensity: res.broken ? 1.2 : 0.95,
          correlationId: corrId,
          dedupeKey: `kick_${this.hoveredDeadfall.id}_${Math.floor(elapsed * 5)}`,
          dedupeWindowMs: 120,
          payload: { material: 'wood', broken: res.broken },
        });
        if (!res.broken) {
          this.emitPhysicalOutcome({
            type: 'object.impact',
            origin: 'player',
            x: res.x,
            y: res.y,
            z: res.z,
            intensity: 0.95,
            fallbackStrength: 1.1,
            material: 'wood',
            breakable: true,
            broken: false,
            correlationId: corrId,
            dedupeKey: `impact_${this.hoveredDeadfall.id}_${Math.floor(elapsed * 5)}`,
          });
          this.deps.onToast(t('toast.deadfallCracked'));
        } else {
          this.emitPhysicalOutcome({
            type: 'object.break',
            origin: 'player',
            x: res.x,
            y: res.y,
            z: res.z,
            intensity: 1.25,
            fallbackStrength: 1.45,
            material: 'wood',
            breakable: true,
            broken: true,
            correlationId: corrId,
            dedupeKey: `break_${this.hoveredDeadfall.id}_${Math.floor(elapsed * 5)}`,
          });
          const pieces = propsCtx.shatterWoodAt(res.x, res.y, res.z, res.rotY, 4);
          this.hoveredDeadfall = null;
          this.lastPromptKey = '';
          this.deps.onPromptChange(null);
          this.deps.onToast(t('toast.deadfallShattered', { count: pieces }));
        }
        this.deps.onSyncHudAndSnapshot();
      }
      return;
    }
    if (!this.hoveredObj) return;
    if (this.hoveredObj.gatherable) {
      this.deps.onToast(t('toast.gatherGently'));
      return;
    }
    if (this.hoveredObj.onSecondaryAction) {
      this.hoveredObj.onSecondaryAction();
      this.deps.onSyncHudAndSnapshot();
      return;
    }
    if (this.hoveredObj.onKick) {
      survival.physicalTiredness = Math.min(100, survival.physicalTiredness + 3.5);
      this.hoveredObj.onKick();
      if (this.hoveredObj.gathered) {
        this.hoveredObj = null;
        this.lastPromptKey = '';
        this.deps.onPromptChange(null);
      }
      this.deps.onSyncHudAndSnapshot();
      return;
    }
    if (this.hoveredObj.kickable) {
      _euler.set(player.pitch, player.yaw, 0, 'YXZ');
      _lookDir.set(0, 0, -1).applyEuler(_euler);
      _lookDir.y = 0.28;
      _lookDir.normalize();
      const force = 9.5 / Math.sqrt(this.hoveredObj.mass);
      this.hoveredObj.vel.addScaledVector(_lookDir, force);
      this.hoveredObj.angVel.set(
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 9
      );
      this.hoveredObj.resting = false;
      this.emitPhysicalOutcome({
        type: 'object.impact',
        origin: 'player',
        x: this.hoveredObj.mesh.position.x,
        y: this.hoveredObj.mesh.position.y,
        z: this.hoveredObj.mesh.position.z,
        intensity: 1.0,
        fallbackStrength: 1.2,
        material: this.hoveredObj.materialType ?? 'wood',
        breakable: Boolean(this.hoveredObj.breakable),
        broken: false,
        dedupeKey: `kickprop_${this.hoveredObj.name}_${Math.floor(elapsed * 5)}`,
      });
    } else {
      this.emitPhysicalOutcome({
        type: 'object.impact',
        origin: 'player',
        x: this.hoveredObj.mesh.position.x,
        y: this.hoveredObj.mesh.position.y,
        z: this.hoveredObj.mesh.position.z,
        intensity: 0.75,
        fallbackStrength: 0.8,
        material: this.hoveredObj.materialType ?? 'wood',
        breakable: false,
        broken: false,
        dedupeKey: `solid_${this.hoveredObj.name}_${Math.floor(elapsed * 5)}`,
      });
      this.deps.onToast(t('toast.wontBudge', { name: getEntryName(this.hoveredObj) }));
    }
  }

  handleInteractR(): void {
    if (this.deps.player.carrying) return;
    this.updateInteractionHover();
    if (this.hoveredObj) {
      if (this.hoveredObj.onTouch) this.hoveredObj.onTouch();
      else {
        this.deps.onToast(`${getEntryName(this.hoveredObj)}: ${getEntryDesc(this.hoveredObj)}`);
      }
      return;
    }
    if (this.hoveredDeadfall) {
      this.deps.onToast(t('toast.deadfallInspect'));
    }
  }

  updateDynamicObjects(dt: number): void {
    const propsCtx = this.deps.getPropsCtx();
    if (!propsCtx) return;
    const { player } = this.deps;
    const elapsed = this.deps.getElapsed();

    for (let i = 0; i < propsCtx.dynamicObjects.length; i++) {
      const obj = propsCtx.dynamicObjects[i];
      if (obj === player.carrying || obj.resting) continue;

      propsCtx.invalidateLightShadows();
      obj.vel.y -= 15.0 * dt;
      moveSphere(obj.mesh.position, obj.vel, dt, obj.radius, propsCtx.boxColliders);
      obj.mesh.rotation.x += obj.angVel.x * dt;
      obj.mesh.rotation.y += obj.angVel.y * dt;
      obj.mesh.rotation.z += obj.angVel.z * dt;

      const objSurfY = player.getSurfaceHeightAt(obj.mesh.position.x, obj.mesh.position.z);
      const objWater = getWaterSurfaceAt(obj.mesh.position.x, obj.mesh.position.z);
      const floorY =
        Math.max(objSurfY, objWater.hasWater ? objWater.waterY - 0.15 : -999) +
        obj.onGroundYOffset;
      if (obj.mesh.position.y <= floorY) {
        if (obj.vel.y < -2.2) {
          const impactIntensity = Math.min(1.0, Math.abs(obj.vel.y) / 8);
          this.emitPhysicalOutcome({
            type: 'object.impact',
            origin: 'environment',
            x: obj.mesh.position.x,
            y: obj.mesh.position.y,
            z: obj.mesh.position.z,
            intensity: impactIntensity,
            fallbackStrength: impactIntensity,
            material: obj.materialType ?? 'wood',
            breakable: Boolean(obj.breakable),
            broken: false,
            dedupeKey: `dyn_impact_${obj.name}_${Math.floor(elapsed * 8)}`,
          });
        }
        obj.mesh.position.y = floorY;
        obj.vel.y = Math.abs(obj.vel.y) > 1.8 ? -obj.vel.y * 0.3 : 0;
        obj.vel.x *= Math.pow(0.05, dt);
        obj.vel.z *= Math.pow(0.05, dt);
        obj.angVel.multiplyScalar(Math.pow(0.08, dt));

        if (obj.vel.lengthSq() < 0.01 && obj.angVel.lengthSq() < 0.02) {
          obj.vel.set(0, 0, 0);
          obj.angVel.set(0, 0, 0);
          obj.resting = true;
        }
      }
      propsCtx.updateInteractivePosition(obj);
    }
    propsCtx.feedDynamicFirewoodIntoCampfires();
  }
}
