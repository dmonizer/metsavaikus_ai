import { resolveSurfaceMaterial } from './surfaceMaterial';
import { DEFAULT_SOUNDSCAPE_CONFIG } from '../config/soundscape';
import {
  AudioBackend,
  MockAudioBackend,
  WebAudioHybridBackend,
} from '../soundscape/audioBackend';
import { Clock, SeededRng, SystemRealClock } from '../soundscape/clocks';
import { SoundscapeEngine } from '../soundscape/soundscapeEngine';
import type {
  BiomeId,
  FeatureType,
  GaitType,
  PersistedSoundscapeState,
  PlayerActivity,
  SpatialQueryProvider,
  SpatialQueryResult,
  Vector3,
  WeatherType,
  WorldContext,
} from '../soundscape/types';
import type { BoxCollider, StructureAcousticsInfo } from './architectureAndProps';
import {
  distToRoadDetail,
  getActiveBlueprint,
  getBiomeInfo,
  getDistanceToNearestVillage,
  getNearestWaterFeatureDistances,
  getSwampFactor,
  getTerrainHeight,
  getWaterSurfaceAt,
  SWAMP_WATER_Y,
} from './terrainMath';
import type { WeatherId } from './weatherAndSky';

export interface SimulatorSoundscapeInput {
  simulationTimeMs: number;
  timeOfDayHours: number;
  simulationDay: number;
  timeAcceleration: number;
  sunDirY: number;
  weather: WeatherId;
  windStrength: number;
  fogDensity: number;
  listenerPos: Vector3;
  listenerForward: Vector3;
  listenerVelocity: Vector3;
  isMoving: boolean;
  wantRun: boolean;
  crouching: boolean;
  isSwimming: boolean;
  isSwampWading: boolean;
  onBoardwalk: boolean;
  waterDepthM: number;
  speedMps: number;
  stamina: number;
  exertion: number;
  tiredness: number;
  wetness: number;
  wearingRainJacket: boolean;
  seatedInTent: boolean;
  isSleeping?: boolean;
  distanceMovedTotal: number;
  nearLitCampfireFactor: number;
  nearestCampfirePos?: Vector3;
  structure: StructureAcousticsInfo;
  muted: boolean;
  masterVolume?: number;
  musicEnabled?: boolean;
  musicVolume?: number;
}

const SOUND_STATE_STORAGE_PREFIX = 'metsavaikus_soundscape_state_v1_';

function normalizeBiomeId(id: string): BiomeId {
  if (
    id === 'village' ||
    id === 'abandoned' ||
    id === 'island' ||
    id === 'swamp' ||
    id === 'road' ||
    id === 'thicket' ||
    id === 'forest' ||
    id === 'meadow' ||
    id === 'marsh'
  ) {
    return id;
  }
  return 'forest';
}

function mapWeatherType(w: WeatherId): WeatherType {
  if (w === 'mist') return 'mist';
  if (w === 'rain') return 'rain';
  if (w === 'storm') return 'storm';
  return 'clear';
}

function estimateWaterDistances(x: number, z: number): {
  waterDistM: number;
  streamDistM: number;
  bogDistM: number;
} {
  const bp = getActiveBlueprint();
  const here = getWaterSurfaceAt(x, z, bp);
  const feats = getNearestWaterFeatureDistances(x, z, bp);
  if (here.hasWater) {
    return {
      waterDistM: 0,
      streamDistM: here.kind === 'stream' ? 0 : feats.streamM,
      bogDistM: here.kind === 'bog' ? 0 : feats.bogPoolM,
    };
  }
  return {
    waterDistM: feats.waterM,
    streamDistM: feats.streamM,
    bogDistM: feats.bogPoolM,
  };
}

