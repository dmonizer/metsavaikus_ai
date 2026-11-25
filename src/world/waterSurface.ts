import * as THREE from 'three';
import { getTerrainHeight, SWAMP_WATER_Y } from './terrainMath';
import { SkyFrameState, WeatherId } from './weatherAndSky';

export interface ReflectiveWaterController {
  mesh: THREE.Mesh;
  radius: number;
  centerX: number;
  centerZ: number;
  smoothDepthTex: THREE.DataTexture;
  updateUniforms: (elapsed: number, skyState?: SkyFrameState, weather?: WeatherId) => void;
  renderReflection: (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    mainCamera: THREE.PerspectiveCamera
  ) => void;
  dispose: () => void;
}

const DEPTH_ENCODE_MIN = -0.65;
const DEPTH_ENCODE_RANGE = 2.55; // [-0.65m .. +1.90m] -> 1.0cm precision with glitch-free linear filtering

/**
 * Builds a uniformly subdivided circular disc mesh using elliptical disc mapping
 * and bakes per-vertex terrain depth (SWAMP_WATER_Y - groundY) for shoreline fallback.
 */
function buildBogWaterDiscGeometry(
  centerX: number,
  centerZ: number,
  radius: number,
  segments: number
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(2, 2, segments, segments);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const depths = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i); // [-1, 1]
    const v = pos.getY(i); // [-1, 1]
    // Elliptical disc mapping: maps square [-1,1]^2 cleanly to unit circle with uniform spacing
    const dx = u * Math.sqrt(Math.max(0, 1 - 0.5 * v * v));
    const dz = v * Math.sqrt(Math.max(0, 1 - 0.5 * u * u));
    const lx = dx * radius;
    const lz = -dz * radius;
    pos.setXYZ(i, lx, 0, lz);

    const groundY = getTerrainHeight(centerX + lx, centerZ + lz);
    depths[i] = SWAMP_WATER_Y - groundY;
  }

  geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Bakes a convex-safe, Gaussian-smoothed signed water depth map across the bog basin so
 * shoreline edges are always organically curved and smooth (never pointy polygon angles)
 * while preventing raw terrain triangles on convex spits from Z-clipping opaque water.
 * - R channel: convex-safe smoothed depth (used by both water edge alpha & terrain shoreline swash)
 * - G channel: smoothed basin depth (used for deep peat water color attenuation)
 */
