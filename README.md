# StrikeZone

Single-player browser 3D tactical FPS against CPU bots, built with TypeScript, Vite and three.js and hosted as a static bundle. This repository currently contains the **foundation** unit (the shared kernel, the shared contract types, the toolchain and the `npm run verify` gate, plus a walking-skeleton page that renders a lit three.js scene), the **hosting-infra** unit (one CDK v2 stack that serves the bundle from a private S3 bucket through CloudFront; see [infra/README.md](infra/README.md)), the **map-data** unit (`src/maps`), the **hud** unit (`src/ui/hud`) and the **presentation-3d** unit (`src/render`).

## Requirements

- Node 24 (`engines` is enforced through `.npmrc`), npm 11
- Install with `npm ci`

## Scripts

| Script                   | What it does                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `npm run dev`            | Vite dev server for the skeleton page                                                            |
| `npm run lint`           | `eslint . --max-warnings 0 && prettier --check .`                                                |
| `npm run typecheck`      | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`)                      |
| `npm test`               | Vitest (Node environment, at most 2 workers)                                                     |
| `npm run test:coverage`  | Vitest with v8 coverage; fails below 80 % lines on `src/core/**` or `src/maps/**`                |
| `npm run check:imports`  | The import-graph and ring-lint tests on their own (`tests/arch`)                                 |
| `npm run build`          | `vite build` into `dist/`                                                                        |
| `npm run build:web`      | `vite build`; called by CDK local bundling with `--outDir` during `cdk deploy`                   |
| `npm run synth`          | Infra typecheck, then offline `cdk synth --strict` on the prebuilt `dist/` (no credentials)      |
| `npm run check:licences` | Licence, pinning, asset, secret and `dist/` checks; writes `reports/licences.json`               |
| `npm run audit`          | Advisory `npm audit` of production dependencies into `reports/audit.json` (not part of the gate) |
| `npm run verify`         | The gate: `lint && typecheck && test:coverage && build && synth && check:licences`, failing fast |

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
