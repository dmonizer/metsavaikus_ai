# Phase 08 — Spatial Disturbances, Exemptions & Independent Recovery

## Objective
Implement world-space acoustic disturbances that suppress wildlife gain and event generation within an attenuated radius, respect explicit exemptions, support overlap policies, and recover independently per guild.

## Interfaces & Contracts
- `DisturbanceManager`: World-space spheres (`origin`, `radiusMeters`, `attenuation: 'linear'`), independent `gain` suppression and `blockNewEvents` suppression, `overlapPolicy` (`strongest_and_longest`, `reset`, `extend`, `accumulate`, `independent`), per-target `recoveryDelay` + `recoveryFade` on simulation clock, and `exceptions` (`buses`, `sounds`, `tags`).
- Suppressed event generation never consumes quotas.
- Moving outside a disturbance radius restores wildlife; returning before recovery restores suppression dynamically.

## Verification Criteria
- Gunshot/explosion/thunder/crate-smash disturbances silence nearby insects, birds, and mammals while exempting `player`, `environment.weather`, `environment.water`, `ui`, and `bird_escaping_flight`.
- Insects, birds, and mammals recover at their distinct configured timelines without burst-playing missed events.
