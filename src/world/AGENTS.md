# World generation, objects, and rendering

## System map

- `terrainRelief.ts` holds dependency-free shared terrain constants (`WORLD_SIZE`, `SWAMP_WATER_Y`, `MIN_BOG_ISLAND_HUT_RADIUS`) and pure relief evaluators (`evaluateRawBogMask`, `evaluateBogPoolMask`, `evaluateHillRelief`, `evaluateBaseDryLandFromNoise`) shared by blueprint generation and terrain sampling.
- `worldBlueprint.ts` generates seeded maps with: a multi-lobe peat bog covering >= 1/3 of the 1200x1200m map (flat sphagnum plain, localized `bogPools` lake systems, and varying-size `swampIslands` where huts only appear on islands with `radius >= MIN_BOG_ISLAND_HUT_RADIUS`), Estonian moraine hills (20–40m relief above `SWAMP_WATER_Y`), non-bog freshwater `lakes`, narrow shallow downhill `streams` (<= ~1m wide woodland brooks across `cascade`, `woodland`, and `flat` slope regimes with exact lake-shoreline mouth entry), varied `roadShape` networks, 3–6 `villages` (1–5 houses each, >= 100m house separation, varied `decayState`), 4–6 trail-less abandoned decrepit `forestHuts`, an extensible `majorStructures` landmark hook (`MajorStructureSiteBlueprint`), unified `buildingPads`, and O(1) 50m spatial grids (`roadGrid`, `buildingPadGrid`).
- `terrainMath.ts` owns terrain/biome/road/water sampling (`getWaterSurfaceAt`, `getNearestWaterFeatureDistances`, `canPlaceStoneAt`, `isInBogBasin`) and a module-global active blueprint. Set the active seed before creating dependent systems. Concurrent independent worlds would require changing this shared state.
- `terrainChunkManager.ts` streams a sliding terrain window, caches LOD geometry (using `SHORE_LOD0_SEGS = 48` only on chunks overlapping bog pools, freshwater lakes, or streams to keep flat bog plains fast), handles visibility, and exposes diagnostics. `wasmCompute.ts` provides an optional WASM compute implementation with a JavaScript fallback.
- `worldInit.ts`: orchestrates staged async world initialization and guarantees cleanup on failure, unmount, or late cancellation.
- `foliageFactory.ts` (facade over `vegetation/`): coordinates `vegetation/vegetationTypes.ts`, `vegetation/foliageShaders.ts`, `vegetation/understoryGeometry.ts`, `vegetation/vegetationChunkBaker.ts`, and `vegetation/grassTileStreamer.ts` for vegetation geometry/material construction, seeded chunk baking, grass tiles, instancing/LOD/culling, collider indexing, and breakable deadfall state. `botanicalGeometry.ts`, `grassScatter.ts`, and `forestFrustumCuller.ts` provide reusable geometry and placement/culling rules. Stones/boulders (`boulder`, `boulderOutcrop`, and loose fieldstones in `dynamicPropsBuilder.ts`) are strictly gated by `canPlaceStoneAt` so the bog never spawns stones.
- `proceduralTextures.ts` (facade over `textures/`): asynchronously loads photographs and coordinates `textures/textureUtils.ts`, `textures/terrainAndStoneTextures.ts`, `textures/barkAndFoliageTextures.ts`, `textures/architectureTextures.ts`, and `textures/mushroomTextures.ts` with `TextureFactoryScope` tracking and cleanup.
- `architectureAndProps.ts` (facade over `props/`): coordinates `props/propTypes.ts`, `props/propMaterials.ts`, `props/buildingsAndWells.ts`, `props/campfiresAndTents.ts`, `props/boardwalkBuilder.ts`, `props/dynamicPropsBuilder.ts`, and `props/mushroomBuilder.ts`. Its returned `WorldPropsContext` exposes shared registries, placement/collection methods, shelter/environment queries, pooled lights, bog water reflection (tightly bounded around `bp.bogPools`), freshwater lake/stream updates, campfire log-feeding/throwing, and disposal. `campfireFire.ts` owns multi-tiered shader flames, glowing ember beds, glowing/burning base hearth logs, intermittent ambient sparks, spark cloud bursts, and delayed ignition for thrown fuel logs. `pantry.ts` selects provision pickups.
- `waterSurface.ts` owns planar-reflective bog lake shading, shore-depth data, and reflection rendering. `freshwaterMeshes.ts` + `streamBuilder.ts` render clear non-bog freshwater lakes (1 draw call per lake with 56×56 shoreline mesh and stream-mouth depth continuity) and realistic narrow woodland streams (high-resolution textured 3D pebble/sand streambed ribbon, translucent rock-wake bubbling water ribbon with seamless lake mouth cross-fade, and 4 batched `InstancedMesh`es for protruding mossy boulders, submerged pebbles, submerged twigs/detritus, and fallen mossy logs) with no extra reflection render passes. `weatherAndSky.ts` owns time/weather, sky, sun/shadows, rain, stars, and atmospheric effects.
- `minimapMath.ts` owns fog of war, minimap rendering, and full topographic map rendering (6m elevation contours, multi-lobe bog, bog pools, freshwater lakes, streams, varied road segments, spread-out village houses, island huts, and forest huts).
- `soundEngine.ts` owns the legacy/synth audio facade and shared AudioContext. `soundscapeAdapter.ts` maps simulator state and spatial queries (including lakes and streams via `getNearestWaterFeatureDistances`) into the declarative audio engine. Each world owns a `SimulatorSoundscapeContextBuilder`: static geography is resampled after 1m movement or within 200ms of smaller movement, with immediate seed/water/boardwalk invalidation; dynamic context remains fresh each frame; read [../soundscape/AGENTS.md](../soundscape/AGENTS.md) for audio changes.

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

For reflection comparisons, `waterSurface.ts` uses the sky fallback when the F8 Perf reflection pass is disabled. Its render method reports whether the pass ran. Read live grass counts without consuming streaming diagnostics when gathering focused perf samples.

Shelter shaders use a 16 m grid of conservative footprint-row ranges. Rebuild it with the exact footprint texture on membership changes. The rotated footprint and roof equations still determine coverage, including outside the grid.

Run `node --import tsx scripts/bench-world-streaming.mjs` for fixed seed-2026 road queries, detailed terrain generation, grass bakes and a geometry-output hash. Road broad-phase rejection uses trail-weighted segment bounds; winning candidates retain the full projection and distance calculation.

Grass tile baking uses per-layer reusable sample and packing buffers. Keep matrix/color slabs returned to the tile cache independently owned and preserve double precision until the original float-buffer writes.

The planar mirror uses a conservative horizontal-disc/frustum test even when the player is inside the bog radius. Keep partial-disc views and refresh the mirror on re-entry.

Terrain color and roughness share shoreline depth and swash masks; keep their different wetness response curves. The rendering fixture exercises the patched terrain material at two fixed phases.

The boardwalk deck and sleepers share a world-space bounding box computed from all segment instances. Apply fog distance to the nearest point of that box and let each render camera frustum-cull the batches.

World initialization awaits staged construction and routes async failures through the retry overlay. Check lifetime after yielding between construction stages.
