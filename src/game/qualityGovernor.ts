export type QualityTier = 0 | 1 | 2 | 3 | 4;
export type QualityMode = 'auto' | QualityTier;
export type QualityTierName = 'minimal' | 'low' | 'balanced' | 'high' | 'ultra';

export interface QualityProfile {
  tier: QualityTier;
  name: QualityTierName;
  maxRenderDist: number;
  minRenderDist: number;
  fogDensityScale: number;
  terrainLod0Dist: number;
  terrainLod1Dist: number;
  treeLod0Dist: number;
  treeLod1Dist: number;
  bushDist: number;
  understoryDist: number;
  boulderDist: number;
  bogDist: number;
  mushroomDist: number;
  grassMaxRing: 1 | 2 | 3 | 4;
  grassRing1Step: 1 | 2 | 3;
  grassRing2Step: 1 | 2 | 3;
  grassRing3Step: 1 | 2 | 3;
  grassRing4Step: 1 | 2 | 3;
  shadowExtent: number;
  shadowMinSkip: number;
  shadowMoveThreshSq: number;
  dprBoostMax: number;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  0: {
    tier: 0,
    name: 'minimal',
    maxRenderDist: 118,
    minRenderDist: 76,
    fogDensityScale: 1.08,
    terrainLod0Dist: 38,
    terrainLod1Dist: 78,
    treeLod0Dist: 26,
    treeLod1Dist: 58,
    bushDist: 60,
    understoryDist: 42,
    boulderDist: 72,
    bogDist: 74,
    mushroomDist: 28,
    grassMaxRing: 1,
    grassRing1Step: 2,
    grassRing2Step: 3,
    grassRing3Step: 3,
    grassRing4Step: 3,
    shadowExtent: 24,
    shadowMinSkip: 10,
    shadowMoveThreshSq: 4.5,
    dprBoostMax: 0.85,
  },
  1: {
    tier: 1,
    name: 'low',
    maxRenderDist: 168,
    minRenderDist: 86,
    fogDensityScale: 1.03,
    terrainLod0Dist: 50,
    terrainLod1Dist: 102,
    treeLod0Dist: 32,
    treeLod1Dist: 78,
    bushDist: 88,
    understoryDist: 62,
    boulderDist: 104,
    bogDist: 108,
    mushroomDist: 36,
    grassMaxRing: 2,
    grassRing1Step: 2,
    grassRing2Step: 3,
    grassRing3Step: 3,
    grassRing4Step: 3,
    shadowExtent: 30,
    shadowMinSkip: 6,
    shadowMoveThreshSq: 3.0,
    dprBoostMax: 0.95,
  },
  2: {
    tier: 2,
    name: 'balanced',
    maxRenderDist: 225,
    minRenderDist: 96,
    fogDensityScale: 1.0,
    terrainLod0Dist: 64,
    terrainLod1Dist: 128,
    treeLod0Dist: 40,
    treeLod1Dist: 100,
    bushDist: 124,
    understoryDist: 86,
    boulderDist: 146,
    bogDist: 150,
    mushroomDist: 46,
    grassMaxRing: 2,
    grassRing1Step: 1,
    grassRing2Step: 2,
    grassRing3Step: 3,
    grassRing4Step: 3,
    shadowExtent: 36,
    shadowMinSkip: 4,
    shadowMoveThreshSq: 2.25,
    dprBoostMax: 1.0,
  },
  3: {
    tier: 3,
    name: 'high',
    maxRenderDist: 248,
    minRenderDist: 110,
    fogDensityScale: 0.92,
    terrainLod0Dist: 84,
    terrainLod1Dist: 164,
    treeLod0Dist: 56,
    treeLod1Dist: 132,
    bushDist: 168,
    understoryDist: 118,
    boulderDist: 188,
    bogDist: 194,
    mushroomDist: 58,
    grassMaxRing: 3,
    grassRing1Step: 1,
    grassRing2Step: 1,
    grassRing3Step: 2,
    grassRing4Step: 3,
    shadowExtent: 48,
    shadowMinSkip: 2,
    shadowMoveThreshSq: 1.2,
    dprBoostMax: 1.1,
  },
  4: {
    tier: 4,
    name: 'ultra',
    maxRenderDist: 264,
    minRenderDist: 124,
    fogDensityScale: 0.86,
    terrainLod0Dist: 104,
    terrainLod1Dist: 192,
    treeLod0Dist: 72,
    treeLod1Dist: 156,
    bushDist: 208,
    understoryDist: 154,
    boulderDist: 220,
    bogDist: 226,
    mushroomDist: 72,
    grassMaxRing: 4,
    grassRing1Step: 1,
    grassRing2Step: 1,
    grassRing3Step: 1,
    grassRing4Step: 2,
    shadowExtent: 60,
    shadowMinSkip: 1,
    shadowMoveThreshSq: 0.7,
    dprBoostMax: 1.18,
  },
};

