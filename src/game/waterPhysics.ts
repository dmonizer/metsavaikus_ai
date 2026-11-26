import { SWAMP_WATER_Y } from '../world/terrainMath';

export const SHALLOW_WATER_MIN_DEPTH = 0.02;
export const SWIM_ENTER_DEPTH = 1.24;
export const SWIM_EXIT_DEPTH = 1.14;
export const SWIM_EYE_ABOVE_WATER = 0.24;
export const SWIM_FLOAT_FLOOR_BELOW_WATER = 1.0;

export interface WaterPlayerInput {
  rawGroundY: number;
  surfaceY: number;
  onBoardwalk: boolean;
  swampFactor: number;
  crouching: boolean;
  wasSwimming: boolean;
  eyeHeight: number;
  crouchEyeHeight: number;
  /** False when player is outside the bog water basin (dry forest valleys below SWAMP_WATER_Y). */
  inWaterBasin?: boolean;
}

export interface WaterPlayerState {
  waterDepth: number;
  isInWater: boolean;
  isSwimming: boolean;
  isWadingWater: boolean;
  isSwampWading: boolean;
  canRefillBogWater: boolean;
  canUseBackpack: boolean;
  minFloorY: number;
  targetEyeHeight: number;
  eyeAboveWater: number;
  speedMultiplier: number;
}

/**
 * Computes progressive wading depth, smooth viewpoint lowering toward the water
 * surface, buoyant close-to-water swimming eye height, and swimming pack locks.
 */
export function evaluatePlayerWaterState(input: WaterPlayerInput): WaterPlayerState {
  const {
    rawGroundY,
    surfaceY,
    onBoardwalk,
    swampFactor,
    crouching,
    wasSwimming,
    eyeHeight,
    crouchEyeHeight,
    inWaterBasin = true,
  } = input;

  const waterDepth =
    onBoardwalk || !inWaterBasin ? 0 : Math.max(0, SWAMP_WATER_Y - rawGroundY);
  const swimThreshold = wasSwimming ? SWIM_EXIT_DEPTH : SWIM_ENTER_DEPTH;
  const isSwimming = !onBoardwalk && waterDepth >= swimThreshold;
  const isInWater = !onBoardwalk && waterDepth > SHALLOW_WATER_MIN_DEPTH;
  const isWadingWater = isInWater && !isSwimming;
  // Soft peat bog wading applies on wet bog ground even where open water is <= 2cm
  const isSwampWading = !onBoardwalk && !isSwimming && !isWadingWater && swampFactor > 0.35;

  const canRefillBogWater = !onBoardwalk && !isSwimming && waterDepth > 0.03;
  const canUseBackpack = !isSwimming;

  // Feet follow real underwater bed down to swimming depth; when swimming, float buoyantly
  // so the player's eyes sit close to the water surface (SWIM_EYE_ABOVE_WATER).
  const minFloorY = isSwimming
    ? Math.max(surfaceY, SWAMP_WATER_Y - SWIM_FLOAT_FLOOR_BELOW_WATER)
    : surfaceY;

  let targetEyeHeight: number;
  if (isSwimming) {
    // Camera Y = minFloorY + targetEyeHeight = SWAMP_WATER_Y + SWIM_EYE_ABOVE_WATER
    targetEyeHeight = SWAMP_WATER_Y + SWIM_EYE_ABOVE_WATER - minFloorY;
  } else {
    const baseEye = crouching ? crouchEyeHeight : eyeHeight;
    if (isWadingWater) {
      // As water rises from ankle to chest deep, player naturally lowers posture slightly
      // so the viewpoint drops smoothly toward the swimming eye height with zero pop.
      const depthFrac = Math.min(1, Math.max(0, waterDepth / SWIM_ENTER_DEPTH));
      const wadingEye = baseEye - depthFrac * depthFrac * 0.2;
      // Never let crouching submerge the camera below swimming eye height while wading
      const minSafeEye = SWAMP_WATER_Y + SWIM_EYE_ABOVE_WATER - minFloorY;
      targetEyeHeight = Math.max(minSafeEye, wadingEye);
    } else {
      targetEyeHeight = baseEye;
    }
  }

  const eyeAboveWater = minFloorY + targetEyeHeight - SWAMP_WATER_Y;

  let speedMultiplier = 1.0;
  if (isSwimming) {
    speedMultiplier = 0.52;
  } else if (isWadingWater) {
    const depthFrac = Math.min(1, waterDepth / SWIM_ENTER_DEPTH);
    speedMultiplier = 0.86 - depthFrac * 0.34; // 0.86x ankle-deep -> 0.52x chest-deep
  } else if (isSwampWading) {
    speedMultiplier = 0.68;
  }

  return {
    waterDepth,
    isInWater,
    isSwimming,
    isWadingWater,
    isSwampWading,
    canRefillBogWater,
    canUseBackpack,
    minFloorY,
    targetEyeHeight,
    eyeAboveWater,
    speedMultiplier,
  };
}

