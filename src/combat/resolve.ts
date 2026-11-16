/**
 * resolveShot (BR-PC-40..44, SD-PC-11, SD-PC-12, SD-PC-14): one raycast per
 * shot bounds every hitbox test, the nearest entity wins, head wins a tie,
 * lower list index wins between entities. Allocates nothing.
 */
import {
  addScaled,
  copy,
  rayAabb,
  set,
  vec3,
  type AABB,
  type Diagnostics,
  type EntityId,
  type Vec3,
} from '../core';
import type { CollisionWorld } from '../physics';
import type { FireRequest, WeaponProfile } from '../weapons';
import type { ShotOutcome, ShotTarget, Vitals } from './types';

/** Targets tested per shot; longer lists report `combat/too-many-targets`. */
export const MAX_SHOT_TARGETS = 32;
const HEAD_TIE = 1e-6;
const MIN_DIR = 1e-6;

const dir = vec3();
const finite = Number.isFinite;

function finiteBox(b: AABB): boolean {
  return (
    finite(b.min.x) &&
    finite(b.min.y) &&
    finite(b.min.z) &&
    finite(b.max.x) &&
    finite(b.max.y) &&
    finite(b.max.z)
  );
}

export function createShotOutcome(): ShotOutcome {
  return {
    hit: null,
    blockedBy: null,
    impact: null,
    distance: 0,
    end: vec3(),
    hitStore: { target: 0 as EntityId, headshot: false, damage: 0, point: vec3() },
    impactStore: { distance: 0, point: vec3(), normal: vec3(), solidIndex: -1, rampIndex: -1 },
  };
}

/** Raw damage: body, or round(damage x headMult) on the head (BR-PC-44). */
export function rawDamage(profile: WeaponProfile, headshot: boolean): number {
  return headshot ? Math.round(profile.damage * profile.headMult) : profile.damage;
}

/** Normalises req.dir into `out`; false (and `combat/bad-ray`) when the ray is unusable. */
function rayOk(req: FireRequest, out: Vec3, diag: Diagnostics | undefined): boolean {
  const o = req.origin;
  const d = req.dir;
  const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
  if (!finite(o.x) || !finite(o.y) || !finite(o.z) || !finite(len) || len < MIN_DIR) {
    diag?.warnOnce('combat/bad-ray');
    return false;
  }
  set(out, d.x / len, d.y / len, d.z / len);
  return true;
}

/**
 * Shared core of resolveShot and executeShot. With a `vitals` lookup, dead
 * targets are skipped and a damageable target with no Vitals blocks the shot
 * (fail closed, `combat/unknown-target`). Returns false on a bad ray, with the
 * outcome set to a miss at the origin.
 */
export function resolveInto(
  req: FireRequest,
  world: CollisionWorld,
  targets: readonly ShotTarget[],
  profile: WeaponProfile,
  vitals: ((id: EntityId) => Vitals | undefined) | undefined,
  out: ShotOutcome,
  diag: Diagnostics | undefined,
): boolean {
  out.hit = null;
  out.blockedBy = null;
  out.impact = null;
  out.distance = 0;
  copy(req.origin, out.end);
  if (!rayOk(req, dir, diag)) return false;

  const geo = world.raycast(req.origin, dir, profile.range, out.impactStore);
  let bestT = geo === null ? profile.range : geo.distance;
  let best: ShotTarget | null = null;
  let bestHead = false;
  let bestDamageable = false;

  if (targets.length > MAX_SHOT_TARGETS) diag?.warnOnce('combat/too-many-targets');
  const n = Math.min(targets.length, MAX_SHOT_TARGETS);
  for (let i = 0; i < n; i++) {
    const t = targets[i];
    if (t === undefined || t.id === req.shooter) continue;
    let damageable = t.damageable;
    if (vitals !== undefined) {
      const v = vitals(t.id);
      if (v === undefined) {
        if (damageable) diag?.warnOnce('combat/unknown-target');
        damageable = false;
      } else if (!v.alive) {
        continue;
      }
    }
    const hb = t.hitboxes;
    if (!finiteBox(hb.head) || !finiteBox(hb.body)) {
      diag?.warnOnce('combat/unknown-target');
      continue;
    }
    const th = rayAabb(req.origin, dir, bestT, hb.head);
    const tb = rayAabb(req.origin, dir, bestT, hb.body);
    if (th === null && tb === null) continue;
    const head = th !== null && (tb === null || th <= tb + HEAD_TIE);
    const tHit = head ? th : (tb as number);
    if (tHit < bestT) {
      best = t;
      bestT = tHit;
      bestHead = head;
      bestDamageable = damageable;
    }
  }

  out.distance = bestT;
  addScaled(req.origin, dir, bestT, out.end);
  if (best === null) {
    out.impact = geo;
    return true;
  }
  if (bestDamageable) {
    const h = out.hitStore;
    h.target = best.id;
    h.headshot = bestHead;
    h.damage = rawDamage(profile, bestHead);
    copy(out.end, h.point);
    out.hit = h;
  } else {
    out.blockedBy = best.id;
  }
  return true;
}

/**
 * Nearest hit for one shot, written into `out` (from createShotOutcome).
 * Exactly one world.raycast; no damage is applied here.
 */
export function resolveShot(
  req: FireRequest,
  world: CollisionWorld,
  targets: readonly ShotTarget[],
  profile: WeaponProfile,
  out: ShotOutcome,
  diag?: Diagnostics,
): ShotOutcome {
  resolveInto(req, world, targets, profile, undefined, out, diag);
  return out;
}
