# Metsavaikus

Browser-based Estonian wilderness exploration and survival game. React owns menus and overlays; an imperative Three.js runtime owns the world, input, physics, simulation, and rendering. Vite bundles the application; `src/main.tsx` mounts `src/App.tsx`.

## Working principles

- Prefer clean code principles: cohesive modules, explicit dependencies, small interfaces, and one authoritative implementation of shared rules. Separate rendering, domain rules, and orchestration where their responsibilities differ.
- Keep this file and the relevant child `AGENTS.md` files up to date whenever their respective area is touched. Describe the current implementation and its invariants; keep proposals separate from established architecture.
- Preserve deterministic world generation and shared geometry across rendering, collisions, weather cover, vegetation, and audio.
- Verify behavior with the relevant checks before committing. Report runtime checks that were not performed; a type check does not validate GPU rendering or audible output.

## Read only the relevant subsystem guides

- **UI, game phases, world lifecycle, input, HUD, or React/runtime communication:** [src/components/AGENTS.md](src/components/AGENTS.md), also covering `src/App.tsx`.
- **Objects, houses, tents, campfires, terrain, vegetation, water, weather, maps, or spatial physics:** [src/world/AGENTS.md](src/world/AGENTS.md).
- **Inventory, survival, sleep, water locomotion, quality adaptation, or performance logging:** [src/game/AGENTS.md](src/game/AGENTS.md).
- **Audio scheduling, playback, acoustic processing, events, or persistence:** [src/soundscape/AGENTS.md](src/soundscape/AGENTS.md).
- **Sound definitions, audio assets, biome layers, material sounds, or music content:** [src/config/soundscape/AGENTS.md](src/config/soundscape/AGENTS.md).
- **Translations or language switching:** [src/i18n/AGENTS.md](src/i18n/AGENTS.md).

## Verification and tooling

Use `package.json` as the command reference. `npm test` runs colocated Node/tsx tests; `npm run lint` is TypeScript checking; `npm run build` builds production assets. `npm run test:rendering` and `npm run test:audio` run browser checks under `scripts/` against fixtures in `tests/` and require Chrome/Chromium (`CHROME_BIN` can override discovery). `npm run test:keyboard` checks Firefox browser find and native UI input in an isolated profile; it requires Firefox and geckodriver (`FIREFOX_BIN`/`GECKODRIVER_BIN` override discovery).

Keep the asset-copy behavior in `vite.config.ts`: root-relative source asset URLs depend on it in production. Existing soundscape design and extension references are indexed in [docs/soundscape/README.md](docs/soundscape/README.md); verify historical delivery statements against the current code.

When replacing procedural sound assets with recordings, follow the asset ID and reference rules in [src/config/soundscape/AGENTS.md](src/config/soundscape/AGENTS.md).
