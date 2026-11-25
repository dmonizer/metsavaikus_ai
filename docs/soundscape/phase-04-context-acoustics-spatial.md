# Phase 04 — World Context Provider, Structural Acoustics & Spatial Emitters

## Objective
Bridge authoritative simulator world state (astronomy, weather history, blended biomes, geographical features, `ShelterGeometry`, and door states) without duplication, and compute continuous structural acoustics and 3D spatial emitter rendering.

## Interfaces & Contracts
- `WorldContextSnapshot`: Read-only snapshot exposing simulation time, sun/moon elevation & moon phase, weather + rain-accumulation history, blended biome weights, distances to actual features (`bog_water`, `road`, `village`, `roof`), and listener/source structural enclosure.
- `AcousticEnvironmentManager`: Computes continuous `enclosure` (0–1), `roofCoverage`, dynamic door portal openness bleed, per-category exterior transmission (`gain`, `lowpassHz`), and room reverb—distinct from structural age/decay and never attenuating local interior/player sounds merely because exterior ambience is attenuated.
- `SpatialSourceManager`: Supports listener-relative, player-attached, world-point, moving-entity, linear-feature, area, and generated-point emitters with fixed world coordinates and virtualization when out of range/budget.

## Verification Criteria
- Entering a tent, decrepit sagging hut, or intact farmhouse smoothly shifts exterior gain/filtering and roof rain without binary snapping.
- Opening a cabin door increases exterior transmission smoothly through the portal.
- Generated world-space wildlife emitters remain fixed at their world coordinates as the listener turns or moves.
