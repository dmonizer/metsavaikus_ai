import { isMinutesInWindow, parseDistanceM, parseDurationMs, parseTimeToMinutes } from './clocks';
import type {
  ComparisonOp,
  ConditionNode,
  DistanceToFeatureCondition,
  FeatureType,
  SimulationEvent,
  StructureContext,
  TimeWindowDef,
  WorldContext,
} from './types';

export interface EntityContext {
  id?: string;
  biome?: string;
  regionId?: string;
  position?: { x: number; y: number; z: number };
  structure?: Partial<StructureContext>;
  distanceToFeatures?: Partial<Record<FeatureType, number>>;
  underwater?: boolean;
  material?: string;
  mass?: number;
  velocity?: number;
  damage?: number;
  breakable?: boolean;
  condition?: string;
  [k: string]: unknown;
}

export interface ConditionEvalContext {
  world: WorldContext;
  event?: SimulationEvent | null;
  source?: EntityContext;
  triggerEntity?: EntityContext;
  isDisturbedAtListener?: boolean;
  isDisturbedForSound?: (soundId: string, busId: string, tags?: readonly string[]) => boolean;
}

export type CustomConditionEvaluator = (
  params: Record<string, unknown> | undefined,
  ctx: ConditionEvalContext
) => boolean;

interface TemporalRuleState {
  firstTrueRealMs: number | null;
  lastTrueRealMs: number | null;
  lastCheckedRealMs: number;
}

