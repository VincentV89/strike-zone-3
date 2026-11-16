/**
 * match-stats types (domain-entities-game-simulation). The field names
 * kills, deaths, headshots, shotsFired and shotsHit match hud's HudStats;
 * contracts do not change (BR-GS-90).
 */
import type { EntityId } from '../../core';
import type { RoundOutcome, SimEvent } from '../../contracts';

export interface RoundStats {
  kills: number;
  deaths: number;
  /** Player kills whose killing hit was a headshot (FD-GS-Q2 = A). */
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  /** 0..1; 0 when shotsFired = 0. */
  accuracy: number;
  damageDealt: number;
  damageTaken: number;
  armorLost: number;
  enemiesTotal: number;
  enemiesLeft: number;
  /** The bot that killed the player. */
  killerId: EntityId | null;
  /** -1 before live. */
  liveStartTick: number;
  lastTick: number;
  durationSec: number;
  outcome: RoundOutcome | null;
}

export interface SessionStats {
  readonly roundsWon: number;
  readonly roundsLost: number;
}

export interface StatsTracker {
  ingest(events: readonly SimEvent[]): void;
  /** The same mutable object every call (BR-GS-89). */
  round(): Readonly<RoundStats>;
  commit(outcome: RoundOutcome): SessionStats;
  discard(): void;
  session(): Readonly<SessionStats>;
}