function computeBiomeComposition(x: number, z: number): Partial<Record<BiomeId, number>> {
  const counts = new Map<BiomeId, number>();
  const center = normalizeBiomeId(getBiomeInfo(x, z).id);
  counts.set(center, 0.52);

  const probeRadius = 18;
  const offsets: Array<[number, number]> = [
    [probeRadius, 0],
    [-probeRadius, 0],
    [0, probeRadius],
    [0, -probeRadius],
  ];
  for (const [ox, oz] of offsets) {
    const b = normalizeBiomeId(getBiomeInfo(x + ox, z + oz).id);
    counts.set(b, (counts.get(b) ?? 0) + 0.12);
  }

  const out: Partial<Record<BiomeId, number>> = {};
  for (const [k, v] of counts.entries()) {
    out[k] = Math.round(v * 100) / 100;
  }
  return out;
}

export class WorldSpatialQueryProvider implements SpatialQueryProvider {
  private boxColliders: readonly BoxCollider[] = [];

  setBoxColliders(colliders: readonly BoxCollider[]): void {
    this.boxColliders = colliders;
  }

  findPointOnFeature(
    feature: FeatureType,
    listenerPos: Vector3,
    minDistM: number,
    maxDistM: number,
    rngNext: () => number
  ): SpatialQueryResult | null {
    const lo = Math.max(2, minDistM);
    const hi = Math.max(lo + 4, maxDistM);

    if (feature === 'water' || feature === 'bog' || feature === 'river') {
      const bp = getActiveBlueprint();
      for (let attempt = 0; attempt < 24; attempt++) {
        const ang = rngNext() * Math.PI * 2;
        const dist = lo + rngNext() * (hi - lo);
        const px = listenerPos.x + Math.cos(ang) * dist;
        const pz = listenerPos.z + Math.sin(ang) * dist;
        const h = getTerrainHeight(px, pz, bp);
        const wAt = getWaterSurfaceAt(px, pz, bp, h);
        const swamp = getSwampFactor(px, pz, bp);
        if (
          wAt.hasWater ||
          (feature === 'bog' && swamp > 0.45)
        ) {
          return {
            position: { x: px, y: wAt.hasWater ? wAt.waterY : Math.max(h, SWAMP_WATER_Y), z: pz },
            featureFound: true,
          };
        }
      }
      // Fallback toward bog center clamped into [lo, hi]
      const dx = bp.bogCenterX - listenerPos.x;
      const dz = bp.bogCenterZ - listenerPos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1) {
        const clamped = Math.max(lo, Math.min(hi, d));
        const px = listenerPos.x + (dx / d) * clamped;
        const pz = listenerPos.z + (dz / d) * clamped;
        const h = getTerrainHeight(px, pz, bp);
        if (h <= SWAMP_WATER_Y + 0.25 || getSwampFactor(px, pz, bp) > 0.35) {
          return {
            position: { x: px, y: Math.max(h, SWAMP_WATER_Y), z: pz },
            featureFound: true,
          };
        }
      }
      return null;
    }

    if (feature === 'road') {
      for (let attempt = 0; attempt < 20; attempt++) {
        const ang = rngNext() * Math.PI * 2;
        const dist = lo + rngNext() * (hi - lo);
        const px = listenerPos.x + Math.cos(ang) * dist;
        const pz = listenerPos.z + Math.sin(ang) * dist;
        if (distToRoadDetail(px, pz).dist <= 4.0) {
          return {
            position: { x: px, y: getTerrainHeight(px, pz), z: pz },
            featureFound: true,
          };
        }
      }
      return null;
    }

    if (feature === 'village') {
      const nearest = getDistanceToNearestVillage(listenerPos.x, listenerPos.z);
      if (nearest.village && nearest.dist <= hi) {
        return {
          position: {
            x: nearest.village.x,
            y: getTerrainHeight(nearest.village.x, nearest.village.z),
            z: nearest.village.z,
          },
          featureFound: true,
        };
      }
      return null;
    }

