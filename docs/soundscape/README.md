# Soundscape Engine — Delivery Index & Architecture Guide

This directory holds the 10 logically separated, individually deliverable phase specifications and architectural references for the Baltic Nature Simulator Soundscape Engine.

## Phase Index

| Phase | Document | Scope |
|---|---|---|
| 01 | [`phase-01-core-schema-registry-mixer.md`](./phase-01-core-schema-registry-mixer.md) | Canonical config schema, inheritance, validator, clocks, RNG, bus mixer, replaceable backend, hybrid MP3 + synth loader |
| 02 | [`phase-02-events-conditions-reactions.md`](./phase-02-events-conditions-reactions.md) | Typed event bus, deduplication, causation tracing, declarative condition evaluator, bounded reaction chains |
| 03 | [`phase-03-scheduler-quotas-lifecycle.md`](./phase-03-scheduler-quotas-lifecycle.md) | Dual-clock scheduler, daily/midnight windows, quotas, cooldowns, Poisson rates, lifecycle & concurrency |
| 04 | [`phase-04-context-acoustics-spatial.md`](./phase-04-context-acoustics-spatial.md) | Authoritative world context adapter, continuous structural enclosure, door portals, spatial & virtual emitters |
| 05 | [`phase-05-movement-materials-physiology-objects.md`](./phase-05-movement-materials-physiology-objects.md) | Gait-synced footsteps, material inheritance, exertion breathing, physical-outcome object & door interactions |
| 06 | [`phase-06-weather-history-dripping-water.md`](./phase-06-weather-history-dripping-water.md) | Layered wind/rain, embedded-thunder safeguard, rain-accumulation history, post-rain roof dripping, water emitters |
| 07 | [`phase-07-biomes-wildlife-rules.md`](./phase-07-biomes-wildlife-rules.md) | Blended layered biomes without shared-layer duplication; woodpecker, nocturnal bird escape, wolf, owl, fox, splash |
| 08 | [`phase-08-disturbances-recovery.md`](./phase-08-disturbances-recovery.md) | Spatial disturbance spheres, independent gain vs generation blocking, exemptions, overlap policies, recovery |
| 09 | [`phase-09-music-persistence.md`](./phase-09-music-persistence.md) | Independent music scheduler, shuffle bags, silence pauses, crossfades, full serializable state persistence |
| 10 | [`phase-10-diagnostics-hotreload-verification.md`](./phase-10-diagnostics-hotreload-verification.md) | `F9` Diagnostics Overlay, live validated config hot-reload, manual auditioning, §28 automated verification |

## Extension Guide (Adding Content Without Core Changes)

All declarative configurations live under `src/config/soundscape/`:

- **Add a sound definition**: Add an asset entry in `src/config/soundscape/assets.ts` and a `SoundDef` in `src/config/soundscape/sounds.ts`. Reference any existing bus, spatial mode, condition tree, schedule, and limits.
- **Add a material profile**: Add a `MaterialProfile` in `src/config/soundscape/materials.ts` using `extends: '<parent>'` to inherit footstep/impact/break/creak mappings and override or remove (`$remove`) specific slots.
- **Add a structure acoustic profile**: Add an `AcousticProfile` in `src/config/soundscape/acoustics.ts` specifying `enclosure`, `roofCoverage`, per-category exterior transmission (`gain`, `lowpassHz`), `reverbWet`, and `roomToneSoundId`.
- **Add a biome**: Add a `BiomeDef` in `src/config/soundscape/biomes.ts` referencing shared layer IDs (shared layers are deduplicated automatically across blended biomes).
- **Add a disturbance**: Add a `DisturbanceDef` in `src/config/soundscape/disturbances.ts` specifying `triggerEvent`, `radiusMeters`, `overlapPolicy`, `effects` (with `gain`, `blockNewEvents`, `recoveryDelay`, `recoveryFade`), and `exceptions`.
- **Live hot-reload**: Press `F9` during gameplay, open the **Config Reload** tab, paste a partial or full JSON config override, and click **Reload Config**. Invalid configs report exact `{ file, definition, property, message }` diagnostics and preserve the last valid configuration.

## Unsupported or Approximated Backend Features (Explicit Disclosure)

Per Web Audio API browser constraints:
- **Hardware Doppler pitch shifting**: Marked optional in `AudioBackendCapabilities.doppler`; the Web Audio backend does not apply automatic `velocity`-based Doppler shifts to moving emitters (moving sources update 3D `PannerNode` positions smoothly instead).
- **True convolution reverb impulse responses**: The Web Audio backend uses a lightweight parametric delay/lowpass room-ambience tail and bus filtering rather than shipping large external `.wav` convolution IRs.
- **Streaming decompression for multi-minute lossless audio**: Assets use browser `fetch` + `AudioContext.decodeAudioData` with lazy decoding and memory caching; ultra-long streaming `<audio>` element fallback is optional.

## Appendix A — Remaining Asset Priorities

All 14 shipped MP3s under `src/assets/sounds/` are integrated into the declarative engine. Unrecorded layers currently use declared procedural Web Audio synthesizers and remain prioritized for future studio/field recordings:
1. **High priority**: Individual footstep transients (`forest_floor`, `gravel`, `wood`, `grass`, `stone`, `water`) with walk/run/crouch variants; clean rain loop without embedded thunder; day/night forest ambience beds; light/strong wind and gusts; stream/trickling loops; non-breaking wood/crate impacts; resting/exerted/exhausted breathing loops.
2. **Medium priority**: Floorboard creaks; rain on wood/metal/foliage/water; interior room tone; insects/frogs; additional wildlife variants; grunts/clothing/equipment rustle; intact wooden door open/close/latch.
3. **Lower priority**: Snow/ice surfaces; acoustic music tracks (`music/forest-day-*.mp3`, `music/forest-night-*.mp3`).
