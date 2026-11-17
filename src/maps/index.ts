/**
 * map-data public surface (SEC-M-03). Code outside src/maps imports this file
 * only; map modules, builders and deepFreeze stay private.
 */
export { getMap, mapIds } from './registry';
export { checkMapData } from './check';
export { REQUIRED_FEATURES } from './checklist';
export { MAP_RULES, WALKABLE_KINDS } from './rules';
export type * from './types';