    return null;
  }

  computeOcclusionFactor(listenerPos: Vector3, sourcePos: Vector3): number {
    if (this.boxColliders.length === 0) return 0;
    const dx = sourcePos.x - listenerPos.x;
    const dz = sourcePos.z - listenerPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1 || dist > 120) return 0;

    let hits = 0;
    const steps = Math.min(10, Math.max(3, Math.floor(dist / 6)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const px = listenerPos.x + dx * t;
      const pz = listenerPos.z + dz * t;
      const py = listenerPos.y + (sourcePos.y - listenerPos.y) * t;
      for (let i = 0; i < this.boxColliders.length; i++) {
        const b = this.boxColliders[i];
        if (!b.active) continue;
        if (
          px >= b.minX &&
          px <= b.maxX &&
          pz >= b.minZ &&
          pz <= b.maxZ &&
          py >= b.groundY &&
          py <= b.groundY + b.heightAboveGround
        ) {
          hits++;
          break;
        }
      }
      if (hits >= 2) break;
    }
    return Math.min(0.85, hits * 0.42);
  }
}

interface SpatialEnvironmentSample {
  biomeId: BiomeId;
  roadInfo: ReturnType<typeof distToRoadDetail>;
  villageDist: number;
  waterDistM: number;
  streamDistM: number;
  bogDistM: number;
  swampFactor: number;
  biomeComposition: Partial<Record<BiomeId, number>>;
}

function sampleSpatialEnvironment(x: number, z: number): SpatialEnvironmentSample {
  const waterDists = estimateWaterDistances(x, z);
  return {
    biomeId: normalizeBiomeId(getBiomeInfo(x, z).id),
    roadInfo: distToRoadDetail(x, z),
    villageDist: getDistanceToNearestVillage(x, z).dist,
    waterDistM: waterDists.waterDistM,
    streamDistM: waterDists.streamDistM,
    bogDistM: waterDists.bogDistM,
    swampFactor: getSwampFactor(x, z),
    biomeComposition: computeBiomeComposition(x, z),
  };
}

/** One bounded spatial sample per world; all dynamic context is still built every frame. */
export class SimulatorSoundscapeContextBuilder {
  private cached: SpatialEnvironmentSample | null = null;
  private blueprint = getActiveBlueprint();
  private x = Infinity;
  private z = Infinity;
  private sampledAtMs = -Infinity;
  private inWater = false;
  private onBoardwalk = false;
  private samples = 0;

  constructor(private readonly clock: Clock = new SystemRealClock()) {}

  get spatialSampleCount(): number { return this.samples; }

  build(input: SimulatorSoundscapeInput): WorldContext {
    const nowMs = this.clock.nowMs();
    const blueprint = getActiveBlueprint();
    const { x, z } = input.listenerPos;
    const dx = x - this.x, dz = z - this.z;
    const moved = dx !== 0 || dz !== 0;
    const inWater = input.waterDepthM > 0.02;
    if (!this.cached || blueprint !== this.blueprint ||
        (moved && (dx * dx + dz * dz >= 1 || nowMs - this.sampledAtMs >= 200)) ||
        inWater !== this.inWater || input.onBoardwalk !== this.onBoardwalk) {
      this.cached = sampleSpatialEnvironment(x, z);
      this.blueprint = blueprint;
      this.x = x;
      this.z = z;
      this.sampledAtMs = nowMs;
      this.inWater = inWater;
      this.onBoardwalk = input.onBoardwalk;
      this.samples++;
    }
    return buildWorldContextFromSimulator(input, this.cached);
  }
}

