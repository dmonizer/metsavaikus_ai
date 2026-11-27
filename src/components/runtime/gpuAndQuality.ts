import * as THREE from 'three';
import { clampResolutionScale, computeAdaptiveDprSteps } from '../../game/gameLogic';
import { FpsDropLogger } from '../../game/perfLogger';
import {
  AdaptiveQualityGovernor,
  createQualityDistanceState,
  QualityDistanceState,
  QualityMode,
  QualityProfile,
  slewQualityDistanceState,
  snapQualityDistanceState,
} from '../../game/qualityGovernor';
import { computeFogCullDistance } from '../../world/forestFrustumCuller';
import { WeatherAndSkySystem } from '../../world/weatherAndSky';
import type { WorldCallbacks } from '../worldRuntimeContracts';

export interface GpuInfo {
  isSoftwareGl: boolean;
  isLowPowerGpu: boolean;
  gpuRenderer: string;
}

export function detectGpuInfo(): GpuInfo {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { isSoftwareGl: true, isLowPowerGpu: true, gpuRenderer: 'NoWebGL' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const raw = String(gl.getParameter(param) || 'unknown').trim();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const gpuRenderer = raw.length > 72 ? `${raw.slice(0, 69)}...` : raw;
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(raw);
    const isLowPowerGpu =
      isSoftwareGl ||
      /Intel.*(UHD|HD Graphics|GT1|GT2|Bay Trail|Cherry|Jasper|Gemini|CFL|KBL|SKL|WHL|CML)|Mesa Intel.*(UHD|HD )/i.test(
        raw
      );
    return { isSoftwareGl, isLowPowerGpu, gpuRenderer };
  } catch {
    return { isSoftwareGl: false, isLowPowerGpu: false, gpuRenderer: 'unknown' };
  }
}

