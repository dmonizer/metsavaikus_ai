# Phase 03 — Dual-Clock Scheduler, Quotas, Cooldowns & Instance Lifecycle

## Objective
Implement ecological scheduling on the simulation clock and perceptual fades/playback lifecycles on the real elapsed clock, with multi-scope quotas, cooldowns, concurrency policies, and safe time-jump handling.

## Interfaces & Contracts
- Playback triggers: `event`, `scheduled` (daily & midnight-crossing windows with once-per-window target sampling), `stochastic` (frame-rate-independent Poisson / interval+probability), `continuous`, `repeating`, and `state_driven`.
- Multi-scope quotas & cooldowns (`global`, `player`, `region`, `biome`, `emitter`, `entity`) across `day`, `night`, `window`, and `rolling` periods that persist across biome/structure transitions.
- Explicit lifecycle state machine: `scheduled -> starting -> playing <-> paused / virtualised -> stopping -> completed`, supporting fade reversal, loop-position preservation, atomic quota reservation/release, and expiration of stale queued transients.

## Verification Criteria
- Midnight-crossing windows (`23:00`–`04:00`) behave as one continuous window with one shared target/quota.
- Time acceleration and backward clock jumps never burst-play missed occurrences or lock cooldowns.
- Condition-loss obeys configured policy (`finish`, `fade_out`, `crossfade`, `pause`, `stop_immediately`), with fade reversal when re-enabled during fade-out.
