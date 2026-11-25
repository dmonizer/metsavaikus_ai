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
  SurfaceMaterial,
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
  getSwampFactor,
  getTerrainHeight,
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

function estimateWaterDistanceM(x: number, z: number): number {
  if (getTerrainHeight(x, z) <= SWAMP_WATER_Y + 0.04) return 0;
  const bp = getActiveBlueprint();
  const roughBogEdge = Math.max(0, Math.hypot(x - bp.bogCenterX, z - bp.bogCenterZ) - bp.bogRadius);
  if (roughBogEdge > 140) return roughBogEdge;

  // Quick 8-direction probe across nearby shoreline rings
  const rings = [12, 28, 52, 85, 115];
  for (const r of rings) {
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const sx = x + Math.cos(ang) * r;
      const sz = z + Math.sin(ang) * r;
      if (getTerrainHeight(sx, sz) <= SWAMP_WATER_Y + 0.04) {
        return r;
      }
    }
  }
  return Math.max(25, roughBogEdge);
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
      for (let attempt = 0; attempt < 24; attempt++) {
        const ang = rngNext() * Math.PI * 2;
        const dist = lo + rngNext() * (hi - lo);
        const px = listenerPos.x + Math.cos(ang) * dist;
        const pz = listenerPos.z + Math.sin(ang) * dist;
        const h = getTerrainHeight(px, pz);
        const swamp = getSwampFactor(px, pz);
        if (h <= SWAMP_WATER_Y + 0.12 || (feature === 'bog' && swamp > 0.45)) {
          return {
            position: { x: px, y: Math.max(h, SWAMP_WATER_Y), z: pz },
            featureFound: true,
          };
        }
      }
      // Fallback toward bog center clamped into [lo, hi]
      const bp = getActiveBlueprint();
      const dx = bp.bogCenterX - listenerPos.x;
      const dz = bp.bogCenterZ - listenerPos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1) {
        const clamped = Math.max(lo, Math.min(hi, d));
        const px = listenerPos.x + (dx / d) * clamped;
        const pz = listenerPos.z + (dz / d) * clamped;
        const h = getTerrainHeight(px, pz);
        if (h <= SWAMP_WATER_Y + 0.25 || getSwampFactor(px, pz) > 0.35) {
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

export function buildWorldContextFromSimulator(input: SimulatorSoundscapeInput): WorldContext {
  const weatherType = mapWeatherType(input.weather);
  const precipitation = weatherType === 'rain' || weatherType === 'storm' ? 'rain' : 'none';
  const weatherIntensity = weatherType === 'storm' ? 1.0 : weatherType === 'rain' ? 0.68 : weatherType === 'mist' ? 0.2 : 0.0;

  const isNight = input.sunDirY < 0.015;
  const sunElevDeg = Math.asin(Math.max(-1, Math.min(1, input.sunDirY))) * (180 / Math.PI);
  const moonAboveHorizon = input.sunDirY < -0.02 || (input.timeOfDayHours >= 21 || input.timeOfDayHours <= 4.5);
  const moonElevDeg = moonAboveHorizon ? Math.max(8, -sunElevDeg + 15) : -20;

  const biomeInfo = getBiomeInfo(input.listenerPos.x, input.listenerPos.z);
  const biomeId = normalizeBiomeId(biomeInfo.id);
  const roadInfo = distToRoadDetail(input.listenerPos.x, input.listenerPos.z);
  const villageDist = getDistanceToNearestVillage(input.listenerPos.x, input.listenerPos.z).dist;
  const waterDistM = input.waterDepthM > 0.02 ? 0 : estimateWaterDistanceM(input.listenerPos.x, input.listenerPos.z);
  const campfireDistM = input.nearestCampfirePos
    ? Math.hypot(
        input.listenerPos.x - input.nearestCampfirePos.x,
        input.listenerPos.z - input.nearestCampfirePos.z
      )
    : Infinity;

  let activity: PlayerActivity = 'idle';
  if (input.seatedInTent) activity = 'stationary';
  else if (input.isSwimming) activity = 'swimming';
  else if (input.isMoving) {
    if (input.isSwampWading) activity = 'wading';
    else if (input.crouching) activity = 'crouching';
    else if (input.wantRun) activity = input.exertion > 0.85 ? 'sprinting' : 'running';
    else activity = 'walking';
  } else if (input.crouching) {
    activity = 'crouching';
  }

  const gait: GaitType | null =
    activity === 'swimming'
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

  let surfaceMaterial: SurfaceMaterial = 'forest_floor';
  if (input.onBoardwalk) {
    surfaceMaterial = 'wooden_boardwalk';
  } else if (input.waterDepthM > 0.02) {
    surfaceMaterial = 'water';
  } else if (input.structure.id && input.structure.quality !== 'outdoor' && input.structure.quality !== 'tent') {
    surfaceMaterial = input.structure.floorMaterial;
  } else if (input.isSwampWading) {
    surfaceMaterial = 'mud';
  } else if (roadInfo.dist < 3.3 && !roadInfo.isTrail) {
    surfaceMaterial = 'gravel';
  } else if (biomeId === 'village') {
    surfaceMaterial = 'grass';
  } else {
    surfaceMaterial = 'forest_floor';
  }

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
      biomeComposition: computeBiomeComposition(input.listenerPos.x, input.listenerPos.z),
      featureDistances: {
        riverM: waterDistM,
        bogM: Math.max(0, getSwampFactor(input.listenerPos.x, input.listenerPos.z) > 0.3 ? 0 : waterDistM),
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
      underwater: input.waterDepthM > 1.35,
      waterDepthM: input.waterDepthM,
    },
    player: {
      activity,
      gait,
      speedMps: input.speedMps,
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
  return { engine, backend, spatialQuery };
}

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
