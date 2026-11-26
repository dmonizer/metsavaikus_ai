import { parseDistanceM, parseDurationMs, parseTimeToMinutes } from './clocks';
import type {
  AcousticProfile,
  BiomeProfile,
  BusDefinition,
  ConditionNode,
  DisturbanceProfile,
  MaterialProfile,
  SoundDefinition,
  SoundscapeConfig,
  TimeWindowDef,
  ValidationIssue,
} from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Resolves `extends` inheritance chains on config entries.
 * Rules:
 * - Child scalar/object properties merge deeply onto parent properties.
 * - Arrays replace parent arrays explicitly unless `$remove` removes entries.
 * - `$remove` removes listed property keys from the merged definition (or `"prop.sub"` dotted paths).
 * - Cycles in `extends` emit structured errors and abort that chain safely.
 */
export function resolveInheritanceList<
  T extends { id: string; extends?: string; $remove?: string[] },
>(
  items: readonly T[],
  fileLabel: string,
  issues: ValidationIssue[]
): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (byId.has(item.id)) {
      issues.push({
        file: fileLabel,
        definition: item.id,
        property: 'id',
        message: `Duplicate definition ID "${item.id}"`,
        severity: 'error',
      });
    } else {
      byId.set(item.id, item);
    }
  }

  const resolved = new Map<string, T>();
  const visiting = new Set<string>();

  const resolveOne = (id: string): T | null => {
    const existing = resolved.get(id);
    if (existing) return existing;

    const raw = byId.get(id);
    if (!raw) return null;

    if (visiting.has(id)) {
      issues.push({
        file: fileLabel,
        definition: id,
        property: 'extends',
        message: `Cyclic inheritance detected involving "${id}"`,
        severity: 'error',
      });
      return structuredClone(raw);
    }

    visiting.add(id);
    let merged: Record<string, unknown>;
    if (raw.extends) {
      if (!byId.has(raw.extends)) {
        issues.push({
          file: fileLabel,
          definition: id,
          property: 'extends',
          message: `Unknown parent definition "${raw.extends}"`,
          severity: 'error',
        });
        merged = structuredClone(raw) as unknown as Record<string, unknown>;
      } else {
        const parentResolved = resolveOne(raw.extends);
        merged = deepMergeWithArraysReplaced(
          (parentResolved ?? {}) as Record<string, unknown>,
          raw as unknown as Record<string, unknown>
        );
      }
    } else {
      merged = structuredClone(raw) as unknown as Record<string, unknown>;
    }

    if (Array.isArray(raw.$remove)) {
      for (const path of raw.$remove) {
        deleteAtPath(merged, path);
      }
    }
    delete merged.$remove;
    delete merged.extends;
    visiting.delete(id);

    const typed = merged as unknown as T;
    resolved.set(id, typed);
    return typed;
  };

  const out: T[] = [];
  for (const item of items) {
    const r = resolveOne(item.id);
    if (r) out.push(r);
  }
  return out;
}

function deepMergeWithArraysReplaced(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(base);
  for (const [key, val] of Object.entries(override)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      result[key] = structuredClone(val);
    } else if (isPlainObject(val) && isPlainObject(result[key])) {
      result[key] = deepMergeWithArraysReplaced(
        result[key] as Record<string, unknown>,
        val
      );
    } else {
      result[key] = structuredClone(val);
    }
  }
  return result;
}

function deleteAtPath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!isPlainObject(next)) return;
    cur = next;
  }
  delete cur[parts[parts.length - 1]];
}

