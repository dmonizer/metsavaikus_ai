# Soundscape Engine — End-to-End Implementation Plan

A generic, declarative, spatially aware soundscape engine for the Baltic nature simulator that replaces hardcoded audio triggers with a validated, configuration-driven acoustic architecture. It unifies real recordings and procedural synthesis across typed simulation events, dual-clock ecological scheduling, structural enclosure acoustics, spatial wildlife disturbances, persistence, and a keyboard-activated live diagnostics overlay with zero-interruption configuration reload.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All four scoping and architecture questions have been confirmed. Upon approval, the first deliverable will author the **10 logically separated, individually deliverable section plans** as standalone specification/execution documents inside the documentation folder before executing each phase sequentially so the simulator remains runnable and verified after every stage.

- **Confirmed — Configuration Authoring Format**: **Validated TypeScript / JSON configuration modules** sharing one canonical runtime-validated schema (supporting inheritance, unit parsing, structural validation, and non-destructive live reload from edited JSON/config payloads without requiring a heavy YAML runtime parser).
- **Confirmed — Asset & Fallback Strategy**: **Hybrid MP3 + Procedural Web Audio synthesis**. All 14 shipped MP3 recordings are loaded, decoded, cached, and played with full spatialization and bus routing; unrecorded layers (wind beds, clean rain without thunder, crickets, buzzing insects, breathing, wooden floorboards, campfire crackle, tent canvas rain) fall back seamlessly to procedural Web Audio synthesizers, while missing or invalid asset entries emit structured diagnostics without ever crashing the simulator.
- **Confirmed — Audio Controls & Diagnostics UX**: **Keyboard-activated Diagnostics Overlay (`F9`)** featuring live inspection of active/virtual voices, quotas, cooldowns, eligibility/rejection reasons, structural acoustics, active disturbances, causation chains, bus volume/mute controls (including independent music toggle), manual trigger auditioning, and **live configuration reload without interrupting the running simulation** (rolling back to the last valid config on validation failure).
- **Confirmed — Delivery Organization**: **Full end-to-end engine organized into 10 logically separated, individually deliverable phases**, each captured in its own standalone document under the documentation directory so every phase can be reviewed, delivered, and verified independently.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms the simulator's audio layer into an extensible, rule-driven acoustic ecosystem. Every sound—whether a player footstep on wet gravel, a creaking decrepit cabin door, a breaking deadfall branch, a midnight wolf howl under a visible moon, post-rain roof trickling, or a distant woodpecker restricted to dawn and late afternoon—flows through a single typed Event Bus, declarative Condition Evaluator, Dual-Clock Scheduler, Structural Acoustics Resolver, Disturbance Manager, and Hierarchical Bus Mixer.
- **Target Audience / Persona**:
  - *Players* exploring the Estonian forest, homesteads, and peat bog who experience responsive, non-repetitive, spatially grounded immersion where shelter quality, open doors, weather history, and loud actions naturally reshape the acoustic world.
  - *Sound Designers & Developers* who can add new sound definitions, biomes, surface materials, acoustic profiles, disturbance reactions, and music playlists purely through validated declarative configuration—and test or hot-reload changes live via the `F9` diagnostics overlay without restarting the simulation.
- **Key Value**: Eliminates hardcoded audio logic, integrates all 14 existing audio assets cleanly (including treating long-form walking recordings as seamless gait loops and preventing unintended double-thunder from the embedded rain-and-thunder track), preserves all authoritative simulation state without duplication, and guarantees deterministic automated test coverage via injectable clocks, seeded RNG, context providers, and a mock audio backend.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Ambient World & Dynamic Acoustics Flow**:
   - As the player walks from open pine forest onto gravel roads, wooden boardwalks, shallow bog water, or intact vs. decrepit floorboards, footsteps smoothly transition across material profiles and gait loops (stopping cleanly when movement ceases without re-triggering long recordings on every step).
   - Entering a tent, decrepit sagging hut, or intact wooden farmhouse smoothly shifts exterior gain, low-pass muffling, interior room tone, and roof-impact rain layers according to a continuous enclosure coefficient rather than a binary indoor flag. Opening or closing a cabin door dynamically opens an acoustic portal so exterior wind and rain bleed in smoothly.
   - Loud events (crashing crates, thunderclaps, breaking logs, future weapon fire) trigger spatial disturbances that hush nearby insects, birds, and mammals for configured simulation-time recovery windows—while exempting reactive startled-bird flight escapes—and smoothly restore wildlife if the player walks outside the disturbed radius.