export const QUALITY_TIER_ORDER: readonly QualityTier[] = [0, 1, 2, 3, 4];

export interface HardwareCapabilities {
  isSoftwareGl: boolean;
  isLowPowerGpu: boolean;
  gpuRenderer?: string;
}

export function clampQualityTier(tier: number): QualityTier {
  if (!Number.isFinite(tier)) return 2;
  const rounded = Math.round(tier);
  if (rounded <= 0) return 0;
  if (rounded >= 4) return 4;
  return rounded as QualityTier;
}

export function parseQualityMode(raw: string | null | undefined): QualityMode {
  if (!raw || raw === 'auto') return 'auto';
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 4) {
    return clampQualityTier(parsed);
  }
  return 'auto';
}

export function getQualityProfile(tier: QualityTier): QualityProfile {
  return QUALITY_PROFILES[clampQualityTier(tier)];
}

export function detectInitialQualityTier(hw: HardwareCapabilities): QualityTier {
  if (hw.isSoftwareGl) return 0;
  if (hw.isLowPowerGpu) return 1;
  return 2;
}

export interface QualitySample {
  nowMs: number;
  rawDtMs: number;
  fpsEma: number;
  fpsInstant: number;
  frameCpuMs?: number;
  isPlaying: boolean;
  isHidden?: boolean;
}

export interface QualityGovernorOptions {
  hardware: HardwareCapabilities;
  initialMode?: QualityMode;
  warmupMs?: number;
  upgradeHoldBaseMs?: number;
  upgradeHoldUpperMs?: number;
  probationWindowMs?: number;
  probationRollbackFps?: number;
  lockoutMs?: number;
  constantLowFps?: number;
  constantLowHoldMs?: number;
  severeLowFps?: number;
  severeLowHoldMs?: number;
  oftenDipFps?: number;
  dipWindowMs?: number;
  oftenMinSamples?: number;
  oftenMinDips?: number;
  oftenDipRatio?: number;
  upgradeMinFpsEma?: number;
  upgradeMinFpsInstant?: number;
  upgradeMaxCpuMs?: number;
  downgradeSettleMs?: number;
  downgradeToUpgradeCooldownMs?: number;
  sampleIntervalMs?: number;
}

export interface QualityTransition {
  fromTier: QualityTier;
  toTier: QualityTier;
  reason:
    | 'manual'
    | 'headroom_upgrade'
    | 'probation_rollback'
    | 'constant_low_fps'
    | 'frequent_low_fps'
    | 'severe_low_fps';
}

interface DipSample {
  ts: number;
  isDip: boolean;
}

export class AdaptiveQualityGovernor {
  private mode: QualityMode;
  private tier: QualityTier;
  private readonly hardware: HardwareCapabilities;
  private readonly minTier: QualityTier;
  private readonly maxTier: QualityTier;

  private readonly warmupMs: number;
  private readonly upgradeHoldBaseMs: number;
  private readonly upgradeHoldUpperMs: number;
  private readonly probationWindowMs: number;
  private readonly probationRollbackFps: number;
  private readonly lockoutMs: number;
  private readonly constantLowFps: number;
  private readonly constantLowHoldMs: number;
  private readonly severeLowFps: number;
  private readonly severeLowHoldMs: number;
  private readonly oftenDipFps: number;
  private readonly dipWindowMs: number;
  private readonly oftenMinSamples: number;
  private readonly oftenMinDips: number;
  private readonly oftenDipRatio: number;
  private readonly upgradeMinFpsEma: number;
  private readonly upgradeMinFpsInstant: number;
  private readonly upgradeMaxCpuMs: number;
  private readonly downgradeSettleMs: number;
  private readonly downgradeToUpgradeCooldownMs: number;
  private readonly sampleIntervalMs: number;

