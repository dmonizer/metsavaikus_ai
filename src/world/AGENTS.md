# World generation, objects, and rendering

## System map

- `worldBlueprint.ts` generates seeded villages, buildings, roads, bog islands, and world landmarks.
- `terrainMath.ts` owns terrain/biome/road sampling and a module-global active blueprint. Set the active seed before creating dependent systems. Concurrent independent worlds would require changing this shared state.
- `terrainChunkManager.ts` streams a sliding terrain window, caches LOD geometry, handles visibility, and exposes diagnostics. `wasmCompute.ts` provides an optional WASM compute implementation with a JavaScript fallback.
- `foliageFactory.ts` contains vegetation geometry/material construction, seeded chunk baking, grass tiles, instancing/LOD/culling, collider indexing, and breakable deadfall state. `botanicalGeometry.ts`, `grassScatter.ts`, and `forestFrustumCuller.ts` provide reusable geometry and placement/culling rules.
- `proceduralTextures.ts` asynchronously loads photographs and creates procedural/PBR textures shared by world systems.
- `architectureAndProps.ts` builds houses, fences, wells, campfires, signposts, boardwalks, movable props, mushrooms, and runtime tents. Its returned `WorldPropsContext` exposes shared registries, placement/collection methods, shelter/environment queries, pooled lights, water reflection, and disposal. `pantry.ts` selects provision pickups.
- `waterSurface.ts` owns bog water shading, shore-depth data, and reflection rendering. `weatherAndSky.ts` owns time/weather, sky, sun/shadows, rain, stars, and atmospheric effects.
- `minimapMath.ts` owns fog of war, minimap rendering, and map coordinate helpers.
- `soundEngine.ts` owns the legacy/synth audio facade and shared AudioContext. `soundscapeAdapter.ts` maps simulator state and spatial queries into the declarative audio engine; read [../soundscape/AGENTS.md](../soundscape/AGENTS.md) for audio changes.

## Shared geometry and physics

`shelterGeometry.ts` is authoritative for rotated house/tent footprints, floors, cover, and vegetation exclusion. Its data texture supplies shared shader queries. Register/remove runtime footprints with the same lifecycle as their object. Preserve rotation conventions and roof-ridge coverage across CPU and GPU consumers.

`spatialPhysics.ts` implements oriented, vertically bounded box colliders, swept sphere motion, and character push-out. Reuse it for wall resolution and moving objects. Doors update collider activity when toggled. `CircleCollider` and boardwalk zones are currently declared in `architectureAndProps.ts`; boardwalk queries use its shared helper.

The React runtime in [../components/AGENTS.md](../components/AGENTS.md) owns player integration, dynamic prop motion, raycast targeting, and callbacks that apply inventory/survival changes. Inspect both layers for interaction changes.

## Object and resource contracts

`registerInteractive` connects meshes/descendants to interaction entries and shared arrays. Entries carry gathering, pickup, carry/kick, velocity/resting, and use callbacks. Removal must keep the scene, interaction/dynamic registries, collision/shelter data, and shadow invalidation consistent.

Keep pooled point-light counts and shader variants stable. Invalidate shadow maps when doors, carried props, tents, or light locations change. Preserve existing geometry batching, vegetation instancing, LOD, and bounded caches when splitting object factories. Track ownership of shared versus per-instance geometries/materials so disposal neither leaks resources nor destroys shared assets.

`seededRandom.ts` owns the shared Mulberry32 mechanics; callers retain their original salts and independent streams. Golden sequence and blueprint tests protect pre-extraction output. Seeded generators use different salts. Preserve output sequences and random-call ordering when extracting helpers, unless changing the generated world is intentional.

## Verification

Run relevant colocated tests for terrain, spatial physics, shelters, vegetation geometry/scattering, and game water behavior. Use `npm run test:rendering` for GPU shelter/shader changes, then lint/build. Use runtime performance counters from `game/perfLogger.ts` and quality diagnostics to measure changes; source-level opportunities alone do not establish FPS gains.
