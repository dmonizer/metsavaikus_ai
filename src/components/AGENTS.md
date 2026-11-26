# UI and world runtime

Read this guide for `src/App.tsx` and `src/components/`. For world objects or physics also read [../world/AGENTS.md](../world/AGENTS.md); for domain rules read [../game/AGENTS.md](../game/AGENTS.md).

## Ownership and data flow

- `App.tsx` owns game phase, packing selection, UI preferences, modals, toast state, language subscription, and the latest survival snapshot. It mounts the world and supplies HUD refs and callbacks.
- `MetsavaikusWorld.tsx` is an imperative runtime inside a React effect. It creates/disposes the renderer and world systems, runs the frame loop, handles input and interactions, moves the player and dynamic props, advances survival/sleep, and bridges audio through the per-world `soundscape.contextBuilder` (see the world guide for geography sampling).
- `WorldActions` exposes commands through `actionsRef`; `WorldCallbacks` reports changes back to React. `WorldSurvivalSnapshot` is the UI-facing snapshot. These contracts currently live in `MetsavaikusWorld.tsx`.
- Frequent vital/HUD updates write through `WorldHudRefs` with cached values. Snapshots update React less frequently. Keep frame-frequency data out of React state unless required by a UI interaction.
- The world effect rebuilds on seed or ref-object identity changes. Its callbacks and mutable preference refs let ordinary UI updates reach the existing world.

## UI entry points

- `PackingModal.tsx`: starting equipment selection.
- `BackpackStatusDrawer.tsx`: inventory and player status/actions.
- `SleepAndHearthModals.tsx`: sleep preview/selection and campfire actions.
- `FullMapModal.tsx`: expanded navigation map; `CollapseOverlay.tsx`: collapse presentation.
- `SoundscapeDiagnosticsOverlay.tsx`: F9 diagnostics, auditioning, and config reload.
- `ItemArtwork.tsx`: shared item presentation; `LanguageSwitcher.tsx`: language control.
- `src/index.css`: shared styles; `App.tsx` also contains substantial screen/HUD markup.

## Invariants and verification

Game phases include title, packing, playing, paused, sleeping, collapsing, and collapsed. Modal visibility, pointer lock, movement suppression, and audio suspension must agree across App and the runtime. Inspect both input handlers when changing Escape or pause behavior.

`game/frameTiming.ts` preserves up to 250ms foreground time per render and splits player/prop integration into at most 1/60s steps. Weather, survival, audio and sleep consume the accepted frame time once; jump events are combined across physics steps. Focus/visibility changes reset the wall-clock baseline; paused/collapsed/debug-frozen simulation does not catch up later.

Every world lifecycle addition needs ownership for cleanup: listeners, scheduled frames/timeouts, GPU resources, audio resources, and asynchronous initialization. Preserve restart/unmount behavior and the disposed guard after asset loading. Carried and physically moving props must call `propsCtx.updateInteractivePosition` after movement so local interaction queries remain current.

Use the translation helpers for user-visible strings; see [../i18n/AGENTS.md](../i18n/AGENTS.md). Check lint/build plus applicable domain tests. Browser checks cover specific fixtures; manually verify affected gameplay flows such as restart, modal opening, pointer lock, tent seating, and sleep when they change.