  private activePlayingMs = 0;
  private healthyHoldMs = 0;
  private constantLowMs = 0;
  private severeLowMs = 0;
  private cpuMsEma = 0;
  private hasCpuSample = false;
  private lastSampleWindowTs = -Infinity;
  private lastUpgradeMs = -Infinity;
  private lastDowngradeMs = -Infinity;
  private upgradeCooldownUntilMs = -Infinity;
  private probationDips = 0;
  private readonly dipSamples: DipSample[] = [];
  private readonly tierLockoutUntil = new Map<QualityTier, number>();

  constructor(options: QualityGovernorOptions) {
    this.hardware = options.hardware;
    this.minTier = 0;
    this.maxTier = options.hardware.isSoftwareGl ? 0 : 4;
    this.mode = options.initialMode ?? 'auto';
    this.tier =
      this.mode === 'auto' ? detectInitialQualityTier(options.hardware) : this.mode;

    this.warmupMs = options.warmupMs ?? 1500;
    this.upgradeHoldBaseMs = options.upgradeHoldBaseMs ?? 2200;
    this.upgradeHoldUpperMs = options.upgradeHoldUpperMs ?? 3200;
    this.probationWindowMs = options.probationWindowMs ?? 5000;
    this.probationRollbackFps = options.probationRollbackFps ?? 48;
    this.lockoutMs = options.lockoutMs ?? 45_000;
    this.constantLowFps = options.constantLowFps ?? 38;
    this.constantLowHoldMs = options.constantLowHoldMs ?? 1800;
    this.severeLowFps = options.severeLowFps ?? 26;
    this.severeLowHoldMs = options.severeLowHoldMs ?? 800;
    this.oftenDipFps = options.oftenDipFps ?? 40;
    this.dipWindowMs = options.dipWindowMs ?? 10_000;
    this.oftenMinSamples = options.oftenMinSamples ?? 12;
    this.oftenMinDips = options.oftenMinDips ?? 4;
    this.oftenDipRatio = options.oftenDipRatio ?? 0.28;
    this.upgradeMinFpsEma = options.upgradeMinFpsEma ?? 57;
    this.upgradeMinFpsInstant = options.upgradeMinFpsInstant ?? 51;
    this.upgradeMaxCpuMs = options.upgradeMaxCpuMs ?? 15.0;
    this.downgradeSettleMs = options.downgradeSettleMs ?? 2200;
    this.downgradeToUpgradeCooldownMs = options.downgradeToUpgradeCooldownMs ?? 20_000;
    this.sampleIntervalMs = options.sampleIntervalMs ?? 220;
  }

  getMode(): QualityMode {
    return this.mode;
  }

  getTier(): QualityTier {
    return this.tier;
  }

  getProfile(): QualityProfile {
    return QUALITY_PROFILES[this.tier];
  }

  getAutoFloorTier(): QualityTier {
    return this.minTier;
  }

  getAutoCeilingTier(): QualityTier {
    return this.maxTier;
  }

  setMode(mode: QualityMode): QualityTransition | null {
    const prevTier = this.tier;
    this.mode = mode;
    this.resetAdaptiveTimers();
    if (mode === 'auto') {
      const nextTier = detectInitialQualityTier(this.hardware);
      this.tier = nextTier;
      this.tierLockoutUntil.clear();
      this.activePlayingMs = 0;
      if (nextTier !== prevTier) {
        return { fromTier: prevTier, toTier: nextTier, reason: 'manual' };
      }
      return null;
    }

    const nextTier = clampQualityTier(mode);
    this.tier = nextTier;
    if (nextTier !== prevTier) {
      return { fromTier: prevTier, toTier: nextTier, reason: 'manual' };
    }
    return null;
  }

