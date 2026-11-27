# Declarative soundscape runtime

Read [../../docs/soundscape/README.md](../../docs/soundscape/README.md) for the phase/spec index, and [../config/soundscape/AGENTS.md](../config/soundscape/AGENTS.md) for sound content. Match historical design statements to current implementation before relying on them.

## Runtime flow

`world/soundscapeAdapter.ts` creates the engine/backend/spatial provider, builds `WorldContext` from simulator state through a per-world geography cache (dynamic weather, structure, and motion remain fresh), and saves/restores snapshots. `world/soundEngine.ts` attaches the backend to its AudioContext and retains synth/fallback effects. `components/MetsavaikusWorld.tsx` supplies context, steps the engine, and emits physical interaction events.

- `types.ts`: canonical context, event, config, backend, diagnostics, and persistence contracts.
- `configSchema.ts`: validation, normalization, references, inheritance, and override merging. Invalid reloads preserve the previous valid configuration.
- `soundscapeEngine.ts`: coordination of event reactions/material sounds, continuous biome/weather layers, gait/physiology, music, reload, diagnostics, and snapshots.
- `eventBus.ts` and `conditionEvaluator.ts`: dispatch/deduplication/chain bounds and declarative predicates.
- `scheduler.ts` and `clocks.ts`: scheduling, quotas/cooldowns, real/simulation clocks, and seeded randomness.
- `instanceManager.ts`: active/virtual voice lifecycle, limits, and acoustic updates.
- `mixer.ts`, `acoustics.ts`, and `disturbanceManager.ts`: buses, enclosure/transmission processing, and spatial disturbance/recovery.
- `audioBackend.ts`: mock backend plus browser Web Audio loading, decoding/caching, MP3/synth voices, and spatial processing.

## Invariants

Keep real and simulation time explicit, especially across pause, fast-forward sleep, day rollover, and persistence. Keep content decisions in config and simulator-specific geometry queries in the adapter.

Route physical sounds from outcomes and preserve material, position, source IDs, correlation, and deduplication metadata. Check the legacy facade before adding playback to avoid playing an effect through both systems.

Use the shared `usesContinuousPlayback` policy for initial sources and recreated sources: gapless repeats (finite or infinite, including explicit zero pauses) use native looping; positive pauses use one-shot sources restarted by the instance timer. Keep finite completion governed by the target count.

Respect voice/event/reaction limits and stable lifecycle ownership. Audio nodes and async loads must be cleaned up safely on stop, reload, and world disposal. Preserve backend interchangeability and deterministic mock tests.

## Verification

`instanceManager.test.ts` verifies repeat policy across source creation, condition/manual resume, gapless finite completion and positive-pause restart. `soundscapeEngine.test.ts` tests engine behavior with controllable clocks/backends. Run `npm test`, lint, and `npm run test:audio` as appropriate; audible mix, browser autoplay/resume, and spatial perception still require listening checks. F9 opens the UI diagnostics/audition/reload overlay.

Title preloading downloads the encoded files of registered, preload-enabled recordings. The Web Audio backend shares those downloads with playback and decodes on audio unlock; world disposal aborts pending fetches. Individual unavailable recordings follow the existing audio fallback.
