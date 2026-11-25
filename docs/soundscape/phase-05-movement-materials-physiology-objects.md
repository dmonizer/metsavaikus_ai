# Phase 05 — Player Movement, Material Inheritance, Physiology & Object Interactions

## Objective
Synchronize player movement, exertion breathing, and physical object/door interactions with inheritable material profiles and real physical outcomes.

## Interfaces & Contracts
- Distance/gait-synchronized footsteps across inherited material profiles (`wood` -> `wooden_floor` -> `decrepit_wooden_floor`, `wooden_boardwalk`, `forest_floor`, `gravel`, `grass`, `water`).
- Long-form walking MP3s (`footsteps-on-moss-and-breaking-twigs-in-forest.mp3`, `walking-on-gravel.mp3`, `walking-in-water.mp3`) act as continuous gait loops that crossfade across surfaces/gaits and fade out immediately when movement stops without restarting per step.
- Exertion breathing independent of footsteps with gradual post-run recovery, plus rain-jacket/tent fabric rustle and vocalisations.
- Physical-outcome object interactions: non-breaking impact vs breakable surviving impact vs actual break (`wooden-crate-smash.mp3`, `two-wood-cracks.mp3`), correlated kick/impact deduplication, and decrepit vs intact door creaks (`decrepid-door-creaking.mp3`).

## Verification Criteria
- Stopping movement halts gait loops cleanly; changing surface crossfades smoothly.
- Breathing remains elevated immediately after sprinting stops and recovers gradually.
- Surviving kicks play impact sounds while actual breakage plays material-specific break sounds without duplicate kick+impact bursts.
