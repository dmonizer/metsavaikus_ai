import * as THREE from 'three';
import { getSwampFactor, getTerrainHeight } from './terrainMath';
import { SoundEngine } from './soundEngine';
import { getWeatherWindProfile } from '../game/gameLogic';

export type WeatherId = 'clear' | 'mist' | 'rain' | 'storm';

export const WEATHER_ORDER: WeatherId[] = ['clear', 'mist', 'rain', 'storm'];

export const WEATHER_LABELS: Record<WeatherId, string> = {
  clear: 'Clear',
  mist: 'Overcast & Bog Mist',
  rain: 'Rain',
  storm: 'Thunderstorm',
};

export interface SkyFrameState {
  timeLabel: string;
  weatherLabel: string;
  lightningStrength: number;
  windStrength: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyTopColor: THREE.Color;
  skyHorizonColor: THREE.Color;
  dayFactor: number;
  goldenFactor: number;
  fogDensity: number;
}

function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Single-draw-call Atmospheric Baltic Sky Dome with Rayleigh zenith-to-horizon scattering,
 * Mie solar aureole, crisp sun/moon disks, and 2-octave drifting volumetric-feel FBM clouds.
 */
function createAtmosphericSkyDome(): {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometry: THREE.SphereGeometry;
} {
  const geometry = new THREE.SphereGeometry(390, 32, 20);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },
      uZenithColor: { value: new THREE.Color(0x2e649c) },
      uMidSkyColor: { value: new THREE.Color(0x6d9cc2) },
      uHorizonColor: { value: new THREE.Color(0xc2d8e4) },
      uSunGlowColor: { value: new THREE.Color(0xffe7b8) },
      uCloudBright: { value: new THREE.Color(0xf6f8fa) },
      uCloudDark: { value: new THREE.Color(0x7c8e9e) },
      uCloudCover: { value: 0.36 },
      uDayFactor: { value: 1.0 },
      uGoldenFactor: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vLocalDir;
      void main() {
        vLocalDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      uniform vec3 uZenithColor;
      uniform vec3 uMidSkyColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunGlowColor;
      uniform vec3 uCloudBright;
      uniform vec3 uCloudDark;
      uniform float uCloudCover;
      uniform float uDayFactor;
      uniform float uGoldenFactor;
      uniform float uTime;

      varying vec3 vLocalDir;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float cloudFbm(vec2 p) {
        mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
        float v = 0.62 * noise2(p);
        p = rot * p * 2.04 + vec2(1.7, 3.1);
        v += 0.34 * noise2(p);
        return v;
      }

      void main() {
        vec3 dir = normalize(vLocalDir);
        float elev = clamp(dir.y, 0.0, 1.0);

        // Smooth 3-stop Rayleigh atmospheric gradient
        vec3 col = mix(uHorizonColor, uMidSkyColor, smoothstep(0.0, 0.24, elev));
        col = mix(col, uZenithColor, smoothstep(0.18, 0.86, elev));

        // Subtle warm horizon scattering band near sunrise/sunset
        float sunCos = dot(dir, uSunDir);
        float horizonBand = exp(-elev * 7.5);
        float mieWide = pow(max(sunCos, 0.0), 4.0) * (0.22 + uGoldenFactor * 0.45) * (1.0 - uCloudCover * 0.65);
        float mieTight = pow(max(sunCos, 0.0), 42.0) * 0.48 * (1.0 - uCloudCover * 0.82);
        float sunDisk = smoothstep(0.9990, 0.99965, sunCos) * 2.1 * (1.0 - uCloudCover * 0.88) * smoothstep(-0.04, 0.05, uSunDir.y);

        col += uSunGlowColor * (mieWide * (0.45 + 0.55 * horizonBand) + mieTight + sunDisk) * max(uDayFactor, uGoldenFactor * 0.7);

        // Soft moon disk & lunar halo opposite the sun at night
        float moonCos = dot(dir, -uSunDir);
        float nightVis = clamp(1.0 - uDayFactor * 1.6, 0.0, 1.0) * (1.0 - uCloudCover * 0.75);
        float moonDisk = smoothstep(0.99925, 0.99965, moonCos) * 1.25 * nightVis;
        float moonHalo = pow(max(moonCos, 0.0), 28.0) * 0.22 * nightVis;
        col += vec3(0.76, 0.86, 1.0) * (moonDisk + moonHalo);

        // Projected planar Baltic cloud layer above horizon (fast 2+1 octave shading)
        if (dir.y > 0.015) {
          float planeT = 1.0 / (dir.y + 0.14);
          vec2 cloudUv = dir.xz * planeT * 0.46 + vec2(uTime * 0.0055, uTime * 0.0022);
          float cVal = cloudFbm(cloudUv);
          float thresh = mix(0.55, 0.22, uCloudCover);
          float density = smoothstep(thresh, thresh + 0.28, cVal);

          // Single-tap light offset toward sun for volumetric sunlit cloud rims
          vec2 sunOff = uSunDir.xz * 0.14;
          float cLight = noise2(cloudUv + sunOff);
          float litFactor = clamp(0.58 + (cVal - cLight) * 2.2 + max(sunCos, 0.0) * 0.38, 0.0, 1.0);
          vec3 cloudCol = mix(uCloudDark, uCloudBright, litFactor);
          cloudCol += uSunGlowColor * pow(max(sunCos, 0.0), 7.0) * 0.34 * (1.0 - density * 0.4) * max(uDayFactor, uGoldenFactor);

          // Dissolve distant clouds smoothly into the horizon mist
          float horizFade = smoothstep(0.015, 0.19, dir.y);
          col = mix(col, cloudCol, density * horizFade * (0.82 + uCloudCover * 0.16));
        }

        // Below-horizon mirror blends cleanly into fog color
        float belowFade = smoothstep(-0.06, 0.02, dir.y);
        col = mix(uHorizonColor * 0.96, col, belowFade);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, material, geometry };
}

