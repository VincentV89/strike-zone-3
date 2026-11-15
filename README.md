# StrikeZone

Single-player browser 3D tactical FPS against CPU bots, built with TypeScript, Vite and three.js and hosted as a static bundle. This repository currently contains the **foundation** unit (the shared kernel, the shared contract types, the toolchain and the `npm run verify` gate, plus a walking-skeleton page that renders a lit three.js scene) and the **hud** unit (`src/ui/hud`).

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
| `npm run test:coverage`  | Vitest with v8 coverage; fails below 80 % lines on `src/core/**`                                 |
| `npm run check:imports`  | The import-graph and ring-lint tests on their own (`tests/arch`)                                 |
| `npm run build`          | `vite build` into `dist/`                                                                        |
| `npm run check:licences` | Licence, pinning, asset, secret and `dist/` checks; writes `reports/licences.json`               |
| `npm run audit`          | Advisory `npm audit` of production dependencies into `reports/audit.json` (not part of the gate) |
| `npm run verify`         | The gate: `lint && typecheck && test:coverage && build && check:licences`, failing fast          |

## Verify gate

`npm run verify` runs offline after `npm ci`, needs no credentials and makes no AWS calls. Steps are only ever **appended**: hosting-infra adds `SZ_SKIP_WEB_BUILD=1 cdk synth` after `build`, and app-shell appends `check:seams`. `tests/scripts/verify-script.test.ts` fails if the chain uses anything but `&&` or reorders the foundation steps.

## Code layout and rings

| Ring       | Directories                                                                                                         | Rule                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| simulation | `src/core`, `src/contracts`, `src/maps`, `src/physics`, `src/nav`, `src/sim`, `src/weapons`, `src/combat`, `src/ai` | Headless: no `three`, no DOM globals, no timers, no `Date`, no `Math.random`, no npm packages |
| adapter    | `src/app`, `src/input`, `src/render`, `src/ui/*`, `src/audio`, `src/settings`, `src/persistence`, `src/dev`         | Browser code; may import `three`                                                              |
| delivery   | `infra/`, `scripts/`, `test/`                                                                                       | Node-only tooling                                                                             |

- `src/core` is the kernel: seeded RNG streams (`createRng`, sfc32), the 60 Hz fixed-step clock, the bounded event buffer, the frame profiler, the Diagnostics port, Vec3/AABB math and `StrikeZoneError`/`Result`.
- `src/contracts` holds only types (and the `BOT_COUNTS` table) shared between components. Changes are additive only.
- `src/ui/hud` is the in-game HUD: `toHudViewModel` (pure) projects a `SimSnapshot` into a view model, and `createHud` builds a DOM/SVG overlay once and writes only changed values through a node cache. Per stepped frame the caller runs `hud.feed(events)` then `hud.update(vm)`, and calls `hud.reset()` on every round start. The HUD reads radar positions only from `snap.radar`. Design tokens live in `src/ui/tokens.css`.
- DOM tests opt in to happy-dom with a first-line `// @vitest-environment happy-dom` docblock and live under `tests/ui/**/dom/`. Every other test runs in Node. `src/` may not import happy-dom or jsdom.
- Imports between components use relative paths. There are no path aliases.
- `tests/arch/component-table.ts` declares every component, its ring and its allowed edges (R = runtime, T = type-only). `tests/arch/import-graph.test.ts` fails on undeclared edges, type-only edges used at runtime, ring violations, runtime code in contracts, bot AI importing the sim world, and cycles (type-only edges included). A unit that adds an edge updates the table.

## Conventions

- World units are metres, seconds and radians. +Y is up, yaw 0 faces −Z, positive yaw turns left, positive pitch looks up.
- Programmer errors throw `StrikeZoneError` with an `area/kebab-name` code. Expected failures return `Result`. Tick-path code never throws; it reports through `Diagnostics`.
- Simulation randomness comes only from an injected `Rng` stream forked by name (`spawn`, `spread`, `perception`, `ai:<id>`). `createRng` is not cryptographically secure.
- Versions in `package.json` are exact and `package-lock.json` is committed. Production licences must be MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD or ISC.
- Binary assets (images, models, audio, fonts) must be listed in `assets-provenance.json` as `original` or `procedural` with an author. The game is procedural, so the list is empty.