2. **Keyboard-Activated Diagnostics Overlay Flow (`F9`)**:
   - During gameplay, pressing **`F9`** opens the non-blocking Soundscape Diagnostics Overlay on the right side of the viewport (releasing pointer lock cleanly so the user can interact with tabs, sliders, and triggers while the simulation continues running live—or resumes pointer lock immediately upon pressing `F9` or `Esc`).
   - Inside the overlay, the user switches cleanly across focused inspection views:
     - **Active & Virtual Voices**: Live table of playing, fading, paused, and virtualized emitters with bus, state, world distance, linear gain, filter cutoff, and remaining duration.
     - **Rules, Quotas & Scheduler**: Next scheduled wildlife/weather occurrences, active window caps (e.g., woodpecker 0–3/window, nighttime bird escape max 2/night, wolf howl 1–2/night), cooldowns, and exact eligibility or rejection reasons.
     - **Acoustics & Disturbances**: Live enclosure coefficient, roof coverage, open door portal bleed, exterior transmission gain, biome blend weights, weather history wetness, and active spatial disturbances with recovery countdowns.
     - **Mixer & Audition**: Master/environment/weather/wildlife/player/objects/music bus sliders, independent music enable switch, manual event & sound trigger buttons, and simulation-time/context probes.
     - **Live Config Reload**: An inline validated JSON/override editor + **"Reload Config"** button that parses, validates (reporting exact definition and property errors), and hot-swaps rules into the running engine **without interrupting the simulation**, preserving unaffected playing instances, quota counters, cooldowns, and active disturbances—and retaining the last valid configuration if validation fails.
3. **Save / Load & Time-Acceleration Flow**:
   - Sleeping, pausing, accelerating simulation time, or reloading a saved session persists scheduling window targets, quota counters, cooldowns, pending delayed reactions, disturbance recovery timestamps, weather rain-accumulation history, and audio preferences. Time acceleration and backward clock jumps never cause burst-playback of missed wildlife calls.

### Visual Identity & Theme (Diagnostics Overlay)

- **Aesthetic Direction**: Utilitarian Baltic field-recorder instrument panel harmonizing directly with the existing forest survival HUD—calm, high-legibility dark woodland-slate surfaces with subtle hairline dividers and zero visual noise when collapsed.
- **Color Palette & Mood** *(60-30-10 discipline, zero `backdrop-filter` over WebGL to preserve software WebGL frame pacing)*:
  - *60% Dominant Neutral Surface*: Deep forest charcoal (`rgba(11, 17, 13, 0.94)`) with crisp high-contrast primary text (`#e8efe7`).
  - *30% Structural Surfaces*: Elevated table rows and tabbed panels (`rgba(20, 30, 23, 0.96)`) separated by subtle hairlines (`rgba(163, 198, 160, 0.16)`) and muted secondary labels (`#93a892`).
  - *10% Accent Budget*: Lichen sage (`#6fa874`) for active tabs and valid reload confirmation; warm amber (`#d8a14c`) for suppressed/virtualized warnings; muted crimson (`#cf6357`) for validation errors—always paired with explicit text labels (never color alone).
- **Typography & Hierarchy**:
  - Inherits the simulator's existing display/body font pairing for clean title-case headers and plain-language labels (zero code-comment prefixes or all-caps shouting).
  - Strictly uses monospace tabular numerals (`font-mono tabular-nums`) for all timings, dB/gain values, coordinates, distances, quotas, and cooldowns.
- **Component Styling & Layout**:
  - Docked right-hand inspector drawer (`width: min(520px, 44vw)`, full viewport height minus HUD margins, single elevation level) keeping the left 3D viewport unobstructed so the user can watch doors open, rain fall, and wildlife react while inspecting audio telemetry.
  - Zero static pill enclosures around metadata (uses quiet inline text separated by `·` and `/`), single-line segmented tab buttons (`whitespace-nowrap shrink-0`), and zero decorative pulsing dots.
