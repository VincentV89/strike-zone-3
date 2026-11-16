/**
 * Cover registry (BR-AI-28, BR-AI-70, BR-AI-71, business-logic-model-bot-ai §6).
 * One per round, shared by all bots. best() visits free points within 25 m in
 * ascending distance (ties to the lower index) and stops after 8 LOS tests, so
 * the first blocked candidate is the nearest one.
 */
import { StrikeZoneError, type EntityId, type Vec3 } from '../../core';
import type { CollisionWorld } from '../../physics';
import { finite3 } from './guard';
import { MAX_BOTS } from './scheduler';
import type { CoverPointLike, CoverRegistry } from './types';

export const COVER_MAX_LOS = 8;
export const COVER_RADIUS_M = 25;
export const MAX_COVER_POINTS = 80;
/** A cover point must be at least this far from the threat (m). */
export const COVER_MIN_THREAT_DIST = 6;
/** dot(facing, toThreat) must exceed this. */
export const COVER_FACING_MIN = 0.3;
/** Eye height above a cover point for the blocked-sight test (m). */
export const COVER_EYE_LOW = 1.1;
export const COVER_EYE_HIGH = 1.6;

const isHeight = (h: unknown): boolean => h === 'low' || h === 'high';

/** @throws StrikeZoneError('ai/bad-cover') for more than 80 points or a non-finite field. */
export function createCoverRegistry(points: readonly CoverPointLike[]): CoverRegistry {
  if (points.length > MAX_COVER_POINTS) {
    throw new StrikeZoneError('ai/bad-cover', 'Too many cover points');
  }
  for (const p of points) {
    if (!finite3(p.pos) || !finite3(p.facing) || !isHeight(p.height)) {
      throw new StrikeZoneError('ai/bad-cover', 'Cover point with a non-finite field');
    }
  }
  const n = points.length;
  const claimant = new Int32Array(n).fill(-1);
  const claimOf = new Int32Array(MAX_BOTS + 1).fill(-1);
  const flankSide = new Int8Array(MAX_BOTS + 1);
  const order = new Int32Array(n);
  const dist = new Float64Array(n);
  const eye: Vec3 = { x: 0, y: 0, z: 0 };
  const validBot = (id: number): boolean => Number.isInteger(id) && id >= 1 && id <= MAX_BOTS;
  const validPoint = (p: number): boolean => Number.isInteger(p) && p >= 0 && p < n;

  const release = (id: EntityId): void => {
    if (!validBot(id)) return;
    const p = claimOf[id] ?? -1;
    if (p >= 0) claimant[p] = -1;
    claimOf[id] = -1;
  };

  return {
    size: n,
    claim(id, p) {
      if (!validBot(id) || !validPoint(p)) return false;
      const holder = claimant[p] ?? -1;
      if (holder !== -1 && holder !== id) return false;
      release(id);
      claimant[p] = id;
      claimOf[id] = p;
      return true;
    },
    release,
    claimedBy(p) {
      if (!validPoint(p)) return null;
      const holder = claimant[p] ?? -1;
      return holder < 0 ? null : (holder as EntityId);
    },
    claimOf(id) {
      if (!validBot(id)) return null;
      const p = claimOf[id] ?? -1;
      return p < 0 ? null : p;
    },
    point(p) {
      const c = points[p];
      if (c === undefined) throw new StrikeZoneError('ai/bad-cover', 'Unknown cover point');
      return c;
    },
    best(from, threat, world: CollisionWorld, self) {
      if (!finite3(from) || !finite3(threat)) return null;
      let m = 0;
      const r2 = COVER_RADIUS_M * COVER_RADIUS_M;
      for (let i = 0; i < n; i++) {
        const c = points[i];
        if (c === undefined) continue;
        const holder = claimant[i] ?? -1;
        if (holder !== -1 && holder !== self) continue;
        const dx = c.pos.x - from.x;
        const dy = c.pos.y - from.y;
        const dz = c.pos.z - from.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        // insertion by ascending distance; equal distances keep index order
        let j = m;
        while (j > 0 && (dist[j - 1] ?? 0) > d2) {
          order[j] = order[j - 1] ?? 0;
          dist[j] = dist[j - 1] ?? 0;
          j--;
        }
        order[j] = i;
        dist[j] = d2;
        m++;
      }
      let tests = 0;
      for (let k = 0; k < m; k++) {
        const i = order[k] ?? 0;
        const c = points[i];
        if (c === undefined) continue;
        const tx = threat.x - c.pos.x;
        const tz = threat.z - c.pos.z;
        const tl = Math.hypot(tx, tz);
        if (tl < 1e-6 || (c.facing.x * tx + c.facing.z * tz) / tl <= COVER_FACING_MIN) continue;
        if (Math.hypot(tx, threat.y - c.pos.y, tz) < COVER_MIN_THREAT_DIST) continue;
        if (tests === COVER_MAX_LOS) break;
        tests++;
        eye.x = c.pos.x;
        eye.y = c.pos.y + (c.height === 'low' ? COVER_EYE_LOW : COVER_EYE_HIGH);
        eye.z = c.pos.z;
        if (!world.lineOfSight(threat, eye)) return i;
      }
      return null;
    },
    noteFlank(id, side) {
      if (validBot(id)) flankSide[id] = side === -1 ? -1 : 1;
    },
    releaseFlank(id) {
      if (validBot(id)) flankSide[id] = 0;
    },
    flankCount(side) {
      let c = 0;
      for (let i = 1; i <= MAX_BOTS; i++) if (flankSide[i] === side) c++;
      return c;
    },
  };
}