export function createOutdoorEnvScene(): THREE.Scene {
  const envScene = new THREE.Scene();
  const skyGeo = new THREE.SphereGeometry(20, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 zenith = vec3(0.22, 0.44, 0.72);
        vec3 horizon = vec3(0.76, 0.86, 0.92);
        vec3 pineBand = vec3(0.16, 0.24, 0.14);
        vec3 ground = vec3(0.12, 0.15, 0.09);

        vec3 col = y >= 0.0
          ? mix(horizon, zenith, smoothstep(0.0, 0.75, y))
          : mix(pineBand, ground, smoothstep(0.0, -0.55, y));

        vec3 sunDir = normalize(vec3(0.55, 0.58, 0.35));
        float sunGlow = pow(max(dot(normalize(vDir), sunDir), 0.0), 16.0);
        col += vec3(1.15, 1.02, 0.82) * sunGlow * 0.9;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  envScene.add(new THREE.Mesh(skyGeo, skyMat));
  return envScene;
}

export interface QualityAndDrsDeps {
  gpu: GpuInfo;
  initialMode: QualityMode;
  initialResolutionScale: number | null;
  getCallbacks: () => WorldCallbacks;
  perfLogger: FpsDropLogger;
}

export class QualityAndDrsController {
  readonly governor: AdaptiveQualityGovernor;
  readonly smoothedQuality: QualityDistanceState;
  dprSteps: number[];
  manualResolutionScale: number | null;
  dprStepIdx = 0;
  currentDpr: number;
  drsMsWindow = 0;
  lastFogCullDist = 225;

  private drsCheckTimer = 0;
  private drsLowFpsStreak = 0;
  private drsHighFpsStreak = 0;
  private lastDrsStepDownMs = -Infinity;
  private readonly deps: QualityAndDrsDeps;

  constructor(deps: QualityAndDrsDeps) {
    this.deps = deps;
    this.dprSteps = computeAdaptiveDprSteps(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio || 1,
      deps.gpu.isSoftwareGl,
      deps.gpu.isLowPowerGpu
    );
    this.manualResolutionScale =
      deps.initialResolutionScale !== null
        ? clampResolutionScale(deps.initialResolutionScale)
        : null;
    this.currentDpr = this.manualResolutionScale !== null ? this.manualResolutionScale : this.dprSteps[0];
    this.governor = new AdaptiveQualityGovernor({
      hardware: {
        isSoftwareGl: deps.gpu.isSoftwareGl,
        isLowPowerGpu: deps.gpu.isLowPowerGpu,
        gpuRenderer: deps.gpu.gpuRenderer,
      },
      initialMode: deps.initialMode,
    });
    this.smoothedQuality = createQualityDistanceState(this.governor.getProfile());
  }

  computeAutoTopDpr(profile: QualityProfile): number {
    if (this.deps.gpu.isSoftwareGl) return 1;
    const baseTop = this.dprSteps[0];
    const nativeCap = Math.min(window.devicePixelRatio || 1, profile.dprBoostMax);
    return Math.min(profile.dprBoostMax, Math.max(baseTop, nativeCap));
  }

  applyQualityProfileToScene(
    profile: QualityProfile,
    renderer: THREE.WebGLRenderer,
    weatherSky: WeatherAndSkySystem,
    refreshQualitySceneNow: ((profile: QualityProfile) => void) | null,
    immediate = true
  ): void {
    if (weatherSky.setShadowExtent(profile.shadowExtent)) {
      renderer.shadowMap.needsUpdate = true;
    }
    if (this.manualResolutionScale === null && this.dprStepIdx === 0 && !this.deps.gpu.isSoftwareGl) {
      const targetDpr = this.computeAutoTopDpr(profile);
      if (Math.abs(targetDpr - this.currentDpr) > 0.02) {
        this.currentDpr = targetDpr;
        renderer.setPixelRatio(this.currentDpr);
        weatherSky.setPixelRatio(this.currentDpr);
        renderer.domElement.dataset.pixelRatio = this.currentDpr.toFixed(2);
      }
    }
    renderer.domElement.dataset.qualityTier = profile.name;
    renderer.domElement.dataset.qualityMode = String(this.governor.getMode());
    renderer.domElement.dataset.qualityGrassRing = String(profile.grassMaxRing);
    if (immediate) {
      snapQualityDistanceState(this.smoothedQuality, profile);
      if (refreshQualitySceneNow) {
        refreshQualitySceneNow(profile);
      } else {
        const estDist = computeFogCullDistance(
          0.0052 * profile.fogDensityScale,
          profile.minRenderDist,
          profile.maxRenderDist
        );
        renderer.domElement.dataset.fogCullDist = estDist.toFixed(1);
      }
    }
    this.deps.getCallbacks().onQualityChange?.({
      mode: this.governor.getMode(),
      tier: profile.tier,
      tierName: profile.name,
      maxRenderDist: profile.maxRenderDist,
    });
  }

  setResolutionScale(
    scale: number | null,
    renderer: THREE.WebGLRenderer,
    weatherSky: WeatherAndSkySystem
  ): void {
    this.manualResolutionScale = scale !== null ? clampResolutionScale(scale) : null;
    this.dprStepIdx = 0;
    this.drsLowFpsStreak = 0;
    this.drsHighFpsStreak = 0;
    const nextDpr =
      this.manualResolutionScale !== null
        ? this.manualResolutionScale
        : this.computeAutoTopDpr(this.governor.getProfile());
    if (Math.abs(nextDpr - this.currentDpr) > 0.001) {
      this.currentDpr = nextDpr;
      const td0 = performance.now();
      renderer.setPixelRatio(this.currentDpr);
      weatherSky.setPixelRatio(this.currentDpr);
      const resizeMs = performance.now() - td0;
      if (resizeMs > this.drsMsWindow) this.drsMsWindow = resizeMs;
      renderer.domElement.dataset.pixelRatio = this.currentDpr.toFixed(2);
      this.deps.perfLogger.recordEvent(
        `res->${this.currentDpr.toFixed(2)}x${this.manualResolutionScale === null ? '(auto)' : ''}`,
        td0
      );
    }
  }

  onResize(
    width: number,
    height: number,
    renderer: THREE.WebGLRenderer,
    weatherSky: WeatherAndSkySystem
  ): void {
    this.dprSteps = computeAdaptiveDprSteps(
      width,
      height,
      window.devicePixelRatio || 1,
      this.deps.gpu.isSoftwareGl,
      this.deps.gpu.isLowPowerGpu
    );
    this.dprStepIdx = Math.min(this.dprStepIdx, this.dprSteps.length - 1);
    this.currentDpr =
      this.manualResolutionScale !== null
        ? this.manualResolutionScale
        : this.dprSteps[this.dprStepIdx];
    renderer.setPixelRatio(this.currentDpr);
    weatherSky.setPixelRatio(this.currentDpr);
    renderer.domElement.dataset.pixelRatio = this.currentDpr.toFixed(2);
    this.deps.getCallbacks().onDisplayMetrics?.({
      autoDpr: this.dprSteps[0],
      viewportW: width,
      viewportH: height,
    });
  }

  updateDrs(
    rawDt: number,
    now: number,
    fpsEma: number,
    isPlaying: boolean,
    renderer: THREE.WebGLRenderer,
    weatherSky: WeatherAndSkySystem
  ): void {
    if (this.deps.gpu.isSoftwareGl || !isPlaying || this.manualResolutionScale !== null) return;
    this.drsCheckTimer += Math.min(0.5, rawDt);
    const isLowPowerGpu = this.deps.gpu.isLowPowerGpu;
    const drsInterval = isLowPowerGpu ? 2.0 : fpsEma < 22 ? 1.2 : 2.5;
    if (this.drsCheckTimer < drsInterval) return;

    this.drsCheckTimer = 0;
    const stepDownFps = isLowPowerGpu ? 34 : 38;
    const requiredLowChecks = isLowPowerGpu ? 2 : 1;
    const requiredHighChecks = isLowPowerGpu ? 3 : 2;
    const stepUpCooldownMs = isLowPowerGpu ? 45_000 : 8_000;

    if (fpsEma < stepDownFps && this.dprStepIdx < this.dprSteps.length - 1) {
      this.drsLowFpsStreak++;
      this.drsHighFpsStreak = 0;
      if (this.drsLowFpsStreak >= requiredLowChecks) {
        this.dprStepIdx++;
        this.currentDpr = this.dprSteps[this.dprStepIdx];
        this.drsLowFpsStreak = 0;
        this.lastDrsStepDownMs = now;
        const td0 = performance.now();
        renderer.setPixelRatio(this.currentDpr);
        weatherSky.setPixelRatio(this.currentDpr);
        const resizeMs = performance.now() - td0;
        if (resizeMs > this.drsMsWindow) this.drsMsWindow = resizeMs;
        this.deps.perfLogger.recordEvent(`drs->${this.currentDpr.toFixed(2)}x`, now);
      }
    } else if (
      fpsEma > 57 &&
      this.dprStepIdx > 0 &&
      now - this.lastDrsStepDownMs >= stepUpCooldownMs
    ) {
      this.drsLowFpsStreak = 0;
      this.drsHighFpsStreak++;
      if (this.drsHighFpsStreak >= requiredHighChecks) {
        this.dprStepIdx--;
        this.currentDpr =
          this.dprStepIdx === 0
            ? this.computeAutoTopDpr(this.governor.getProfile())
            : this.dprSteps[this.dprStepIdx];
        this.drsHighFpsStreak = 0;
        const td0 = performance.now();
        renderer.setPixelRatio(this.currentDpr);
        weatherSky.setPixelRatio(this.currentDpr);
        const resizeMs = performance.now() - td0;
        if (resizeMs > this.drsMsWindow) this.drsMsWindow = resizeMs;
        this.deps.perfLogger.recordEvent(`drs->${this.currentDpr.toFixed(2)}x`, now);
      }
    } else {
      this.drsLowFpsStreak = 0;
      this.drsHighFpsStreak = 0;
    }
  }

  slewDistances(dt: number): QualityProfile {
    const profile = this.governor.getProfile();
    slewQualityDistanceState(this.smoothedQuality, profile, dt);
    return profile;
  }
}
