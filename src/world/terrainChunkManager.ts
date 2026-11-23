import * as THREE from 'three';
import {
  ACTIVE_GRID,
  CHUNK_COUNT,
  CHUNK_SIZE,
  clamp,
  distToRoadDetail,
  getDistanceToNearestVillage,
  getNearestSwampIsland,
  getSwampFactor,
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

  private readonly sunDayUniform = { value: 1.0 };
  private readonly timeUniform = { value: 0.0 };

  private centerVcx = 99999;
  private centerVcz = 99999;
  private diagGeoBuilds = 0;
  private diagGeoEvictions = 0;
  private diagRecenters = 0;

  constructor(
    compute: ComputeEngine,
    groundDetailTex: THREE.Texture,
    groundNormalTex?: THREE.Texture,
    splatTextures?: {
      forestTex: THREE.Texture;
      meadowTex: THREE.Texture;
      roadTex: THREE.Texture;
    }
  ) {
    this.compute = compute;
    this.sharedIndices = LOD_SEGS.map(
      (s) => new THREE.BufferAttribute(buildGridIndices(s), 1)
    );

    const forestTex = splatTextures?.forestTex ?? groundDetailTex;
    const meadowTex = splatTextures?.meadowTex ?? groundDetailTex;
    const roadTex = splatTextures?.roadTex ?? groundDetailTex;

    // Physically-based 4-biome photographic splat terrain with world-space anti-tiling,
    // organic road verges, wet peat shoreline sheen, and dappled forest-canopy sunlight!
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: forestTex,
      normalMap: groundNormalTex ?? null,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.36,
    });
    this.material.customProgramCacheKey = () => 'terrain_pbr_splat_dapple_v4';
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uMeadowTex = { value: meadowTex };
      shader.uniforms.uRoadTex = { value: roadTex };
      shader.uniforms.uSunDay = this.sunDayUniform;
      shader.uniforms.uTime = this.timeUniform;

      shader.vertexShader =
        `attribute vec4 aSplat;\nvarying vec3 vTerrainWorldPos;\nvarying vec4 vSplat;\n` +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vSplat = aSplat;`
        );

      shader.fragmentShader =
        `uniform sampler2D uMeadowTex;\nuniform sampler2D uRoadTex;\nuniform float uSunDay;\nuniform float uTime;\nvarying vec3 vTerrainWorldPos;\nvarying vec4 vSplat;\n` +
        shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `// Use mild macro tint from vertex colors so real photographic splat textures shine at full fidelity
            #if defined( USE_COLOR_ALPHA )
              diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb * 1.45, 0.24);
              diffuseColor.a *= vColor.a;
            #elif defined( USE_COLOR )
              diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb * 1.45, 0.24);
            #endif`
          )
          .replace(
            '#include <map_fragment>',
            `#ifdef USE_MAP
              // World-space dual-scale rotated UVs eliminate visible chunk/tile repetition
              vec2 uvFine = vTerrainWorldPos.xz * 0.24;
              vec2 uvMacro = mat2(0.819, -0.574, 0.574, 0.819) * (vTerrainWorldPos.xz * 0.072);

              vec3 colForest = mix(texture2D(map, uvFine).rgb, texture2D(map, uvMacro).rgb, 0.34);
              vec3 colMeadow = mix(texture2D(uMeadowTex, uvFine * 1.12).rgb, texture2D(uMeadowTex, uvMacro * 1.05).rgb, 0.32);
              vec3 colRoad = mix(texture2D(uRoadTex, uvFine * 1.18).rgb, texture2D(uRoadTex, uvMacro * 0.95).rgb, 0.28);
              vec3 colBog = mix(colForest * vec3(0.46, 0.40, 0.24), vec3(0.085, 0.068, 0.038), 0.48);

              // High-frequency organic noise breaks up road verges and meadow boundaries cleanly
              float edgeNoise = sin(vTerrainWorldPos.x * 1.35 + vTerrainWorldPos.z * 0.95) * 0.14
                              + cos(vTerrainWorldPos.x * 2.8 - vTerrainWorldPos.z * 2.1) * 0.08;
              float wRoad = smoothstep(0.18, 0.72, vSplat.x + edgeNoise);
              float wBog = smoothstep(0.12, 0.78, vSplat.w + edgeNoise * 0.7);
              float wMeadow = clamp(vSplat.y + edgeNoise * 0.45, 0.0, 1.0);
              float wForest = clamp(vSplat.z, 0.0, 1.0);

              vec3 baseGround = mix(colForest, colMeadow, wMeadow / max(0.001, wMeadow + wForest));
              baseGround = mix(baseGround, colBog, wBog);
              baseGround = mix(baseGround, colRoad, wRoad);

              // Subtle macro organic variation across the landscape
              float macroVar = 0.91
                + 0.07 * sin(vTerrainWorldPos.x * 0.16 + vTerrainWorldPos.z * 0.11)
                + 0.06 * cos(vTerrainWorldPos.x * 0.39 - vTerrainWorldPos.z * 0.33);
              baseGround *= macroVar;

              // Photographic dappled sunlight filtering through Estonian pine & birch crowns onto forest floor!
              vec2 dappleUv = vTerrainWorldPos.xz * 0.31 + vec2(sin(uTime * 0.45) * 0.08, cos(uTime * 0.38) * 0.06);
              float canopyRaw = sin(dappleUv.x * 1.7 + sin(dappleUv.y * 1.3))
                              * cos(dappleUv.y * 1.9 - cos(dappleUv.x * 1.1));
              float dappleMask = smoothstep(-0.18, 0.55, canopyRaw);
              float forestDappleAmt = wForest * (1.0 - wRoad * 0.75) * (1.0 - wBog * 0.8) * uSunDay;
              vec3 dappleTint = mix(vec3(0.68, 0.74, 0.78), vec3(1.24, 1.18, 0.96), dappleMask);
              baseGround *= mix(vec3(1.0), dappleTint, forestDappleAmt * 0.52);

              // Darken damp peat & muddy banks near the bog water table
              float wetShore = 1.0 - smoothstep(${(SWAMP_WATER_Y - 0.04).toFixed(3)}, ${(SWAMP_WATER_Y + 0.44).toFixed(3)}, vTerrainWorldPos.y);
              baseGround *= mix(1.0, 0.42, wetShore);

              diffuseColor.rgb *= baseGround;
            #endif`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            float wetGloss = 1.0 - smoothstep(${(SWAMP_WATER_Y - 0.04).toFixed(3)}, ${(SWAMP_WATER_Y + 0.34).toFixed(3)}, vTerrainWorldPos.y);
            roughnessFactor = mix(roughnessFactor, 0.54, wetGloss);`
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
        const villageClearing =
          nearV.village !== null
            ? clamp(1 - (nearV.dist - nearV.village.clearingRadius * 0.55) / (nearV.village.clearingRadius * 0.65), 0, 1)
            : 0;
        const meadowW = clamp(Math.max(villageClearing, (1 - bogW) * 0.18), 0, 1);
        const forestW = clamp(1 - Math.max(villageClearing * 0.85, bogW), 0, 1);

        splats[vIdx * 4] = roadW;
        splats[vIdx * 4 + 1] = meadowW;
        splats[vIdx * 4 + 2] = forestW;
        splats[vIdx * 4 + 3] = bogW;
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(splats, 4));
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

  setLightingState(dayFactor: number, elapsed: number): void {
    this.sunDayUniform.value = dayFactor;
    this.timeUniform.value = elapsed;
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
