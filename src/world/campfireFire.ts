import * as THREE from 'three';
import { createSeededRandom } from './seededRandom';

export interface CampfireFireVisual {
  group: THREE.Group;
  setLit: (lit: boolean) => void;
  update: (elapsed: number, dt?: number, onLogCaughtFire?: () => void) => void;
  triggerSparkBurst: (
    localX?: number,
    localY?: number,
    localZ?: number,
    intensity?: number
  ) => void;
  addFuelLog: (
    localX: number,
    localY: number,
    localZ: number,
    rotY?: number
  ) => { willCatchFire: boolean };
  getIntensityBoost: () => number;
  getActiveFuelLogCount: () => number;
  getActiveBurstSparkCount: () => number;
  dispose: () => void;
}

const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.52;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 3; i++) {
      v += a * valueNoise(p);
      p = rot * p * 2.07 + vec2(13.1, 7.7);
      a *= 0.5;
    }
    return v;
  }
`;

interface TongueSpec {
  cx: number;
  cy: number;
  cz: number;
  width: number;
  height: number;
  yaw: number;
  tilt: number;
  seed: number;
  phase: number;
  cycleRate: number;
  tier: number;
}

function buildTongueClusterGeometry(specs: TongueSpec[]): THREE.BufferGeometry {
  const segY = 6;
  const segX = 2;
  const finsPerTongue = 2;
  const vertsPerFin = (segY + 1) * (segX + 1);
  const trisPerFin = segY * segX * 2;
  const totalVerts = specs.length * finsPerTongue * vertsPerFin;
  const totalIndices = specs.length * finsPerTongue * trisPerFin * 3;

  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const flameAttr = new Float32Array(totalVerts * 4);
  const anchorAttr = new Float32Array(totalVerts * 3);
  const indices = new Uint16Array(totalIndices);

  let vCursor = 0;
  let iCursor = 0;

  for (let s = 0; s < specs.length; s++) {
    const sp = specs[s];
    for (let fin = 0; fin < finsPerTongue; fin++) {
      const finYaw = sp.yaw + fin * (Math.PI * 0.46);
      const cosY = Math.cos(finYaw);
      const sinY = Math.sin(finYaw);
      const finBaseVertex = vCursor;

      for (let iy = 0; iy <= segY; iy++) {
        const v = iy / segY;
        const widthProfile = Math.sin(Math.PI * Math.pow(v, 0.62)) * (1.0 - v * 0.28);
        const halfW = Math.max(0.008, sp.width * 0.5 * (0.25 * (1 - v) + widthProfile));
        const lean = Math.sin(v * Math.PI * 0.85) * sp.tilt * sp.height;

        for (let ix = 0; ix <= segX; ix++) {
          const u = ix / segX;
          const lx = (u - 0.5) * 2.0 * halfW;
          const lz = (fin === 0 ? 1 : -1) * Math.sin(v * 3.14 + u * 1.4) * 0.018 + lean * 0.35;
          const ly = v * sp.height;

          positions[vCursor * 3] = sp.cx + lx * cosY - lz * sinY;
          positions[vCursor * 3 + 1] = sp.cy + ly;
          positions[vCursor * 3 + 2] = sp.cz + lx * sinY + lz * cosY;

          uvs[vCursor * 2] = u;
          uvs[vCursor * 2 + 1] = v;

          flameAttr[vCursor * 4] = sp.seed;
          flameAttr[vCursor * 4 + 1] = sp.phase;
          flameAttr[vCursor * 4 + 2] = sp.cycleRate;
          flameAttr[vCursor * 4 + 3] = sp.tier;

          anchorAttr[vCursor * 3] = sp.cx;
          anchorAttr[vCursor * 3 + 1] = sp.cy;
          anchorAttr[vCursor * 3 + 2] = sp.cz;

          vCursor++;
        }
      }

      const stride = segX + 1;
      for (let iy = 0; iy < segY; iy++) {
        for (let ix = 0; ix < segX; ix++) {
          const a = finBaseVertex + iy * stride + ix;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          indices[iCursor++] = a;
          indices[iCursor++] = b;
          indices[iCursor++] = c;
          indices[iCursor++] = b;
          indices[iCursor++] = d;
          indices[iCursor++] = c;
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aFlame', new THREE.BufferAttribute(flameAttr, 4));
  geo.setAttribute('aAnchor', new THREE.BufferAttribute(anchorAttr, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a single merged BufferGeometry containing 22 multi-tiered, crossed-ribbon
 * fire tongues (tall central flames, medium log-ring flames, and low outer flamelets)
 * so the campfire has organic 3D volume from all viewing angles in 1 draw call.
 */
function buildFlameClusterGeometry(seed: number): THREE.BufferGeometry {
  const rng = createSeededRandom(seed ^ 0x517cc1b7);
  const specs: TongueSpec[] = [];

  // Tier 0: 5 tall central hero flame tongues
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + (rng() - 0.5) * 0.55;
    const r = 0.03 + rng() * 0.13;
    specs.push({
      cx: Math.cos(a) * r,
      cy: 0.12 + rng() * 0.07,
      cz: Math.sin(a) * r,
      width: 0.25 + rng() * 0.14,
      height: 0.78 + rng() * 0.36,
      yaw: rng() * Math.PI * 2,
      tilt: (rng() - 0.5) * 0.14,
      seed: rng(),
      phase: rng(),
      cycleRate: 0.42 + rng() * 0.28,
      tier: 0.0,
    });
  }

  // Tier 1: 8 medium inner-ring tongues emerging around crossed logs
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + (rng() - 0.5) * 0.4;
    const r = 0.13 + rng() * 0.18;
    specs.push({
      cx: Math.cos(a) * r,
      cy: 0.08 + rng() * 0.08,
      cz: Math.sin(a) * r,
      width: 0.15 + rng() * 0.1,
      height: 0.42 + rng() * 0.32,
      yaw: a + (rng() - 0.5) * 1.1,
      tilt: 0.06 + rng() * 0.14,
      seed: rng(),
      phase: rng(),
      cycleRate: 0.55 + rng() * 0.38,
      tier: 0.5,
    });
  }

  // Tier 2: 9 low perimeter flamelets licking up around outer sticks & ember bed
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + (rng() - 0.5) * 0.48;
    const r = 0.25 + rng() * 0.22;
    specs.push({
      cx: Math.cos(a) * r,
      cy: 0.04 + rng() * 0.06,
      cz: Math.sin(a) * r,
      width: 0.09 + rng() * 0.07,
      height: 0.18 + rng() * 0.17,
      yaw: a + (rng() - 0.5) * 1.4,
      tilt: 0.08 + rng() * 0.18,
      seed: rng(),
      phase: rng(),
      cycleRate: 0.72 + rng() * 0.48,
      tier: 1.0,
    });
  }

  return buildTongueClusterGeometry(specs);
}

function buildLogFlameClusterGeometry(seed: number): THREE.BufferGeometry {
  const rng = createSeededRandom(seed ^ 0x6a09e667);
  const specs: TongueSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const lx = (i / 4 - 0.5) * 0.38 + (rng() - 0.5) * 0.06;
    const lz = (rng() - 0.5) * 0.07;
    specs.push({
      cx: lx,
      cy: 0.02 + rng() * 0.03,
      cz: lz,
      width: 0.11 + rng() * 0.06,
      height: 0.24 + rng() * 0.22,
      yaw: rng() * Math.PI * 2,
      tilt: (rng() - 0.5) * 0.15,
      seed: rng(),
      phase: rng(),
      cycleRate: 0.58 + rng() * 0.45,
      tier: 0.4 + rng() * 0.4,
    });
  }
  return buildTongueClusterGeometry(specs);
}

function createFlameMaterial(seedPhase: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeedPhase: { value: seedPhase },
      uIntensityScale: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aFlame;
      attribute vec3 aAnchor;

      uniform float uTime;
      uniform float uSeedPhase;
      uniform float uIntensityScale;

      varying vec2 vUv;
      varying vec4 vFlame;
      varying float vLife;

      void main() {
        vUv = uv;
        vFlame = aFlame;

        float t = uTime + uSeedPhase;
        float fSeed = aFlame.x;
        float fPhase = aFlame.y;
        float fRate = aFlame.z;

        // Asynchronous surge & decay cycle per tongue (flames grow, flicker, die down, and re-ignite)
        float macroA = 0.5 + 0.5 * sin(t * fRate * 6.2831853 + fPhase * 6.2831853);
        float macroB = 0.5 + 0.5 * sin(t * (fRate * 1.63) * 6.2831853 + fSeed * 17.3);
        float rapidFlicker = 0.5 + 0.5 * sin(t * (7.2 + fSeed * 6.5) + fPhase * 21.0);
        float life = clamp(
          (0.14 + 0.62 * pow(macroA * 0.65 + macroB * 0.35, 0.9) + 0.30 * rapidFlicker) * uIntensityScale,
          0.0,
          1.45
        );
        vLife = life;

        vec3 rel = position - aAnchor;
        float v = uv.y;

        rel.y *= (0.34 + 0.74 * life);
        rel.xz *= (0.70 + 0.34 * life) * (1.0 - 0.25 * pow(v, 1.5));

        float swayAmp = v * v * (0.065 + 0.055 * life);
        float waveA = sin(t * (4.6 + fSeed * 3.8) - v * 5.2 + fPhase * 12.0);
        float waveB = cos(t * (3.9 + fRate * 2.4) - v * 4.4 + fSeed * 9.0);
        rel.x += waveA * swayAmp;
        rel.z += waveB * swayAmp;

        vec3 pos = aAnchor + rel;
        pos.xz = mix(pos.xz, pos.xz * 0.72, v * (0.28 + 0.15 * aFlame.w));

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeedPhase;
      uniform float uIntensityScale;

      varying vec2 vUv;
      varying vec4 vFlame;
      varying float vLife;

      ${NOISE_GLSL}

      void main() {
        if (uIntensityScale <= 0.01) discard;

        float t = uTime + uSeedPhase;
        float fSeed = vFlame.x;
        float fRate = vFlame.z;
        float fTier = vFlame.w;

        vec2 nUv = vec2(
          vUv.x * 3.1 + fSeed * 13.7,
          vUv.y * 3.8 - t * (2.35 + fRate * 1.35)
        );
        float turb = fbm(nUv);
        float fineTurb = fbm(vec2(
          vUv.x * 6.8 - fSeed * 5.9,
          vUv.y * 7.6 - t * (4.2 + fSeed * 1.8)
        ));

        float edgeDist = abs(vUv.x - 0.5) * 2.0;
        float taper = (1.0 - pow(vUv.y, 1.25)) * (0.76 + 0.42 * turb);
        float lateralMask = 1.0 - smoothstep(0.05, max(0.14, taper), edgeDist + (turb - 0.48) * 0.44);

        float topCut = 0.40 + 0.48 * vLife;
        float vertMask = smoothstep(0.0, 0.13, vUv.y) * (1.0 - smoothstep(topCut * 0.52, topCut + 0.16, vUv.y + (0.5 - turb) * 0.34));

        float mask = clamp(lateralMask * vertMask * (0.62 + 0.58 * fineTurb), 0.0, 1.0);
        if (mask < 0.035) discard;

        // Heat maps along yellowish -> orangeish -> brownish dying sienna gradient
        float heat = clamp(
          mask * (0.42 + 0.68 * vLife) * (1.12 - 0.54 * vUv.y) * mix(1.06, 0.84, fTier) + (fineTurb - 0.45) * 0.16,
          0.0,
          1.25
        );

        vec3 dyingBrown   = vec3(0.21, 0.055, 0.014);
        vec3 warmBrownOrg = vec3(0.56, 0.155, 0.024);
        vec3 richOrange   = vec3(1.02, 0.36,  0.032);
        vec3 goldenYellow = vec3(1.36, 0.80,  0.13);
        vec3 hotYellow    = vec3(1.58, 1.34,  0.64);

        vec3 col = dyingBrown;
        col = mix(col, warmBrownOrg, smoothstep(0.06, 0.28, heat));
        col = mix(col, richOrange,   smoothstep(0.26, 0.54, heat));
        col = mix(col, goldenYellow, smoothstep(0.52, 0.80, heat));
        col = mix(col, hotYellow,    smoothstep(0.78, 1.12, heat));

        float alpha = smoothstep(0.035, 0.38, mask) * clamp((0.62 + 0.36 * vLife) * min(1.0, uIntensityScale * 1.15), 0.0, 0.96);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

function createEmberBedMaterial(seedPhase: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeedPhase: { value: seedPhase },
      uBoost: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vLocalXZ;
      void main() {
        vLocalXZ = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeedPhase;
      uniform float uBoost;
      varying vec2 vLocalXZ;

      ${NOISE_GLSL}

      void main() {
        float r = length(vLocalXZ) / 0.62;
        if (r > 1.0) discard;

        float t = uTime + uSeedPhase;
        float cracks = fbm(vLocalXZ * 8.5 + vec2(0.0, t * 0.06));
        float pulse = 0.5 + 0.5 * sin(t * 2.6 + cracks * 7.5);
        float glow = smoothstep(0.28, 0.82, cracks + 0.16 * pulse + uBoost * 0.14) * (1.0 - smoothstep(0.35, 1.0, r));

        vec3 darkChar = vec3(0.055, 0.025, 0.015);
        vec3 brownEmber = vec3(0.42, 0.10, 0.018);
        vec3 orangeEmber = vec3(1.05, 0.34, 0.03);
        vec3 yellowCoal = vec3(1.42, 0.85, 0.24);

        vec3 col = darkChar;
        col = mix(col, brownEmber, smoothstep(0.05, 0.35, glow));
        col = mix(col, orangeEmber, smoothstep(0.32, 0.68, glow));
        col = mix(col, yellowCoal, smoothstep(0.66, 0.96, glow));

        float alpha = (1.0 - smoothstep(0.68, 1.0, r)) * (0.45 + 0.55 * smoothstep(0.04, 0.45, glow));
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
}

function createBurningLogMaterial(seedPhase: number, initialChar = 0, initialHeat = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeedPhase: { value: seedPhase },
      uChar: { value: initialChar },
      uHeat: { value: initialHeat },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vLocalPos;
      void main() {
        vUv = uv;
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeedPhase;
      uniform float uChar;
      uniform float uHeat;
      varying vec2 vUv;
      varying vec3 vLocalPos;

      ${NOISE_GLSL}

      void main() {
        float t = uTime + uSeedPhase;
        float grain = fbm(vec2(vUv.x * 10.0, vUv.y * 4.5));
        float crack = fbm(vec2(vUv.x * 16.0 + 3.1, vUv.y * 9.0 - 1.7));

        // Fresh split/birch wood darkens toward charcoal as uChar rises
        vec3 freshWood = mix(vec3(0.24, 0.17, 0.11), vec3(0.46, 0.38, 0.27), smoothstep(0.35, 0.72, grain));
        vec3 charWood = mix(vec3(0.04, 0.025, 0.02), vec3(0.09, 0.055, 0.035), grain);
        vec3 baseCol = mix(freshWood, charWood, clamp(uChar, 0.0, 1.0));

        // Underside & ends heat up first, spreading glowing orange/yellow ember cracks
        float endHeat = smoothstep(0.14, 0.32, abs(vLocalPos.y));
        float heatMask = clamp(uHeat * (0.72 + 0.45 * endHeat) - (1.0 - crack) * 0.42, 0.0, 1.0);
        float pulse = 0.78 + 0.22 * sin(t * 4.2 + crack * 9.0);
        float ember = smoothstep(0.15, 0.75, heatMask) * pulse;

        vec3 emberDark = vec3(0.55, 0.12, 0.02);
        vec3 emberHot = vec3(1.45, 0.68, 0.12);
        vec3 emberCol = mix(emberDark, emberHot, smoothstep(0.25, 0.88, ember));

        vec3 col = mix(baseCol, emberCol, ember * 0.92);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function buildAmbientSparksGeometry(seed: number, count = 36): THREE.BufferGeometry {
  const rng = createSeededRandom(seed ^ 0x2c1b3c6d);
  const positions = new Float32Array(count * 3);
  const sparkAttr = new Float32Array(count * 4);
  const sparkExtraAttr = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.04 + rng() * 0.34;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = 0.12 + rng() * 0.14;
    positions[i * 3 + 2] = Math.sin(a) * r;

    sparkAttr[i * 4] = rng(); // phase
    sparkAttr[i * 4 + 1] = 0.22 + rng() * 0.30; // slow intermittent burst freq (~2-4.5s)
    sparkAttr[i * 4 + 2] = 0.95 + rng() * 1.45; // max rise height
    sparkAttr[i * 4 + 3] = rng() * Math.PI * 2; // spiral angle

    sparkExtraAttr[i * 2] = 0.26 + rng() * 0.18; // duty cycle (~26-44% active window = occasional pops!)
    sparkExtraAttr[i * 2 + 1] = 0.8 + rng() * 0.55; // brightness scale
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSpark', new THREE.BufferAttribute(sparkAttr, 4));
  geo.setAttribute('aSparkExtra', new THREE.BufferAttribute(sparkExtraAttr, 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.1, 0), 2.4);
  return geo;
}

function createAmbientSparksMaterial(seedPhase: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeedPhase: { value: seedPhase },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSpark;
      attribute vec2 aSparkExtra;
      uniform float uTime;
      uniform float uSeedPhase;
      varying float vAge;
      varying float vFade;

      void main() {
        float t = uTime + uSeedPhase;
        float freq = aSpark.y;
        float duty = aSparkExtra.x;
        float rawCycle = t * freq + aSpark.x;
        float cycleIdx = floor(rawCycle);
        float cyclePos = fract(rawCycle);

        if (cyclePos >= duty) {
          vAge = 1.0;
          vFade = 0.0;
          gl_PointSize = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        float age = cyclePos / duty;
        vAge = age;
        vFade = aSparkExtra.y;

        // Per-cycle random horizontal offset variation so occasional sparks don't trace identical paths
        float jitterAng = aSpark.w + cycleIdx * 2.39996;
        vec3 pos = position;
        pos.y += pow(age, 0.85) * aSpark.z;
        float drift = age * 0.28;
        pos.x += sin(t * 3.2 + jitterAng + age * 6.5) * drift;
        pos.z += cos(t * 2.8 + jitterAng * 1.3 + age * 5.4) * drift;

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        float pxSize = mix(15.0, 3.8, age);
        gl_PointSize = clamp(pxSize / max(0.8, -mvPos.z), 1.5, 8.5);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAge;
      varying float vFade;

      void main() {
        if (vFade <= 0.001) discard;
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;

        float soft = smoothstep(0.5, 0.08, d);
        float fade = smoothstep(0.0, 0.10, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
        vec3 col = mix(vec3(1.55, 1.10, 0.36), vec3(0.78, 0.20, 0.025), smoothstep(0.15, 0.9, vAge));
        gl_FragColor = vec4(col, soft * fade * vFade * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const MAX_BURST_SPARKS = 140;

function createBurstSparksMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aBurst;
      uniform float uTime;
      varying float vAgeFrac;
      varying float vSeed;

      void main() {
        vAgeFrac = aBurst.x;
        vSeed = aBurst.y;

        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float flicker = 0.78 + 0.22 * sin(uTime * 28.0 + vSeed * 40.0);
        float pxSize = mix(20.0, 4.5, vAgeFrac) * (0.75 + 0.5 * vSeed) * flicker;
        gl_PointSize = clamp(pxSize / max(0.75, -mvPos.z), 1.5, 12.0);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAgeFrac;
      varying float vSeed;

      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;

        float soft = smoothstep(0.5, 0.05, d);
        float fade = smoothstep(0.0, 0.06, vAgeFrac) * (1.0 - smoothstep(0.45, 1.0, vAgeFrac));

        vec3 hotGold = vec3(1.8, 1.4, 0.52);
        vec3 fieryOrange = vec3(1.32, 0.46, 0.045);
        vec3 coolingBrown = vec3(0.42, 0.11, 0.018);

        vec3 col = mix(hotGold, fieryOrange, smoothstep(0.08, 0.48, vAgeFrac));
        col = mix(col, coolingBrown, smoothstep(0.48, 0.95, vAgeFrac));

        gl_FragColor = vec4(col, soft * fade * 0.96);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

interface BurstParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
  seed: number;
}

const LOG_CATCH_DELAY_SEC = 1.9;
const LOG_GLOW_START_SEC = 0.9;
const LOG_GLOW_RAMP_SEC = 3.4;
const LOG_BURN_DURATION_SEC = 44.0;
const MAX_ADDED_LOGS = 6;

interface BaseLogSlot {
  logMat: THREE.ShaderMaterial;
  flameMat: THREE.ShaderMaterial;
  flameMesh: THREE.Mesh;
  burnAge: number;
  catchDelay: number;
  caughtFire: boolean;
}

interface FuelLogSlot {
  wrapper: THREE.Group;
  logMat: THREE.ShaderMaterial;
  flameMat: THREE.ShaderMaterial;
  flameMesh: THREE.Mesh;
  age: number;
  ignitionTime: number;
  caughtFire: boolean;
  ignitedInFire: boolean;
  seed: number;
}

export function createCampfireFireVisual(
  seed: number,
  initiallyLit: boolean
): CampfireFireVisual {
  const group = new THREE.Group();
  let isLit = initiallyLit;

  const litGroup = new THREE.Group();
  litGroup.visible = initiallyLit;

  const baseLogsGroup = new THREE.Group();
  const fuelLogsGroup = new THREE.Group();
  group.add(litGroup, baseLogsGroup, fuelLogsGroup);

  const seedPhase = ((seed >>> 0) % 1000) * 0.037;
  const rng = createSeededRandom(seed ^ 0x9e3779b9);

  // 0. Permanent hearth logs arranged in a crossed cradle that glow & catch fire when lit
  const baseLogGeo = new THREE.CylinderGeometry(0.078, 0.092, 0.88, 7);
  const baseLogFlameGeo = buildLogFlameClusterGeometry(seed + 7);
  const baseLogsSpec: Array<{ px: number; py: number; pz: number; rx: number; ry: number; rz: number }> = [
    { px: 0.0, py: 0.11, pz: 0.08, rx: 0.05, ry: 0.28, rz: Math.PI / 2 - 0.1 },
    { px: 0.06, py: 0.16, pz: -0.06, rx: -0.06, ry: -0.85, rz: Math.PI / 2 + 0.14 },
    { px: -0.07, py: 0.19, pz: 0.02, rx: 0.08, ry: 1.28, rz: Math.PI / 2 - 0.16 },
    { px: 0.02, py: 0.15, pz: -0.11, rx: -0.04, ry: 2.15, rz: Math.PI / 2 + 0.12 },
  ];
  const baseLogSlots: BaseLogSlot[] = [];
  for (let i = 0; i < baseLogsSpec.length; i++) {
    const ls = baseLogsSpec[i];
    const bWrap = new THREE.Group();
    bWrap.position.set(ls.px, ls.py, ls.pz);
    bWrap.rotation.set(ls.rx, ls.ry, ls.rz);

    const logMat = createBurningLogMaterial(seedPhase + i * 2.3, 1.0, initiallyLit ? 0.84 : 0.0);
    const lm = new THREE.Mesh(baseLogGeo, logMat);
    lm.receiveShadow = true;
    lm.raycast = () => {};

    // Place log flame tongues in horizontal world-aligned orientation along each log
    const flameWrapper = new THREE.Group();
    flameWrapper.position.set(ls.px, ls.py + 0.02, ls.pz);
    flameWrapper.rotation.y = ls.ry;
    const bFlameMat = createFlameMaterial(seedPhase + i * 5.7);
    bFlameMat.uniforms.uIntensityScale.value = initiallyLit ? 0.82 : 0.0;
    const bFlameMesh = new THREE.Mesh(baseLogFlameGeo, bFlameMat);
    bFlameMesh.scale.set(1.25, 0.92, 1.0);
    bFlameMesh.renderOrder = 2;
    bFlameMesh.frustumCulled = false;
    bFlameMesh.visible = initiallyLit;
    bFlameMesh.raycast = () => {};
    flameWrapper.add(bFlameMesh);

    bWrap.add(lm);
    baseLogsGroup.add(bWrap, flameWrapper);
    baseLogSlots.push({
      logMat,
      flameMat: bFlameMat,
      flameMesh: bFlameMesh,
      burnAge: initiallyLit ? 5.0 : 0.0,
      catchDelay: 0.9 + i * 0.25 + rng() * 0.25,
      caughtFire: initiallyLit,
    });
  }

  // 1. Glowing cracked ember/coal mound tucked beneath the charred logs
  const emberGeo = new THREE.CircleGeometry(0.62, 20);
  emberGeo.rotateX(-Math.PI / 2);
  const emberMat = createEmberBedMaterial(seedPhase);
  const emberMesh = new THREE.Mesh(emberGeo, emberMat);
  emberMesh.position.y = 0.048;
  emberMesh.renderOrder = 1;
  emberMesh.raycast = () => {};

  // 2. Multi-tiered cluster of flickering, rising & dying fire tongues
  const flameGeo = buildFlameClusterGeometry(seed);
  const flameMat = createFlameMaterial(seedPhase);
  const flameMesh = new THREE.Mesh(flameGeo, flameMat);
  flameMesh.renderOrder = 2;
  flameMesh.frustumCulled = false;
  flameMesh.raycast = () => {};

  // 3. Occasional rising ambient sparks when lit
  const sparksGeo = buildAmbientSparksGeometry(seed, 36);
  const sparksMat = createAmbientSparksMaterial(seedPhase);
  const sparksPoints = new THREE.Points(sparksGeo, sparksMat);
  sparksPoints.renderOrder = 3;
  sparksPoints.frustumCulled = false;
  sparksPoints.raycast = () => {};

  // 4. Dynamic spark cloud burst system (for logs landing in fire & catching fire)
  const burstPosArr = new Float32Array(MAX_BURST_SPARKS * 3);
  const burstAttrArr = new Float32Array(MAX_BURST_SPARKS * 2);
  const burstGeo = new THREE.BufferGeometry();
  const burstPosAttr = new THREE.BufferAttribute(burstPosArr, 3);
  burstPosAttr.setUsage(THREE.DynamicDrawUsage);
  const burstDataAttr = new THREE.BufferAttribute(burstAttrArr, 2);
  burstDataAttr.setUsage(THREE.DynamicDrawUsage);
  burstGeo.setAttribute('position', burstPosAttr);
  burstGeo.setAttribute('aBurst', burstDataAttr);
  burstGeo.setDrawRange(0, 0);
  burstGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.4, 0), 4.5);

  const burstMat = createBurstSparksMaterial();
  const burstPoints = new THREE.Points(burstGeo, burstMat);
  burstPoints.renderOrder = 4;
  burstPoints.frustumCulled = false;
  burstPoints.visible = false;
  burstPoints.raycast = () => {};

  litGroup.add(emberMesh, flameMesh, sparksPoints, burstPoints);

  const burstParticles: BurstParticle[] = [];

  // Shared geometry for any logs tossed into the fire
  const addedLogGeo = new THREE.CylinderGeometry(0.068, 0.082, 0.54, 7);
  const addedLogFlameGeo = buildLogFlameClusterGeometry(seed + 19);
  const fuelLogSlots: FuelLogSlot[] = [];
  const logDisposables: Array<{ dispose: () => void }> = [];

  let prevElapsed: number | null = null;
  let fuelBoost = 0;

  function triggerSparkBurst(
    localX = 0,
    localY = 0.18,
    localZ = 0,
    intensity = 1.0
  ): void {
    const count = Math.max(12, Math.round(92 * THREE.MathUtils.clamp(intensity, 0.2, 1.5)));
    for (let i = 0; i < count; i++) {
      if (burstParticles.length >= MAX_BURST_SPARKS) {
        burstParticles.shift();
      }
      const ang = rng() * Math.PI * 2;
      const radialSpeed = (0.7 + rng() * 2.6) * (0.65 + 0.45 * intensity);
      const upSpeed = (2.1 + rng() * 3.8) * (0.7 + 0.35 * intensity);
      const offsetR = rng() * 0.24;
      burstParticles.push({
        x: localX + Math.cos(ang) * offsetR,
        y: localY + rng() * 0.14,
        z: localZ + Math.sin(ang) * offsetR,
        vx: Math.cos(ang) * radialSpeed,
        vy: upSpeed,
        vz: Math.sin(ang) * radialSpeed,
        age: 0,
        maxAge: 0.72 + rng() * 1.18,
        seed: rng(),
      });
    }
    syncBurstGeometry();
  }

  function syncBurstGeometry(): void {
    const active = burstParticles.length;
    for (let i = 0; i < active; i++) {
      const p = burstParticles[i];
      burstPosArr[i * 3] = p.x;
      burstPosArr[i * 3 + 1] = p.y;
      burstPosArr[i * 3 + 2] = p.z;
      burstAttrArr[i * 2] = Math.min(1, p.age / Math.max(0.01, p.maxAge));
      burstAttrArr[i * 2 + 1] = p.seed;
    }
    burstPosAttr.needsUpdate = true;
    burstDataAttr.needsUpdate = true;
    burstGeo.setDrawRange(0, active);
    burstPoints.visible = active > 0;
  }

  function addFuelLog(
    localX: number,
    localY: number,
    localZ: number,
    rotY = rng() * Math.PI
  ): { willCatchFire: boolean } {
    if (fuelLogSlots.length >= MAX_ADDED_LOGS) {
      const oldest = fuelLogSlots.shift()!;
      fuelLogsGroup.remove(oldest.wrapper);
      oldest.logMat.dispose();
      oldest.flameMat.dispose();
    }

    const slotSeed = rng();
    const wrapper = new THREE.Group();
    wrapper.position.set(
      THREE.MathUtils.clamp(localX, -0.42, 0.42),
      THREE.MathUtils.clamp(localY, 0.1, 0.28),
      THREE.MathUtils.clamp(localZ, -0.42, 0.42)
    );
    wrapper.rotation.y = rotY;
    wrapper.rotation.x = (rng() - 0.5) * 0.24;
    wrapper.rotation.z = (rng() - 0.5) * 0.18;

    const logMat = createBurningLogMaterial(seedPhase + slotSeed * 10);
    const logMesh = new THREE.Mesh(addedLogGeo, logMat);
    logMesh.rotation.z = Math.PI / 2;
    logMesh.castShadow = false;
    logMesh.receiveShadow = true;
    logMesh.raycast = () => {};

    const flameMat = createFlameMaterial(seedPhase + slotSeed * 17.3);
    flameMat.uniforms.uIntensityScale.value = 0.0;
    const logFlameMesh = new THREE.Mesh(addedLogFlameGeo, flameMat);
    logFlameMesh.renderOrder = 3;
    logFlameMesh.frustumCulled = false;
    logFlameMesh.visible = false;
    logFlameMesh.raycast = () => {};

    wrapper.add(logMesh, logFlameMesh);
    fuelLogsGroup.add(wrapper);
    logDisposables.push(logMat, flameMat);

    const slot: FuelLogSlot = {
      wrapper,
      logMat,
      flameMat,
      flameMesh: logFlameMesh,
      age: 0,
      ignitionTime: LOG_CATCH_DELAY_SEC + rng() * 0.6,
      caughtFire: false,
      ignitedInFire: isLit,
      seed: slotSeed,
    };
    fuelLogSlots.push(slot);

    if (isLit) {
      triggerSparkBurst(wrapper.position.x, wrapper.position.y + 0.06, wrapper.position.z, 1.0);
    }

    return { willCatchFire: isLit };
  }

  return {
    group,
    setLit: (lit: boolean) => {
      isLit = lit;
      litGroup.visible = lit;
      if (lit) {
        // Base hearth logs heat up and catch fire smoothly when ignited
        for (let i = 0; i < baseLogSlots.length; i++) {
          const b = baseLogSlots[i];
          b.burnAge = 0;
          b.caughtFire = false;
          b.flameMesh.visible = false;
          b.flameMat.uniforms.uIntensityScale.value = 0;
        }
        // Any cold logs stacked in the pit immediately begin heating up to catch fire
        for (let i = 0; i < fuelLogSlots.length; i++) {
          const s = fuelLogSlots[i];
          if (!s.ignitedInFire) {
            s.ignitedInFire = true;
            s.age = 0;
          }
          s.flameMesh.visible = s.caughtFire;
        }
      } else {
        burstParticles.length = 0;
        syncBurstGeometry();
        fuelBoost = 0;
        for (let i = 0; i < baseLogSlots.length; i++) {
          const b = baseLogSlots[i];
          b.caughtFire = false;
          b.burnAge = 0;
          b.logMat.uniforms.uHeat.value = 0;
          b.flameMesh.visible = false;
          b.flameMat.uniforms.uIntensityScale.value = 0;
        }
        for (let i = 0; i < fuelLogSlots.length; i++) {
          fuelLogSlots[i].flameMesh.visible = false;
        }
      }
    },
    triggerSparkBurst,
    addFuelLog,
    getIntensityBoost: () => fuelBoost,
    getActiveFuelLogCount: () => fuelLogSlots.length,
    getActiveBurstSparkCount: () => burstParticles.length,
    update: (elapsed: number, explicitDt?: number, onLogCaughtFire?: () => void) => {
      const dt =
        explicitDt !== undefined
          ? Math.max(0, Math.min(0.1, explicitDt))
          : prevElapsed !== null
            ? Math.max(0, Math.min(0.1, elapsed - prevElapsed))
            : 1 / 60;
      prevElapsed = elapsed;

      if (!isLit) return;

      if (fuelBoost > 0) {
        fuelBoost = Math.max(0, fuelBoost - dt * 0.065);
      }

      flameMat.uniforms.uTime.value = elapsed;
      flameMat.uniforms.uIntensityScale.value = 1.0 + fuelBoost;
      emberMat.uniforms.uTime.value = elapsed;
      emberMat.uniforms.uBoost.value = fuelBoost;
      sparksMat.uniforms.uTime.value = elapsed;
      burstMat.uniforms.uTime.value = elapsed;

      // Step transient spark cloud particles
      if (burstParticles.length > 0 && dt > 0) {
        const drag = Math.exp(-2.15 * dt);
        for (let i = burstParticles.length - 1; i >= 0; i--) {
          const p = burstParticles[i];
          p.age += dt;
          if (p.age >= p.maxAge) {
            burstParticles.splice(i, 1);
            continue;
          }
          const ageFrac = p.age / p.maxAge;
          p.vx *= drag;
          p.vz *= drag;
          // Strong initial burst rises then slows gently under gravity & thermal curl
          p.vy = p.vy * Math.exp(-1.15 * dt) + (1.2 - 2.3 * ageFrac) * dt;
          p.vx += Math.sin(elapsed * 7.2 + p.seed * 25.0 + p.y * 4.0) * 0.55 * dt;
          p.vz += Math.cos(elapsed * 6.4 + p.seed * 19.0 + p.y * 3.5) * 0.55 * dt;

          p.x += p.vx * dt;
          p.y = Math.max(0.05, p.y + p.vy * dt);
          p.z += p.vz * dt;
        }
        syncBurstGeometry();
      }

      // Step existing permanent hearth base logs (glowing embers + licking log flames)
      for (let i = 0; i < baseLogSlots.length; i++) {
        const b = baseLogSlots[i];
        b.burnAge += dt;
        b.logMat.uniforms.uTime.value = elapsed;
        const baseHeat = Math.min(0.88, Math.pow(Math.min(1, b.burnAge / 3.2), 1.2) * 0.88);
        b.logMat.uniforms.uHeat.value = Math.min(1.0, baseHeat + fuelBoost * 0.22);

        if (!b.caughtFire && b.burnAge >= b.catchDelay) {
          b.caughtFire = true;
          b.flameMesh.visible = true;
        }
        if (b.caughtFire) {
          const ramp = Math.min(1, (b.burnAge - b.catchDelay) / 0.55);
          b.flameMat.uniforms.uTime.value = elapsed;
          b.flameMat.uniforms.uIntensityScale.value = ramp * (0.8 + fuelBoost * 0.55);
        }
      }

      // Step fuel logs tossed into the fire (char first, glow gradually, catch fire after ~2s)
      for (let i = fuelLogSlots.length - 1; i >= 0; i--) {
        const slot = fuelLogSlots[i];
        slot.age += dt;
        slot.logMat.uniforms.uTime.value = elapsed;

        if (!slot.ignitedInFire) {
          slot.ignitedInFire = true;
          slot.age = 0;
        }

        // Fresh wood blackens/chars over ~2.2s while ember glow ramps up more gradually after LOG_GLOW_START_SEC
        const burnDownFade =
          slot.age > LOG_BURN_DURATION_SEC - 10
            ? Math.max(0, (LOG_BURN_DURATION_SEC - slot.age) / 10)
            : 1.0;
        const charProgress = Math.min(1, slot.age / 2.2);
        const glowRaw = Math.max(0, Math.min(1, (slot.age - LOG_GLOW_START_SEC) / LOG_GLOW_RAMP_SEC));
        const glowProgress = glowRaw * glowRaw * (3 - 2 * glowRaw);

        slot.logMat.uniforms.uChar.value = charProgress;
        slot.logMat.uniforms.uHeat.value = glowProgress * 0.96 * (0.35 + 0.65 * burnDownFade);

        if (!slot.caughtFire && slot.age >= slot.ignitionTime) {
          slot.caughtFire = true;
          slot.flameMesh.visible = true;
          fuelBoost = Math.min(0.45, fuelBoost + 0.24);
          triggerSparkBurst(
            slot.wrapper.position.x,
            slot.wrapper.position.y + 0.1,
            slot.wrapper.position.z,
            0.38
          );
          onLogCaughtFire?.();
        }

        if (slot.caughtFire) {
          const sinceCatch = slot.age - slot.ignitionTime;
          const rampUp = Math.min(1, sinceCatch / 0.65);
          slot.flameMat.uniforms.uTime.value = elapsed;
          slot.flameMat.uniforms.uIntensityScale.value = rampUp * burnDownFade * 0.95;
          slot.wrapper.scale.setScalar(0.55 + 0.45 * burnDownFade);
        }

        if (slot.age >= LOG_BURN_DURATION_SEC) {
          fuelLogsGroup.remove(slot.wrapper);
          slot.logMat.dispose();
          slot.flameMat.dispose();
          fuelLogSlots.splice(i, 1);
        }
      }
    },
    dispose: () => {
      baseLogGeo.dispose();
      baseLogFlameGeo.dispose();
      for (const b of baseLogSlots) {
        b.logMat.dispose();
        b.flameMat.dispose();
      }
      baseLogSlots.length = 0;
      emberGeo.dispose();
      emberMat.dispose();
      flameGeo.dispose();
      flameMat.dispose();
      sparksGeo.dispose();
      sparksMat.dispose();
      burstGeo.dispose();
      burstMat.dispose();
      addedLogGeo.dispose();
      addedLogFlameGeo.dispose();
      for (const d of logDisposables) {
        d.dispose();
      }
      fuelLogSlots.length = 0;
      burstParticles.length = 0;
    },
  };
}
