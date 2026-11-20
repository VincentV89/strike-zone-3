# StrikeZone

Single-player browser 3D tactical FPS against CPU bots, built with TypeScript, Vite and three.js and hosted as a static bundle. This repository currently contains the **foundation** unit (the shared kernel, the shared contract types, the toolchain and the `npm run verify` gate, plus a walking-skeleton page that renders a lit three.js scene), the **hosting-infra** unit (one CDK v2 stack that serves the bundle from a private S3 bucket through CloudFront; see [infra/README.md](infra/README.md)), the **map-data** unit (`src/maps`), the **collision-nav** unit (`src/physics`, `src/nav`), the **player-combat** unit (`src/sim/player`, `src/weapons`, `src/combat`), the **hud** unit (`src/ui/hud`), the **presentation-3d** unit (`src/render`) and the **audio** unit (`src/audio`), the **bot-ai** unit (`src/ai`), the **game-simulation** unit (`src/sim`, `src/sim/stats`) the **app-shell** unit (`src/app`, `src/input`, `src/dev`), which composes everything into the playable game, and the **verification** unit (`scripts/verification`, `scripts/smoke.ts`, `scripts/report.ts`, `tests/verification`, `tests/e2e`), which produces the final report.

## Requirements

- Supported browsers: current desktop Chrome, Edge and Firefox with WebGL2. Safari is best-effort. Nothing is installed; without WebGL2 the game shows a notice and no round can start.
- Node 24 (`engines` is enforced through `.npmrc`), npm 11
- Install with `npm ci`

## Scripts

