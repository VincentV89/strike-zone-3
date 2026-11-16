/**
 * Component table for the import-graph check (BR-F-29..36).
 *
 * Each row mirrors one row of the `component-dependency` table. R = runtime
 * (value) import allowed; T = type-only import allowed. Both count for the
 * cycle check. A unit that adds an edge updates this table and records it in
 * its code-summary (BR-F-35).
 *
 * `app-shell -> audio` was added by the audio unit (B10, BR-AU-81). Only
 * src/app/features.ts may use it (tests/arch/import-graph.test.ts).
 */

export type Ring = 'sim' | 'adapter' | 'delivery';
export type EdgeKind = 'R' | 'T';

export interface ComponentSpec {
  id: string;
  ring: Ring;
  prefixes: readonly string[];
  deps: Readonly<Record<string, EdgeKind>>;
}

export interface RingPolicy {
  ring: Ring;
  /** Bare specifiers allowed from src/. A trailing `/*` allows any subpath. */
  allowedPackages: readonly string[];
}

export const RING_POLICIES: readonly RingPolicy[] = [
  { ring: 'sim', allowedPackages: [] },
  { ring: 'adapter', allowedPackages: ['three', 'three/examples/jsm/*'] },
  { ring: 'delivery', allowedPackages: [] },
];

const core = 'core-kernel';
const contracts = 'contracts';

export const COMPONENTS: readonly ComponentSpec[] = [
  { id: core, ring: 'sim', prefixes: ['src/core'], deps: {} },
  { id: contracts, ring: 'sim', prefixes: ['src/contracts'], deps: { [core]: 'T' } },
  { id: 'map-data', ring: 'sim', prefixes: ['src/maps'], deps: { [core]: 'R', [contracts]: 'T' } },
  {
    id: 'collision-world',
    ring: 'sim',
    prefixes: ['src/physics'],
    deps: { [core]: 'R', 'map-data': 'T' },
  },
  {
    id: 'navigation',
    ring: 'sim',
    prefixes: ['src/nav'],
    // map-data is R: src/nav reads WALKABLE_KINDS and MAP_RULES at runtime (FD-CN-01).
    deps: { [core]: 'R', 'map-data': 'R', 'collision-world': 'R' },
  },
  {
    id: 'player-controller',
    ring: 'sim',
    prefixes: ['src/sim/player'],
    deps: { [core]: 'R', [contracts]: 'T', 'collision-world': 'R' },
  },
  {
    id: 'weapons',
    ring: 'sim',
    prefixes: ['src/weapons'],
    deps: { [core]: 'R', [contracts]: 'T' },
  },
  {
    id: 'combat',
    ring: 'sim',
    prefixes: ['src/combat'],
    deps: { [core]: 'R', [contracts]: 'T', 'collision-world': 'R', weapons: 'T' },
  },
  {
    id: 'bot-perception',
    ring: 'sim',
    prefixes: ['src/ai/perception'],
    deps: { [core]: 'R', [contracts]: 'T', 'collision-world': 'R' },
  },
  {
    id: 'bot-locomotion',
    ring: 'sim',
    prefixes: ['src/ai/locomotion'],
    deps: { [core]: 'R', [contracts]: 'T', 'collision-world': 'R', navigation: 'R' },
  },
  {
    id: 'bot-brain',
    ring: 'sim',
    prefixes: ['src/ai/brain'],
    deps: {
      [core]: 'R',
      [contracts]: 'T',
      'bot-perception': 'T',
      navigation: 'R',
      'collision-world': 'R',
      weapons: 'T',
    },
  },
  {
    id: 'game-simulation',
    ring: 'sim',
    prefixes: ['src/sim'],
    deps: {
      [core]: 'R',
      [contracts]: 'T',
      'map-data': 'R',
      'collision-world': 'R',
      navigation: 'R',
      'player-controller': 'R',
      weapons: 'R',
      combat: 'R',
      'bot-perception': 'R',
      'bot-locomotion': 'R',
      'bot-brain': 'R',
    },
  },
  {
    id: 'match-stats',
    ring: 'sim',
    prefixes: ['src/sim/stats'],
    deps: { [core]: 'R', [contracts]: 'T' },
  },
  {
    id: 'app-shell',
    ring: 'adapter',
    prefixes: ['src/app'],
    deps: {
      [core]: 'R',
      [contracts]: 'T',
      'map-data': 'T',
      'game-simulation': 'R',
      'match-stats': 'R',
      input: 'R',
      renderer: 'R',
      hud: 'R',
      'menus-ui': 'R',
      settings: 'R',
      persistence: 'R',
      'test-seams': 'R',
      // Added by the audio unit (BR-AU-81); only src/app/features.ts imports src/audio.
      audio: 'R',
    },
  },
  {
    id: 'input',
    ring: 'adapter',
    prefixes: ['src/input'],
    deps: { [core]: 'R', [contracts]: 'T' },
  },
  {
    id: 'renderer',
    ring: 'adapter',
    prefixes: ['src/render'],
    deps: { [core]: 'R', [contracts]: 'T', 'map-data': 'T' },
  },
  { id: 'hud', ring: 'adapter', prefixes: ['src/ui/hud'], deps: { [core]: 'R', [contracts]: 'T' } },
  {
    id: 'menus-ui',
    ring: 'adapter',
    // FD-MS-07 / TS-MS-03: components and the shared token sheet belong to menus-ui.
    prefixes: ['src/ui/screens', 'src/ui/components', 'src/ui/tokens.css'],
    // R edges: SETTINGS_SPEC (FD-MS-07) and BOT_COUNTS (SD-MS-05) are runtime values.
    deps: { [contracts]: 'R', settings: 'R' },
  },
  {
    id: 'audio',
    ring: 'adapter',
    prefixes: ['src/audio'],
    deps: { [core]: 'R', [contracts]: 'T', settings: 'T' },
  },
  {
    id: 'settings',
    ring: 'adapter',
    prefixes: ['src/settings'],
    deps: { [contracts]: 'T', persistence: 'T' },
  },
  // persistence -> contracts is R: history validation reads BOT_COUNTS (SD-MS-05).
  { id: 'persistence', ring: 'adapter', prefixes: ['src/persistence'], deps: { [contracts]: 'R' } },
  {
    id: 'test-seams',
    ring: 'adapter',
    prefixes: ['src/dev'],
    deps: { [core]: 'R', [contracts]: 'T' },
  },
  { id: 'hosting-infra', ring: 'delivery', prefixes: ['infra'], deps: {} },
  {
    id: 'verification-tooling',
    ring: 'delivery',
    prefixes: ['scripts', 'test'],
    deps: {
      [contracts]: 'T',
      'map-data': 'R',
      'game-simulation': 'R',
      'hosting-infra': 'R',
    },
  },
];

/** Files under this prefix are the simulation world; bot AI must not import them (ADR-005). */
export const SIM_WORLD_PREFIX = 'src/sim/world';
/** Files under this prefix belong to bot AI. */
export const AI_PREFIX = 'src/ai';
