# Sound recording inventory

Recordings live in the structured folders below, under `src/assets/sounds/`. The loader matches MP3 files recursively by their configured relative paths in `src/config/soundscape/assets.ts`. `RAW/` is excluded from Git, the audio loader, and production asset copies.

## Current integration

The original inventory of 32 procedural slots is preserved below. Sixteen slots are now configured for recordings; the other 16 still use procedural synthesis. Existing `proc_*` asset IDs are retained so sound rules and saved configurations keep working.

Configured recordings cover forest day/night, marsh, open/tree wind, clean/tent rain, roof drips, water splashes, songbirds, rest/walk/exerted breathing, wooden/grass footsteps, and solid wood impacts.

- Exerted breathing uses `player/breathing/breathing-exerted-loop.mp3`. The WAV is skipped and is not committed.
- Variants are selected by the existing weighted selection with consecutive repeats avoided: nine songbirds, four wooden footsteps, two grass footsteps, three distinct marsh loops, two crate-breaking recordings, and two red fox screeches.
- `ambience/marsh/marsh-ambience-2.mp3` is byte-identical to `marsh-ambience-02.mp3`. Both files are preserved, but only the latter is configured to avoid weighting the same recording twice.
- One-shot voice slots remain occupied for the full recording duration, adjusted for playback pitch. Duration metadata matches the supplied recordings; decoded clip durations take precedence at runtime.
- Recording filenames retain their supplied zero-padded numbers (`-01`, `-02`, etc.), even where the original suggestions below use `-1`.
- Still procedural: exhausted breathing, hollow crate impact, room tone, roof rain, crickets, insect buzz, floorboard creaks, stone/metal impacts, intact doors, campfire, clothing, gunshot, both music tracks, and UI click.

## Original recording checklist

Suggested paths and descriptions for the original slots and Appendix A upgrades follow.

High Priority (Core Ambience, Weather, Footsteps, Impacts & Breathing)
Suggested File Name	Asset ID (assets.ts)	Description
ambience/forest/forest-day-ambience.mp3	proc_forest_day	Seamless loop; calm daytime Baltic pine/birch air and soft distant foliage hush (no close loud birds).
ambience/forest/forest-night-ambience.mp3	proc_forest_night	Seamless loop; cool, still nocturnal forest atmosphere with subtle deep air movement.
ambience/marsh/marsh-ambience.mp3	proc_marsh_ambience	Seamless loop; damp bog/reedbed ambience with gentle reed rustle and distant marsh air.
weather/wind/wind-open-loop.mp3	proc_wind_open	Seamless loop; clean wind across open meadow/road without microphone clipping.
weather/wind/wind-forest-trees-loop.mp3	proc_wind_trees	Seamless loop; stronger wind rushing and swaying through pine needles and tree canopy.
weather/rain/rain-clean-loop.mp3	proc_rain_clean	Seamless loop; steady outdoor rainfall without any thunder (so thunder stays separately spatialized).
water/dripping/roof-water-trickling-loop.mp3	proc_water_trickling	Seamless loop; post-rain water dripping from roof eaves and trickling onto damp ground.
water/rivers/distant-water-splash.mp3	proc_water_splash	One-shot (1–2s); fish jump or single water splash heard across a river or bog pond.
player/footsteps/wooden-floor-step-1.mp3	proc_wooden_floor_step	Short transient (~0.3s); single dry boot step on solid indoor wooden planks.
player/footsteps/grass-step-1.mp3	proc_grass_step	Short transient (~0.25s); single soft footfall on grassy meadow ground.
player/breathing/breathing-rest-loop.mp3	proc_breathing_rest	Seamless loop; quiet, slow relaxed breathing at rest.
player/breathing/breathing-walk-loop.mp3	proc_breathing_walk	Seamless loop; steady, lightly audible breathing while walking.
player/breathing/breathing-exerted-loop.mp3	proc_breathing_exerted	Seamless loop; heavier, faster breathing while running, sprinting, or swimming.
player/breathing/breathing-exhausted-loop.mp3	proc_breathing_exhausted	Seamless loop; ragged panting when stamina is depleted or fatigue is high.
objects/wood/wood-impact-solid-1.mp3	proc_wood_impact	Short one-shot (~0.35s); dense, solid thud when hitting non-breakable timber or logs.
objects/crates/crate-impact-hollow-1.mp3	proc_hollow_crate_impact	Short one-shot (~0.4s); resonant hollow wooden box knock when a breakable crate does not break.