| Script                   | What it does                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`            | Vite dev server for the game                                                                                                                                                                                                            |
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
| `npm run check:seams`    | Fails if test-seam markers or a `dev*` chunk reach `dist/`, or the entry chunk exceeds 900 KB minified / 200 KB brotli; writes `reports/app-shell-bundle.json`                                                                          |
| `npm run check:assets`   | Asset gate: total ≤ 30 MB, per-map download ≤ 24 MB, texture inventory, extension partition, Basis transcoder byte identity, GLBs without images, KTX2 full mips, kit chunk size; writes `reports/asset-budget.json`                    |
| `npm run build:test`     | `vite build --mode test --outDir dist-test`: the e2e bundle with test seams (never deployed, not in the gate)                                                                                                                           |
| `npm run e2e`            | `build:test`, then Playwright headless Chromium plays a seeded round and Play Again on both maps against `dist-test/` and writes `reports/e2e.json` (not in the gate; see below)                                                        |
| `npm run smoke`          | Post-deploy smoke checks SM-1..SM-9 against `reports/cdk-outputs.json`, or blocked mode with the missing items; `-- --precheck` writes the credential precheck to `reports/precheck.json`                                               |
| `npm run smoke:browser`  | Post-deploy browser smoke: opens the `DistributionUrl` from `reports/cdk-outputs.json` (no seams), clicks Start Game and the Ready gate and waits for the live HUD; writes `reports/browser-smoke.json`. Runs in the CI deploy job      |
| `npm run report`         | Classifies the evidence on disk and writes `reports/evidence.json` and `docs/FINAL-REPORT.md`; exits 1 while any check is `automated-fail`                                                                                              |
| `npm run test:matrix`    | The 1/5/10/20-bot matrix on both maps on its own                                                                                                                                                                                        |
| `npm run bench:ai`       | The bot-ai bench on its own (`reports/bot-ai-bench.json`)                                                                                                                                                                               |
| `npm run verify`         | The gate: `lint && typecheck && test:coverage && build && synth && check:licences && check:seams && check:assets`, failing fast                                                                                                         |

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

## App shell

- `src/app/main.ts` is the only file that reads browser globals. It builds `BrowserCaps`, the storage handle, the seed source and the pointer-lock port, then calls `createApp(deps).start(root)`. Everything below it receives functions, so it runs in Node or happy-dom tests.
- `src/app/machine.ts` is a pure reducer over the AppState machine (`boot`, `unsupported`, `menu`, `loading`, `loading-error`, `ready`, `countdown`, `live`, `paused`, `eliminated`, `end`; rows AS-T01..AS-T31). It returns effects as data, and every row that leaves a round releases pointer lock first.
- Loading has four steps with real progress: `map` (geometry plus `renderer.buildMap`), `nav` (the bake), `bots` (simulation, stats, actors) and `shaders` (`precompile`). Retry starts at the failed step. Restart and Play Again rebuild in place with a fresh seed and never reload the page; an abandoned round calls `stats.discard()` and is not written to history.
- `src/app/frame-loop.ts` runs the one `requestAnimationFrame` loop. The simulation steps only in countdown and live; every entry into either resets the clock, so a resume never runs a catch-up burst. A frame that throws is skipped and reported once as `app/frame-fault`; 30 faulted frames in a row move the round to the loading-error screen (`app/frame-fault-tripped`).
- Pause opens on `pointerlockchange` or a hidden tab, never on an Esc keydown. Every pointer-lock request is made synchronously inside a click or Enter handler.
- `src/input` maps `KeyboardEvent.code`, so the layout does not matter. While the sniper scope is held, mouse deltas are multiplied by `tan(scopedVFov/2) / tan(vFov/2)` (about 0.25).
- Diagnostics go to `console.warn('[strikezone] <code>')` once per code, without detail.
- Test seams (`window.__strikezone`, the pointer-lock bypass `?seams=bypass-lock`, the profiler overlay `?seams=overlay`) exist only in `npm run build:test` output (`dist-test/`, gitignored). The single guarded `import()` in `main.ts` is dead in production builds; `check:seams` scans `dist/`, and the CDK app refuses `dist-test/` or any bundle containing `__strikezone` (`infra/web-dir-test-bundle`).
- Real pointer lock, the Ready-gate gesture timing, Alt-Tab and WebGL context loss are manual-pending browser checks.

## Verification and final report

`docs/FINAL-REPORT.md` is the delivery report (spec §16 items A–H, the §17 Definition of Done, cuts and known limitations). It is generated, never hand-edited:

1. `npm ci && npm run verify` (Vitest also writes `reports/vitest-results.json`).
2. `npm run e2e` (optional browser run; needs the headless Chromium setup in `docs/MANUAL-TESTS.md`).
3. `npm run smoke -- --precheck`, then deploy only with credentials and approval (see [infra/README.md](infra/README.md)), then `npm run smoke`.
4. `npm run report`.

The check register in `scripts/verification/checks.ts` lists every spec §13 check and §17 row with its evidence. Only `automated-pass` and `manual-pass` count as passed; results older than the newest source file are `stale`, and a missing result is `not-verified`, never a pass. Checks that need a person (real pointer lock, audio, GPU frame rate, the deployed round) have scripts in `docs/MANUAL-TESTS.md`; a result counts only after the tester records it in `verification/manual-results.json`. Low is the recommended graphics preset for 15 and 20 bots.

## Verify gate

`npm run verify` runs offline after `npm ci`, needs no credentials and makes no AWS calls. Steps are only ever **appended**: hosting-infra inserted `synth` (prebuilt `cdk synth --strict`) after `build`, app-shell appends `check:seams`, and the graphics uplift appends `check:assets`. Deploy (`npx cdk deploy --all`) is a separate, manual, credentialed step described in [infra/README.md](infra/README.md). `tests/scripts/verify-script.test.ts` fails if the chain uses anything but `&&` or reorders the foundation steps.

GitHub Actions (`.github/workflows/ci.yml`) runs the same `npm ci && npm run verify` without credentials on every pull request and push to `main`, runs `npm run e2e` alongside it, and on a push to `main` deploys the verified bundle through a GitHub OIDC role and runs both smoke checks. Setup (account, region, deploy role, CDK bootstrap) is in [infra/README.md](infra/README.md#github-actions-cicd).

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
- `src/ai` is bot-ai, three components that import each other only as types:
  - `src/ai/perception`: `sense(mem, input, world, profile, rng, diag)` is the only code that reads live player data (`SenseInput.targetPoints`, built with `targetPointsFor`). Sight needs range, the FOV cone and `lineOfSight` (at most 3 rays). Bots hear only the player's gunfire, as a suspected point inside an error disc; damage gives a direction, never a position.
  - `src/ai/locomotion`: `setGoal` and `stepBotMotion` own the path (copied into a 64-point buffer on poll), the ticket, waypoint following, soft separation, exactly one `moveCapsule` per tick and the stuck watchdog (every 90-tick window under 0.3 m: repath, repath, nudge to the nearest node, snap to it when it is at most 1.5 m away and the standing capsule fits).
  - `src/ai/brain`: the seven-state FSM (`createBotBrain`, transition rows T-01..T-27), `stepBotAim` (turn rate, settling aim error, reaction delay, bursts; it only writes the trigger), the shared `CoverRegistry`, frozen `DIFFICULTY_PROFILES` (behaviour only, never health) and `createAiScheduler(botCount, { senseHz = 20, decideHz = 10 })`. Both rates are configurable; they must divide 60, and a bot is due when `(tick + id) % (60 / hz) === 0`, so 20 bots make at most 7 senses and 4 decides per tick. `wake(id)` forces one sense and one decide after damage.
  - Brain and locomotion meet through `BotIntent` and `AvoidZone` in `src/contracts/ai.ts`. `BrainContext`, `BotSelf` and `LocoContext` have no player field.
  - `tests/ai/harness.ts` copies game-simulation tick stages 4-10 for tests only; it is not the game pipeline. Timings go to `reports/bot-ai-bench.json` (2 ms target reported, 10x ceilings asserted).
- `src/sim` is game-simulation, the only writer of round state:
  - `prepareMapAsync(id, { signal, onProgress, yieldFn, now, sliceMs?, diag? })` builds the collision world, bakes the nav graph in 8 ms slices (yielding between them; `now` sets only the slice budget) and runs `validateMap`. Valid maps are cached per `MapId` for the page; an invalid map returns `INVALID_MAP` and is not cached; an abort keeps the geometry. `prepareMap(id)` is the synchronous Node version.
  - `validateMap` adds nav, capsule and spawn-budget checks to `checkMapData`. A bot spawn must be at least 20 m from the player spawn and hidden from its eye at 0.3, 1.0, 1.6 and 1.8 m; every player spawn needs 20 such spawns (measured minimum: Desert 24, Warehouse 21).
  - `createSimulation(cfg, map, { diag, profiler, ai? })` throws `sim/bad-config` on a bad `RoundConfig` and returns `SPAWN_ALLOCATION_FAILED` as a value. `step(cmd)` runs the 12 stages: swap snapshots, player, awareness (10 Hz), sense, decide, `paths.tick()`, bot motion and aim, weapons, shots (player first, then bots by id; a shooter killed earlier in the tick does not fire), deaths, round checks (win, then timeout, then death), snapshot. The countdown is 210 ticks with bots frozen. After `ended`, `step()` is a no-op.
  - `snapshot()` and `previousSnapshot()` are reused buffers valid until the second following `step()`; `drainEvents()` returns sim-owned copies valid until the next drain. Copy what you keep.
  - Only the private `senseDue` (stage 4) reads the live player position for bot-ai; `tests/arch/sim-firewall.test.ts` checks this by function name. The radar publishes mark-time positions of bots the player saw (30 m, ±60°, chest or head in sight) or heard firing within 30 m.
  - `src/sim/stats` is match-stats: `createStatsTracker(session, botCount)` folds drained events (`ingest`), then `commit(outcome)` returns a new frozen `SessionStats` or `discard()` leaves it unchanged. `headshots` counts headshot kills. It has no edge to game-simulation.
  - `runHeadless(cfg, driver, maxTicks)` is for Node tests; drivers live in `tests/sim/drivers.ts`. The seed-42 golden (`tests/sim/golden/seed-42.json`) is rewritten only with `SZ_UPDATE_GOLDEN=1`. Reports: `reports/game-simulation-{bench,matrix,stuck-<map>}.json`.
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

## Graphics assets

The graphics uplift adds authored CC0 assets on top of the procedural renderer. Every asset is optional: a failed download, decode or validation falls back to the procedural visual for that item only, and the round still starts.

- `assets/` holds the committed binaries: `models/*.glb` (meshopt-compressed, quantised, no embedded images), `textures/*.ktx2` and `sky/*.ktx2` (Basis, full mip chains). Each file is listed in `assets-provenance.json` (v2: `cc0` entries need licence `CC0-1.0`, an author and an https source on polyhaven.com, ambientcg.com, kenney.nl or quaternius.com). Credits are in [docs/CREDITS.md](docs/CREDITS.md).
- `tools/asset-pipeline/` is the offline pipeline (gltf-transform, meshoptimizer, sharp, KTX-Software `toktx`). It is not part of verify; see [docs/ASSETS.md](docs/ASSETS.md). It also generates `src/maps/prop-catalog.data.ts`, `src/render/assets/manifest.data.ts` and `texture-sets.data.ts`.
- Loading has a fifth step, **Assets**, between Navigation and Bots. Downloads start with the map step (at most 4 at once, one retry for network errors, 5xx and 429) and are applied after the map is built. Rebuilds, Play Again and preset changes fetch nothing.
- `src/app/main.ts` owns the fetch and the single memoised `import('../render/assets/kit')`; only `src/render/assets/kit.ts` imports `three/addons` (GLTFLoader, KTX2Loader, the meshopt decoder and SkeletonUtils). Bots are skinned CC0 characters animated by a direct track sampler (no AnimationMixer); the 9-part box rig is their shadow proxy on Medium and High and the fallback when the model fails.
- Large props (rocks, debris, vehicles, structures) collide: their boxes are map data in `src/maps`, generated from the catalog, never read from a GLB. Vegetation is visual only and stays under 0.6 m inside the play space.
- The CSP adds `'unsafe-eval'` and `'wasm-unsafe-eval'` to `script-src` and `worker-src 'self' blob:` (single source: `infra/lib/policy.ts`). `'unsafe-eval'` is needed because three's Basis transcoder builds functions with `new Function` in its worker.

## Graphics presets

The renderer never changes quality on its own; the player's preset always wins. Low is the recommended preset for 15 and 20 bots. Values come from `PRESETS` in `src/render/presets.ts` (three 0.187 removed PCF-soft shadows, so every preset uses PCF and High uses a wider kernel).

| Setting                      | Low                | Medium (default) | High        |
| ---------------------------- | ------------------ | ---------------- | ----------- |
| Pixel ratio                  | min(dpr, 1) × 0.75 | min(dpr, 1.5)    | min(dpr, 2) |
| Sun shadow map               | 1024 px (map only) | 2048 px          | 4096 px     |
| Local shadow lights          | 0                  | 1                | 2           |
| Bots cast shadows            | no                 | yes (proxy rig)  | yes (proxy) |
| Max shadow-casting objects   | 16                 | 24               | 32          |
| Anisotropy                   | 1                  | 4                | 8           |
| Draw distance                | 150 m              | 200 m            | 300 m       |
| Particles (cap / per impact) | 64 / 6             | 192 / 8          | 384 / 12    |
| Decals / tracers             | 32 / 16            | 64 / 32          | 128 / 48    |
| Muzzle-flash light           | off                | off              | on          |
| Largest texture mip          | 1024 px            | 2048 px          | 2048 px     |
| Dressing density / cap       | 0.35 / 1,500       | 0.7 / 4,000      | 1.0 / 8,000 |
| Scatter draw distance        | 45 m               | 70 m             | 100 m       |
| Prop / bot LOD0 distance     | 15 m / LOD1 only   | 25 m / 25 m      | 40 m / 40 m |
| Bot animation rate           | 15 Hz              | 30 Hz            | 60 Hz       |
| Near-camera detail layer     | off                | off (cut)        | off (cut)   |
| World draw calls / triangles | 80 / 300k          | 100 / 600k       | 120 / 1M    |
| Texture budget               | 160 MB             | 320 MB           | 512 MB      |

Renderer evidence: `tests/render/render-bench.test.ts` writes `reports/render-bench.json` (CPU-side timings in Node, indirect; only 10× ceilings are asserted). GPU frame time is manual-pending. Manual browser check (target hardware, Chrome desktop, 1080p): for each preset with 5 and 20 bots, confirm shadows on Low, the death topple, muzzle flash and recoil kick, and read FPS from the dev profiler overlay; then force a context loss with the `WEBGL_lose_context` extension and confirm the round pauses and resumes after restore.