export function buildWorldContextFromSimulator(
  input: SimulatorSoundscapeInput,
  spatial = sampleSpatialEnvironment(input.listenerPos.x, input.listenerPos.z)
): WorldContext {
  const weatherType = mapWeatherType(input.weather);
  const precipitation = weatherType === 'rain' || weatherType === 'storm' ? 'rain' : 'none';
  const weatherIntensity = weatherType === 'storm' ? 1.0 : weatherType === 'rain' ? 0.68 : weatherType === 'mist' ? 0.2 : 0.0;

  const isNight = input.sunDirY < 0.015;
  const sunElevDeg = Math.asin(Math.max(-1, Math.min(1, input.sunDirY))) * (180 / Math.PI);
  const moonAboveHorizon = input.sunDirY < -0.02 || (input.timeOfDayHours >= 21 || input.timeOfDayHours <= 4.5);
  const moonElevDeg = moonAboveHorizon ? Math.max(8, -sunElevDeg + 15) : -20;

  const { biomeId, roadInfo, villageDist } = spatial;
  const waterDistM = input.waterDepthM > 0.02 ? 0 : spatial.waterDistM;
  const campfireDistM = input.nearestCampfirePos
    ? Math.hypot(
        input.listenerPos.x - input.nearestCampfirePos.x,
        input.listenerPos.z - input.nearestCampfirePos.z
      )
    : Infinity;

  const isSleeping = Boolean(input.isSleeping);
  const isCrouching = Boolean(input.crouching && !input.seatedInTent && !isSleeping);
  const velocitySpeedMps = Math.hypot(input.listenerVelocity.x, input.listenerVelocity.z);
  const isActuallyMoving =
    !input.seatedInTent &&
    !isSleeping &&
    Boolean(input.isMoving) &&
    (input.speedMps > 0.05 || velocitySpeedMps > 0.05);

  let activity: PlayerActivity = 'idle';
  if (isSleeping) activity = 'sleeping';
  else if (input.seatedInTent) activity = 'stationary';
  else if (input.isSwimming) activity = isActuallyMoving ? 'swimming' : 'idle';
  else if (isActuallyMoving) {
    if (input.waterDepthM > 0.02 || input.isSwampWading) activity = 'wading';
    else if (isCrouching) activity = 'crouching';
    else if (input.wantRun) activity = input.exertion > 0.85 ? 'sprinting' : 'running';
    else activity = 'walking';
  }

  const gait: GaitType | null = !isActuallyMoving
    ? null
    : activity === 'swimming'
      ? 'swim'
      : activity === 'wading'
        ? 'wade'
        : activity === 'running' || activity === 'sprinting'
          ? 'run'
          : activity === 'crouching'
            ? 'crouch'
            : activity === 'walking'
              ? 'walk'
              : null;

  const surfaceMaterial = resolveSurfaceMaterial({
    onBoardwalk: input.onBoardwalk,
    inWater: input.waterDepthM > 0.02,
    structure: input.structure,
    swampWading: input.isSwampWading,
    road: roadInfo,
    biomeId,
  });

  return {
    simulationTimeMs: input.simulationTimeMs,
    timeOfDayHours: ((input.timeOfDayHours % 24) + 24) % 24,
    simulationDay: input.simulationDay,
    timeAcceleration: input.timeAcceleration,
    astronomy: {
      sunElevationDeg: sunElevDeg,
      moonElevationDeg: moonElevDeg,
      moonAboveHorizon,
      moonPhase: 0.72,
      isNight,
      sunriseHour: 4.8,
      sunsetHour: 20.8,
    },
    weather: {
      type: weatherType,
      precipitation,
      intensity: weatherIntensity,
      windSpeed: Math.max(0.08, Math.min(2.0, input.windStrength)),
      windDirectionRad: 0.65,
      fogDensity: input.fogDensity,
    },
    weatherHistory: {
      lastRainEndSimMs: null,
      accumulatedRainMm: 0,
      rainDurationMs: 0,
      timeSinceLastRainMs: Infinity,
    },
    geography: {
      elevationM: Math.max(0, input.listenerPos.y + 4),
      season: 'autumn',
      temperatureC: isNight ? 8 : 14,
      snowDepthM: 0,
      regionId: `estonia_baltic_${biomeId}`,
      biomeComposition: { ...spatial.biomeComposition },
      featureDistances: {
        riverM: Math.min(spatial.streamDistM, waterDistM),
        bogM: Math.max(0, spatial.swampFactor > 0.3 ? 0 : spatial.bogDistM),
        waterM: waterDistM,
        roadM: roadInfo.dist,
        villageM: villageDist,
        campfireM: campfireDistM,
        shelterM: input.structure.nearestShelterDistanceM,
      },
    },
    listener: {
      id: 'player_listener',
      position: { ...input.listenerPos },
      forward: { ...input.listenerForward },
      velocity: { ...input.listenerVelocity },
      biome: biomeId,
      regionId: `estonia_baltic_${biomeId}`,
      underwater: input.listenerPos.y < SWAMP_WATER_Y - 0.05,
      waterDepthM: input.waterDepthM,
    },
    player: {
      activity,
      gait,
      crouching: isCrouching,
      isMoving: isActuallyMoving,
      speedMps: isActuallyMoving ? input.speedMps : 0,
      stamina: input.stamina,
      exertion: Math.max(0, Math.min(1, input.exertion)),
      tiredness: input.tiredness,
      wetness: input.wetness,
      wearingRainJacket: input.wearingRainJacket,
      seatedInTent: input.seatedInTent,
      surfaceMaterial,
      surfaceWetness: precipitation === 'rain' ? 0.9 : input.waterDepthM > 0 ? 1.0 : 0.2,
      distanceMovedTotal: input.distanceMovedTotal,
      nearLitCampfireFactor: input.nearLitCampfireFactor,
      nearestCampfirePos: input.nearestCampfirePos,
    },
    structure: {
      id: input.structure.id,
      quality: input.structure.quality,
      profileId: input.structure.profileId,
      enclosure: input.structure.enclosure,
      roofCoverage: input.structure.roofCoverage,
      hasRoof: input.structure.hasRoof,
      roofMaterial: input.structure.roofMaterial,
      wallMaterial: input.structure.wallMaterial,
      condition: input.structure.condition,
      portalOpenness: input.structure.portalOpenness,
      abandoned: input.structure.abandoned,
      roofDrainagePoint: input.structure.roofDrainagePoint,
    },
    settings: {
      muted: input.muted,
      masterVolume: input.masterVolume ?? 1.0,
      musicEnabled: input.musicEnabled ?? true,
      musicVolume: input.musicVolume ?? 0.25,
      useEmbeddedThunderAmbience: DEFAULT_SOUNDSCAPE_CONFIG.engine.useEmbeddedThunderAmbience,
    },
  };
}

