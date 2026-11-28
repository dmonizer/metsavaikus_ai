import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distToRoadDetail, getBiomeInfo, setActiveWorldSeed } from '../../src/world/terrainMath.ts';
import { scenario, poseAt, createWalkingInput, verifyTrack } from './scenario.mjs';
import { compareRuns, json, saveScene } from './results.mjs';

test('every metre of the road replay follows the seeded road, and each track covers the promised distance', () => {
  setActiveWorldSeed(scenario.seed);
  const distance = scenario.durationMs * scenario.metersPerSecond / 1000;
  for (const scene of scenario.scenes) {
    const { path } = scene;
    const length = path.slice(1).reduce((sum, [x,z], i) => sum + Math.hypot(x-path[i][0],z-path[i][1]),0);
    assert.ok(length >= distance);
    for (let s=0; s<=distance; s++) {
      const { x, z } = poseAt(path,s);
      if (scene.id === 'village-road-clear') assert.ok(distToRoadDetail(x,z).dist < .001);
      if (scene.id === 'bog-shore-mist') assert.equal(getBiomeInfo(x,z).id,'swamp');
    }
  }
});

test('comparison reads only the chosen summaries and refuses incomplete or incompatible runs', async t => {
  const dirs = await Promise.all([1,2].map(() => mkdtemp(join(tmpdir(),'mets-replay-test-'))));
  t.after(() => Promise.all(dirs.map(d => rm(d,{ recursive:true, force:true }))));
  const trace = [{ name:'mets-replay-start',ts:1000,pid:1,tid:2,cat:'blink.user_timing' },
    { name:'MinorGC',ts:1150,dur:100,pid:1,tid:2,cat:'v8' },
    { name:'mets-replay-end',ts:2000,pid:1,tid:2,cat:'blink.user_timing' }];
  const manifest = { status:'complete', protocol:{ seed:7013 }, scenes:{} };
  for (const [i,dir] of dirs.entries()) {
    const loc = join(dir,'road');
    manifest.scenes.road = await saveScene(loc, { audio:[], gpu:[], events:[], reports:[], builds:[], shaderEvents:[], runtime:{},
      frames:[{ elapsedMs:10, diagnostics:{ terrainDelta:{ geoBuilds:3 }, futureCounter:4, frameStartMs:0 },
        timingsMs:{ terrain:2+i,frame:10 }, context:{ weather:'clear' }, reflected:false }] }, trace);
    assert.match(await readFile(join(loc,'gc.csv'),'utf8'),/MinorGC/);
    assert.match(await readFile(join(loc,'runtime.csv'),'utf8'),/futureCounter/);
    await writeFile(join(dir,'manifest.json'),json(manifest));
    for (const file of await readdir(loc)) if (file !== 'terrain.summary.json') await rm(join(loc,file));
  }
  const result = await compareRuns(...dirs,'terrain','road');
  assert.equal(result.find(r => r.metric==='terrainTimeMs.p95').delta,1);
  await writeFile(join(dirs[1],'manifest.json'),json({ ...manifest,status:'failed' }));
  await assert.rejects(compareRuns(...dirs),/complete/);
  await writeFile(join(dirs[1],'manifest.json'),json({ ...manifest,protocol:{ seed:2026 } }));
  await assert.rejects(compareRuns(...dirs),/differs/);
});

test('a stationary camera fails the production route check', () => {
  const scene = scenario.scenes[0], start = scene.path[0];
  const frames = [0, 25000].map(frameStartMs => ({
    diagnostics:{ frameStartMs }, context:{ position:[start[0], 0, start[1]], yawDeg:poseAt(scene.path,0).yaw*180/Math.PI },
  }));
  assert.throws(() => verifyTrack(frames, scene, scenario), /departed/);
  const end = poseAt(scene.path,100);
  frames[1].context.position = [end.x,0,end.z];
  assert.equal(verifyTrack(frames,scene,scenario).maxDriftM,0);
});

test('both bog legs use identical track and lighting, and must render the mirror', () => {
  const [mist, rain] = scenario.scenes.filter(s => s.id.startsWith('bog-shore'));
  assert.equal(rain.weather, 'rain');
  assert.equal(mist.weather, 'mist');
  for (const key of ['path', 'hour', 'pitch', 'wind']) assert.deepEqual(mist[key],rain[key]);
  for (const scene of [mist, rain]) assert.throws(() => verifyTrack([],scene,scenario),/reflection/);
});

test('walking input handles irregular frame pacing and limits heading change at each bend', () => {
  for (const scene of scenario.scenes) {
    const steer = createWalkingInput(scene.path, scenario.metersPerSecond, poseAt);
    let { x, z, yaw } = poseAt(scene.path,0);
    const frames = [];
    let time = 0, frame = 0;
    while (time < 25) {
      const dt = Math.min([.016, .033, .14, .02][frame++ % 4], 25-time);
      for (let i=0, n=Math.ceil(dt*60); i<n; i++) {
        const step = dt/n, next = steer(step,x,z,yaw);
        assert.ok(Math.abs(next.yaw-yaw) <= 1.2*step+1e-12);
        yaw = next.yaw;
        x -= next.speedMps*step*Math.sin(yaw);
        z -= next.speedMps*step*Math.cos(yaw);
      }
      time += dt;
      frames.push({ diagnostics:{ frameStartMs:time*1000 }, reflected:true,
        context:{ position:[x,0,z], yawDeg:yaw*180/Math.PI } });
    }
    const result = verifyTrack(frames,scene,scenario);
    assert.ok(result.maxDriftM < 0.7);
    assert.equal(result.maxBackwardStepM,0);
  }
});
