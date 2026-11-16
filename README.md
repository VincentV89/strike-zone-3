# StrikeZone

Single-player browser 3D tactical FPS against CPU bots, built with TypeScript, Vite and three.js and hosted as a static bundle. This repository currently contains the **foundation** unit (the shared kernel, the shared contract types, the toolchain and the `npm run verify` gate, plus a walking-skeleton page that renders a lit three.js scene), the **hosting-infra** unit (one CDK v2 stack that serves the bundle from a private S3 bucket through CloudFront; see [infra/README.md](infra/README.md)), the **map-data** unit (`src/maps`), the **collision-nav** unit (`src/physics`, `src/nav`), the **player-combat** unit (`src/sim/player`, `src/weapons`, `src/combat`), the **hud** unit (`src/ui/hud`), the **presentation-3d** unit (`src/render`) and the **audio** unit (`src/audio`).

## Requirements

- Node 24 (`engines` is enforced through `.npmrc`), npm 11
- Install with `npm ci`

## Scripts

| Script                   | What it does                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`            | Vite dev server for the skeleton page                                                                                                                                                                                                   |
| `npm run lint`           | `eslint . --max-warnings 0 && prettier --check .`                                                                                                                                                                                       |
| `npm run typecheck`      | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`)                                                                                                                                                             |
| `npm test`               | Vitest (Node environment, at most 2 workers)                                                                                                                                                                                            |
| `npm run test:coverage`  | Vitest with v8 coverage; fails below 80 % lines on any glob listed in `vitest.config.ts` (`src/core/**`, `src/maps/**`, `src/physics/**`, `src/nav/**`, `src/sim/player/**`, `src/weapons/**`, `src/combat/**`, `src/ui/**` and others) |
| `npm run check:imports`  | The import-graph and ring-lint tests on their own (`tests/arch`)                                                                                                                                                                        |
| `npm run build`          | `vite build` into `dist/`                                                                                                                                                                                                               |
| `npm run build:web`      | `vite build`; called by CDK local bundling with `--outDir` during `cdk deploy`                                                                                                                                                          |
| `npm run synth`          | Infra typecheck, then offline `cdk synth --strict` on the prebuilt `dist/` (no credentials)                                                                                                                                             |
| `npm run check:licences` | Licence, pinning, asset, secret and `dist/` checks; writes `reports/licences.json`                                                                                                                                                      |
| `npm run audit`          | Advisory `npm audit` of production dependencies into `reports/audit.json` (not part of the gate)                                                                                                                                        |
| `npm run verify`         | The gate: `lint && typecheck && test:coverage && build && synth && check:licences`, failing fast                                                                                                                                        |

## Controls

Controls cannot be rebound. Crouch is C only; Ctrl is not bound. `tests/ui/screens/controls-readme.test.ts` checks that this table equals `CONTROL_BINDINGS` in `src/ui/screens/controls-content.ts`.

| Action        | Keys                     |
| ------------- | ------------------------ |
| Move          | W A S D                  |
| Look          | Mouse                    |
| Fire          | Left mouse button        |
| Sniper scope  | Hold right mouse button  |
| Jump          | Space                    |
| Sprint        | Shift                    |
| Crouch        | C                        |
| Reload        | R                        |
| Switch weapon | 1 / 2 / 3 or mouse wheel |
| Scoreboard    | Hold Tab                 |
| Pause         | Esc                      |

## Menus, settings and saved data

- `src/settings` holds `SETTINGS_SPEC`, the single table of setting ranges and defaults, `normalise` (clamp, snap, reject), `validateSettings` and the settings store.
- `src/persistence` reads and writes `strikezone:settings` and `strikezone:history` in localStorage as `{ schemaVersion: 1, ... }`. Reads never throw: bad records fall back to defaults, and a failed write stops saving for the rest of the tab session. Only app-shell touches `window.localStorage` and passes it in, together with `validateSettings`.
- `src/ui/screens` holds the menu and overlay screens (S0–S14). Each implements `Screen<VM>` and only emits `UiIntent` or `SettingsIntent`. `src/ui/components` holds the DOM helper (change-only writes with a counter), the listener scope and the shared controls. Tokens live only in `src/ui/tokens.css`.
- Saved data is tied to the page origin. Redeploying the same stack keeps it; `cdk destroy` plus a fresh deploy, or a new domain, loses it.
- DOM tests use happy-dom with a `// @vitest-environment happy-dom` first line. The global Vitest environment stays `node`.

## Audio

