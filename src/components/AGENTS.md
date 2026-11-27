# UI and world runtime

Read this guide for `src/App.tsx` and `src/components/`. For world objects or physics also read [../world/AGENTS.md](../world/AGENTS.md); for domain rules read [../game/AGENTS.md](../game/AGENTS.md).

## Ownership and data flow

- `App.tsx` owns game phase, packing selection, UI preferences, modal open/close state, toast state, and the latest survival snapshot. It mounts the world (lazy-loaded), renders edge vignettes, and composes screen/HUD components and lazy modal overlays.
- `MetsavaikusWorld.tsx` is an imperative runtime inside a React effect that orchestrates world lifecycle, animation frames, input listeners, and subsystem wiring across focused modules under `src/components/runtime/`:
  - `gpuAndQuality.ts`: GPU tier detection, procedural environment/reflection map, and adaptive quality/DRS controller.
  - `hudBridge.ts`: DOM HUD vitals sync, biome/weather readout, snapshot construction, and throttled minimap redraws.
  - `playerController.ts`: walking/sprinting/swimming locomotion, shelter & floor detection, tent seating, and carried-prop updates.
  - `interactionController.ts`: raycast targeting, deadfall breaking, bog-water focus, E/F/R actions, and dynamic prop physics.
  - `debugController.ts`: F8 inspector raycasts, telemetry sampling, teleport, and `MetsavaikusDebugApi`.
  - `worldActionsBuilder.ts`: React-facing command bridge implementing `WorldActions`.
- `worldRuntimeContracts.ts` holds type-only contracts (`GamePhase`, `WorldHudRefs`, `WorldSurvivalSnapshot`, `WorldCallbacks`, `WorldActions`) shared between `App.tsx`, HUD components, and the Three.js runtime (re-exported from `MetsavaikusWorld.tsx` for compatibility). Keep `App.tsx` importing only `worldRuntimeContracts.ts` types so Three.js remains isolated in the lazy world chunk.
- Frequent vital/HUD updates write through `WorldHudRefs` with cached values. Snapshots update React less frequently. Keep frame-frequency data out of React state unless required by a UI interaction.
- The world effect rebuilds on seed or ref-object identity changes. Its callbacks and mutable preference refs let ordinary UI updates reach the existing world.

## UI entry points

- `TitleScreen.tsx`, `PauseModal.tsx`, `DisplaySettingsControls.tsx`: title screen, pause menu, and shared render-resolution/quality controls.
- `GameplayHud.tsx`: top biome/FPS card, mushroom basket & utility buttons, interaction prompt, tent-seated bar, toast, minimap/compass, and 5-bar vitals stack.
- `SleepingOverlay.tsx`, `WorldErrorOverlay.tsx`: sleeping time-lapse progress bar and recoverable world initialization error dialog.
- `PackingModal.tsx`: starting equipment selection (lazy-loaded).
- `BackpackStatusDrawer.tsx`: inventory and player status/actions (lazy-loaded).
- `SleepAndHearthModals.tsx`: sleep preview/selection and campfire actions (lazy-loaded).
- `FullMapModal.tsx`: expanded navigation map; `CollapseOverlay.tsx`: collapse presentation (lazy-loaded).
- `SoundscapeDiagnosticsOverlay.tsx`: F9 diagnostics, auditioning, and config reload (lazy-loaded).
- `DebugConsoleOverlay.tsx`, `DebugOverlayHud.tsx`: F8 debug inspector HUD and console (lazy-loaded).
- `LazyChunkBoundary.tsx`: React error boundary + Suspense fallback for lazy chunks.
- `ItemArtwork.tsx`: shared item presentation; `LanguageSwitcher.tsx`: language control; `src/index.css`: shared styles.

Landing/physical surface events and continuous audio share `world/surfaceMaterial.ts`; keep the runtime adapter lazy so covered surfaces do not trigger unnecessary terrain sampling.

Inventory commands call `finishInventoryChange` once after mutations, including failed ignition attempts that consume supplies. It refreshes derived burden before publishing the HUD and navigation snapshot. Keep feedback local to each command and finalize batches after the last mutation.

## Invariants and verification

`game/keyboardInput.ts` decides which keys belong to gameplay and cancels their browser defaults (including Firefox quick find). Preserve native controls/text editing, composition, modified browser shortcuts and Escape from pointer lock. The canvas is focusable; gameplay start/resume, canvas clicks and the last overlay closing restore its focus.

Game phases include title, packing, playing, paused, sleeping, collapsing, and collapsed. Modal visibility, pointer lock, movement suppression, and audio suspension must agree across App and the runtime. Inspect both input handlers when changing Escape or pause behavior.

`game/frameTiming.ts` preserves up to 250ms foreground time per render and splits player/prop integration into at most 1/60s steps. Weather, survival, audio and sleep consume the accepted frame time once; jump events are combined across physics steps. Focus/visibility changes reset the wall-clock baseline; paused/collapsed/debug-frozen simulation does not catch up later.

Every world lifecycle addition needs ownership for cleanup: listeners, scheduled frames/timeouts, GPU resources, audio resources, and asynchronous initialization. Preserve restart/unmount behavior and the disposed guard after asset loading. Carried and physically moving props must call `propsCtx.updateInteractivePosition` after movement so local interaction queries remain current.

Use the translation helpers for user-visible strings; see [../i18n/AGENTS.md](../i18n/AGENTS.md). Check lint/build plus applicable domain tests. Browser checks cover specific fixtures; manually verify affected gameplay flows such as restart, modal opening, pointer lock, tent seating, and sleep when they change.
