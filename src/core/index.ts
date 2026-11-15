/**
 * core-kernel public surface. Simulation-ring code imports from here.
 * Nothing in src/core reads global time, randomness or DOM state (BR-F-01).
 */
export * from './errors';
export * from './types';
export * from './diagnostics';
export * from './rng';
export * from './clock';
export * from './event-buffer';
export * from './profiler';
export * from './math/index';
