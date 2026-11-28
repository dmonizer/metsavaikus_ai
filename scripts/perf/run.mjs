import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cpus, platform, arch } from 'node:os';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { build, preview } from 'vite';
import { openChrome } from '../chrome-session.mjs';
import { scenario, poseAt, playScene, createWalkingInput, verifyTrack } from './scenario.mjs';
import { compareRuns, json, saveScene } from './results.mjs';

async function run() {
  await build({ logLevel: 'warn' });
  const bundleHash = createHash('sha256').update((await readdir('dist/assets')).sort().join('\n')).digest('hex');
  const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
  let chrome;
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Run interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let manifest, directory;
  try {
    chrome = await openChrome(['--window-size=1400,900', '--enable-precise-memory-info']);
    // Closing Chrome also interrupts in-flight page evaluation.
    controller.signal.addEventListener('abort', () => { void chrome.close(); }, { once: true });
    const { send } = chrome;
    async function evaluate(expression) {
      const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    }
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('metsavaikus_resolution_scale','1')" });
    await send('Page.navigate', { url: 'http://127.0.0.1:'+server.httpServer.address().port+'/?seed='+scenario.seed+'&quality='+scenario.qualityMode+'&lang=en' });
    await send('Page.bringToFront');
    const readyDeadline = Date.now() + 180_000;
    while (!await evaluate("!!document.querySelector('canvas[data-ready=true]')")) {
      if (Date.now() >= readyDeadline) throw Error('World initialization exceeded three minutes');
      await sleep(500, undefined, { signal: controller.signal });
    }
    const settings = await evaluate(`(() => {
      const c = document.querySelector('canvas[data-ready=true]');
      return { seed: c.dataset.worldSeed, quality: c.dataset.qualityTier, width: c.width, height: c.height,
        viewport: [innerWidth, innerHeight], storedScale: localStorage.getItem('metsavaikus_resolution_scale') };
    })()`);
    console.log('World ready:', settings);
    if (settings.width !== scenario.width || settings.height !== scenario.height || settings.storedScale !== '1' ||
        settings.quality !== scenario.quality || settings.seed !== String(scenario.seed)) throw Error('Unexpected render settings: '+JSON.stringify(settings));
    console.log('Complete the title and rucksack screens. After entering, leave the game in the foreground.');
    while (!await evaluate("!!document.querySelector('canvas[data-ready=true]') && window.__metsavaikusDebug?.getState().phase === 'playing'")) {
      await sleep(500, undefined, { signal: controller.signal });
    }
    const env = await evaluate(`(() => {
      const canvas = document.querySelector('canvas[data-ready=true]');
      const gl = canvas.getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        wasm: canvas.dataset.wasmActive, inventory: window.__metsavaikusDebug.getState().inventory };
    })()`);
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    const { wasm, ...hardwareAndLoadout } = env;
    const protocol = { scenario, replayHash: createHash('sha256').update(String(poseAt)+String(createWalkingInput)+String(playScene)).digest('hex'),
      browser: (await send('Browser.getVersion')).product, cpu: cpus()[0].model, os: platform()+'-'+arch(), ...hardwareAndLoadout };
    await mkdir('perf-runs', { recursive: true });
    directory = await mkdtemp(join('perf-runs', new Date().toISOString().replaceAll(':','-')+'-'));
    manifest = { status: 'recording', bundleHash, wasm, revision: git('rev-parse','HEAD'), workspace: git('status','--short'), protocol, scenes: {} };
    const persist = () => writeFile(join(directory,'manifest.json'), json(manifest));
    await persist();
    for (const scene of scenario.scenes) {
      console.log(scene.id, '->', directory);
      const trace = [];
      const collect = ({ value }) => { for (const event of value) trace.push(event); };
      chrome.events.on('Tracing.dataCollected', collect);
      await send('Tracing.start', { categories: 'v8,devtools.timeline,blink.user_timing', transferMode: 'ReportEvents' });
      let data;
      try {
        data = await evaluate('('+playScene+')('+JSON.stringify(scenario)+','+JSON.stringify(scene)+','+poseAt+','+createWalkingInput+')');
      } finally {
        const ended = once(chrome.events, 'Tracing.tracingComplete', { signal: AbortSignal.timeout(30000) });
        // Observe both promises even if Chrome exits before the trace is returned.
        const [, [completion]] = await Promise.all([send('Tracing.end'), ended]);
        chrome.events.off('Tracing.dataCollected', collect);
        if (completion.dataLossOccurred) throw Error('Chrome trace buffer overflowed');
      }
      const result = await saveScene(join(directory, scene.id), data, trace);
      manifest.scenes[scene.id] = result;
      result.track = verifyTrack(data.frames, scene, scenario);
      await persist();
      const s = manifest.scenes[scene.id];
      console.log('  '+s.frames+' frames, '+(s.frames*1000/s.durationMs).toFixed(1)+' FPS');
    }
    manifest.status = 'complete';
    await persist();
    console.log('Saved', directory);
  } catch (error) {
    if (manifest) await writeFile(join(directory,'manifest.json'), json({ ...manifest, status: 'failed', error: String(error) }));
    throw error;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    try { await chrome?.close(); } finally { await server.close(); }
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'run' && !args.length) await run();
else if (command === 'compare' && args.length >= 2 && args.length <= 4) {
  const rows = await compareRuns(...args);
  console.log('scene,metric,baseline,candidate,delta');
  for (const row of rows) console.log(Object.values(row).map(x => typeof x === 'number' ? +x.toFixed(4) : x).join(','));
} else throw Error('Usage: npm run perf:run OR npm run perf:compare -- BASE_DIR CANDIDATE_DIR [SECTION [SCENE]]');
