# Phase 01 — Core Architecture, Canonical Config Schema, Validator & Bus Mixer

## Objective
Establish the framework-agnostic foundation: injectable clocks (`SimulationClock`, `RealClock`), deterministic seeded RNG, canonical configuration schema with inheritance and unit parsing, runtime structural/semantic validator, hierarchical audio bus mixer, replaceable `AudioBackend` contract with `MockAudioBackend`, and hybrid Web Audio asset loader/synthesizer.

## Interfaces & Contracts
- `SimulationClock` / `RealClock`: Decoupled time sources enabling deterministic tests, time acceleration, pause, and backward-clock reconciliation.
- `SeededRng`: Serializable Mulberry32 PRNG (`getState()`, `setState()`).
- `validateSoundscapeConfig(config)`: Normalizes units (`ms`, `s`, `m`, `h`), resolves `extends` inheritance with cycle detection and `$remove` overrides, validates cross-references (buses, assets, sound IDs, cycles), and emits structured `{ file, definition, property, message }` errors.
- `AudioBusMixer`: Hierarchical tree (`master` -> `environment.{ambience, weather.{rain, wind, thunder}, water, wildlife.{birds, mammals, insects}}`, `player.{movement, breathing, vocalisation, equipment}`, `objects`, `weapons`, `music`, `ui`), gain/mute, ducking, attenuation bypass, and master limiter.
- `AudioBackend`: Replaceable backend interface (`WebAudioHybridBackend` + `MockAudioBackend`).

## Verification Criteria
- Duplicate IDs, unknown buses/assets, invalid time windows/probabilities, and cyclic inheritance produce explicit diagnostics identifying file, definition, and property.
- Missing MP3 assets log structured warnings and fall back gracefully without crashing.
- Master bus never exceeds safe headroom and music bus operates independently of environmental attenuation.