  private resetAdaptiveTimers(): void {
    this.healthyHoldMs = 0;
    this.constantLowMs = 0;
    this.severeLowMs = 0;
    this.probationDips = 0;
    this.dipSamples.length = 0;
    this.lastSampleWindowTs = -Infinity;
  }

  observe(sample: QualitySample): QualityTransition | null {
    if (this.mode !== 'auto') return null;
    if (this.minTier === this.maxTier) return null;
    if (!sample.isPlaying || sample.isHidden) {
      this.healthyHoldMs = Math.max(0, this.healthyHoldMs - 250);
      return null;
    }

    // Ignore extreme hitch frames caused by tab switch or OS sleep
    if (!Number.isFinite(sample.rawDtMs) || sample.rawDtMs <= 0 || sample.rawDtMs > 250) {
      return null;
    }

    const dtMs = sample.rawDtMs;
    this.activePlayingMs += dtMs;
    if (sample.frameCpuMs !== undefined && Number.isFinite(sample.frameCpuMs)) {
      this.cpuMsEma = this.hasCpuSample
        ? this.cpuMsEma * 0.88 + sample.frameCpuMs * 0.12
        : sample.frameCpuMs;
      this.hasCpuSample = true;
    }

    if (this.activePlayingMs < this.warmupMs) {
      return null;
    }

    const nowMs = sample.nowMs;

    // Sample sliding window at fixed cadence so high/low refresh rates count consistently
    let sampledNow = false;
    if (nowMs - this.lastSampleWindowTs >= this.sampleIntervalMs) {
      this.lastSampleWindowTs = nowMs;
      sampledNow = true;
      const isDip =
        sample.fpsInstant < this.oftenDipFps || sample.fpsEma < this.oftenDipFps;
      this.dipSamples.push({ ts: nowMs, isDip });
      const cutoff = nowMs - this.dipWindowMs;
      while (this.dipSamples.length > 0 && this.dipSamples[0].ts < cutoff) {
        this.dipSamples.shift();
      }
    }

    // 1. Probation check shortly after stepping UP: rollback immediately on regression
    const inProbation =
      this.lastUpgradeMs > -Infinity &&
      nowMs - this.lastUpgradeMs <= this.probationWindowMs;
    if (inProbation && this.tier > this.minTier) {
      if (sampledNow && sample.fpsInstant < this.oftenDipFps) {
        this.probationDips++;
      }
      if (sample.fpsEma < this.probationRollbackFps || this.probationDips >= 2) {
        const prev = this.tier;
        const next = (prev - 1) as QualityTier;
        this.tier = next;
        this.tierLockoutUntil.set(prev, nowMs + this.lockoutMs);
        this.lastUpgradeMs = -Infinity;
        this.lastDowngradeMs = nowMs;
        this.upgradeCooldownUntilMs = nowMs + this.downgradeToUpgradeCooldownMs;
        this.resetAdaptiveTimers();
        return { fromTier: prev, toTier: next, reason: 'probation_rollback' };
      }
    }

    // 2. Degrade triggers ("below 35-40 constantly or often")
    if (this.tier > this.minTier) {
      if (sample.fpsEma < this.severeLowFps) {
        this.severeLowMs += dtMs;
      } else {
        this.severeLowMs = Math.max(0, this.severeLowMs - dtMs * 0.5);
      }

      if (sample.fpsEma < this.constantLowFps) {
        this.constantLowMs += dtMs;
      } else {
        this.constantLowMs = Math.max(0, this.constantLowMs - dtMs * 0.5);
      }

      const settledFromPrevDowngrade =
        nowMs - this.lastDowngradeMs >= this.downgradeSettleMs;

      if (this.severeLowMs >= this.severeLowHoldMs && nowMs - this.lastDowngradeMs >= 900) {
        return this.stepDown(nowMs, 'severe_low_fps');
      }

      if (settledFromPrevDowngrade && this.constantLowMs >= this.constantLowHoldMs) {
        return this.stepDown(nowMs, 'constant_low_fps');
      }

      if (settledFromPrevDowngrade && this.dipSamples.length >= this.oftenMinSamples) {
        let dipCount = 0;
        for (let i = 0; i < this.dipSamples.length; i++) {
          if (this.dipSamples[i].isDip) dipCount++;
        }
        const ratio = dipCount / this.dipSamples.length;
        if (dipCount >= this.oftenMinDips && ratio >= this.oftenDipRatio) {
          return this.stepDown(nowMs, 'frequent_low_fps');
        }
      }
    }

    // 3. Upgrade trigger ("if hw allows, increase detail and/or render distance")
    if (this.tier < this.maxTier) {
      const nextTier = (this.tier + 1) as QualityTier;
      const lockedUntil = this.tierLockoutUntil.get(nextTier) ?? -Infinity;
      const canConsiderUpgrade =
        nowMs >= this.upgradeCooldownUntilMs &&
        nowMs >= lockedUntil &&
        nowMs - this.lastDowngradeMs >= this.downgradeToUpgradeCooldownMs;

      if (!canConsiderUpgrade) {
        this.healthyHoldMs = 0;
        return null;
      }

      let recentDips = 0;
      for (let i = 0; i < this.dipSamples.length; i++) {
        if (this.dipSamples[i].isDip) recentDips++;
      }
      const recentDipRatio =
        this.dipSamples.length > 0 ? recentDips / this.dipSamples.length : 0;

      const cpuHealthy =
        !this.hasCpuSample || this.cpuMsEma <= this.upgradeMaxCpuMs;
      const frameHealthy =
        sample.fpsEma >= this.upgradeMinFpsEma &&
        sample.fpsInstant >= this.upgradeMinFpsInstant &&
        cpuHealthy &&
        recentDipRatio < 0.05;

      if (frameHealthy) {
        this.healthyHoldMs += dtMs;
        const requiredHoldMs =
          this.tier <= 2 ? this.upgradeHoldBaseMs : this.upgradeHoldUpperMs;
        if (this.healthyHoldMs >= requiredHoldMs) {
          const prev = this.tier;
          this.tier = nextTier;
          this.lastUpgradeMs = nowMs;
          this.resetAdaptiveTimers();
          return { fromTier: prev, toTier: nextTier, reason: 'headroom_upgrade' };
        }
      } else {
        this.healthyHoldMs = Math.max(0, this.healthyHoldMs - dtMs * 0.5);
      }
    }

    return null;
  }

