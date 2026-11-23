import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  buildInteractionPrompt,
  canClearHeightCollider,
  formatFpsLabel,
  InteractionPromptData,
  MUSHROOM_SPECIES_INFO,
  MushroomBasket,
  MushroomSpecies,
  smoothFps,
} from '../game/gameLogic';
import {
  buildArchitectureAndProps,
  CircleCollider,
  InteractiveEntry,
  WorldPropsContext,
} from '../world/architectureAndProps';
import { VegetationStats, WorldVegetationSystem } from '../world/foliageFactory';
import { createWorldTextures, WorldTextures } from '../world/proceduralTextures';
import { SoundEngine, FootstepSurface } from '../world/soundEngine';
import {
  ChunkVisibilityStats,
  TerrainChunkManager,
} from '../world/terrainChunkManager';
import {
  distToRoadDetail,
  getBiomeInfo,
  getTerrainHeight,
  roadCenterX,
  setActiveWorldSeed,
  SWAMP_WATER_Y,
  WORLD_HALF,
} from '../world/terrainMath';
import { ComputeEngine } from '../world/wasmCompute';
import { WEATHER_LABELS, WeatherAndSkySystem } from '../world/weatherAndSky';

export type GamePhase = 'title' | 'playing' | 'paused';

export interface WorldHudRefs {
  fpsEl: React.RefObject<HTMLSpanElement | null>;
  staminaFillEl: React.RefObject<HTMLDivElement | null>;
  biomeEl: React.RefObject<HTMLDivElement | null>;
  timeWeatherEl: React.RefObject<HTMLDivElement | null>;
  flashEl: React.RefObject<HTMLDivElement | null>;
}

export interface WorldCallbacks {
  onGatherMushroom: (species: MushroomSpecies) => void;
  onPromptChange: (prompt: InteractionPromptData | null) => void;
  onCarryChange: (label: string) => void;
  onToast: (msg: string) => void;
  onPhaseChange: (phase: GamePhase) => void;
  onWorldReady: (info: { wasmActive: boolean; totalMushrooms: number }) => void;
}

export interface WorldActions {
  startPlaying: () => void;
  resumePlaying: () => void;
  restartWorld: () => void;
  cycleWeather: () => void;
  advanceTime: () => void;
  toggleFlashlight: () => void;
  toggleMute: () => boolean;
}

interface MetsavaikusWorldProps {
  worldSeed: number;
  phase: GamePhase;
  hudRefs: WorldHudRefs;
  callbacks: WorldCallbacks;
  actionsRef: React.MutableRefObject<WorldActions | null>;
  basket: MushroomBasket;
}

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _lookDir = new THREE.Vector3();
const _holdPos = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _rayCenter = new THREE.Vector2(0, 0);
const _nearbyVegColliders: CircleCollider[] = [];

