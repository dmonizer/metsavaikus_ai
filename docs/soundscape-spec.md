# Immersive Nature Simulator — Soundscape Engine Specification

## 1. Objective

Implement a generic, extensible, configuration-driven, spatially aware soundscape engine. Produce a dynamic, natural, non-repetitive acoustic environment responsive to player actions, environmental conditions, simulation time, weather, geographical features, structures and stochastic events.

- Define sound-specific behaviour declaratively, not in hardcoded application logic.
- Allow new assets, definitions, materials, events and acoustic profiles without core changes wherever existing primitives suffice.
- Allow concurrent sounds without interruption unless explicitly configured.
- Default to smooth transitions; treat silence as intentional.
- Support spatial and non-spatial audio.
- Independently test scheduling, events, conditions and rendering.
- Reuse authoritative simulation state and existing systems rather than duplicating them.

## 2. Architecture

| Component | Responsibility |
|---|---|
| Event bus | Typed simulation events |
| Condition evaluator | Declarative eligibility rules |
| Scheduler | Timed, periodic and stochastic events |
| Sound registry | Definitions and asset resolution |
| Context provider | Authoritative simulation state |
| Disturbance manager | Spatial suppression and recovery |
| Acoustic environment manager | Indoor/outdoor acoustics, occlusion and propagation |
| Spatial source manager | Emitter positions and movement |
| Instance manager | Lifecycle and concurrency |
| Mixer | Buses, gain, filters and effects |
| Audio backend | Platform-specific rendering |
| Diagnostics | Inspection, monitoring and testing |

Keep the audio backend replaceable and independent of rule processing. Use shared validated configuration and injectable clock, RNG, context and spatial query interfaces.

## 3. Assets

Assets reside under `src/assets/sounds`. Suggested directories:

```text
ambience/{forest,meadow,marsh,indoor,insects}/
weather/{rain,wind,thunder}/
water/{rivers,streams,dripping}/
wildlife/{birds,mammals}/
player/{footsteps,breathing,clothing,vocalisations}/
objects/{doors,wood,crates,metal}/
weapons/
music/
ui/
```

Directory layout does not determine runtime behaviour. Support weighted alternatives, preloading short frequent sounds, lazy loading, streaming long assets, caching, unloading and graceful missing/invalid asset handling. Missing assets must produce diagnostics, not crash the simulator. Update references if existing files are moved.

## 4. Audio buses and mixing

```text
master
  environment
    ambience
    weather/{rain,wind,thunder}
    water
    wildlife/{birds,mammals,insects}
  player/{movement,breathing,vocalisation,equipment}
  objects
  weapons
  music
  ui
```

Support hierarchical gain, independent volume and mute, fades, concurrency limits, priority, suppression, recovery, ducking, filters, effects and configurable bypass of environmental attenuation. Prevent clipping; support master limiting where available. Bus membership must not determine whether an emitter is indoors or outdoors.

## 5. Context and conditions

Expose authoritative simulation date/time, acceleration, sunrise/sunset, sun/moon elevation and moon phase; weather type, precipitation, wind speed/direction, fog and weather history; geography, elevation, nearby features, biome composition, season, temperature and snow; player position/orientation, activity, speed, stamina and equipment; surface material, wetness and water depth; structure enclosure, openings, materials and condition; object mass, velocity, damage and breakability; active disturbances and user audio settings.

Conditions support `all`, `any`, `not`, equality, inequality, ranges, thresholds, membership, midnight-crossing time windows, distance to features/entities, historical state, duration of truth and hysteresis. Distinguish listener, source and triggering entity context. Allow registered condition evaluators. A distance-to-river condition means distance to the actual geographical feature, not an arbitrary coordinate.

## 6. Unified event system

All playback, including scheduled and continuous sound activation, uses common event-processing infrastructure. Continuous phenomena use persistent emitters and state changes, not repeated events every frame.

### 6.1 Player-induced events

| Event | Context |
|---|---|
| `player.step` | Surface, gait, speed, footwear, foot |
| `player.land`, `player.jump`, `player.slide` | Impact, movement, surface |
| `player.kick`, `player.throw` | Object, force, mass, material |
| `player.breathing.changed` | Stamina, exertion, intensity |
| `player.grunt`, `player.cough`, `player.vocalisation` | Type, state, intensity |
| `player.vegetation.contact` | Vegetation, speed |
| `player.water.enter`, `player.water.exit` | Depth, velocity |
| `player.weapon.fire` | Position, acoustic intensity |
| `player.activity.changed` | Previous/current activity |

