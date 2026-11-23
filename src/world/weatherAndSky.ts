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

function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  // Realistic stellar temperature palette
  const palette = [
    new THREE.Color(0xffc994), // K-type warm amber
    new THREE.Color(0xffe9c8), // G-type warm white
    new THREE.Color(0xf7f8ff), // F/A-type crisp white
    new THREE.Color(0xc7ddff), // B-type cool blue-white
    new THREE.Color(0xa6c8ff), // O/B-type sapphire
  ];

  const r = 340;
  const dir = new THREE.Vector3();
  const mwAxis = new THREE.Vector3(0.45, 0.72, -0.52).normalize();
  const tmpQuat = new THREE.Quaternion();

  for (let i = 0; i < STAR_COUNT; i++) {
    const inMilkyWay = i < STAR_COUNT * 0.36;
    if (inMilkyWay) {
      // Cluster along galactic plane band
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

    // Power-law stellar magnitude distribution: many dim, few bright
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
        // Stronger scintillation near the horizon
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
        // Soft radial PSF core + subtle halo for bright stars (zero square pixels)
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
} {
  const RAIN_COUNT = 1500;
  const rand = seededRand(4099);

  // Unit quad [-0.5..0.5, 0..1] per streak instance
  const baseGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
  const instGeo = new THREE.InstancedBufferGeometry();
  instGeo.index = baseGeo.index;
  instGeo.attributes.position = baseGeo.attributes.position;
  instGeo.attributes.uv = baseGeo.attributes.uv;
  instGeo.instanceCount = RAIN_COUNT;

  const seeds = new Float32Array(RAIN_COUNT * 4);
  const scales = new Float32Array(RAIN_COUNT * 3);

  for (let i = 0; i < RAIN_COUNT; i++) {
    seeds[i * 4] = rand() * 22;
    seeds[i * 4 + 1] = rand() * 16;
    seeds[i * 4 + 2] = rand() * 22;
    seeds[i * 4 + 3] = 0.82 + rand() * 0.45;

    scales[i * 3] = 0.02 + rand() * 0.016;    // slim crisp droplet streak width
    scales[i * 3 + 1] = 0.62 + rand() * 0.78;  // elongated streak length
    scales[i * 3 + 2] = 0.55 + rand() * 0.45;  // alpha variation
  }

  instGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  instGeo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPlayerPos: { value: new THREE.Vector3() },
      uWindX: { value: 1.8 },
      uFallSpeed: { value: 22.0 },
      uOpacity: { value: 0.0 },
      uColor: { value: new THREE.Color(0xdcebf5) },
    },
    vertexShader: `
      attribute vec4 aSeed;
      attribute vec3 aScale;
      uniform float uTime;
      uniform vec3 uPlayerPos;
      uniform float uWindX;
      uniform float uFallSpeed;
      varying vec2 vUv;
      varying float vFade;

      void main() {
        vUv = uv;
        float speed = uFallSpeed * aSeed.w;
        float boxXZ = 22.0;
        float boxY = 16.0;

        vec3 rel = vec3(
          mod(aSeed.x + uTime * uWindX - uPlayerPos.x, boxXZ) - boxXZ * 0.5,
          mod(aSeed.y - uTime * speed - uPlayerPos.y, boxY) - 3.0,
          mod(aSeed.z - uPlayerPos.z, boxXZ) - boxXZ * 0.5
        );
        vec3 worldCenter = uPlayerPos + rel;

        // Streak direction matches actual wind-slanted raindrop velocity; guard overhead cross singularity
        vec3 streakDir = normalize(vec3(-uWindX, speed, 0.0));
        vec3 camDelta = cameraPosition - worldCenter;
        float camDist = max(length(camDelta), 0.05);
        vec3 toCam = camDelta / camDist;
        vec3 rawSide = cross(streakDir, toCam);
        float sideLen = length(rawSide);
        vec3 side = sideLen > 0.001 ? rawSide / sideLen : vec3(1.0, 0.0, 0.0);

        vec3 vertexWorld = worldCenter
          + side * (position.x * aScale.x)
          + streakDir * (position.y * aScale.y);

        float dist = length(rel.xz);
        float nearFade = smoothstep(0.7, 2.0, dist);
        float farFade = 1.0 - smoothstep(8.0, 12.2, dist);
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
        float taperY = sin(vUv.y * 3.14159265);
        float dx = (vUv.x - 0.5) * 3.0;
        float profileX = exp(-dx * dx);
        float alpha = taperY * profileX * vFade * uOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(instGeo, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  baseGeo.dispose();

  return { mesh, material, geometry: instGeo };
}

export class WeatherAndSkySystem {
  readonly group = new THREE.Group();
  readonly hemiLight: THREE.HemisphereLight;
  readonly sunLight: THREE.DirectionalLight;

  private readonly sunMesh: THREE.Mesh;
  private readonly moonMesh: THREE.Mesh;
  private readonly stars: ReturnType<typeof createProceduralStarfield>;
  private readonly rain: ReturnType<typeof createRainStreakSystem>;
  private readonly fireflies: THREE.Points;
  private readonly ffMat: THREE.PointsMaterial;

  timeOfDay = 9.25; // 09:15 crisp Estonian morning
  weatherIdx = 0;
  private weatherTimer = 95;
  private lightningFlash = 0;
  private elapsed = 0;

  private readonly isSoftwareGl: boolean;
  private readonly tmpDaySky = new THREE.Color();
  private readonly tmpGoldenSky = new THREE.Color(0xc98b63);
  private readonly tmpNightSky = new THREE.Color(0x091018);
  private readonly tmpSky = new THREE.Color();
  private readonly tmpSunCol = new THREE.Color();
  private readonly tmpSunsetTint = new THREE.Color(0xff9c59);

  constructor(scene: THREE.Scene, isSoftwareGl: boolean, pixelRatio: number) {
    this.isSoftwareGl = isSoftwareGl;
    scene.background = new THREE.Color(0x9cb5bd);
    scene.fog = new THREE.FogExp2(0x9cb5bd, 0.0085);

    this.hemiLight = new THREE.HemisphereLight(0xcbe0ee, 0x3b4832, 0.7);
    this.group.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 1.85);
    this.sunLight.castShadow = !isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 180;
    const dShadow = 52;
    this.sunLight.shadow.camera.left = -dShadow;
    this.sunLight.shadow.camera.right = dShadow;
    this.sunLight.shadow.camera.top = dShadow;
    this.sunLight.shadow.camera.bottom = -dShadow;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.group.add(this.sunLight);
    this.group.add(this.sunLight.target);

    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(6.5, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false })
    );
    this.group.add(this.sunMesh);

    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xdbe7ff, fog: false })
    );
    this.group.add(this.moonMesh);

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
    return this.sunLight.castShadow;
  }

  advanceTime(hours = 2): void {
    this.timeOfDay = (this.timeOfDay + hours) % 24;
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
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    scene: THREE.Scene,
    sound: SoundEngine,
    flashEl: HTMLElement | null
  ): { timeLabel: string; weatherLabel: string; lightningStrength: number; windStrength: number } {
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

    const sunDist = 140;
    this.sunLight.position.set(
      playerPos.x + sunX * sunDist,
      Math.max(10, sunY * sunDist),
      playerPos.z + 50
    );
    this.sunLight.target.position.copy(playerPos);
    this.sunLight.target.updateMatrixWorld();

    this.sunMesh.position.set(playerPos.x + sunX * 300, sunY * 300, playerPos.z + 95);
    this.sunMesh.visible = sunY > -0.1;

    this.moonMesh.position.set(playerPos.x - sunX * 300, -sunY * 300, playerPos.z - 95);
    this.moonMesh.visible = sunY < 0.15;

    this.stars.points.position.copy(playerPos);

    const dayFactor = THREE.MathUtils.clamp((sunY + 0.12) / 0.45, 0, 1);
    const goldenFactor = THREE.MathUtils.clamp(1 - Math.abs(sunY - 0.08) / 0.22, 0, 1);

    this.tmpDaySky.setHex(weather === 'clear' ? 0x9ec0d4 : 0x7b8b91);
    this.tmpSky
      .copy(this.tmpNightSky)
      .lerp(this.tmpDaySky, dayFactor)
      .lerp(this.tmpGoldenSky, goldenFactor * (weather === 'clear' ? 0.55 : 0.2));
    if (weather === 'storm') this.tmpSky.multiplyScalar(0.55);

    (scene.background as THREE.Color).copy(this.tmpSky);
    const fog = scene.fog as THREE.FogExp2;
    fog.color.copy(this.tmpSky);

    const swampHere = getSwampFactor(playerPos.x, playerPos.z);
    let targetFog = 0.0055 + swampHere * 0.011;
    if (weather === 'mist') targetFog += 0.016;
    else if (weather === 'rain') targetFog += 0.009;
    else if (weather === 'storm') targetFog += 0.015;
    fog.density = THREE.MathUtils.lerp(fog.density, targetFog, Math.min(1, dt * 1.4));

    const overcast = weather === 'rain' || weather === 'storm';
    const weatherDim =
      weather === 'clear' ? 1.0 : weather === 'mist' ? 0.55 : weather === 'rain' ? 0.44 : 0.3;
    this.sunLight.intensity = THREE.MathUtils.lerp(0.08, 2.0 * weatherDim, dayFactor);
    // Overcast rain/storm clouds diffuse sunlight; skip expensive 1024x1024 shadow pass in overcast & deep dusk
    this.sunLight.castShadow = !this.isSoftwareGl && !overcast && dayFactor > 0.2;
    if (dayFactor < 0.15) {
      this.sunLight.color.setHex(0x6484b8);
    } else {
      this.tmpSunCol.setHex(0xfff1d6).lerp(this.tmpSunsetTint, goldenFactor * 0.65);
      this.sunLight.color.copy(this.tmpSunCol);
    }
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.08, 0.72 * weatherDim, dayFactor);
    scene.environmentIntensity = THREE.MathUtils.lerp(0.05, 0.45 * weatherDim, dayFactor);

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

    // GPU-animated rain streaks
    const targetRainAlpha = weather === 'storm' ? 0.82 : weather === 'rain' ? 0.64 : 0.0;
    const curRainAlpha = THREE.MathUtils.lerp(
      this.rain.material.uniforms.uOpacity.value,
      targetRainAlpha,
      Math.min(1, dt * 2.2)
    );
    this.rain.material.uniforms.uOpacity.value = curRainAlpha;
    this.rain.material.uniforms.uTime.value = this.elapsed;
    this.rain.material.uniforms.uPlayerPos.value.copy(playerPos);
    this.rain.material.uniforms.uWindX.value =
      (weather === 'storm' ? 2.4 : 1.1) * windStrength;
    this.rain.material.uniforms.uFallSpeed.value = weather === 'storm' ? 28.0 : 21.0;
    this.rain.mesh.visible = curRainAlpha > 0.015;

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
    };
  }

  dispose(): void {
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.fireflies.geometry.dispose();
    this.ffMat.dispose();
    this.sunMesh.geometry.dispose();
    (this.sunMesh.material as THREE.Material).dispose();
    this.moonMesh.geometry.dispose();
    (this.moonMesh.material as THREE.Material).dispose();
  }
}
