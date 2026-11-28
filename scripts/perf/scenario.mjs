// Seed 7013. Road vertices follow the game's main-road centerline.
// Distances and camera heading are functions of elapsed time, independent of FPS.
const bogShore = { wind: 0.35, hour: 7, pitch: -0.08, requireReflection: true,
  path: [[100,130],[138,130],[163,137],[190,140],[218,129]] };

export const scenario = {
  version: 3, seed: 7013, quality: 'ultra', qualityMode: 4, width: 1280, height: 720,
  pixelRatio: 1, warmupMs: 5000, durationMs: 25000, metersPerSecond: 4,
  scenes: [
    { id: 'village-road-clear', weather: 'clear', wind: 0.2, hour: 14, pitch: -0.06,
      path: [[-78.699,-109.415],[-99.135,-82.658],[-118.398,-58.744],[-138.969,-40.154],[-160.376,-29.427]] },
    { id: 'forest-rain', weather: 'rain', wind: 0.65, hour: 10, pitch: 0,
      path: [[-310,-445],[-280,-437],[-247,-423],[-206,-407]] },
    { ...bogShore, id: 'bog-shore-mist', weather: 'mist' },
    { ...bogShore, id: 'bog-shore-rain', weather: 'rain' },
  ],
};

export function poseAt(path, distance) {
  for (let i = 1; i < path.length; i++) {
    const [x, z] = path[i - 1];
    const dx = path[i][0] - x, dz = path[i][1] - z;
    const length = Math.hypot(dx, dz);
    if (distance <= length || i === path.length - 1) {
      const t = Math.min(1, distance / length);
      return { x: x + dx*t, z: z + dz*t, yaw: Math.atan2(-dx, -dz) };
    }
    distance -= length;
  }
  throw new Error('Expected two or more waypoints');
}

// Supply forward-walking input once per physics step. Only the player's locomotion
// and collision solver write its position during a leg.
export function createWalkingInput(path, metersPerSecond, poseAt) {
  let distance = 0;
  const lookAheadM = 3;
  return (dt, x, z, yaw) => {
    distance += metersPerSecond * dt;
    const target = poseAt(path, distance + lookAheadM);
    const dx = target.x - x, dz = target.z - z;
    const targetYaw = Math.atan2(-dx, -dz);
    const angle = Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw));
    const maxTurn = 1.2 * dt;
    const lagM = Math.hypot(dx, dz) - lookAheadM;
    return {
      yaw: yaw + Math.max(-maxTurn, Math.min(maxTurn, angle)),
      speedMps: Math.max(0, Math.min(metersPerSecond * 1.4, metersPerSecond + lagM)),
    };
  };
}

// Executed in the production game tab. Keep each leg within the recorder's 30 s window.
export async function playScene(config, scene, poseAt, createWalkingInput) {
  const api = window.__metsavaikusDebug;
  const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
  const label = document.createElement('output');
  label.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:9999;background:#121b16;color:white;padding:4px 8px;font:14px monospace;pointer-events:none';
  document.body.append(label);
  label.textContent = scene.id + ' · warming up';
  const start = poseAt(scene.path, 0);
  api.movePlayerForTest(start.x, start.z);
  api.setReplayView(start.yaw, scene.pitch);
  api.setWeatherForTest(scene.weather);
  api.setWindForTest(scene.wind);
  api.setHourForTest(scene.hour);
  await new Promise(resolve => setTimeout(resolve, config.warmupMs));
  const canvas = document.querySelector('canvas[data-ready=true]');
  if (canvas.dataset.worldSeed !== String(config.seed) || canvas.dataset.qualityTier !== config.quality ||
      canvas.width !== config.width || canvas.height !== config.height) throw Error('Unexpected render settings: ' + JSON.stringify({ seed: canvas.dataset.worldSeed, quality: canvas.dataset.qualityTier, width: canvas.width, height: canvas.height }));
  const audio = [];
  let audioAt = 0;
  await raf();
  api.startReplayCapture(createWalkingInput(scene.path, config.metersPerSecond, poseAt));
  const began = performance.now();
  performance.mark('mets-replay-start');
  let result;
  try {
    for (;;) {
      await raf();
      const elapsedMs = performance.now() - began;
      if (document.hidden || canvas.dataset.weather !== scene.weather) throw Error('Replay interrupted or weather changed');
      if (elapsedMs >= config.durationMs) break;
      if (elapsedMs >= audioAt) {
        label.textContent = scene.id + ' · ' + Math.floor(elapsedMs * config.metersPerSecond / 1000) + ' m';
        audioAt = elapsedMs + 1000;
        audio.push({ elapsedMs, spatial: api.getSpatialAudioStats(), soundscape: api.getSoundscapeDiagnostics() });
      }
    }
  } finally {
    performance.mark('mets-replay-end');
    result = api.finishReplayCapture();
    label.remove();
  }
  const frames = result.frames;
  if (!frames.length || frames.at(-1).elapsedMs < config.durationMs * 0.95 ||
      !frames.every(f => f.diagnostics && f.context.weather === scene.weather && f.context.quality === config.quality &&
        f.context.pixelRatio === config.pixelRatio && f.context.backbufferPx[0] === config.width &&
        f.context.backbufferPx[1] === config.height)) throw Error('Incomplete or inconsistent gameplay capture');
  return { ...result, audio, runtime: { ...canvas.dataset } };
}

// Check the actual simulated player position for every recorded frame, including the endpoints.
export function verifyTrack(frames, scene, config) {
  if (scene.requireReflection && !frames.some(frame => frame.reflected)) {
    throw Error('No water reflection pass rendered in ' + scene.id);
  }
  let maxDriftM = 0;
  let maxBackwardStepM = 0;
  let previous;
  for (const frame of frames) {
    const distance = Math.min(config.durationMs, frame.diagnostics.frameStartMs) * config.metersPerSecond / 1000;
    const expected = poseAt(scene.path, distance);
    const [x,,z] = frame.context.position;
    maxDriftM = Math.max(maxDriftM, Math.hypot(x-expected.x, z-expected.z));
    if (previous) {
      const [px,,pz] = previous.position;
      const yaw = previous.yawDeg * Math.PI / 180;
      maxBackwardStepM = Math.max(maxBackwardStepM, (x-px)*Math.sin(yaw) + (z-pz)*Math.cos(yaw));
    }
    previous = frame.context;
  }
  const start = scene.path[0];
  const end = poseAt(scene.path, config.durationMs * config.metersPerSecond / 1000);
  const first = frames[0]?.context.position, last = frames.at(-1)?.context.position;
  if (!first || !last || !Number.isFinite(maxDriftM) || maxDriftM > 4 ||
      Math.hypot(first[0]-start[0], first[2]-start[1]) > 4 || Math.hypot(last[0]-end.x,last[2]-end.z) > 4) {
    throw Error('Player departed the recorded route in ' + scene.id + ' (maximum drift ' + maxDriftM.toFixed(2) + ' m)');
  }
  if (!Number.isFinite(maxBackwardStepM) || maxBackwardStepM > 0.1) {
    throw Error('Player reversed ' + maxBackwardStepM.toFixed(2) + ' m between frames in ' + scene.id);
  }
  return { first, last, maxDriftM, maxBackwardStepM };
}