### 6.2 Environment-induced events

| Event | Context |
|---|---|
| `weather.wind.changed` | Speed, direction, gust intensity |
| `weather.rain.started`, `weather.rain.changed`, `weather.rain.stopped` | Intensity, duration, accumulated rain |
| `weather.thunder` | Position, intensity, distance |
| `environment.water.flowing` | Flow rate, river/stream, position |
| `environment.water.dripping` | Recent rain, wetness, position |
| `environment.branch.break`, `environment.tree.fall` | Material, intensity, position |
| `environment.vegetation.rustle` | Wind, vegetation |
| `environment.biome.changed`, `environment.acoustics.changed` | Previous/current context |
| `object.impact`, `object.break` | Mass, velocity, material, actual outcome |
| `object.door.open`, `object.door.close` | Condition, material, movement speed |

### 6.3 Stochastic events

Examples: wildlife calls, branches cracking, gusts, occasional splashes and thunder if not already driven by lightning simulation. Support optional constraints on geographical proximity (e.g. within 100 m of a river), biome, activity, time, season, weather/history, astronomy, indoor/outdoor context, disturbances, other events, occurrence counts and cooldowns.

### 6.4 Event envelope

Illustrative interface; adapt to project language:

```typescript
interface SimulationEvent<T> {
  id: string;
  type: string;
  origin: "player" | "environment" | "stochastic";
  simulationTimestamp: number;
  position?: Vector3;
  sourceEntityId?: string;
  targetEntityId?: string;
  intensity?: number;
  correlationId?: string;
  causationId?: string;
  chainDepth: number;
  payload: T;
}
```

Use typed or validated payloads, event deduplication and causation tracing.

## 7. Event reactions

An event may trigger zero or more secondary events, sounds, disturbances or soundscape-local state changes. Support probability, optional random delay, conditions, trigger distance, cooldown, occurrence limits, inherited causation metadata and source position. Define whether conditions are evaluated when scheduled, when executed or both. Enforce maximum chain depth and total generated events per chain. Playback itself must not generate simulation events unless explicitly configured.

Example: a gunshot plays immediately, may trigger a delayed bird escape and activates a spatial disturbance. A stepped-on branch may likewise startle a bird. Exempt the escape reaction from ordinary wildlife suppression where configured.

## 8. Scheduling

Support event-triggered, scheduled, stochastic, continuous, repeating, state-driven and reactive playback. Parameters include active windows, occurrence target range sampled once per window, maximum occurrences, min/max intervals, event/window probability, stochastic rate, initial delay, finite or infinite repetitions, random pauses, cooldown and quota scopes, missed-event policy, condition-loss policy and persistence.

- Simulation clock: ecological schedules, quotas, weather history, disturbance recovery.
- Real elapsed clock: playback, fades and perceptual transitions. Explicit overrides permitted; all durations have documented clock domains.
- Use frame-rate-independent stochastic scheduling.
- Treat 23:00–04:00 as one window; separate daily windows have separate quotas.
- Scopes: global, player, region, biome instance, emitter or triggering entity. Periods: day, night, named window or rolling interval.
- Biome/structure transitions must not reset counters or cooldowns.
- Conditions take precedence over occurrence targets: actual playback may be zero.
- Do not burst-play missed sounds after time acceleration, pause or recovery.
- Define atomic quota reservation and release semantics for pending reactions; avoid double-counting the same event at reaction and playback stages. Count accepted occurrences consistently and document behaviour for virtualised or rejected playback.

## 9. Playback definitions

Illustrative YAML (normalize all examples into one validated schema during implementation):

```yaml
id: example_sound
bus: environment.wildlife.birds
assets:
  - file: wildlife/birds/example-1.mp3
    weight: 3
  - file: wildlife/birds/example-2.mp3
    weight: 1
playback:
  volume: [0.4, 0.8]
  pitch: [0.95, 1.05]
  loop:
    count: 1
    pause: [0s, 0s]
  fade_in: 300ms
  fade_out: 1500ms
  on_condition_lost: fade_out
  priority: 50
  max_instances: 2
  concurrency_policy: reject_new
  avoid_consecutive_repetition: true
spatial:
  mode: world
  attenuation: inverse_distance
  reference_distance: 5m
  maximum_distance: 150m
  occlusion: true
  environmental_acoustics: true
  source_position:
    relative_to: listener
    distance: [20m, 80m]
conditions: {}
limits: {}
```

