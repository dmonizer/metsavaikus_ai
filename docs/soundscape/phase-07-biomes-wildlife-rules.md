# Phase 07 — Layered Biomes & Shipped Wildlife Ecological Rules

## Objective
Compose multi-layer blended biomes without duplicate shared layers and implement all declarative wildlife rules for the shipped MP3 recordings and procedural fauna.

## Interfaces & Contracts
- Blended biome evaluation across `forest`, `thicket`, `village`, `abandoned`, `swamp`, `island`, `road` with shared-layer deduplication by definition ID.
- Shipped declarative wildlife rules:
  - **Woodpecker**: `05:00–08:00` & `16:00–19:00`, forest biome, shared close/distant quota of `0–3` per window.
  - **Nighttime Bird Escape**: night + forest + clear + walking, shared `2/night` cap and `1h` min interval, triggered stochastically or via step/branch reaction with `startled_wildlife` tag.
  - **Wolf Howl**: `23:00–04:00`, clear weather, moon above horizon, `1–2/night`, `1h` min interval, `200–600m` spatial spawn.
  - **Tawny Owl** & **Red Fox**: nocturnal/twilight woodland rules with quotas/cooldowns.
  - **Geographically Restricted Waterside Splash**: within `100m` of actual bog/water shoreline, spawning on the water edge.

## Verification Criteria
- All 14 shipped MP3s are mapped, loaded, and played through declarative rules.
- Shared close/distant woodpecker variants never exceed 3 calls per window.
- Geographical feature rules only fire within actual feature proximity and spawn on the feature.
