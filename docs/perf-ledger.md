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

The target GPU was unavailable locally. The CPU harness and SwiftShader image fixtures establish output parity on the sampled inputs. Hardware frame-time percentiles, per-pass GPU time, upload bandwidth and shader first-use stalls still need a repeatable hardware capture. Whole-chunk worker/WASM generation, partial instance uploads, shader prewarming and narrower shadow invalidation remain open experiments.

## Boardwalk visibility correction

The long deck batch used an 18 m structure sphere at the bog center, while sleepers used native instance culling. A fixed camera on the southeast leg of seed 2026 reproduced the missing deck when facing SE. Both batches now use the trail's full bounds for fog distance and native per-camera instance culling. The Chrome rendering fixture checks deck pixels in both directions from the same spot.