export const MetsavaikusWorld: React.FC<MetsavaikusWorldProps> = ({
  worldSeed,
  phase,
  hudRefs,
  callbacks,
  actionsRef,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;

  const callbacksRef = useRef<WorldCallbacks>(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    // Generate active procedural world blueprint from seed before sampling terrain or building props
    setActiveWorldSeed(worldSeed);

    let disposed = false;
    let frameId = 0;
    let isTimeoutFrame = false;

    const isSoftwareGl = detectSoftwareGl();
    const pixelRatio = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.dataset.worldSeed = String(worldSeed);
    mountEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.1,
      460
    );

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const flashlight = new THREE.SpotLight(0xfff1cc, 0, 38, Math.PI / 5.5, 0.45, 1.4);
    flashlight.visible = false;
    flashlight.position.set(0, 0, 0);
    camera.add(flashlight);
    camera.add(flashlight.target);
    flashlight.target.position.set(0, -0.05, -5);
    scene.add(camera);

    const sound = new SoundEngine();
    const weatherSky = new WeatherAndSkySystem(scene, isSoftwareGl, pixelRatio);

    let textures: WorldTextures | null = null;
    let vegetation: WorldVegetationSystem | null = null;
    let propsCtx: WorldPropsContext | null = null;
    let propCircleColliders: CircleCollider[] = [];
    let terrainMgr: TerrainChunkManager | null = null;
    let computeEngine: ComputeEngine | null = null;

    // Spawn player on open gravel road facing north toward the homestead
    const spawnZ = 6;
    const spawnX = roadCenterX(spawnZ);
    const player = {
      pos: new THREE.Vector3(spawnX, getTerrainHeight(spawnX, spawnZ), spawnZ),
      vel: new THREE.Vector3(),
      yaw: 0.05,
      pitch: -0.04,
      eyeHeight: 1.7,
      crouchEyeHeight: 1.05,
      currentEye: 1.7,
      onGround: true,
      stamina: 100,
      carrying: null as InteractiveEntry | null,
      stepTimer: 0,
      bobPhase: 0,
    };

    let flashlightOn = false;
    let isMuted = false;
    let pointerLocked = false;
    let mouseDragging = false;
    let hoveredObj: InteractiveEntry | null = null;
    let lastPromptKey = '';

    const keysHeld = new Set<string>();
    const keysJustPressed = new Set<string>();
    const raycaster = new THREE.Raycaster();
    raycaster.far = 3.8;

    const chunkStats: ChunkVisibilityStats = { visibleChunks: 0, lod0: 0, lod1: 0, lod2: 0 };
    const vegStats: VegetationStats = { treesRendered: 0, foliageRendered: 0 };

    function getSurfaceHeightAt(x: number, z: number): number {
      let h = getTerrainHeight(x, z);
      if (!propsCtx) return h;
      for (let i = 0; i < propsCtx.boardwalkZones.length; i++) {
        const b = propsCtx.boardwalkZones[i];
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
          if (b.y > h) h = b.y;
        }
      }
      return h;
    }

    function isOnBoardwalk(x: number, z: number): boolean {
      if (!propsCtx) return false;
      for (let i = 0; i < propsCtx.boardwalkZones.length; i++) {
        const b = propsCtx.boardwalkZones[i];
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return true;
      }
      return false;
    }

    function applyCirclePush(pos: THREE.Vector3, list: CircleCollider[], pR: number): void {
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

    function resolvePlayerCollisions(pos: THREE.Vector3): void {
      const pR = 0.42;
      applyCirclePush(pos, propCircleColliders, pR);

      if (vegetation) {
        vegetation.queryNearbyColliders(pos.x, pos.z, _nearbyVegColliders);
        applyCirclePush(pos, _nearbyVegColliders, pR);
      }

      if (propsCtx) {
        for (let i = 0; i < propsCtx.boxColliders.length; i++) {
          const b = propsCtx.boxColliders[i];
          if (!b.active) continue;
          // Jumpable split-pole fences allow clearing over the top rail when jumping!
          if (b.jumpable && canClearHeightCollider(pos.y, b.groundY, b.heightAboveGround)) {
            continue;
          }
          const nearX = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
          const nearZ = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
          const dx = pos.x - nearX;
          const dz = pos.z - nearZ;
          const d2 = dx * dx + dz * dz;
          if (d2 < pR * pR) {
            if (d2 > 0.00001) {
              const d = Math.sqrt(d2);
              pos.x = nearX + (dx / d) * pR;
              pos.z = nearZ + (dz / d) * pR;
            } else {
              pos.x = b.minX - pR;
            }
          }
        }
      }

      // Rectangular world boundary inside 1200x1200m playable countryside
      const limit = WORLD_HALF - 10;
      pos.x = THREE.MathUtils.clamp(pos.x, -limit, limit);
      pos.z = THREE.MathUtils.clamp(pos.z, -limit, limit);
    }

    function dropCarried(throwImpulse: number): void {
      if (!player.carrying) return;
      const item = player.carrying;
      player.carrying = null;
      item.resting = false;
      _euler.set(player.pitch, player.yaw, 0, 'YXZ');
      _lookDir.set(0, 0, -1).applyEuler(_euler);
      item.mesh.position.copy(camera.position).addScaledVector(_lookDir, 1.05);
      item.vel.copy(player.vel).addScaledVector(_lookDir, throwImpulse);
      item.vel.y += throwImpulse * 0.25;
      callbacksRef.current.onCarryChange('');
    }

    function handleInteractE(): void {
      if (player.carrying) {
        dropCarried(1.5);
        sound.playImpact(0.4);
        return;
      }
      if (!hoveredObj) return;

      if (hoveredObj.gatherable && propsCtx) {
        const gatheredSpecies = propsCtx.gatherMushroom(hoveredObj);
        if (gatheredSpecies) {
          const meta = MUSHROOM_SPECIES_INFO[gatheredSpecies];
          callbacksRef.current.onGatherMushroom(gatheredSpecies);
          if (meta.edibility === 'poisonous') {
            callbacksRef.current.onToast(`WARNING: ${meta.estonian} (${meta.english}) is POISONOUS!`);
          } else if (meta.edibility === 'inedible') {
            callbacksRef.current.onToast(`Caution: ${meta.estonian} (${meta.english}) is bitter & inedible.`);
          } else {
            callbacksRef.current.onToast(`Gathered ${meta.english} (${meta.estonian})`);
          }
          hoveredObj = null;
          lastPromptKey = '';
          callbacksRef.current.onPromptChange(null);
        }
        return;
      }

      if (hoveredObj.carryable) {
        player.carrying = hoveredObj;
        callbacksRef.current.onCarryChange(
          `Carrying: ${hoveredObj.name} ([E] Drop · [F] Throw)`
        );
        sound.playImpact(0.35);
      } else if (hoveredObj.onUse) {
        hoveredObj.onUse();
      }
    }

    function handleInteractF(): void {
      if (player.carrying) {
        dropCarried(11.5);
        sound.playImpact(1.1);
        return;
      }
      if (!hoveredObj) return;
      if (hoveredObj.gatherable) {
        callbacksRef.current.onToast('Press [E] to gather mushrooms gently.');
        return;
      }
      if (hoveredObj.kickable) {
        _euler.set(player.pitch, player.yaw, 0, 'YXZ');
        _lookDir.set(0, 0, -1).applyEuler(_euler);
        _lookDir.y = 0.28;
        _lookDir.normalize();
        const force = 9.5 / Math.sqrt(hoveredObj.mass);
        hoveredObj.vel.addScaledVector(_lookDir, force);
        hoveredObj.angVel.set(
          (Math.random() - 0.5) * 9,
          (Math.random() - 0.5) * 9,
          (Math.random() - 0.5) * 9
        );
        hoveredObj.resting = false;
        sound.playImpact(1.2);
      } else {
        sound.playImpact(0.8);
        callbacksRef.current.onToast(
          `You push against the ${hoveredObj.name}, but it won't budge.`
        );
      }
    }

    function handleInteractR(): void {
      if (!hoveredObj) return;
      if (hoveredObj.onTouch) hoveredObj.onTouch();
      else callbacksRef.current.onToast(`${hoveredObj.name}: ${hoveredObj.desc}`);
    }

    actionsRef.current = {
      startPlaying: () => {
        sound.init();
        sound.resume();
        keysHeld.clear();
        keysJustPressed.clear();
        callbacksRef.current.onPhaseChange('playing');
      },
      resumePlaying: () => {
        sound.init();
        sound.resume();
        keysHeld.clear();
        keysJustPressed.clear();
        callbacksRef.current.onPhaseChange('playing');
      },
      restartWorld: () => {
        player.pos.set(spawnX, getTerrainHeight(spawnX, spawnZ), spawnZ);
        player.vel.set(0, 0, 0);
        player.yaw = 0.05;
        player.pitch = -0.04;
        player.stamina = 100;
        if (player.carrying) dropCarried(0);
        keysHeld.clear();
        keysJustPressed.clear();
        sound.resume();
        callbacksRef.current.onPhaseChange('playing');
      },
      cycleWeather: () => {
        const w = weatherSky.cycleWeather();
        callbacksRef.current.onToast(`Weather: ${WEATHER_LABELS[w]}`);
      },
      advanceTime: () => {
        weatherSky.advanceTime(2);
        callbacksRef.current.onToast('Time advanced +2 hours.');
      },
      toggleFlashlight: () => {
        flashlightOn = !flashlightOn;
        flashlight.visible = flashlightOn;
        flashlight.intensity = flashlightOn ? 3.5 : 0;
        sound.playImpact(0.3);
      },
      toggleMute: () => {
        isMuted = !isMuted;
        sound.setMuted(isMuted);
        return isMuted;
      },
    };

    const onPointerLockChange = () => {
      pointerLocked = document.pointerLockElement === renderer.domElement;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (phaseRef.current !== 'playing') return;
      if (e.target !== renderer.domElement) return;
      sound.init();
      mouseDragging = true;
      if (!pointerLocked && renderer.domElement.requestPointerLock) {
        try {
          renderer.domElement.requestPointerLock();
        } catch {
          // Ignore pointer lock rejection in headless/sandboxed environments
        }
      }
    };

    const onMouseUp = () => {
      mouseDragging = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (phaseRef.current !== 'playing') return;
      if (!pointerLocked && !mouseDragging) return;
      const sens = 0.0022;
      player.yaw -= e.movementX * sens;
      player.pitch = THREE.MathUtils.clamp(
        player.pitch - e.movementY * sens,
        -Math.PI * 0.48,
        Math.PI * 0.48
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      if (phaseRef.current === 'title') {
        if (code === 'Enter' || code === 'Space') {
          e.preventDefault();
          actionsRef.current?.startPlaying();
        }
        return;
      }

      if (code === 'KeyP' || (code === 'Escape' && !pointerLocked)) {
        e.preventDefault();
        if (phaseRef.current === 'playing') {
          if (document.pointerLockElement) document.exitPointerLock?.();
          sound.suspend();
          keysHeld.clear();
          callbacksRef.current.onPhaseChange('paused');
        } else if (phaseRef.current === 'paused') {
          actionsRef.current?.resumePlaying();
        }
        return;
      }

      if (phaseRef.current !== 'playing') return;

      if (!keysHeld.has(code)) {
        keysJustPressed.add(code);
      }
      keysHeld.add(code);

      if (code === 'KeyL') actionsRef.current?.toggleFlashlight();
      if (code === 'KeyT') actionsRef.current?.advanceTime();
      if (code === 'KeyY') actionsRef.current?.cycleWeather();
      if (code === 'KeyE') handleInteractE();
      if (code === 'KeyF') handleInteractF();
      if (code === 'KeyR') handleInteractR();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysHeld.delete(e.code);
    };

    const clearInputs = () => {
      keysHeld.clear();
      keysJustPressed.clear();
      mouseDragging = false;
    };

    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      const pr = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(pr);
      weatherSky.setPixelRatio(pr);
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearInputs);
    document.addEventListener('visibilitychange', clearInputs);
    window.addEventListener('resize', onResize);

    function updatePlayer(dt: number): void {
      if (keysHeld.has('ArrowLeft')) player.yaw += 1.7 * dt;
      if (keysHeld.has('ArrowRight')) player.yaw -= 1.7 * dt;
      if (keysHeld.has('ArrowUp')) {
        player.pitch = THREE.MathUtils.clamp(player.pitch + 1.2 * dt, -Math.PI * 0.48, Math.PI * 0.48);
      }
      if (keysHeld.has('ArrowDown')) {
        player.pitch = THREE.MathUtils.clamp(player.pitch - 1.2 * dt, -Math.PI * 0.48, Math.PI * 0.48);
      }

      const crouching = keysHeld.has('KeyC');
      const wantRun =
        (keysHeld.has('ShiftLeft') || keysHeld.has('ShiftRight')) &&
        !crouching &&
        player.stamina > 3;

      _fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      _move.set(0, 0, 0);

      if (keysHeld.has('KeyW')) _move.add(_fwd);
      if (keysHeld.has('KeyS')) _move.sub(_fwd);
      if (keysHeld.has('KeyD')) _move.add(_right);
      if (keysHeld.has('KeyA')) _move.sub(_right);

      const moving = _move.lengthSq() > 0.01;
      if (moving) _move.normalize();

      const groundY = getSurfaceHeightAt(player.pos.x, player.pos.z);
      const inSwampWater =
        groundY < SWAMP_WATER_Y + 0.04 && !isOnBoardwalk(player.pos.x, player.pos.z);

      let speed = crouching ? 2.5 : wantRun && moving ? 8.2 : 4.6;
      if (inSwampWater) speed *= 0.58;

      if (wantRun && moving) {
        player.stamina = Math.max(0, player.stamina - 24 * dt);
      } else {
        player.stamina = Math.min(100, player.stamina + 16 * dt);
      }
      if (hudRefs.staminaFillEl.current) {
        hudRefs.staminaFillEl.current.style.transform = `scaleX(${(player.stamina / 100).toFixed(3)})`;
      }

      player.pos.addScaledVector(_move, speed * dt);
      resolvePlayerCollisions(player.pos);

      // Jump impulse 6.4 m/s reaches ~1.24m peak, easily clearing 0.92m split-pole fences
      if (keysJustPressed.has('Space') && player.onGround && !crouching) {
        player.vel.y = 6.4;
        player.onGround = false;
      }
      keysJustPressed.clear();

      player.vel.y -= 16.5 * dt;
      player.pos.y += player.vel.y * dt;

      const newGroundY = getSurfaceHeightAt(player.pos.x, player.pos.z);
      const minFloorY = Math.max(newGroundY, SWAMP_WATER_Y - 0.38);
      if (player.pos.y <= minFloorY) {
        player.pos.y = minFloorY;
        player.vel.y = 0;
        player.onGround = true;
      } else {
        player.onGround = false;
      }

      const targetEye = crouching ? player.crouchEyeHeight : player.eyeHeight;
      player.currentEye = THREE.MathUtils.lerp(player.currentEye, targetEye, Math.min(1, dt * 10));

      let bobY = 0;
      if (moving && player.onGround) {
        const freq = wantRun ? 13 : 8.5;
        player.bobPhase += dt * freq;
        bobY = Math.sin(player.bobPhase) * (wantRun ? 0.065 : 0.038);
        player.stepTimer += dt * (wantRun ? 2.4 : 1.55);
        if (player.stepTimer >= 1) {
          player.stepTimer = 0;
          let surf: FootstepSurface = 'grass';
          if (isOnBoardwalk(player.pos.x, player.pos.z)) surf = 'wood';
          else if (inSwampWater) surf = 'water';
          else if (distToRoadDetail(player.pos.x, player.pos.z).dist < 3.3) surf = 'road';
          sound.playFootstep(surf);
        }
      }

      camera.position.set(player.pos.x, player.pos.y + player.currentEye + bobY, player.pos.z);
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
      camera.updateMatrixWorld();

      if (player.carrying) {
        _euler.set(player.pitch, player.yaw, 0, 'YXZ');
        _lookDir.set(0, 0, -1).applyEuler(_euler);
        _holdPos.copy(camera.position).addScaledVector(_lookDir, 1.15);
        _holdPos.y -= 0.22;
        player.carrying.mesh.position.lerp(_holdPos, Math.min(1, dt * 16));
      }
    }

    function updateDynamicObjects(dt: number): void {
      if (!propsCtx) return;
      for (let i = 0; i < propsCtx.dynamicObjects.length; i++) {
        const obj = propsCtx.dynamicObjects[i];
        if (obj === player.carrying || obj.resting) continue;

        obj.vel.y -= 15.0 * dt;
        obj.mesh.position.addScaledVector(obj.vel, dt);
        obj.mesh.rotation.x += obj.angVel.x * dt;
        obj.mesh.rotation.y += obj.angVel.y * dt;
        obj.mesh.rotation.z += obj.angVel.z * dt;

        const floorY =
          Math.max(
            getSurfaceHeightAt(obj.mesh.position.x, obj.mesh.position.z),
            SWAMP_WATER_Y - 0.15
          ) + obj.onGroundYOffset;
        if (obj.mesh.position.y <= floorY) {
          if (obj.vel.y < -2.2) sound.playImpact(Math.min(1.0, Math.abs(obj.vel.y) / 8));
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
      }
    }

    function updateInteractionHover(): void {
      if (!propsCtx || phaseRef.current !== 'playing' || player.carrying) {
        if (hoveredObj !== null) {
          hoveredObj = null;
          lastPromptKey = '';
          callbacksRef.current.onPromptChange(null);
        }
        return;
      }

      raycaster.setFromCamera(_rayCenter, camera);
      const hits = raycaster.intersectObjects(propsCtx.interactiveMeshes, true);
      const nextHover =
        hits.length > 0 ? (hits[0].object.userData.interactive as InteractiveEntry) : null;
      hoveredObj = nextHover && !nextHover.gathered ? nextHover : null;

      const nextPrompt = hoveredObj
        ? buildInteractionPrompt(
            {
              name: hoveredObj.name,
              desc: hoveredObj.desc,
              gatherable: hoveredObj.gatherable,
              carryable: hoveredObj.carryable,
              kickable: hoveredObj.kickable,
              hasUse: !!hoveredObj.onUse,
            },
            false
          )
        : null;

      const key = nextPrompt ? `${nextPrompt.title}|${nextPrompt.actionsText}` : '';
      if (key !== lastPromptKey) {
        lastPromptKey = key;
        callbacksRef.current.onPromptChange(nextPrompt);
      }
    }

    function afterDraw(cb: () => void): void {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          isTimeoutFrame = true;
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          isTimeoutFrame = true;
          frameId = window.setTimeout(cb, 80);
        }
      };
      isTimeoutFrame = true;
      frameId = window.setTimeout(poll, 5);
    }

    let lastTime = performance.now();
    let elapsed = 0;
    let fpsEma = 60;
    let hudTimer = 0;
    let titleOrbit = 0;

    function tick(): void {
      if (disposed) return;
      const now = performance.now();
      const rawDt = (now - lastTime) / 1000;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));
      lastTime = now;
      elapsed += dt;

      fpsEma = smoothFps(fpsEma, rawDt);
      hudTimer += rawDt;

      const curPhase = phaseRef.current;

      if (curPhase === 'title') {
        titleOrbit += dt * 0.08;
        const camX = spawnX + Math.sin(titleOrbit) * 18;
        const camZ = 14 + Math.cos(titleOrbit) * 7;
        const camY = getTerrainHeight(camX, camZ) + 6.5;
        camera.position.set(camX, camY, camZ);
        camera.lookAt(spawnX + 2, getTerrainHeight(spawnX + 2, -22) + 2.2, -22);
      } else if (curPhase === 'playing') {
        updatePlayer(dt);
        updateDynamicObjects(dt);
        updateInteractionHover();
      } else {
        camera.position.set(player.pos.x, player.pos.y + player.currentEye, player.pos.z);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
      }

      if (curPhase !== 'paused') {
        propsCtx?.updateDynamicProps(elapsed, camera.position.x, camera.position.z);
        const skyInfo = weatherSky.update(
          dt,
          player.pos,
          scene,
          sound,
          hudRefs.flashEl.current
        );

        if (terrainMgr && vegetation) {
          terrainMgr.update(camera, chunkStats);
          vegetation.update(
            terrainMgr.activeSlots,
            terrainMgr.chunkLods,
            terrainMgr.chunkSpheres,
            camera.position,
            elapsed,
            skyInfo.windStrength,
            vegStats
          );
        }

        if (hudTimer >= 0.25) {
          hudTimer = 0;
          if (hudRefs.fpsEl.current) {
            hudRefs.fpsEl.current.textContent = formatFpsLabel(fpsEma);
          }
          if (hudRefs.biomeEl.current) {
            hudRefs.biomeEl.current.textContent = getBiomeInfo(
              player.pos.x,
              player.pos.z
            ).label;
          }
          if (hudRefs.timeWeatherEl.current) {
            hudRefs.timeWeatherEl.current.textContent = `${skyInfo.timeLabel} · ${skyInfo.weatherLabel}`;
          }
          renderer.domElement.dataset.visibleChunks = String(chunkStats.visibleChunks);
          renderer.domElement.dataset.treesRendered = String(vegStats.treesRendered);
          renderer.domElement.dataset.foliageRendered = String(vegStats.foliageRendered);
          renderer.domElement.dataset.drawCalls = String(renderer.info.render.calls);
          renderer.domElement.dataset.triangles = String(renderer.info.render.triangles);
          renderer.domElement.dataset.weather = weatherSky.currentWeather;
          renderer.domElement.dataset.windStrength = skyInfo.windStrength.toFixed(2);
          renderer.domElement.dataset.hour = String(Math.floor(weatherSky.timeOfDay));
          renderer.domElement.dataset.playerX = player.pos.x.toFixed(2);
          renderer.domElement.dataset.playerY = player.pos.y.toFixed(2);
          renderer.domElement.dataset.playerZ = player.pos.z.toFixed(2);
        }
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        isTimeoutFrame = false;
        frameId = requestAnimationFrame(tick);
      }
    }

    void Promise.all([
      ComputeEngine.create(),
      createWorldTextures(renderer.capabilities.getMaxAnisotropy()),
    ]).then(([engine, loadedTextures]) => {
      if (disposed) {
        loadedTextures.dispose();
        return;
      }
      computeEngine = engine;
      textures = loadedTextures;

      vegetation = new WorldVegetationSystem(loadedTextures, isSoftwareGl);
      vegetation.prewarmAround(spawnX, spawnZ);
      scene.add(vegetation.group);

      propsCtx = buildArchitectureAndProps(
        scene,
        loadedTextures,
        sound,
        (msg) => callbacksRef.current.onToast(msg),
        isSoftwareGl
      );
      propCircleColliders = propsCtx.circleColliders;

      terrainMgr = new TerrainChunkManager(engine, loadedTextures.groundDetail);
      terrainMgr.prewarmAround(spawnX, spawnZ);
      scene.add(terrainMgr.group);

      renderer.domElement.dataset.wasmActive = String(engine.isWasmActive);

      if (!isSoftwareGl) {
        weatherSky.setShaderCompilePreview(true);
        renderer.compile(scene, camera);
        weatherSky.setShaderCompilePreview(false);
      }

      callbacksRef.current.onWorldReady({
        wasmActive: engine.isWasmActive,
        totalMushrooms: propsCtx.mushroomCountTotal,
      });

      lastTime = performance.now();
      tick();
    });

    return () => {
      disposed = true;
      if (isTimeoutFrame) window.clearTimeout(frameId);
      else cancelAnimationFrame(frameId);

      document.removeEventListener('pointerlockchange', onPointerLockChange);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearInputs);
      document.removeEventListener('visibilitychange', clearInputs);
      window.removeEventListener('resize', onResize);

      terrainMgr?.dispose();
      vegetation?.dispose();
      weatherSky.dispose();
      propsCtx?.dispose();
      textures?.dispose();
      envTarget.dispose();
      sound.dispose();
      renderer.dispose();
      void computeEngine;

      if (renderer.domElement.parentNode === mountEl) {
        mountEl.removeChild(renderer.domElement);
      }
    };
  }, [worldSeed, actionsRef, hudRefs]);

  return (
    <div
      ref={mountRef}
      data-testid="world-canvas"
      className="fixed inset-0 w-full h-full overflow-hidden"
    />
  );
};
