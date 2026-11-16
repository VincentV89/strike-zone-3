/**
 * Player awareness and radar marks (stage 3, BR-GS-70..73, SD-GS-02).
 *
 * Live bot positions are read only to test sight. A mark stores the bot's
 * position at the time of the mark, and only marks are published, so the
 * radar cannot track a hidden bot (no wallhack). At most 2 rays per bot.
 */
import type { EntityId, Vec3 } from '../core';
import type { RadarContact } from '../contracts';
import type { CollisionWorld } from '../physics';
import { SIM_TUNING } from './tuning';

const NONE = 0;
const SEEN = 1;
const HEARD = 2;

export interface AwarenessTarget {
  readonly id: EntityId;
  readonly alive: boolean;
  /** Live feet position (read for the sight test only). */
  readonly pos: Readonly<Vec3>;
}

export interface Awareness {
  /** Seen marks for bots in range, in the cone and in sight (chest, then head). */
  update(tick: number, eye: Readonly<Vec3>, yaw: number, bots: readonly AwarenessTarget[]): void;
  /** A heard mark at `pos` (bot gunfire within range); never replaces a fresher seen mark. */
  markHeard(id: EntityId, pos: Readonly<Vec3>, tick: number, player: Readonly<Vec3>): void;
  clear(id: EntityId): void;
  /** Writes live contacts into `out` (reusing `pool` objects), sorted by id. */
  publish(
    tick: number,
    bots: readonly AwarenessTarget[],
    pool: readonly RadarContact[],
    out: RadarContact[],
  ): void;
}

export function createAwareness(world: CollisionWorld, botCount: number): Awareness {
  const n = SIM_TUNING.maxRadarContacts;
  const markPos = new Float64Array(3 * (n + 1));
  const markTick = new Int32Array(n + 1);
  const kind = new Uint8Array(n + 1);
  const point = { x: 0, y: 0, z: 0 };
  const r2 = SIM_TUNING.awarenessRange * SIM_TUNING.awarenessRange;
  const cosFov = Math.cos(SIM_TUNING.awarenessHalfFov);

  const valid = (id: number): boolean => Number.isInteger(id) && id >= 1 && id <= botCount;

  const mark = (id: number, k: number, p: Readonly<Vec3>, tick: number): void => {
    kind[id] = k;
    markTick[id] = tick;
    markPos[3 * id] = p.x;
    markPos[3 * id + 1] = p.y;
    markPos[3 * id + 2] = p.z;
  };

  const sees = (eye: Readonly<Vec3>, feet: Readonly<Vec3>): boolean => {
    point.x = feet.x;
    point.z = feet.z;
    point.y = feet.y + SIM_TUNING.awarenessChest;
    if (world.lineOfSight(eye, point)) return true;
    point.y = feet.y + SIM_TUNING.awarenessHead;
    return world.lineOfSight(eye, point);
  };

  return {
    update(tick, eye, yaw, bots) {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      for (const b of bots) {
        if (!b.alive || !valid(b.id)) continue;
        const dx = b.pos.x - eye.x;
        const dz = b.pos.z - eye.z;
        const d2 = dx * dx + dz * dz;
        if (!(d2 <= r2)) continue;
        const d = Math.sqrt(d2);
        // A bot on top of the player counts as in the cone.
        if (d > 1e-6 && (dx * fx + dz * fz) / d < cosFov) continue;
        if (sees(eye, b.pos)) mark(b.id, SEEN, b.pos, tick);
      }
    },
    markHeard(id, pos, tick, player) {
      if (!valid(id)) return;
      const dx = pos.x - player.x;
      const dz = pos.z - player.z;
      if (!(dx * dx + dz * dz <= r2)) return;
      const k = kind[id] ?? NONE;
      if (k === SEEN && tick - (markTick[id] ?? 0) <= SIM_TUNING.seenHoldTicks) return;
      mark(id, HEARD, pos, tick);
    },
    clear(id) {
      if (valid(id)) kind[id] = NONE;
    },
    publish(tick, bots, pool, out) {
      out.length = 0;
      for (const b of bots) {
        const id = b.id;
        if (!valid(id)) continue;
        const k = kind[id] ?? NONE;
        if (k === NONE) continue;
        const age = tick - (markTick[id] ?? 0);
        const hold = k === SEEN ? SIM_TUNING.seenHoldTicks : SIM_TUNING.heardHoldTicks;
        if (!b.alive || age > hold) {
          kind[id] = NONE;
          continue;
        }
        const c = pool[out.length];
        if (c === undefined) break;
        c.id = id;
        c.pos.x = markPos[3 * id] ?? 0;
        c.pos.y = markPos[3 * id + 1] ?? 0;
        c.pos.z = markPos[3 * id + 2] ?? 0;
        c.kind = k === SEEN ? 'seen' : 'heard';
        c.ageTicks = age;
        out.push(c);
      }
    },
  };
}
