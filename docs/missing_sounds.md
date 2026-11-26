# Missing sound recordings

## Currently procedural sounds

There are **16 assets still generated procedurally**, verified against `procedural: true` in [assets.ts](../src/config/soundscape/assets.ts). These are the remaining recording slots. The tables list suggested replacement paths relative to `src/assets/sounds/`, with the intended sound and playback format.

Recorded replacements now use sample filenames without extensions as asset IDs; remaining synthesized assets retain `proc_` IDs. Only assets explicitly marked `procedural: true` are included below.

### High priority

| Asset ID | Suggested recording path | Description |
| --- | --- | --- |
| `proc_breathing_exhausted` | `player/breathing/breathing-exhausted-loop.mp3` | Seamless loop; ragged panting when stamina is depleted or fatigue is high. |
| `proc_hollow_crate_impact` | `objects/crates/crate-impact-hollow-01.mp3` | Short one-shot (~0.4s); resonant hollow wooden box knock when a breakable crate does not break. |

### Medium priority

| Asset ID | Suggested recording path | Description |
| --- | --- | --- |
| `proc_room_tone` | `ambience/indoor/indoor-room-tone.mp3` | Seamless loop; quiet enclosed cabin/building interior stillness. |
| `proc_rain_roof` | `weather/rain/rain-on-roof-loop.mp3` | Seamless loop; muffled rain pattering/drumming on a wooden roof heard from indoors. |
| `proc_cricket` | `wildlife/insects/field-cricket-chirp.mp3` | Short one-shot (~1–1.5s); dry afternoon/evening grass cricket chirps. |
| `proc_insect_buzz` | `wildlife/insects/bog-mosquito-buzz.mp3` | Short one-shot (~1.2s); close-range mosquito/gnat buzz for swamp, marsh, and thicket. |
| `proc_floorboard_creak` | `objects/wood/floorboard-creak-01.mp3` | Short one-shot (~0.6s); aged wooden plank groan triggered occasionally when walking in decrepit buildings. |
| `proc_stone_impact` | `objects/stone/stone-impact-solid-01.mp3` | Short one-shot (~0.3s); sharp dry rock/stone impact clack. |
| `proc_metal_impact` | `objects/metal/metal-impact-solid-01.mp3` | Short one-shot (~0.4s); metallic clang with short natural ring. |
| `proc_intact_door` | `objects/doors/intact-door-open.mp3` | Short one-shot (~0.55s); solid, well-oiled wooden door latch click and swing (pitched down automatically on close, or add intact-door-close.mp3). |
| `proc_campfire_crackle` | `objects/fire/campfire-crackle-loop.mp3` | Seamless loop; close wood-fire crackle, ember pops, and gentle flame flutter. |
| `proc_clothing_rustle` | `player/clothing/clothing-rustle-01.mp3` | Short one-shot (~0.3s); canvas jacket and pack rustle on jump, land, or quick movement. |
| `proc_gunshot_crack` | `weapons/gunshot-crack.mp3` | One-shot (~0.9–1.5s); sharp outdoor rifle/shotgun crack with brief natural tail (no baked-in reverb). |

### Lower priority

| Asset ID | Suggested recording path | Description |
| --- | --- | --- |
| `proc_music_nordic_day` | `music/forest-day-01.mp3` | Music track (~1–3m); sparse daytime Nordic/Baltic acoustic atmosphere (e.g. kannel, acoustic guitar, soft pads). |
| `proc_music_forest_night` | `music/forest-night-01.mp3` | Music track (~1–3m); quiet, contemplative nocturnal ambient score. |
| `proc_ui_click` | `ui/ui-click.mp3` | Short transient (~0.15s); subtle tactile click for interface actions. |

`proc_intact_door` serves both `intact_door_open` and `intact_door_close`; closing currently reuses the same sound at a lower pitch. Separate open and close recordings can be added if desired. The two music assets serve the `forest_day_music` and `forest_night_music` profiles.

## Recording integration

Save edited MP3s in the structured folders listed above and update their `file` paths in [assets.ts](../src/config/soundscape/assets.ts), removing `procedural` and `proceduralKind` when replacing a generator. The loader matches MP3 files recursively by their configured relative paths. Keep duration metadata accurate: one-shot voice slots remain occupied for the full clip duration, adjusted for playback pitch, and decoded durations take precedence at runtime.

`src/assets/sounds/RAW/` contains editing source material and must remain untouched and uncommitted. It is excluded from Git, the audio loader, and production asset copies. The exerted-breathing WAV is skipped; its MP3 is configured instead.

Already recorded and wired: forest day/night ambience, marsh ambience, open/tree wind, clean/tent rain, roof drips, water splashes, songbirds, rest/walk/exerted breathing, wooden/grass footsteps, solid wood impacts, crate breaking, escaping birds, woodpeckers, owl, wolf, fox, forest/gravel/water walking, decrepit doors, wood cracks, thunder, and rain with embedded thunder.

Variants use weighted selection with consecutive repeats avoided: nine songbirds, four wooden footsteps, two grass footsteps, three distinct marsh loops, two crate-breaking clips, and two fox screeches. `ambience/marsh/marsh-ambience-2.mp3` is byte-identical to `marsh-ambience-02.mp3`; both files are preserved, but only the latter is configured to avoid weighting that recording twice.

The backend can also temporarily synthesize a fallback while a configured recording is loading or unavailable. That fallback does not make the recording a missing asset in the tables above.

## Additional future recordings

These are optional fidelity upgrades that currently use shared or approximated sounds, or are proposed additions. They are separate from the 16 procedural assets above.

- Individual footsteps, with walk/run/crouch variants: `player/footsteps/forest-floor-step-01.mp3`, `gravel-step-01.mp3`, `water-step-01.mp3`, `wooden-boardwalk-step-01.mp3`, `mud-step-01.mp3`, `stone-step-01.mp3`, and `snow-step-01.mp3` (all under `player/footsteps/`).
- Water and rain surfaces: `water/rivers/river-flow-loop.mp3`, `weather/rain/rain-on-foliage-loop.mp3`, `weather/rain/rain-on-water-loop.mp3`, and `weather/rain/rain-on-metal-loop.mp3`.
- Player and wildlife details: `player/vocalisations/grunt-01.mp3`, `player/vocalisations/cough-01.mp3`, and `wildlife/amphibians/marsh-frog-01.mp3`.