Support weighted alternatives, shuffle bags, repetition avoidance, randomized gain/pitch/speed, seamless loops, loop offsets, optional overlap and pauses. Loop count means total plays (1 = once; infinite = indefinite). Condition-loss policies: finish, fade_out, crossfade, pause, explicitly configured stop_immediately. Default continuous layers to fade-out and transients to natural completion.

## 10. Spatial audio and geographical emitters

Support listener-relative, player-attached, world-point, moving entity, linear feature, area, volume and generated-point sources. Provide directional audio relative to orientation, attenuation, configurable audible range, motion, optional Doppler and occlusion. Generated world positions must remain fixed or follow their actual entity, not rotate or move with the listener.

Represent rivers, streams, waterfalls and other extended features with distributed emitters, nearby segments or blended area sources. Virtualise inaudible sources and retain logical state. Source-position generation must fail gracefully if constraints cannot be satisfied.

## 11. Indoor/outdoor acoustics

Do not use a binary indoor flag as the sole acoustic model. Define structural condition independently of enclosure. Support wall material/thickness, roof material/coverage, enclosure coefficient (0–1), doors/windows/openings, dynamic opening state, frequency-dependent transmission, room reverb, surface materials, shelter and acoustic connectivity to adjacent rooms and outdoors.

Illustrative exterior ambience linear gain defaults (not measured physical values):

| Structure | Gain |
|---|---:|
| Outdoors | 1.00 |
| Open-sided shelter | 0.80 |
| Decrepit house with partially missing roof | 0.55 |
| Enclosed wooden house | 0.15 |
| Solid enclosed stone house | 0.03 |

Make transmission configurable per category, frequency and structure. A decrepit but enclosed stone house may attenuate more than a new open-sided shelter.

Evaluate propagation between source and listener: outdoor-to-indoor, indoor-to-outdoor, same room, different rooms, separate buildings, openings and damaged structures. Opening/closing doors smoothly changes gain, filtering and reverb. Solid enclosed houses nearly silence outdoor ambience, but loud thunder may remain audible and muffled. Interior footsteps, breathing and local sounds are not attenuated merely because exterior sounds are.

Indoor-specific sources include room tone, floorboards, structural creaks, loose shutters, roof dripping, wind through openings and rain striking exposed surfaces. Rain on a roof is distinct from outdoor rainfall; a sheltered player may hear roof rain despite little external ambience. Support acoustic transitions and room/portal blending.

## 12. Material profiles

Use inheritable material profiles with object overrides. Support forest floor, gravel, soil, mud, grass, wood, stone, concrete, metal, glass, snow, ice and water, with appropriate footsteps, impacts, breaking, scraping, creaking, sliding or splashing.

Distinguish wooden boardwalks, solid wooden floors and decrepit wooden floors. Consider wetness, age, condition, impact velocity, mass and actual damage.

```yaml
materials:
  wood:
    impact: {sound: wood_impact}
    break: {sound: wood_break}
  wooden_floor:
    extends: wood
    footsteps:
      walk: wooden_floor_walk
      run: wooden_floor_run
      crouch: wooden_floor_crouch
  decrepit_wooden_floor:
    extends: wooden_floor
    additional_reactions:
      - event: player.step
        probability: 0.15
        sound: floorboard_creak
  wooden_boardwalk:
    extends: wood
    footsteps:
      walk: boardwalk_walk
      run: boardwalk_run
```

## 13. Movement audio

Synchronise footsteps with animation foot contacts or distance travelled, gait and speed, not a fixed independent timer. Support walking, running, sprinting, marching, crouching, jumping, landing, sliding, swimming and wading. Configure a gait/surface matrix for forest floor, gravel, wooden path, wooden floor, decrepit floor, stone, grass, mud, shallow water, snow and other surfaces. Missing combinations have explicit fallbacks (e.g. pitch/gain-adjusted walk sample).

Consider speed, acceleration, weight, equipment, footwear, wetness, depth, left/right foot, fatigue, slope, impact and vegetation. Stop generating steps when movement ceases; existing transients finish naturally. Long-form existing walking recordings must be treated as gait loops, not restarted on every footfall. Crossfade surface and gait transitions.

## 14. Player physiology