Medium Priority (Structures, Surfaces, Wildlife, Objects & Player Gear)
Suggested File Name	Asset ID (assets.ts)	Description
ambience/indoor/indoor-room-tone.mp3	proc_room_tone	Seamless loop; quiet enclosed cabin/building interior stillness.
weather/rain/rain-on-roof-loop.mp3	proc_rain_roof	Seamless loop; muffled rain pattering/drumming on a wooden roof heard from indoors.
weather/rain/rain-on-tent-loop.mp3	proc_rain_tent	Seamless loop; crisp, close-range raindrops hitting taut canvas fabric.
wildlife/birds/songbird-chirp-1.mp3	proc_bird_chirp	Short one-shot (~0.8–1.5s); Baltic daytime songbird calls (e.g. chaffinch, robin, warbler).
wildlife/insects/field-cricket-chirp.mp3	proc_cricket	Short one-shot (~1–1.5s); dry afternoon/evening grass cricket chirps.
wildlife/insects/bog-mosquito-buzz.mp3	proc_insect_buzz	Short one-shot (~1.2s); close-range mosquito/gnat buzz for swamp, marsh, and thicket.
objects/wood/floorboard-creak-1.mp3	proc_floorboard_creak	Short one-shot (~0.6s); aged wooden plank groan triggered occasionally when walking in decrepit buildings.
objects/stone/stone-impact-solid-1.mp3	proc_stone_impact	Short one-shot (~0.3s); sharp dry rock/stone impact clack.
objects/metal/metal-impact-solid-1.mp3	proc_metal_impact	Short one-shot (~0.4s); metallic clang with short natural ring.
objects/doors/intact-door-open.mp3	proc_intact_door	Short one-shot (~0.55s); solid, well-oiled wooden door latch click and swing (pitched down automatically on close, or add intact-door-close.mp3).
objects/fire/campfire-crackle-loop.mp3	proc_campfire_crackle	Seamless loop; close wood-fire crackle, ember pops, and gentle flame flutter.
player/clothing/clothing-rustle-1.mp3	proc_clothing_rustle	Short one-shot (~0.3s); canvas jacket and pack rustle on jump, land, or quick movement.
weapons/gunshot-crack.mp3	proc_gunshot_crack	One-shot (~0.9–1.5s); sharp outdoor rifle/shotgun crack with brief natural tail (no baked-in reverb).


Lower Priority (Music, UI & Extra Material / Ecosystem Upgrades)
Suggested File Name	Asset ID (assets.ts)	Description
music/forest-day-1.mp3	proc_music_nordic_day	Music track (~1–3m); sparse daytime Nordic/Baltic acoustic atmosphere (e.g. kannel, acoustic guitar, soft pads).
music/forest-night-1.mp3	proc_music_forest_night	Music track (~1–3m); quiet, contemplative nocturnal ambient score.
ui/ui-click.mp3	proc_ui_click	Short transient (~0.15s); subtle tactile click for interface actions.


Recommended Future Upgrades (Currently Shared/Approximated in materials.ts & Appendix A)
Individual single footsteps (to replace long-form loops or pitch-shifted fallbacks):
player/footsteps/forest-floor-step-1.mp3, gravel-step-1.mp3, water-step-1.mp3 (with walk, run, and crouch variants)
player/footsteps/wooden-boardwalk-step-1.mp3, mud-step-1.mp3, stone-step-1.mp3, snow-step-1.mp3
Additional rain/water surfaces: water/rivers/river-flow-loop.mp3, weather/rain/rain-on-foliage-loop.mp3, weather/rain/rain-on-water-loop.mp3, weather/rain/rain-on-metal-loop.mp3
Additional player/wildlife detail: player/vocalisations/grunt-1.mp3, player/vocalisations/cough-1.mp3, wildlife/amphibians/marsh-frog-1.mp3
(Note: the 14 original MP3s, now organized under src/assets/sounds/—including bird-escaping-flight.mp3, woodpecker-drumming-close.mp3, woodpecker+distant.mp3, tawny-owl-hooting.mp3, wolf-howl.mp3, red-fox-screech-01.mp3 / red-fox-screech-02.mp3, footsteps-on-moss-and-breaking-twigs-in-forest.mp3, walking-on-gravel.mp3, walking-in-water.mp3, decrepid-door-creaking.mp3, wooden-crate-smash.mp3, two-wood-cracks.mp3, thunder-clap-close.mp3, and rain-and-thunder-background.mp3—are already wired up and do not need to be re-recorded.)
