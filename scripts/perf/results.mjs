import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const json = value => JSON.stringify(value, null, 2) + '\n';
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

const groups = {
  frame: 'rawDtMs fpsEma fpsInstant tickCpuMs externalWaitMs',
  terrain: 'terrainMs visibleChunks lodCounts terrainCacheSize terrainBuilds terrainWorkerBuilds terrainEvictions terrainRecenters terrainDelta',
  foliage: 'vegMs treesRendered foliageRendered grassCount foliageCacheSize foliageBakes foliageEvictions foliageVisRebuilds grassRebuilds colliderCells culledInstances candidateInstances foliageDelta foliageDrawCalls foliageDrawTriangles foliageSubmitMs',
  renderer: 'renderMs calls triangles points geometries textures',
  shaders: 'programs programsDelta',
  quality: 'pixelRatio backbufferPx fogCullDist drsMs antialias lowPowerGpu isSoftwareGl gpuRenderer',
  shadows: 'shadowUpdates sunCastShadow',
  memory: 'jsHeapMB',
  player: 'playerMs survival flashlightOn',
  props: 'propsMs',
  minimap: 'minimapMs',
  weather: 'skyMs weather wind timeOfDay overlays',
  world: 'pos chunk biome heading',
};
const groupFor = new Map(Object.entries(groups).flatMap(([group, keys]) => keys.split(' ').map(key => [key, group])));
const timingGroup = { tick: 'frame', frame: 'frame', outsideTick: 'frame', mainRender: 'renderer',
  reflection: 'reflection', terrain: 'terrain', vegetation: 'foliage', soundscape: 'audio', soundscapeSave: 'audio' };
const contextGroup = { backbufferPx: 'quality', pixelRatio: 'quality', quality: 'quality', position: 'world',
  yawDeg: 'world', pitchDeg: 'world', weather: 'weather', hour: 'weather', reflectionsEnabled: 'reflection',
  waterVisible: 'reflection', sunShadow: 'shadows', audioContext: 'audio', calls: 'renderer',
  triangles: 'renderer', trees: 'foliage', grass: 'foliage' };

function flatten(out, key, value) {
  if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) flatten(out, key + '.' + name, item);
  } else out[key] = value;
}

function splitFrames(frames) {
  const sections = {};
  frames.forEach(({ diagnostics, timingsMs, context, reflected, elapsedMs }, frame) => {
    const rows = {};
    function add(section, key, value) {
      const row = rows[section] ??= { frame, elapsedMs, frameStartMs: diagnostics.frameStartMs };
      flatten(row, key, value);
    }
    for (const [key, value] of Object.entries(diagnostics)) {
      if (key !== 'frameStartMs') add(groupFor.get(key) ?? 'runtime', key, value);
    }
    for (const [key, value] of Object.entries(timingsMs)) add(timingGroup[key] ?? 'runtime', key + 'TimeMs', value);
    for (const [key, value] of Object.entries(context)) add(contextGroup[key] ?? 'runtime', key, value);
    add('reflection', 'reflected', reflected);
    for (const [key, row] of Object.entries(rows)) (sections[key] ??= []).push(row);
  });
  return sections;
}

