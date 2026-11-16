/**
 * match-stats public surface (src/sim/stats). It depends only on core (R)
 * and contracts (T) and has no edge to game-simulation (SD-GS-07).
 */
export { EMPTY_SESSION, createStatsTracker } from './tracker';
export type { RoundStats, SessionStats, StatsTracker } from './types';
