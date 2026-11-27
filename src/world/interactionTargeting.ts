import * as THREE from 'three';
import type { InteractiveEntry } from './architectureAndProps';
import type { BoxCollider } from './spatialPhysics';
import { isSegmentObstructed } from './spatialPhysics';

/**
 * Selects the nearest non-gathered visible interactive entry hit along a ray
 * that is NOT blocked by a nearer active solid wall, closed door, or roof collider.
 */
export function selectUnobstructedInteractiveHit(
  rayOrigin: THREE.Vector3,
  hits: readonly THREE.Intersection[],
  boxes: readonly BoxCollider[]
): InteractiveEntry | null {
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (!hit.object.visible) continue;
    const candidate = hit.object.userData.interactive as InteractiveEntry | undefined;
    if (!candidate || candidate.gathered) continue;
    if (isSegmentObstructed(rayOrigin, hit.point, boxes, candidate.ownCollider)) {
      return null;
    }
    return candidate;
  }
  return null;
}

/**
 * Verifies whether a previously selected interactive entry is still reachable along
 * the current view ray without passing through an active solid obstruction.
 */
export function isInteractiveTargetVisible(
  raycaster: THREE.Raycaster,
  rayOrigin: THREE.Vector3,
  entry: InteractiveEntry | null,
  boxes: readonly BoxCollider[]
): boolean {
  if (!entry || entry.gathered || !entry.mesh.visible) return false;
  const hits = raycaster.intersectObject(entry.mesh, true);
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (!hit.object.visible) continue;
    if (!isSegmentObstructed(rayOrigin, hit.point, boxes, entry.ownCollider)) {
      return true;
    }
    return false;
  }
  return false;
}