function csvCell(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

async function writeSection(dir, name, rows, expected = []) {
  const keys = new Set(expected);
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
  const columns = [...keys];
  const csv = [columns.join(','), ...rows.map(row => columns.map(key => csvCell(row[key])).join(','))];
  const metrics = {};
  for (const key of columns) {
    if (['frame', 'elapsedMs', 'frameStartMs', 'nowMs', 'pid', 'tid', 'ts'].includes(key)) continue;
    const numbers = rows.map(row => row[key]).filter(Number.isFinite).sort((a,b) => a-b);
    if (!numbers.length) continue;
    const quantile = p => numbers[Math.ceil(numbers.length*p)-1];
    metrics[key] = { n: numbers.length, mean: numbers.reduce((a,b) => a+b, 0)/numbers.length,
      p50: quantile(.5), p95: quantile(.95), p99: quantile(.99), max: numbers.at(-1) };
  }
  await writeFile(join(dir, name + '.csv'), csv.join('\n') + '\n');
  await writeFile(join(dir, name + '.summary.json'), json({ rows: rows.length, metrics }));
}

// Chrome timestamps are monotonic microseconds. User Timing marks share that clock.
function splitTrace(events) {
  const begin = events.find(e => e.name === 'mets-replay-start');
  const end = events.find(e => e.name === 'mets-replay-end');
  if (!begin || !end) throw Error('Chrome trace is missing a replay boundary');
  const groups = { gc: [], browser: [], v8: [] };
  for (const e of events) {
    if (e.pid !== begin.pid || e.ts < begin.ts || e.ts > end.ts || e.ph === 'M') continue;
    const group = /GC|GarbageCollect|Scavenge|MarkCompact/i.test(e.name) ? 'gc' : e.cat.includes('v8') ? 'v8' : 'browser';
    groups[group].push({ elapsedMs: (e.ts-begin.ts)/1000, durationMs: e.dur == null ? null : e.dur/1000,
      mainThread: e.tid === begin.tid, ...e });
  }
  return groups;
}

export async function saveScene(dir, data, trace) {
  await mkdir(dir);
  const sections = splitFrames(data.frames);
  const audio = data.audio.map(({ elapsedMs, soundscape, spatial }) => {
    const row = { elapsedMs, activeVoices: soundscape.activeCount, virtualVoices: soundscape.virtualCount,
      queuedVoices: soundscape.queuedCount, loadedAssets: soundscape.assetStatus.loaded,
      pendingAssets: soundscape.assetStatus.pending, failedAssets: soundscape.assetStatus.failed.length };
    flatten(row, 'spatial', spatial);
    return row;
  });
  await writeFile(join(dir, 'audio-diagnostics.jsonl'), data.audio.map(a => JSON.stringify(a)).join('\n') + '\n');
  await writeFile(join(dir, 'runtime.json'), json(data.runtime));
  Object.assign(sections, { events: data.events, 'fps-reports': data.reports, 'audio-voices': audio, 'terrain-builds': data.builds, gpu: data.gpu,
    'reflection-gpu': data.gpu.filter(row => row.reflected),
    'reflection-passes': sections.reflection.filter(row => row.reflected),
    'terrain-main': data.builds.filter(b => b.source === 'main'),
    'terrain-worker': data.builds.filter(b => b.source === 'worker'), 'shader-events': data.shaderEvents }, splitTrace(trace));
  const schemas = { events: ['elapsedMs','label'], 'fps-reports': ['tSec','severity','dominantCause'],
    'terrain-builds': ['elapsedMs','key','source','buildMs','vertices'], gpu: ['elapsedMs','renderGpuMs','mainGpuMs','reflectionGpuMs','reflected'],
    'reflection-gpu': ['elapsedMs','reflectionGpuMs'], 'reflection-passes': ['frame','elapsedMs','frameStartMs','reflectionTimeMs'],
    'shader-events': ['elapsedMs','operation','wallMs'], 'terrain-main': ['elapsedMs','key','source','buildMs','vertices'],
    'terrain-worker': ['elapsedMs','key','source','buildMs','vertices'], gc: ['elapsedMs','name','durationMs','mainThread'] };
  for (const [name, rows] of Object.entries(sections)) await writeSection(dir, name, rows, schemas[name]);
  return { reflectedFrames: sections['reflection-passes'].length, averageFps: data.frames.length * 1000 / data.frames.at(-1).elapsedMs, frames: data.frames.length, durationMs: data.frames.at(-1).elapsedMs,
    gpuTimerSupported: data.gpuTimerSupported, sections: Object.keys(sections).sort() };
}

export async function compareRuns(baselineDir, candidateDir, section = 'frame', scene) {
  const [base, candidate] = await Promise.all([baselineDir, candidateDir].map(d => readJson(join(d, 'manifest.json'))));
  if (base.status !== 'complete' || candidate.status !== 'complete') throw Error('Comparison requires two complete runs');
  if (!isDeepStrictEqual(base.protocol, candidate.protocol)) throw Error('Replay protocol, hardware, browser or loadout differs');
  const ids = scene ? [scene] : Object.keys(base.scenes);
  const result = [];
  for (const id of ids) {
    if (!Object.hasOwn(base.scenes, id) || !Object.hasOwn(candidate.scenes, id) ||
        ![base,candidate].every(m => m.scenes[id].sections.includes(section))) throw Error('Unknown scene or section');
    const [a,b] = await Promise.all([baselineDir, candidateDir].map(d => readJson(join(d,id,section+'.summary.json'))));
    result.push({ scene: id, metric: 'rows', baseline: a.rows, candidate: b.rows, delta: b.rows-a.rows });
    for (const [key, stats] of Object.entries(a.metrics)) {
      if (!b.metrics[key]) continue;
      for (const stat of ['mean','p50','p95','p99','max']) {
        const av = stats[stat], bv = b.metrics[key][stat];
        result.push({ scene: id, metric: key+'.'+stat, baseline: av, candidate: bv, delta: bv-av });
      }
    }
  }
  return result;
}