State-driven breathing must be independent of footsteps. Support resting, walking, exerted and exhausted states or continuous exertion mapping; configure gain, cadence, intensity, sample alternatives and transition duration. Breathing recovers gradually after running rather than instantly resetting. Support grunts, coughs, exertion vocalisations, clothing and equipment rustle with cooldowns and randomisation. Player-attached sources can still receive interior reverb and underwater filtering.

## 15. Object interactions

Support kicking, picking up, dropping, throwing, colliding, scraping, damage, breaking, opening and closing. Select sounds using physical outcome, not merely breakability:

| Outcome | Sound |
|---|---|
| Non-breakable wood/crate impacted | Solid impact |
| Breakable wood/crate remains intact | Hollow/fragile impact |
| Object actually breaks | Material-specific breaking sound |

Correlate kick/impact/break events to avoid duplicate playback. Apply minimum intensity and throttling to continuous physics collisions. Doors distinguish material, condition, movement speed, opening, closing, creaks and latches. A decrepit wooden door has a distinct profile.

## 16. Weather

### Wind

Continuously vary intensity with wind speed, gusts, direction, vegetation, shelter and structures. Layer open wind, wind through trees, rustling foliage, whistling openings, loose shutters and creaking structures. Optionally affect sound propagation by wind direction.

### Rain

Layer rain on soil, grass, foliage, water, roofs, windows, metal and exposed interiors. Rain intensity controls gain and optionally playback characteristics. Shelter affects direct rainfall separately from nearby surface impacts.

### Thunder

Use authoritative lightning/thunder events if available, including optional distance-based propagation delay. Otherwise generate stochastic thunder only under configured conditions (e.g. heavy rain). Avoid duplicating both authoritative and stochastic thunder.

```yaml
id: thunder_clap
trigger: {type: stochastic}
conditions:
  all:
    - weather.precipitation: rain
    - weather.intensity: {gte: 0.75}
schedule:
  interval: [3m, 15m]
  clock: simulation
playback:
  sound: thunder_clap_close
  volume: [0.5, 1.0]
spatial:
  mode: world
  spawn_distance: [100m, 1500m]
```

### Weather history and post-rain sounds

Use authoritative wetness, accumulated precipitation and last rain time where available; otherwise document a local approximation. Support dripping from roofs/trees, trickling from saturated ground, increased stream flow, wet footsteps and gradually disappearing puddles. Post-rain trickling must not occur without preceding rain.

```yaml
id: roof_water_trickling
trigger: {type: continuous}
conditions:
  all:
    - source.structure.has_roof: true
    - weather_history.last_rain: {within: 2h}
    - weather_history.accumulated_rain_mm: {gte: 1.0}
    - environment.surface_wetness: {gte: 0.25}
    - not: {weather.precipitation: rain}
playback:
  sound: water_trickling
  volume: [0.15, 0.5]
  loop: {count: infinite, pause: [2s, 15s]}
  fade_in: 3s
  fade_out: 10s
spatial:
  mode: world
  attach_to: structure.roof_drainage_point
```

Separate profiles may allow dripping during rain. Define the accumulation window explicitly.

## 17. Layered biome ambience

Biomes consist of independent layers (forest atmosphere, wind, rain, water, insects, birds, mammals, etc.), each with its own time/weather/season/proximity/activity/disturbance conditions. Blend nearby biome composition rather than switch abruptly based only on the ground beneath the player. Do not duplicate shared layers when neighbouring biomes reference the same definition. Support finite and indefinite loops with optional random pauses.

## 18. Disturbance and recovery

Disturbances are world-space events independent of the originating audio asset. Examples: gunshots, thunder, falling trees, breaking branches, vehicles and loud player actions.

Configure origin, radius, intensity, distance attenuation, targets (buses/tags/definitions), exceptions, activation delay, suppression gain, fade-out, recovery delay and fade, existing-instance effects, blocking new generation and overlap policy. Gain suppression and event-generation suppression are independent. Suppressed calls should not consume quotas when generation is blocked.

```yaml
id: gunshot_disturbance
trigger: {event: player.weapon.fire}
spatial: {origin: event.position, radius: 500m, attenuation: linear}
overlap_policy: strongest_and_longest
effects:
  - target: environment.wildlife.insects
    gain: 0
    block_new_events: true
    fade_out: 300ms
    recovery_delay: [30s, 90s]
    recovery_fade: 10s
  - target: environment.wildlife.birds
    gain: 0
    block_new_events: true
    fade_out: 500ms
    recovery_delay: [10m, 14m]
    recovery_fade: 30s
  - target: environment.wildlife.mammals
    gain: 0
    block_new_events: true
    fade_out: 1s
    recovery_delay: [20m, 30m]
    recovery_fade: 1m
exceptions:
  buses: [player, environment.weather, environment.water, ui]
  sounds: [bird_escaping_flight]
```