- **Interactive Feedback & Motion**:
  - Fast compositor-only panel reveal (`transform` + `opacity`, `<= 180ms`), immediate validation summary banner upon config reload (showing accepted diff count or exact definition/property error list), and clean empty states when no disturbances or voices are active.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Canonical Validated TypeScript/JSON Schema over Runtime YAML Parsing**
  - *Chosen Approach*: Define one strongly typed canonical schema with a dedicated runtime validator supporting unit normalization (`ms`/`s`/`m`/`h`, `m`), inheritance merging (materials, acoustics, profiles) with explicit array override/removal semantics, cross-reference checks (buses, assets, sound IDs, cycles), and JSON hot-reload overlays.
  - *Why*: Matches the spec's explicit allowance ("YAML examples express semantics, not a mandatory parser"), avoids shipping an extra YAML parser dependency in the browser bundle, gives compile-time safety for shipped configs, and enables instant browser-side config hot-reload.
  - *Alternatives Considered*: Adding a third-party YAML library and custom Vite plugin—adds bundle/build complexity with no functional advantage over validated TS/JSON modules.

- **Decision 2 — Hybrid Asset Pipeline (Real MP3 Recordings + Procedural Web Audio Fallbacks)**
  - *Chosen Approach*: Route all sound definitions through an asset resolver supporting weighted alternatives, shuffle bags, preloading for short frequent assets, lazy decoding/streaming for long assets (like the ~2 MB gait and rain tracks), and explicit procedural synth generators as declared fallbacks when an asset has no MP3 recording yet. Missing or corrupted MP3 files degrade gracefully with structured diagnostic warnings instead of throwing.
  - *Why*: Immediately brings all 14 real MP3 files to life while preserving rich wind, clean rain, insect, cricket, breathing, and tent-canvas acoustics until additional Appendix A recordings are supplied.
  - *Alternatives Considered*: File-only playback (would silence wind, clean rain, crickets, insects, and indoor/tent rain layers) or synth-only playback (would ignore the 14 real MP3 assets).

- **Decision 3 — Handling Embedded Thunder in the Existing Rain Recording**
  - *Chosen Approach*: Mark the existing rain-and-thunder recording with an `embedded_thunder` trait in config. By default, clean procedural rain layers drive weather rain while authoritative lightning/storm events trigger the separate spatialized thunderclap recording—preventing duplicate/overlapping thunder. Designers can optionally opt into the combined background track via config, which automatically suppresses independent stochastic thunder while active.
  - *Why*: Directly satisfies Appendix A and §16 ("avoid combining embedded and independently generated thunder unintentionally").

- **Decision 4 — Strict Separation of Simulation Clock vs. Real Elapsed Clock**
  - *Chosen Approach*: Drive ecological windows (including midnight-crossing windows like `23:00–04:00`), quotas, cooldowns, weather rain-accumulation history, and disturbance recovery on the **simulation clock**; drive audio fades, loop crossfades, perceptual acoustic smoothing, and playback lifecycles on the **real elapsed clock**. Time acceleration skips missed occurrences cleanly without burst-playing, and backward clock jumps reconcile timestamps safely.
  - *Why*: Guarantees realistic sleep/time-skip behavior, frame-rate-independent Poisson stochastic rates, and deterministic unit testing.

- **Decision 5 — Continuous Structural Acoustics Model Built on Existing Shelter Geometry**
  - *Chosen Approach*: Extend the simulator's existing authoritative shelter/footprint geometry and door open-state directly (zero duplicated world state) with acoustic profiles separating **enclosure coefficient (0–1)**, **roof coverage**, **wall/roof material**, and **dynamic door/window portals** from structural age/decay. Exterior ambience attenuates and low-pass filters per category (e.g., loud thunder remains muffled indoors while gentle birdsong fades nearly to silence), whereas local player footsteps, breathing, and interior creaks bypass exterior attenuation.
  - *Why*: Satisfies §11 without duplicating building geometry or breaking existing shelter/rain-occlusion logic.

