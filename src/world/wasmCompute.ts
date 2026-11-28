import { terrainWasmBase64 } from './generated/terrainWasm';
import {
  distToRoadDetail,
  evaluateTerrainFromNoise,
  fbm,
  getDistanceToNearestVillage,
  getLakeSampleAt,
  getStreamSampleAt,
  getSwampFactor,
  getTerrainHeight,
  clamp,
  lerp,
  smoothNoise,
  SWAMP_WATER_Y,
} from './terrainMath';

export interface WasmExports {
  memory: WebAssembly.Memory;
  scratchBase: () => number;
  hash2i: (ix: number, iz: number) => number;
  smoothNoise: (x: number, z: number) => number;
  cullChunks: (
    chunkDataPtr: number,
    chunkCount: number,
    planesPtr: number,
    camX: number,
    camY: number,
    camZ: number,
    maxDistSq: number,
    lod0DistSq: number,
    lod1DistSq: number,
    outLodPtr: number
  ) => number;
  fillNoiseGrid: (
    outPtr: number,
    startX: number,
    startZ: number,
    step: number,
    dim: number
  ) => void;
}

const PTR_CHUNK_SPHERES = 0; // Supports up to 256 chunks (121 streamed slots)
const PTR_PLANES = 4096;
const PTR_OUT_LODS = 8192;
const PTR_NOISE_GRID = 16384;

export class ComputeEngine {
  readonly isWasmActive: boolean;
  private exports: WasmExports | null;

  private readonly scratch: number;

  private constructor(exports: WasmExports | null) {
    this.exports = exports;
    this.scratch = exports?.scratchBase() ?? 0;
    this.isWasmActive = exports !== null;
  }

  static async create(useWasm = true): Promise<ComputeEngine> {
    if (!useWasm) return new ComputeEngine(null);
    try {
      const bytes = Uint8Array.from(atob(terrainWasmBase64), c => c.charCodeAt(0));
      const { instance } = await WebAssembly.instantiate(bytes);
      const exports = instance.exports as unknown as WasmExports;
      return new ComputeEngine(exports);
    } catch {
      return new ComputeEngine(null);
    }
  }

