import { DEFAULT_SOUNDSCAPE_CONFIG } from '../src/config/soundscape';
import { WebAudioHybridBackend } from '../src/soundscape/audioBackend';
import { AcousticEnvironmentManager } from '../src/soundscape/acoustics';
import { SeededRng } from '../src/soundscape/clocks';
import { DisturbanceManager } from '../src/soundscape/disturbanceManager';
import { InstanceManager } from '../src/soundscape/instanceManager';
import { AudioMixer } from '../src/soundscape/mixer';
import type { SoundDefinition, WorldContext } from '../src/soundscape/types';

function rms(data: Float32Array, start: number, end: number, rate: number): number {
  let sum = 0;
  const from = Math.floor(start * rate), to = Math.floor(end * rate);
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (to - from));
}

async function verifyLoop(
  soundId: string,
  loop: SoundDefinition['playback']['loop'],
  resume: 'none' | 'manual' | 'condition' = 'none'
): Promise<string> {
  const config = DEFAULT_SOUNDSCAPE_CONFIG;
  const original = config.sounds.find((sound) => sound.id === soundId)!;
  const sound = structuredClone(original);
  sound.playback = { ...sound.playback, loop, fadeInMs: 0, fadeOutMs: 0,
    ...(resume === 'condition' ? { onConditionLost: 'pause' as const } : {}) };
  const asset = config.assets.find((asset) => asset.id === sound.assets[0].assetId)!;
  const rate = 16000;
  const renderSec = asset.durationSec! * 3 + 1;
  const ctx = new OfflineAudioContext(1, Math.ceil(rate * renderSec), rate);
  const backend = new WebAudioHybridBackend();
  backend.attachAudioContext(ctx as unknown as AudioContext);
  backend.preloadAssets([{ ...asset, preload: true }]);
  while (backend.getAssetStatus().pending) await new Promise((resolve) => setTimeout(resolve, 5));
  if (backend.getAssetStatus().failed.length) throw new Error(`Cannot decode ${asset.file}`);

  // This playback test needs only the listener/structure fields consumed by the
  // instance manager; conditions and player-state selection are tested in Node.
  const position = { x: 0, y: 1.7, z: 0 };
  const world = { listener: { position }, structure: { id: null, quality: 'outdoor' } } as WorldContext;
  const instances = new InstanceManager();
  const mixer = new AudioMixer(config.buses);
  const acoustics = new AcousticEnvironmentManager(config.acoustics);
  const disturbances = new DisturbanceManager([]);
  const assetsMap = new Map([[asset.id, asset]]);
  const rng = new SeededRng(42);
  const spawned = instances.spawnOrResume({
    sound, assetsMap, world, backend, mixer, rng, nowRealMs: 0, maxGlobalActiveVoices: 24,
  });
  if (!spawned.instance?.backendHandle) throw new Error(`Cannot start ${soundId}`);
  const duration = spawned.instance.backendHandle.durationSec;
  const suspensions: Promise<void>[] = [];
  for (let time = 0.05; time < renderSec - 0.05; time += 0.05) suspensions.push(ctx.suspend(time));
  const rendering = ctx.startRendering();
  let playingOnSecondClip = false;
  let didResume = false;
  for (const suspended of suspensions) {
    await suspended;
    if (resume !== 'none' && !didResume && ctx.currentTime >= 0.8) {
      if (resume === 'manual') {
        instances.pauseInstanceById(spawned.instance.instanceId, backend);
        instances.resumeInstanceById(spawned.instance.instanceId, backend, mixer);
      } else {
        instances.requestConditionStop(spawned.instance, backend, ctx.currentTime * 1000);
        instances.resumePaused(spawned.instance, backend, mixer);
      }
      didResume = true;
    }
    instances.step({
      dtRealSec: 0.05, nowRealMs: ctx.currentTime * 1000, nowSimMs: ctx.currentTime * 1000,
      world, backend, mixer, acoustics, disturbances, assetsMap, rng, maxGlobalActiveVoices: 24,
    });
    if (ctx.currentTime > duration + 0.5 && ctx.currentTime < duration + 1) {
      playingOnSecondClip ||= spawned.instance.state === 'playing';
    }
    await ctx.resume();
  }
  const audio = (await rendering).getChannelData(0);
  const first = rms(audio, 0.2, 0.7, rate);
  const second = rms(audio, duration + 0.2, duration + 0.7, rate);
  const completed = spawned.instance.state === 'completed';
  instances.disposeAll(backend);
  backend.dispose();
  if (!playingOnSecondClip || first < 1e-7 || second < first * 0.1) {
    throw new Error(`${soundId} ${JSON.stringify(loop)}: playing=${playingOnSecondClip}, first RMS=${first}, second RMS=${second}`);
  }
  if (loop?.count === 3 && !completed) throw new Error(`${soundId}: finite loop did not release its slot`);
  if (resume !== 'none' && !didResume) throw new Error(`${soundId}: resume path was not exercised`);
  return `${soundId} ${JSON.stringify(loop)} (${resume} resume): first RMS=${first.toExponential(3)}, second RMS=${second.toExponential(3)}; finite completion=${completed}`;
}

const results = document.getElementById('results')!;
try {
  const checks = [
    await verifyLoop('breathing_rest', { count: 'infinite' }),
    await verifyLoop('breathing_rest', { count: 'infinite', pause: [0, 0] }),
    await verifyLoop('breathing_rest', { count: 'infinite', pause: ['0ms', '0s'] }),
    await verifyLoop('breathing_rest', { count: 'infinite', pause: [0, 0] }, 'manual'),
    await verifyLoop('breathing_rest', { count: 'infinite', pause: [0, 0] }, 'condition'),
    await verifyLoop('breathing_rest', { count: 3 }),
    await verifyLoop('water_wade_loop', { count: 3 }),
    await verifyLoop('breathing_rest', { count: 3, pause: ['10ms', '10ms'] }),
  ];
  results.textContent = checks.join('\n');
  results.dataset.status = 'passed';
} catch (error) {
  results.textContent = error instanceof Error ? error.stack! : String(error);
  results.dataset.status = 'failed';
}
