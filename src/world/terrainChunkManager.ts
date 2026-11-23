import * as THREE from 'three';
import {
  ACTIVE_GRID,
  CHUNK_COUNT,
  CHUNK_SIZE,
  getTerrainHeight,
  SWAMP_WATER_Y,
  WORLD_HALF,
  worldToVirtualChunk,
} from './terrainMath';
import { ComputeEngine } from './wasmCompute';

const LOD_SEGS = [24, 12, 6] as const;
const MAX_GEO_CACHE = 420;

function buildGridIndices(segs: number): Uint16Array {
  const dim = segs + 1;
  const indices = new Uint16Array(segs * segs * 6);
  let ptr = 0;
  for (let iz = 0; iz < segs; iz++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iz * dim + ix;
      const b = a + 1;
      const c = a + dim;
      const d = c + 1;
      indices[ptr++] = a;
      indices[ptr++] = c;
      indices[ptr++] = b;
      indices[ptr++] = b;
      indices[ptr++] = c;
      indices[ptr++] = d;
    }
  }
  return indices;
}

export interface ChunkVisibilityStats {
  visibleChunks: number;
  lod0: number;
  lod1: number;
  lod2: number;
}

export interface ActiveChunkSlot {
  slotIdx: number;
  vcx: number;
  vcz: number;
  centerX: number;
  centerZ: number;
}

export class TerrainChunkManager {
  readonly group = new THREE.Group();
  readonly chunkSpheres = new Float32Array(CHUNK_COUNT * 4);
  readonly chunkLods = new Int32Array(CHUNK_COUNT);
  readonly activeSlots: ActiveChunkSlot[] = [];

  private readonly meshes: THREE.Mesh[] = [];
  private readonly sharedIndices: THREE.BufferAttribute[];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly compute: ComputeEngine;
  private readonly frustum = new THREE.Frustum();
  private readonly projScreenMatrix = new THREE.Matrix4();
  private readonly planesFlat = new Float32Array(24);
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();

  private centerVcx = 99999;
  private centerVcz = 99999;
  private diagGeoBuilds = 0;
  private diagGeoEvictions = 0;
  private diagRecenters = 0;

