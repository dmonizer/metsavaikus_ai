import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SOUNDSCAPE_CONFIG } from '../config/soundscape';
import { AcousticEnvironmentManager } from './acoustics';
import { MockAudioBackend, type StartVoiceParams } from './audioBackend';
import { SeededRng } from './clocks';
import { DisturbanceManager } from './disturbanceManager';
import { InstanceManager } from './instanceManager';
import { AudioMixer } from './mixer';
import type { SoundDefinition, WorldContext } from './types';

function makeVoice(loop: SoundDefinition['playback']['loop'], backend = new MockAudioBackend()) {
  const sound = structuredClone(DEFAULT_SOUNDSCAPE_CONFIG.sounds.find(s => s.id === 'breathing_rest')!);
  sound.playback = { ...sound.playback, loop, fadeInMs: 0, fadeOutMs: 0, onConditionLost: 'pause' };
  const asset = DEFAULT_SOUNDSCAPE_CONFIG.assets.find(a => a.id === sound.assets[0].assetId)!;
  const world = {
    listener: { position: { x: 0, y: 1.7, z: 0 } },
    structure: { id: null, quality: 'outdoor' },
  } as WorldContext;
  const manager = new InstanceManager(), mixer = new AudioMixer(DEFAULT_SOUNDSCAPE_CONFIG.buses);
  const assetsMap = new Map([[asset.id, asset]]), rng = new SeededRng(42);
  const instance = manager.spawnOrResume({
    sound, assetsMap, world, backend, mixer, rng, nowRealMs: 0, maxGlobalActiveVoices: 24,
  }).instance!;
  const acoustics = new AcousticEnvironmentManager(DEFAULT_SOUNDSCAPE_CONFIG.acoustics);
  const disturbances = new DisturbanceManager([]);
  let elapsed = 0;
  const step = (dt: number) => {
    elapsed += dt;
    manager.step({ dtRealSec: dt, nowRealMs: elapsed * 1000, nowSimMs: elapsed * 1000,
      world, backend, mixer, rng, assetsMap, acoustics, disturbances, maxGlobalActiveVoices: 24 });
  };
  return { manager, mixer, backend, instance, asset, step };
}

const policies: Array<{ loop: SoundDefinition['playback']['loop']; nativeLoop: boolean }> = [
  { loop: { count: 'infinite' }, nativeLoop: true },
  { loop: { count: 'infinite', pause: [0, 0] }, nativeLoop: true },
  { loop: { count: 'infinite', pause: ['0ms', '0s'] }, nativeLoop: true },
  { loop: { count: 3 }, nativeLoop: true },
  { loop: { count: 3, pause: [0, 0] }, nativeLoop: true },
  { loop: { count: 3, pause: ['10ms', '10ms'] }, nativeLoop: false },
  { loop: { count: 'infinite', pause: [0, '10ms'] }, nativeLoop: false },
  { loop: { count: 1 }, nativeLoop: false },
];

test('initial playback uses the same repeat policy as condition resume', async t => {
  for (const { loop, nativeLoop } of policies) {
    await t.test(JSON.stringify(loop), () => {
      const { manager, mixer, backend, instance } = makeVoice(loop);
      assert.equal(backend.records[0].loop, nativeLoop, 'initial backend source loop flag');
      manager.requestConditionStop(instance, backend, 0);
      manager.resumePaused(instance, backend, mixer);
      assert.equal(backend.records.at(-1)!.loop, nativeLoop, 'resumed backend source loop flag');
      manager.disposeAll(backend);
    });
  }
});

class BackendWithoutPause extends MockAudioBackend {
  override startVoice(params: StartVoiceParams) {
    const { setPaused: _setPaused, ...handle } = super.startVoice(params);
    return handle;
  }
}

test('manual resume recreates a source with the same repeat policy when the backend cannot pause', async t => {
  for (const { loop, nativeLoop } of policies) {
    await t.test(JSON.stringify(loop), () => {
      const { manager, mixer, backend, instance } = makeVoice(loop, new BackendWithoutPause());
      assert.equal(manager.pauseInstanceById(instance.instanceId, backend), true);
      assert.equal(instance.backendHandle, null);
      assert.equal(manager.resumeInstanceById(instance.instanceId, backend, mixer), true);
      assert.equal(backend.records.at(-1)!.loop, nativeLoop);
      manager.disposeAll(backend);
    });
  }
});

test('zero-pause repeats retain one looping source and finite repeats release it after the last clip', () => {
  for (const count of [3, 'infinite'] as const) {
    const { backend, manager, instance, asset, step } = makeVoice({ count, pause: [0, 0] });
    const duration = asset.durationSec!;
    for (let elapsed = 0; elapsed < duration * 3 + 0.2; elapsed += 0.05) step(0.05);
    assert.equal(backend.records.length, 1);
    assert.equal(backend.records[0].loop, true);
    assert.equal(instance.state === 'completed', count === 3);
    assert.equal(backend.records[0].stopped, count === 3);
    manager.disposeAll(backend);
  }
});

test('positive pauses restart a one-shot source after each gap, including gaps below 20ms', () => {
  const { backend, manager, instance, asset, step } = makeVoice({ count: 3, pause: ['10ms', '10ms'] });
  for (let elapsed = 0; elapsed < asset.durationSec! * 3 + 0.3; elapsed += 0.01) step(0.01);
  assert.equal(instance.state, 'completed');
  assert.equal(backend.records.length, 3);
  assert.ok(backend.records.every(record => !record.loop && record.stopped));
  manager.disposeAll(backend);
});