function validateRange(
  val: unknown,
  file: string,
  defId: string,
  prop: string,
  issues: ValidationIssue[],
  minAllowed = -Infinity,
  maxAllowed = Infinity
): void {
  if (val === undefined) return;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val < minAllowed || val > maxAllowed) {
      issues.push({
        file,
        definition: defId,
        property: prop,
        message: `Value ${val} out of allowed bounds [${minAllowed}, ${maxAllowed}]`,
        severity: 'error',
      });
    }
    return;
  }
  if (Array.isArray(val) && val.length === 2) {
    const [a, b] = val;
    if (
      typeof a !== 'number' ||
      typeof b !== 'number' ||
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      a > b ||
      a < minAllowed ||
      b > maxAllowed
    ) {
      issues.push({
        file,
        definition: defId,
        property: prop,
        message: `Invalid range [${String(a)}, ${String(b)}] (expected ordered finite numbers within [${minAllowed}, ${maxAllowed}])`,
        severity: 'error',
      });
    }
    return;
  }
  issues.push({
    file,
    definition: defId,
    property: prop,
    message: `Expected number or [min, max] tuple`,
    severity: 'error',
  });
}

function validateDurationPair(
  val: unknown,
  file: string,
  defId: string,
  prop: string,
  issues: ValidationIssue[]
): void {
  if (val === undefined) return;
  if (Array.isArray(val) && val.length === 2) {
    const a = parseDurationMs(val[0] as number | string);
    const b = parseDurationMs(val[1] as number | string);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a > b) {
      issues.push({
        file,
        definition: defId,
        property: prop,
        message: `Invalid duration range [${String(val[0])}, ${String(val[1])}]`,
        severity: 'error',
      });
    }
    return;
  }
  const ms = parseDurationMs(val as number | string);
  if (!Number.isFinite(ms) || ms < 0) {
    issues.push({
      file,
      definition: defId,
      property: prop,
      message: `Invalid duration "${String(val)}"`,
      severity: 'error',
    });
  }
}

function validateDistancePair(
  val: unknown,
  file: string,
  defId: string,
  prop: string,
  issues: ValidationIssue[]
): void {
  if (val === undefined) return;
  if (Array.isArray(val) && val.length === 2) {
    const a = parseDistanceM(val[0] as number | string);
    const b = parseDistanceM(val[1] as number | string);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a > b) {
      issues.push({
        file,
        definition: defId,
        property: prop,
        message: `Invalid distance range [${String(val[0])}, ${String(val[1])}]`,
        severity: 'error',
      });
    }
    return;
  }
  const m = parseDistanceM(val as number | string);
  if (!Number.isFinite(m) || m < 0) {
    issues.push({
      file,
      definition: defId,
      property: prop,
      message: `Invalid distance "${String(val)}"`,
      severity: 'error',
    });
  }
}

function validateTimeWindow(
  win: TimeWindowDef | [string, string],
  file: string,
  defId: string,
  prop: string,
  issues: ValidationIssue[]
): void {
  const from = Array.isArray(win) ? win[0] : win.from;
  const to = Array.isArray(win) ? win[1] : win.to;
  if (!Number.isFinite(parseTimeToMinutes(from)) || !Number.isFinite(parseTimeToMinutes(to))) {
    issues.push({
      file,
      definition: defId,
      property: prop,
      message: `Invalid time window "${String(from)}" -> "${String(to)}" (expected HH:MM)`,
      severity: 'error',
    });
  }
}