  constructor(
    compute: ComputeEngine,
    groundDetailTex: THREE.Texture,
    groundNormalTex?: THREE.Texture
  ) {
    this.compute = compute;
    this.sharedIndices = LOD_SEGS.map(
      (s) => new THREE.BufferAttribute(buildGridIndices(s), 1)
    );

    // Physically-based forest-floor terrain with Sobel normal relief,
    // rotated dual-scale anti-tiling, organic dappled breakup, and wet peat shoreline sheen.
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: groundDetailTex,
      normalMap: groundNormalTex ?? null,
      normalScale: new THREE.Vector2(0.82, 0.82),
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.55,
    });
    this.material.customProgramCacheKey = () => 'terrain_pbr_antitile_v2';
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        `varying vec3 vTerrainWorldPos;\n` +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader =
        `varying vec3 vTerrainWorldPos;\n` +
        shader.fragmentShader
          .replace(
            '#include <map_fragment>',
            `#ifdef USE_MAP
              // World-space dual-scale rotated sampling eliminates visible chunk/tile repetition
              vec2 uvFine = vTerrainWorldPos.xz * 0.22;
              vec2 uvMacro = mat2(0.819, -0.574, 0.574, 0.819) * (vTerrainWorldPos.xz * 0.068);
              vec4 texFine = texture2D(map, uvFine);
              vec4 texMacro = texture2D(map, uvMacro);
              vec4 sampledDiffuseColor = mix(texFine, texMacro, 0.36);

              // Subtle organic woodland floor variegation & dappled moss breakup
              float macroVar = 0.92
                + 0.08 * sin(vTerrainWorldPos.x * 0.19 + vTerrainWorldPos.z * 0.13)
                + 0.06 * cos(vTerrainWorldPos.x * 0.43 - vTerrainWorldPos.z * 0.37);
              sampledDiffuseColor.rgb *= macroVar;

              // Darken damp peat & muddy banks near the bog water table
              float wetShore = 1.0 - smoothstep(${(SWAMP_WATER_Y - 0.04).toFixed(3)}, ${(SWAMP_WATER_Y + 0.42).toFixed(3)}, vTerrainWorldPos.y);
              sampledDiffuseColor.rgb *= mix(1.0, 0.56, wetShore);
              diffuseColor *= sampledDiffuseColor;
            #endif`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            float wetGloss = 1.0 - smoothstep(${(SWAMP_WATER_Y - 0.04).toFixed(3)}, ${(SWAMP_WATER_Y + 0.34).toFixed(3)}, vTerrainWorldPos.y);
            roughnessFactor = mix(roughnessFactor, 0.22, wetGloss);`
          );
    };

    for (let i = 0; i < CHUNK_COUNT; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
      this.activeSlots.push({
        slotIdx: i,
        vcx: 0,
        vcz: 0,
        centerX: 0,
        centerZ: 0,
      });
    }

    this.recenterWindow(0, 0);
  }

  private getOrCreateLodGeo(vcx: number, vcz: number, lod: 0 | 1 | 2): THREE.BufferGeometry {
    const key = `${vcx}_${vcz}_${lod}`;
    const existing = this.geoCache.get(key);
    if (existing) {
      this.geoCache.delete(key);
      this.geoCache.set(key, existing);
      return existing;
    }

    const minX = vcx * CHUNK_SIZE;
    const minZ = vcz * CHUNK_SIZE;
    const segs = LOD_SEGS[lod];
    const vertCount = (segs + 1) * (segs + 1);
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);

    this.compute.fillTerrainChunk(minX, minZ, CHUNK_SIZE, segs, positions, normals, colors);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const uvs = new Float32Array(vertCount * 2);
    const dim = segs + 1;
    for (let iz = 0; iz < dim; iz++) {
      for (let ix = 0; ix < dim; ix++) {
        const idx = (iz * dim + ix) * 2;
        uvs[idx] = (minX + (ix / segs) * CHUNK_SIZE) * 0.22;
        uvs[idx + 1] = (minZ + (iz / segs) * CHUNK_SIZE) * 0.22;
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(this.sharedIndices[lod]);
    geo.computeBoundingSphere();

    this.geoCache.set(key, geo);
    this.diagGeoBuilds++;
    if (this.geoCache.size > MAX_GEO_CACHE) {
      for (const [oldKey, oldGeo] of this.geoCache) {
        if (this.geoCache.size <= MAX_GEO_CACHE) break;
        const inUse = this.meshes.some((m) => m.geometry === oldGeo);
        if (!inUse) {
          this.geoCache.delete(oldKey);
          oldGeo.dispose();
          this.diagGeoEvictions++;
        }
      }
    }
    return geo;
  }

  private recenterWindow(pcx: number, pcz: number): void {
    if (pcx === this.centerVcx && pcz === this.centerVcz) return;
    this.centerVcx = pcx;
    this.centerVcz = pcz;
    this.diagRecenters++;

    const half = Math.floor(ACTIVE_GRID / 2);
    let idx = 0;
    for (let dz = -half; dz <= half; dz++) {
      for (let dx = -half; dx <= half; dx++) {
        const vcx = pcx + dx;
        const vcz = pcz + dz;
        const minX = vcx * CHUNK_SIZE;
        const minZ = vcz * CHUNK_SIZE;
        const centerX = minX + CHUNK_SIZE * 0.5;
        const centerZ = minZ + CHUNK_SIZE * 0.5;

        const outOfWorld =
          centerX < -WORLD_HALF - CHUNK_SIZE ||
          centerX > WORLD_HALF + CHUNK_SIZE ||
          centerZ < -WORLD_HALF - CHUNK_SIZE ||
          centerZ > WORLD_HALF + CHUNK_SIZE;

        const slot = this.activeSlots[idx];
        slot.vcx = vcx;
        slot.vcz = vcz;
        slot.centerX = centerX;
        slot.centerZ = centerZ;

        const sb = idx * 4;
        if (outOfWorld) {
          this.chunkSpheres[sb] = centerX;
          this.chunkSpheres[sb + 1] = 99999;
          this.chunkSpheres[sb + 2] = centerZ;
          this.chunkSpheres[sb + 3] = 0.01;
        } else {
          let minH = Infinity;
          let maxH = -Infinity;
          for (let sz = 0; sz <= 2; sz++) {
            for (let sx = 0; sx <= 2; sx++) {
              const h = getTerrainHeight(
                minX + (sx / 2) * CHUNK_SIZE,
                minZ + (sz / 2) * CHUNK_SIZE
              );
              if (h < minH) minH = h;
              if (h > maxH) maxH = h;
            }
          }
          const centerY = (minH + maxH) * 0.5;
          const halfY = (maxH - minH) * 0.5 + 1.8;
          const halfXZ = CHUNK_SIZE * 0.5;
          this.chunkSpheres[sb] = centerX;
          this.chunkSpheres[sb + 1] = centerY;
          this.chunkSpheres[sb + 2] = centerZ;
          this.chunkSpheres[sb + 3] = Math.hypot(halfXZ, halfY, halfXZ);
        }
        this.chunkLods[idx] = -1;
        idx++;
      }
    }
  }

  prewarmAround(x: number, z: number): void {
    const { vcx, vcz } = worldToVirtualChunk(x, z);
    this.recenterWindow(vcx, vcz);
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const slot = this.activeSlots[i];
      const d = Math.hypot(slot.centerX - x, slot.centerZ - z);
      if (d < 56) this.getOrCreateLodGeo(slot.vcx, slot.vcz, 0);
      else if (d < 96) this.getOrCreateLodGeo(slot.vcx, slot.vcz, 1);
    }
  }

  update(camera: THREE.PerspectiveCamera, stats?: ChunkVisibilityStats): void {
    const { vcx, vcz } = worldToVirtualChunk(camera.position.x, camera.position.z);
    this.recenterWindow(vcx, vcz);

    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    for (let p = 0; p < 6; p++) {
      const pl = this.frustum.planes[p];
      const pb = p * 4;
      this.planesFlat[pb] = pl.normal.x;
      this.planesFlat[pb + 1] = pl.normal.y;
      this.planesFlat[pb + 2] = pl.normal.z;
      this.planesFlat[pb + 3] = pl.constant;
    }

    const vis = this.compute.cullChunks(
      this.chunkSpheres,
      CHUNK_COUNT,
      this.planesFlat,
      camera.position.x,
      camera.position.y,
      camera.position.z,
      230 * 230,
      64 * 64,
      130 * 130,
      this.chunkLods
    );

    let lod0 = 0;
    let lod1 = 0;
    let lod2 = 0;
    let finalVis = vis;

    const px = camera.position.x;
    const pz = camera.position.z;

    for (let i = 0; i < CHUNK_COUNT; i++) {
      const sb = i * 4;
      if (this.chunkSpheres[sb + 1] > 9000) {
        this.meshes[i].visible = false;
        this.chunkLods[i] = -1;
        continue;
      }

      const dx = this.chunkSpheres[sb] - px;
      const dz = this.chunkSpheres[sb + 2] - pz;
      const nearPlayer = dx * dx + dz * dz < 48 * 48;

      let lod = this.chunkLods[i];
      if (nearPlayer) {
        if (lod < 0) finalVis++;
        lod = 0;
        this.chunkLods[i] = 0;
      }

      const mesh = this.meshes[i];
      if (lod < 0) {
        mesh.visible = false;
        continue;
      }

      mesh.visible = true;
      const typedLod = lod as 0 | 1 | 2;
      if (typedLod === 0) lod0++;
      else if (typedLod === 1) lod1++;
      else lod2++;

      const slot = this.activeSlots[i];
      const targetGeo = this.getOrCreateLodGeo(slot.vcx, slot.vcz, typedLod);
      if (mesh.geometry !== targetGeo) {
        mesh.geometry = targetGeo;
      }
    }

    if (stats) {
      stats.visibleChunks = finalVis;
      stats.lod0 = lod0;
      stats.lod1 = lod1;
      stats.lod2 = lod2;
    }
  }

  consumeDiagnostics(): {
    cacheSize: number;
    geoBuilds: number;
    geoEvictions: number;
    recenters: number;
    centerVcx: number;
    centerVcz: number;
  } {
    const out = {
      cacheSize: this.geoCache.size,
      geoBuilds: this.diagGeoBuilds,
      geoEvictions: this.diagGeoEvictions,
      recenters: this.diagRecenters,
      centerVcx: this.centerVcx,
      centerVcz: this.centerVcz,
    };
    this.diagGeoBuilds = 0;
    this.diagGeoEvictions = 0;
    this.diagRecenters = 0;
    return out;
  }

  dispose(): void {
    this.material.dispose();
    for (const g of this.geoCache.values()) {
      g.dispose();
    }
    this.geoCache.clear();
  }
}
