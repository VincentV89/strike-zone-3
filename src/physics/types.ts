/**
 * collision-world types (domain-entities-collision-nav). They live here, not in
 * src/contracts (SD-CN-03); other units import them from src/physics/index.ts.
 */
import type { AABB, Vec3 } from '../core';

/**
 * The actor shape: an upright cylinder with the feet at the position
 * (FD-CN-03). The Capsule name is kept from component-methods.
 */
export interface Capsule {
  /** > 0 (m). Player and bots use MAP_RULES.agentRadius = 0.4. */
  readonly radius: number;
  /** > 2 x EPS (m). Standing 1.8, crouched 1.2. */
  readonly height: number;
}

export interface MoveResult {
  /** Feet after the move. */
  position: Vec3;
  /** Input velocity with blocked components removed. */
  velocity: Vec3;
  grounded: boolean;
  hitCeiling: boolean;
  /** Grounded now, airborne at the start of this call. */
  landed: boolean;
}

export interface RayHit {
  /** Along the normalised direction (m). */
  distance: number;
  point: Vec3;
  /** Unit; faces the ray origin. */
  normal: Vec3;
  /** Index into def.solids, or -1 for a ramp. */
  solidIndex: number;
  /** Index into def.ramps, or -1 for a box (FD-CN-06). */
  rampIndex: number;
}

/**
 * Static map geometry and the queries over it. Read-only after construction;
 * every query is a pure function of its arguments and the geometry. Not
 * re-entrant: one simulation thread uses it (LC-CN-13).
 */
export interface CollisionWorld {
  moveCapsule(
    pos: Vec3,
    vel: Vec3,
    capsule: Capsule,
    dt: number,
    stepHeight: number,
    out?: MoveResult,
  ): MoveResult;
  raycast(origin: Vec3, dir: Vec3, maxDist: number, out?: RayHit): RayHit | null;
  /** True when nothing blocks the segment a-b. Fails closed on bad input. */
  lineOfSight(a: Vec3, b: Vec3): boolean;
  capsuleFits(pos: Vec3, capsule: Capsule): boolean;
  /** Can an actor walk on the ground from `from` to `to`? stepHeight defaults to 0.35. */
  sweepClear(from: Vec3, to: Vec3, capsule: Capsule, stepHeight?: number): boolean;
  /** Pushes two overlapping actors apart without pushing either into geometry. Mutates posA/posB. */
  separate(posA: Vec3, capA: Capsule, posB: Vec3, capB: Capsule): boolean;
  /** Copy of def.bounds. */
  readonly bounds: Readonly<AABB>;
  /** Boxes plus ramps. */
  readonly shapeCount: number;
}
