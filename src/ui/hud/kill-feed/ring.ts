/**
 * Kill-feed ring (Should, story-kill-feed). Four fixed records; the oldest is
 * overwritten first (BR-H-18). Rows live 300 ticks and fade over the last 18.
 */
import type { WeaponId } from '../../../contracts';
import { entityLabel, weaponTag } from '../model/labels';
import { KILL_ROW_FADE_TICKS, KILL_ROW_TICKS, MAX_KILL_ROWS } from '../model/timing';

export interface KillFeedRow {
  active: boolean;
  killerLabel: string;
  weaponTag: string;
  headshot: boolean;
  victimLabel: string;
  involvesPlayer: boolean;
  startTick: number;
}

export interface KillFeedRing {
  readonly rows: KillFeedRow[];
  /** Index the next row is written to. */
  head: number;
}

export function createKillFeedRing(): KillFeedRing {
  return {
    rows: Array.from({ length: MAX_KILL_ROWS }, () => ({
      active: false,
      killerLabel: '',
      weaponTag: '',
      headshot: false,
      victimLabel: '',
      involvesPlayer: false,
      startTick: 0,
    })),
    head: 0,
  };
}

/** Adds one row for a kill event. */
export function pushKill(
  ring: KillFeedRing,
  killer: number,
  victim: number,
  weapon: WeaponId,
  headshot: boolean,
  tick: number,
): void {
  const row = ring.rows[ring.head];
  if (row === undefined) return;
  row.active = true;
  row.killerLabel = entityLabel(killer);
  row.weaponTag = weaponTag(weapon);
  row.headshot = headshot;
  row.victimLabel = entityLabel(victim);
  row.involvesPlayer = killer === 0 || victim === 0;
  row.startTick = tick;
  ring.head = (ring.head + 1) % ring.rows.length;
}

/** Deactivates rows older than 300 ticks. */
export function expireKills(ring: KillFeedRing, tick: number): void {
  for (const row of ring.rows) {
    if (row.active && tick - row.startTick >= KILL_ROW_TICKS) row.active = false;
  }
}

/** Row opacity at `tick`: 1, then a linear ramp over the last 18 ticks; 0 before its tick. */
export function killRowOpacity(
  row: Readonly<KillFeedRow>,
  tick: number,
  reducedMotion: boolean,
): number {
  if (!row.active) return 0;
  const age = tick - row.startTick;
  if (age < 0 || age >= KILL_ROW_TICKS) return 0;
  if (reducedMotion) return 1;
  return Math.min(1, (KILL_ROW_TICKS - age) / KILL_ROW_FADE_TICKS);
}

/** The i-th row counted newest first (0 = newest), active or not. */
export function rowNewestFirst(ring: KillFeedRing, i: number): KillFeedRow | undefined {
  const n = ring.rows.length;
  return ring.rows[(((ring.head - 1 - i) % n) + n) % n];
}

export function clearKills(ring: KillFeedRing): void {
  for (const row of ring.rows) row.active = false;
  ring.head = 0;
}