  private stepDown(
    nowMs: number,
    reason: 'constant_low_fps' | 'frequent_low_fps' | 'severe_low_fps'
  ): QualityTransition {
    const prev = this.tier;
    const next = Math.max(this.minTier, prev - 1) as QualityTier;
    this.tier = next;
    this.lastDowngradeMs = nowMs;
    this.lastUpgradeMs = -Infinity;
    this.upgradeCooldownUntilMs = nowMs + this.downgradeToUpgradeCooldownMs;
    this.resetAdaptiveTimers();
    return { fromTier: prev, toTier: next, reason };
  }
}

export interface TreeLodFadeBands {
  lod0InStart: number;
  lod0InEnd: number;
  lod0OutStart: number;
  lod0OutEnd: number;
  lod1InStart: number;
  lod1InEnd: number;
  lod1OutStart: number;
  lod1OutEnd: number;
  treeFadeStart: number;
  treeFadeEnd: number;
}

export function computeTreeLodFadeBands(
  lod0Dist: number,
  lod1Dist: number,
  fogDist: number
): TreeLodFadeBands {
  const treeFadeEnd = Math.min(Math.max(48, fogDist - 4), 236);
  const treeFadeStart = Math.max(32, treeFadeEnd - 42);

  const lod1Mid = Math.min(lod1Dist, treeFadeStart - 8);
  const lod1Half = Math.min(8, Math.max(3, (treeFadeStart - lod1Mid) * 0.45));
  const lod1InStart = Math.max(20, lod1Mid - lod1Half);
  const lod1InEnd = lod1Mid;
  const lod1OutStart = lod1Mid;
  const lod1OutEnd = lod1Mid + lod1Half;

  const lod0Mid = Math.min(lod0Dist, lod1InStart - 7);
  const lod0Half = Math.min(6, Math.max(2.5, (lod1InStart - lod0Mid) * 0.45));
  const lod0InStart = Math.max(12, lod0Mid - lod0Half);
  const lod0InEnd = lod0Mid;
  const lod0OutStart = lod0Mid;
  const lod0OutEnd = lod0Mid + lod0Half;

  return {
    lod0InStart,
    lod0InEnd,
    lod0OutStart,
    lod0OutEnd,
    lod1InStart,
    lod1InEnd,
    lod1OutStart,
    lod1OutEnd,
    treeFadeStart,
    treeFadeEnd,
  };
}

