# Performance implementation ledger

Baseline revision is `6fa67d6`. All timings are local unless explicitly attributed to the supplied captures. See [the findings](perf_findings.md) for baseline performance and outstanding experiments. Each implementation commit carries its own ledger entry.

Before changes, the Chrome SwiftShader shelter fixture produced vegetation luminance sums of 103530 / 0 / 103530 before pitching, while pitched and after packing. Rain sums were 48750 / 0 / 48750 outside, covered and restored. The shadow fixture measured 1447901 with light leakage and 0 with the shadow enabled.

## 1. Spatial shelter queries

Rain and vegetation fetch a 16 m cell's candidate row interval before the exact containment loop. Empty cells require one lookup. Rain also rejects low-alpha fragments before testing cover. The 75 × 75 RG float grid costs 45,000 bytes per world. Out-of-grid queries use the full footprint list.

Chrome SwiftShader reproduced all eight baseline luminance sums exactly, including tent removal and restored rain. Two restart cycles returned geometry and texture counts to the warm baseline. Type check, production build, 198 existing tests and the added rotated-corner/reindex regression passed. Hardware GPU time remains unmeasured.

## 2. Road distance

The implementation rejects distant segment bounding boxes, then evaluates contenders with the original projection, trail weighting, distance and tie behavior. This also accommodates callers supplying their own blueprints. The squared-distance prototype in the findings was an earlier experiment.

Run `node --import tsx scripts/bench-world-streaming.mjs` for 30 measured seed-2026 iterations following six warmups. Local before/after medians in milliseconds were 33.51 → 16.21 per 40,000 road queries, 17.89 → 11.95 per detailed terrain fill, and 7.97 → 5.12 per grass bake. The road checksum matched exactly. The combined SHA-256 of sampled terrain positions, normals, colors and grass matrices/colors matched at `11720fd75810c83007b39170f0935f2c8d864657a574eca22b68b50e7e8600e3`. Type check, build and all 199 tests passed.

## 3. Grass tile allocation and sampling

Each synchronous baker layer reuses double-precision sample coordinates, random values, Halton terms, and temporary matrix/color arrays. Cached tiles own their final shuffled buffers. This removes 2,060 sample-object allocations and 156,560 bytes of temporary matrix/color allocation per bake after initialization. The geometry hash matched entry 2 exactly.

Isolated sample generation for 50 tiles (all four layers, 30 timed batches) fell from 19.64 to 11.21 ms median. Whole-tile results varied. Three paired 60-tile runs with an 8 MiB V8 semi-space reported 63–64 GC events before and 61–62 after, with overlapping total GC times. Default-heap experiments also varied with nursery sizing. A reduction in browser GC pauses remains unverified. Type check, production build and 199 tests passed.

## 4. Bound terrain height modifiers

Village clearings and swamp islands affect height only inside their individual radii. Axis checks eliminate distant features before evaluating their Euclidean distance. The original radial falloff still runs for every potential contributor, including overlapping clearings and islands. This benefits all terrain-height consumers, including the four normal taps outside the WASM noise kernel.

Streaming benchmark medians immediately before/after were 11.22 → 7.74 ms per detailed terrain fill and 5.34 → 4.03 ms per uncached grass tile. The combined output hash and road checksum matched entry 2. Type check, build and 199 tests passed.

## 5. Mirror pass visibility

Added a main-camera frustum test against the full horizontal water disc. The padded test includes the complete rendered perimeter. It runs even above the lake, where a spherical bound frequently intersects a sky-facing camera. A rejected view invalidates the cached mirror so re-entry refreshes it on software GL.

Extended the Chrome rendering fixture with fixed lake, sky and shoreline cameras. Before the change all three requested a mirror pass. Afterward the sky-facing view skipped the pass, and both the downward view and the partial-disc view still rendered a reflection. Luminance sums stayed at 5721701 for the downward image and 6946816 for the sky image. Shelter and shadow checks, type check, production build and 199 tests passed. This saves a scene render only on qualifying frames.

## 6. Terrain shoreline shading

The color and roughness paths share one depth sample and the computed swash and draining-film masks. Wet color and wet roughness retain their separate response thresholds. A repeatable Chrome fixture renders actual seeded terrain with a fixed depth gradient, oblique light, two wind strengths and two wave phases. Full 128 × 128 RGBA hashes from SwiftShader matched before and after at 51735210 and 4235587217 respectively. Shader compilation, rendering checks, type check, build and 199 tests passed. The driver-dependent speedup remains unmeasured.

## 7. Water disc initialization

Removed the per-vertex depth attribute and its terrain sampling. The fragment shader consumed only the smoothed depth texture. At high detail this removes 14,641 height evaluations and 58,564 bytes of attribute storage per world creation. The disc indices, positions, normals, depth map, and reflection sampling are preserved. This improves setup cost. It has no expected steady-state FPS benefit. Both water luminance sums and both terrain image hashes matched entry 6. Type check, build, rendering checks and 199 tests passed.

## Outstanding measurements

The target GPU was unavailable locally. The CPU harness and SwiftShader image fixtures establish output parity on the sampled inputs. Hardware frame-time percentiles, per-pass GPU time, upload bandwidth and shader first-use stalls still need a repeatable hardware capture. The production terrain worker is recorded below. Partial instance uploads, shader prewarming and narrower shadow invalidation remain open experiments.

## Boardwalk visibility correction

