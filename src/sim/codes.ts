/** Diagnostic codes game-simulation reports (tech-stack-decisions-game-simulation, Observability). */
export const SIM_CODES = Object.freeze([
  'sim/nav-unattached',
  'sim/nav-unreachable',
  'sim/spawn-blocked',
  'sim/too-few-spawns',
  'sim/spawn-budget',
  'sim/step-after-end',
  'sim/bad-state',
] as const);

export type SimCode = (typeof SIM_CODES)[number];

/** Codes thrown as StrikeZoneError (programmer errors, never on the tick path). */
export const SIM_THROWN_CODES = Object.freeze([
  'sim/bad-config',
  'sim/invalid-map',
  'sim/headless-spawn',
  'stats/closed',
] as const);
