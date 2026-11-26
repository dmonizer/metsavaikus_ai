# World generation, objects, and rendering

## System map

- `worldBlueprint.ts` generates seeded villages, buildings, roads, bog islands, and world landmarks.
- `terrainMath.ts` owns terrain/biome/road sampling and a module-global active blueprint. Set the active seed before creating dependent systems. Concurrent independent worlds would require changing this shared state.
- `terrainChunkManager.ts` streams a sliding terrain window, caches LOD geometry, handles visibility, and exposes diagnostics. `wasmCompute.ts` provides an optional WASM compute implementation with a JavaScript fallback.
- `foliageFactory.ts` contains vegetation geometry/material construction, seeded chunk baking, grass tiles, instancing/LOD/culling, collider indexing, and breakable deadfall state. `botanicalGeometry.ts`, `grassScatter.ts`, and `forestFrustumCuller.ts` provide reusable geometry and placement/culling rules.
- `proceduralTextures.ts` asynchronously loads photographs and creates procedural/PBR textures shared by world systems.
- `architectureAndProps.ts` builds houses, fences, wells, campfires, signposts, boardwalks, movable props, mushrooms, and runtime tents. Its returned `WorldPropsContext` exposes shared registries, placement/collection methods, shelter/environment queries, pooled lights, water reflection, campfire log-feeding/throwing, and disposal. `campfireFire.ts` owns multi-tiered shader flames, glowing ember beds, glowing/burning base hearth logs, intermittent ambient sparks, spark cloud bursts, and delayed ignition for thrown fuel logs. `pantry.ts` selects provision pickups.
- `waterSurface.ts` owns bog water shading, shore-depth data, and reflection rendering. `weatherAndSky.ts` owns time/weather, sky, sun/shadows, rain, stars, and atmospheric effects.
- `minimapMath.ts` owns fog of war, minimap rendering, and map coordinate helpers.
- `soundEngine.ts` owns the legacy/synth audio facade and shared AudioContext. `soundscapeAdapter.ts` maps simulator state and spatial queries into the declarative audio engine. Each world owns a `SimulatorSoundscapeContextBuilder`: static geography is resampled after 1m movement or within 200ms of smaller movement, with immediate seed/water/boardwalk invalidation; dynamic context remains fresh each frame; read [../soundscape/AGENTS.md](../soundscape/AGENTS.md) for audio changes.

`surfaceMaterial.ts` is authoritative for surface precedence shared by landing/physical events and the soundscape adapter. Terrain queries can be lazy getters; preserve boardwalk, water, interior floor, mud, gravel, village grass, forest ordering.

`geometryPreparation.ts` owns non-indexed conversion and fallback normals/UVs/vertex colors. Botanical preparation requests white or height-gradient colors; props request a solid color only when supplied. Existing attributes are preserved. The default source policy reuses non-indexed input and retains indexed input; explicit copy/consume policies govern other ownership needs.

## Shared geometry and physics

`shelterGeometry.ts` is authoritative for rotated house/tent footprints, floors, cover, and vegetation exclusion. Its data texture supplies shared shader queries. Register/remove runtime footprints with the same lifecycle as their object. Preserve rotation conventions and roof-ridge coverage across CPU and GPU consumers.

`spatialPhysics.ts` implements oriented, vertically bounded box colliders, swept sphere motion, and character push-out. Reuse it for wall resolution and moving objects. Doors update collider activity when toggled. `CircleCollider` and boardwalk zones are currently declared in `architectureAndProps.ts`; boardwalk queries use its shared helper.

The React runtime in [../components/AGENTS.md](../components/AGENTS.md) owns player integration, dynamic prop motion, raycast targeting, and callbacks that apply inventory/survival changes. Inspect both layers for interaction changes.

## Object and resource contracts

`registerInteractive` connects meshes/descendants to interaction entries and shared arrays. Entries carry gathering, pickup, carry/kick, velocity/resting, and use callbacks. `pointSpatialIndex.ts` supplies shared point buckets for interactive and mushroom candidates. Query nearby interactions through `queryInteractiveObjects`; call `updateInteractivePosition` after moving a prop. Use callbacks reindex themselves (including doors); collection and packing remove index membership. Mushroom visibility clears the previous local visible set before applying the current radius/frustum/fade rules. Removal must keep the scene, interaction/dynamic registries, collision/shelter data, and shadow invalidation consistent.

Keep pooled point-light counts and shader variants stable. Invalidate shadow maps when doors, carried props, tents, or light locations change. Preserve existing geometry batching, vegetation instancing, LOD, and bounded caches when splitting object factories. `worldResources.ts` owns props scene roots and deduplicates geometry/material/explicit-resource disposal. Register roots through its `add`; use `addComposite` for a root with its own disposer (bog water), `ownComposite` for a nested object with its own disposer (campfire visuals), and `own` for unattached or shared resources. Textures remain borrowed from `WorldTextures`. Packing detaches the tent and disposes only its per-instance geometry; shared materials live until the world scope is disposed. Teardown is idempotent and leaves unrelated scene roots intact.

`seededRandom.ts` owns the shared Mulberry32 mechanics; callers retain their original salts and independent streams. Golden sequence and blueprint tests protect pre-extraction output. Seeded generators use different salts. Preserve output sequences and random-call ordering when extracting helpers, unless changing the generated world is intentional.

## Verification

Run relevant colocated tests for terrain, spatial physics, shelters, vegetation geometry/scattering, and game water behavior. Use `npm run test:rendering` for GPU shelter/shader changes, then lint/build. Use runtime performance counters from `game/perfLogger.ts` and quality diagnostics to measure changes; source-level opportunities alone do not establish FPS gains.
