import * as THREE from 'three';
import { canClearHeightCollider } from '../../game/gameLogic';
import {
  computeWeightBurden,
  LocomotionState,
  PlayerSurvivalState,
  WeightTierThresholds,
} from '../../game/survivalEngine';
import {
  evaluatePlayerWaterState,
  SWIM_EYE_ABOVE_WATER,
} from '../../game/waterPhysics';
import { t } from '../../i18n/i18n';
import type { SurfaceMaterial } from '../../soundscape/types';
import type {
  CircleCollider,
  InteractiveEntry,
  TentInfo,
  WorldPropsContext,
} from '../../world/architectureAndProps';
import type { WorldVegetationSystem } from '../../world/foliageFactory';
import type { FootstepSurface, SoundEngine } from '../../world/soundEngine';
import type { SimulatorSoundscape } from '../../world/soundscapeAdapter';
import { moveSphere, pushCharacterOut } from '../../world/spatialPhysics';
import { resolveSurfaceMaterial } from '../../world/surfaceMaterial';
import { isPointOnBoardwalkZone } from '../../world/architectureAndProps';
import {
  distToRoadDetail,
  getActiveBlueprint,
  getBiomeInfo,
  getSwampFactor,
  getTerrainHeight,
  roadCenterX,
  SWAMP_WATER_Y,
  WORLD_HALF,
} from '../../world/terrainMath';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _lookDir = new THREE.Vector3();
const _holdPos = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _nearbyVegColliders: CircleCollider[] = [];

export function computeTentSeatWorldPos(tent: TentInfo, out: THREE.Vector3): void {
  const lx = -0.04;
  const lz = -0.18;
  const cosY = Math.cos(tent.yaw);
  const sinY = Math.sin(tent.yaw);
  out.set(
    tent.x + lx * cosY + lz * sinY,
    tent.y + 0.56,
    tent.z - lx * sinY + lz * cosY
  );
}

export interface PlayerControllerDeps {
  camera: THREE.PerspectiveCamera;
  sound: SoundEngine;
  soundscape: SimulatorSoundscape;
  keysHeld: Set<string>;
  keysJustPressed: Set<string>;
  getPropsCtx: () => WorldPropsContext | null;
  getVegetation: () => WorldVegetationSystem | null;
  getPropCircleColliders: () => CircleCollider[];
  getSurvival: () => PlayerSurvivalState;
  getWeightThresholds: () => WeightTierThresholds;
  getElapsed: () => number;
  getSimClockMs: () => number;
  getUiModalOpen: () => boolean;
  setUiModalOpen: (open: boolean) => void;
  onCloseModals: () => void;
  onToast: (msg: string) => void;
  onCarryChange: (label: string) => void;
  onSyncHudAndSnapshot: () => void;
  onClearHoverPrompt: () => void;
}

export class PlayerController {
  readonly spawnZ = 6;
  readonly spawnX = roadCenterX(6);

  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  yaw = 0.05;
  pitch = -0.04;
  readonly eyeHeight = 1.7;
  readonly crouchEyeHeight = 1.05;
  currentEye = 1.7;
  onGround = true;
  carrying: InteractiveEntry | null = null;
  stepTimer = 0;
  bobPhase = 0;

  totalDistanceMoved = 0;
  playerExertion = 0;
  prevOnGround = true;
  fallPeakY: number;
  fallFromJump = false;
  waterFallEmitted = false;
  prevInWater = false;
  climbingOutOfWater = false;
  playerSpeedMps = 0;
  lastIsMoving = false;
  lastWantRun = false;
  lastCrouching = false;
  lastIsSwimming = false;
  lastIsSwampWading = false;
  lastOnBoardwalk = false;
  lastWaterDepthM = 0;
  lastLocomotion: LocomotionState = 'idle';