function buildSmoothBogDepthTexture(
  centerX: number,
  centerZ: number,
  radius: number,
  size: number
): THREE.DataTexture {
  const count = size * size;
  const raw = new Float32Array(count);
  const tmp = new Float32Array(count);
  const blurred = new Float32Array(count);
  const eroded = new Float32Array(count);
  const safeSmooth = new Float32Array(count);
  const span = radius * 2;
  const invDenom = 1 / Math.max(1, size - 1);

  for (let iz = 0; iz < size; iz++) {
    const wz = centerZ - radius + iz * invDenom * span;
    const row = iz * size;
    for (let ix = 0; ix < size; ix++) {
      const wx = centerX - radius + ix * invDenom * span;
      raw[row + ix] = SWAMP_WATER_Y - getTerrainHeight(wx, wz);
    }
  }

  // Separable 5-tap Gaussian blur rounds off sharp contour kinks cleanly
  const w0 = 0.32;
  const w1 = 0.22;
  const w2 = 0.12;
  const blurPass = (src: Float32Array, dst: Float32Array) => {
    for (let iz = 0; iz < size; iz++) {
      const row = iz * size;
      for (let ix = 0; ix < size; ix++) {
        const xm2 = Math.max(0, ix - 2);
        const xm1 = Math.max(0, ix - 1);
        const xp1 = Math.min(size - 1, ix + 1);
        const xp2 = Math.min(size - 1, ix + 2);
        tmp[row + ix] =
          src[row + xm2] * w2 +
          src[row + xm1] * w1 +
          src[row + ix] * w0 +
          src[row + xp1] * w1 +
          src[row + xp2] * w2;
      }
    }
    for (let iz = 0; iz < size; iz++) {
      const zm2 = Math.max(0, iz - 2) * size;
      const zm1 = Math.max(0, iz - 1) * size;
      const z0 = iz * size;
      const zp1 = Math.min(size - 1, iz + 1) * size;
      const zp2 = Math.min(size - 1, iz + 2) * size;
      for (let ix = 0; ix < size; ix++) {
        dst[z0 + ix] =
          tmp[zm2 + ix] * w2 +
          tmp[zm1 + ix] * w1 +
          tmp[z0 + ix] * w0 +
          tmp[zp1 + ix] * w1 +
          tmp[zp2 + ix] * w2;
      }
    }
  };

  // Pass 1 & 2: smooth the basin contour into C2 curves
  blurPass(raw, safeSmooth);
  blurPass(safeSmooth, blurred);

  // Convex-safe soft pull-in: on convex tips/spits where blurring pushed water slightly
  // over dry terrain, pull depth gently inward before one final rounding pass so water alpha
  // feathers smoothly to 0 BEFORE raw terrain triangles ever poke above SWAMP_WATER_Y!
  for (let i = 0; i < count; i++) {
    eroded[i] = Math.min(blurred[i], raw[i] - 0.022);
  }
  blurPass(eroded, safeSmooth);

  const bytes = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const normSafe = Math.max(0, Math.min(1, (safeSmooth[i] - DEPTH_ENCODE_MIN) / DEPTH_ENCODE_RANGE));
    const normBody = Math.max(0, Math.min(1, (blurred[i] - DEPTH_ENCODE_MIN) / DEPTH_ENCODE_RANGE));
    const b = i * 4;
    bytes[b] = Math.round(normSafe * 255);
    bytes[b + 1] = Math.round(normBody * 255);
    bytes[b + 2] = bytes[b];
    bytes[b + 3] = 255;
  }

  const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Creates a physically-grounded wind-responsive reflective peat-bog water surface:
 * - Strictly level horizontal water plane (y = SWAMP_WATER_Y everywhere, never concave).
 * - Smooth Gaussian-filtered per-pixel shoreline depth map eliminates pointy polygon angles
 *   and drives gentle back-and-forth shoreline swash ripples even in calm weather.
 * - Real planar mirror reflection pass (sky, clouds, sun, trees, islands, huts, boardwalk)
 *   using oblique near-plane frustum clipping (zero shader recompiles, zero underwater leaks).
 * - Rising wind drives multi-directional waves, capillary chop, shimmering broken reflections,
 *   sun glints, and storm crest/shore foam; rain adds concentric raindrop rings.
 */
