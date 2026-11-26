# Soundscape content

These modules define declarative content consumed by [../../soundscape/AGENTS.md](../../soundscape/AGENTS.md). `index.ts` assembles the default config and event reactions.

- `assets.ts`: asset IDs, bundled audio URLs, fallback synthesizers, and asset metadata.
- `sounds.ts`: sound definitions with triggers, conditions, schedules, limits, spatial modes, and asset selection.
- `buses.ts`: mixer hierarchy/defaults; `biomes.ts`: biome/shared layer membership.
- `materials.ts`: material inheritance and step/impact/break/creak sounds.
- `acoustics.ts`: structure transmission/enclosure profiles.
- `disturbances.ts`: event-triggered suppression/recovery behavior.
- `music.ts`: playlists and timing/selection settings.

Add content here before adding special cases to the engine. Keep referenced IDs valid across definitions, assets, buses, materials, and biomes. Keep shared biome layers shared to avoid duplicate playback during blending. Preserve embedded-thunder metadata so thunder layers are not unintentionally doubled.

Recorded replacements of procedural assets use the sample filename without its extension as their asset ID (for example, `rain-on-tent-loop`). Reserve `proc_` IDs for synthesized assets; update every reference when replacing one with a recording. Other existing recording IDs retain their established names.

Assets live in `src/assets/sounds/`; source recordings under `RAW` are excluded by the production asset-copy hook. Inspect actual files and registry usage before declaring an asset missing. For extension details consult [../../../docs/soundscape/README.md](../../../docs/soundscape/README.md).

Run config/engine tests and type checking after definition changes. Use browser audio checks and F9 auditioning for changed assets or playback behavior. Build to verify bundled asset resolution.