  seatedTent: TentInfo | null = null;
  seatedBaseYaw = 0;
  seatedBlend = 0;
  readonly seatedCamPos = new THREE.Vector3();
  readonly seatedStartPos = new THREE.Vector3();

  vomitLurchTimer = 0;

  constructor(private readonly deps: PlayerControllerDeps) {
    this.pos = new THREE.Vector3(this.spawnX, getTerrainHeight(this.spawnX, this.spawnZ), this.spawnZ);
    this.fallPeakY = this.pos.y;
  }

  getSurfaceHeightAt(x: number, z: number): number {
    let h = getTerrainHeight(x, z);
    const propsCtx = this.deps.getPropsCtx();
    if (!propsCtx) return h;
    h = propsCtx.shelters.floorHeight(x, z, h);
    for (let i = 0; i < propsCtx.boardwalkZones.length; i++) {
      const b = propsCtx.boardwalkZones[i];
      if (isPointOnBoardwalkZone(b, x, z) && b.y > h) {
        h = b.y;
      }
    }
    return h;
  }

  isOnBoardwalk(x: number, z: number): boolean {
    const propsCtx = this.deps.getPropsCtx();
    if (!propsCtx) return false;
    for (let i = 0; i < propsCtx.boardwalkZones.length; i++) {
      if (isPointOnBoardwalkZone(propsCtx.boardwalkZones[i], x, z)) return true;
    }
    return false;
  }

  resolveSurfaceMaterialAt(
    x: number,
    z: number,
    onBoardwalkNow: boolean,
    inWaterNow: boolean,
    swampWadingNow: boolean
  ): SurfaceMaterial {
    const propsCtx = this.deps.getPropsCtx();
    return resolveSurfaceMaterial({
      onBoardwalk: onBoardwalkNow,
      inWater: inWaterNow,
      swampWading: swampWadingNow,
      get structure() {
        return propsCtx?.getStructureAcousticsAt(x, z) ?? null;
      },
      get road() {
        return distToRoadDetail(x, z);
      },
      get biomeId() {
        return getBiomeInfo(x, z).id;
      },
    });
  }