- **Decision 6 — Logically Separated, Individually Deliverable Plans in Documentation**
  - *Chosen Approach*: Decompose the full specification into **10 self-contained, sequentially deliverable phase documents** under the documentation directory (with a master index tracking status, interfaces, and dependencies). Each phase ends with passing automated tests, updated docs, and a fully working simulator.
  - *Why*: Keeps a large architectural transformation verifiable, reviewable, and incrementally shippable without monolithic risk.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### System Architecture & Data Flow

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                 AUTHORITATIVE SIMULATOR WORLD (Existing Systems)             │
│  Time/Astronomy · Weather & Sky · Terrain/Biomes/Bog · ShelterGeometry &     │
│  Doors · Player Locomotion & Survival Physiology · Interactive World Props   │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │ (Read-only Context Adapter + Typed Events)
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     SOUNDSCAPE ENGINE CORE (Framework-Agnostic)              │
│                                                                              │
│  ┌─────────────────────────┐       ┌──────────────────────────────────────┐  │
│  │ Validated Config Store  │──────▶│ Sound, Material, Biome & Bus Registry│  │
│  │ (Schema + Inheritance + │       │ (Weighted variants, shuffle bags,    │  │
│  │  Safe Hot Reload)       │       │  hybrid MP3 / procedural references) │  │
│  └─────────────────────────┘       └──────────────────┬───────────────────┘  │
│                                                       │                      │
│  ┌──────────────────┐   ┌───────────────────────┐   ┌─▼───────────────────┐  │
│  │ Typed Event Bus  │──▶│ Condition Evaluator   │──▶│ Reaction & Chain    │  │
│  │ (Dedupe, Causal  │   │ (all/any/not, ranges, │   │ Engine (Max depth,  │  │
│  │  Trace, Envelope)│   │  midnight windows,    │   │  delayed events,    │  │
│  └────────┬─────────┘   │  feature distance,    │   │  atomic quotas)     │  │
│           │             │  hysteresis, history) │   └─────────┬───────────┘  │
│           │             └──────────┬────────────┘             │              │
│           │                        ▼                          │              │
│           │             ┌───────────────────────┐             │              │
│           │             │ Dual-Clock Scheduler  │◀────────────┘              │
│           │             │ (Sim-clock windows,   │                            │
│           │             │  quotas, cooldowns,   │                            │
│           │             │  Poisson stochastic)  │                            │
│           │             └──────────┬────────────┘                            │
│           ▼                        ▼                                         │
│  ┌──────────────────┐   ┌───────────────────────┐   ┌─────────────────────┐  │
│  │ Spatial          │   │ Acoustic Environment  │   │ Spatial Source &    │  │
│  │ Disturbance Mgr  │   │ Manager (Enclosure,   │   │ Instance Lifecycle  │  │
│  │ (Origin, radius, │   │  Portals, Roof Rain,  │   │ Manager (States,    │  │
│  │  suppression,    │   │  Exterior vs Local    │   │  Concurrency,       │  │
│  │  recovery, excl.)│   │  Transmission)        │   │  Virtualisation)    │  │
│  └────────┬─────────┘   └──────────┬────────────┘   └──────────┬──────────┘  │
│           └────────────────────────┴───────────────────────────┘             │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Hierarchical Bus Mixer (master -> environment/player/objects/music/ui) │  │
│  │ Gains · Mute · Ducking · Filters · Fade Reversal · Master Limiter      │  │
│  └───────────────────────┬──────────────────────────────┬─────────────────┘  │
└──────────────────────────┼──────────────────────────────┼────────────────────┘
                           │                              │
            ┌──────────────▼──────────────┐  ┌────────────▼───────────────────┐
            │ Replaceable Audio Backend   │  │ Persistence & Live Diagnostics │
            │ · Web Audio Hybrid Backend  │  │ · Serializable Snapshot Store  │
            │   (MP3 decode/stream/cache  │  │ · F9 Diagnostics Overlay UI    │
            │   + HRTF Panner + Synth     │  │ · Live Config Reload + Audit   │
            │   fallbacks)                │  │ · Manual Trigger / Bus Mix     │
            │ · Deterministic Mock Backend│  └────────────────────────────────┘
            │   (Automated Test Suite)    │
            └─────────────────────────────┘