function validateConditionNode(
  node: ConditionNode | undefined,
  file: string,
  defId: string,
  prop: string,
  issues: ValidationIssue[]
): void {
  if (!node) return;
  if (!isPlainObject(node)) {
    issues.push({
      file,
      definition: defId,
      property: prop,
      message: 'Condition node must be an object',
      severity: 'error',
    });
    return;
  }
  if (node.all !== undefined) {
    if (!Array.isArray(node.all)) {
      issues.push({ file, definition: defId, property: `${prop}.all`, message: '"all" must be an array', severity: 'error' });
    } else {
      node.all.forEach((child, idx) => validateConditionNode(child, file, defId, `${prop}.all[${idx}]`, issues));
    }
  }
  if (node.any !== undefined) {
    if (!Array.isArray(node.any)) {
      issues.push({ file, definition: defId, property: `${prop}.any`, message: '"any" must be an array', severity: 'error' });
    } else {
      node.any.forEach((child, idx) => validateConditionNode(child, file, defId, `${prop}.any[${idx}]`, issues));
    }
  }
  if (node.not !== undefined) {
    validateConditionNode(node.not, file, defId, `${prop}.not`, issues);
  }
  if (node.time !== undefined) {
    if (node.time.from !== undefined || node.time.to !== undefined) {
      if (!node.time.from || !node.time.to) {
        issues.push({ file, definition: defId, property: `${prop}.time`, message: 'time window requires both "from" and "to"', severity: 'error' });
      } else {
        validateTimeWindow({ from: node.time.from, to: node.time.to }, file, defId, `${prop}.time`, issues);
      }
    }
    if (node.time.windows !== undefined) {
      if (!Array.isArray(node.time.windows) || node.time.windows.length === 0) {
        issues.push({ file, definition: defId, property: `${prop}.time.windows`, message: 'time.windows must be a non-empty array', severity: 'error' });
      } else {
        node.time.windows.forEach((w, idx) => validateTimeWindow(w, file, defId, `${prop}.time.windows[${idx}]`, issues));
      }
    }
  }
  if (node.durationMs !== undefined) {
    validateDurationPair(node.durationMs, file, defId, `${prop}.durationMs`, issues);
  }
  if (node.hysteresisMs !== undefined) {
    validateDurationPair(node.hysteresisMs, file, defId, `${prop}.hysteresisMs`, issues);
  }
}

export interface NormalizedSoundscapeConfig {
  raw: SoundscapeConfig;
  resolved: SoundscapeConfig;
  busMap: Map<string, BusDefinition>;
  assetMap: Map<string, SoundscapeConfig['assets'][number]>;
  soundMap: Map<string, SoundDefinition>;
  materialMap: Map<string, MaterialProfile>;
  acousticMap: Map<string, AcousticProfile>;
  biomeMap: Map<string, BiomeProfile>;
  issues: ValidationIssue[];
}