Moving away from a disturbed region restores unaffected wildlife gradually; returning before recovery restores suppression. Repeated disturbances support reset, extend, accumulate, strongest-wins or independent effects. Never burst-play missed events during recovery.

## 19. Audio processing

Support distance attenuation, low/high-pass filters, occlusion, reverb, directionality, spatial positioning, optional Doppler, dynamic gain and limiting where supported. Smooth parameter changes. Rate-limit and spatially cull expensive occlusion checks. Underwater audio requires appropriate filtering; avoid applying exterior attenuation indiscriminately to local sounds.

## 20. Music

Independent music switch and volume; eligibility by biome, time, weather, location, player activity and acoustic context. Support weighted, sequential, random or shuffle selection, repetition avoidance, configurable silence, finite/infinite looping, crossfades, optional ducking and explicit condition-loss behaviour. Music normally non-spatial and unaffected by environmental attenuation. Disabling it must not affect environmental sounds.

```yaml
id: forest_night_music
bus: music
trigger: {type: continuous}
conditions:
  all:
    - settings.music_enabled: true
    - listener.biome: forest
    - astronomy.is_night: true
    - weather.type: clear
assets:
  - {file: music/forest-night-1.mp3, weight: 1}
  - {file: music/forest-night-2.mp3, weight: 1}
playback:
  volume: [0.15, 0.25]
  selection: shuffle_bag
  loop: {count: infinite, pause: [2m, 8m]}
  fade_in: 8s
  fade_out: 8s
  crossfade: 5s
  on_condition_lost: fade_out
spatial: {mode: non_spatial, environmental_acoustics: false}
```

## 21. Initial assets and rules

| Existing asset | Behaviour |
|---|---|
| bird-escaping-flight.mp3 | Reactive wildlife event |
| footsteps-on-moss-and-breaking-twigs-in-forest.mp3 | Forest gait loop |
| red-fox-screech.mp3 | Stochastic wildlife |
| thunder-clap-close.mp3 | Weather event |
| walking-in-water.mp3 | Water gait loop |
| wolf-howl.mp3 | Restricted nocturnal event |
| woodpecker+distant.mp3 | Distant scheduled wildlife |
| decrepid-door-creaking.mp3 | Decrepit door interaction |
| rain-and-thunder-background.mp3 | Weather ambience loop |
| tawny-owl-hooting.mp3 | Stochastic nocturnal wildlife |
| two-wood-cracks.mp3 | Wood breaking / branch cracking |
| walking-on-gravel.mp3 | Gravel gait loop |
| wooden-crate-smash.mp3 | Crate destruction |
| woodpecker-drumming-close.mp3 | Nearby scheduled wildlife |

### Woodpecker

```yaml
id: woodpecker_drumming
bus: environment.wildlife.birds
trigger: {type: scheduled}
conditions:
  all:
    - source.biome: forest
    - time:
        windows: [["05:00", "08:00"], ["16:00", "19:00"]]
schedule:
  occurrences_per_window: [0, 3]
  clock: simulation
  quota_scope: player
  missed_occurrence: skip
assets:
  - file: wildlife/birds/woodpecker-drumming-close.mp3
playback:
  volume: [0.3, 0.8]
  pitch: [0.95, 1.05]
  fade_in: 200ms
  fade_out: 1s
  loop: {count: 1}
spatial: {mode: world, spawn_distance: [20m, 80m], maximum_distance: 200m}
```

Close/distant variants share a quota; never exceed three per window.

### Nighttime bird escape

```yaml
id: nighttime_bird_escape
bus: environment.wildlife.birds
trigger: {event: wildlife.bird.escape}
conditions:
  all:
    - astronomy.is_night: true
    - listener.biome: forest
    - weather.type: clear
    - player.activity: walking
limits:
  quota_period: night
  max_occurrences: 2
  min_interval: 1h
  scope: player
  clock: simulation
assets:
  - file: wildlife/birds/bird-escaping-flight.mp3
playback:
  volume: [0.4, 0.8]
  loop: {count: 1}
spatial: {mode: world, spawn_distance: [3m, 20m]}
tags: [startled_wildlife]
```