The long deck batch used an 18 m structure sphere at the bog center, while sleepers used native instance culling. A fixed camera on the southeast leg of seed 2026 reproduced the missing deck when facing SE. Both batches now use the trail's full bounds for fog distance and native per-camera instance culling. The Chrome rendering fixture checks deck pixels in both directions from the same spot.

## 8. Terrain chunk worker

The terrain manager prewarms the spawn area on one module worker, then predicts nearby requests across all viewing directions. Adjacent detail bands overlap by 24 m. Replanning replaces queued work as the camera or quality distances move. The worker uses the live seeded terrain builder, including freshwater shaping, shoreline stitching, four normal samples per vertex, colors, UVs and splats. Index buffers and the bounded geometry cache stay with the renderer. A visible cache miss builds the exact requested mesh immediately. Worker startup or runtime failure falls back to the same builder locally. Startup now pays for the surrounding warm cache before enabling entry.

Across two seeds, the before/after SHA-256 of 24 meshes (all five attributes, indices and bounding spheres) matched `cf66a75f5aa5ff2c4ce3faefd5751cb2bb9b7fe65b378febd8cd8b76ec008fa7`. Chrome independently compared 18 real worker responses with uncached game builds byte for byte, including stream and bog-pool geometry at all three LODs. The browser check also covered camera turns after prewarming, zero synchronous mesh builds across those views, and disposal with work in flight. Performance reports expose the worker subtotal as `tWorkerBuild` within `tBuild`.

A production-game walk on seed 7013 used Chrome on a GTX 1650 Max-Q, fixed quality tier 2, clear weather and a 96 m route over 16 seconds. The worker delivered 46 additional meshes during the walk. Across 555 animation-frame intervals, p95 was 50.0 ms and the maximum was 83.5 ms. This is a single full-game hardware capture. A separate headless run forced worker creation to fail and verified the same route completed in fallback mode.

## 9. Four-leg production walking replay

Run `npm run perf:run` for a manual-entry hardware capture at Ultra. The road and forest legs cover streaming, drawing, sound and simulation from different locations. The mist and rain legs traverse the same bog shore under the same wind and starting light. The replay records actual mirror passes, with separate asynchronous GPU measurements for the mirror and main view. The [replay guide](perf-replay.md) lists the scene-specific CSVs, summaries and comparison command.

During verification the first runner wrote horizontal positions alongside normal locomotion. Recorded consecutive positions confirmed the reported forward/back motion, including a 0.79 m reverse step in the forest. The final controller supplies speed and bounded steering during physics substeps. Each leg checks the observed positions against its scheduled track and rejects a backward step over 10 cm. Earlier position-driven captures have a different protocol version.

The first validated protocol-v3 run used Chrome 156.0.8078.79 and an NVIDIA GTX 1650 Max-Q at 1280 × 720, pixel ratio 1 and Ultra. The 100-second traversal recorded 4,864 frames. Every scene recorded zero backward displacement between successive frames. Maximum deviation from the scheduled track was 1.60 m in the forest. This is an instrumented baseline from a working tree that included separate soundscape changes.

| Scene | Frames | Average FPS | Frame p95 | Reflection passes | Valid mirror GPU samples | Mirror GPU p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Village road, clear | 924 | 37.0 | 36.7 ms | 924 | 922 | 6.02 ms |
| Forest, rain | 1,238 | 49.5 | 28.7 ms | 0 | 0 | — |
| Bog shore, mist | 1,366 | 54.7 | 25.0 ms | 1,366 | 1,364 | 2.87 ms |
| Bog shore, rain | 1,336 | 53.5 | 27.0 ms | 1,336 | 1,333 | 3.06 ms |

The run directory is `perf-runs/2026-11-28T09-08-25.863Z-FxReAG`. Each scene has 29 independently readable sections. For this baseline, use `reflection-gpu bog-shore-rain` as the last two arguments to `perf:compare` to inspect mirror GPU timings. Pending GPU queries at the end of a leg are excluded.

## 10. Rust terrain noise grid

The first Rust slice replaces the lattice hash, smooth noise and batched fBm grid. Seeded terrain shaping, normal samples and mesh density keep their existing implementations. On Node 22, alternating against the handwritten kernel from `95e7220`, p50 noise-grid time in microseconds changed from 7.54 to 5.79 (7×7), 26.44 to 19.48 (13×13), 94.41 to 69.78 (25×25), and 367.77 to 282.91 (49×49). Each result is the median of 30 warm batches. These are isolated grid timings.

All 128 grid outputs and 512 culling results in the kernel benchmark matched the original bytes. A separate comparison of 24 entire meshes across seeds 2026 and 7013, four locations per seed and all three LODs matched every position, normal, color, UV and splat byte. Combined attribute SHA-256 was `4992797c434d7630001b97582bfb821e8b382b0956e84c9dd3b87f3af2abe8cb`.

## 11. Rust terrain chunk culling

The culler now lives beside the noise kernel in the compiled Rust module. The hand-assembled module is gone. The culler retains the original float32 plane tests and squared LOD thresholds. Its 121-slot game adapter, including both input copies and the LOD output copy, measured 0.780 µs p50 and 0.836 µs p95 against 1.028 µs and 1.364 µs for the original implementation in alternating batches. The combined noise and culling digest stayed `a1944629caef3b9b51535b2eab13c5d873be1c7be68b6549725763137d63dc27`. Tangent spheres and exact LOD and maximum-range boundaries also have explicit regression coverage.