export interface BogWaterFocusInput {
  /** Player world feet X/Z position. */
  playerX: number;
  playerZ: number;
  /** Whether the player is standing on ground/bed (not jumping/falling in mid-air). */
  onGround: boolean;
  /** Whether the player is standing on an elevated boardwalk plank. */
  onBoardwalk: boolean;
  /** Whether the player is currently swimming. */
  isSwimming: boolean;
  /** Current water depth at player's feet (SWAMP_WATER_Y - rawGroundY, clamped >= 0). */
  waterDepth: number;
  /** Raw terrain height directly under player's feet. */
  rawGroundY: number;
  /** Camera world position (crosshair ray origin). */
  camX: number;
  camY: number;
  camZ: number;
  /** Normalized camera forward direction (crosshair ray direction). */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** Bog water disc center & radius. */
  bogCenterX: number;
  bogCenterZ: number;
  waterRadius: number;
  /** Raw terrain height sampler at world (x, z). */
  getTerrainHeightAt: (x: number, z: number) => number;
  /** Walkable surface height sampler (terrain + shelters + boardwalks) at world (x, z). */
  getSurfaceHeightAt: (x: number, z: number) => number;
  /** Optional solid-obstacle segment occlusion test from camera to the water hit point. */
  isSegmentBlocked?: (hitX: number, hitY: number, hitZ: number) => boolean;
  /** Maximum 3D ray distance from camera to the aimed water point (default 9.0m). */
  maxAimDistance?: number;
}

const SHORE_EDGE_RADII = [0.85, 1.55, 2.25];
const SHORE_EDGE_ANGLES = 12;
const WATER_VISIBLE_MIN_DEPTH = 0.03;

function hasVisibleBogWaterAt(
  x: number,
  z: number,
  bogCenterX: number,
  bogCenterZ: number,
  visibleWaterRadiusSq: number,
  getTerrainHeightAt: (x: number, z: number) => number,
  getSurfaceHeightAt: (x: number, z: number) => number
): boolean {
  const dx = x - bogCenterX;
  const dz = z - bogCenterZ;
  if (dx * dx + dz * dz > visibleWaterRadiusSq) return false;
  if (getTerrainHeightAt(x, z) > SWAMP_WATER_Y - WATER_VISIBLE_MIN_DEPTH) return false;
  if (getSurfaceHeightAt(x, z) > SWAMP_WATER_Y - 0.01) return false;
  return true;
}

/**
 * Returns true ONLY when:
 * 1. The player is standing on a shore right next to bog lake water OR standing in
 *    shallow (non-swimming) bog water — never while swimming, airborne, on a boardwalk,
 *    or standing inland on dry bog shore away from the water's edge.
 * 2. The crosshair focus ray from the camera actually lands unobstructed on visible
 *    bog lake water — never when aimed at the sky above the lake, the shore bank,
 *    a boardwalk, or through terrain/walls.
 */