Generate via stochastic walking eligibility or configurable step/branch reactions (e.g. 3% per eligible step with 200–1500 ms delay). Use one shared nighttime quota and interval. Separate gunshot reactions may reuse the asset under independently configured conditions.

### Wolf howl

```yaml
id: wolf_howl
bus: environment.wildlife.mammals
trigger: {type: scheduled}
conditions:
  all:
    - time: {from: "23:00", to: "04:00"}
    - weather.type: clear
    - astronomy.moon_above_horizon: true
schedule:
  occurrences_per_window: [1, 2]
  quota_scope: player
  min_interval: 1h
  clock: simulation
  missed_occurrence: skip
assets:
  - file: wildlife/mammals/wolf-howl.mp3
playback:
  volume: [0.25, 0.65]
  pitch: [0.97, 1.03]
  fade_in: 500ms
  fade_out: 2s
spatial: {mode: world, spawn_distance: [200m, 600m], maximum_distance: 1000m}
```

Select one or two as the nightly maximum; actual count may be zero when conditions are not satisfied.

### Geographically restricted stochastic event

```yaml
id: occasional_riverside_splash
trigger: {type: stochastic}
conditions:
  all:
    - listener.distance_to_feature: {type: river, lte: 100m}
    - listener.biome: {in: [forest, meadow, marsh]}
    - player.activity: {in: [walking, stationary]}
    - weather.type: {in: [clear, cloudy, light_rain]}
schedule:
  interval: [5m, 30m]
  probability_per_attempt: 0.4
  clock: simulation
playback: {sound: distant_water_splash}
spatial:
  mode: world
  source_position:
    on_feature: river
    distance_from_listener: [10m, 100m]
```

## 22. Lifecycle

Explicit states: scheduled, starting/fading in, playing, paused, virtualised, stopping/fading out, completed. Support cancellation, natural completion, repetitions, disposal, pause/resume and fade reversal. If a fading-out source becomes eligible again, reverse its fade when possible rather than restarting. Preserve loop playback position where supported.

## 23. Concurrency

Default to no interruption. Support allow, reject_new, restart, replace_oldest, replace_quietest, replace_lowest_priority, queue and virtualise. Limits at global, bus, definition and emitter scopes. Replacement requires explicit permission. Queued transients expire; never play footsteps or impacts long after their originating action. Prefer rejecting/virtualising insignificant new sounds over interrupting important existing ones.

## 24. Configuration

Suggested layout under `src/config/soundscape/`:

```text
engine.yaml
buses.yaml
assets.yaml
materials/{surfaces,objects}.yaml
acoustics/{outdoor,buildings,underground}.yaml
biomes/{forest,meadow,marsh}.yaml
sounds/{wildlife,weather,water,movement,player,objects}.yaml
events/{player,environment,stochastic}.yaml
reactions/wildlife.yaml
disturbances/profiles.yaml
music/tracks.yaml
```

Follow project conventions. YAML examples express semantics, not a mandatory parser. Establish one canonical schema and validate all shipped examples. Detect duplicate IDs, unknown assets/references/buses, invalid ranges, durations, time windows, probabilities, conditions, cyclic inheritance and invalid reactions. Identify file, definition and property in errors. Define units, inheritance merge behaviour (including arrays and removal), defaults and rule precedence. Avoid a general-purpose scripting language. Missing assets may be explicit placeholders with warnings; invalid rule references should fail validation. Hot reload in development where practical; retain last valid config on failure and preserve unaffected instances, counters and disturbances.

## 25. Persistence and simulation lifecycle

Persist scheduling windows/targets, counters, cooldowns, pending delayed events, disturbances/recovery times, emitter identities, local weather history, RNG state, preferences and applicable music/ambience state. Handle pause/resume, acceleration, time jumps, teleportation, world reload and respawn. Do not replay completed transients on load. Reconcile backward clock movement without duplicated events or invalid cooldowns.

## 26. Performance

Support thousands of logical sources without rendering or decoding all of them. Use spatial indexing or existing world queries, virtualisation, scheduled evaluations and event-driven updates. Configure budgets for voices, virtual sources, pending events, occlusion queries, asset memory and loading. Clean up completed instances, expired events/disturbances and unloaded entities. Avoid blocking simulation/rendering with audio loading or decoding. Avoid premature optimisation while retaining scalability.

