/** combat types (domain-entities-player-combat). */
import type { AABB, EntityId, Vec3 } from '../core';
import type { RayHit } from '../physics';

/** One per actor. `alive` becomes false exactly once. */
export interface Vitals {
  health: number;
  armor: number;
  alive: boolean;
  deathTick: number | null;
}

export interface ArmorModel {
  /** Share of each hit armor absorbs while armor > 0 (FD-PC-Q1). */
  readonly absorbRatio: number;
}

/** World-space head and body boxes, reused per actor (hitboxesFor). */
export interface Hitboxes {
  head: AABB;
  body: AABB;
}

export interface ShotTarget {
  id: EntityId;
  hitboxes: Hitboxes;
  /** false: the target blocks the shot but takes no damage (ADR-018). */
  damageable: boolean;
}

export interface ShotHit {
  target: EntityId;
  headshot: boolean;
  /** Raw damage before armor. */
  damage: number;
  point: Vec3;
}

/**
 * Reused per call through `out` (createShotOutcome). `hit` and `impact` point
 * at the outcome's own storage objects or are null.
 */
export interface ShotOutcome {
  hit: ShotHit | null;
  blockedBy: EntityId | null;
  impact: RayHit | null;
  /** Along the ray (m), where the tracer stops. */
  distance: number;
  end: Vec3;
  /** Backing storage for `hit` and `impact`; never read these directly. */
  readonly hitStore: ShotHit;
  readonly impactStore: RayHit;
}

export interface DamageResult {
  healthLoss: number;
  armorLoss: number;
  died: boolean;
}
