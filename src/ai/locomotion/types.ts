/** bot-locomotion types (domain-entities-bot-ai, ADR-017). */
import type { Diagnostics, EntityId, Vec3 } from '../../core';
import type { LocomotionStatus } from '../../contracts';
import type { NavGraph, PathAvoid, PathService, PathTicket } from '../../nav';
import type { Capsule, CollisionWorld, MoveResult } from '../../physics';

export interface NeighbourView {
  readonly id: EntityId;
  readonly pos: Readonly<Vec3>;
  readonly alive: boolean;
}

/** Read-only per-tick context. No player field (SD-AI-01). */
export interface LocoContext {
  tick: number;
  dt: number;
  world: CollisionWorld;
  paths: PathService;
  graph: NavGraph;
  /** Alive bots near this one (any order); the bot itself may appear and is skipped. */
  neighbours: readonly NeighbourView[];
  /** MAP_RULES dimensions, passed in by game-simulation (no map-data edge). */
  standing: Capsule;
  crouched: Capsule;
  stepHeight: number;
  diag: Diagnostics;
}

/** One bot's movement state. Owned by game-simulation's BotAgent; mutated only here. */
export interface BotMotionState {
  readonly id: EntityId;
  readonly pos: Vec3;
  readonly vel: Vec3;
  /** Travel heading only; view facing belongs to the aim state (BR-AI-68). */
  yaw: number;
  grounded: boolean;
  /** Requested by the intent. */
  crouch: boolean;
  /** The capsule actually used last tick. */
  crouched: boolean;
  speed: 'walk' | 'run';
  status: LocomotionStatus;
  /** The brain's goal (points at goalStore) or null. */
  goal: Vec3 | null;
  avoid: PathAvoid | null;
  ticket: PathTicket | null;
  /** Waypoints as x,y,z triples (SD-AI-09). */
  readonly path: Float64Array;
  pathLen: number;
  waypoint: number;
  /** The path was cut at MAX_PATH_POINTS; repath when its end is reached. */
  truncated: boolean;
  repath: boolean;
  waitLos: boolean;
  /** Watchdog: 0 = calm, 1..2 repaths done, 3 nudged. */
  stage: number;
  repaths: number;
  progressRefTick: number;
  readonly progressRef: Vec3;
  /** Watchdog nudge in progress: dest is the nearest node, goal is unchanged. */
  nudging: boolean;
  /** Where the current path leads: the goal, or the nudge node. */
  readonly dest: Vec3;
  readonly goalStore: Vec3;
  readonly avoidStore: { center: Vec3; radius: number; penalty: number };
  /** Per-bot scratch (no module-level mutable state). */
  readonly scratchA: Vec3;
  readonly scratchB: Vec3;
  readonly move: MoveResult;
  readonly reqPlain: { from: Vec3; to: Vec3 };
  readonly reqAvoid: {
    from: Vec3;
    to: Vec3;
    avoid: { center: Vec3; radius: number; penalty: number };
  };
}
