/**
 * game-simulation public surface (src/sim). Other components import this
 * file only; prepare internals, config, command, events, awareness, shots and
 * snapshot modules are private (SD-GS-08). match-stats is src/sim/stats.
 */
export { prepareMap, prepareMapAsync } from './prepare';
export { validateMap } from './validate';
export { allocateSpawns } from './spawn';
export { createSimulation } from './simulation';
export { runHeadless, type HeadlessOptions } from './headless';
export { SIM_TUNING } from './tuning';
export { SIM_CODES, SIM_THROWN_CODES, type SimCode } from './codes';
export type {
  HeadlessRunReport,
  MapValidationIssue,
  MapValidationReport,
  PrepareOptions,
  PrepareStep,
  PreparedMap,
  SimValidationCode,
  Simulation,
  SimulationDeps,
  SpawnPlan,
} from './types';