const RESERVED_KEYS = new Set([
  'all',
  'any',
  'not',
  'time',
  'custom',
  'durationMs',
  'hysteresisMs',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getByPath(root: unknown, path: string): unknown {
  if (!root || typeof root !== 'object') return undefined;
  const parts = path.split('.');
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function normalizeFeatureDistance(
  ctx: ConditionEvalContext,
  who: 'listener' | 'source',
  feature: FeatureType
): number {
  if (who === 'source' && ctx.source?.distanceToFeatures) {
    const sf = ctx.source.distanceToFeatures;
    const direct = sf[feature];
    if (direct !== undefined) return direct;
    if ((feature === 'river' || feature === 'bog') && sf.water !== undefined) {
      return sf.water;
    }
  }
  const fd = ctx.world.geography.featureDistances;
  switch (feature) {
    case 'river':
      return fd.riverM ?? fd.waterM ?? Infinity;
    case 'bog':
      return fd.bogM ?? fd.waterM ?? Infinity;
    case 'water':
      return fd.waterM ?? Infinity;
    case 'road':
      return fd.roadM ?? Infinity;
    case 'village':
      return fd.villageM ?? Infinity;
    case 'campfire':
      return fd.campfireM ?? Infinity;
    case 'shelter':
      return fd.shelterM ?? Infinity;
    default:
      return Infinity;
  }
}

export class ConditionEvaluator {
  private customEvaluators = new Map<string, CustomConditionEvaluator>();
  private temporalStates = new Map<string, TemporalRuleState>();

  registerEvaluator(name: string, fn: CustomConditionEvaluator): void {
    this.customEvaluators.set(name, fn);
  }

  evaluate(
    node: ConditionNode | undefined,
    ctx: ConditionEvalContext,
    ruleKey?: string,
    nowRealMs = 0
  ): { passed: boolean; reasons: string[] } {
    if (!node) {
      return { passed: true, reasons: [] };
    }

    const rawResult = this.evaluateNodeRaw(node, ctx);

    const durMs = node.durationMs !== undefined ? parseDurationMs(node.durationMs, 0) : 0;
    const hystMs = node.hysteresisMs !== undefined ? parseDurationMs(node.hysteresisMs, 0) : 0;

    if (!ruleKey || (durMs <= 0 && hystMs <= 0)) {
      return rawResult;
    }

    let state = this.temporalStates.get(ruleKey);
    if (!state || nowRealMs < state.lastCheckedRealMs) {
      state = {
        firstTrueRealMs: rawResult.passed ? nowRealMs : null,
        lastTrueRealMs: rawResult.passed ? nowRealMs : null,
        lastCheckedRealMs: nowRealMs,
      };
      this.temporalStates.set(ruleKey, state);
    } else {
      state.lastCheckedRealMs = nowRealMs;
      if (rawResult.passed) {
        if (state.firstTrueRealMs === null) state.firstTrueRealMs = nowRealMs;
        state.lastTrueRealMs = nowRealMs;
      } else {
        state.firstTrueRealMs = null;
      }
    }

    if (rawResult.passed) {
      if (durMs > 0) {
        const heldMs = state.firstTrueRealMs !== null ? nowRealMs - state.firstTrueRealMs : 0;
        if (heldMs < durMs) {
          return {
            passed: false,
            reasons: [
              `durationMs pending (${Math.round(heldMs)}/${Math.round(durMs)}ms)`,
            ],
          };
        }
      }
      return { passed: true, reasons: [] };
    }

    if (hystMs > 0 && state.lastTrueRealMs !== null) {
      const sinceFalseMs = nowRealMs - state.lastTrueRealMs;
      if (sinceFalseMs <= hystMs) {
        return { passed: true, reasons: [] };
      }
    }

    return rawResult;
  }

  private evaluateNodeRaw(
    node: ConditionNode,
    ctx: ConditionEvalContext
  ): { passed: boolean; reasons: string[] } {
    const reasons: string[] = [];

    if (node.all) {
      for (const child of node.all) {
        const res = this.evaluateNodeRaw(child, ctx);
        if (!res.passed) {
          reasons.push(...res.reasons);
          return { passed: false, reasons };
        }
      }
    }

    if (node.any) {
      let anyPassed = false;
      const subReasons: string[] = [];
      for (const child of node.any) {
        const res = this.evaluateNodeRaw(child, ctx);
        if (res.passed) {
          anyPassed = true;
          break;
        }
        subReasons.push(...res.reasons);
      }
      if (!anyPassed) {
        return {
          passed: false,
          reasons: [`any failed: (${subReasons.join(' | ')})`],
        };
      }
    }

    if (node.not) {
      const res = this.evaluateNodeRaw(node.not, ctx);
      if (res.passed) {
        return { passed: false, reasons: ['not condition matched'] };
      }
    }

    if (node.time) {
      const minuteOfDay = ((ctx.world.timeOfDayHours % 24) + 24) % 24 * 60;
      const windows: TimeWindowDef[] = [];
      if (node.time.from && node.time.to) {
        windows.push({ from: node.time.from, to: node.time.to });
      }
      if (node.time.windows) {
        for (const w of node.time.windows) {
          if (Array.isArray(w)) windows.push({ from: w[0], to: w[1] });
          else windows.push(w);
        }
      }
      const inAny = windows.some((w) => isMinutesInWindow(minuteOfDay, w));
      if (!inAny) {
        const winLabel = windows.map((w) => `${w.from}-${w.to}`).join(', ');
        return {
          passed: false,
          reasons: [`time outside [${winLabel}]`],
        };
      }
    }

    if (node.custom) {
      const fn = this.customEvaluators.get(node.custom.name);
      if (!fn) {
        return {
          passed: false,
          reasons: [`unregistered custom evaluator "${node.custom.name}"`],
        };
      }
      if (!fn(node.custom.params, ctx)) {
        return {
          passed: false,
          reasons: [`custom("${node.custom.name}") returned false`],
        };
      }
    }

    for (const [key, expected] of Object.entries(node)) {
      if (RESERVED_KEYS.has(key)) continue;

      if (key === 'listener.distance_to_feature' || key === 'source.distance_to_feature') {
        const who = key.startsWith('source.') ? 'source' : 'listener';
        const spec = expected as DistanceToFeatureCondition;
        const dist = normalizeFeatureDistance(ctx, who, spec.type);
        if (!this.checkDistanceCondition(dist, spec)) {
          return {
            passed: false,
            reasons: [`${key}(${spec.type})=${Math.round(dist)}m failed`],
          };
        }
        continue;
      }

      const actual = this.resolveFieldValue(key, ctx);
      const check = this.matchComparison(key, actual, expected);
      if (!check.passed) {
        return check;
      }
    }

    return { passed: true, reasons: [] };
  }

  private checkDistanceCondition(dist: number, spec: DistanceToFeatureCondition): boolean {
    if (spec.gt !== undefined && !(dist > parseDistanceM(spec.gt))) return false;
    if (spec.gte !== undefined && !(dist >= parseDistanceM(spec.gte))) return false;
    if (spec.lt !== undefined && !(dist < parseDistanceM(spec.lt))) return false;
    if (spec.lte !== undefined && !(dist <= parseDistanceM(spec.lte))) return false;
    return true;
  }

  private resolveFieldValue(path: string, ctx: ConditionEvalContext): unknown {
    const w = ctx.world;

    if (path.startsWith('weather.')) {
      return getByPath(w.weather, path.slice('weather.'.length));
    }
    if (path.startsWith('weather_history.')) {
      const sub = path.slice('weather_history.'.length);
      if (sub === 'last_rain') return w.weatherHistory.timeSinceLastRainMs;
      if (sub === 'accumulated_rain_mm') return w.weatherHistory.accumulatedRainMm;
      if (sub === 'rain_duration_ms') return w.weatherHistory.rainDurationMs;
      return getByPath(w.weatherHistory, sub);
    }
    if (path.startsWith('astronomy.')) {
      const sub = path.slice('astronomy.'.length);
      if (sub === 'is_night') return w.astronomy.isNight;
      if (sub === 'moon_above_horizon') return w.astronomy.moonAboveHorizon;
      if (sub === 'sun_elevation_deg') return w.astronomy.sunElevationDeg;
      if (sub === 'moon_elevation_deg') return w.astronomy.moonElevationDeg;
      if (sub === 'moon_phase') return w.astronomy.moonPhase;
      return getByPath(w.astronomy, sub);
    }
    if (path.startsWith('listener.')) {
      const sub = path.slice('listener.'.length);
      if (sub === 'biome') return w.listener.biome;
      if (sub === 'underwater') return w.listener.underwater;
      if (sub === 'water_depth') return w.listener.waterDepthM;
      if (sub === 'region') return w.listener.regionId;
      return getByPath(w.listener, sub);
    }
    if (path.startsWith('source.')) {
      const sub = path.slice('source.'.length);
      if (sub.startsWith('structure.')) {
        const sSub = sub.slice('structure.'.length);
        const struct = ctx.source?.structure ?? w.structure;
        if (sSub === 'has_roof') return struct.hasRoof ?? w.structure.hasRoof;
        if (sSub === 'enclosure') return struct.enclosure ?? w.structure.enclosure;
        if (sSub === 'roof_coverage') return struct.roofCoverage ?? w.structure.roofCoverage;
        if (sSub === 'portal_openness') return struct.portalOpenness ?? w.structure.portalOpenness;
        if (sSub === 'quality') return struct.quality ?? w.structure.quality;
        if (sSub === 'condition') return struct.condition ?? w.structure.condition;
        return getByPath(struct, sSub);
      }
      if (sub === 'biome') return ctx.source?.biome ?? w.listener.biome;
      if (sub === 'region') return ctx.source?.regionId ?? w.listener.regionId;
      return getByPath(ctx.source ?? w.listener, sub);
    }
    if (path.startsWith('trigger.')) {
      const sub = path.slice('trigger.'.length);
      return getByPath(ctx.triggerEntity ?? ctx.event?.payload, sub);
    }
    if (path.startsWith('event.')) {
      const sub = path.slice('event.'.length);
      if (sub === 'type') return ctx.event?.type;
      if (sub === 'origin') return ctx.event?.origin;
      if (sub === 'intensity') return ctx.event?.intensity;
      if (sub.startsWith('payload.')) return getByPath(ctx.event?.payload, sub.slice('payload.'.length));
      return getByPath(ctx.event, sub) ?? getByPath(ctx.event?.payload, sub);
    }
    if (path.startsWith('player.')) {
      const sub = path.slice('player.'.length);
      if (sub === 'activity') return w.player.activity;
      if (sub === 'gait') return w.player.gait;
      if (sub === 'crouching') return Boolean(w.player.crouching ?? w.player.activity === 'crouching');
      if (sub === 'is_moving') return Boolean(w.player.isMoving ?? w.player.speedMps > 0.05);
      if (sub === 'speed') return w.player.speedMps;
      if (sub === 'stamina') return w.player.stamina;
      if (sub === 'exertion') return w.player.exertion;
      if (sub === 'tiredness') return w.player.tiredness;
      if (sub === 'wetness') return w.player.wetness;
      if (sub === 'surface_material') return w.player.surfaceMaterial;
      if (sub === 'seated_in_tent') return w.player.seatedInTent;
      if (sub === 'wearing_rain_jacket') return w.player.wearingRainJacket;
      if (sub === 'near_campfire') return w.player.nearLitCampfireFactor > 0.2;
      return getByPath(w.player, sub);
    }
    if (path.startsWith('environment.')) {
      const sub = path.slice('environment.'.length);
      if (sub === 'surface_wetness') return w.player.surfaceWetness;
      if (sub === 'temperature_c') return w.geography.temperatureC;
      if (sub === 'season') return w.geography.season;
      if (sub === 'snow_depth_m') return w.geography.snowDepthM;
      if (sub === 'elevation_m') return w.geography.elevationM;
      return getByPath(w.geography, sub);
    }
    if (path.startsWith('structure.')) {
      const sub = path.slice('structure.'.length);
      if (sub === 'has_roof') return w.structure.hasRoof;
      if (sub === 'portal_openness') return w.structure.portalOpenness;
      if (sub === 'roof_coverage') return w.structure.roofCoverage;
      return getByPath(w.structure, sub);
    }
    if (path.startsWith('settings.')) {
      const sub = path.slice('settings.'.length);
      if (sub === 'music_enabled') return w.settings.musicEnabled;
      if (sub === 'music_volume') return w.settings.musicVolume;
      if (sub === 'muted') return w.settings.muted;
      if (sub === 'use_embedded_thunder') return w.settings.useEmbeddedThunderAmbience;
      return getByPath(w.settings, sub);
    }
    if (path === 'disturbance.active') {
      return Boolean(ctx.isDisturbedAtListener);
    }
    return getByPath(w, path);
  }

  private matchComparison(
    field: string,
    actual: unknown,
    expected: unknown
  ): { passed: boolean; reasons: string[] } {
    if (!isPlainObject(expected)) {
      if (actual === expected) return { passed: true, reasons: [] };
      // Friendly match for "walking" encompassing running/sprinting/wading? Keep strict unless configured with `in`!
      return {
        passed: false,
        reasons: [`${field}=${String(actual)} != ${String(expected)}`],
      };
    }

    const op = expected as ComparisonOp;
    if (op.eq !== undefined && actual !== op.eq) {
      return { passed: false, reasons: [`${field}=${String(actual)} != ${String(op.eq)}`] };
    }
    if (op.ne !== undefined && actual === op.ne) {
      return { passed: false, reasons: [`${field}=${String(actual)} == ${String(op.ne)}`] };
    }
    if (op.in !== undefined && !op.in.includes(actual)) {
      return { passed: false, reasons: [`${field}=${String(actual)} not in [${op.in.join(',')}]`] };
    }
    if (op.not_in !== undefined && op.not_in.includes(actual)) {
      return { passed: false, reasons: [`${field}=${String(actual)} in excluded [${op.not_in.join(',')}]`] };
    }
    if (op.within !== undefined) {
      const maxMs = parseDurationMs(op.within);
      if (typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0 || actual > maxMs) {
        return {
          passed: false,
          reasons: [`${field}=${String(actual)}ms not within ${maxMs}ms`],
        };
      }
    }
    if (op.gt !== undefined && (typeof actual !== 'number' || !(actual > op.gt))) {
      return { passed: false, reasons: [`${field}=${String(actual)} <= ${op.gt}`] };
    }
    if (op.gte !== undefined && (typeof actual !== 'number' || !(actual >= op.gte))) {
      return { passed: false, reasons: [`${field}=${String(actual)} < ${op.gte}`] };
    }
    if (op.lt !== undefined && (typeof actual !== 'number' || !(actual < op.lt))) {
      return { passed: false, reasons: [`${field}=${String(actual)} >= ${op.lt}`] };
    }
    if (op.lte !== undefined && (typeof actual !== 'number' || !(actual <= op.lte))) {
      return { passed: false, reasons: [`${field}=${String(actual)} > ${op.lte}`] };
    }
    if (op.between !== undefined) {
      const [lo, hi] = op.between;
      if (typeof actual !== 'number' || actual < lo || actual > hi) {
        return { passed: false, reasons: [`${field}=${String(actual)} outside [${lo},${hi}]`] };
      }
    }

    return { passed: true, reasons: [] };
  }

  clearTemporalStates(): void {
    this.temporalStates.clear();
  }
}

export function isTimeWindowConditionMatch(timeHours: number, from: string, to: string): boolean {
  const fromM = parseTimeToMinutes(from);
  const toM = parseTimeToMinutes(to);
  if (!Number.isFinite(fromM) || !Number.isFinite(toM)) return false;
  return isMinutesInWindow(timeHours * 60, { from, to });
}
