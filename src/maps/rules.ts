/**
 * Agent dimensions and data budgets the maps are designed for
 * (business-rules-map-data, "Agent dimensions" and BR-M-88). player-combat
 * asserts its MovementTuning against MAP_RULES (BR-M-90).
 */
import type { SolidKind } from './types';

export const MAP_RULES = Object.freeze({
  /** Capsule radius, player and bots (m). */
  agentRadius: 0.4,
  /** Standing capsule height (m). */
  agentHeight: 1.8,
  /** Crouched capsule height (m). */
  crouchHeight: 1.2,
  /** Eye height used for line-of-sight design (m). */
  standEye: 1.6,
  /** Largest ledge the capsule steps up without a ramp (m). */
  stepHeight: 0.35,
  /** Steepest ramp authored: tan 30 degrees. */
  maxRampSlope: 0.5774,
  /** Assumed upper bound on jump height (m). */
  jumpApexMax: 1.5,
  /** Smallest xz distance between two spawn points (m). */
  spawnMinGap: 2.0,
  /** Minimum player-to-bot spawn distance the maps are laid out for (m). */
  minPlayerBotDistance: 20,
} as const);

/** Tolerance for every "equals" and "touches" comparison (m). */
export const EPS = 0.01;

/**
 * Per-map list budgets (BR-M-88). `features` is not in BR-M-88; it is added so
 * every list checkMapData walks pairwise is bounded (SEC-M-05).
 */
export const MAP_BUDGETS = Object.freeze({
  solids: 400,
  ramps: 32,
  spawns: 40,
  cover: 80,
  navHints: 64,
  features: 64,
  materials: 12,
  locals: 8,
} as const);

/** Kinds whose top face the nav baker samples and spawns may stand on (BR-M-21, FD-M-06). */
export const WALKABLE_KINDS: ReadonlySet<SolidKind> = lockedSet<SolidKind>([
  'ground',
  'floor',
  'platform',
  'walkway',
]);

/** A Set whose mutators throw, so an untyped caller cannot change shared rules (SEC-M-02). */
function lockedSet<T>(items: readonly T[]): ReadonlySet<T> {
  const set = new Set<T>(items);
  const refuse = (): never => {
    throw new TypeError('WALKABLE_KINDS is read-only');
  };
  Object.defineProperties(set, {
    add: { value: refuse },
    delete: { value: refuse },
    clear: { value: refuse },
  });
  return Object.freeze(set);
}
