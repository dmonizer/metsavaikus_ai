import type { SurfaceMaterial } from '../soundscape/types';

export interface SurfaceSample {
  onBoardwalk: boolean;
  inWater: boolean;
  structure: { id: string | null; quality: string; floorMaterial: SurfaceMaterial } | null;
  swampWading: boolean;
  road: { dist: number; isTrail: boolean };
  biomeId: string;
}

/** Authoritative precedence for landing events and continuous movement audio.
 * Callers may supply getters for terrain queries; lower-priority samples are read only if needed.
 */
export function resolveSurfaceMaterial(sample: SurfaceSample): SurfaceMaterial {
  if (sample.onBoardwalk) return 'wooden_boardwalk';
  if (sample.inWater) return 'water';
  const structure = sample.structure;
  if (structure?.id && structure.quality !== 'outdoor' && structure.quality !== 'tent') {
    return structure.floorMaterial;
  }
  if (sample.swampWading) return 'mud';
  const road = sample.road;
  if (road.dist < 3.3 && !road.isTrail) return 'gravel';
  if (sample.biomeId === 'village') return 'grass';
  return 'forest_floor';
}