```

### Data Model & Core Contracts

- **Canonical Configuration Domains**: Engine budgets & voice/virtual limits; Hierarchical Bus tree (`master`, `environment.{ambience,weather.{rain,wind,thunder},water,wildlife.{birds,mammals,insects}}`, `player.{movement,breathing,vocalisation,equipment}`, `objects`, `weapons`, `music`, `ui`); Asset catalog (mapping all 14 real MP3 files + declared procedural synth fallbacks + preload/lazy/stream hints); Inheritable Material profiles (`wood` -> `wooden_floor` -> `decrepit_wooden_floor`, `wooden_boardwalk`, `forest_floor`, `gravel`, `grass`, `water`, `stone`); Acoustic structure profiles (outdoors, tent, decrepit hut, enclosed wooden house, enclosed stone house); Layered Biomes (blended composition across forest, thicket, village, bog/marsh, island, road); Playback Definitions; Event & Reaction rules; Disturbance profiles; Independent Music rules.
- **Unified Event Envelope**: Every player action, environmental state transition, and stochastic trigger emits a typed `SimulationEvent<T>` containing `id`, `type`, `origin`, `simulationTimestamp`, optional `position` / `sourceEntityId` / `targetEntityId` / `intensity`, `correlationId`, `causationId`, `chainDepth`, and typed `payload`, with deduplication and bounded reaction chain depth.
- **Explicit Instance Lifecycle**: `scheduled -> starting (fading in) -> playing <-> paused / virtualised -> stopping (fading out) -> completed`, supporting fade reversal when a fading-out layer becomes eligible again, loop-position preservation, atomic quota reservation/release, concurrency policies (`allow`, `reject_new`, `restart`, `replace_oldest`, `replace_quietest`, `replace_lowest_priority`, `queue`, `virtualise`), and expiration of stale queued transients.
- **Persistence Snapshot**: Versioned JSON state capturing active scheduling window targets, quota counters, cooldown timestamps, pending delayed reactions, active spatial disturbances & recovery timestamps, weather rain-accumulation history, deterministic PRNG state, and user audio/music preferences—reconciling pauses, time jumps, and backward clock movements without replaying stale transients.

### Logically Separated, Individually Deliverable Roadmap (10 Standalone Documents in `docs/`)

Upon approval, we will create an index plus **10 logically separated, individually deliverable phase plan documents** inside the documentation directory—each with its own scope, interfaces, configuration contracts, acceptance criteria, and automated test targets—and execute them in order so every phase leaves the simulator working and tested:

1. **Phase 01 — Core Architecture, Canonical Config Schema, Validator & Bus Mixer**:
   - Injectable clocks (simulation + real), seeded RNG, canonical config schema with inheritance & unit parsing, validator with detailed file/definition/property error reporting, hierarchical audio bus tree with master limiting, replaceable Audio Backend interface + Mock Backend, and hybrid Web Audio Asset Loader (integrating the 14 MP3s + procedural fallbacks + graceful missing-asset handling).
2. **Phase 02 — Typed Event Bus, Condition Evaluator & Reaction Chains**:
   - Unified `SimulationEvent<T>` bus with deduplication and causation tracing; declarative condition engine (`all`, `any`, `not`, ranges, midnight-crossing windows, geographical feature proximity, weather history, duration-of-truth, hysteresis, listener/source/trigger context); event reaction engine with delays, probabilities, atomic quota reservation, and chain-depth/total-event caps.
3. **Phase 03 — Dual-Clock Scheduler, Quotas, Cooldowns & Instance Lifecycle**:
   - Scheduled, stochastic (frame-rate-independent Poisson), continuous, repeating, and state-driven playback; daily/midnight-crossing window target sampling; multi-scope quotas and cooldowns that persist across biome/structure transitions; concurrency policies, fade reversal, transient expiration, and no-burst time acceleration / backward-clock reconciliation.
4. **Phase 04 — World Context Provider, Structural Acoustics & Spatial Emitters**:
   - Read-only adapter exposing authoritative simulator time, sun/moon elevation & moon phase, weather & rain history, blended biome weights, real bog/water/village/road feature distances, and `ShelterGeometry` structures + dynamic door states; continuous enclosure coefficient & opening portal transmission; HRTF world-anchored, moving, linear, area, and listener-relative emitters with virtualization.
5. **Phase 05 — Player Movement, Material Inheritance, Physiology & Object Interactions**:
   - Distance/gait-synchronized footsteps across inherited material profiles (`forest_floor`, `gravel`, `wooden_boardwalk`, `wooden_floor`, `decrepit_wooden_floor`, `water`) treating long MP3 step tracks as seamless gait loops that fade cleanly on stop; state-driven exertion breathing with gradual recovery, grunts, and rain-jacket/clothing rustle; physical-outcome object interactions (surviving impact vs. actual crate/wood break, correlated kick/impact deduplication, decrepit vs. intact door creaks).
6. **Phase 06 — Weather Layers, Rain History, Post-Rain Dripping & Water Emitters**:
   - Layered wind/foliage/opening acoustics, surface-aware rain (exterior vs. roof/tent canvas), embedded-thunder safeguard for `rain-and-thunder-background.mp3` vs. spatialized `thunder-clap-close.mp3`, authoritative weather wetness & rain-accumulation window enabling post-rain roof dripping/trickling only after eligible rainfall, and distributed bog/waterfront emitters.
7. **Phase 07 — Layered Biomes & Shipped Wildlife Ecological Rules**:
   - Multi-layer blended biome ambience without duplicate shared layers; full declarative implementation of all shipped wildlife rules & MP3s: **Woodpecker** (`05:00–08:00` & `16:00–19:00`, shared close/distant cap of 0–3/window), **Nighttime Bird Escape** (night + forest + clear + walking, max 2/night, 1h min interval, reactive step/branch trigger), **Wolf Howl** (`23:00–04:00`, clear, moon above horizon, 1–2/night, 1h interval, 200–600 m), **Tawny Owl**, **Red Fox**, **Geographically Restricted Waterside Splash**, plus procedural birds, crickets, and bog insects.
8. **Phase 08 — Spatial Disturbances, Exemptions & Independent Recovery**:
   - World-space disturbance spheres (thunder, smashing crates, breaking logs, loud actions, weapon-fire ready) with linear distance attenuation, per-bus/tag suppression gain & event-generation blocking (never consuming suppressed quotas), explicit exemptions (player, weather, water, UI, startled bird escape), overlap policies (`strongest_and_longest`, reset, extend, accumulate), independent per-guild recovery delays/fades, and dynamic walk-away/return suppression.
9. **Phase 09 — Independent Music System & Persistence Lifecycle**:
   - Non-spatial music scheduler unaffected by environmental attenuation, with independent enable switch & volume, shuffle-bag selection, configurable silence pauses, crossfades, and condition-loss fade-out; full serializable state persistence (quotas, cooldowns, pending delayed reactions, disturbances, weather history, RNG, preferences) surviving pause/resume, time jumps, teleportation, and reload without replaying completed transients.
10. **Phase 10 — Keyboard-Activated Diagnostics Overlay (`F9`), Live Config Hot-Reload & Mandatory Verification Suite**:
    - Non-blocking `F9` Soundscape Diagnostics Overlay with Active/Virtual Voices, Rules/Quotas/Rejection Reasons, Acoustics/Disturbances, Bus Mixer & Manual Audition Triggers, and zero-interruption Live Config Reload (with validation diagnostics & automatic rollback on invalid config); full automated test suite covering every mandatory scenario in spec §28 plus final documentation of schema, extension guide, unsupported backend features (e.g., native hardware Doppler/convolution limitations), and remaining Appendix A asset priorities.

### Interactive Component & State Mapping (Diagnostics Overlay)

- **`F9` Global Shortcut**: Toggles Diagnostics Overlay visibility cleanly without pausing the simulation; exits pointer lock while open and restores gameplay input cleanly on close (`F9` or `Esc`).
- **Live Config Reload Action**: Accepts edited JSON/config override payload -> runs canonical validator -> if valid, commits atomic config swap while keeping unaffected playing instances, quota counters, cooldowns, and active disturbances intact; if invalid, displays exact definition/property error diagnostics and retains last valid configuration.
- **Bus Mixer & Music Controls**: Each bus slider/mute toggle and the independent Music switch directly mutate mixer bus state and persist user audio preferences immediately (disabling music never alters environmental buses).
- **Manual Event / Sound Audition Panel**: Lets testers fire any registered `SimulationEvent` (e.g., `player.weapon.fire` disturbance, `weather.thunder`, `wildlife.bird.escape`, `object.door.open`) or audition any sound definition directly, immediately updating the Causation Chain, Active Voices, and Disturbance views.
- **Telemetry Subscription**: Throttled 4 Hz snapshot reader from the engine's Diagnostics collector so inspecting real-time soundscape state adds negligible CPU overhead and zero per-frame allocations to the 3D render loop.
