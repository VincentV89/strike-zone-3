# StrikeZone

Single-player browser 3D tactical FPS against CPU bots, built with TypeScript, Vite and three.js and hosted as a static bundle. This repository currently contains the **foundation** unit: the shared kernel, the shared contract types, the toolchain and the `npm run verify` gate, plus a walking-skeleton page that renders a lit three.js scene.

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
- Imports between components use relative paths. There are no path aliases.
- `tests/arch/component-table.ts` declares every component, its ring and its allowed edges (R = runtime, T = type-only). `tests/arch/import-graph.test.ts` fails on undeclared edges, type-only edges used at runtime, ring violations, runtime code in contracts, bot AI importing the sim world, and cycles (type-only edges included). A unit that adds an edge updates the table.

## Conventions

- World units are metres, seconds and radians. +Y is up, yaw 0 faces −Z, positive yaw turns left, positive pitch looks up.
- Programmer errors throw `StrikeZoneError` with an `area/kebab-name` code. Expected failures return `Result`. Tick-path code never throws; it reports through `Diagnostics`.
- Simulation randomness comes only from an injected `Rng` stream forked by name (`spawn`, `spread`, `perception`, `ai:<id>`). `createRng` is not cryptographically secure.
- Versions in `package.json` are exact and `package-lock.json` is committed. Production licences must be MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD or ISC.
- Binary assets (images, models, audio, fonts) must be listed in `assets-provenance.json` as `original` or `procedural` with an author. The game is procedural, so the list is empty.