- `src/audio` synthesises every sound with Web Audio oscillators and one seeded noise buffer. No audio file ships or loads.
- `createAudioEngine({ diagnostics })` never creates an `AudioContext`. app-shell calls `unlock()` from the first `pointerdown` or `keydown` (and again on the Ready gate, Resume and Play Again). The call is idempotent and returns a `Result` (`BLOCKED`, `UNSUPPORTED`).
- Per stepped frame app-shell calls `audio.play(events, { pos, yaw })` inside the `'audio'` profiler section, and `audio.ui(cueForIntent(intent))` after dispatching an intent. `setVolumes(masterPct, sfxPct)` takes the integer percents from Settings. `suspend()` runs on `visibilitychange` hidden, never on Pause.
- Every voice goes through effects bus → master bus → limiter → destination. Either volume at 0 creates no nodes. At most 24 live voices and 12 new voices per frame; extra requests are dropped and counted as `audio/voice-dropped`.
- Only `src/audio/context.ts` reads a browser global, and only `src/app/features.ts` may import `src/audio` (ESLint blocks plus `tests/arch`). To cut audio, remove that import, delete `src/audio`, delete the `app-shell → audio` row and hide the Audio settings group.
- Audible output is checked by a manual listening script, which stays manual-pending until someone runs it in a browser.

## Verify gate

`npm run verify` runs offline after `npm ci`, needs no credentials and makes no AWS calls. Steps are only ever **appended**: hosting-infra inserted `synth` (prebuilt `cdk synth --strict`) after `build`, and app-shell appends `check:seams`. Deploy (`npx cdk deploy --all`) is a separate, manual, credentialed step described in [infra/README.md](infra/README.md). `tests/scripts/verify-script.test.ts` fails if the chain uses anything but `&&` or reorders the foundation steps.

## Code layout and rings

| Ring       | Directories                                                                                                         | Rule                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| simulation | `src/core`, `src/contracts`, `src/maps`, `src/physics`, `src/nav`, `src/sim`, `src/weapons`, `src/combat`, `src/ai` | Headless: no `three`, no DOM globals, no timers, no `Date`, no `Math.random`, no npm packages |
| adapter    | `src/app`, `src/input`, `src/render`, `src/ui/*`, `src/audio`, `src/settings`, `src/persistence`, `src/dev`         | Browser code; may import `three`                                                              |
| delivery   | `infra/`, `scripts/`, `test/`                                                                                       | Node-only tooling                                                                             |

- `src/core` is the kernel: seeded RNG streams (`createRng`, sfc32), the 60 Hz fixed-step clock, the bounded event buffer, the frame profiler, the Diagnostics port, Vec3/AABB math and `StrikeZoneError`/`Result`.
- `src/maps` is map-data: the Desert Compound and Industrial Warehouse maps as deep-frozen TypeScript data, plus `checkMapData` (pure data rules) and the map-content checklist. Other code imports `src/maps/index.ts` only; map files, builders and helpers are private. Maps load nothing at runtime, and the `src/maps/**` ESLint block bans `fetch`, `JSON.parse`, `globalThis` and dynamic `import()` on top of the sim-ring rules.
- `src/physics` is collision-world: `buildCollisionWorld(def)` copies the map's solids and ramps into typed arrays on a 4 m xz grid and answers `moveCapsule` (upright cylinder, substeps, slide, step-up, ground snap, depenetration), `raycast`, `lineOfSight` (fails closed), `capsuleFits`, `sweepClear` and `separate`. Movement, sight and shots read the same shape list. Callers pass `MAP_RULES.stepHeight` (0.35 m). Tick-path queries never throw; bad input returns a conservative result and reports once through `Diagnostics`.
- `src/nav` is navigation: `createNavBaker(def, world, { agent })` bakes the nav graph in time-sliced `step(budgetMs, now)` calls (the result does not depend on the budget), `bakeNavGraph` is the synchronous wrapper, `createPathService(graph, world)` serves at most 2 A* searches and 16 cache hits per `tick()`, and `navReport(def, graph)` is the reachability check `validateMap` uses. `poll` returns a reused waypoint view, so callers copy what they keep. Other code imports only `src/physics/index.ts` and `src/nav/index.ts`; timings go to `reports/collision-nav-bench.json`.
- `src/sim/player` is the player controller: `stepPlayer(state, cmd, world, PLAYER_TUNING, sensitivity, phase, { scoped }, diag, out)` applies look, stance (crouch on C, stand only when the standing capsule fits), acceleration, jump, gravity and exactly one `world.moveCapsule` per live tick, and reports footsteps and landings. In `countdown` only look applies. `PLAYER_TUNING` copies the agent numbers from `MAP_RULES`; a test keeps them equal.
- `src/weapons` holds `WEAPON_PROFILES` (rifle, pistol, sniper; deep-frozen), `createLoadout` (bots pass `{ infiniteReserve: true }`) and `stepWeapon`, which handles switching, reload, the sniper scope, cooldown, spread and recoil and returns a `FireRequest` when a shot fires. Every shot draws exactly three values from the actor's `spread/<id>` stream.
- `src/combat` resolves hitscan shots: `executeShot` casts one ray, picks the nearest head or body hitbox in front of the first wall (head wins a tie), applies at most one `applyDamage` (armor absorbs `floor(raw × 0.5)` while it lasts) and emits `shot`, `impact`, `damage`, `kill`, `noise` in that order. Non-damageable targets block the shot (ADR-018).
- The `emit` sinks of `stepWeapon` and `executeShot` receive **reused scratch event objects**. The sink must copy every field it keeps before it returns; pushing the object straight into the core EventBuffer is a bug. Timings go to `reports/player-combat-bench.json`.
- `src/contracts` holds only types (and the `BOT_COUNTS` table) shared between components. Changes are additive only.
- `src/ui/hud` is the in-game HUD: `toHudViewModel` (pure) projects a `SimSnapshot` into a view model, and `createHud` builds a DOM/SVG overlay once and writes only changed values through a node cache. Per stepped frame the caller runs `hud.feed(events)` then `hud.update(vm)`, and calls `hud.reset()` on every round start. The HUD reads radar positions only from `snap.radar`. Design tokens live in `src/ui/tokens.css`.
- `src/render` is the three.js renderer (presentation-3d). `createGameRenderer({ diagnostics, reducedMotion })` returns a `GameRenderer`: `init(canvas)` (returns `err('NO_WEBGL2')` when WebGL2 is unavailable), `buildMap(def)`, `spawnActors(n)`, `precompile()`, then `render(prev, curr, alpha, events)` per frame, plus `setPreset`, `setFov` (horizontal degrees at 16:9, 70–110, default 90), `resize`, `onContextLost`/`onContextRestored`, `disposeRound()` before every rebuild and a read-only `stats()`. It reads snapshots and events only, never throws or allocates in `render()`, and runs every animation on render time, so the frame freezes when app-shell passes `alpha = 1` and no events. Textures are painted in code (no image files). Only `src/render/gl-host.ts` touches `WebGLRenderer` and the canvas; everything else is tested headless in Node against a fake host.
- DOM tests opt in to happy-dom with a first-line `// @vitest-environment happy-dom` docblock and live under `tests/ui/**/dom/`. Every other test runs in Node. `src/` may not import happy-dom or jsdom.
- Imports between components use relative paths. There are no path aliases.
- `tests/arch/component-table.ts` declares every component, its ring and its allowed edges (R = runtime, T = type-only). `tests/arch/import-graph.test.ts` fails on undeclared edges, type-only edges used at runtime, ring violations, runtime code in contracts, bot AI importing the sim world, and cycles (type-only edges included). A unit that adds an edge updates the table.