export function createReflectiveBogWater(
  centerX: number,
  centerZ: number,
  waterRadius: number,
  isSoftwareGl: boolean,
  isLowPowerGpu: boolean
): ReflectiveWaterController {
  const gridSegs = isSoftwareGl ? 72 : isLowPowerGpu ? 96 : 120;
  const waterGeo = buildBogWaterDiscGeometry(centerX, centerZ, waterRadius, gridSegs);
  const depthTexSize = isSoftwareGl ? 320 : 512;
  const smoothDepthTex = buildSmoothBogDepthTexture(centerX, centerZ, waterRadius, depthTexSize);

  const rtSize = isSoftwareGl ? 256 : isLowPowerGpu ? 384 : 512;
  const reflectionRT = new THREE.WebGLRenderTarget(rtSize, rtSize, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
  });
  reflectionRT.texture.generateMipmaps = false;

  const textureMatrix = new THREE.Matrix4();
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWaterY: { value: SWAMP_WATER_Y },
      uWindStrength: { value: 0.45 },
      uWindDir: { value: new THREE.Vector2(0.84, 0.54).normalize() },
      uRainIntensity: { value: 0.0 },
      uReflectionMap: { value: reflectionRT.texture },
      uDepthMap: { value: smoothDepthTex },
      uTextureMatrix: { value: textureMatrix },
      uHasReflection: { value: 0.0 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.55, 0.35).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uSkyTop: { value: new THREE.Color(0x285d96) },
      uSkyHorizon: { value: new THREE.Color(0xb9d1df) },
      uFogColor: { value: new THREE.Color(0xb9d1df) },
      uFogDensity: { value: 0.0065 },
      uRadius: { value: waterRadius },
      uCenter: { value: new THREE.Vector2(centerX, centerZ) },
    },
    vertexShader: /* glsl */ `
      attribute float aDepth;
      uniform float uWaterY;
      uniform mat4 uTextureMatrix;

      varying vec3 vWorldPos;
      varying vec4 vReflClip;
      varying float vDepth;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        // Water surface is strictly level at uWaterY everywhere (never concave or bowed)
        wp.y = uWaterY;
        vWorldPos = wp.xyz;
        vDepth = aDepth;

        // Project strictly level water plane point through reflection camera for exact mirror alignment
        vReflClip = uTextureMatrix * wp;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uWindStrength;
      uniform vec2 uWindDir;
      uniform float uRainIntensity;
      uniform sampler2D uReflectionMap;
      uniform sampler2D uDepthMap;
      uniform float uHasReflection;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uRadius;
      uniform vec2 uCenter;

      varying vec3 vWorldPos;
      varying vec4 vReflClip;
      varying float vDepth;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      // Procedural expanding concentric raindrop ripples across bog water
      vec2 rainRippleGrad(vec2 p, float t) {
        vec2 g = vec2(0.0);
        for (int layer = 0; layer < 2; layer++) {
          float scale = layer == 0 ? 1.55 : 2.35;
          vec2 uv = p * scale + float(layer) * 19.7;
          vec2 cell = floor(uv);
          vec2 f = fract(uv) - 0.5;
          float rnd = hash21(cell + float(layer) * 37.0);
          float age = fract(t * (0.75 + rnd * 0.45) + rnd);
          vec2 center = (vec2(hash21(cell + 13.1), hash21(cell + 71.7)) - 0.5) * 0.52;
          vec2 d = f - center;
          float r = length(d);
          float ringR = age * 0.44;
          float distRing = r - ringR;
          float env = exp(-distRing * distRing * 155.0) * (1.0 - age) * smoothstep(0.0, 0.08, age);
          float wave = cos(distRing * 42.0) * env;
          g += (d / max(r, 0.001)) * wave;
        }
        return g;
      }

      void main() {
        vec2 p = vWorldPos.xz;
        vec3 toCam = cameraPosition - vWorldPos;
        float dist = length(toCam);
        vec3 viewDir = toCam / max(dist, 0.001);

        // Wind factor: 0.0 = dead calm mirror, 0.3 = gentle breeze, 0.7 = windy, 1.2 = storm
        float windNorm = clamp((uWindStrength - 0.14) / 2.15, 0.0, 1.35);
        float t = uTime;

        // Sample convex-safe smoothed signed depth map so shoreline contours are always curved & organic
        vec2 depthUv = clamp((p - (uCenter - vec2(uRadius))) / (2.0 * uRadius), vec2(0.002), vec2(0.998));
        vec2 depthSample = texture2D(uDepthMap, depthUv).rg;
        float safeDepth = depthSample.r * ${DEPTH_ENCODE_RANGE.toFixed(3)} + (${DEPTH_ENCODE_MIN.toFixed(3)});
        float bodyDepth = depthSample.g * ${DEPTH_ENCODE_RANGE.toFixed(3)} + (${DEPTH_ENCODE_MIN.toFixed(3)});

        // Gentle back-and-forth shoreline swash (runs even in zero wind; synchronized with terrain wet bank!)
        float swashFreq = mix(1.25, 2.25, clamp(windNorm, 0.0, 1.0));
        float shorePhase = t * swashFreq
          + sin(p.x * 0.27 + p.y * 0.19) * 1.65
          + cos(p.x * 0.14 - p.y * 0.31) * 1.15;
        float cyc = fract(shorePhase * 0.15915494);
        float activeWave = smoothstep(0.0, 0.34, cyc) * (1.0 - smoothstep(0.34, 0.80, cyc));
        // Subtle organic micro-waviness along the water lip so edges never read as straight lines
        float edgeCurve = sin(p.x * 0.42 + p.y * 0.35) * 0.018 + cos(p.x * 0.91 - p.y * 0.77) * 0.009;
        float swashShift = (activeWave - 0.32) * mix(0.052, 0.105, clamp(windNorm, 0.0, 1.0)) + edgeCurve;

        float effDepth = safeDepth + swashShift;
        float depth = max(bodyDepth + swashShift * 0.5, 0.0);
        // Smoothly feathered shoreline alpha eliminates hard polygonal Z-buffer intersections
        float edgeAlpha = smoothstep(-0.008, 0.095, effDepth);
        if (edgeAlpha < 0.01) discard;

        float shoreCalm = smoothstep(0.0, 0.24, depth);
        float shoreBand = (1.0 - smoothstep(0.0, 0.36, depth)) * edgeAlpha;
        float distFade = 1.0 - smoothstep(45.0, 195.0, dist);

        vec2 wd = normalize(uWindDir);
        vec2 wdPerp = vec2(-wd.y, wd.x);

        // Multi-directional wind swells & capillary chop advected along wind direction
        vec2 d1 = normalize(wd + wdPerp * 0.16);
        vec2 d2 = normalize(wd - wdPerp * 0.32);
        vec2 d3 = normalize(wd * 0.82 + wdPerp * 0.57);
        vec2 d4 = normalize(wd * 0.52 - wdPerp * 0.85);

        float spd = mix(0.55, 2.45, clamp(windNorm, 0.0, 1.0));

        float ph1 = dot(p, d1) * 0.88 - t * (1.30 * spd);
        float ph2 = dot(p, d2) * 1.54 - t * (1.72 * spd);
        float ph3 = dot(p, d3) * 2.90 - t * (2.38 * spd);
        float ph4 = dot(p, d4) * 5.25 - t * (3.15 * spd);
        float ph5 = dot(p, wd) * 9.50 - t * (4.25 * spd);

        float waveCrest = clamp(
          (sin(ph1) * 0.52 + sin(ph2) * 0.30 + sin(ph3) * 0.18) * 0.5 + 0.5,
          0.0,
          1.0
        ) * clamp(windNorm, 0.0, 1.25) * shoreCalm;

        // Smooth analytical derivatives: near-zero in calm mirror, crisp choppy waves in wind
        float swellScale = (0.0018 + windNorm * windNorm * 0.165) * shoreCalm;
        float chopScale = (0.001 + windNorm * 0.095) * (0.35 + 0.65 * distFade) * shoreCalm;

        vec2 grad =
          d1 * (cos(ph1) * 0.88 * swellScale) +
          d2 * (cos(ph2) * 0.72 * swellScale) +
          d3 * (cos(ph3) * 0.56 * chopScale) +
          d4 * (cos(ph4) * 0.38 * chopScale) +
          wd * (cos(ph5) * 0.24 * chopScale * distFade);

        // Subtle calm shoreline lapping capillary shimmer right along the water's edge
        float lapWave = cos(effDepth * 28.0 - shorePhase * 1.35) * shoreBand * mix(0.016, 0.036, clamp(windNorm, 0.0, 1.0));
        grad += vec2(sin(p.x * 1.2 + t * 0.9), cos(p.y * 1.2 - t * 0.85)) * lapWave;

        // Expanding concentric raindrop ripples during rain/storm
        if (uRainIntensity > 0.02 && dist < 42.0) {
          float rainFade = (1.0 - smoothstep(14.0, 42.0, dist)) * uRainIntensity;
          grad += rainRippleGrad(p, t) * (0.095 * rainFade);
        }

        vec3 nrm = normalize(vec3(-grad.x, 1.0, -grad.y));

        // Physical Schlick Fresnel (F0 = 0.02..0.04 at nadir, rich mirror reflection across lake)
        float ndv = clamp(dot(nrm, viewDir), 0.0, 1.0);
        float f1 = 1.0 - ndv;
        float f2 = f1 * f1;
        float f5 = f2 * f2 * f1;
        // Stronger clear mirror reflectance when calm so sky, clouds, trees, huts & boardwalk reflect crisply
        float calmBoost = (1.0 - smoothstep(0.0, 0.35, windNorm)) * 0.32;
        float fresnel = clamp(0.10 + calmBoost * (0.55 + 0.45 * f1) + (0.86 - calmBoost * 0.30) * f5, 0.10, 0.96);

        // Analytical sky fallback (only near viewport edges of reflection RT)
        vec3 reflDir = reflect(-viewDir, nrm);
        float reflElev = clamp(reflDir.y, 0.0, 1.0);
        vec3 skyFallback = mix(uSkyHorizon * 0.94, uSkyTop, smoothstep(0.0, 0.58, reflElev));
        float treeBand = smoothstep(0.02, 0.22, reflElev);
        skyFallback *= mix(vec3(0.32, 0.42, 0.36), vec3(1.0), treeBand);

        vec3 reflCol = skyFallback;
        if (uHasReflection > 0.5 && vReflClip.w > 0.001) {
          vec2 baseUv = vReflClip.xy / vReflClip.w;
          // Near-zero UV distortion in dead calm; wind-aligned shimmering distortion as waves rise
          float distortMag = mix(0.008, 0.125, clamp(windNorm, 0.0, 1.0));
          vec2 uvDistort = vec2(nrm.x, nrm.z * 0.75) * distortMag / (0.35 + dist * 0.015);
          vec2 sampleUv = baseUv + uvDistort;
          vec2 clampedUv = clamp(sampleUv, vec2(0.004), vec2(0.996));
          vec3 planarCol = texture2D(uReflectionMap, clampedUv).rgb;

          // Subtle multi-tap reflection blur along vertical wave streak in windy conditions
          if (windNorm > 0.30) {
            float blurAmt = (windNorm - 0.30) * 0.0046;
            vec3 pA = texture2D(uReflectionMap, clamp(clampedUv + vec2(0.0, blurAmt), vec2(0.004), vec2(0.996))).rgb;
            vec3 pB = texture2D(uReflectionMap, clamp(clampedUv - vec2(0.0, blurAmt), vec2(0.004), vec2(0.996))).rgb;
            planarCol = planarCol * 0.5 + (pA + pB) * 0.25;
          }

          float edgeX = smoothstep(0.0, 0.05, sampleUv.x) * smoothstep(1.0, 0.95, sampleUv.x);
          float edgeY = smoothstep(0.0, 0.05, sampleUv.y) * smoothstep(1.0, 0.95, sampleUv.y);
          float validMask = clamp(edgeX * edgeY, 0.0, 1.0);
          reflCol = mix(skyFallback, planarCol, validMask);
        }

        // Authentic Estonian humic peat-bog water: warm tea-amber shallows -> deep dark peat black
        vec3 peatShallow = vec3(0.095, 0.074, 0.044);
        vec3 peatDeep = vec3(0.016, 0.028, 0.025);
        float depthMix = smoothstep(0.04, 1.05, depth);
        vec3 waterBody = mix(peatShallow, peatDeep, depthMix);
        waterBody += uSkyHorizon * (0.032 * (1.0 - depthMix * 0.65));

        // Trough shading vs wind-facing crest lift
        float troughShade = mix(1.0, 0.76 + 0.32 * waveCrest, clamp(windNorm, 0.0, 1.0));
        vec3 col = mix(waterBody * troughShade, reflCol, fresnel);

        // Crisp solar specular sparkles across waves
        float sunVis = smoothstep(0.02, 0.22, uSunDir.y);
        if (sunVis > 0.005) {
          vec3 halfVec = normalize(uSunDir + viewDir);
          float ndh = max(dot(nrm, halfVec), 0.0);
          float specPower = mix(260.0, 68.0, clamp(windNorm, 0.0, 1.0));
          float spec = pow(ndh, specPower) * mix(1.8, 1.4, clamp(windNorm, 0.0, 1.0)) * sunVis;
          float broadSpec = pow(ndh, 22.0) * (0.08 + windNorm * 0.16) * sunVis;
          col += uSunColor * (spec + broadSpec);
        }

        // Delicate luminous shoreline meniscus lip + wind-driven crest & shore foam
        float meniscus = smoothstep(-0.005, 0.025, effDepth) * (1.0 - smoothstep(0.025, 0.095, effDepth));
        float calmMeniscus = meniscus * (0.14 + 0.14 * activeWave);
        float foamNoise = sin(p.x * 4.8 + p.y * 3.1 - t * 2.2) * cos(p.x * 2.9 - p.y * 5.4 + t * 1.7);
        float crestFoam = smoothstep(0.56, 0.90, waveCrest + foamNoise * 0.18) * smoothstep(0.42, 1.15, windNorm) * 0.36;
        float shoreRipple = smoothstep(0.01, 0.15, depth) * (1.0 - smoothstep(0.15, 0.34, depth));
        float shoreFoam = shoreRipple * (0.45 + 0.55 * sin(dot(p, wd) * 5.0 - t * 2.8)) * smoothstep(0.22, 0.95, windNorm) * 0.24;
        vec3 foamCol = mix(vec3(0.76, 0.80, 0.78), uSkyHorizon * 0.96, 0.52);
        col = mix(col, foamCol, clamp(calmMeniscus + crestFoam + shoreFoam, 0.0, 0.46));

        // Exponential distance fog matching Three.js FogExp2
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

        gl_FragColor = vec4(col, edgeAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.Mesh(waterGeo, waterMat);
  mesh.position.set(centerX, SWAMP_WATER_Y, centerZ);
  mesh.renderOrder = 2;

  // Pre-allocated reflection pass math scratch objects (zero per-frame allocations)
  const reflectionCamera = new THREE.PerspectiveCamera();
  const worldPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(SWAMP_WATER_Y - 0.03));
  const viewPlane = new THREE.Plane();
  const clipVec = new THREE.Vector4();
  const qVec = new THREE.Vector4();
  const camWorldPos = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  const reflTarget = new THREE.Vector3();
  const biasMatrix = new THREE.Matrix4().set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  let rainSmoothed = 0;
  let reflFrame = 0;

  return {
    mesh,
    radius: waterRadius,
    centerX,
    centerZ,
    smoothDepthTex,
    updateUniforms: (elapsed: number, skyState?: SkyFrameState, weather?: WeatherId) => {
      waterMat.uniforms.uTime.value = elapsed;
      const targetRain = weather === 'storm' ? 1.0 : weather === 'rain' ? 0.65 : 0.0;
      rainSmoothed += (targetRain - rainSmoothed) * 0.12;
      waterMat.uniforms.uRainIntensity.value = rainSmoothed;
      // Gently drift wind direction over minutes so wave fronts feel alive
      const windAngle = 0.56 + Math.sin(elapsed * 0.018) * 0.22;
      waterMat.uniforms.uWindDir.value.set(Math.cos(windAngle), Math.sin(windAngle));

      if (skyState) {
        waterMat.uniforms.uWindStrength.value = skyState.windStrength;
        waterMat.uniforms.uSunDir.value.copy(skyState.sunDir);
        waterMat.uniforms.uSunColor.value.copy(skyState.sunColor);
        waterMat.uniforms.uSkyTop.value.copy(skyState.skyTopColor);
        waterMat.uniforms.uSkyHorizon.value.copy(skyState.skyHorizonColor);
        waterMat.uniforms.uFogColor.value.copy(skyState.skyHorizonColor);
        waterMat.uniforms.uFogDensity.value = skyState.fogDensity;
      }
    },
    renderReflection: (
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      mainCamera: THREE.PerspectiveCamera
    ) => {
      if (!mesh.visible) return;
      mainCamera.getWorldPosition(camWorldPos);
      if (camWorldPos.y <= SWAMP_WATER_Y + 0.03) {
        waterMat.uniforms.uHasReflection.value = 0.0;
        return;
      }
      if (isSoftwareGl && (reflFrame++ & 1) === 1 && waterMat.uniforms.uHasReflection.value > 0.5) {
        return;
      }

      mainCamera.getWorldDirection(camForward);

      // Mirror camera across horizontal water plane y = SWAMP_WATER_Y while keeping right-handed basis
      reflectionCamera.fov = mainCamera.fov;
      reflectionCamera.aspect = mainCamera.aspect;
      reflectionCamera.near = mainCamera.near;
      reflectionCamera.far = mainCamera.far;
      reflectionCamera.position.set(
        camWorldPos.x,
        2 * SWAMP_WATER_Y - camWorldPos.y,
        camWorldPos.z
      );
      reflTarget.set(
        camWorldPos.x + camForward.x * 10,
        2 * SWAMP_WATER_Y - (camWorldPos.y + camForward.y * 10),
        camWorldPos.z + camForward.z * 10
      );
      reflectionCamera.up.set(0, 1, 0);
      reflectionCamera.lookAt(reflTarget);
      reflectionCamera.updateMatrixWorld(true);
      reflectionCamera.updateProjectionMatrix();

      // Store projective texture matrix before oblique near-plane adjustment (X/Y/W rows match either way)
      textureMatrix.copy(biasMatrix);
      textureMatrix.multiply(reflectionCamera.projectionMatrix);
      textureMatrix.multiply(reflectionCamera.matrixWorldInverse);

      // Apply Eric Lengyel oblique near-plane clipping so underwater terrain/legs never leak into reflections
      viewPlane.copy(worldPlane).applyMatrix4(reflectionCamera.matrixWorldInverse);
      clipVec.set(viewPlane.normal.x, viewPlane.normal.y, viewPlane.normal.z, viewPlane.constant);
      const proj = reflectionCamera.projectionMatrix.elements;
      if (clipVec.w < -0.01) {
        qVec.set(
          (Math.sign(clipVec.x) + proj[8]) / proj[0],
          (Math.sign(clipVec.y) + proj[9]) / proj[5],
          -1.0,
          (1.0 + proj[10]) / proj[14]
        );
        const dotCQ = clipVec.dot(qVec);
        if (dotCQ > 0.001) {
          const scale = 2.0 / dotCQ;
          proj[2] = clipVec.x * scale;
          proj[6] = clipVec.y * scale;
          proj[10] = clipVec.z * scale + 1.0;
          proj[14] = clipVec.w * scale;
        }
      }

      // Render reflected scene into offscreen mirror target without mutating shadow maps
      const prevRenderTarget = renderer.getRenderTarget();
      const prevShadowAutoUpdate = renderer.shadowMap.autoUpdate;
      const prevXrEnabled = renderer.xr.enabled;
      mesh.visible = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.xr.enabled = false;

      renderer.setRenderTarget(reflectionRT);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      renderer.render(scene, reflectionCamera);

      renderer.setRenderTarget(prevRenderTarget);
      renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
      renderer.xr.enabled = prevXrEnabled;
      mesh.visible = true;
      waterMat.uniforms.uHasReflection.value = 1.0;
    },
    dispose: () => {
      smoothDepthTex.dispose();
      reflectionRT.dispose();
      waterGeo.dispose();
      waterMat.dispose();
    },
  };
}