/**
 * Lightweight 1-draw-call morning/golden-hour volumetric sunbeam shafts filtering through pine crowns.
 */
function createSunbeamShafts(): {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometry: THREE.BufferGeometry;
} {
  const SHAFT_COUNT = 8;
  const rand = seededRand(5150);
  const positions: number[] = [];
  const uvs: number[] = [];
  const seeds: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < SHAFT_COUNT; i++) {
    const angle = (i / SHAFT_COUNT) * Math.PI * 2 + rand() * 0.45;
    const dist = 14 + rand() * 24;
    const cx = Math.cos(angle) * dist;
    const cz = Math.sin(angle) * dist;
    const w = 3.2 + rand() * 2.8;
    const h = 24 + rand() * 10;
    const rotY = rand() * Math.PI;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const seedVal = rand();

    const baseVert = i * 4;
    const corners: Array<[number, number, number, number]> = [
      [-w * 0.5, 0, 0, 0],
      [w * 0.5, 0, 1, 0],
      [w * 0.65, h, 1, 1],
      [-w * 0.65, h, 0, 1],
    ];
    for (const [lx, ly, u, v] of corners) {
      const wx = cx + lx * cosY;
      const wz = cz + lx * sinY;
      positions.push(wx, ly - 1.5, wz);
      uvs.push(u, v);
      seeds.push(seedVal);
    }
    indices.push(baseVert, baseVert + 1, baseVert + 2, baseVert, baseVert + 2, baseVert + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.5, 0.4, 0.3).normalize() },
      uColor: { value: new THREE.Color(0xffe4ad) },
      uOpacity: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      attribute float aSeed;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying float vSeed;
      varying float vFade;

      void main() {
        vUv = uv;
        vSeed = aSeed;
        vec3 p = position;
        // Lean upper shaft tips gently toward the sun direction
        float topWeight = clamp(uv.y, 0.0, 1.0);
        p.xz += uSunDir.xz * (topWeight * 12.0);
        vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
        float dist = length(mvPos.xyz);
        vFade = smoothstep(5.0, 14.0, dist) * (1.0 - smoothstep(32.0, 52.0, dist));
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      varying float vFade;

      void main() {
        float edgeX = sin(vUv.x * 3.14159265);
        edgeX = edgeX * edgeX;
        float edgeY = smoothstep(0.0, 0.28, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        float shimmer = 0.72 + 0.28 * sin(uTime * 0.45 + vSeed * 12.0 + vUv.x * 4.0);
        float alpha = edgeX * edgeY * shimmer * vFade * uOpacity;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, material, geometry };
}

function createProceduralStarfield(): {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  geometry: THREE.BufferGeometry;
} {
  const STAR_COUNT = 950;
  const rand = seededRand(8842);

  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const brightness = new Float32Array(STAR_COUNT);
  const colors = new Float32Array(STAR_COUNT * 3);
  const twinkle = new Float32Array(STAR_COUNT * 2);

  const palette = [
    new THREE.Color(0xffc994),
    new THREE.Color(0xffe9c8),
    new THREE.Color(0xf7f8ff),
    new THREE.Color(0xc7ddff),
    new THREE.Color(0xa6c8ff),
  ];

  const r = 340;
  const dir = new THREE.Vector3();
  const mwAxis = new THREE.Vector3(0.45, 0.72, -0.52).normalize();
  const tmpQuat = new THREE.Quaternion();

  for (let i = 0; i < STAR_COUNT; i++) {
    const inMilkyWay = i < STAR_COUNT * 0.36;
    if (inMilkyWay) {
      const az = rand() * Math.PI * 2;
      const bandOffset = (rand() + rand() - 1) * 0.24;
      dir.set(Math.cos(az), bandOffset, Math.sin(az)).normalize();
      tmpQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mwAxis);
      dir.applyQuaternion(tmpQuat);
      if (dir.y < 0.02) dir.y = Math.abs(dir.y) + 0.03;
      dir.normalize();
    } else {
      const u = rand();
      const v = rand();
      const theta = u * Math.PI * 2;
      const cosPhi = 0.03 + v * 0.97;
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      dir.set(sinPhi * Math.cos(theta), cosPhi, sinPhi * Math.sin(theta));
    }

    positions[i * 3] = dir.x * r;
    positions[i * 3 + 1] = dir.y * r;
    positions[i * 3 + 2] = dir.z * r;

    const mag = Math.pow(rand(), 3.8);
    const baseBright = inMilkyWay ? 0.18 + mag * 0.72 : 0.28 + mag * 0.92;
    brightness[i] = Math.min(1.0, baseBright);
    sizes[i] = (inMilkyWay ? 1.6 : 1.9) + mag * 4.4;

    const col = palette[Math.floor(Math.pow(rand(), 0.9) * palette.length)];
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;

    twinkle[i * 2] = rand() * Math.PI * 2;
    twinkle[i * 2 + 1] = 1.1 + rand() * 3.2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 2));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aBrightness;
      attribute vec3 aColor;
      attribute vec2 aTwinkle;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vBright;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float elev = clamp(normalize(position).y, 0.0, 1.0);
        float scintAmp = mix(0.28, 0.07, elev);
        float scint = 1.0 + sin(uTime * aTwinkle.y + aTwinkle.x) * scintAmp;
        float horizonFade = smoothstep(0.01, 0.16, elev);
        vAlpha = aBrightness * scint * horizonFade;
        vBright = aBrightness;
        vColor = aColor;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vBright;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float dist2 = dot(uv, uv);
        if (dist2 > 0.25) discard;
        float core = exp(-dist2 * 24.0);
        float halo = exp(-dist2 * 7.5) * 0.35 * vBright;
        float spike = 0.0;
        if (vBright > 0.74) {
          float sx = exp(-abs(uv.y) * 26.0) * exp(-abs(uv.x) * 8.0);
          float sy = exp(-abs(uv.x) * 26.0) * exp(-abs(uv.y) * 8.0);
          spike = (sx + sy) * 0.24 * (vBright - 0.74) * 3.5;
        }
        float intensity = (core + halo + spike) * vAlpha * uOpacity;
        gl_FragColor = vec4(vColor * intensity * (1.0 + core * 0.5), intensity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, material, geometry };
}

