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
