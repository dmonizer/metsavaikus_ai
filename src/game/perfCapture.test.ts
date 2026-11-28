import assert from 'node:assert/strict';
import test from 'node:test';
import { PERF_CAPTURE_SECONDS, PerfCapture, type PerfCaptureContext, type PerfCaptureTimings } from './perfCapture';

const context: PerfCaptureContext = {
  backbufferPx: [1920, 1080],
  pixelRatio: 0.75,
  quality: 'ultra',
  position: [0, 0, 0],
  yawDeg: 0,
  pitchDeg: 0,
  weather: 'clear',
  hour: 18,
  reflectionsEnabled: true,
  waterVisible: true,
  sunShadow: false,
  audioContext: 'running',
  calls: 100,
  triangles: 100_000,
  trees: 200,
  grass: 5000,
};
const timings: PerfCaptureTimings = {
  tick: 12,
  mainRender: 6,
  reflection: 4,
  terrain: 1,
  vegetation: 0,
  soundscape: 1,
  soundscapeSave: 0,
};

function report(capture: PerfCapture) {
  const text = capture.dumpText();
  assert.match(text, /^\[METSAVAIKUS_PERF:CAPTURE\] /);
  return JSON.parse(text.slice(text.indexOf(' ') + 1));
}

test('capture attributes a frame interval and reflection work to the preceding tick', () => {
  const capture = new PerfCapture(123, 'test GPU');
  capture.start();
  capture.record(100, timings, true, context);
  capture.record(120, { ...timings, reflection: 0, vegetation: 39, tick: 47 }, false, context);
  capture.record(210, timings, false, context);
  capture.stop();

  const result = report(capture);
  assert.equal(result.frames, 2);
  assert.equal(result.framesOver50Ms, 1);
  assert.equal(result.reflectionFrames, 1);
  assert.deepEqual(result.timingsMs.frame, { p50: 20, p95: 90, p99: 90, max: 90 });
  assert.equal(result.slowestFrames[0].timingsMs.vegetation, 39);
  assert.equal(result.slowestFrames[0].timingsMs.outsideTick, 43);
  assert.equal(result.slowestFrames[0].reflected, false);
});

test('debug and background gaps are excluded and a new capture clears the old report', () => {
  const capture = new PerfCapture(123, 'test GPU');
  capture.start();
  capture.record(100, timings, true, context);
  capture.record(120, timings, true, context);
  capture.breakInterval();
  capture.record(10_000, timings, false, context);
  capture.record(10_020, timings, false, context);
  capture.stop();
  assert.deepEqual(capture.getStatus(), { recording: false, seconds: 0.04, frames: 2 });
  assert.equal(report(capture).timingsMs.frame.max, 20);

  capture.start();
  assert.equal(capture.dumpText(), '');
  assert.deepEqual(capture.getStatus(), { recording: true, seconds: 0, frames: 0 });
});

test('capture stops after the duration limit and keeps the frame that crossed it', () => {
  const capture = new PerfCapture(123, 'test GPU');
  capture.start();
  for (let i = 0; i <= PERF_CAPTURE_SECONDS * 10 + 1; i++) {
    capture.record(i * 100, timings, false, context);
  }
  assert.deepEqual(capture.getStatus(), {
    recording: false, seconds: PERF_CAPTURE_SECONDS, frames: PERF_CAPTURE_SECONDS * 10,
  });
});

test('replay diagnostics belong to the tick being timed and draining releases the recording', () => {
  const capture = new PerfCapture(123, 'test GPU');
  capture.start();
  capture.record(10, timings, true, context);
  capture.attachDiagnostics({ terrainBuilds: 3 });
  capture.record(25, timings, false, context);
  capture.attachDiagnostics({ terrainBuilds: 8 });
  const frames = capture.takeFrames();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].timingsMs.frame, 15);
  assert.deepEqual(frames[0].diagnostics, { terrainBuilds: 3 });
  assert.equal(capture.getStatus().frames, 0);
  assert.deepEqual(capture.takeFrames(), []);
});
