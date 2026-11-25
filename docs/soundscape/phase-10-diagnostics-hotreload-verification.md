# Phase 10 — Keyboard-Activated Diagnostics Overlay (`F9`), Live Config Hot-Reload & Verification

## Objective
Provide an `F9` keyboard-activated diagnostics and live tuning overlay, safe zero-interruption config hot-reload with rollback, and a complete automated verification suite covering every §28 requirement.

## Interfaces & Contracts
- `SoundscapeDiagnosticsOverlay`: Non-blocking right-hand drawer toggled via `F9` (closes on `F9` or `Esc`), displaying Active/Virtual Voices, Rules/Quotas/Rejection Reasons, Acoustics/Disturbances, Bus Mixer + Music Controls + Manual Event/Sound Audition, and Live Config Reload editor.
- `reloadConfig(overrideConfig)`: Validates atomically; commits new definitions while preserving unaffected playing instances, quota counters, cooldowns, and active disturbances; rolls back to last valid config and displays exact errors on failure.
- `src/soundscape/soundscapeEngine.test.ts`: Automated `node:test` suite exercising all §28 scenarios deterministically.

## Verification Criteria
- Pressing `F9` opens/closes the overlay cleanly without freezing or pausing gameplay.
- Live config reload updates rules immediately without interrupting unaffected voices, and invalid config reloads fail safely with exact diagnostics.
- `npm test`, `npm run lint`, `npm run build`, and Playwright browser verification all pass cleanly.
