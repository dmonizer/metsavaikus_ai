import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  clamp,
  distToRoadDetail,
  getActiveBlueprint,
  getDistanceToNearestVillage,
  getNearestSwampIsland,
  getSwampFactor,
  getTerrainHeight,
  roadCenterX,
  SWAMP_WATER_Y,
  WORLD_HALF,
} from './terrainMath';
import { HutDecayState } from './worldBlueprint';
import { WorldTextures } from './proceduralTextures';
import { SoundEngine } from './soundEngine';
import { SkyFrameState } from './weatherAndSky';
import { sphereIntersectsFrustum } from './forestFrustumCuller';
import { MUSHROOM_SPECIES_INFO, MushroomSpecies } from '../game/gameLogic';

export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  groundY: number;
  heightAboveGround: number;
  jumpable: boolean;
  active: boolean;
}

export interface BoardwalkZone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

export interface InteractiveEntry {
  mesh: THREE.Object3D;
  name: string;
  desc: string;
  gatherable: boolean;
  species?: MushroomSpecies;
  gathered?: boolean;
  carryable: boolean;
  kickable: boolean;
  onTouch?: () => void;
  onUse?: () => void;
  radius: number;
  mass: number;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  isDynamic: boolean;
  resting: boolean;
  onGroundYOffset: number;
}

export interface WorldPropsContext {
  circleColliders: CircleCollider[];
  boxColliders: BoxCollider[];
  boardwalkZones: BoardwalkZone[];
  interactiveObjects: InteractiveEntry[];
  interactiveMeshes: THREE.Object3D[];
  dynamicObjects: InteractiveEntry[];
  mushroomCountTotal: number;
  heroMushroomPos: { x: number; z: number } | null;
  updateDynamicProps: (
    elapsed: number,
    camX: number,
    camZ: number,
    skyState?: SkyFrameState,
    frustumPlanes?: Float32Array,
    maxRenderDist?: number
  ) => void;
  gatherMushroom: (entry: InteractiveEntry) => MushroomSpecies | null;
  isWaterVisible: () => boolean;
  isMistVisible: () => boolean;
  dispose: () => void;
}

