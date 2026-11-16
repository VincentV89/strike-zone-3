/**
 * bot-brain types (domain-entities-bot-ai). BrainContext, BotSelf and
 * BotAimContext have explicit fields only and no player field, so "decision
 * code reads only perception memory" holds at compile time (BR-AI-01, SD-AI-01).
 */
import type { Diagnostics, EntityId, Rng, Vec3 } from '../../core';
import type { BotIntent, Difficulty, LocomotionStatus } from '../../contracts';
import type { NavGraph, NavNodeId } from '../../nav';
import type { CollisionWorld } from '../../physics';
import type { PerceptionMemory, PerceptionProfile } from '../perception';

export type BotStateName =
  'patrol' | 'investigate' | 'engage' | 'take-cover' | 'flank' | 'retreat' | 'dead';

/** Facts about the bot itself, built by game-simulation each decide. */
export interface BotSelf {
  id: EntityId;
  pos: Vec3;
  yaw: number;
  health: number;
  armor: number;
  mag: number;
  reserve: number;
  reloading: boolean;
  locomotion: LocomotionStatus;
}

/** Behaviour-only tuning (BR-AI-50: no health or armor field). */
export interface DifficultyProfile {
  readonly level: Difficulty;
  readonly perception: PerceptionProfile;
  readonly reactionTicks: number;
  readonly aimErrorRad: number;
  readonly aimSettleTicks: number;
  readonly aimSettleFloor: number;
  /** Radians per second, per axis. */
  readonly turnRateRad: number;
  readonly burstTicks: number;
  readonly burstPauseTicks: number;
  readonly aggression: number;
  readonly repositionTicks: number;
  readonly coverChance: number;
  readonly flankChance: number;
  readonly coverHoldTicks: number;
  readonly retreatHealth: number;
  readonly engageMin: number;
  readonly engageMax: number;
}

export type CoverPointId = number;

/** Structural cover point, so brain needs no map-data edge (game-simulation passes def.cover). */
export interface CoverPointLike {
  readonly pos: Readonly<Vec3>;
  readonly facing: Readonly<Vec3>;
  readonly height: 'low' | 'high';
}

/** Per-round, shared by all bots. A point has at most one claimant; a bot holds at most one claim. */
export interface CoverRegistry {
  claim(id: EntityId, p: CoverPointId): boolean;
  release(id: EntityId): void;
  claimedBy(p: CoverPointId): EntityId | null;
  claimOf(id: EntityId): CoverPointId | null;
  /** Nearest free point within 25 m whose line of sight from `threat` is blocked; at most 8 LOS tests. */
  best(from: Vec3, threat: Vec3, world: CollisionWorld, self: EntityId): CoverPointId | null;
  point(p: CoverPointId): CoverPointLike;
  readonly size: number;
  noteFlank(id: EntityId, side: -1 | 1): void;
  releaseFlank(id: EntityId): void;
  flankCount(side: -1 | 1): number;
}

/** Per-round BFS work memory, sized to the nav graph (SD-AI-12). */
export interface BrainScratch {
  readonly stamp: Uint32Array;
  /** Visit order of the last BFS. */
  readonly visited: Int32Array;
  readonly candidates: Int32Array;
  generation: number;
}

/** Read-only per-decide context. No player field (BR-AI-01). */
export interface BrainContext {
  tick: number;
  /** The bot's `ai:<id>` stream. */
  rng: Rng;
  graph: NavGraph;
  cover: CoverRegistry;
  world: CollisionWorld;
  scratch: BrainScratch;
  diag: Diagnostics;
}

export interface BotBrain {
  readonly id: EntityId;
  readonly state: BotStateName;
  readonly stateEnteredTick: number;
  readonly profile: DifficultyProfile;
  /** Returns the bot's reused intent object. */
  decide(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
  ): Readonly<BotIntent>;
  onDeath(tick: number, cover: CoverRegistry): void;
  /** The last intent returned (the held intent for aim and movement). */
  readonly intent: Readonly<BotIntent>;
  /** Entries per state, for tests and the difficulty comparison. */
  readonly stats: Readonly<Record<BotStateName, number>>;
}

export interface BotAimState {
  yaw: number;
  pitch: number;
  /** Unit-ish error direction scaled by r in [0.5, 1). */
  errYaw: number;
  errPitch: number;
  errRedrawTick: number;
  burstUntilTick: number;
  pauseUntilTick: number;
  lastFireAllowed: boolean;
}

/** Per-tick aim context. No player field (SD-AI-01). */
export interface BotAimContext {
  tick: number;
  dt: number;
  eye: Vec3;
  vel: Vec3;
  mag: number;
  reloading: boolean;
  profile: DifficultyProfile;
  /** The bot's `aim/<id>` stream. */
  rng: Rng;
  diag: Diagnostics;
}

export interface AiScheduler {
  readonly senseInterval: number;
  readonly decideInterval: number;
  /** True when bot `id` senses this tick (staggered, or once after wake). */
  shouldSense(id: EntityId, tick: number): boolean;
  shouldDecide(id: EntityId, tick: number): boolean;
  /** The next shouldSense and shouldDecide for `id` return true once (BR-AI-11). */
  wake(id: EntityId): void;
}

export type { NavNodeId };