function createRainStreakSystem(): {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometry: THREE.InstancedBufferGeometry;
  maxCount: number;
} {
  // Concentrated forward-frustum rain volume: denser in view with ~75% less GPU overdraw!
  const RAIN_MAX_COUNT = 760;
  const rand = seededRand(4099);

  const baseGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
  const instGeo = new THREE.InstancedBufferGeometry();
  instGeo.index = baseGeo.index;
  instGeo.attributes.position = baseGeo.attributes.position;
  instGeo.attributes.uv = baseGeo.attributes.uv;
  instGeo.instanceCount = 480;

  const seeds = new Float32Array(RAIN_MAX_COUNT * 4);
  const scales = new Float32Array(RAIN_MAX_COUNT * 3);

  for (let i = 0; i < RAIN_MAX_COUNT; i++) {
    seeds[i * 4] = rand() * 16.0;
    seeds[i * 4 + 1] = rand() * 13.0;
    seeds[i * 4 + 2] = rand() * 16.0;
    seeds[i * 4 + 3] = 0.84 + rand() * 0.42;

    scales[i * 3] = 0.015 + rand() * 0.011;
    scales[i * 3 + 1] = 0.56 + rand() * 0.64;
    scales[i * 3 + 2] = 0.55 + rand() * 0.45;
  }

  instGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  instGeo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRainCenter: { value: new THREE.Vector3() },
      uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
      uWindX: { value: 1.8 },
      uFallSpeed: { value: 22.0 },
      uOpacity: { value: 0.0 },
      uColor: { value: new THREE.Color(0xdcebf5) },
    },
    vertexShader: `
      attribute vec4 aSeed;
      attribute vec3 aScale;
      uniform float uTime;
      uniform vec3 uRainCenter;
      uniform vec3 uCamFwd;
      uniform float uWindX;
      uniform float uFallSpeed;
      varying vec2 vUv;
      varying float vFade;

      void main() {
        vUv = uv;
        float speed = uFallSpeed * aSeed.w;
        float boxXZ = 16.0;
        float boxY = 13.0;

        vec3 rel = vec3(
          mod(aSeed.x + uTime * uWindX - uRainCenter.x, boxXZ) - boxXZ * 0.5,
          mod(aSeed.y - uTime * speed - uRainCenter.y, boxY) - 2.4,
          mod(aSeed.z - uRainCenter.z, boxXZ) - boxXZ * 0.5
        );
        vec3 worldCenter = uRainCenter + rel;

        // Early vertex-stage frustum cull: collapse streaks behind camera or outside forward cone
        vec3 fromCam = worldCenter - cameraPosition;
        float fwdDot = dot(fromCam, uCamFwd);
        if (fwdDot < 0.75) {
          vFade = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        float camDist = max(length(fromCam), 0.1);
        vec3 toCam = -fromCam / camDist;
        vec3 streakDir = normalize(vec3(-uWindX, speed, 0.0));
        vec3 rawSide = cross(streakDir, toCam);
        float sideLen = length(rawSide);
        vec3 side = sideLen > 0.001 ? rawSide / sideLen : vec3(1.0, 0.0, 0.0);

        // Keep close drops crisp and narrow so they never create giant screen-filling overdraw ribbons
        float closeThin = mix(0.65, 1.0, smoothstep(1.2, 4.5, camDist));
        vec3 vertexWorld = worldCenter
          + side * (position.x * aScale.x * closeThin)
          + streakDir * (position.y * aScale.y);

        float nearFade = smoothstep(0.95, 2.4, camDist);
        float farFade = 1.0 - smoothstep(10.0, 15.2, camDist);
        vFade = aScale.z * nearFade * farFade;

        gl_Position = projectionMatrix * viewMatrix * vec4(vertexWorld, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vFade;

      void main() {
        // Pure polynomial streak taper (zero exp/sin per fragment!)
        float taperY = vUv.y * (1.0 - vUv.y) * 4.0;
        float dx = (vUv.x - 0.5) * 2.0;
        float profileX = max(0.0, 1.0 - dx * dx);
        float alpha = taperY * profileX * profileX * vFade * uOpacity;
        if (alpha < 0.025) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(instGeo, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  baseGeo.dispose();

  return { mesh, material, geometry: instGeo, maxCount: RAIN_MAX_COUNT };
}

export class WeatherAndSkySystem {
  readonly group = new THREE.Group();
  readonly hemiLight: THREE.HemisphereLight;
  readonly sunLight: THREE.DirectionalLight;

  private readonly skyDome: ReturnType<typeof createAtmosphericSkyDome>;
  private readonly sunbeams: ReturnType<typeof createSunbeamShafts>;
  private readonly stars: ReturnType<typeof createProceduralStarfield>;
  private readonly rain: ReturnType<typeof createRainStreakSystem>;
  private readonly fireflies: THREE.Points;
  private readonly ffMat: THREE.PointsMaterial;

  timeOfDay = 9.25; // 09:15 crisp Baltic morning sun
  weatherIdx = 0;
  private weatherTimer = 95;
  private lightningFlash = 0;
  private elapsed = 0;

  private readonly isSoftwareGl: boolean;
  private readonly shadowExtent = 36;
  private readonly shadowTexelSize: number;

  // Reusable colors & vectors (zero per-frame GC allocation)
  private readonly sunDir = new THREE.Vector3(0.5, 0.55, 0.35).normalize();
  private readonly zenithDayClear = new THREE.Color(0x285d96);
  private readonly zenithDayOvercast = new THREE.Color(0x52626d);
  private readonly zenithGolden = new THREE.Color(0x2f5388);
  private readonly zenithNight = new THREE.Color(0x050912);

  private readonly midDayClear = new THREE.Color(0x6c9cc4);
  private readonly midDayOvercast = new THREE.Color(0x74828b);
  private readonly midGolden = new THREE.Color(0xdf8f58);
  private readonly midNight = new THREE.Color(0x0c1422);

  private readonly horizDayClear = new THREE.Color(0xb9d1df);
  private readonly horizDayOvercast = new THREE.Color(0x909ca3);
  private readonly horizGolden = new THREE.Color(0xf7be7c);
  private readonly horizNight = new THREE.Color(0x111a26);

  private readonly curZenith = new THREE.Color();
  private readonly curMid = new THREE.Color();
  private readonly curHorizon = new THREE.Color();
  private readonly curSunCol = new THREE.Color();
  private readonly tmpSunsetTint = new THREE.Color(0xff9a52);
  private readonly tmpCloudBright = new THREE.Color();
  private readonly tmpCloudDark = new THREE.Color();
  private readonly tmpHemiSky = new THREE.Color();
  private readonly tmpHemiGround = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    isSoftwareGl: boolean,
    pixelRatio: number,
    isLowPowerGpu = false
  ) {
    this.isSoftwareGl = isSoftwareGl;
    const shadowRes = isLowPowerGpu ? 768 : 1024;
    this.shadowTexelSize = (this.shadowExtent * 2) / shadowRes;

    scene.background = new THREE.Color(0xb9d1df);
    scene.fog = new THREE.FogExp2(0xb9d1df, 0.0068);

    this.hemiLight = new THREE.HemisphereLight(0xbcd8ee, 0x38472b, 0.72);
    this.group.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 3.0);
    this.sunLight.castShadow = !isSoftwareGl;
    this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
    this.sunLight.shadow.camera.near = 6;
    this.sunLight.shadow.camera.far = 165;
    const dShadow = this.shadowExtent;
    this.sunLight.shadow.camera.left = -dShadow;
    this.sunLight.shadow.camera.right = dShadow;
    this.sunLight.shadow.camera.top = dShadow;
    this.sunLight.shadow.camera.bottom = -dShadow;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.026;
    this.sunLight.shadow.radius = 1.5;
    this.group.add(this.sunLight);
    this.group.add(this.sunLight.target);

    this.skyDome = createAtmosphericSkyDome();
    this.group.add(this.skyDome.mesh);

    this.sunbeams = createSunbeamShafts();
    this.group.add(this.sunbeams.mesh);

    this.stars = createProceduralStarfield();
    this.stars.material.uniforms.uPixelRatio.value = pixelRatio;
    this.group.add(this.stars.points);

    this.rain = createRainStreakSystem();
    this.group.add(this.rain.mesh);

    // Night fireflies
    const FF_COUNT = 160;
    const rand = seededRand(7721);
    const ffPos = new Float32Array(FF_COUNT * 3);
    for (let i = 0; i < FF_COUNT; i++) {
      const fx = (rand() - 0.5) * 210;
      const fz = (rand() - 0.5) * 210;
      ffPos[i * 3] = fx;
      ffPos[i * 3 + 1] = getTerrainHeight(fx, fz) + 0.8 + rand() * 1.8;
      ffPos[i * 3 + 2] = fz;
    }
    const ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
    this.ffMat = new THREE.PointsMaterial({
      color: 0xd9ff73,
      size: 0.2,
      transparent: true,
      opacity: 0,
    });
    this.fireflies = new THREE.Points(ffGeo, this.ffMat);
    this.group.add(this.fireflies);

    scene.add(this.group);
  }

  get currentWeather(): WeatherId {
    return WEATHER_ORDER[this.weatherIdx];
  }

  get isSunCastingShadow(): boolean {
    return !this.isSoftwareGl && this.sunLight.shadow.intensity > 0.02;
  }

  get isSunbeamsVisible(): boolean {
    return this.sunbeams.mesh.visible;
  }

  get isRainVisible(): boolean {
    return this.rain.mesh.visible;
  }

  advanceTime(hours = 2): void {
    this.timeOfDay = (this.timeOfDay + hours) % 24;
  }

  private readonly cCloudGold = new THREE.Color(0xffcfa0);
  private readonly cCloudOvercastBright = new THREE.Color(0x9ca7b0);
  private readonly cCloudNightBright = new THREE.Color(0x162030);
  private readonly cCloudGoldDark = new THREE.Color(0x8c6258);
  private readonly cCloudOvercastDark = new THREE.Color(0x525d66);
  private readonly cCloudNightDark = new THREE.Color(0x090f18);
  private readonly cHemiSkyDay = new THREE.Color(0xdcebf7);
  private readonly cHemiGroundGold = new THREE.Color(0x4a3f26);
  private readonly cHemiGroundNight = new THREE.Color(0x0b1014);

  private snapFogNextFrame = false;

  setWeather(weather: WeatherId, instant = false): WeatherId {
    const idx = WEATHER_ORDER.indexOf(weather);
    if (idx >= 0) {
      this.weatherIdx = idx;
      this.weatherTimer = 85;
      if (instant) {
        const targetRain = weather === 'storm' ? 0.84 : weather === 'rain' ? 0.66 : 0.0;
        this.rain.material.uniforms.uOpacity.value = targetRain;
        this.rain.mesh.visible = targetRain > 0.015;
        this.snapFogNextFrame = true;
      }
    }
    return this.currentWeather;
  }

  cycleWeather(): WeatherId {
    this.weatherIdx = (this.weatherIdx + 1) % WEATHER_ORDER.length;
    this.weatherTimer = 85;
    return this.currentWeather;
  }

  setPixelRatio(pr: number): void {
    this.stars.material.uniforms.uPixelRatio.value = pr;
  }

  setShaderCompilePreview(enabled: boolean): void {
    this.stars.points.visible = enabled;
    this.rain.mesh.visible = enabled;
    this.fireflies.visible = enabled;
    this.sunbeams.mesh.visible = enabled;
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    scene: THREE.Scene,
    sound: SoundEngine,
    flashEl: HTMLElement | null,
    camForward?: THREE.Vector3
  ): SkyFrameState {
    this.elapsed += dt;
    this.timeOfDay = (this.timeOfDay + dt * 0.06) % 24;

    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weatherIdx = (this.weatherIdx + 1 + Math.floor(Math.random() * 2)) % WEATHER_ORDER.length;
      this.weatherTimer = 60 + Math.random() * 75;
    }

    const weather = this.currentWeather;
    const sunAngle = ((this.timeOfDay - 6) / 24) * Math.PI * 2;
    const sunY = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle);
    // Authentic Estonian 59°N latitude sun arc tilted toward southern sky (+Z)
    this.sunDir.set(sunX * 0.92, sunY, 0.39).normalize();

    const sunDist = 118;
    // Texel-snap shadow frustum target so ground shadows stay crisp and shimmer-free while walking
    const snap = this.shadowTexelSize;
    const snapX = Math.round(playerPos.x / snap) * snap;
    const snapZ = Math.round(playerPos.z / snap) * snap;
    const snapY = Math.round(playerPos.y / snap) * snap;
    this.sunLight.target.position.set(snapX, snapY, snapZ);
    this.sunLight.position.set(
      snapX + this.sunDir.x * sunDist,
      snapY + Math.max(12, this.sunDir.y * sunDist),
      snapZ + this.sunDir.z * sunDist
    );
    this.sunLight.target.updateMatrixWorld();

    this.skyDome.mesh.position.copy(playerPos);
    this.stars.points.position.copy(playerPos);
    this.sunbeams.mesh.position.set(playerPos.x, playerPos.y, playerPos.z);

    const dayFactor = THREE.MathUtils.clamp((sunY + 0.1) / 0.42, 0, 1);
    const goldenFactor = THREE.MathUtils.clamp(1 - Math.abs(sunY - 0.14) / 0.28, 0, 1);
    const overcastAmt =
      weather === 'clear' ? 0.0 : weather === 'mist' ? 0.55 : weather === 'rain' ? 0.82 : 0.96;

    // 3-stop atmospheric sky palette blended across day/night, golden hour, and cloud cover
    this.curZenith
      .copy(this.zenithDayClear)
      .lerp(this.zenithDayOvercast, overcastAmt)
      .lerp(this.zenithGolden, goldenFactor * (1 - overcastAmt * 0.65) * 0.65);
    this.curZenith.lerp(this.zenithNight, 1 - dayFactor);

    this.curMid
      .copy(this.midDayClear)
      .lerp(this.midDayOvercast, overcastAmt)
      .lerp(this.midGolden, goldenFactor * (1 - overcastAmt * 0.55) * 0.7);
    this.curMid.lerp(this.midNight, 1 - dayFactor);

    this.curHorizon
      .copy(this.horizDayClear)
      .lerp(this.horizDayOvercast, overcastAmt)
      .lerp(this.horizGolden, goldenFactor * (1 - overcastAmt * 0.55) * 0.78);
    this.curHorizon.lerp(this.horizNight, 1 - dayFactor);

    if (weather === 'storm') {
      this.curZenith.multiplyScalar(0.55);
      this.curMid.multiplyScalar(0.58);
      this.curHorizon.multiplyScalar(0.62);
    }

    // Cloud shading colors (zero per-frame allocations)
    this.tmpCloudBright
      .setHex(0xf8fafc)
      .lerp(this.cCloudGold, goldenFactor * (1 - overcastAmt * 0.5) * 0.75)
      .lerp(this.cCloudOvercastBright, overcastAmt * 0.6)
      .lerp(this.cCloudNightBright, 1 - dayFactor);
    this.tmpCloudDark
      .setHex(0x889cb0)
      .lerp(this.cCloudGoldDark, goldenFactor * (1 - overcastAmt * 0.5) * 0.55)
      .lerp(this.cCloudOvercastDark, overcastAmt * 0.75)
      .lerp(this.cCloudNightDark, 1 - dayFactor);
    if (weather === 'storm') {
      this.tmpCloudBright.multiplyScalar(0.56);
      this.tmpCloudDark.multiplyScalar(0.5);
    }

    const skyU = this.skyDome.material.uniforms;
    skyU.uSunDir.value.copy(this.sunDir);
    skyU.uZenithColor.value.copy(this.curZenith);
    skyU.uMidSkyColor.value.copy(this.curMid);
    skyU.uHorizonColor.value.copy(this.curHorizon);
    skyU.uCloudBright.value.copy(this.tmpCloudBright);
    skyU.uCloudDark.value.copy(this.tmpCloudDark);
    const targetCloud =
      weather === 'clear' ? 0.46 : weather === 'mist' ? 0.68 : weather === 'rain' ? 0.88 : 0.96;
    skyU.uCloudCover.value = THREE.MathUtils.lerp(skyU.uCloudCover.value, targetCloud, Math.min(1, dt * 1.2));
    skyU.uDayFactor.value = dayFactor;
    skyU.uGoldenFactor.value = goldenFactor;
    skyU.uTime.value = this.elapsed;

    // Match scene background & exponential fog to exact sky horizon so distant trees dissolve seamlessly
    (scene.background as THREE.Color).copy(this.curHorizon);
    const fog = scene.fog as THREE.FogExp2;
    fog.color.copy(this.curHorizon);

    const swampHere = getSwampFactor(playerPos.x, playerPos.z);
    let targetFog = 0.0052 + swampHere * 0.0095;
    if (weather === 'mist') targetFog += 0.0135;
    else if (weather === 'rain') targetFog += 0.0085;
    else if (weather === 'storm') targetFog += 0.014;
    if (this.snapFogNextFrame) {
      fog.density = targetFog;
      this.snapFogNextFrame = false;
    } else {
      fog.density = THREE.MathUtils.lerp(fog.density, targetFog, Math.min(1, dt * 1.4));
    }

    const overcast = weather === 'rain' || weather === 'storm';
    const weatherDim =
      weather === 'clear' ? 1.0 : weather === 'mist' ? 0.64 : weather === 'rain' ? 0.45 : 0.32;
    this.sunLight.intensity = THREE.MathUtils.lerp(0.12, 3.15 * weatherDim, dayFactor);
    // Fade shadow.intensity uniform instead of toggling castShadow — avoids 27-shader GLSL recompilation freeze on weather change!
    const targetShadowIntensity = !this.isSoftwareGl && !overcast && dayFactor > 0.2 ? 1.0 : 0.0;
    this.sunLight.shadow.intensity = THREE.MathUtils.lerp(
      this.sunLight.shadow.intensity,
      targetShadowIntensity,
      Math.min(1, dt * 3.0)
    );

    if (dayFactor < 0.15) {
      this.curSunCol.setHex(0x6a8cc4);
    } else {
      this.curSunCol.setHex(0xfff4df).lerp(this.tmpSunsetTint, goldenFactor * 0.68);
    }
    this.sunLight.color.copy(this.curSunCol);
    skyU.uSunGlowColor.value.copy(this.curSunCol);

    // Dynamic outdoor hemisphere sky/forest-bounce lighting (crisp sunlit-vs-shadow contrast!)
    this.tmpHemiSky.copy(this.curMid).lerp(this.cHemiSkyDay, 0.36 * dayFactor);
    this.tmpHemiGround
      .setHex(0x303e22)
      .lerp(this.cHemiGroundGold, goldenFactor * 0.45)
      .lerp(this.cHemiGroundNight, 1 - dayFactor);
    this.hemiLight.color.copy(this.tmpHemiSky);
    this.hemiLight.groundColor.copy(this.tmpHemiGround);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.14, 0.72 * weatherDim, dayFactor);
    scene.environmentIntensity = THREE.MathUtils.lerp(0.08, 0.44 * weatherDim, dayFactor);

    // Volumetric morning / golden-hour sunbeam shafts (disabled in clear midday to avoid zero-value additive overdraw!)
    const beamRaw =
      !overcast && sunY > 0.05 && (goldenFactor > 0.24 || weather === 'mist')
        ? (goldenFactor * 0.08 + (weather === 'mist' ? 0.055 : 0.0) * dayFactor) *
          (0.65 + swampHere * 0.55)
        : 0;
    const beamU = this.sunbeams.material.uniforms;
    beamU.uOpacity.value = THREE.MathUtils.lerp(beamU.uOpacity.value, beamRaw, Math.min(1, dt * 1.8));
    beamU.uSunDir.value.copy(this.sunDir);
    beamU.uColor.value.copy(this.curSunCol);
    beamU.uTime.value = this.elapsed;
    this.sunbeams.mesh.visible = beamU.uOpacity.value > 0.008;

    // Stars & fireflies at dusk/night (hidden behind heavy rain/storm clouds to cut overdraw)
    const starVis = overcast
      ? 0
      : THREE.MathUtils.clamp((1 - dayFactor * 2.1) * (weather === 'clear' ? 0.98 : 0.2), 0, 0.98);
    this.stars.material.uniforms.uOpacity.value = starVis;
    this.stars.material.uniforms.uTime.value = this.elapsed;
    this.stars.points.visible = starVis > 0.02;

    this.ffMat.opacity = overcast ? 0 : THREE.MathUtils.clamp(1 - dayFactor * 2.4, 0, 0.88);
    this.fireflies.visible = this.ffMat.opacity > 0.02;

    const windProfile = getWeatherWindProfile(weather);
    const gustMod =
      0.5 +
      0.5 *
        (Math.sin(this.elapsed * windProfile.gustSpeed) * 0.65 +
          Math.sin(this.elapsed * windProfile.gustSpeed * 2.13 + 1.4) * 0.35);
    const windStrength = windProfile.baseStrength + windProfile.gustAmplitude * gustMod;

    // Forward-frustum GPU-animated rain streaks (dense in view, zero behind-camera waste!)
    const targetRainAlpha = weather === 'storm' ? 0.84 : weather === 'rain' ? 0.66 : 0.0;
    const curRainAlpha = THREE.MathUtils.lerp(
      this.rain.material.uniforms.uOpacity.value,
      targetRainAlpha,
      Math.min(1, dt * 2.2)
    );
    const rainVisible = curRainAlpha > 0.015;
    this.rain.mesh.visible = rainVisible;
    if (rainVisible) {
      this.rain.geometry.instanceCount = weather === 'storm' ? this.rain.maxCount : 480;
      const rainU = this.rain.material.uniforms;
      rainU.uOpacity.value = curRainAlpha;
      rainU.uTime.value = this.elapsed;
      if (camForward) {
        rainU.uCamFwd.value.copy(camForward);
        rainU.uRainCenter.value.set(
          playerPos.x + camForward.x * 6.2,
          playerPos.y + 1.5,
          playerPos.z + camForward.z * 6.2
        );
      } else {
        rainU.uRainCenter.value.set(playerPos.x, playerPos.y + 1.5, playerPos.z);
      }
      rainU.uWindX.value = (weather === 'storm' ? 2.4 : 1.1) * windStrength;
      rainU.uFallSpeed.value = weather === 'storm' ? 28.0 : 21.0;
    } else {
      this.rain.material.uniforms.uOpacity.value = curRainAlpha;
    }

    if (weather === 'storm' && Math.random() < dt * 0.12) {
      this.lightningFlash = 0.85;
      sound.playThunder();
    }
    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.2);
      if (flashEl) {
        flashEl.style.opacity = String(this.lightningFlash * 0.55);
      }
    } else if (flashEl && flashEl.style.opacity !== '0') {
      flashEl.style.opacity = '0';
    }

    const soundWind = THREE.MathUtils.clamp((windStrength - 0.3) / 2.6, 0.15, 1.0);
    sound.updateAmbience(weather, soundWind);

    const hrs = Math.floor(this.timeOfDay);
    const mins = Math.floor((this.timeOfDay - hrs) * 60);
    return {
      timeLabel: `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
      weatherLabel: WEATHER_LABELS[weather],
      lightningStrength: this.lightningFlash,
      windStrength,
      sunDir: this.sunDir,
      sunColor: this.curSunCol,
      skyTopColor: this.curZenith,
      skyHorizonColor: this.curHorizon,
      dayFactor,
      goldenFactor,
      fogDensity: fog.density,
    };
  }

  dispose(): void {
    this.skyDome.geometry.dispose();
    this.skyDome.material.dispose();
    this.sunbeams.geometry.dispose();
    this.sunbeams.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.fireflies.geometry.dispose();
    this.ffMat.dispose();
  }
}
