# Phase 06 — Weather Layers, Rain History, Post-Rain Dripping & Water Emitters

## Objective
Implement layered wind, surface-aware rain, authoritative/stochastic thunder with embedded-thunder safeguards, persistent weather history, post-rain roof dripping, and distributed water emitters.

## Interfaces & Contracts
- Weather history tracker on simulation clock: `lastRainTimestampSimMs`, `accumulatedRainMm` (sliding window), and `surfaceWetness` (0–1).
- Embedded-thunder safeguard: `rain-and-thunder-background.mp3` is tagged `embedded_thunder`; clean procedural rain layers drive default rain/storm beds while authoritative lightning/storm events trigger spatialized `thunder-clap-close.mp3` (preventing double thunder).
- `roof_water_trickling`: Continuous/looping emitter attached to roofed structures when `last_rain` within `2h`, `accumulated_rain_mm >= 1.0`, `surface_wetness >= 0.25`, and precipitation has stopped.

## Verification Criteria
- Post-rain dripping occurs only after eligible rainfall and never before any rain has fallen.
- Thunder is never duplicated between embedded rain tracks and discrete thunderclaps.
- Tent canvas rain and enclosed roof rain render distinctly from open-air rain.
