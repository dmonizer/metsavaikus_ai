# Phase 09 — Independent Music System & Persistence Lifecycle

## Objective
Deliver a non-spatial music system completely decoupled from environmental attenuation and a full serializable persistence store surviving pause, time acceleration, sleep, teleportation, and session reload.

## Interfaces & Contracts
- `MusicScheduler`: Independent `musicEnabled` and `musicVolume` preferences, shuffle-bag selection, configurable silence pauses (`[2m, 8m]`), fade-in/out & crossfades, `non_spatial` mode with `environmentalAcoustics: false`.
- `SoundscapePersistenceSnapshot`: Versioned JSON snapshot storing window targets, quota counters, cooldown timestamps, pending delayed reactions, active disturbances & recovery times, weather rain history, RNG state, and user audio preferences.

## Verification Criteria
- Disabling music silences only the `music` bus and leaves all environmental/player/object audio unaffected.
- Save/load preserves active quotas, cooldowns, disturbances, and weather history without replaying completed transients or breaking on backward clock adjustments.