## Conventions

- World units are metres, seconds and radians. +Y is up, yaw 0 faces −Z, positive yaw turns left, positive pitch looks up.
- Programmer errors throw `StrikeZoneError` with an `area/kebab-name` code. Expected failures return `Result`. Tick-path code never throws; it reports through `Diagnostics`.
- Simulation randomness comes only from an injected `Rng` stream forked by name (`spawn`, `spread`, `perception`, `ai:<id>`). `createRng` is not cryptographically secure.
- Versions in `package.json` are exact and `package-lock.json` is committed. Production licences must be MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD or ISC.
- Binary assets (images, models, audio, fonts) must be listed in `assets-provenance.json` as `original` or `procedural` with an author. The game is procedural, so the list is empty.

## Graphics presets

The renderer never changes quality on its own; the player's preset always wins. Low is the recommended preset for 15 and 20 bots. Values come from `PRESETS` in `src/render/presets.ts` (three 0.187 removed PCF-soft shadows, so every preset uses PCF and High uses a wider kernel).

| Setting                      | Low                | Medium (default) | High        |
| ---------------------------- | ------------------ | ---------------- | ----------- |
| Pixel ratio                  | min(dpr, 1) × 0.75 | min(dpr, 1.5)    | min(dpr, 2) |
| Sun shadow map               | 1024 px (map only) | 2048 px          | 4096 px     |
| Local shadow lights          | 0                  | 1                | 2           |
| Bots cast shadows            | no                 | yes              | yes         |
| Max shadow-casting objects   | 16                 | 24               | 24          |
| Anisotropy                   | 1                  | 4                | 8           |
| Draw distance                | 150 m              | 200 m            | 300 m       |
| Particles (cap / per impact) | 64 / 6             | 192 / 8          | 384 / 12    |
| Decals / tracers             | 32 / 16            | 64 / 32          | 128 / 48    |
| Muzzle-flash light           | off                | off              | on          |

Renderer evidence: `tests/render/render-bench.test.ts` writes `reports/render-bench.json` (CPU-side timings in Node, indirect; only 10× ceilings are asserted). GPU frame time is manual-pending. Manual browser check (target hardware, Chrome desktop, 1080p): for each preset with 5 and 20 bots, confirm shadows on Low, the death topple, muzzle flash and recoil kick, and read FPS from the dev profiler overlay; then force a context loss with the `WEBGL_lose_context` extension and confirm the round pauses and resumes after restore.