  private applyCirclePush(pos: THREE.Vector3, list: CircleCollider[], pR: number): void {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const minD = pR + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD * minD && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = c.x + (dx / d) * minD;
        pos.z = c.z + (dz / d) * minD;
      }
    }
  }

  resolvePlayerCollisions(pos: THREE.Vector3): void {
    const pR = 0.42;
    this.applyCirclePush(pos, this.deps.getPropCircleColliders(), pR);

    const vegetation = this.deps.getVegetation();
    if (vegetation) {
      vegetation.queryNearbyColliders(pos.x, pos.z, _nearbyVegColliders);
      this.applyCirclePush(pos, _nearbyVegColliders, pR);
    }

    const propsCtx = this.deps.getPropsCtx();
    if (propsCtx) {
      for (let i = 0; i < propsCtx.boxColliders.length; i++) {
        const b = propsCtx.boxColliders[i];
        if (!b.active) continue;
        if (b.jumpable && canClearHeightCollider(pos.y, b.groundY, b.heightAboveGround)) {
          continue;
        }
        pushCharacterOut(pos, pR, this.currentEye + 0.2, b);
      }
    }

    const limit = WORLD_HALF - 10;
    pos.x = THREE.MathUtils.clamp(pos.x, -limit, limit);
    pos.z = THREE.MathUtils.clamp(pos.z, -limit, limit);
  }

  dropCarried(throwImpulse: number): void {
    if (!this.carrying) return;
    const item = this.carrying;
    this.carrying = null;
    item.resting = false;
    _euler.set(this.pitch, this.yaw, 0, 'YXZ');
    _lookDir.set(0, 0, -1).applyEuler(_euler);
    item.mesh.position.copy(this.deps.camera.position);
    const releaseOffset = _lookDir.clone().multiplyScalar(1.05);
    const propsCtx = this.deps.getPropsCtx();
    if (propsCtx) {
      moveSphere(item.mesh.position, releaseOffset, 1, item.radius, propsCtx.boxColliders, 0);
    }
    item.vel.copy(this.vel).addScaledVector(_lookDir, throwImpulse);
    item.vel.y += throwImpulse * 0.25;
    this.deps.onCarryChange('');
  }

  resetIdleMotionFlags(stopMovementAudio = true): void {
    this.lastIsMoving = false;
    this.lastWantRun = false;
    this.lastCrouching = false;
    this.playerSpeedMps = 0;
    this.lastLocomotion = 'idle';
    if (stopMovementAudio) {
      this.deps.soundscape.engine.stopMovementLoops();
    }
    this.deps.keysHeld.clear();
    this.deps.keysJustPressed.clear();
  }

  resetForRestart(stopHard = true): void {
    this.pos.set(this.spawnX, getTerrainHeight(this.spawnX, this.spawnZ), this.spawnZ);
    this.vel.set(0, 0, 0);
    this.yaw = 0.05;
    this.pitch = -0.04;
    this.currentEye = this.eyeHeight;
    if (this.carrying) this.dropCarried(0);
    this.seatedTent = null;
    this.totalDistanceMoved = 0;
    this.playerExertion = 0;
    this.prevOnGround = true;
    this.fallPeakY = this.pos.y;
    this.fallFromJump = false;
    this.waterFallEmitted = false;
    this.prevInWater = false;
    this.climbingOutOfWater = false;
    this.lastIsMoving = false;
    this.lastWantRun = false;
    this.lastCrouching = false;
    this.lastIsSwimming = false;
    this.lastIsSwampWading = false;
    this.lastOnBoardwalk = false;
    this.lastWaterDepthM = 0;
    this.playerSpeedMps = 0;
    this.lastLocomotion = 'idle';
    this.deps.keysHeld.clear();
    this.deps.keysJustPressed.clear();
    if (stopHard) {
      this.deps.soundscape.engine.stopMovementLoops(true);
    }
  }

  enterTentSeat(tent: TentInfo): void {
    const { sound, soundscape, camera, keysHeld, keysJustPressed } = this.deps;
    sound.init();
    sound.resume();
    if (this.carrying) this.dropCarried(0);
    this.seatedTent = tent;
    this.lastIsMoving = false;
    this.lastWantRun = false;
    this.lastCrouching = false;
    this.playerSpeedMps = 0;
    keysHeld.clear();
    keysJustPressed.clear();
    soundscape.engine.stopMovementLoops();
    this.seatedBaseYaw = tent.yaw + Math.PI;
    this.seatedBlend = 0;
    computeTentSeatWorldPos(tent, this.seatedCamPos);
    this.seatedStartPos.set(this.seatedCamPos.x, this.seatedCamPos.y + 0.16, this.seatedCamPos.z);
    this.pos.set(tent.x, tent.y, tent.z);
    this.vel.set(0, 0, 0);
    this.yaw = this.seatedBaseYaw;
    this.pitch = -0.03;
    camera.position.copy(this.seatedStartPos);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
    this.deps.setUiModalOpen(false);
    this.deps.onClearHoverPrompt();
    sound.playFabricRustle(true);
    this.deps.onToast(t('toast.satInTent'));
    this.deps.onSyncHudAndSnapshot();
  }

  exitTentSeat(silent = false): void {
    if (!this.seatedTent) return;
    const tent = this.seatedTent;
    this.seatedTent = null;
    const exitDist = 2.25;
    const ex = tent.x + Math.sin(tent.yaw) * exitDist;
    const ez = tent.z + Math.cos(tent.yaw) * exitDist;
    const ey = this.getSurfaceHeightAt(ex, ez);
    this.pos.set(ex, ey, ez);
    this.vel.set(0, 0, 0);
    this.yaw = tent.yaw + Math.PI;
    this.pitch = -0.04;
    this.currentEye = this.eyeHeight;
    this.resolvePlayerCollisions(this.pos);
    if (!silent) {
      this.deps.sound.playFabricRustle(false);
      this.deps.onToast(t('toast.stoodUpTent'));
    }
    this.deps.onSyncHudAndSnapshot();
  }

  step(
    dt: number,
    opts: { noClip: boolean; moveSpeedMult: number }
  ): { locomotion: LocomotionState; jumped: boolean } {
    const { camera, keysHeld, keysJustPressed, sound, soundscape } = this.deps;
    const survival = this.deps.getSurvival();
    const uiModalOpen = this.deps.getUiModalOpen();
    const elapsed = this.deps.getElapsed();
    const simClockMs = this.deps.getSimClockMs();
    const propsCtx = this.deps.getPropsCtx();

    if (this.seatedTent) {
      if (!uiModalOpen) {
        if (keysHeld.has('ArrowLeft')) this.yaw += 1.5 * dt;
        if (keysHeld.has('ArrowRight')) this.yaw -= 1.5 * dt;
        const rel = THREE.MathUtils.clamp(this.yaw - this.seatedBaseYaw, -1.48, 1.48);
        this.yaw = this.seatedBaseYaw + rel;
        if (keysHeld.has('ArrowUp')) {
          this.pitch = THREE.MathUtils.clamp(this.pitch + 1.1 * dt, -0.46, 0.52);
        }
        if (keysHeld.has('ArrowDown')) {
          this.pitch = THREE.MathUtils.clamp(this.pitch - 1.1 * dt, -0.46, 0.52);
        }
      }
      keysJustPressed.clear();
      this.seatedBlend = Math.min(1, this.seatedBlend + dt * 4.5);
      const ease = this.seatedBlend * this.seatedBlend * (3 - 2 * this.seatedBlend);
      const breathY = Math.sin(elapsed * 1.45) * 0.008;
      camera.position.lerpVectors(this.seatedStartPos, this.seatedCamPos, ease);
      camera.position.y += breathY;
      camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      camera.updateMatrixWorld();
      return { locomotion: 'idle', jumped: false };
    }

    if (uiModalOpen) {
      this.lastIsMoving = false;
      this.lastWantRun = false;
      this.lastCrouching = false;
      this.playerSpeedMps = 0;
      camera.position.set(this.pos.x, this.pos.y + this.currentEye, this.pos.z);
      camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      camera.updateMatrixWorld();
      return { locomotion: 'idle', jumped: false };
    }

    if (keysHeld.has('ArrowLeft')) this.yaw += 1.7 * dt;
    if (keysHeld.has('ArrowRight')) this.yaw -= 1.7 * dt;
    if (keysHeld.has('ArrowUp')) {
      this.pitch = THREE.MathUtils.clamp(this.pitch + 1.2 * dt, -Math.PI * 0.48, Math.PI * 0.48);
    }
    if (keysHeld.has('ArrowDown')) {
      this.pitch = THREE.MathUtils.clamp(this.pitch - 1.2 * dt, -Math.PI * 0.48, Math.PI * 0.48);
    }

    const crouching = keysHeld.has('KeyC');
    const canSprint = survival.physicalTiredness < 94 && survival.energy > 5;
    const wantRun =
      (keysHeld.has('ShiftLeft') || keysHeld.has('ShiftRight')) && !crouching && canSprint;

    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _move.set(0, 0, 0);

    if (keysHeld.has('KeyW')) _move.add(_fwd);
    if (keysHeld.has('KeyS')) _move.sub(_fwd);
    if (keysHeld.has('KeyD')) _move.add(_right);
    if (keysHeld.has('KeyA')) _move.sub(_right);

    const moving = _move.lengthSq() > 0.01;
    if (moving) _move.normalize();

    if (opts.noClip) {
      const wantRunFly = keysHeld.has('ShiftLeft') || keysHeld.has('ShiftRight');
      const flySpeed = 11.5 * opts.moveSpeedMult * (wantRunFly ? 2.2 : 1.0);
      const vertSpeed = 8.5 * opts.moveSpeedMult * (wantRunFly ? 1.8 : 1.0);
      const prevX = this.pos.x;
      const prevZ = this.pos.z;
      this.pos.addScaledVector(_move, flySpeed * dt);
      if (keysHeld.has('Space')) this.pos.y += vertSpeed * dt;
      if (crouching) this.pos.y -= vertSpeed * dt;
      const limit = WORLD_HALF - 10;
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -limit, limit);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, -limit, limit);
      this.vel.set(0, 0, 0);
      this.onGround = false;
      const frameMovedM = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
      this.totalDistanceMoved += frameMovedM;
      this.playerSpeedMps = dt > 0.0001 ? frameMovedM / dt : 0;
      this.lastIsMoving = false;
      this.lastWantRun = false;
      this.lastCrouching = false;
      this.lastIsSwimming = false;
      this.lastIsSwampWading = false;
      this.lastOnBoardwalk = false;
      this.lastWaterDepthM = 0;
      keysJustPressed.clear();
      camera.position.set(this.pos.x, this.pos.y + this.currentEye, this.pos.z);
      camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      camera.updateMatrixWorld();
      return { locomotion: 'idle', jumped: false };
    }

    const onBoardwalk = this.isOnBoardwalk(this.pos.x, this.pos.z);
    const rawGroundY = getTerrainHeight(this.pos.x, this.pos.z);
    const curSurfaceY = this.getSurfaceHeightAt(this.pos.x, this.pos.z);
    const activeBpNow = getActiveBlueprint();
    const inWaterBasin =
      Math.hypot(this.pos.x - activeBpNow.bogCenterX, this.pos.z - activeBpNow.bogCenterZ) <=
      activeBpNow.bogRadius + 28;
    const waterState = evaluatePlayerWaterState({
      rawGroundY,
      surfaceY: curSurfaceY,
      onBoardwalk,
      swampFactor: getSwampFactor(this.pos.x, this.pos.z),
      crouching,
      wasSwimming: this.lastIsSwimming,
      eyeHeight: this.eyeHeight,
      crouchEyeHeight: this.crouchEyeHeight,
      inWaterBasin,
    });
    const wasSwimming = this.lastIsSwimming;
    const waterDepth = waterState.waterDepth;
    const isSwimming = waterState.isSwimming;
    const isSwampWading = waterState.isSwampWading;

    const burden = computeWeightBurden(
      survival.backpackWeightKg,
      survival.waterStomachLoadL,
      this.deps.getWeightThresholds()
    );
    const tirednessSpeedMult =
      survival.physicalTiredness > 72
        ? THREE.MathUtils.lerp(1.0, 0.68, (survival.physicalTiredness - 72) / 28)
        : 1.0;

    let speed = crouching ? 2.5 : wantRun && moving && !isSwimming ? 8.0 : 4.6;
    if (isSwimming) {
      speed = 4.6 * waterState.speedMultiplier;
    } else {
      speed *= waterState.speedMultiplier;
    }
    speed *= burden.moveSpeedMultiplier * tirednessSpeedMult * opts.moveSpeedMult;

    let locomotion: LocomotionState = 'idle';
    if (isSwimming) locomotion = 'swim';
    else if (moving) {
      if (waterState.isWadingWater || isSwampWading) locomotion = 'swamp';
      else if (wantRun) locomotion = 'run';
      else locomotion = 'walk';
    }

    const prevX = this.pos.x;
    const prevZ = this.pos.z;
    this.pos.addScaledVector(_move, speed * dt);
    this.resolvePlayerCollisions(this.pos);

    const frameMovedM = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
    this.totalDistanceMoved += frameMovedM;
    this.playerSpeedMps = dt > 0.0001 ? frameMovedM / dt : 0;
    this.lastIsMoving = moving;
    this.lastWantRun = wantRun;
    this.lastCrouching = crouching;
    this.lastIsSwimming = isSwimming;
    this.lastIsSwampWading = isSwampWading;
    this.lastOnBoardwalk = onBoardwalk;
    this.lastWaterDepthM = waterDepth;

    if (isSwimming && !wasSwimming) {
      if (this.deps.getUiModalOpen()) {
        this.deps.onCloseModals();
      }
      this.deps.onSyncHudAndSnapshot();
    } else if (!isSwimming && wasSwimming) {
      this.deps.onSyncHudAndSnapshot();
    }

    const targetExertion = isSwimming
      ? moving
        ? 0.78
        : 0.48
      : moving && wantRun
        ? survival.physicalTiredness > 60
          ? 0.94
          : 0.68
        : moving
          ? 0.25 + (survival.physicalTiredness / 100) * 0.28
          : Math.max(
              0.05,
              (survival.physicalTiredness / 100) * 0.35 + ((100 - survival.energy) / 100) * 0.22
            );
    const exRate = targetExertion > this.playerExertion ? dt * 0.45 : dt * 0.22;
    this.playerExertion += (targetExertion - this.playerExertion) * Math.min(1, exRate);

    let jumped = false;
    if (keysJustPressed.has('Space') && this.onGround && !crouching && !isSwimming) {
      this.vel.y = 6.4;
      this.onGround = false;
      jumped = true;
      this.fallPeakY = this.pos.y;
      this.fallFromJump = true;
      this.waterFallEmitted = false;
      this.climbingOutOfWater = false;
      const jumpSurface = this.resolveSurfaceMaterialAt(
        this.pos.x,
        this.pos.z,
        onBoardwalk,
        waterState.isInWater,
        isSwampWading
      );
      soundscape.engine.emitEvent({
        type: 'player.jump',
        origin: 'player',
        simulationTimestamp: simClockMs,
        position: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
        intensity: 0.8,
        payload: { surface: jumpSurface, material: jumpSurface },
      });
    }
    keysJustPressed.clear();

    if (this.onGround && !this.prevInWater && !this.climbingOutOfWater) {
      this.fallPeakY = this.pos.y;
    } else if (!this.onGround) {
      this.fallPeakY = Math.max(this.fallPeakY, this.pos.y);
    }

    const preLandVelY = this.vel.y;
    if (!this.climbingOutOfWater) {
      this.vel.y -= 16.5 * dt;
      this.pos.y += this.vel.y * dt;
    }

    const newOnBoardwalk = this.isOnBoardwalk(this.pos.x, this.pos.z);
    const newRawGroundY = getTerrainHeight(this.pos.x, this.pos.z);
    const newSurfaceY = this.getSurfaceHeightAt(this.pos.x, this.pos.z);
    const newInBasin =
      Math.hypot(this.pos.x - activeBpNow.bogCenterX, this.pos.z - activeBpNow.bogCenterZ) <=
      activeBpNow.bogRadius + 28;
    const postWaterState = evaluatePlayerWaterState({
      rawGroundY: newRawGroundY,
      surfaceY: newSurfaceY,
      onBoardwalk: newOnBoardwalk,
      swampFactor: getSwampFactor(this.pos.x, this.pos.z),
      crouching,
      wasSwimming: isSwimming,
      eyeHeight: this.eyeHeight,
      crouchEyeHeight: this.crouchEyeHeight,
      inWaterBasin: newInBasin,
    });

    const minFloorY = postWaterState.minFloorY;

    if (
      postWaterState.isInWater &&
      !this.waterFallEmitted &&
      (this.pos.y <= SWAMP_WATER_Y + 0.08 || this.pos.y <= minFloorY)
    ) {
      const dropToWaterM = Math.max(0, this.fallPeakY - SWAMP_WATER_Y);
      if (dropToWaterM >= 0.2 || (!this.prevInWater && preLandVelY < -1.6) || this.fallFromJump) {
        const distanceM = Math.max(0.2, Math.round(dropToWaterM * 100) / 100);
        const impactSpeed = Math.max(Math.abs(preLandVelY), Math.sqrt(2 * 16.5 * distanceM));
        soundscape.engine.emitEvent({
          type: 'player.fall',
          origin: 'player',
          simulationTimestamp: simClockMs,
          position: { x: this.pos.x, y: SWAMP_WATER_Y, z: this.pos.z },
          intensity: THREE.MathUtils.clamp(0.48 + distanceM * 0.45, 0.48, 1.35),
          payload: {
            distanceM,
            surface: 'water',
            material: 'water',
            impactSpeed: Math.round(impactSpeed * 100) / 100,
            fromJump: this.fallFromJump,
            waterDepthM: Math.round(postWaterState.waterDepth * 100) / 100,
          },
        });
        if (this.vel.y < 0) this.vel.y *= 0.42;
        this.waterFallEmitted = true;
        this.fallFromJump = false;
      }
    }

    if (this.prevInWater && !postWaterState.isInWater && minFloorY - this.pos.y > 0.16) {
      this.climbingOutOfWater = true;
    }
    if (postWaterState.isInWater) {
      this.climbingOutOfWater = false;
    }

    if (this.climbingOutOfWater) {
      this.pos.y = THREE.MathUtils.lerp(this.pos.y, minFloorY, Math.min(1, dt * 11.5));
      if (Math.abs(minFloorY - this.pos.y) < 0.025) {
        this.pos.y = minFloorY;
        this.climbingOutOfWater = false;
      }
      this.vel.y = 0;
      this.onGround = true;
      this.fallPeakY = this.pos.y;
      this.fallFromJump = false;
      this.waterFallEmitted = false;
    } else if (this.pos.y <= minFloorY) {
      if (postWaterState.isSwimming && this.pos.y < minFloorY - 0.01) {
        this.pos.y = THREE.MathUtils.lerp(this.pos.y, minFloorY, Math.min(1, dt * 8));
      } else {
        this.pos.y = minFloorY;
      }
      this.vel.y = 0;
      this.onGround = true;

      if (!this.prevOnGround && !postWaterState.isInWater) {
        const landingSurface = this.resolveSurfaceMaterialAt(
          this.pos.x,
          this.pos.z,
          newOnBoardwalk,
          false,
          postWaterState.isSwampWading
        );
        const fallDistanceM = Math.max(0, this.fallPeakY - this.pos.y);
        if (fallDistanceM >= 0.25 || preLandVelY < -2.4) {
          const roundedDist = Math.round(fallDistanceM * 100) / 100;
          soundscape.engine.emitEvent({
            type: 'player.fall',
            origin: 'player',
            simulationTimestamp: simClockMs,
            position: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
            intensity: THREE.MathUtils.clamp(0.4 + roundedDist * 0.42, 0.4, 1.35),
            payload: {
              distanceM: roundedDist,
              surface: landingSurface,
              material: landingSurface,
              impactSpeed: Math.round(Math.abs(preLandVelY) * 100) / 100,
              fromJump: this.fallFromJump,
              waterDepthM: 0,
            },
          });
        }
        if (preLandVelY < -2.4) {
          soundscape.engine.emitEvent({
            type: 'player.land',
            origin: 'player',
            simulationTimestamp: simClockMs,
            position: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
            intensity: Math.min(1.2, Math.abs(preLandVelY) / 8),
            payload: {
              impactSpeed: Math.abs(preLandVelY),
              surface: landingSurface,
              material: landingSurface,
            },
          });
        }
      }

      if (!postWaterState.isInWater) {
        this.waterFallEmitted = false;
        this.fallPeakY = this.pos.y;
        this.fallFromJump = false;
      }
    } else {
      this.onGround = false;
    }
    this.prevOnGround = this.onGround;
    this.prevInWater = postWaterState.isInWater;

    this.currentEye = THREE.MathUtils.lerp(
      this.currentEye,
      postWaterState.targetEyeHeight,
      Math.min(1, dt * 8.5)
    );

    let bobY = 0;
    if (isSwimming) {
      this.bobPhase += dt * (moving ? 5.2 : 2.3);
      bobY = Math.sin(this.bobPhase) * (moving ? 0.032 : 0.018);
      if (moving) {
        this.stepTimer += dt * 1.15;
        if (this.stepTimer >= 1) {
          this.stepTimer = 0;
          if (!sound.getSoundscapeEngine()) sound.playFootstep('swim');
        }
      }
    } else if (moving && this.onGround) {
      const freq = wantRun ? 13 : 8.5;
      this.bobPhase += dt * freq;
      bobY = Math.sin(this.bobPhase) * (wantRun ? 0.065 : 0.038);
      this.stepTimer += dt * (wantRun ? 2.4 : 1.55);
      if (this.stepTimer >= 1) {
        this.stepTimer = 0;
        let surf: FootstepSurface = 'grass';
        if (onBoardwalk) surf = 'wood';
        else if (waterState.isWadingWater) surf = 'water';
        else if (isSwampWading) surf = 'swamp';
        else if (distToRoadDetail(this.pos.x, this.pos.z).dist < 3.3) surf = 'road';
        if (!sound.getSoundscapeEngine()) sound.playFootstep(surf);
      }
    }

    let shiverX = 0;
    let shiverY = 0;
    if (survival.bodyTempC < 35.4) {
      const amp = THREE.MathUtils.clamp((35.4 - survival.bodyTempC) / 1.8, 0.15, 1) * 0.011;
      shiverX = Math.sin(elapsed * 29.0) * amp;
      shiverY = Math.cos(elapsed * 33.0) * amp * 0.8;
    }
    let vomitPitchOffset = 0;
    if (this.vomitLurchTimer > 0) {
      this.vomitLurchTimer = Math.max(0, this.vomitLurchTimer - dt);
      vomitPitchOffset = -Math.sin(this.vomitLurchTimer * Math.PI) * 0.24;
    }

    const rawCamY = this.pos.y + this.currentEye + bobY + shiverY;
    const safeCamY = postWaterState.isInWater
      ? Math.max(SWAMP_WATER_Y + SWIM_EYE_ABOVE_WATER - 0.05, rawCamY)
      : rawCamY;

    camera.position.set(this.pos.x + shiverX, safeCamY, this.pos.z);
    camera.rotation.set(
      THREE.MathUtils.clamp(this.pitch + vomitPitchOffset, -Math.PI * 0.48, Math.PI * 0.48),
      this.yaw,
      0,
      'YXZ'
    );
    camera.updateMatrixWorld();

    if (this.carrying) {
      _euler.set(this.pitch, this.yaw, 0, 'YXZ');
      _lookDir.set(0, 0, -1).applyEuler(_euler);
      _holdPos.copy(camera.position).addScaledVector(_lookDir, 1.15);
      _holdPos.y -= 0.22;
      const carried = this.carrying;
      const holdOffset = _holdPos.clone().sub(camera.position);
      const safeHold = camera.position.clone();
      if (propsCtx) moveSphere(safeHold, holdOffset, 1, carried.radius, propsCtx.boxColliders, 0);
      if (carried.mesh.position.distanceToSquared(safeHold) > 0.000001) {
        propsCtx?.invalidateLightShadows();
      }
      carried.mesh.position.copy(safeHold);
      propsCtx?.updateInteractivePosition(carried);
    }

    return { locomotion, jumped };
  }
}