  cullChunks(
    chunkSpheres: Float32Array,
    chunkCount: number,
    frustumPlanes: Float32Array,
    camX: number,
    camY: number,
    camZ: number,
    maxDistSq: number,
    lod0DistSq: number,
    lod1DistSq: number,
    outLods: Int32Array
  ): number {
    if (this.exports && chunkCount <= 256 && chunkSpheres.length <= 256 * 4) {
      const mem = this.exports.memory.buffer;
      new Float32Array(mem, this.scratch + PTR_CHUNK_SPHERES, chunkSpheres.length).set(chunkSpheres);
      new Float32Array(mem, this.scratch + PTR_PLANES, 24).set(frustumPlanes);
      const vis = this.exports.cullChunks(
        this.scratch + PTR_CHUNK_SPHERES,
        chunkCount,
        this.scratch + PTR_PLANES,
        camX,
        camY,
        camZ,
        maxDistSq,
        lod0DistSq,
        lod1DistSq,
        this.scratch + PTR_OUT_LODS
      );
      outLods.set(new Int32Array(mem, this.scratch + PTR_OUT_LODS, chunkCount));
      return vis;
    }

    let vis = 0;
    for (let i = 0; i < chunkCount; i++) {
      const base = i * 4;
      const cx = chunkSpheres[base];
      const cy = chunkSpheres[base + 1];
      const cz = chunkSpheres[base + 2];
      const r = chunkSpheres[base + 3];
      const dx = cx - camX;
      const dy = cy - camY;
      const dz = cz - camZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxDistSq) {
        outLods[i] = -1;
        continue;
      }
      let culled = false;
      for (let p = 0; p < 6; p++) {
        const pb = p * 4;
        const dot =
          frustumPlanes[pb] * cx +
          frustumPlanes[pb + 1] * cy +
          frustumPlanes[pb + 2] * cz +
          frustumPlanes[pb + 3];
        if (dot < -r) {
          culled = true;
          break;
        }
      }
      if (culled) {
        outLods[i] = -1;
      } else {
        vis++;
        outLods[i] = d2 < lod0DistSq ? 0 : d2 < lod1DistSq ? 1 : 2;
      }
    }
    return vis;
  }

  /**
   * Generates vertex positions, seamless central-difference normals, and biome vertex colors
   * for any streamed terrain chunk using the WASM fBm/smoothNoise batch kernel + active blueprint.
   */
  fillTerrainChunk(
    minX: number,
    minZ: number,
    chunkSize: number,
    segs: number,
    positions: Float32Array,
    normals: Float32Array,
    colors: Float32Array
  ): void {
    const dim = segs + 1;
    const step = chunkSize / segs;

    let noiseView: Float32Array | null = null;
    if (this.exports) {
      if (dim * dim * 3 * Float32Array.BYTES_PER_ELEMENT > 1024 * 1024 - PTR_NOISE_GRID) {
        throw new RangeError('Terrain grid exceeds the compute workspace');
      }
      this.exports.fillNoiseGrid(this.scratch + PTR_NOISE_GRID, minX, minZ, step, dim);
      noiseView = new Float32Array(this.exports.memory.buffer, this.scratch + PTR_NOISE_GRID, dim * dim * 3);
    }

    const eps = 0.45;
    const invTwoEps = 1 / (2 * eps);

    for (let iz = 0; iz < dim; iz++) {
      const z = minZ + iz * step;
      for (let ix = 0; ix < dim; ix++) {
        const x = minX + ix * step;
        const idx = iz * dim + ix;
        const pBase = idx * 3;

        let nBase4: number;
        let nDetail2: number;
        let nBog: number;
        if (noiseView) {
          const nb = idx * 3;
          nBase4 = noiseView[nb];
          nDetail2 = noiseView[nb + 1];
          nBog = noiseView[nb + 2];
        } else {
          nBase4 = fbm(x * 0.008, z * 0.008, 4);
          nDetail2 = fbm(x * 0.03, z * 0.03, 2);
          nBog = smoothNoise(x * 0.09, z * 0.09);
        }

        const evalRes = evaluateTerrainFromNoise(x, z, nBase4, nDetail2, nBog);
        const y = evalRes.y;
        const swamp = evalRes.swamp;
        const islandMask = evalRes.islandMask;

        positions[pBase] = x;
        positions[pBase + 1] = y;
        positions[pBase + 2] = z;

        const hx1 = getTerrainHeight(x - eps, z);
        const hx2 = getTerrainHeight(x + eps, z);
        const hz1 = getTerrainHeight(x, z - eps);
        const hz2 = getTerrainHeight(x, z + eps);
        const nx = (hx1 - hx2) * invTwoEps;
        const ny = 1.0;
        const nz = (hz1 - hz2) * invTwoEps;
        const invLen = 1 / Math.hypot(nx, ny, nz);
        normals[pBase] = nx * invLen;
        normals[pBase + 1] = ny * invLen;
        normals[pBase + 2] = nz * invLen;

        // Biome vertex coloring (linear RGB for Three.js vertexColors)
        const nCol = smoothNoise(x * 0.08, z * 0.08);
        let r = 0.055;
        let g = 0.118;
        let b = 0.032;

        const roadInfo = distToRoadDetail(x, z);
        if (roadInfo.isTrail && roadInfo.dist < 2.2) {
          const mix = clamp((roadInfo.dist - 1.05) / 1.15, 0, 1);
          const trR = lerp(0.19, 0.13, nCol);
          const trG = lerp(0.098, 0.068, nCol);
          const trB = lerp(0.052, 0.036, nCol);
          r = lerp(trR, 0.055, mix);
          g = lerp(trG, 0.115, mix);
          b = lerp(trB, 0.032, mix);
        } else if (roadInfo.dist < 3.4) {
          const mix = clamp((roadInfo.dist - 2.0) / 1.4, 0, 1);
          const grR = lerp(0.165, 0.115, nCol);
          const grG = lerp(0.15, 0.105, nCol);
          const grB = lerp(0.12, 0.08, nCol);
          r = lerp(grR, 0.055, mix);
          g = lerp(grG, 0.118, mix);
          b = lerp(grB, 0.032, mix);
        } else if (islandMask > 0.35 && y > SWAMP_WATER_Y + 0.16 && normals[pBase + 1] > 0.86) {
          // Dry mossy swamp island knoll: emerald moss, heather, sandy peat rims
          r = lerp(0.064, 0.105, nCol);
          g = lerp(0.112, 0.158, nCol);
          b = lerp(0.032, 0.042, nCol);
        } else if (swamp > 0.22 && (y < SWAMP_WATER_Y + 0.14 || (y < SWAMP_WATER_Y + 0.46 && normals[pBase + 1] < 0.88))) {
          // Steep cut-peat bog bank face & dark submerged peat ledge
          const bankSlope = clamp((0.92 - normals[pBase + 1]) / 0.24, 0, 1);
          const peatMix = y < SWAMP_WATER_Y + 0.14 ? 0.94 : Math.max(0.55, bankSlope * 0.92);
          const rimR = lerp(0.072, 0.145, nCol);
          const rimG = lerp(0.084, 0.098, nCol);
          const rimB = lerp(0.030, 0.032, nCol);
          r = lerp(rimR, 0.026, peatMix);
          g = lerp(rimG, 0.016, peatMix);
          b = lerp(rimB, 0.009, peatMix);
        } else if (swamp > 0.35) {
          const bogG_R = lerp(0.075, 0.165, nCol);
          const bogG_G = lerp(0.092, 0.108, nCol);
          const bogG_B = lerp(0.032, 0.034, nCol);
          const peatMix = y < SWAMP_WATER_Y + 0.16 ? 0.88 : 0.14;
          r = lerp(bogG_R, 0.028, peatMix);
          g = lerp(bogG_G, 0.018, peatMix);
          b = lerp(bogG_B, 0.010, peatMix);
        } else {
          // Lush mossy/grassy forest floor everywhere
          r = lerp(0.052, 0.092, nCol);
          g = lerp(0.115, 0.162, nCol);
          b = lerp(0.028, 0.04, nCol);
          const needleFactor = clamp(smoothNoise(x * 0.045 + 17, z * 0.045 - 9), 0, 1);
          if (needleFactor > 0.56) {
            const nf = (needleFactor - 0.56) * 1.25;
            r = lerp(r, 0.068, nf);
            g = lerp(g, 0.076, nf);
            b = lerp(b, 0.032, nf);
          }
          const nearV = getDistanceToNearestVillage(x, z);
          if (nearV.village?.abandoned && nearV.dist < 30) {
            r = lerp(r, 0.058, 0.32);
            g = lerp(g, 0.068, 0.32);
            b = lerp(b, 0.028, 0.32);
          }

          // Sandy/pebble shore & dark bed for non-bog freshwater lakes
          const lakeAt = getLakeSampleAt(x, z);
          if (lakeAt && lakeAt.normDist < 1.14) {
            const wetMix = clamp((1.14 - lakeAt.normDist) / 0.2, 0, 1);
            const depth = Math.max(0, lakeAt.lake.waterY - y);
            const deepMix = clamp(depth / 1.8, 0, 1);
            const sandR = lerp(0.145, 0.032, deepMix);
            const sandG = lerp(0.132, 0.048, deepMix);
            const sandB = lerp(0.088, 0.038, deepMix);
            r = lerp(r, sandR, wetMix * 0.85);
            g = lerp(g, sandG, wetMix * 0.85);
            b = lerp(b, sandB, wetMix * 0.85);
          }

          // Damp mossy-loam edge & dark wet silt bed for narrow downhill forest streams
          const streamAt = getStreamSampleAt(x, z);
          if (streamAt && streamAt.dist < streamAt.halfWidth + 1.25) {
            const stMix = clamp((streamAt.halfWidth + 1.25 - streamAt.dist) / 1.25, 0, 1);
            const innerMix = clamp((streamAt.halfWidth + 0.25 - streamAt.dist) / 0.5, 0, 1);
            const bankR = lerp(0.044, 0.058, nCol);
            const bankG = lerp(0.088, 0.064, innerMix);
            const bankB = lerp(0.028, 0.036, innerMix);
            r = lerp(r, bankR, stMix * 0.72);
            g = lerp(g, bankG, stMix * 0.72);
            b = lerp(b, bankB, stMix * 0.72);
          }
        }

        colors[pBase] = r;
        colors[pBase + 1] = g;
        colors[pBase + 2] = b;
      }
    }
  }

  getRawExports(): WasmExports | null {
    return this.exports;
  }
}

export function computeSwampFactor(x: number, z: number): number {
  return getSwampFactor(x, z);
}
