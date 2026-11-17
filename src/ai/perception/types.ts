/**
 * bot-perception types (domain-entities-bot-ai). SenseInput is the only shape
 * that carries live player data into bot-ai (SD-AI-01, BR-AI-02).
 */
import type { EntityId, Vec3 } from '../../core';
import type { SimEvent } from '../../contracts';

export type NoiseEvent = Extract<SimEvent, { t: 'noise' }>;
export type DamageEvent = Extract<SimEvent, { t: 'damage' }>;

/**
 * What one bot knows about the player. Written only by sense(). Nullable
 * vectors point at the memory's own preallocated stores or are null, so a
 * sense allocates nothing (BR-AI-09). Never alias the stores.
 */
export interface PerceptionMemory {
  /** Player seen at the last sense. */
  visible: boolean;
  /** The target point that passed the sight test, or null if never seen. */
  lastSeenPos: Vec3 | null;
  /** -1 = never. */
  lastSeenTick: number;
  /** Start of the current sighting; drives the reaction delay. */
  firstSeenTick: number | null;
  /** Heard player gunfire, with position error (never exact). */
  suspectedPos: Vec3 | null;
  /** -1 = never. */
  suspectedTick: number;
  /** Unit xz direction bot -> attacker, from damage.fromDir. Never a position. */
  threatDir: Vec3 | null;
  /** -1 = never. */
  underFireTick: number;
  /** Events with tick <= this were already consumed. */
  lastSenseTick: number;
  /** Backing storage for the nullable vectors; read the fields above instead. */
  readonly seenStore: Vec3;
  readonly suspectStore: Vec3;
  readonly threatStore: Vec3;
}

export interface PerceptionProfile {
  readonly fovRad: number;
  readonly sightRange: number;
  readonly hearingMult: number;
  readonly hearingErrorFrac: number;
  readonly hearingErrorMin: number;
  readonly reacquireGraceTicks: number;
  readonly memoryTicks: number;
  readonly suspicionTicks: number;
}

export interface SenseInput {
  /** The sensing bot; damage events for other targets are ignored. */
  selfId: EntityId;
  selfEye: Vec3;
  selfYaw: number;
  /** [chest, head, knees] of the live player; empty when the player is dead (BR-AI-02). */
  targetPoints: readonly Vec3[];
  /** Recent event window; perception keeps only player gunfire newer than lastSenseTick. */
  noises: readonly NoiseEvent[];
  /** Recent damage events; perception keeps only target === selfId newer than lastSenseTick. */
  damageTaken: readonly DamageEvent[];
  tick: number;
}