export interface QualityDistanceState {
  maxRenderDist: number;
  minRenderDist: number;
  fogDensityScale: number;
  terrainLod0Dist: number;
  terrainLod1Dist: number;
  treeLod0Dist: number;
  treeLod1Dist: number;
  bushDist: number;
  understoryDist: number;
  boulderDist: number;
  bogDist: number;
  mushroomDist: number;
}

function approachValue(cur: number, target: number, maxStep: number): number {
  const diff = target - cur;
  if (Math.abs(diff) <= maxStep) return target;
  return cur + Math.sign(diff) * maxStep;
}

export function createQualityDistanceState(profile: QualityProfile): QualityDistanceState {
  return {
    maxRenderDist: profile.maxRenderDist,
    minRenderDist: profile.minRenderDist,
    fogDensityScale: profile.fogDensityScale,
    terrainLod0Dist: profile.terrainLod0Dist,
    terrainLod1Dist: profile.terrainLod1Dist,
    treeLod0Dist: profile.treeLod0Dist,
    treeLod1Dist: profile.treeLod1Dist,
    bushDist: profile.bushDist,
    understoryDist: profile.understoryDist,
    boulderDist: profile.boulderDist,
    bogDist: profile.bogDist,
    mushroomDist: profile.mushroomDist,
  };
}

export function snapQualityDistanceState(
  state: QualityDistanceState,
  profile: QualityProfile
): void {
  state.maxRenderDist = profile.maxRenderDist;
  state.minRenderDist = profile.minRenderDist;
  state.fogDensityScale = profile.fogDensityScale;
  state.terrainLod0Dist = profile.terrainLod0Dist;
  state.terrainLod1Dist = profile.terrainLod1Dist;
  state.treeLod0Dist = profile.treeLod0Dist;
  state.treeLod1Dist = profile.treeLod1Dist;
  state.bushDist = profile.bushDist;
  state.understoryDist = profile.understoryDist;
  state.boulderDist = profile.boulderDist;
  state.bogDist = profile.bogDist;
  state.mushroomDist = profile.mushroomDist;
}

export function slewQualityDistanceState(
  state: QualityDistanceState,
  target: QualityProfile,
  dtSec: number,
  rateMps = 28
): void {
  const distStep = Math.max(0.05, rateMps * Math.max(0, dtSec));
  const fogStep = Math.max(0.002, 0.22 * Math.max(0, dtSec));
  state.maxRenderDist = approachValue(state.maxRenderDist, target.maxRenderDist, distStep);
  state.minRenderDist = approachValue(state.minRenderDist, target.minRenderDist, distStep);
  state.fogDensityScale = approachValue(state.fogDensityScale, target.fogDensityScale, fogStep);
  state.terrainLod0Dist = approachValue(state.terrainLod0Dist, target.terrainLod0Dist, distStep);
  state.terrainLod1Dist = approachValue(state.terrainLod1Dist, target.terrainLod1Dist, distStep);
  state.treeLod0Dist = approachValue(state.treeLod0Dist, target.treeLod0Dist, distStep);
  state.treeLod1Dist = approachValue(state.treeLod1Dist, target.treeLod1Dist, distStep);
  state.bushDist = approachValue(state.bushDist, target.bushDist, distStep);
  state.understoryDist = approachValue(state.understoryDist, target.understoryDist, distStep);
  state.boulderDist = approachValue(state.boulderDist, target.boulderDist, distStep);
  state.bogDist = approachValue(state.bogDist, target.bogDist, distStep);
  state.mushroomDist = approachValue(state.mushroomDist, target.mushroomDist, distStep);
}