export function normalizeAndValidateConfig(config: SoundscapeConfig): NormalizedSoundscapeConfig {
  const issues: ValidationIssue[] = [];

  // 1. Validate buses + cycle detection
  const busMap = new Map<string, BusDefinition>();
  for (const bus of config.buses) {
    if (busMap.has(bus.id)) {
      issues.push({
        file: 'buses',
        definition: bus.id,
        property: 'id',
        message: `Duplicate bus ID "${bus.id}"`,
        severity: 'error',
      });
    } else {
      busMap.set(bus.id, bus);
    }
    if (bus.volume !== undefined && (bus.volume < 0 || bus.volume > 2 || !Number.isFinite(bus.volume))) {
      issues.push({
        file: 'buses',
        definition: bus.id,
        property: 'volume',
        message: `Invalid bus volume ${bus.volume}`,
        severity: 'error',
      });
    }
  }
  for (const bus of config.buses) {
    if (bus.parent && !busMap.has(bus.parent)) {
      issues.push({
        file: 'buses',
        definition: bus.id,
        property: 'parent',
        message: `Unknown parent bus "${bus.parent}"`,
        severity: 'error',
      });
    }
    // Check cycle
    const seen = new Set<string>([bus.id]);
    let cur = bus.parent ?? null;
    while (cur) {
      if (seen.has(cur)) {
        issues.push({
          file: 'buses',
          definition: bus.id,
          property: 'parent',
          message: `Cyclic bus hierarchy detected at "${cur}"`,
          severity: 'error',
        });
        break;
      }
      seen.add(cur);
      cur = busMap.get(cur)?.parent ?? null;
    }
    if (bus.ducking) {
      for (const d of bus.ducking) {
        if (!busMap.has(d.targetBus)) {
          issues.push({
            file: 'buses',
            definition: bus.id,
            property: 'ducking.targetBus',
            message: `Unknown ducking target bus "${d.targetBus}"`,
            severity: 'error',
          });
        }
      }
    }
  }

  // 2. Validate assets
  const assetMap = new Map<string, SoundscapeConfig['assets'][number]>();
  for (const asset of config.assets) {
    if (assetMap.has(asset.id)) {
      issues.push({
        file: 'assets',
        definition: asset.id,
        property: 'id',
        message: `Duplicate asset ID "${asset.id}"`,
        severity: 'error',
      });
    } else {
      assetMap.set(asset.id, asset);
    }
    if (asset.placeholder) {
      issues.push({
        file: 'assets',
        definition: asset.id,
        property: 'placeholder',
        message: `Asset "${asset.id}" (${asset.file}) is an explicit placeholder and will use procedural fallback or silent warning`,
        severity: 'warning',
      });
    }
  }

  // 3. Resolve inheritance for materials, acoustics, biomes, sounds
  const resolvedMaterials = resolveInheritanceList<MaterialProfile>(config.materials, 'materials', issues);
  const resolvedAcoustics = resolveInheritanceList<AcousticProfile>(config.acoustics, 'acoustics', issues);
  const resolvedBiomes = resolveInheritanceList<BiomeProfile>(config.biomes, 'biomes', issues);
  const resolvedSounds = resolveInheritanceList<SoundDefinition>(config.sounds, 'sounds', issues);

  const soundMap = new Map<string, SoundDefinition>();
  for (const s of resolvedSounds) soundMap.set(s.id, s);

  const materialMap = new Map<string, MaterialProfile>();
  for (const m of resolvedMaterials) materialMap.set(m.id, m);

  const acousticMap = new Map<string, AcousticProfile>();
  for (const a of resolvedAcoustics) acousticMap.set(a.id, a);

  const biomeMap = new Map<string, BiomeProfile>();
  for (const b of resolvedBiomes) biomeMap.set(b.id, b);

  // 4. Validate resolved sounds
  for (const sound of resolvedSounds) {
    if (!busMap.has(sound.bus)) {
      issues.push({
        file: 'sounds',
        definition: sound.id,
        property: 'bus',
        message: `Unknown bus "${sound.bus}"`,
        severity: 'error',
      });
    }
    if (!Array.isArray(sound.assets) || sound.assets.length === 0) {
      issues.push({
        file: 'sounds',
        definition: sound.id,
        property: 'assets',
        message: 'Sound definition must reference at least one asset',
        severity: 'error',
      });
    } else {
      sound.assets.forEach((aRef, idx) => {
        if (!assetMap.has(aRef.assetId)) {
          issues.push({
            file: 'sounds',
            definition: sound.id,
            property: `assets[${idx}].assetId`,
            message: `Unknown asset "${aRef.assetId}"`,
            severity: 'error',
          });
        }
        if (aRef.weight !== undefined && (aRef.weight < 0 || !Number.isFinite(aRef.weight))) {
          issues.push({
            file: 'sounds',
            definition: sound.id,
            property: `assets[${idx}].weight`,
            message: `Asset weight must be >= 0`,
            severity: 'error',
          });
        }
      });
    }

    validateRange(sound.playback.volume, 'sounds', sound.id, 'playback.volume', issues, 0, 4);
    validateRange(sound.playback.pitch, 'sounds', sound.id, 'playback.pitch', issues, 0.1, 4);
    validateRange(sound.playback.speed, 'sounds', sound.id, 'playback.speed', issues, 0.1, 4);
    validateDurationPair(sound.playback.fadeInMs, 'sounds', sound.id, 'playback.fadeInMs', issues);
    validateDurationPair(sound.playback.fadeOutMs, 'sounds', sound.id, 'playback.fadeOutMs', issues);
    validateDurationPair(sound.playback.crossfadeMs, 'sounds', sound.id, 'playback.crossfadeMs', issues);
    if (sound.playback.loop?.pause) {
      validateDurationPair(sound.playback.loop.pause, 'sounds', sound.id, 'playback.loop.pause', issues);
    }

    validateDistancePair(sound.spatial.referenceDistanceM, 'sounds', sound.id, 'spatial.referenceDistanceM', issues);
    validateDistancePair(sound.spatial.maximumDistanceM, 'sounds', sound.id, 'spatial.maximumDistanceM', issues);
    validateDistancePair(sound.spatial.spawnDistanceM, 'sounds', sound.id, 'spatial.spawnDistanceM', issues);

    if (sound.schedule) {
      if (sound.schedule.occurrencesPerWindow) {
        validateRange(sound.schedule.occurrencesPerWindow, 'sounds', sound.id, 'schedule.occurrencesPerWindow', issues, 0, 1000);
      }
      if (sound.schedule.interval) {
        validateDurationPair(sound.schedule.interval, 'sounds', sound.id, 'schedule.interval', issues);
      }
      if (sound.schedule.minInterval !== undefined) {
        validateDurationPair(sound.schedule.minInterval, 'sounds', sound.id, 'schedule.minInterval', issues);
      }
      if (sound.schedule.probabilityPerAttempt !== undefined) {
        validateRange(sound.schedule.probabilityPerAttempt, 'sounds', sound.id, 'schedule.probabilityPerAttempt', issues, 0, 1);
      }
      if (sound.schedule.windowProbability !== undefined) {
        validateRange(sound.schedule.windowProbability, 'sounds', sound.id, 'schedule.windowProbability', issues, 0, 1);
      }
    }

    if (sound.limits) {
      if (sound.limits.minInterval !== undefined) {
        validateDurationPair(sound.limits.minInterval, 'sounds', sound.id, 'limits.minInterval', issues);
      }
      if (sound.limits.cooldown !== undefined) {
        validateDurationPair(sound.limits.cooldown, 'sounds', sound.id, 'limits.cooldown', issues);
      }
    }

    validateConditionNode(sound.conditions, 'sounds', sound.id, 'conditions', issues);
  }

  // 5. Validate materials
  for (const mat of resolvedMaterials) {
    if (mat.footsteps) {
      for (const [gait, ref] of Object.entries(mat.footsteps)) {
        const sId = typeof ref === 'string' ? ref : ref?.sound;
        if (sId && !soundMap.has(sId)) {
          issues.push({
            file: 'materials',
            definition: mat.id,
            property: `footsteps.${gait}`,
            message: `Unknown sound "${sId}"`,
            severity: 'error',
          });
        }
      }
    }
    const actionKeys = ['impact', 'hollowImpact', 'break', 'scrape', 'creak', 'slide', 'splash', 'fall', 'fallHeavy', 'doorOpen', 'doorClose'] as const;
    for (const k of actionKeys) {
      const ref = mat[k];
      if (ref && !soundMap.has(ref.sound)) {
        issues.push({
          file: 'materials',
          definition: mat.id,
          property: `${k}.sound`,
          message: `Unknown sound "${ref.sound}"`,
          severity: 'error',
        });
      }
    }
    if (mat.additionalReactions) {
      mat.additionalReactions.forEach((r, idx) => {
        if (!soundMap.has(r.sound)) {
          issues.push({
            file: 'materials',
            definition: mat.id,
            property: `additionalReactions[${idx}].sound`,
            message: `Unknown sound "${r.sound}"`,
            severity: 'error',
          });
        }
        if (r.probability !== undefined && (r.probability < 0 || r.probability > 1)) {
          issues.push({
            file: 'materials',
            definition: mat.id,
            property: `additionalReactions[${idx}].probability`,
            message: `Probability ${r.probability} must be between 0 and 1`,
            severity: 'error',
          });
        }
      });
    }
  }

  // 6. Validate acoustics
  for (const ac of resolvedAcoustics) {
    if (ac.enclosure < 0 || ac.enclosure > 1) {
      issues.push({ file: 'acoustics', definition: ac.id, property: 'enclosure', message: 'Enclosure must be between 0 and 1', severity: 'error' });
    }
    if (ac.roofCoverage < 0 || ac.roofCoverage > 1) {
      issues.push({ file: 'acoustics', definition: ac.id, property: 'roofCoverage', message: 'roofCoverage must be between 0 and 1', severity: 'error' });
    }
    if (ac.roomToneSound && !soundMap.has(ac.roomToneSound)) {
      issues.push({ file: 'acoustics', definition: ac.id, property: 'roomToneSound', message: `Unknown sound "${ac.roomToneSound}"`, severity: 'error' });
    }
  }

  // 7. Validate biomes
  for (const biome of resolvedBiomes) {
    biome.layers.forEach((layer, idx) => {
      if (!soundMap.has(layer.sound)) {
        issues.push({
          file: 'biomes',
          definition: biome.id,
          property: `layers[${idx}].sound`,
          message: `Unknown sound "${layer.sound}"`,
          severity: 'error',
        });
      }
    });
  }

  // 8. Validate disturbances
  const disturbanceIds = new Set<string>();
  for (const dist of config.disturbances) {
    if (disturbanceIds.has(dist.id)) {
      issues.push({ file: 'disturbances', definition: dist.id, property: 'id', message: `Duplicate disturbance ID "${dist.id}"`, severity: 'error' });
    }
    disturbanceIds.add(dist.id);
    validateDistancePair(dist.spatial.radiusM, 'disturbances', dist.id, 'spatial.radiusM', issues);
    if (dist.activationDelayMs !== undefined) {
      validateDurationPair(dist.activationDelayMs, 'disturbances', dist.id, 'activationDelayMs', issues);
    }
    dist.effects.forEach((eff, idx) => {
      validateDurationPair(eff.fadeOutMs, 'disturbances', dist.id, `effects[${idx}].fadeOutMs`, issues);
      validateDurationPair(eff.recoveryDelayMs, 'disturbances', dist.id, `effects[${idx}].recoveryDelayMs`, issues);
      validateDurationPair(eff.recoveryFadeMs, 'disturbances', dist.id, `effects[${idx}].recoveryFadeMs`, issues);
      if (!eff.target.startsWith('tag:') && !busMap.has(eff.target) && !soundMap.has(eff.target)) {
        issues.push({
          file: 'disturbances',
          definition: dist.id,
          property: `effects[${idx}].target`,
          message: `Unknown disturbance target "${eff.target}"`,
          severity: 'error',
        });
      }
    });
    if (dist.exceptions?.buses) {
      for (const b of dist.exceptions.buses) {
        if (!busMap.has(b)) {
          issues.push({ file: 'disturbances', definition: dist.id, property: 'exceptions.buses', message: `Unknown exception bus "${b}"`, severity: 'error' });
        }
      }
    }
    if (dist.exceptions?.sounds) {
      for (const s of dist.exceptions.sounds) {
        if (!soundMap.has(s)) {
          issues.push({ file: 'disturbances', definition: dist.id, property: 'exceptions.sounds', message: `Unknown exception sound "${s}"`, severity: 'error' });
        }
      }
    }
  }

  // 9. Validate reactions
  const reactionIds = new Set<string>();
  for (const rx of config.reactions) {
    if (reactionIds.has(rx.id)) {
      issues.push({ file: 'reactions', definition: rx.id, property: 'id', message: `Duplicate reaction ID "${rx.id}"`, severity: 'error' });
    }
    reactionIds.add(rx.id);
    if (!rx.event || typeof rx.event !== 'string') {
      issues.push({ file: 'reactions', definition: rx.id, property: 'event', message: 'Reaction requires an event name', severity: 'error' });
    }
    if (rx.probability !== undefined && (rx.probability < 0 || rx.probability > 1 || !Number.isFinite(rx.probability))) {
      issues.push({ file: 'reactions', definition: rx.id, property: 'probability', message: `Invalid probability ${rx.probability}`, severity: 'error' });
    }
    if (rx.delayMs !== undefined) {
      validateDurationPair(rx.delayMs, 'reactions', rx.id, 'delayMs', issues);
    }
    if (rx.cooldownMs !== undefined) {
      validateDurationPair(rx.cooldownMs, 'reactions', rx.id, 'cooldownMs', issues);
    }
    if (rx.playSound && !soundMap.has(rx.playSound)) {
      issues.push({ file: 'reactions', definition: rx.id, property: 'playSound', message: `Unknown sound "${rx.playSound}"`, severity: 'error' });
    }
    if (rx.activateDisturbance && !disturbanceIds.has(rx.activateDisturbance)) {
      issues.push({ file: 'reactions', definition: rx.id, property: 'activateDisturbance', message: `Unknown disturbance "${rx.activateDisturbance}"`, severity: 'error' });
    }
    validateConditionNode(rx.scheduleConditions, 'reactions', rx.id, 'scheduleConditions', issues);
    validateConditionNode(rx.executeConditions, 'reactions', rx.id, 'executeConditions', issues);
  }

  // 10. Validate music
  const musicIds = new Set<string>();
  for (const m of config.music) {
    if (musicIds.has(m.id)) {
      issues.push({ file: 'music', definition: m.id, property: 'id', message: `Duplicate music profile ID "${m.id}"`, severity: 'error' });
    }
    musicIds.add(m.id);
    if (!busMap.has(m.bus)) {
      issues.push({ file: 'music', definition: m.id, property: 'bus', message: `Unknown bus "${m.bus}"`, severity: 'error' });
    }
    m.assets.forEach((aRef, idx) => {
      if (!assetMap.has(aRef.assetId)) {
        issues.push({ file: 'music', definition: m.id, property: `assets[${idx}].assetId`, message: `Unknown asset "${aRef.assetId}"`, severity: 'error' });
      }
    });
    validateConditionNode(m.conditions, 'music', m.id, 'conditions', issues);
  }

  const resolved: SoundscapeConfig = {
    version: config.version,
    engine: structuredClone(config.engine),
    buses: structuredClone(config.buses),
    assets: structuredClone(config.assets),
    materials: resolvedMaterials,
    acoustics: resolvedAcoustics,
    biomes: resolvedBiomes,
    sounds: resolvedSounds,
    reactions: structuredClone(config.reactions),
    disturbances: structuredClone(config.disturbances),
    music: structuredClone(config.music),
  };

  return {
    raw: config,
    resolved,
    busMap,
    assetMap,
    soundMap,
    materialMap,
    acousticMap,
    biomeMap,
    issues,
  };
}

