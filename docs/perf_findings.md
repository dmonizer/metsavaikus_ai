# Frame performance findings

Four seed-2026 focused captures used Ultra at 3840 × 1939. Storm with reflections averaged 21.92 FPS (96 ms p95), and storm without reflections averaged 27.91 FPS (73 ms p95). Camera paths differed. The other reflections-on run was mist. Terrain and vegetation each took at most 1 ms at p95 in the storm runs, yet reached 43 and 65 ms respectively in the reflections-on run. Both steady rendering cost and intermittent streaming costs warrant investigation.

The 269 ms worst frame contained just 8 ms of timed tick work. The timer stops after main render submission. Later JS in the same callback, garbage collection, browser scheduling and GPU work can all contribute to the remaining interval. Counters sampled after the main render omit the mirror pass because Three.js resets them per render.

## Opportunities in priority order

| Area | Evidence and experiment | Fidelity checks |
| --- | --- | --- |
| Shelter shading | Eleven ground layers test every shelter per vertex. Rain does the same per fragment. Spatially reject empty areas before the exact rotated footprint test. Evaluate per-instance exclusion if the remaining GPU cost warrants it. | Pitch and pack tents, check porches, campfire margins, sloped roofs and outdoor rain. |
| Road-distance math | Terrain and placement repeatedly project onto all road segments (19 in seed 2026). A precomputed weighted squared-distance prototype took 14.3 ms versus 60.5 ms per 40,000 queries. Maximum error was 1.14e-13 m with zero trail flag differences. | Compare distances and trail selection including intersections and ties. |
| Grass allocation | Each uncached tile creates 2,060 sample objects, temporary matrices and colors, then shuffled final buffers. A Node run retaining 60 tiles reported 80 GC events (41.3 ms cumulative, 1.7 ms max). Reuse temporary storage and precompute seed-independent Halton terms. | Compare the complete baked matrix and color bytes including shuffle order. |
| Terrain and WASM | At 48 segments a shoreline chunk evaluates 2,401 center points and 9,604 offset height samples. WASM batches center noise only. A separate JS pass revisits road, island and village geography for splats. Share exact calculations and benchmark complete chunk jobs in a worker, including transfer time. | Preserve the normal stencil, JS fallback, seams, deterministic seed and active world on restart. |
| Reflection submission | Water uses a coarse sphere near the bog. Test the actual flat extent before a second scene submission. Both renders update scene matrices and the mirror explicitly clears an auto-cleared target. | Check tilted views and partial shore coverage. Preserve refresh rate and sampled texels including wave distortion. |
| Fragment shaders | Terrain color and roughness compute the same swash terms and fetch the same depth texture. Water derives frame-constant wave directions per fragment. Share intermediates and compare GPU timings to account for compiler optimization. | Compare shoreline sheen, foam, wet film and wave phase in fixed wind and light. |
| Instance uploads and caches | Repacking 30,000 grass instances submits 2.28 MB at 19 floats each. Existing upload ranges already cover only the active prefix. Compare unchanged ranges, terrain slot cache hits, nine height samples per slot at recenter, and the per-update vegetation membership string. | Preserve selection order, culling and LOD boundaries. Count upload bytes and draw calls together. |
| Shader compilation and shadows | Material warmup and stable light counts already exist. Trace first-use reflection-target, shadow and spawned-material variants on a cold and warm route. A dirty shadow update may execute during the reflection render. Global invalidation can refresh point lights far from the moving object. | Attribute shadow draws to their actual pass. Test a moving caster and doors near each light. |
| Water disc | High detail uses 28,800 coplanar triangles. Its shader receives an unused vertex depth. Remove the dead height bake first. A perimeter fan is a separate experiment requiring depth and picking checks. | Keep the depth texture, shoreline mapping, outer vertices and mirror projection. |
| Diagnostics and minimap | The frame loop writes canvas dataset attributes and shifts history. Fog updates recompose a 600 × 600 map. Check dirty rectangles and cadence. Soundscape persistence had a rounded p95 of zero in all four captures. | Preserve inspector and fog updates. Profile UI and audio separately around long frames. |

## Baseline CPU experiments

Node 22, seed 2026, six warmups then 30 calls. One detailed shoreline chunk took 27.2 ms median with WASM (51.7 ms p95), and 26.4 ms with the JS fallback (41.6 ms p95). These time fillTerrainChunk with preallocated output buffers. Uncached grass tile baking with empty shelters took 10.8 ms median (19.3 ms p95). These timings describe individual CPU operations. Hardware gameplay FPS requires a browser replay.

## Terrain streaming in the game

The corrected village-road harness on the earlier map measured a 132.56 ms worst frame on the main thread and 33.28 ms with the same builder in a worker. The Rust worker reduced p95 chunk latency from 29 ms to 22 ms. Both workers recorded 17.16 ms p95 frame intervals and delivered all 39 chunks on time. This comparison motivated moving the existing builder. The production implementation uses the terrain rules from revision `60962a4`, including freshwater shorelines and stream culverts. Production verification is recorded in the ledger.

## Acceptance

Use identical seed, camera path, weather, hour, quality and resolution. Compare a cold traversal for hitches and warm repeats for steady FPS. Collect p50/p95/p99 frame intervals, full-callback time, per-pass draw counts and asynchronous GPU timings when supported. Keep visual comparisons at fixed simulation time. Implementation results are in [the performance ledger](perf-ledger.md).

The [production walking replay](perf-replay.md) covers the main road, forest and bog shore with fixed walking routes and weather. The bog has paired mist and rain passes with separate mirror GPU timing. It writes complete runtime frame diagnostics and separate subsystem summaries so later changes can be measured against the same workload.
