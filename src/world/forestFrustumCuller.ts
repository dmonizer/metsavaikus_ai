import * as THREE from 'three';

export enum FrustumCullStatus {
  OUTSIDE = 0,
  INTERSECTING = 1,
  INSIDE = 2,
}

const _projScreenMatrix = new THREE.Matrix4();
const _frustum = new THREE.Frustum();

/**
 * Extracts all 6 world-space frustum planes from `camera` into a pre-allocated
 * Float32Array(24) formatted as [nx, ny, nz, constant] per plane. Zero allocations.
 */
export function extractFrustumPlanes(
  camera: THREE.PerspectiveCamera,
  outPlanes: Float32Array
): Float32Array {
  camera.updateMatrixWorld();
  _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);
  for (let p = 0; p < 6; p++) {
    const pl = _frustum.planes[p];
    const pb = p * 4;
    outPlanes[pb] = pl.normal.x;
    outPlanes[pb + 1] = pl.normal.y;
    outPlanes[pb + 2] = pl.normal.z;
    outPlanes[pb + 3] = pl.constant;
  }
  return outPlanes;
}

/**
 * Fast unrolled 6-plane sphere intersection test.
 * Returns true if the sphere (cx, cy, cz, r) is at least partially inside the frustum.
 */
export function sphereIntersectsFrustum(
  planes: Float32Array,
  cx: number,
  cy: number,
  cz: number,
  r: number
): boolean {
  const negR = -r;
  if (planes[0] * cx + planes[1] * cy + planes[2] * cz + planes[3] < negR) return false;
  if (planes[4] * cx + planes[5] * cy + planes[6] * cz + planes[7] < negR) return false;
  if (planes[8] * cx + planes[9] * cy + planes[10] * cz + planes[11] < negR) return false;
  if (planes[12] * cx + planes[13] * cy + planes[14] * cz + planes[15] < negR) return false;
  if (planes[16] * cx + planes[17] * cy + planes[18] * cz + planes[19] < negR) return false;
  if (planes[20] * cx + planes[21] * cy + planes[22] * cz + planes[23] < negR) return false;
  return true;
}

/**
 * Exact 3-state sphere vs. 6-plane frustum classifier:
 * - OUTSIDE (0): completely outside at least one plane -> skip entire sub-cell
 * - INSIDE (2): completely inside all 6 planes -> fast-path bulk copy without per-instance tests
 * - INTERSECTING (1): straddles a plane -> run per-instance sphere culling
 */
export function classifySphereFrustum(
  planes: Float32Array,
  cx: number,
  cy: number,
  cz: number,
  r: number
): FrustumCullStatus {
  const negR = -r;
  let allInside = true;

  const d0 = planes[0] * cx + planes[1] * cy + planes[2] * cz + planes[3];
  if (d0 < negR) return FrustumCullStatus.OUTSIDE;
  if (d0 < r) allInside = false;

  const d1 = planes[4] * cx + planes[5] * cy + planes[6] * cz + planes[7];
  if (d1 < negR) return FrustumCullStatus.OUTSIDE;
  if (d1 < r) allInside = false;

  const d2 = planes[8] * cx + planes[9] * cy + planes[10] * cz + planes[11];
  if (d2 < negR) return FrustumCullStatus.OUTSIDE;
  if (d2 < r) allInside = false;

  const d3 = planes[12] * cx + planes[13] * cy + planes[14] * cz + planes[15];
  if (d3 < negR) return FrustumCullStatus.OUTSIDE;
  if (d3 < r) allInside = false;

  const d4 = planes[16] * cx + planes[17] * cy + planes[18] * cz + planes[19];
  if (d4 < negR) return FrustumCullStatus.OUTSIDE;
  if (d4 < r) allInside = false;

  const d5 = planes[20] * cx + planes[21] * cy + planes[22] * cz + planes[23];
  if (d5 < negR) return FrustumCullStatus.OUTSIDE;
  if (d5 < r) allInside = false;

  return allInside ? FrustumCullStatus.INSIDE : FrustumCullStatus.INTERSECTING;
}

/**
 * Computes the exponential FogExp2 visibility cutoff distance where fog opacity
 * exceeds ~98.7% (exp(-(d * density)^2) < 0.013 -> d * density >= 2.08).
 * Tightens draw distance automatically in mist, rain, and storm with zero visual pop-in.
 */
export function computeFogCullDistance(
  fogDensity: number,
  minDist = 96,
  maxDist = 225
): number {
  const safeDensity = Math.max(0.0035, fogDensity);
  const fogHorizon = 2.08 / safeDensity;
  if (fogHorizon < minDist) return minDist;
  if (fogHorizon > maxDist) return maxDist;
  return fogHorizon;
}

/**
 * Configures partial GPU buffer upload on an InstancedMesh so Three.js only runs
 * gl.bufferSubData for the compacted active instances [0..count) rather than the
 * full allocated capacity array. Also hides empty meshes (0 draw calls).
 */
export function commitCompactedInstancedMesh(
  mesh: THREE.InstancedMesh,
  sharedBuffers = false
): void {
  const count = mesh.count;
  mesh.visible = count > 0;
  if (count <= 0 || sharedBuffers) return;

  const matAttr = mesh.instanceMatrix;
  matAttr.clearUpdateRanges();
  matAttr.addUpdateRange(0, count * 16);
  matAttr.needsUpdate = true;

  const colAttr = mesh.instanceColor;
  if (colAttr) {
    colAttr.clearUpdateRanges();
    colAttr.addUpdateRange(0, count * 3);
    colAttr.needsUpdate = true;
  }
}
