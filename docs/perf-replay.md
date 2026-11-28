# Production walking replay

Run `npm run perf:run` from the checkout. It builds the current working tree, serves it on loopback and opens a fresh visible Chrome profile. Set `CHROME_BIN` to select a Chromium executable. Complete the title and rucksack screens with the same loadout each time. Keep the game in the foreground and release the controls. The scene name and distance appear on screen during the walk.

| Fixed scene order | Starting hour | Weather | Wind |
| --- | ---: | --- | ---: |
| Village road | 14:00 | Clear | 0.20 |
| Forest and thicket | 10:00 | Rain | 0.65 |
| Bog shore, first pass | 07:00 | Mist | 0.35 |
| Bog shore, repeat pass | 07:00 | Rain | 0.35 |

Each leg spends five seconds at its starting point, then walks 100 metres in 25 seconds. Seed 7013, Ultra, a 1280 × 720 backbuffer and pixel ratio 1 are fixed. Each leg teleports once before warmup. During the walk, a controller steers toward a point three metres ahead of the scheduled route, with a bounded turning rate. Player physics moves the camera through the world and resolves collisions. Streaming, vertical motion, footfalls, weather and rendering run normally. The road follows the generated centerline. The runner checks every recorded player position against the expected route with a four-metre tolerance and rejects a backward step greater than 10 cm between rendered frames. Both bog legs share waypoints, heading, pitch, wind and starting hour. Each must execute a water reflection pass to count as a successful run. The rainy leg revisits the cache warmed by the mist leg. Compare the same leg across revisions for a matched cache history. A new browser profile starts each run, and all legs share the game’s caches in the order shown. Manual entry, OS scheduling, GPU clocks and random ambient activity can introduce variability. Repeat each revision on the same machine before attributing a small delta to a code change.

## Find the measurements

Each invocation writes a new local directory under `perf-runs/`. Its `manifest.json` records the revision, built asset filename fingerprint, working-tree status, route, actual browser/GPU, CPU, loadout and available scene/section names. Completed scenes survive an interrupted run. Each scene has one CSV and one compact summary JSON per section. Per-frame CSVs share a frame number, elapsed interval end and frame start in milliseconds. Build and GPU event timestamps are relative to the measured leg start. Chrome events also retain their original microsecond timestamps.

| Section | Measurements |
| --- | --- |
| `frame` | Start-to-start frame time, tick, time outside the tick, instantaneous and smoothed FPS |
| `terrain`, `terrain-builds`, `terrain-main`, `terrain-worker` | Update time, cache/LOD/counters, and accepted chunk build duration, coordinate/LOD key, vertices and execution thread |
| `foliage` | Vegetation update, culling, bakes, evictions, grass rebuilds, instance counts and primary-camera foliage draw calls, submitted triangles and CPU submission time |
| `renderer`, `gpu`, `reflection`, `shadows` | CPU submission, total draws and resources, asynchronous GPU times for the mirror and main view, their sum, reflection decisions and shadow updates. `reflection-passes` and `reflection-gpu` contain only executed mirror passes |
| `shaders`, `shader-events` | Live program count and growth, individual WebGL compile/link call wall times |
| `player`, `props`, `world`, `minimap` | Player step and vitals, prop interaction/physics, actual position, heading, biome, chunk and minimap cost |
| `quality`, `weather` | Render scale, visibility distance, resolution changes, sky update, weather, wind and overlays |
| `audio`, `audio-voices` | Audio update and save time, context state, voice/asset counts and spatial playback stats. Full approximately 1 Hz soundscape diagnostics, including music and buses, are in `audio-diagnostics.jsonl`. |
| `memory`, `gc`, `v8`, `browser` | JS heap and timestamped V8, GC and browser timeline events for the game renderer process, including thread IDs, durations where reported and event arguments |
| `events`, `fps-reports` | Runtime event labels and the original low-FPS, extreme-FPS and recovery reports |
| `runtime` | Remaining live diagnostic fields, including newly added fields without an explicit section |

Use `terrainDelta.*` and `foliageDelta.*` for per-tick streaming activity. The existing FPS logger also exposes window counters that reset on its own schedule. GPU queries are asynchronous. Unsupported timers, disjoint results and pending final queries leave missing samples. Foliage submission and WebGL compile/link durations measure CPU-side calls. GPU driver work can complete later. Chrome trace events can nest across threads, so summing every GC event can double-count a pause. Capture instrumentation adds overhead and should be kept consistent across runs.

## Compare one part

Pass two run directories, then an optional section and scene. The default section is `frame` across all scenes. Positive deltas mean the candidate value increased. The command reads two manifests and only the selected summary files. Detailed per-frame CSVs can be opened independently.

```sh
npm run --silent perf:compare -- perf-runs/BASE perf-runs/CANDIDATE frame
npm run --silent perf:compare -- perf-runs/BASE perf-runs/CANDIDATE terrain-worker village-road-clear
npm run --silent perf:compare -- perf-runs/BASE perf-runs/CANDIDATE foliage forest-rain | rg 'metric|foliageSubmitMs.p95'
npm run --silent perf:compare -- perf-runs/BASE perf-runs/CANDIDATE reflection-gpu bog-shore-rain
head -n 5 perf-runs/CANDIDATE/bog-shore-rain/reflection-passes.csv
```

Comparisons require complete runs with matching routes, settings, browser, hardware and loadout. A different game revision is expected. Inspect the manifest’s working-tree status when measuring uncommitted changes. To move a baseline between checkouts, copy its run directory. To retain only comparisons, keep the manifest and the section summaries of interest.
