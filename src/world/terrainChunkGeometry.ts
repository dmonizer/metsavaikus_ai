import {
  CHUNK_SIZE, clamp, distToRoadDetail, getActiveBlueprint, getDistanceToNearestVillage,
  getNearestSwampIsland, getSwampFactor,
} from './terrainMath';
import type { ComputeEngine } from './wasmCompute';

export const LOD_SEGS = [24, 12, 6] as const;
export const SHORE_LOD0_SEGS = 48;
export type TerrainLod = 0 | 1 | 2;

export interface TerrainChunkRequest {
  vcx: number;
  vcz: number;
  lod: TerrainLod;
}

export function buildTerrainChunk(compute: ComputeEngine, { vcx, vcz, lod }: TerrainChunkRequest) {
  const start = performance.now();
  const minX = vcx * CHUNK_SIZE;
  const minZ = vcz * CHUNK_SIZE;
  const bp = getActiveBlueprint();
  const maxX = minX + CHUNK_SIZE;
  const maxZ = minZ + CHUNK_SIZE;
  let isShoreDetailLod0 = false;
  if (lod === 0) {
    for (let i = 0; i < bp.bogPools.length && !isShoreDetailLod0; i++) {
      const p = bp.bogPools[i];
      if (maxX >= p.minX - 6 && minX <= p.maxX + 6 && maxZ >= p.minZ - 6 && minZ <= p.maxZ + 6) {
        isShoreDetailLod0 = true;
      }
    }
    for (let i = 0; i < bp.lakes.length && !isShoreDetailLod0; i++) {
      const lk = bp.lakes[i];
      if (maxX >= lk.minX && minX <= lk.maxX && maxZ >= lk.minZ && minZ <= lk.maxZ) {
        isShoreDetailLod0 = true;
      }
    }
    for (let i = 0; i < bp.streams.length && !isShoreDetailLod0; i++) {
      const st = bp.streams[i];
      if (maxX >= st.minX && minX <= st.maxX && maxZ >= st.minZ && minZ <= st.maxZ) {
        isShoreDetailLod0 = true;
      }
    }
  }
  const segs = isShoreDetailLod0 ? SHORE_LOD0_SEGS : LOD_SEGS[lod];
  const vertCount = (segs + 1) * (segs + 1);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);

  compute.fillTerrainChunk(minX, minZ, CHUNK_SIZE, segs, positions, normals, colors);

  const uvs = new Float32Array(vertCount * 2);
  const splats = new Float32Array(vertCount * 4);
  const dim = segs + 1;
  for (let iz = 0; iz < dim; iz++) {
    const wz = minZ + (iz / segs) * CHUNK_SIZE;
    for (let ix = 0; ix < dim; ix++) {
      const wx = minX + (ix / segs) * CHUNK_SIZE;
      const vIdx = iz * dim + ix;
      uvs[vIdx * 2] = wx * 0.24;
      uvs[vIdx * 2 + 1] = wz * 0.24;

      // Compute 4-biome splat weights: [road, meadow, forest, bog]
      const roadInfo = distToRoadDetail(wx, wz);
      const roadW = clamp(1 - (roadInfo.dist - 1.35) / 2.25, 0, 1);

      const isl = getNearestSwampIsland(wx, wz);
      const rawSwamp = getSwampFactor(wx, wz);
      const bogW = isl.islandMask > 0.45 ? 0 : clamp((rawSwamp - 0.14) / 0.52, 0, 1);

      const nearV = getDistanceToNearestVillage(wx, wz);
      const clearR = nearV.clearingRadius || 18;
      const villageClearing =
        nearV.village !== null
          ? clamp(1 - (nearV.dist - clearR * 0.55) / (clearR * 0.65), 0, 1)
          : 0;
      const meadowW = clamp(Math.max(villageClearing, (1 - bogW) * 0.18), 0, 1);
      const forestW = clamp(1 - Math.max(villageClearing * 0.85, bogW), 0, 1);

      splats[vIdx * 4] = roadW;
      splats[vIdx * 4 + 1] = meadowW;
      splats[vIdx * 4 + 2] = forestW;
      splats[vIdx * 4 + 3] = bogW;
    }
  }

  // Stitch odd perimeter vertices on 48-segment shoreline chunks to even neighbor midpoints (zero T-junction cracks!)
  if (isShoreDetailLod0) {
    const stitchMid = (dst: number, a: number, b: number) => {
      positions[dst * 3 + 1] = 0.5 * (positions[a * 3 + 1] + positions[b * 3 + 1]);
      normals[dst * 3] = 0.5 * (normals[a * 3] + normals[b * 3]);
      normals[dst * 3 + 1] = 0.5 * (normals[a * 3 + 1] + normals[b * 3 + 1]);
      normals[dst * 3 + 2] = 0.5 * (normals[a * 3 + 2] + normals[b * 3 + 2]);
      colors[dst * 3] = 0.5 * (colors[a * 3] + colors[b * 3]);
      colors[dst * 3 + 1] = 0.5 * (colors[a * 3 + 1] + colors[b * 3 + 1]);
      colors[dst * 3 + 2] = 0.5 * (colors[a * 3 + 2] + colors[b * 3 + 2]);
    };
    for (let ix = 1; ix < segs; ix += 2) {
      stitchMid(ix, ix - 1, ix + 1);
      const bot = segs * dim + ix;
      stitchMid(bot, bot - 1, bot + 1);
    }
    for (let iz = 1; iz < segs; iz += 2) {
      const left = iz * dim;
      stitchMid(left, left - dim, left + dim);
      const right = iz * dim + segs;
      stitchMid(right, right - dim, right + dim);
    }
  }

  return { positions, normals, colors, uvs, splats, segs, buildMs: performance.now() - start };
}

export type TerrainChunkData = ReturnType<typeof buildTerrainChunk>;