export function evaluateBogWaterFocusTarget(input: BogWaterFocusInput): boolean {
  const {
    playerX,
    playerZ,
    onGround,
    onBoardwalk,
    isSwimming,
    waterDepth,
    rawGroundY,
    camX,
    camY,
    camZ,
    dirX,
    dirY,
    dirZ,
    bogCenterX,
    bogCenterZ,
    waterRadius,
    getTerrainHeightAt,
    getSurfaceHeightAt,
    isSegmentBlocked,
    maxAimDistance = 9.0,
  } = input;

  // 1. Stance & position guard: must be standing on shore next to water or in shallow water (not swimming)
  if (!onGround || onBoardwalk || isSwimming) return false;

  const visibleWaterRadius = Math.max(1, waterRadius - 1.5);
  const visibleWaterRadiusSq = visibleWaterRadius * visibleWaterRadius;
  const pDx = playerX - bogCenterX;
  const pDz = playerZ - bogCenterZ;
  if (pDx * pDx + pDz * pDz > waterRadius * waterRadius) return false;

  const standingInShallowWater = waterDepth > WATER_VISIBLE_MIN_DEPTH;
  if (!standingInShallowWater) {
    if (rawGroundY > SWAMP_WATER_Y + 0.95) return false;
    let nextToWater = false;
    for (let rIdx = 0; rIdx < SHORE_EDGE_RADII.length && !nextToWater; rIdx++) {
      const r = SHORE_EDGE_RADII[rIdx];
      for (let i = 0; i < SHORE_EDGE_ANGLES; i++) {
        const ang = (i / SHORE_EDGE_ANGLES) * Math.PI * 2;
        if (
          hasVisibleBogWaterAt(
            playerX + Math.cos(ang) * r,
            playerZ + Math.sin(ang) * r,
            bogCenterX,
            bogCenterZ,
            visibleWaterRadiusSq,
            getTerrainHeightAt,
            getSurfaceHeightAt
          )
        ) {
          nextToWater = true;
          break;
        }
      }
    }
    if (!nextToWater) return false;
  }

  // 2. Crosshair dot raycast onto the horizontal bog water plane (y = SWAMP_WATER_Y)
  if (camY <= SWAMP_WATER_Y + 0.01) return false;
  // Looking horizontally or upward at the sky/trees above the lake cannot hit the water surface
  if (dirY >= -0.02) return false;

  const tWater = (SWAMP_WATER_Y - camY) / dirY;
  if (tWater <= 0.08 || tWater > maxAimDistance) return false;

  const hitX = camX + dirX * tWater;
  const hitZ = camZ + dirZ * tWater;

  // The water-plane hit point itself must be visible open water (not underground beneath shore/boardwalk)
  if (
    !hasVisibleBogWaterAt(
      hitX,
      hitZ,
      bogCenterX,
      bogCenterZ,
      visibleWaterRadiusSq,
      getTerrainHeightAt,
      getSurfaceHeightAt
    )
  ) {
    return false;
  }

  // When standing on shore (not wading), ensure the aimed water actually starts near the player
  // along the aim direction rather than aiming across a wide stretch of dry bog shore to a separate pool.
  if (!standingInShallowWater) {
    const horizDist = Math.hypot(hitX - playerX, hitZ - playerZ);
    if (horizDist > 3.5) {
      const invH = 1 / horizDist;
      const hx = (hitX - playerX) * invH;
      const hz = (hitZ - playerZ) * invH;
      let reachesWaterNearby = false;
      for (let d = 0.6; d <= 3.5; d += 0.45) {
        if (
          hasVisibleBogWaterAt(
            playerX + hx * d,
            playerZ + hz * d,
            bogCenterX,
            bogCenterZ,
            visibleWaterRadiusSq,
            getTerrainHeightAt,
            getSurfaceHeightAt
          )
        ) {
          reachesWaterNearby = true;
          break;
        }
      }
      if (!reachesWaterNearby) return false;
    }
  }

  // 3. March along the camera ray to verify no shore bank, hummock, island, or boardwalk
  //    occludes the crosshair before reaching the water plane.
  let t = 0.14;
  const tEnd = tWater - 0.03;
  while (t < tEnd) {
    const px = camX + dirX * t;
    const py = camY + dirY * t;
    const pz = camZ + dirZ * t;
    if (getSurfaceHeightAt(px, pz) >= py - 0.015) {
      return false;
    }
    t += t < 4.5 ? 0.14 : 0.28;
  }

  // 4. Optional solid prop/wall occlusion check
  if (isSegmentBlocked && isSegmentBlocked(hitX, SWAMP_WATER_Y, hitZ)) {
    return false;
  }

  return true;
}