export function hasValidationErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

export function parseAndValidateConfigJson(
  jsonText: string
): { ok: true; normalized: NormalizedSoundscapeConfig } | { ok: false; issues: ValidationIssue[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          file: 'hot_reload.json',
          definition: 'root',
          property: 'syntax',
          message: err instanceof Error ? err.message : 'Invalid JSON syntax',
          severity: 'error',
        },
      ],
    };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      issues: [
        {
          file: 'hot_reload.json',
          definition: 'root',
          property: 'type',
          message: 'Root JSON must be a SoundscapeConfig object',
          severity: 'error',
        },
      ],
    };
  }
  const requiredArrays = ['buses', 'assets', 'materials', 'acoustics', 'biomes', 'sounds', 'reactions', 'disturbances', 'music'];
  for (const key of requiredArrays) {
    if (!Array.isArray(parsed[key])) {
      return {
        ok: false,
        issues: [
          {
            file: 'hot_reload.json',
            definition: 'root',
            property: key,
            message: `Missing or non-array required config section "${key}"`,
            severity: 'error',
          },
        ],
      };
    }
  }
  if (!isPlainObject(parsed.engine)) {
    return {
      ok: false,
      issues: [
        {
          file: 'hot_reload.json',
          definition: 'root',
          property: 'engine',
          message: 'Missing required "engine" config section',
          severity: 'error',
        },
      ],
    };
  }
  const normalized = normalizeAndValidateConfig(parsed as unknown as SoundscapeConfig);
  if (hasValidationErrors(normalized.issues)) {
    return { ok: false, issues: normalized.issues };
  }
  return { ok: true, normalized };
}
