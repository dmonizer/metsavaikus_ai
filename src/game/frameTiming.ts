export interface FrameTiming {
  deltaSec: number;
  stepCount: number;
  stepSec: number;
}

// Preserve normal foreground time down to 4 FPS. Longer stalls deliberately discard
// excess time rather than running an unbounded catch-up after a suspended tab.
export const MAX_FRAME_DELTA_SEC = 0.25;
export const MAX_PHYSICS_STEP_SEC = 1 / 60;

/** World systems consume deltaSec once; player/prop physics consume every stepSec. */
export function computeFrameTiming(rawDeltaSec: number): FrameTiming {
  const deltaSec = Number.isFinite(rawDeltaSec)
    ? Math.min(MAX_FRAME_DELTA_SEC, Math.max(0, rawDeltaSec)) : 0;
  const stepCount = Math.ceil(deltaSec / MAX_PHYSICS_STEP_SEC - 1e-9);
  return { deltaSec, stepCount, stepSec: stepCount > 0 ? deltaSec / stepCount : 0 };
}