export function createSimulatorSoundscape(opts?: {
  seed?: number;
  useMockBackend?: boolean;
  realClock?: Clock;
}): {
  engine: SoundscapeEngine;
  backend: AudioBackend;
  spatialQuery: WorldSpatialQueryProvider;
  contextBuilder: SimulatorSoundscapeContextBuilder;
} {
  const spatialQuery = new WorldSpatialQueryProvider();
  const backend: AudioBackend = opts?.useMockBackend
    ? new MockAudioBackend()
    : new WebAudioHybridBackend();
  const engine = new SoundscapeEngine({
    config: DEFAULT_SOUNDSCAPE_CONFIG,
    backend,
    realClock: opts?.realClock ?? new SystemRealClock(),
    rng: new SeededRng(opts?.seed ?? 2026),
    spatialQuery,
  });
  return { engine, backend, spatialQuery, contextBuilder: new SimulatorSoundscapeContextBuilder(opts?.realClock) };
}

export type SimulatorSoundscape = ReturnType<typeof createSimulatorSoundscape>;

export function saveSoundscapeSnapshotToStorage(seed: number, engine: SoundscapeEngine): void {
  if (typeof window === 'undefined') return;
  try {
    const snap = engine.exportSnapshot();
    window.localStorage.setItem(`${SOUND_STATE_STORAGE_PREFIX}${seed}`, JSON.stringify(snap));
  } catch {
    // Ignore storage quota/access failures
  }
}

export function loadSoundscapeSnapshotFromStorage(seed: number, engine: SoundscapeEngine): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(`${SOUND_STATE_STORAGE_PREFIX}${seed}`);
    if (!raw) return false;
    const snap = JSON.parse(raw) as PersistedSoundscapeState;
    if (snap && snap.version === 1) {
      engine.importSnapshot(snap);
      return true;
    }
  } catch {
    // Ignore malformed saved state
  }
  return false;
}