function seededRand(seed: number): () => number {
  let s = (seed | 0) ^ 0x517cc1b7;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function prepNonIndexed(
  geo: THREE.BufferGeometry,
  color?: THREE.Color
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const count = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (color && !g.attributes.color) {
    const count = g.attributes.position.count;
    const cols = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      cols[i * 3] = color.r;
      cols[i * 3 + 1] = color.g;
      cols[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  return g;
}

function makeBoxPart(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return prepNonIndexed(g);
}

function makeCylPart(
  rt: number,
  rb: number,
  len: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, len, segs, 1);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return prepNonIndexed(g);
}

/**
 * Applies soft vertical ambient-occlusion darkening at the bottom (ground contact)
 * and top (under roof eaves) of architectural wall geometry.
 */
function applyWallAoColors(geo: THREE.BufferGeometry, baseY: number, topY: number): void {
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const span = Math.max(0.2, topY - baseY);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp((pos.getY(i) - baseY) / span, 0, 1);
    const groundAo = 0.64 + 0.36 * Math.min(1, t / 0.28);
    const eaveAo = 0.44 + 0.56 * Math.min(1, (1 - t) / 0.28);
    const v = Math.min(groundAo, eaveAo);
    cols[i * 3] = v;
    cols[i * 3 + 1] = v * 0.99;
    cols[i * 3 + 2] = v * 0.96;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

export function buildArchitectureAndProps(
  scene: THREE.Scene,
  textures: WorldTextures,
  sound: SoundEngine,
  showToast: (msg: string) => void,
  isSoftwareGl: boolean
): WorldPropsContext {
  const bp = getActiveBlueprint();
  const rand = seededRand(bp.seed + 1337);
  const circleColliders: CircleCollider[] = [];
  const boxColliders: BoxCollider[] = [];
  const boardwalkZones: BoardwalkZone[] = [];
  const interactiveObjects: InteractiveEntry[] = [];
  const interactiveMeshes: THREE.Object3D[] = [];
  const dynamicObjects: InteractiveEntry[] = [];
  const mushroomNodes: Array<{ mesh: THREE.Object3D; x: number; z: number; entry: InteractiveEntry }> = [];
  const structureNodes: Array<{ obj: THREE.Object3D; x: number; z: number; maxDistSq: number }> = [];
  const disposables: Array<{ dispose: () => void }> = [];

  const shadows = !isSoftwareGl;

  function addBoxCollider(
    cx: number,
    cz: number,
    w: number,
    d: number,
    groundY: number,
    heightAboveGround: number,
    jumpable = false
  ): BoxCollider {
    const box: BoxCollider = {
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
      groundY,
      heightAboveGround,
      jumpable,
      active: true,
    };
    boxColliders.push(box);
    return box;
  }

  function registerInteractive(
    mesh: THREE.Object3D,
    opts: Partial<InteractiveEntry> & { name: string; desc: string }
  ): InteractiveEntry {
    const entry: InteractiveEntry = {
      mesh,
      name: opts.name,
      desc: opts.desc,
      gatherable: !!opts.gatherable,
      species: opts.species,
      gathered: false,
      carryable: !!opts.carryable && !opts.gatherable,
      kickable: !!opts.kickable && !opts.gatherable,
      onTouch: opts.onTouch,
      onUse: opts.onUse,
      radius: opts.radius ?? 0.35,
      mass: opts.mass ?? 1.0,
      vel: new THREE.Vector3(),
      angVel: new THREE.Vector3(),
      isDynamic: !!opts.isDynamic && !opts.gatherable,
      resting: false,
      onGroundYOffset: opts.onGroundYOffset ?? (opts.radius ?? 0.35),
    };
    mesh.userData.interactive = entry;
    mesh.traverse((child) => {
      child.userData.interactive = entry;
    });
    interactiveObjects.push(entry);
    interactiveMeshes.push(mesh);
    if (entry.isDynamic) dynamicObjects.push(entry);
    return entry;
  }

  // ============================================================================
  // Animated Fresnel Reflective Peat-Bog Water & Morning Mist Layers
  // ============================================================================
  const waterRadius = bp.bogRadius + 28;
  const waterGeo = new THREE.CircleGeometry(waterRadius, 56);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.55, 0.35).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uSkyTop: { value: new THREE.Color(0x285d96) },
      uSkyHorizon: { value: new THREE.Color(0xb9d1df) },
      uFogColor: { value: new THREE.Color(0xb9d1df) },
      uFogDensity: { value: 0.0065 },
      uRadius: { value: waterRadius },
      uCenter: { value: new THREE.Vector2(bp.bogCenterX, bp.bogCenterZ) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uRadius;
      uniform vec2 uCenter;

      varying vec3 vWorldPos;

      void main() {
        vec2 p = vWorldPos.xz;
        float t = uTime * 0.9;

        // Multi-directional capillary bog ripples (zero texture fetches, fast & crisp)
        float w1 = sin(p.x * 1.45 + p.y * 0.85 + t * 1.35);
        float w2 = cos(p.x * 0.92 - p.y * 1.65 - t * 1.12);
        float w3 = sin((p.x - p.y) * 2.75 + t * 1.95) * 0.45;
        vec3 nrm = normalize(vec3(
          (w1 * 0.032 + w3 * 0.022),
          1.0,
          (w2 * 0.032 - w3 * 0.022)
        ));

        vec3 toCam = cameraPosition - vWorldPos;
        float dist = length(toCam);
        vec3 viewDir = toCam / max(dist, 0.001);

        float ndv = clamp(dot(nrm, viewDir), 0.0, 1.0);
        // Schlick Fresnel: rich dark humic peat looking down, crisp sky mirror at grazing angles
        float fresnel = 0.06 + 0.78 * pow(1.0 - ndv, 3.6);

        vec3 reflDir = reflect(-viewDir, nrm);
        float reflElev = clamp(reflDir.y, 0.0, 1.0);
        vec3 skyRefl = mix(uSkyHorizon * 0.94, uSkyTop, smoothstep(0.0, 0.58, reflElev));
        // Subtle pine-silhouette reflection darkening right along the horizon mirror
        float treeMirror = smoothstep(0.03, 0.24, reflElev);
        skyRefl *= mix(vec3(0.36, 0.46, 0.40), vec3(1.0), treeMirror);

        // Dark humic Estonian bog water absorption
        vec3 peatDeep = vec3(0.022, 0.036, 0.034);
        vec3 col = mix(peatDeep, skyRefl, fresnel);

        // Solar specular glints across ripples
        vec3 halfVec = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(nrm, halfVec), 0.0), 150.0) * smoothstep(0.02, 0.22, uSunDir.y);
        float broadSpec = pow(max(dot(nrm, halfVec), 0.0), 26.0) * 0.16 * smoothstep(0.02, 0.22, uSunDir.y);
        col += uSunColor * (spec * 1.6 + broadSpec);

        // Exponential fog matching Three.js FogExp2
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: false,
    depthWrite: true,
  });
  const swampWater = new THREE.Mesh(waterGeo, waterMat);
  swampWater.position.set(bp.bogCenterX, SWAMP_WATER_Y, bp.bogCenterZ);
  scene.add(swampWater);
  disposables.push(waterGeo, waterMat);

  const mistGeo = new THREE.PlaneGeometry(18, 18);
  mistGeo.rotateX(-Math.PI / 2);
  const mistMat = new THREE.MeshBasicMaterial({
    map: textures.bogMistTex,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const mistInst = new THREE.InstancedMesh(mistGeo, mistMat, 10);
  const mistDummy = new THREE.Object3D();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rand() * 0.4;
    const rad = 18 + rand() * (bp.bogRadius * 0.72);
    mistDummy.position.set(
      bp.bogCenterX + Math.cos(a) * rad,
      SWAMP_WATER_Y + 0.36 + rand() * 0.42,
      bp.bogCenterZ + Math.sin(a) * rad
    );
    mistDummy.rotation.set(0, rand() * Math.PI, 0);
    mistDummy.scale.set(0.85 + rand() * 0.45, 1, 0.85 + rand() * 0.45);
    mistDummy.updateMatrix();
    mistInst.setMatrixAt(i, mistDummy.matrix);
  }
  mistInst.instanceMatrix.needsUpdate = true;
  scene.add(mistInst);
  disposables.push(mistGeo, mistMat);

  // ============================================================================
  // Photo-Matched PBR Estonian Heritage Log Buildings (Sobel Normal Maps + AO!)
  // ============================================================================
  const weatheredLogMat = new THREE.MeshStandardMaterial({
    map: textures.logWallWeathered,
    normalMap: textures.logWallNormal,
    normalScale: new THREE.Vector2(1.9, 1.9),
    roughness: 0.93,
    metalness: 0.0,
    envMapIntensity: 0.24,
    vertexColors: true,
  });
  const warmLogMat = new THREE.MeshStandardMaterial({
    map: textures.logWallWarm,
    normalMap: textures.logWallNormal,
    normalScale: new THREE.Vector2(1.9, 1.9),
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.26,
    vertexColors: true,
  });
  const thatchMat = new THREE.MeshStandardMaterial({
    map: textures.thatchRoofMossy,
    normalMap: textures.thatchNormal,
    normalScale: new THREE.Vector2(2.2, 2.2),
    color: 0xd8d2c4,
    roughness: 0.97,
    metalness: 0.0,
    envMapIntensity: 0.18,
  });
  const shingleMat = new THREE.MeshStandardMaterial({
    map: textures.roofShingle,
    normalMap: textures.shingleNormal,
    normalScale: new THREE.Vector2(2.0, 2.0),
    color: 0xc8c2b8,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.22,
  });
  const stonePlinthMat = new THREE.MeshStandardMaterial({
    map: textures.fieldstone,
    normalMap: textures.fieldstoneNormal,
    normalScale: new THREE.Vector2(2.2, 2.2),
    roughness: 0.9,
    metalness: 0.02,
    envMapIntensity: 0.3,
  });
  const timberTrimMat = new THREE.MeshStandardMaterial({
    map: textures.plankWood,
    normalMap: textures.plankNormal,
    normalScale: new THREE.Vector2(1.5, 1.5),
    color: 0x867c6e,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.24,
  });
  const gableMat = new THREE.MeshStandardMaterial({
    map: textures.gableBoards,
    normalMap: textures.plankNormal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    color: 0xbeb5a6,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.24,
  });
  const darkInteriorMat = new THREE.MeshStandardMaterial({
    color: 0x1a130e,
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.15,
  });
  const chimneyWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xcbc6bc,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });
  // Realistic heritage glass: dark sky-reflective in daytime, warm hearth glow at dusk/night!
  const activeWinMat = new THREE.MeshStandardMaterial({
    color: 0x141e24,
    emissive: 0xffa64d,
    emissiveIntensity: 0.04,
    roughness: 0.1,
    metalness: 0.18,
    envMapIntensity: 1.55,
  });
  const darkWinMat = new THREE.MeshStandardMaterial({
    color: 0x101413,
    roughness: 0.16,
    metalness: 0.12,
    envMapIntensity: 1.15,
  });
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadowTex,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  disposables.push(
    weatheredLogMat,
    warmLogMat,
    thatchMat,
    shingleMat,
    stonePlinthMat,
    timberTrimMat,
    gableMat,
    darkInteriorMat,
    chimneyWhiteMat,
    activeWinMat,
    darkWinMat,
    contactShadowMat
  );

  function addBatchedMesh(
    parent: THREE.Group,
    parts: THREE.BufferGeometry[],
    mat: THREE.Material,
    castShadow: boolean,
    wallAo?: { baseY: number; topY: number }
  ): void {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts)!;
    if (wallAo) {
      applyWallAoColors(merged, wallAo.baseY, wallAo.topY);
    }
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    parent.add(m);
    disposables.push(merged);
  }

  function buildEstonianLogHouse(
    x: number,
    z: number,
    rotY: number,
    opts: {
      w?: number;
      d?: number;
      h?: number;
      roofStyle?: 'thatch' | 'shingle';
      warmWood?: boolean;
      abandoned?: boolean;
      decayState?: HutDecayState;
      porch?: boolean;
      name?: string;
    } = {}
  ): void {
    const w = opts.w ?? 8.4;
    const d = opts.d ?? 5.6;
    const h = opts.h ?? 2.75;
    const roofStyle = opts.roofStyle ?? 'thatch';
    const wallMat = opts.warmWood ? warmLogMat : weatheredLogMat;
    const abandoned = !!opts.abandoned;
    const decay: HutDecayState = opts.decayState ?? 'intact';
    const name = opts.name ?? 'Rehemaja';

    const y = getTerrainHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = rotY;
    scene.add(group);
    structureNodes.push({ obj: group, x, z, maxDistSq: 255 * 255 });

    // Soft ambient-occlusion grounding skirt beneath each building
    const shadowGeo = new THREE.PlaneGeometry(w + 2.4, d + 2.4);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowQuad = new THREE.Mesh(shadowGeo, contactShadowMat);
    shadowQuad.position.y = 0.03;
    group.add(shadowQuad);
    disposables.push(shadowGeo);

    const plinthParts: THREE.BufferGeometry[] = [];
    const wallParts: THREE.BufferGeometry[] = [];
    const roofParts: THREE.BufferGeometry[] = [];
    const gableParts: THREE.BufferGeometry[] = [];
    const trimParts: THREE.BufferGeometry[] = [];
    const interiorParts: THREE.BufferGeometry[] = [];
    const winParts: THREE.BufferGeometry[] = [];
    const chimneyParts: THREE.BufferGeometry[] = [];

    // 1. Fieldstone foundation plinth + perimeter glacial sill boulders (matching large_house2 photo!)
    plinthParts.push(makeBoxPart(w + 0.22, 0.46, d + 0.22, 0, 0.16, 0));
    const frontStoneCount = Math.max(5, Math.floor(w / 1.15));
    for (let i = 0; i <= frontStoneCount; i++) {
      const sx = -w * 0.5 + (i / frontStoneCount) * w;
      for (const sz of [-d * 0.5 - 0.06, d * 0.5 + 0.06]) {
        const sr = 0.2 + (i % 3) * 0.04;
        const sb = new THREE.DodecahedronGeometry(sr, 0);
        sb.scale(1.25, 0.72, 0.95);
        sb.rotateY(i * 1.1);
        sb.translate(sx, 0.12, sz);
        plinthParts.push(prepNonIndexed(sb));
      }
    }
    const sideStoneCount = Math.max(3, Math.floor(d / 1.15));
    for (let i = 1; i < sideStoneCount; i++) {
      const sz = -d * 0.5 + (i / sideStoneCount) * d;
      for (const sx of [-w * 0.5 - 0.06, w * 0.5 + 0.06]) {
        const sr = 0.2 + (i % 2) * 0.05;
        const sb = new THREE.DodecahedronGeometry(sr, 0);
        sb.scale(0.95, 0.72, 1.25);
        sb.rotateY(i * 0.9);
        sb.translate(sx, 0.12, sz);
        plinthParts.push(prepNonIndexed(sb));
      }
    }

    // Floor slab
    interiorParts.push(makeBoxPart(w - 0.2, 0.14, d - 0.2, 0, 0.36, 0));

    // 2. Stacked log walls adjusted by decayState
    const wallThick = 0.28;
    const doorWidth = 1.25;
    const sideSegW = (w - doorWidth) / 2;

    const hBack = decay === 'ruins' ? h * 0.52 : decay === 'roofless' ? h * 0.88 : h;
    const hLeft = decay === 'ruins' ? h * 0.72 : h;
    const hRight = decay === 'ruins' ? h * 0.42 : decay === 'roofless' ? h * 0.84 : h;
    const hFrontL = decay === 'ruins' ? h * 0.62 : h;
    const hFrontR = decay === 'ruins' ? h * 0.55 : h;

    wallParts.push(makeBoxPart(w, hBack, wallThick, 0, 0.4 + hBack / 2, -d / 2 + wallThick / 2));
    wallParts.push(makeBoxPart(wallThick, hLeft, d, -w / 2 + wallThick / 2, 0.4 + hLeft / 2, 0));
    wallParts.push(makeBoxPart(wallThick, hRight, d, w / 2 - wallThick / 2, 0.4 + hRight / 2, 0));
    wallParts.push(
      makeBoxPart(sideSegW, hFrontL, wallThick, -w / 2 + sideSegW / 2, 0.4 + hFrontL / 2, d / 2 - wallThick / 2)
    );
    wallParts.push(
      makeBoxPart(sideSegW, hFrontR, wallThick, w / 2 - sideSegW / 2, 0.4 + hFrontR / 2, d / 2 - wallThick / 2)
    );

    if (decay !== 'ruins') {
      wallParts.push(makeBoxPart(doorWidth, 0.62, wallThick, 0, 0.4 + h - 0.31, d / 2 - wallThick / 2));
    }

    // Interlocking saddle-notched corner log ends (ristpalk!)
    const maxWallH = decay === 'ruins' ? h * 0.55 : h;
    const logCourses = decay === 'ruins' ? 4 : 8;
    for (let c = 0; c < logCourses; c++) {
      const ly = 0.52 + (c / logCourses) * (maxWallH - 0.16);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          wallParts.push(
            makeCylPart(
              0.11,
              0.115,
              0.46,
              7,
              sx * (w / 2 + 0.11),
              ly,
              sz * (d / 2 - wallThick / 2),
              0,
              0,
              Math.PI / 2
            )
          );
          wallParts.push(
            makeCylPart(
              0.11,
              0.115,
              0.46,
              7,
              sx * (w / 2 - wallThick / 2),
              ly + 0.085,
              sz * (d / 2 + 0.11),
              Math.PI / 2,
              0,
              0
            )
          );
        }
      }
    }

    // 3. Deep overhanging heritage Estonian roof & exposed eaves rafters
    const roofOverhang = 0.84;
    const roofH = roofStyle === 'thatch' ? 2.95 : 2.55;
    const slopeRun = d / 2 + roofOverhang;
    const slopeLen = Math.hypot(slopeRun, roofH);
    const slopeAngle = Math.atan2(roofH, slopeRun);
    const roofThick = roofStyle === 'thatch' ? 0.34 : 0.18;

    if (decay === 'intact' || decay === 'sagging') {
      const sagAngle = decay === 'sagging' ? 0.09 : 0;
      const frontRoofW = w + roofOverhang * 1.95;
      roofParts.push(
        makeBoxPart(
          frontRoofW,
          roofThick,
          slopeLen,
          0,
          0.4 + h + roofH / 2 - 0.16,
          slopeRun / 2,
          slopeAngle,
          0,
          sagAngle
        )
      );
      const backW = decay === 'sagging' ? frontRoofW * 0.58 : frontRoofW;
      const backShiftX = decay === 'sagging' ? -frontRoofW * 0.2 : 0;
      roofParts.push(
        makeBoxPart(
          backW,
          roofThick,
          slopeLen,
          backShiftX,
          0.4 + h + roofH / 2 - 0.16,
          -slopeRun / 2,
          -slopeAngle,
          0,
          -sagAngle * 0.8
        )
      );

      // Exposed dark eave rafter tails beneath the deep overhang
      const eaveCount = Math.max(5, Math.floor(w / 1.35));
      for (let i = 0; i < eaveCount; i++) {
        const ex = -w * 0.46 + (i / (eaveCount - 1)) * w * 0.92;
        trimParts.push(
          makeBoxPart(0.11, 0.12, 0.95, ex, 0.4 + h - 0.04, d / 2 + 0.32, 0.24, 0, 0)
        );
        trimParts.push(
          makeBoxPart(0.11, 0.12, 0.95, ex, 0.4 + h - 0.04, -d / 2 - 0.32, -0.24, 0, 0)
        );
      }

      const gableShape = new THREE.Shape();
      gableShape.moveTo(-d / 2, 0);
      gableShape.lineTo(d / 2, 0);
      gableShape.lineTo(0, roofH * 0.88);
      gableShape.closePath();

      const makeGableGeo = (xPos: number) => {
        const geo = new THREE.ExtrudeGeometry(gableShape, { depth: 0.22, bevelEnabled: false });
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) * 0.34, uv.getY(i) * 0.34);
        }
        geo.rotateY(Math.PI / 2);
        geo.translate(xPos, 0.4 + h, 0);
        return prepNonIndexed(geo);
      };
      gableParts.push(makeGableGeo(-w / 2));
      if (decay === 'intact') {
        gableParts.push(makeGableGeo(w / 2 - 0.22));
      }

      if (roofStyle === 'thatch') {
        // Crossed ridge saddle poles (harimalgad) & reed hold-down poles matching large_house.jpg!
        const poleCount = Math.max(6, Math.floor(w / 0.85));
        const nx = Math.sin(slopeAngle) * 0.22;
        const ny = Math.cos(slopeAngle) * 0.22;
        for (let i = 0; i < poleCount; i++) {
          if (decay === 'sagging' && i > poleCount * 0.6) continue;
          const px = -w * 0.46 + (i / (poleCount - 1)) * w * 0.92;
          // Full slope wind-poles crossing slightly above the ridge
          trimParts.push(
            makeCylPart(
              0.036,
              0.048,
              slopeLen + 0.62,
              5,
              px - 0.045,
              0.4 + h + roofH * 0.56 + ny,
              slopeRun * 0.44 + nx,
              Math.PI * 0.5 + slopeAngle,
              0,
              0
            )
          );
          trimParts.push(
            makeCylPart(
              0.036,
              0.048,
              slopeLen + 0.62,
              5,
              px + 0.045,
              0.4 + h + roofH * 0.56 + ny,
              -(slopeRun * 0.44 + nx),
              Math.PI * 0.5 - slopeAngle,
              0,
              0
            )
          );
        }
        // Horizontal ridge weight pole
        trimParts.push(
          makeCylPart(0.06, 0.06, frontRoofW * 0.94, 6, 0, 0.4 + h + roofH + 0.06, 0, 0, 0, Math.PI / 2)
        );
      } else if (decay === 'intact') {
        chimneyParts.push(makeBoxPart(0.72, 1.55, 0.72, -w * 0.22, 0.4 + h + roofH - 0.16, -0.35));
        // Brick chimney cap rim
        trimParts.push(makeBoxPart(0.84, 0.14, 0.84, -w * 0.22, 0.4 + h + roofH + 0.62, -0.35));
      }
    } else if (decay === 'roofless') {
      trimParts.push(makeCylPart(0.08, 0.09, w * 0.86, 5, -w * 0.04, 0.4 + h + 0.04, 0, 0, 0, Math.PI / 2 + 0.04));
      const rafterCount = 4;
      for (let i = 0; i < rafterCount; i++) {
        const rxPos = -w * 0.35 + (i / (rafterCount - 1)) * w * 0.7;
        trimParts.push(
          makeCylPart(
            0.055,
            0.065,
            slopeLen * (0.45 + (i % 2) * 0.25),
            5,
            rxPos,
            0.4 + h + 0.55,
            d * 0.26,
            Math.PI * 0.5 + slopeAngle - (i % 2) * 0.14,
            0,
            0.08 * (i % 2 ? 1 : -1)
          )
        );
        if (i !== 2) {
          trimParts.push(
            makeCylPart(
              0.055,
              0.065,
              slopeLen * 0.52,
              5,
              rxPos,
              0.4 + h + 0.5,
              -d * 0.26,
              Math.PI * 0.5 - slopeAngle,
              0,
              -0.06
            )
          );
        }
      }
      trimParts.push(makeCylPart(0.08, 0.095, w * 0.75, 5, 0.15, 0.62, -0.35, 0.18, 0.42, Math.PI / 2 - 0.14));
    } else if (decay === 'ruins') {
      trimParts.push(makeCylPart(0.09, 0.1, w * 0.72, 5, -0.2, 0.58, 0.2, 0.1, -0.35, Math.PI / 2 - 0.08));
      trimParts.push(makeCylPart(0.08, 0.09, d * 0.85, 5, 0.65, 0.64, -0.1, Math.PI / 2 - 0.12, 0.4, 0));
    }

    // Timber door jamb & deeply recessed heritage mullioned windows
    if (decay !== 'ruins') {
      const doorFz = d / 2 - wallThick / 2 + 0.04;
      trimParts.push(makeBoxPart(0.11, h - 0.65, 0.32, -doorWidth / 2 - 0.05, 0.4 + (h - 0.65) / 2, doorFz));
      trimParts.push(makeBoxPart(0.11, h - 0.65, 0.32, doorWidth / 2 + 0.05, 0.4 + (h - 0.65) / 2, doorFz));
      trimParts.push(makeBoxPart(doorWidth + 0.22, 0.11, 0.32, 0, 0.4 + h - 0.66, doorFz));

      for (const wx of [-w * 0.28, w * 0.28]) {
        const wy = 0.4 + 1.42;
        const wz = d / 2 - wallThick / 2;
        winParts.push(makeBoxPart(0.86, 0.86, 0.24, wx, wy, wz - 0.02));
        trimParts.push(makeBoxPart(1.04, 0.09, 0.36, wx, wy + 0.45, wz + 0.02));
        trimParts.push(makeBoxPart(1.08, 0.1, 0.4, wx, wy - 0.45, wz + 0.04)); // sloped windowsill
        trimParts.push(makeBoxPart(0.09, 0.9, 0.36, wx - 0.46, wy, wz + 0.02));
        trimParts.push(makeBoxPart(0.09, 0.9, 0.36, wx + 0.46, wy, wz + 0.02));
        trimParts.push(makeBoxPart(0.05, 0.86, 0.32, wx, wy, wz + 0.02));
        trimParts.push(makeBoxPart(0.86, 0.05, 0.32, wx, wy, wz + 0.02));
      }

      if (opts.porch) {
        trimParts.push(makeBoxPart(w * 0.68, 0.16, 1.2, 0, 0.32, d / 2 + 0.58));
        trimParts.push(makeBoxPart(1.9, 0.1, 0.38, -w * 0.16, 0.72, d / 2 + 0.54));
        trimParts.push(makeBoxPart(1.18, 0.12, 0.32, 0, 0.16, d / 2 + 1.15));
      }

      interiorParts.push(makeBoxPart(1.4, 0.76, 0.82, 0, 0.4 + 0.38, -0.5));
    }

    addBatchedMesh(group, plinthParts, stonePlinthMat, shadows);
    addBatchedMesh(group, wallParts, wallMat, shadows, { baseY: 0.4, topY: 0.4 + h });
    addBatchedMesh(group, roofParts, roofStyle === 'thatch' ? thatchMat : shingleMat, shadows);
    addBatchedMesh(group, gableParts, gableMat, shadows);
    addBatchedMesh(group, trimParts, timberTrimMat, shadows);
    addBatchedMesh(group, interiorParts, darkInteriorMat, false);
    addBatchedMesh(group, winParts, abandoned ? darkWinMat : activeWinMat, false);
    addBatchedMesh(group, chimneyParts, chimneyWhiteMat, shadows);

    // Interactive door
    let doorCollider: BoxCollider | null = null;
    if (decay !== 'ruins') {
      const doorPivot = new THREE.Group();
      doorPivot.position.set(-doorWidth / 2, 0.4, d / 2 - wallThick / 2);
      const doorMat = new THREE.MeshStandardMaterial({
        map: textures.plankWood,
        normalMap: textures.plankNormal,
        normalScale: new THREE.Vector2(0.9, 0.9),
        color: abandoned ? 0x544c42 : 0x6f5438,
        roughness: 0.9,
        metalness: 0.0,
        envMapIntensity: 0.45,
      });
      disposables.push(doorMat);
      const doorMesh = new THREE.Mesh(
        new THREE.BoxGeometry(doorWidth - 0.04, h - 0.72, 0.1),
        doorMat
      );
      doorMesh.position.set(doorWidth / 2, (h - 0.72) / 2, 0);
      doorMesh.castShadow = shadows;
      doorMesh.receiveShadow = true;
      doorPivot.add(doorMesh);
      group.add(doorPivot);

      let doorOpen = abandoned && rand() > 0.3;
      doorPivot.rotation.y = doorOpen ? -Math.PI * 0.58 : 0;

      const c = Math.cos(rotY);
      const s = Math.sin(rotY);
      const lx = 0;
      const lz = d / 2 - wallThick / 2;
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      const ww = Math.abs(doorWidth * c) + Math.abs(wallThick * s);
      const wd = Math.abs(doorWidth * s) + Math.abs(wallThick * c);
      doorCollider = addBoxCollider(wx, wz, ww, wd, y, h, false);
      doorCollider.active = !doorOpen;

      registerInteractive(doorMesh, {
        name: abandoned ? 'Old Cabin Door' : `${name} Door`,
        desc: abandoned
          ? 'Warped timber creaks on rusted hinges.'
          : 'Heavy split-pine door smelling of woodsmoke.',
        onUse: () => {
          doorOpen = !doorOpen;
          if (doorCollider) doorCollider.active = !doorOpen;
          doorPivot.rotation.y = doorOpen ? -Math.PI * 0.58 : 0;
          sound.playImpact(0.7);
          showToast(doorOpen ? 'Door opened.' : 'Door closed.');
        },
        onTouch: () =>
          showToast(
            abandoned
              ? 'The weathered wood is damp and splintering.'
              : 'Solid hand-planed Estonian pine.'
          ),
      });
    }

    function addLocalWallCollider(lx: number, lz: number, lw: number, ld: number): void {
      const c = Math.cos(rotY);
      const s = Math.sin(rotY);
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      const ww = Math.abs(lw * c) + Math.abs(ld * s);
      const wd = Math.abs(lw * s) + Math.abs(ld * c);
      addBoxCollider(wx, wz, ww, wd, y, h + 0.5, false);
    }

    addLocalWallCollider(0, -d / 2 + wallThick / 2, w, wallThick);
    addLocalWallCollider(-w / 2 + wallThick / 2, 0, wallThick, d);
    addLocalWallCollider(w / 2 - wallThick / 2, 0, wallThick, d);
    addLocalWallCollider(-w / 2 + sideSegW / 2, d / 2 - wallThick / 2, sideSegW, wallThick);
    addLocalWallCollider(w / 2 - sideSegW / 2, d / 2 - wallThick / 2, sideSegW, wallThick);
  }

  // Split-Pole Slanted Estonian Fence (roigasaed — SOLID horizontal collision, JUMPABLE over 0.92m!)
  function buildSplitPoleFence(x0: number, z0: number, x1: number, z1: number): void {
    const parts: THREE.BufferGeometry[] = [];
    const totalLen = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / totalLen;
    const dz = (z1 - z0) / totalLen;
    const yaw = Math.atan2(dx, dz);
    const bays = Math.max(2, Math.floor(totalLen / 1.9));

    for (let i = 0; i <= bays; i++) {
      const px = x0 + dx * (i / bays) * totalLen;
      const pz = z0 + dz * (i / bays) * totalLen;
      const py = getTerrainHeight(px, pz);
      for (const side of [-0.07, 0.07]) {
        const sx = px - dz * side;
        const sz = pz + dx * side;
        parts.push(makeCylPart(0.036, 0.044, 1.18, 5, sx, py + 0.54, sz, 0, 0, 0));
      }
      if (i < bays) {
        const nx = x0 + dx * ((i + 0.5) / bays) * totalLen;
        const nz = z0 + dz * ((i + 0.5) / bays) * totalLen;
        const ny = getTerrainHeight(nx, nz);
        for (let r = 0; r < 3; r++) {
          const g = new THREE.CylinderGeometry(0.025, 0.032, 2.45, 5, 1);
          g.rotateX(Math.PI * 0.5 - 0.22);
          g.rotateY(yaw);
          g.translate(nx, ny + 0.32 + r * 0.25, nz);
          parts.push(prepNonIndexed(g));
        }

        const segLen = totalLen / bays;
        const bw = Math.abs(dx * segLen) + Math.abs(dz * 0.34);
        const bd = Math.abs(dz * segLen) + Math.abs(dx * 0.34);
        addBoxCollider(nx, nz, bw, bd, ny, 0.92, true);
      }
    }

    const fenceGeo = mergeGeometries(parts)!;
    const fenceMesh = new THREE.Mesh(fenceGeo, timberTrimMat);
    fenceMesh.castShadow = shadows;
    fenceMesh.receiveShadow = true;
    scene.add(fenceMesh);
    structureNodes.push({
      obj: fenceMesh,
      x: (x0 + x1) * 0.5,
      z: (z0 + z1) * 0.5,
      maxDistSq: 220 * 220,
    });
    disposables.push(fenceGeo);
  }

  // Build all 4 Procedural Villages
  for (let vi = 0; vi < bp.villages.length; vi++) {
    const v = bp.villages[vi];
    for (const b of v.buildings) {
      buildEstonianLogHouse(v.x + b.offsetX, v.z + b.offsetZ, b.rotY, {
        w: b.w,
        d: b.d,
        h: b.h,
        roofStyle: b.roofStyle,
        warmWood: b.warmWood,
        porch: b.porch,
        abandoned: b.abandoned,
        decayState: b.decayState,
        name: b.name,
      });
    }
    for (const f of v.fences) {
      buildSplitPoleFence(f.x0, f.z0, f.x1, f.z1);
    }

    if (vi === 0 || vi === 2) {
      const wx = v.x - 4.5;
      const wz = v.z + 9.5;
      const wy = getTerrainHeight(wx, wz);
      const wellGroup = new THREE.Group();
      wellGroup.position.set(wx, wy, wz);

      const wellShadowGeo = new THREE.PlaneGeometry(3.2, 3.2);
      wellShadowGeo.rotateX(-Math.PI / 2);
      const wellShadow = new THREE.Mesh(wellShadowGeo, contactShadowMat);
      wellShadow.position.y = 0.03;
      wellGroup.add(wellShadow);
      disposables.push(wellShadowGeo);

      const stoneCyl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 1.05, 1.0, 12),
        stonePlinthMat
      );
      stoneCyl.position.y = 0.5;
      stoneCyl.castShadow = shadows;
      stoneCyl.receiveShadow = true;
      wellGroup.add(stoneCyl);

      [-0.85, 0.85].forEach((px) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.0, 0.14), timberTrimMat);
        post.position.set(px, 1.5, 0);
        post.castShadow = shadows;
        wellGroup.add(post);
      });
      const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(1.42, 0.96, 4), shingleMat);
      wellRoof.position.y = 2.85;
      wellRoof.rotation.y = Math.PI / 4;
      wellRoof.castShadow = shadows;
      wellGroup.add(wellRoof);
      scene.add(wellGroup);
      structureNodes.push({ obj: wellGroup, x: wx, z: wz, maxDistSq: 220 * 220 });
      circleColliders.push({ x: wx, z: wz, r: 1.1 });

      registerInteractive(stoneCyl, {
        name: `${v.name} Water Well (Kaev)`,
        desc: 'Cold groundwater glimmers deep below.',
        onUse: () => {
          sound.playFootstep('water');
          showToast('You draw a splash of icy Estonian spring water.');
        },
        onTouch: () => showToast('Cool, moss-covered granite fieldstones.'),
      });
    }
  }

  // Build Abandoned Decay Huts on Elevated Swamp Islands
  for (const isl of bp.swampIslands) {
    if (!isl.hut) continue;
    buildEstonianLogHouse(isl.x, isl.z, isl.hut.rotY, {
      w: isl.hut.w,
      d: isl.hut.d,
      h: isl.hut.h,
      roofStyle: isl.hut.roofStyle,
      abandoned: true,
      decayState: isl.hut.decayState,
      porch: isl.hut.decayState === 'intact',
      name: `${isl.name} — ${isl.hut.name}`,
    });
  }

  // Interactive Campfire Pit near starting homestead Vana-Kase
  let fireLit = true;
  const fireLight = new THREE.PointLight(0xff7d2b, 2.8, 22, 1.6);
  const fireFlames = new THREE.Mesh(
    new THREE.ConeGeometry(0.32, 0.82, 7),
    new THREE.MeshBasicMaterial({ color: 0xff8c24 })
  );
  {
    const v0 = bp.villages[0];
    const fx = v0.x + 1.5;
    const fz = v0.z + 10.5;
    const fy = getTerrainHeight(fx, fz);
    const pit = new THREE.Group();
    pit.position.set(fx, fy, fz);
    const stoneParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const sg = new THREE.DodecahedronGeometry(0.22, 0);
      sg.translate(Math.cos(a) * 0.72, 0.12, Math.sin(a) * 0.72);
      stoneParts.push(prepNonIndexed(sg));
    }
    const ringMesh = new THREE.Mesh(mergeGeometries(stoneParts)!, stonePlinthMat);
    ringMesh.castShadow = shadows;
    pit.add(ringMesh);

    const logs = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.9, 6),
      new THREE.MeshStandardMaterial({ color: 0x261a12, roughness: 0.95 })
    );
    logs.rotation.z = Math.PI / 2;
    logs.position.y = 0.14;
    pit.add(logs);
    fireFlames.position.y = 0.45;
    pit.add(fireFlames);
    fireLight.position.y = 0.8;
    pit.add(fireLight);
    scene.add(pit);

    registerInteractive(logs, {
      name: 'Campfire (Lõke)',
      desc: 'Crackling alder logs.',
      onUse: () => {
        fireLit = !fireLit;
        fireFlames.visible = fireLit;
        fireLight.intensity = fireLit ? 2.8 : 0;
        sound.playImpact(0.5);
        showToast(fireLit ? 'You stoke the campfire back to life.' : 'You bank the embers.');
      },
      onTouch: () =>
        showToast(fireLit ? 'Warmth radiates from the birch embers!' : 'Cold ash and charred wood.'),
    });
  }

  // Procedural Signposts
  function createSignpost(x: number, z: number, rotY: number, title: string, message: string): void {
    const y = getTerrainHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.8, 0.14), timberTrimMat);
    post.position.y = 0.9;
    post.castShadow = shadows;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.44, 0.08), timberTrimMat);
    board.position.y = 1.55;
    board.castShadow = shadows;
    g.add(post, board);
    scene.add(g);
    circleColliders.push({ x, z, r: 0.22 });

    registerInteractive(board, {
      name: title,
      desc: 'Weathered wooden trail marker.',
      onUse: () => showToast(message),
      onTouch: () => showToast(message),
    });
  }

  createSignpost(
    -3.8,
    -5.5,
    0.3,
    'Signpost (Teeviit)',
    `↑ ${bp.villages[0].name} · → Kõrgesoo Raba & Swamp Islands · 4 Villages across Metsavaikus`
  );

  // ============================================================================
  // Extended Twin-Plank Swamp Boardwalk Linking Bog Trailhead -> Swamp Islands
  // ============================================================================
  {
    const trailStart = {
      x: bp.bogCenterX - bp.bogRadius * 0.72,
      z: bp.bogCenterZ - bp.bogRadius * 0.44,
    };
    createSignpost(
      trailStart.x - 2.5,
      trailStart.z - 2.0,
      -0.7,
      'Bog Trailhead (Rabarada)',
      '"KÕRGESOO RABA — Keep to the wooden boardwalk (laudtee) to reach the bog islands."'
    );

    const plankMat = new THREE.MeshStandardMaterial({
      map: textures.plankWood,
      normalMap: textures.plankNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      color: 0xb2aa9c,
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.5,
    });
    const sleeperMat = new THREE.MeshStandardMaterial({
      map: textures.plankWood,
      normalMap: textures.plankNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: 0x72695c,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.42,
    });

    interface BoardwalkSeg {
      px: number;
      pz: number;
      angle: number;
      deckY: number;
      segLen: number;
    }
    const allSegs: BoardwalkSeg[] = [];

    function appendBoardwalkPath(ax: number, az: number, bx: number, bz: number): void {
      const dxTotal = bx - ax;
      const dzTotal = bz - az;
      const totalLen = Math.hypot(dxTotal, dzTotal);
      if (totalLen < 2) return;
      const steps = Math.max(4, Math.round(totalLen / 1.85));
      const segLen = totalLen / steps + 0.06;

      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const sway = Math.sin(t * Math.PI * 1.4) * Math.min(2.8, totalLen * 0.04);
        const px = ax + dxTotal * t - (dzTotal / totalLen) * sway;
        const pz = az + dzTotal * t + (dxTotal / totalLen) * sway;

        const tNext = Math.min(1, (i + 1.5) / steps);
        const swayNext = Math.sin(tNext * Math.PI * 1.4) * Math.min(2.8, totalLen * 0.04);
        const nx = ax + dxTotal * tNext - (dzTotal / totalLen) * swayNext;
        const nz = az + dzTotal * tNext + (dxTotal / totalLen) * swayNext;

        const angle = Math.atan2(nx - px, nz - pz);
        const groundY = getTerrainHeight(px, pz);
        const deckY = Math.max(SWAMP_WATER_Y + 0.32, groundY + 0.16);
        allSegs.push({ px, pz, angle, deckY, segLen });

        boardwalkZones.push({
          minX: px - 0.95,
          maxX: px + 0.95,
          minZ: pz - 0.95,
          maxZ: pz + 0.95,
          y: deckY + 0.04,
        });
      }
    }

    const linkedIslands = bp.swampIslands.filter((isl) => isl.linkedByBoardwalk);
    let curX = trailStart.x;
    let curZ = trailStart.z;
    for (const isl of linkedIslands) {
      const dirX = isl.x - curX;
      const dirZ = isl.z - curZ;
      const dist = Math.hypot(dirX, dirZ);
      const stopR = Math.max(4, isl.radius * 0.62);
      const tx = dist > stopR ? isl.x - (dirX / dist) * stopR : isl.x;
      const tz = dist > stopR ? isl.z - (dirZ / dist) * stopR : isl.z;
      appendBoardwalkPath(curX, curZ, tx, tz);
      curX = tx;
      curZ = tz;
    }

    if (allSegs.length > 0) {
      const avgLen = allSegs[0].segLen;
      const twinPlankGeo = mergeGeometries([
        makeBoxPart(0.46, 0.07, avgLen + 0.25, -0.26, 0, 0),
        makeBoxPart(0.46, 0.07, avgLen + 0.25, 0.26, 0, 0),
      ])!;
      const sleeperGeo = new THREE.BoxGeometry(1.55, 0.09, 0.16);
      const plankInst = new THREE.InstancedMesh(twinPlankGeo, plankMat, allSegs.length);
      const sleeperInst = new THREE.InstancedMesh(sleeperGeo, sleeperMat, allSegs.length);
      plankInst.receiveShadow = true;
      plankInst.castShadow = shadows;
      sleeperInst.receiveShadow = true;

      const dummy = new THREE.Object3D();
      for (let i = 0; i < allSegs.length; i++) {
        const s = allSegs[i];
        dummy.position.set(s.px, s.deckY, s.pz);
        dummy.rotation.set(0, s.angle, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        plankInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(s.px, s.deckY - 0.075, s.pz);
        dummy.updateMatrix();
        sleeperInst.setMatrixAt(i, dummy.matrix);
      }
      plankInst.instanceMatrix.needsUpdate = true;
      sleeperInst.instanceMatrix.needsUpdate = true;
      scene.add(plankInst, sleeperInst);
      disposables.push(twinPlankGeo, sleeperGeo, plankMat, sleeperMat);
    }
  }

  // ============================================================================
  // Dynamic Physics Props + Matte-Black Storm Lanterns
  // ============================================================================
  const crateMat = new THREE.MeshStandardMaterial({
    map: textures.plankWood,
    normalMap: textures.plankNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    color: 0x856a49,
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.48,
  });
  const barrelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.95, 14);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x5c372a, roughness: 0.58, metalness: 0.45 });
  const logGeo = new THREE.CylinderGeometry(0.11, 0.12, 0.65, 8);
  const logMat = new THREE.MeshStandardMaterial({
    map: textures.birchBark,
    normalMap: textures.birchNormal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.88,
    metalness: 0.0,
  });
  const stonePropMat = new THREE.MeshStandardMaterial({
    map: textures.boulderGranite,
    normalMap: textures.fieldstoneNormal,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughness: 0.86,
    metalness: 0.02,
  });
  const lanternMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1a1c1e,
    metalness: 0.78,
    roughness: 0.38,
    envMapIntensity: 1.1,
  });
  const lanternGlassMat = new THREE.MeshStandardMaterial({
    color: 0xdce4e6,
    roughness: 0.08,
    metalness: 0.12,
    envMapIntensity: 1.4,
    transparent: true,
    opacity: 0.45,
  });
  disposables.push(
    crateMat,
    barrelGeo,
    barrelMat,
    logGeo,
    logMat,
    stonePropMat,
    lanternMetalMat,
    lanternGlassMat
  );

  const lanternMetalGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(makeCylPart(0.115, 0.135, 0.075, 14, 0, -0.145, 0));
    parts.push(makeCylPart(0.08, 0.115, 0.035, 14, 0, -0.09, 0));
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.11, -0.1, 0),
        new THREE.Vector3(side * 0.14, 0.02, 0),
        new THREE.Vector3(side * 0.11, 0.15, 0),
        new THREE.Vector3(side * 0.045, 0.19, 0),
      ]);
      parts.push(prepNonIndexed(new THREE.TubeGeometry(curve, 8, 0.012, 5, false)));
    }
    const wireRing1 = new THREE.TorusGeometry(0.095, 0.004, 4, 14);
    wireRing1.rotateX(Math.PI / 2);
    wireRing1.translate(0, 0.02, 0);
    parts.push(prepNonIndexed(wireRing1));
    parts.push(makeCylPart(0.06, 0.085, 0.055, 12, 0, 0.145, 0));
    parts.push(makeCylPart(0.045, 0.065, 0.04, 12, 0, 0.185, 0));
    parts.push(makeCylPart(0.09, 0.09, 0.012, 12, 0, 0.21, 0));
    const bailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.125, 0.06, 0),
      new THREE.Vector3(-0.12, 0.29, 0),
      new THREE.Vector3(0, 0.36, 0),
      new THREE.Vector3(0.12, 0.29, 0),
      new THREE.Vector3(0.125, 0.06, 0),
    ]);
    parts.push(prepNonIndexed(new THREE.TubeGeometry(bailCurve, 12, 0.005, 4, false)));
    return mergeGeometries(parts)!;
  })();
  const lanternGlobeGeo = new THREE.CylinderGeometry(0.072, 0.086, 0.17, 12);
  const lanternFlameGeo = new THREE.ConeGeometry(0.024, 0.065, 6);
  disposables.push(lanternMetalGeo, lanternGlobeGeo, lanternFlameGeo);

  function spawnCrate(x: number, z: number, size = 0.72): void {
    const y = getTerrainHeight(x, z) + size / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), crateMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    registerInteractive(mesh, {
      name: 'Wooden Crate',
      desc: 'Heavy weathered shipping crate.',
      carryable: true,
      kickable: true,
      isDynamic: true,
      radius: size * 0.55,
      mass: 1.8,
      onGroundYOffset: size * 0.5,
    });
  }

  function spawnBarrel(x: number, z: number): void {
    const y = getTerrainHeight(x, z) + 0.95 / 2;
    const mesh = new THREE.Mesh(barrelGeo, barrelMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    registerInteractive(mesh, {
      name: 'Rusted Oil Drum',
      desc: 'Empty weathered metal barrel.',
      carryable: false,
      kickable: true,
      isDynamic: true,
      radius: 0.42,
      mass: 2.5,
      onGroundYOffset: 0.95 / 2,
    });
  }

  function spawnLantern(x: number, z: number, initiallyLit = true): void {
    const y = getTerrainHeight(x, z) + 0.19;
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const chassis = new THREE.Mesh(lanternMetalGeo, lanternMetalMat);
    chassis.castShadow = shadows;
    const globe = new THREE.Mesh(lanternGlobeGeo, lanternGlassMat);
    globe.position.y = 0.02;

    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffba49 });
    disposables.push(flameMat);
    const flame = new THREE.Mesh(lanternFlameGeo, flameMat);
    flame.position.y = -0.02;
    flame.visible = initiallyLit;

    const pt = new THREE.PointLight(0xffaa44, initiallyLit ? 1.85 : 0, 16, 1.5);
    pt.position.y = 0.04;
    group.add(chassis, globe, flame, pt);
    scene.add(group);

    let lit = initiallyLit;
    registerInteractive(group, {
      name: 'Storm Lantern (Tormilatern)',
      desc: 'Matte-black hurricane kerosene lantern glowing against the mist.',
      carryable: true,
      kickable: true,
      isDynamic: true,
      radius: 0.22,
      mass: 0.7,
      onGroundYOffset: 0.18,
      onTouch: () => {
        lit = !lit;
        pt.intensity = lit ? 1.85 : 0;
        flame.visible = lit;
        showToast(lit ? 'Lantern lit.' : 'Lantern dimmed.');
      },
    });
  }

  function spawnFirewoodLog(x: number, z: number): void {
    const y = getTerrainHeight(x, z) + 0.12;
    const mesh = new THREE.Mesh(logGeo, logMat);
    mesh.rotation.z = Math.PI / 2;
    mesh.rotation.y = rand() * Math.PI;
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    registerInteractive(mesh, {
      name: 'Birch Firewood (Kasehalg)',
      desc: 'Split birch log ready for the stove.',
      carryable: true,
      kickable: true,
      isDynamic: true,
      radius: 0.2,
      mass: 0.9,
      onGroundYOffset: 0.12,
    });
  }

  function spawnStone(x: number, z: number): void {
    const r = 0.18 + rand() * 0.12;
    const y = getTerrainHeight(x, z) + r;
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stonePropMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    registerInteractive(mesh, {
      name: 'Glacial Fieldstone (Raie-kivi)',
      desc: 'Smooth granite left by Ice Age glaciers.',
      carryable: true,
      kickable: true,
      isDynamic: true,
      radius: r,
      mass: 1.2,
      onGroundYOffset: r,
    });
  }

  for (let vi = 0; vi < bp.villages.length; vi++) {
    const v = bp.villages[vi];
    spawnLantern(v.x + 1.8, v.z + 11.2, !v.abandoned);
    spawnCrate(v.x - 1.2, v.z + 5.2);
    spawnCrate(v.x - 2.0, v.z + 5.6, 0.58);
    spawnBarrel(v.x - 6.2, v.z + 4.8);
    for (let k = 0; k < 3; k++) {
      spawnFirewoodLog(v.x + 3.2 + (rand() - 0.5) * 1.4, v.z + 7.2 + (rand() - 0.5) * 1.4);
    }
  }
  for (const isl of bp.swampIslands) {
    if (isl.hut) {
      spawnCrate(isl.x + 3.4, isl.z + 1.8, 0.58);
      if (isl.hut.decayState !== 'ruins') {
        spawnLantern(isl.x - 2.8, isl.z + 2.2, false);
      }
    }
  }
  for (let i = 0; i < 42; i++) {
    const sx = (rand() - 0.5) * 900;
    const sz = (rand() - 0.5) * 900;
    if (getSwampFactor(sx, sz) < 0.3 && distToRoadDetail(sx, sz).dist > 3.5) {
      spawnStone(sx, sz);
    }
  }

  // ============================================================================
  // Photorealistic Gatherable Estonian Mushrooms — All 7 Species!
  // Hero botanical craftsmanship on Punane kärbseseen & Valge kärbseseen
  // ============================================================================
  const chanterelleMat = new THREE.MeshStandardMaterial({
    map: textures.chanterelleTex,
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.0,
    envMapIntensity: 0.72,
  });
  const saffronCapMat = new THREE.MeshStandardMaterial({
    map: textures.saffronCapTex,
    roughness: 0.34,
    metalness: 0.0,
    envMapIntensity: 0.78,
  });
  const porciniCapMat = new THREE.MeshStandardMaterial({
    map: textures.boleteCap,
    normalMap: textures.boleteNormal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    color: 0xd4966c,
    roughness: 0.3,
    metalness: 0.0,
    envMapIntensity: 0.85,
  });
  const porciniStemMat = new THREE.MeshStandardMaterial({
    map: textures.boleteStem,
    roughness: 0.74,
    metalness: 0.0,
    envMapIntensity: 0.5,
  });
  const birchBoleteCapMat = new THREE.MeshStandardMaterial({
    map: textures.boleteCap,
    normalMap: textures.boleteNormal,
    normalScale: new THREE.Vector2(0.65, 0.65),
    color: 0xbda38a,
    roughness: 0.36,
    metalness: 0.0,
    envMapIntensity: 0.75,
  });
  const birchBoleteStemMat = new THREE.MeshStandardMaterial({
    map: textures.birchBoleteStem,
    roughness: 0.78,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });
  const boletePoreMat = new THREE.MeshStandardMaterial({
    color: 0xdccda4,
    roughness: 0.88,
    metalness: 0.0,
  });
  const bitterCapMat = new THREE.MeshStandardMaterial({
    map: textures.boleteCap,
    normalMap: textures.boleteNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    color: 0x9c8260,
    roughness: 0.38,
    metalness: 0.0,
  });
  const bitterPoreMat = new THREE.MeshStandardMaterial({
    color: 0xdca0a4,
    roughness: 0.84,
    metalness: 0.0,
  });

  // Hero Species: Punane kärbseseen (Amanita muscaria) — glossy wet scarlet-orange cuticle + sculpted warts
  const flyAgaricCapMat = new THREE.MeshStandardMaterial({
    map: textures.flyAgaricCap,
    normalMap: textures.flyAgaricNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.24,
    metalness: 0.02,
    envMapIntensity: 1.0,
  });
  // Hero Species: Valge kärbseseen (Amanita virosa / Destroying Angel) — porcelain-ivory silky sheen
  const destroyingAngelCapMat = new THREE.MeshStandardMaterial({
    map: textures.destroyingAngelCap,
    roughness: 0.22,
    metalness: 0.02,
    envMapIntensity: 0.95,
  });
  const amanitaGillsMat = new THREE.MeshStandardMaterial({
    map: textures.amanitaGills,
    roughness: 0.72,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const amanitaStemMat = new THREE.MeshStandardMaterial({
    color: 0xf6f3ea,
    roughness: 0.68,
    metalness: 0.0,
    envMapIntensity: 0.55,
  });
  const amanitaWartMat = new THREE.MeshStandardMaterial({
    color: 0xf2ead6,
    roughness: 0.82,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });

  const mushShadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadowTex,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const hitProxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitProxyGeo = new THREE.SphereGeometry(0.32, 6, 6);
  const mushShadowGeo = new THREE.PlaneGeometry(0.46, 0.46);
  mushShadowGeo.rotateX(-Math.PI / 2);
  mushShadowGeo.translate(0, 0.012, 0);

  disposables.push(
    chanterelleMat,
    saffronCapMat,
    porciniCapMat,
    porciniStemMat,
    birchBoleteCapMat,
    birchBoleteStemMat,
    boletePoreMat,
    bitterCapMat,
    bitterPoreMat,
    flyAgaricCapMat,
    destroyingAngelCapMat,
    amanitaGillsMat,
    amanitaStemMat,
    amanitaWartMat,
    mushShadowMat,
    hitProxyMat,
    hitProxyGeo,
    mushShadowGeo
  );

  // Ruffled golden Chanterelle funnel
  const chanterelleBodyGeo = (() => {
    const funnelPts = [
      new THREE.Vector2(0.0, 0.02),
      new THREE.Vector2(0.017, 0.0),
      new THREE.Vector2(0.023, 0.058),
      new THREE.Vector2(0.056, 0.115),
      new THREE.Vector2(0.098, 0.142),
      new THREE.Vector2(0.082, 0.148),
      new THREE.Vector2(0.032, 0.12),
      new THREE.Vector2(0.0, 0.106),
    ];
    const g = prepNonIndexed(new THREE.LatheGeometry(funnelPts, 16));
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const stemCol = new THREE.Color(0xf4d478);
    const rimCol = new THREE.Color(0xee9c1a);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const r = Math.hypot(px, pz);
      if (r > 0.038 && py > 0.095) {
        const ang = Math.atan2(pz, px);
        const wave = Math.sin(ang * 5.0) * 0.018 + Math.cos(ang * 3.0) * 0.01;
        pos.setY(i, py + wave * (r / 0.098));
      }
      const t = clamp((py - 0.015) / 0.13, 0, 1);
      cols[i * 3] = stemCol.r + (rimCol.r - stemCol.r) * t;
      cols[i * 3 + 1] = stemCol.g + (rimCol.g - stemCol.g) * t;
      cols[i * 3 + 2] = stemCol.b + (rimCol.b - stemCol.b) * t;
    }
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  })();

  // Kuuseriisikas (Saffron Milk Cap) concentric saucer cap with planar top UV
  const saffronBodyGeo = (() => {
    const pts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.024, 0.0),
      new THREE.Vector2(0.026, 0.092),
      new THREE.Vector2(0.114, 0.104),
      new THREE.Vector2(0.128, 0.126),
      new THREE.Vector2(0.064, 0.132),
      new THREE.Vector2(0.0, 0.114),
    ];
    const g = prepNonIndexed(new THREE.LatheGeometry(pts, 16));
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = clamp(pos.getX(i) / 0.26 + 0.5, 0, 1);
      uvs[i * 2 + 1] = clamp(pos.getZ(i) / 0.26 + 0.5, 0, 1);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return g;
  })();

  // Kivipuravik (Boletus edulis) plump club stem + thick domed cap + pale olive spongy pores
  const porciniStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.056, 0.0),
      new THREE.Vector2(0.078, 0.055),
      new THREE.Vector2(0.06, 0.118),
      new THREE.Vector2(0.046, 0.158),
      new THREE.Vector2(0.0, 0.158),
    ],
    16
  );
  const porciniCapGeo = (() => {
    const g = new THREE.SphereGeometry(0.138, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
    g.scale(1.0, 0.78, 1.0);
    g.translate(0, 0.136, 0);
    return g;
  })();
  const porciniPoreGeo = (() => {
    const g = new THREE.SphereGeometry(0.132, 16, 6, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48);
    g.scale(1.0, 0.18, 1.0);
    g.translate(0, 0.136, 0);
    return g;
  })();

  const birchBoleteStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.038, 0.0),
      new THREE.Vector2(0.032, 0.09),
      new THREE.Vector2(0.024, 0.185),
      new THREE.Vector2(0.0, 0.185),
    ],
    14
  );
  const birchBoleteCapGeo = (() => {
    const g = new THREE.SphereGeometry(0.108, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58);
    g.scale(1.0, 0.82, 1.0);
    g.translate(0, 0.165, 0);
    return g;
  })();
  const birchBoletePoreGeo = (() => {
    const g = new THREE.CircleGeometry(0.104, 14);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.164, 0);
    return g;
  })();

  // ---- HERO 1: Punane kärbseseen (Amanita muscaria) ----
  // Concentric scaly bulbous volva + sturdy white stipe + drooping striated skirt annulus
  const flyAgaricStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.052, 0.0),
      new THREE.Vector2(0.064, 0.028), // bulbous scaly volva base
      new THREE.Vector2(0.056, 0.048),
      new THREE.Vector2(0.044, 0.056), // volva collar ridge
      new THREE.Vector2(0.032, 0.078),
      new THREE.Vector2(0.027, 0.148),
      new THREE.Vector2(0.054, 0.136), // drooping flared annulus skirt!
      new THREE.Vector2(0.048, 0.158),
      new THREE.Vector2(0.025, 0.172),
      new THREE.Vector2(0.024, 0.232),
      new THREE.Vector2(0.0, 0.232),
    ],
    16
  );

  // Broad domed scarlet cap with planar radial top UVs matching flyAgaricCap texture
  const flyAgaricCapGeo = (() => {
    const g = prepNonIndexed(
      new THREE.SphereGeometry(0.138, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.54)
    );
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      // Gentle natural organic wave at the cap margin
      const ang = Math.atan2(pz, px);
      const rFrac = Math.hypot(px, pz) / 0.138;
      const rimWave = Math.sin(ang * 4.0 + 0.5) * 0.0045 * rFrac * rFrac;
      pos.setY(i, py * 0.62 + 0.214 + rimWave);
      uvs[i * 2] = clamp(px / (0.138 * 2.02) + 0.5, 0.01, 0.99);
      uvs[i * 2 + 1] = clamp(pz / (0.138 * 2.02) + 0.5, 0.01, 0.99);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  })();

  const flyAgaricGillsGeo = (() => {
    const g = new THREE.CircleGeometry(0.134, 20);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.213, 0);
    return g;
  })();

  // Sculpted organic flattened pebble-warts hugging the dome curvature (NO cubes!)
  const flyAgaricWartsGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const wr = seededRand(777);
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const nVec = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      const phi = Math.acos(1 - ((i + 0.45) / 24) * 0.78);
      const theta = i * 2.39996 + wr() * 0.28;
      const rad = 0.138;
      const wx = Math.sin(phi) * Math.cos(theta) * rad;
      const wy = Math.cos(phi) * rad * 0.62 + 0.214;
      const wz = Math.sin(phi) * Math.sin(theta) * rad;
      nVec.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi) / 0.62, Math.sin(phi) * Math.sin(theta)).normalize();
      q.setFromUnitVectors(up, nVec);

      const sz = (0.008 + wr() * 0.007) * (1.15 - phi * 0.35);
      const pebble = new THREE.IcosahedronGeometry(sz, 0);
      pebble.scale(1.15 + wr() * 0.45, 0.44 + wr() * 0.18, 0.95 + wr() * 0.4);
      pebble.applyQuaternion(q);
      pebble.translate(wx, wy, wz);
      parts.push(prepNonIndexed(pebble));
    }
    return mergeGeometries(parts)!;
  })();

  // Young scarlet Fly Agaric egg-button bursting from its white universal veil!
  const flyAgaricButtonCapGeo = (() => {
    const g = prepNonIndexed(new THREE.SphereGeometry(0.068, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.74));
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      pos.setY(i, py * 0.95 + 0.088);
      uvs[i * 2] = clamp(px / 0.15 + 0.5, 0.02, 0.98);
      uvs[i * 2 + 1] = clamp(pz / 0.15 + 0.5, 0.02, 0.98);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  })();
  const flyAgaricButtonStemGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.056, 0.0),
      new THREE.Vector2(0.062, 0.042),
      new THREE.Vector2(0.052, 0.072),
      new THREE.Vector2(0.036, 0.095),
      new THREE.Vector2(0.0, 0.095),
    ],
    14
  );

  // ---- HERO 2: Valge kärbseseen (Amanita virosa — Destroying Angel) ----
  // Tall slender shaggy-floccose stem + prominent papery cup-like volva sac + delicate ragged skirt ring
  const destroyingAngelStemGeo = (() => {
    const g = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.046, 0.0),
        new THREE.Vector2(0.056, 0.036), // swollen papery cup volva sac!
        new THREE.Vector2(0.058, 0.076), // open papery volva rim
        new THREE.Vector2(0.042, 0.072),
        new THREE.Vector2(0.026, 0.056),
        new THREE.Vector2(0.022, 0.175),
        new THREE.Vector2(0.044, 0.168), // delicate ragged drooping skirt ring
        new THREE.Vector2(0.038, 0.194),
        new THREE.Vector2(0.018, 0.205),
        new THREE.Vector2(0.017, 0.278),
        new THREE.Vector2(0.0, 0.278),
      ],
      22
    );
    // Subtle organic shaggy floccose irregularity along the tall white stem
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      if (py > 0.078 && py < 0.265) {
        const px = pos.getX(i);
        const pz = pos.getZ(i);
        const ang = Math.atan2(pz, px);
        const shag = 1.0 + Math.sin(py * 95.0 + ang * 3.0) * 0.05;
        pos.setX(i, px * shag);
        pos.setZ(i, pz * shag);
      }
    }
    g.computeVertexNormals();
    return g;
  })();

  // Signature tall conical-bell umbonate porcelain-white Destroying Angel cap!
  const destroyingAngelCapGeo = (() => {
    const pts = [
      new THREE.Vector2(0.112, 0.236),
      new THREE.Vector2(0.106, 0.252),
      new THREE.Vector2(0.088, 0.285),
      new THREE.Vector2(0.062, 0.326),
      new THREE.Vector2(0.034, 0.354),
      new THREE.Vector2(0.012, 0.368),
      new THREE.Vector2(0.0, 0.371),
    ];
    const g = new THREE.LatheGeometry(pts, 28);
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      // Slight asymmetrical tilt typical of Amanita virosa bells
      const ang = Math.atan2(pz, px);
      const rFrac = Math.hypot(px, pz) / 0.112;
      const tilt = Math.sin(ang + 0.8) * 0.01 * rFrac;
      const lobe = Math.cos(ang * 3.0) * 0.005 * rFrac * rFrac;
      pos.setY(i, py + tilt + lobe);
      uvs[i * 2] = clamp(px / 0.23 + 0.5, 0.01, 0.99);
      uvs[i * 2 + 1] = clamp(pz / 0.23 + 0.5, 0.01, 0.99);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  })();

  const destroyingAngelGillsGeo = (() => {
    const g = new THREE.CircleGeometry(0.109, 18);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.242, 0);
    return g;
  })();

  disposables.push(
    chanterelleBodyGeo,
    saffronBodyGeo,
    porciniStemGeo,
    porciniCapGeo,
    porciniPoreGeo,
    birchBoleteStemGeo,
    birchBoleteCapGeo,
    birchBoletePoreGeo,
    flyAgaricStemGeo,
    flyAgaricCapGeo,
    flyAgaricGillsGeo,
    flyAgaricWartsGeo,
    flyAgaricButtonCapGeo,
    flyAgaricButtonStemGeo,
    destroyingAngelStemGeo,
    destroyingAngelCapGeo,
    destroyingAngelGillsGeo
  );

  let mushroomCountTotal = 0;

  function spawnMushroom(x: number, z: number, species: MushroomSpecies): void {
    const y = getTerrainHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);

    const padMesh = new THREE.Mesh(mushShadowGeo, mushShadowMat);
    g.add(padMesh);

    if (species === 'kukeseen' || species === 'kuuseriisikas') {
      const baseGeo = species === 'kukeseen' ? chanterelleBodyGeo : saffronBodyGeo;
      const mat = species === 'kukeseen' ? chanterelleMat : saffronCapMat;
      const count = species === 'kukeseen' ? 6 : 3;
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < count; i++) {
        const clone = baseGeo.clone();
        const s = i === 0 ? 1.18 : 0.68 + rand() * 0.42;
        const ang = (i / count) * Math.PI * 2 + rand() * 0.6;
        const off = i === 0 ? 0 : 0.08 + rand() * 0.11;
        clone.scale(s, s, s);
        clone.rotateX((rand() - 0.5) * 0.16);
        clone.rotateZ((rand() - 0.5) * 0.16);
        clone.rotateY(rand() * Math.PI * 2);
        clone.translate(Math.cos(ang) * off, 0, Math.sin(ang) * off);
        parts.push(clone);
      }
      const clusterGeo = mergeGeometries(parts)!;
      disposables.push(clusterGeo);
      const m = new THREE.Mesh(clusterGeo, mat);
      m.castShadow = shadows;
      m.receiveShadow = true;
      g.add(m);
    } else if (species === 'punakarbseseen') {
      // Photorealistic 3-stage Amanita muscaria cluster: mature umbrella + convex mid + young egg-button
      const stemParts: THREE.BufferGeometry[] = [];
      const capParts: THREE.BufferGeometry[] = [];
      const gillParts: THREE.BufferGeometry[] = [];
      const wartParts: THREE.BufferGeometry[] = [];

      const specs = [
        { s: 1.22, off: 0, ang: 0, isButton: false },
        { s: 0.84, off: 0.17, ang: rand() * Math.PI * 2, isButton: false },
        { s: 0.95, off: 0.14, ang: rand() * Math.PI * 2 + 2.2, isButton: true },
      ];
      for (const sp of specs) {
        const rx = (rand() - 0.5) * 0.1;
        const ry = rand() * Math.PI * 2;
        const rz = (rand() - 0.5) * 0.1;
        const dx = Math.cos(sp.ang) * sp.off;
        const dz = Math.sin(sp.ang) * sp.off;
        const xf = (src: THREE.BufferGeometry) => {
          const c = prepNonIndexed(src.clone());
          c.scale(sp.s, sp.s, sp.s);
          c.rotateX(rx);
          c.rotateZ(rz);
          c.rotateY(ry);
          c.translate(dx, 0, dz);
          return c;
        };
        if (sp.isButton) {
          stemParts.push(xf(flyAgaricButtonStemGeo));
          capParts.push(xf(flyAgaricButtonCapGeo));
        } else {
          stemParts.push(xf(flyAgaricStemGeo));
          capParts.push(xf(flyAgaricCapGeo));
          gillParts.push(xf(flyAgaricGillsGeo));
          wartParts.push(xf(flyAgaricWartsGeo));
        }
      }
      const mStem = mergeGeometries(stemParts)!;
      const mCap = mergeGeometries(capParts)!;
      const mGills = mergeGeometries(gillParts)!;
      const mWarts = mergeGeometries(wartParts)!;
      disposables.push(mStem, mCap, mGills, mWarts);
      const capMesh = new THREE.Mesh(mCap, flyAgaricCapMat);
      capMesh.castShadow = shadows;
      capMesh.receiveShadow = true;
      g.add(
        new THREE.Mesh(mStem, amanitaStemMat),
        capMesh,
        new THREE.Mesh(mGills, amanitaGillsMat),
        new THREE.Mesh(mWarts, amanitaWartMat)
      );
    } else if (species === 'valgekarbseseen') {
      // Photorealistic 2-stage Amanita virosa (Destroying Angel): tall conical bell + young bud
      const stemParts: THREE.BufferGeometry[] = [];
      const capParts: THREE.BufferGeometry[] = [];
      const gillParts: THREE.BufferGeometry[] = [];

      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1.16 : 0.76 + rand() * 0.18;
        const ang = rand() * Math.PI * 2;
        const off = i === 0 ? 0 : 0.14 + rand() * 0.06;
        const rx = (rand() - 0.5) * 0.11;
        const ry = rand() * Math.PI * 2;
        const rz = (rand() - 0.5) * 0.11;
        const dx = Math.cos(ang) * off;
        const dz = Math.sin(ang) * off;
        const xf = (src: THREE.BufferGeometry) => {
          const c = prepNonIndexed(src.clone());
          c.scale(s, s, s);
          c.rotateX(rx);
          c.rotateZ(rz);
          c.rotateY(ry);
          c.translate(dx, 0, dz);
          return c;
        };
        stemParts.push(xf(destroyingAngelStemGeo));
        capParts.push(xf(destroyingAngelCapGeo));
        gillParts.push(xf(destroyingAngelGillsGeo));
      }
      const mStem = mergeGeometries(stemParts)!;
      const mCap = mergeGeometries(capParts)!;
      const mGills = mergeGeometries(gillParts)!;
      disposables.push(mStem, mCap, mGills);
      const capMesh = new THREE.Mesh(mCap, destroyingAngelCapMat);
      capMesh.castShadow = shadows;
      capMesh.receiveShadow = true;
      g.add(
        new THREE.Mesh(mStem, amanitaStemMat),
        capMesh,
        new THREE.Mesh(mGills, amanitaGillsMat)
      );
    } else {
      // Bolete family: kivipuravik, kasepuravik, sapipuravik
      const isBirch = species === 'kasepuravik';
      const isBitter = species === 'sapipuravik';
      const stemGeo = isBirch ? birchBoleteStemGeo : porciniStemGeo;
      const capGeo = isBirch ? birchBoleteCapGeo : porciniCapGeo;
      const poreGeo = isBirch ? birchBoletePoreGeo : porciniPoreGeo;
      const stemMat = isBirch ? birchBoleteStemMat : porciniStemMat;
      const capMat = isBitter ? bitterCapMat : isBirch ? birchBoleteCapMat : porciniCapMat;
      const poreMat = isBitter ? bitterPoreMat : boletePoreMat;

      const stemParts: THREE.BufferGeometry[] = [];
      const capParts: THREE.BufferGeometry[] = [];
      const poreParts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1.18 : 0.68 + rand() * 0.24;
        const ang = rand() * Math.PI * 2;
        const off = i === 0 ? 0 : 0.12 + rand() * 0.06;
        const rx = (rand() - 0.5) * 0.12;
        const ry = rand() * Math.PI * 2;
        const rz = (rand() - 0.5) * 0.12;
        const dx = Math.cos(ang) * off;
        const dz = Math.sin(ang) * off;
        const xf = (src: THREE.BufferGeometry) => {
          const c = prepNonIndexed(src.clone());
          c.scale(s, s, s);
          c.rotateX(rx);
          c.rotateZ(rz);
          c.rotateY(ry);
          c.translate(dx, 0, dz);
          return c;
        };
        stemParts.push(xf(stemGeo));
        capParts.push(xf(capGeo));
        poreParts.push(xf(poreGeo));
      }
      const mStem = mergeGeometries(stemParts)!;
      const mCap = mergeGeometries(capParts)!;
      const mPore = mergeGeometries(poreParts)!;
      disposables.push(mStem, mCap, mPore);
      const capMesh = new THREE.Mesh(mCap, capMat);
      capMesh.castShadow = shadows;
      capMesh.receiveShadow = true;
      g.add(new THREE.Mesh(mStem, stemMat), capMesh, new THREE.Mesh(mPore, poreMat));
    }

    const hitProxy = new THREE.Mesh(hitProxyGeo, hitProxyMat);
    hitProxy.position.y = 0.16;
    g.add(hitProxy);

    scene.add(g);
    mushroomCountTotal++;

    const info = MUSHROOM_SPECIES_INFO[species];
    const tag =
      info.edibility === 'poisonous'
        ? ' [POISONOUS]'
        : info.edibility === 'inedible'
          ? ' [Inedible]'
          : '';
    const entry = registerInteractive(g, {
      name: `${info.english} (${info.estonian})${tag}`,
      desc: info.note,
      gatherable: true,
      species,
      carryable: false,
      kickable: false,
      radius: 0.18,
      onTouch: () => showToast(`${info.estonian}: ${info.note}`),
    });
    mushroomNodes.push({ mesh: g, x, z, entry });
  }

  const allSpecies: MushroomSpecies[] = [
    'kukeseen',
    'kivipuravik',
    'kasepuravik',
    'kuuseriisikas',
    'sapipuravik',
    'punakarbseseen',
    'valgekarbseseen',
  ];

  const pickWeightedSpecies = (): MushroomSpecies => {
    const r = rand();
    if (r < 0.24) return 'kukeseen';
    if (r < 0.42) return 'kivipuravik';
    if (r < 0.57) return 'kasepuravik';
    if (r < 0.72) return 'kuuseriisikas';
    if (r < 0.83) return 'sapipuravik';
    if (r < 0.93) return 'punakarbseseen';
    return 'valgekarbseseen';
  };

  // Swamp Island mushrooms (3 per island)
  for (const isl of bp.swampIslands) {
    for (let k = 0; k < 3; k++) {
      const a = rand() * Math.PI * 2;
      const rad = 4.2 + rand() * Math.max(2, isl.radius - 5.5);
      const mx = isl.x + Math.cos(a) * rad;
      const mz = isl.z + Math.sin(a) * rad;
      if (getTerrainHeight(mx, mz) > SWAMP_WATER_Y + 0.18) {
        spawnMushroom(mx, mz, pickWeightedSpecies());
      }
    }
  }

  // Woodland-edge mossy forest glade guaranteed off-road & away from villages so players discover
  // all iconic Estonian species (including Punane kärbseseen & Valge kärbseseen) naturally!
  let heroMushroomPos: { x: number; z: number } | null = null;
  const gladeZ = 24.5;
  const gladeBaseX = roadCenterX(gladeZ) - 11.5;
  const starterOffsets: Array<[number, number, MushroomSpecies]> = [
    [gladeBaseX, gladeZ, 'punakarbseseen'],
    [gladeBaseX + 0.68, gladeZ - 0.35, 'valgekarbseseen'],
    [gladeBaseX - 0.72, gladeZ - 0.48, 'kivipuravik'],
    [gladeBaseX + 0.25, gladeZ - 0.95, 'kukeseen'],
    [gladeBaseX - 1.35, gladeZ + 0.4, 'kuuseriisikas'],
  ];
  for (const [ox, oz, sp] of starterOffsets) {
    if (getDistanceToNearestVillage(ox, oz).dist >= 28 && distToRoadDetail(ox, oz).dist > 3.5) {
      spawnMushroom(ox, oz, sp);
      if (sp === 'punakarbseseen') {
        heroMushroomPos = { x: ox, z: oz };
      }
    }
  }

  // Widely dispersed 240 forest clusters across the entire 1200x1200m world (scarcest near villages)
  let placed = 0;
  let attempts = 0;
  while (placed < 240 && attempts < 1400) {
    attempts++;
    const mx = (rand() - 0.5) * (WORLD_HALF * 1.9);
    const mz = (rand() - 0.5) * (WORLD_HALF * 1.9);
    const nearV = getDistanceToNearestVillage(mx, mz);
    if (nearV.dist < 36 && rand() < 0.96) continue;
    const isl = getNearestSwampIsland(mx, mz);
    if (getSwampFactor(mx, mz) > 0.28 && isl.islandMask < 0.4) continue;
    if (distToRoadDetail(mx, mz).dist < 3.6) continue;
    if (getTerrainHeight(mx, mz) < SWAMP_WATER_Y + 0.16) continue;

    spawnMushroom(mx, mz, placed < 7 ? allSpecies[placed] : pickWeightedSpecies());
    placed++;
  }

  function gatherMushroom(entry: InteractiveEntry): MushroomSpecies | null {
    if (!entry.gatherable || entry.gathered || !entry.species) return null;
    entry.gathered = true;
    entry.mesh.visible = false;
    const idx = interactiveMeshes.indexOf(entry.mesh);
    if (idx !== -1) interactiveMeshes.splice(idx, 1);
    sound.playGatherMushroom();
    return entry.species;
  }

  return {
    circleColliders,
    boxColliders,
    boardwalkZones,
    interactiveObjects,
    interactiveMeshes,
    dynamicObjects,
    mushroomCountTotal,
    heroMushroomPos,
    updateDynamicProps: (
      elapsed: number,
      camX: number,
      camZ: number,
      skyState?: SkyFrameState,
      frustumPlanes?: Float32Array,
      maxRenderDist = 225
    ) => {
      if (fireLit) {
        fireLight.intensity = 2.5 + Math.sin(elapsed * 15.0) * 0.45;
        fireFlames.scale.y = 0.85 + Math.sin(elapsed * 20.0) * 0.2;
      }

      // Distance + frustum cull bog water & mist so they never shade off-screen from village/forest
      const bogDx = camX - bp.bogCenterX;
      const bogDz = camZ - bp.bogCenterZ;
      const bogDistSq = bogDx * bogDx + bogDz * bogDz;
      const bogVisLimit = waterRadius + maxRenderDist + 16;
      let nearBog = bogDistSq <= bogVisLimit * bogVisLimit;
      if (nearBog && frustumPlanes && bogDistSq > (waterRadius + 10) * (waterRadius + 10)) {
        nearBog = sphereIntersectsFrustum(
          frustumPlanes,
          bp.bogCenterX,
          SWAMP_WATER_Y,
          bp.bogCenterZ,
          waterRadius + 6
        );
      }
      swampWater.visible = nearBog;
      mistInst.visible = nearBog && bogDistSq <= (bp.bogRadius + 75) * (bp.bogRadius + 75);

      // Sync Fresnel reflective bog water & day/night cottage window glow with live sky state
      if (nearBog) {
        waterMat.uniforms.uTime.value = elapsed;
        if (skyState) {
          waterMat.uniforms.uSunDir.value.copy(skyState.sunDir);
          waterMat.uniforms.uSunColor.value.copy(skyState.sunColor);
          waterMat.uniforms.uSkyTop.value.copy(skyState.skyTopColor);
          waterMat.uniforms.uSkyHorizon.value.copy(skyState.skyHorizonColor);
          waterMat.uniforms.uFogColor.value.copy(skyState.skyHorizonColor);
          waterMat.uniforms.uFogDensity.value = skyState.fogDensity;
        }
      }
      if (skyState) {
        // Dark reflective glass during bright daytime; warm amber hearth light at golden hour, dusk & night!
        const duskGlow = THREE.MathUtils.clamp((0.86 - skyState.dayFactor) / 0.36, 0, 1);
        activeWinMat.emissiveIntensity = 0.02 + duskGlow * 1.65;
      }

      const maxMushSq = 38 * 38;
      const fogCapSq = (maxRenderDist + 16) * (maxRenderDist + 16);
      for (let i = 0; i < mushroomNodes.length; i++) {
        const m = mushroomNodes[i];
        if (m.entry.gathered) continue;
        const dx = m.x - camX;
        const dz = m.z - camZ;
        const dSq = dx * dx + dz * dz;
        if (dSq >= maxMushSq) {
          m.mesh.visible = false;
        } else if (frustumPlanes && dSq > 25) {
          m.mesh.visible = sphereIntersectsFrustum(
            frustumPlanes,
            m.x,
            m.mesh.position.y + 0.25,
            m.z,
            1.2
          );
        } else {
          m.mesh.visible = true;
        }
      }
      for (let i = 0; i < structureNodes.length; i++) {
        const s = structureNodes[i];
        const dx = s.x - camX;
        const dz = s.z - camZ;
        const dSq = dx * dx + dz * dz;
        const capSq = s.maxDistSq < fogCapSq ? s.maxDistSq : fogCapSq;
        if (dSq >= capSq) {
          s.obj.visible = false;
        } else if (frustumPlanes && dSq > 26 * 26) {
          s.obj.visible = sphereIntersectsFrustum(
            frustumPlanes,
            s.x,
            s.obj.position.y + 4.5,
            s.z,
            18.0
          );
        } else {
          s.obj.visible = true;
        }
      }
    },
    gatherMushroom,
    isWaterVisible: () => swampWater.visible,
    isMistVisible: () => mistInst.visible,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