## 27. Diagnostics

Provide a debug mode showing active/virtual sounds, positions, volumes, durations, next scheduled events, quota/cooldown state, reasons for eligibility/rejection, active disturbances, recovery times, acoustic enclosure/transmission, biome layers, event causation chains, resource usage and validation errors. Where practical provide manual event/sound triggering, context/time controls, bus auditioning and configuration hot reload.

## 28. Automated testing

Inject simulation and real-time clocks, seeded RNG, context provider, spatial queries and mock audio backend. Record playback, fades, gains, filters, movement and disposal. Verify successful playback and correct prevention.

Mandatory scenarios:

- Midnight-crossing and multiple daily windows; occurrence limits and minimum intervals; biome re-entry; condition changes during delays; shared variant quotas.
- Time acceleration without bursts; save/load; deterministic RNG; frame-rate-independent stochastic rates; backward time jumps.
- Smooth indoor transitions; partially missing roof versus solid enclosure; opening doors; local footsteps unaffected by exterior gain; source/listener orientation.
- Surface/gait changes; movement stops; fatigue recovery; long gait loops not restarted per step.
- Breakable objects surviving impact versus actual breakage; correlated physics events without duplicates.
- Post-rain dripping after eligible rain, no dripping without preceding rain; river distance constraints; no duplicated thunder.
- Spatial suppression, exceptions, overlapping disturbances, independent recovery, departure and return to disturbed region.
- Reaction chain protection; concurrent playback without interruption; resource exhaustion policies; expired queued transients.
- Music disabled independently; missing assets; valid and invalid configuration reload; resource disposal.

## 29. Implementation sequence

1. Inspect existing architecture, backend, state and event mechanisms.
2. Core configuration, registry, buses and lifecycle.
3. Typed events, conditions, reactions and delayed events.
4. Scheduling, time windows, stochastic rates, quotas and cooldowns.
5. Player movement, surfaces, physiology and interactions.
6. Weather, water, wildlife and layered biomes.
7. Spatial emitters, attenuation and structural acoustics.
8. Disturbances, exceptions and recovery.
9. Independent music and transitions.
10. Persistence, performance, diagnostics and comprehensive tests.

Each phase must leave a functioning simulator and include tests and documentation.

## 30. Definition of done

Inspect the existing codebase first. Reuse existing event, world, physics, configuration and audio systems. Do not introduce unnecessary dependencies, unrelated refactoring or duplicate authoritative state. Prefer composition, clear interfaces and dependency injection.

Complete when all mandatory behaviours are implemented, existing assets integrated, missing assets gracefully handled, new sounds/materials/biomes/structures/disturbances configurable without core changes, unified events working, dynamic enclosure acoustics working, scheduling constraints reliably enforced, overlap and smooth transitions correct, spatial consistency maintained, state survives save/load, tests pass, and schema/extension mechanisms are documented. Explicitly document unsupported backend features and remaining assets; do not claim unsupported features are implemented.

## Appendix A — Additional assets

High priority: individual footsteps on forest floor, gravel, wood, grass, stone and water; walk/run/march variants; clean rain without thunder; day/night forest ambience; light/strong wind and gusts; river/stream/trickling loops; solid wood and non-breaking crate impacts; normal/exerted/exhausted breathing.

Medium priority: floorboard creaks; rain on wood/metal/foliage/water; room tone; insects/frogs; wildlife variants; grunts, clothing and equipment rustle; normal door sounds.

Lower priority: snow/ice and additional surfaces; music tracks.

`rain-and-thunder-background.mp3` contains embedded thunder, which cannot be independently scheduled, positioned or suppressed. Prefer clean rain plus separate thunder; avoid combining embedded and independently generated thunder unintentionally. Long-form footstep recordings are less flexible than individual samples.

## Appendix B — Assumptions and architectural decisions

The existing technology stack, audio backend, physics and world representation have not been inspected. This specification is framework-independent. Numerical examples are configurable starting values, not measured acoustic data, except explicit user requirements (woodpecker windows and cap, nighttime bird cap and interval, wolf window and cap, requested recovery ranges and geographical constraints).

Separate simulation and real clocks; make disturbances spatial; distinguish enclosure from structural age; unify all event origins; retain world emitter positions; inherit material profiles; use persistent sources for continuous phenomena; make random scheduling frame-rate independent; handle missing assets gracefully; never override eligibility to satisfy quotas; select break sounds from actual physical outcomes.
