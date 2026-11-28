# Gameplay rules and quality

This directory holds mostly renderer-independent domain rules. The caller in `components/MetsavaikusWorld.tsx` and `components/runtime/` owns live state and integration; read [../components/AGENTS.md](../components/AGENTS.md) when changing action wiring or frame timing.

- `itemCatalog.ts`: canonical item IDs/definitions, packing and inventory operations, equipment bonuses, weight, bottles, navigation availability, and campfire recipes. Use its mutation helpers. `survivalEngine.refreshInventoryBurden` refreshes pack weight, load tier, and exertion multipliers for inventory finalization and the survival tick.
- `gameLogic.ts`: mushroom species/basket data, interaction prompt construction, resolution/FPS utilities, pointer lock, mouse-look clamping, and height-clearance rules.
- `survivalEngine.ts`: barrel facade re-exporting `survivalTypes.ts`, `survivalVitals.ts`, `survivalConsumables.ts`, `survivalSleep.ts`, and `survivalDiscovery.ts` (vital state, exposure/temperature, burden, poisoning/collapse, consumption, bottle refill/boiling, cooking, ignition, sleep simulation/preview, and discovery tracking). Functions mutate passed state/inventory; inspect mutation semantics before sharing state with UI snapshots.
- `waterPhysics.ts`: water-state evaluation, swim enter/exit thresholds, and focused bog-water interaction tests. Preserve hysteresis and boardwalk handling; the runtime supplies terrain and obstruction queries.
- `qualityGovernor.ts`: hardware-aware profiles, adaptive tier selection with hysteresis, and distance smoothing. The runtime applies profiles to terrain, vegetation, weather/shadows, and resolution.
- `keyboardInput.ts`: shared keyboard ownership/default-cancellation policy; only bound game controls are claimed during active play, preserving native UI controls, browser modifiers, IME and pointer-lock Escape. `npm run test:keyboard` verifies trusted input and Firefox quick find in an isolated profile.
- `frameTiming.ts`: bounded elapsed-time policy (250ms maximum per frame) and physics substeps (at most 1/60s). It discards longer stalls without retaining catch-up debt; zero/invalid deltas do not advance time.
- `perfLogger.ts`: bounded performance reports and frame diagnostics consumed by the runtime/debug surface. Terrain build totals include prefetched meshes. The worker subtotal distinguishes these from main-thread deadline misses and fallback builds.
- `perfCapture.ts`: opt-in gameplay captures with frame-time percentiles and slowest frames. Align each frame interval with the preceding tick's wall timings. Keep debug panel, pause, and background gaps out of captures.

Shared geometry/collision belongs in [../world/AGENTS.md](../world/AGENTS.md), rather than being reimplemented in gameplay actions. Translate displayed results through [../i18n/AGENTS.md](../i18n/AGENTS.md).

Keep sleep preview and actual sleep using `stepSleepSlice`. Preserve inventory accounting and one-time collection. For rule changes run the relevant colocated tests, then the full `npm test` and type check. Browser verification is needed for phase transitions and physical interactions that pure tests do not exercise.
