import * as THREE from 'three';
import {
  ACTIVE_GRID,
  CHUNK_COUNT,
  CHUNK_SIZE,
  getActiveBlueprint,
  getTerrainHeight,
  WORLD_HALF,
  worldToVirtualChunk,
} from './terrainMath';
import { ComputeEngine } from './wasmCompute';
import {
  buildTerrainChunk, LOD_SEGS, SHORE_LOD0_SEGS, type TerrainLod, type TerrainChunkData,
} from './terrainChunkGeometry';
import { TerrainChunkPrefetch, type PrefetchJob } from './terrainChunkPrefetch';

const MAX_GEO_CACHE = 420;
const TERRAIN_LODS = [0, 1, 2] as const;

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
  private readonly shoreIndices: THREE.BufferAttribute;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly compute: ComputeEngine;
  private readonly frustum = new THREE.Frustum();
  private readonly projScreenMatrix = new THREE.Matrix4();
  readonly frustumPlanes = new Float32Array(24);
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();

  private readonly sunDayUniform = { value: 1.0 };
  private readonly timeUniform = { value: 0.0 };
  private readonly windUniform = { value: 0.25 };
  private readonly skyHorizonUniform = { value: new THREE.Color(0xb9d1df) };
  private readonly fallbackShoreDepthTex: THREE.DataTexture;
  private readonly shoreDepthUniform: { value: THREE.DataTexture };
  private readonly bogBoundsUniform = { value: new THREE.Vector3(0, 0, 120) };
  private readonly terrainFadeStartUniform = { value: 196.0 };
  private readonly terrainFadeEndUniform = { value: 236.0 };

  private prefetch: TerrainChunkPrefetch | null = null;
  private plannedX = Infinity;
  private plannedZ = Infinity;
  private plannedRange = Infinity;
  private plannedLod0 = Infinity;
  private plannedLod1 = Infinity;

  private centerVcx = 99999;
  private centerVcz = 99999;
  private diagGeoBuilds = 0;
  private diagWorkerBuilds = 0;
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
      mossTex?: THREE.Texture;
    }
  ) {
    this.compute = compute;
    this.sharedIndices = LOD_SEGS.map(
      (s) => new THREE.BufferAttribute(buildGridIndices(s), 1)
    );
    this.shoreIndices = new THREE.BufferAttribute(buildGridIndices(SHORE_LOD0_SEGS), 1);

    this.fallbackShoreDepthTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    this.fallbackShoreDepthTex.minFilter = THREE.LinearFilter;
    this.fallbackShoreDepthTex.magFilter = THREE.LinearFilter;
    this.fallbackShoreDepthTex.needsUpdate = true;
    this.shoreDepthUniform = { value: this.fallbackShoreDepthTex };
    const initBp = getActiveBlueprint();
    this.bogBoundsUniform.value.set(initBp.bogCenterX, initBp.bogCenterZ, initBp.bogRadius + 28);

    const forestTex = splatTextures?.forestTex ?? groundDetailTex;
    const meadowTex = splatTextures?.meadowTex ?? groundDetailTex;
    const roadTex = splatTextures?.roadTex ?? groundDetailTex;
    const mossTex = splatTextures?.mossTex ?? meadowTex;

    // Physically-based 4-biome photographic splat terrain with world-space anti-tiling,
    // organic mossy & short-turf ground filler, road verges, wet peat shoreline sheen, and dappled sunlight!
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: forestTex,
      normalMap: groundNormalTex ?? null,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.36,
    });
    this.material.customProgramCacheKey = () => 'terrain_pbr_splat_dapple_moss_swash_v9';
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uMeadowTex = { value: meadowTex };
      shader.uniforms.uRoadTex = { value: roadTex };
      shader.uniforms.uMossTex = { value: mossTex };
      shader.uniforms.uSunDay = this.sunDayUniform;
      shader.uniforms.uTime = this.timeUniform;
      shader.uniforms.uWindStrength = this.windUniform;
      shader.uniforms.uSkyHorizon = this.skyHorizonUniform;
      shader.uniforms.uShoreDepthMap = this.shoreDepthUniform;
      shader.uniforms.uBogCenterRadius = this.bogBoundsUniform;
      shader.uniforms.uTerrainFadeStart = this.terrainFadeStartUniform;
      shader.uniforms.uTerrainFadeEnd = this.terrainFadeEndUniform;

      shader.vertexShader =
        `attribute vec4 aSplat;\nvarying vec3 vTerrainWorldPos;\nvarying vec4 vSplat;\n` +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vSplat = aSplat;`
        );

      shader.fragmentShader =
        `uniform sampler2D uMeadowTex;\nuniform sampler2D uRoadTex;\nuniform sampler2D uMossTex;\nuniform sampler2D uShoreDepthMap;\nuniform vec3 uBogCenterRadius;\nuniform float uSunDay;\nuniform float uTime;\nuniform float uWindStrength;\nuniform vec3 uSkyHorizon;\nuniform float uTerrainFadeStart;\nuniform float uTerrainFadeEnd;\nvarying vec3 vTerrainWorldPos;\nvarying vec4 vSplat;\n` +
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
              // World-space UVs with conditional biome splat sampling
              vec2 uvFine = vTerrainWorldPos.xz * 0.24;

              // Fast organic edge break-up & macro anti-tiling modulation
              float edgeNoise = sin(vTerrainWorldPos.x * 1.35 + vTerrainWorldPos.z * 0.95) * 0.14
                              + cos(vTerrainWorldPos.x * 2.8 - vTerrainWorldPos.z * 2.1) * 0.08;
              float wRoad = smoothstep(0.18, 0.72, vSplat.x + edgeNoise);
              float wBog = smoothstep(0.12, 0.78, vSplat.w + edgeNoise * 0.7);
              float wMeadow = clamp(vSplat.y + edgeNoise * 0.45, 0.0, 1.0);
              float wForest = clamp(vSplat.z, 0.0, 1.0);

              vec3 baseGround = texture2D(map, uvFine).rgb;
              if (wMeadow > 0.02 && wRoad < 0.98) {
                vec3 colMeadow = texture2D(uMeadowTex, uvFine * 1.12).rgb;
                baseGround = mix(baseGround, colMeadow, wMeadow / max(0.001, wMeadow + wForest));
              }

              // Lush organic moss & short-turf undercarpet filling spaces between 3D grass tufts
              if (wRoad < 0.94) {
                float mossMacro = sin(vTerrainWorldPos.x * 0.46 + cos(vTerrainWorldPos.z * 0.38)) * 0.5 + 0.5;
                float mossMicro = cos(vTerrainWorldPos.x * 1.65 - vTerrainWorldPos.z * 1.42) * 0.5 + 0.5;
                float mossPatch = smoothstep(0.24, 0.78, mossMacro * 0.65 + mossMicro * 0.35);
                float mossAmt = mossPatch * (1.0 - wRoad) * mix(0.42, 0.68, wForest);
                if (mossAmt > 0.02) {
                  vec3 colMoss = texture2D(uMossTex, vTerrainWorldPos.xz * 0.34).rgb;
                  baseGround = mix(baseGround, colMoss, mossAmt);
                }
              }

              if (wBog > 0.02) {
                vec3 colBog = mix(baseGround * vec3(0.46, 0.40, 0.24), vec3(0.085, 0.068, 0.038), 0.48);
                baseGround = mix(baseGround, colBog, wBog);
              }
              if (wRoad > 0.02) {
                vec3 colRoad = texture2D(uRoadTex, uvFine * 1.18).rgb;
                baseGround = mix(baseGround, colRoad, wRoad);
              }

              // Subtle macro organic variation eliminates visible tile repetition with zero extra texture reads
              float macroVar = 0.89
                + 0.08 * sin(vTerrainWorldPos.x * 0.16 + vTerrainWorldPos.z * 0.11)
                + 0.07 * cos(vTerrainWorldPos.x * 0.39 - vTerrainWorldPos.z * 0.33);
              baseGround *= macroVar;

              // Photographic dappled sunlight filtering through Estonian pine & birch crowns onto forest floor!
              vec2 dappleUv = vTerrainWorldPos.xz * 0.31 + vec2(sin(uTime * 0.45) * 0.08, cos(uTime * 0.38) * 0.06);
              float canopyRaw = sin(dappleUv.x * 1.7 + sin(dappleUv.y * 1.3))
                              * cos(dappleUv.y * 1.9 - cos(dappleUv.x * 1.1));
              float dappleMask = smoothstep(-0.18, 0.55, canopyRaw);
              float forestDappleAmt = wForest * (1.0 - wRoad * 0.75) * (1.0 - wBog * 0.8) * uSunDay;
              vec3 dappleTint = mix(vec3(0.68, 0.74, 0.78), vec3(1.24, 1.18, 0.96), dappleMask);
              baseGround *= mix(vec3(1.0), dappleTint, forestDappleAmt * 0.52);

            #endif

              float swashWaterMask = 0.0;
              float residualFilm = 0.0;
              float wetGloss = 0.0;
              // Synchronized curved shoreline swash run-up + draining residual wet film across ALL bog shores (including islands & spits!)
              vec2 sp = vTerrainWorldPos.xz;
              float bogDist = length(sp - uBogCenterRadius.xy);
              float bogShoreMask = 1.0 - smoothstep(uBogCenterRadius.z - 12.0, uBogCenterRadius.z + 4.0, bogDist);
              if (bogShoreMask > 0.005) {
                float shoreWindNorm = clamp((uWindStrength - 0.14) / 2.15, 0.0, 1.0);
                vec2 shoreUv = clamp((sp - (uBogCenterRadius.xy - vec2(uBogCenterRadius.z))) / (2.0 * uBogCenterRadius.z), vec2(0.002), vec2(0.998));
                float smoothDepth = texture2D(uShoreDepthMap, shoreUv).r * 2.55 - 0.65;
                float edgeCurve = sin(sp.x * 0.42 + sp.y * 0.35) * 0.018 + cos(sp.x * 0.91 - sp.y * 0.77) * 0.009;
                // Smooth height above curved water contour (eliminates straight terrain triangle edges!)
                float hAboveWater = -smoothDepth - edgeCurve;

                float swashFreq = mix(1.25, 2.25, shoreWindNorm);
                float shorePhase = uTime * swashFreq
                  + sin(sp.x * 0.27 + sp.y * 0.19) * 1.65
                  + cos(sp.x * 0.14 - sp.y * 0.31) * 1.15;
                float swashCyc = fract(shorePhase * 0.15915494);
                float activeWave = smoothstep(0.0, 0.34, swashCyc) * (1.0 - smoothstep(0.34, 0.80, swashCyc));
                float swashAmp = mix(0.052, 0.105, shoreWindNorm);
                float swashReachH = mix(0.072, 0.135, shoreWindNorm);
                float activeSwashH = (activeWave - 0.32) * swashAmp + 0.036;

                // Advancing glossy water sheet on the gently sloping shore (seamlessly joins water plane's edgeAlpha!)
                swashWaterMask = (1.0 - smoothstep(activeSwashH - 0.016, activeSwashH + 0.018, hAboveWater))
                  * smoothstep(-0.14, -0.02, hAboveWater) * bogShoreMask;
                // Delicate luminous water-lip meniscus right along the moving curved wave front
                float swashMeniscus = smoothstep(activeSwashH - 0.018, activeSwashH - 0.002, hAboveWater)
                  * (1.0 - smoothstep(activeSwashH - 0.002, activeSwashH + 0.014, hAboveWater))
                  * smoothstep(0.06, 0.32, activeWave) * bogShoreMask;

                // Residual wet water film left behind as wavelet retreats, draining downward before next wave arrives!
                float drainProgress = smoothstep(0.34, 0.96, swashCyc);
                float reachNorm = clamp((hAboveWater + 0.01) / max(0.001, swashReachH), 0.0, 1.0);
                // Upper edge dries first, lower edge finishes draining right before next wave surges in
                float residualDrain = 1.0 - smoothstep(0.0, 0.84, drainProgress + reachNorm * 0.44 - 0.16);
                float residualReach = (1.0 - smoothstep(swashReachH - 0.014, swashReachH + 0.020, hAboveWater))
                  * smoothstep(-0.04, 0.002, hAboveWater);
                residualFilm = residualReach * smoothstep(0.08, 0.30, swashCyc) * residualDrain * bogShoreMask;

                wetGloss = (1.0 - smoothstep(-0.04, 0.34, hAboveWater)) * bogShoreMask;
                #ifdef USE_MAP
                // Base damp capillary sand/peat margin plus dynamic darkening from swash & draining residual film
                float wetShore = (1.0 - smoothstep(-0.04, 0.36, hAboveWater)) * bogShoreMask;
                float dynamicWet = clamp(max(swashWaterMask, residualFilm), 0.0, 1.0);
                baseGround *= mix(1.0, 0.42, max(wetShore * 0.80, dynamicWet));

                // Thin sky-reflecting water sheen on advancing swash tongue and freshly left draining residual film
                vec3 viewDirShore = normalize(cameraPosition - vTerrainWorldPos);
                float shoreFres = pow(1.0 - clamp(viewDirShore.y, 0.0, 1.0), 2.8);
                vec3 shallowReflect = mix(vec3(0.075, 0.088, 0.078), uSkyHorizon * 0.90, 0.38 + 0.56 * shoreFres);
                baseGround = mix(baseGround, shallowReflect, clamp(swashWaterMask * (0.58 + 0.34 * shoreFres) + residualFilm * (0.18 + 0.28 * shoreFres), 0.0, 0.88));
                baseGround = mix(baseGround, mix(uSkyHorizon, vec3(0.88, 0.91, 0.89), 0.35), swashMeniscus * 0.32);
                #endif
              }

            #ifdef USE_MAP
              diffuseColor.rgb *= baseGround;
            #endif`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            if (bogShoreMask > 0.005) {
              roughnessFactor = mix(roughnessFactor, 0.52, wetGloss);
              roughnessFactor = mix(roughnessFactor, 0.14, residualFilm);
              roughnessFactor = mix(roughnessFactor, 0.06, swashWaterMask);
            }`
          )
          .replace(
            '#include <fog_fragment>',
            `#include <fog_fragment>
            #ifdef USE_FOG
              float terrainEdgeDist = length(vTerrainWorldPos.xz - cameraPosition.xz);
              float terrainHorizonFade = smoothstep(uTerrainFadeStart, max(uTerrainFadeStart + 1.0, uTerrainFadeEnd), terrainEdgeDist);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, terrainHorizonFade);
            #endif`
          );
    };

    this.group.userData.debugLayer = 'terrain';
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.userData.debugLayer = 'terrain';
      mesh.userData.debugName = 'Procedural Terrain';
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

    // A cold teleport or a missed prefetch deadline still requires the exact visible mesh.
    return this.cacheGeometry(key, lod, buildTerrainChunk(this.compute, { vcx, vcz, lod }));
  }

  private cacheGeometry(key: string, lod: TerrainLod, data: TerrainChunkData): THREE.BufferGeometry {
    const { positions, normals, colors, uvs, splats, segs } = data;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(splats, 4));
    geo.setIndex(segs === SHORE_LOD0_SEGS ? this.shoreIndices : this.sharedIndices[lod]);
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

  // Refresh before the camera can exhaust the lead distance in any direction.
  private planTerrain(x: number, z: number, range: number, lod0: number, lod1: number): void {
    if (!this.prefetch?.available) return;
    if (Math.hypot(x - this.plannedX, z - this.plannedZ) < 8 &&
        Math.abs(range - this.plannedRange) < 8 && Math.abs(lod0 - this.plannedLod0) < 4 &&
        Math.abs(lod1 - this.plannedLod1) < 4) return;
    this.plannedX = x;
    this.plannedZ = z;
    this.plannedRange = range;
    this.plannedLod0 = lod0;
    this.plannedLod1 = lod1;

    // Overlap adjacent detail bands so a turn or LOD transition is already cached.
    const lead = CHUNK_SIZE / 2;
    const radius = range + lead;
    const jobs: PrefetchJob[] = [];
    const minChunk = worldToVirtualChunk(x - radius, z - radius);
    const maxChunk = worldToVirtualChunk(x + radius, z + radius);
    for (let vcz = minChunk.vcz; vcz <= maxChunk.vcz; vcz++) {
      for (let vcx = minChunk.vcx; vcx <= maxChunk.vcx; vcx++) {
        const cx = (vcx + 0.5) * CHUNK_SIZE;
        const cz = (vcz + 0.5) * CHUNK_SIZE;
        if (Math.max(Math.abs(cx), Math.abs(cz)) > WORLD_HALF + CHUNK_SIZE) continue;
        const distance = Math.hypot(cx - x, cz - z);
        if (distance > radius) continue;
        const nearestLod = distance < lod0 ? 0 : distance < lod1 ? 1 : 2;
        for (const lod of TERRAIN_LODS) {
          if (lod === 0 && distance > lod0 + lead) continue;
          if (lod === 1 && (distance < lod0 - lead || distance > lod1 + lead)) continue;
          if (lod === 2 && distance < lod1 - lead) continue;
          const key = `${vcx}_${vcz}_${lod}`;
          if (!this.geoCache.has(key)) {
            jobs.push({ vcx, vcz, lod, key, priority: distance + (lod === nearestLod ? 0 : lead) });
          }
        }
      }
    }
    this.prefetch.schedule(jobs);
  }

  async prewarmAround(x: number, z: number, range = 225, lod0 = 58, lod1 = 118): Promise<void> {
    this.prefetch ??= new TerrainChunkPrefetch(
      getActiveBlueprint().seed, this.compute.isWasmActive,
      key => this.geoCache.has(key),
      (job, data) => {
        this.cacheGeometry(job.key, job.lod, data);
        this.diagWorkerBuilds++;
      }
    );
    if (this.prefetch.available) {
      this.planTerrain(x, z, range, lod0, lod1);
      await this.prefetch.whenIdle();
      if (!this.prefetch || this.prefetch.available) return;
    }
    // Worker unavailable: retain the original synchronous startup coverage.
    const { vcx, vcz } = worldToVirtualChunk(x, z);
    this.recenterWindow(vcx, vcz);
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const slot = this.activeSlots[i];
      const d = Math.hypot(slot.centerX - x, slot.centerZ - z);
      if (d < 56) this.getOrCreateLodGeo(slot.vcx, slot.vcz, 0);
      else if (d < 96) this.getOrCreateLodGeo(slot.vcx, slot.vcz, 1);
    }
  }

  setBogShoreDepthMap(
    texture: THREE.DataTexture,
    centerX: number,
    centerZ: number,
    radius: number
  ): void {
    this.shoreDepthUniform.value = texture;
    this.bogBoundsUniform.value.set(centerX, centerZ, radius);
  }

  setLightingState(
    dayFactor: number,
    elapsed: number,
    windStrength = 0.25,
    skyHorizon?: THREE.Color
  ): void {
    this.sunDayUniform.value = dayFactor;
    this.timeUniform.value = elapsed;
    this.windUniform.value = windStrength;
    if (skyHorizon) {
      this.skyHorizonUniform.value.copy(skyHorizon);
    }
  }

  update(
    camera: THREE.PerspectiveCamera,
    stats?: ChunkVisibilityStats,
    maxRenderDist = 225,
    lod0Dist = 58,
    lod1Dist = 118
  ): void {
    const { vcx, vcz } = worldToVirtualChunk(camera.position.x, camera.position.z);
    this.recenterWindow(vcx, vcz);

    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    for (let p = 0; p < 6; p++) {
      const pl = this.frustum.planes[p];
      const pb = p * 4;
      this.frustumPlanes[pb] = pl.normal.x;
      this.frustumPlanes[pb + 1] = pl.normal.y;
      this.frustumPlanes[pb + 2] = pl.normal.z;
      this.frustumPlanes[pb + 3] = pl.constant;
    }

    const clampedMax = Math.max(72, Math.min(264, maxRenderDist));
    this.planTerrain(camera.position.x, camera.position.z, clampedMax, lod0Dist, lod1Dist);
    const effectiveFadeMax = Math.min(clampedMax, 238);
    this.terrainFadeEndUniform.value = effectiveFadeMax - 2;
    this.terrainFadeStartUniform.value = Math.max(40, effectiveFadeMax - 38);
    const vis = this.compute.cullChunks(
      this.chunkSpheres,
      CHUNK_COUNT,
      this.frustumPlanes,
      camera.position.x,
      camera.position.y,
      camera.position.z,
      clampedMax * clampedMax,
      lod0Dist * lod0Dist,
      lod1Dist * lod1Dist,
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
      // Only keep the immediate underfoot terrain chunk forced visible (26m) so behind-camera chunks stay culled
      const nearPlayer = dx * dx + dz * dz < 26 * 26;

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
    workerBuilds: number;
    geoEvictions: number;
    recenters: number;
    centerVcx: number;
    centerVcz: number;
  } {
    const out = {
      cacheSize: this.geoCache.size,
      geoBuilds: this.diagGeoBuilds,
      workerBuilds: this.diagWorkerBuilds,
      geoEvictions: this.diagGeoEvictions,
      recenters: this.diagRecenters,
      centerVcx: this.centerVcx,
      centerVcz: this.centerVcz,
    };
    this.diagGeoBuilds = 0;
    this.diagWorkerBuilds = 0;
    this.diagGeoEvictions = 0;
    this.diagRecenters = 0;
    return out;
  }

  dispose(): void {
    this.prefetch?.dispose();
    this.prefetch = null;
    this.fallbackShoreDepthTex.dispose();
    this.material.dispose();
    for (const g of this.geoCache.values()) {
      g.dispose();
    }
    this.geoCache.clear();
  }
}
