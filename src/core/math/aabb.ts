import { StrikeZoneError } from '../errors';
import { vec3, type Vec3 } from './vec3';

const AXES = ['x', 'y', 'z'] as const;

/** Axis-aligned box. Invariant: min <= max on every axis. */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

/** @throws StrikeZoneError('core/aabb-inverted') when any min component exceeds max. */
export function aabb(min: Vec3, max: Vec3): AABB {
  if (min.x > max.x || min.y > max.y || min.z > max.z) {
    throw new StrikeZoneError('core/aabb-inverted', 'AABB min must be <= max on every axis');
  }
  return { min: vec3(min.x, min.y, min.z), max: vec3(max.x, max.y, max.z) };
}

export function aabbFromCenter(center: Vec3, half: Vec3): AABB {
  return aabb(
    vec3(center.x - half.x, center.y - half.y, center.z - half.z),
    vec3(center.x + half.x, center.y + half.y, center.z + half.z),
  );
}

/** Inclusive of the faces (BR-F-20). */
export function aabbContainsPoint(box: AABB, p: Vec3): boolean {
  return (
    p.x >= box.min.x &&
    p.x <= box.max.x &&
    p.y >= box.min.y &&
    p.y <= box.max.y &&
    p.z >= box.min.z &&
    p.z <= box.max.z
  );
}

/** Strict: boxes that only touch faces do not overlap (BR-F-20). */
export function aabbOverlaps(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}

/** Grows the box by `r` on every side. */
export function aabbExpand(box: AABB, r: number): AABB {
  return aabb(
    vec3(box.min.x - r, box.min.y - r, box.min.z - r),
    vec3(box.max.x + r, box.max.y + r, box.max.z + r),
  );
}

export function aabbUnion(a: AABB, b: AABB): AABB {
  return {
    min: vec3(Math.min(a.min.x, b.min.x), Math.min(a.min.y, b.min.y), Math.min(a.min.z, b.min.z)),
    max: vec3(Math.max(a.max.x, b.max.x), Math.max(a.max.y, b.max.y), Math.max(a.max.z, b.max.z)),
  };
}

/**
 * Slab-method ray cast. Returns the entry distance t in [0, maxDist], or null.
 * An origin inside the box returns 0. `dir` need not be normalised; t is in
 * units of `dir`. Allocates nothing.
 */
export function rayAabb(origin: Vec3, dir: Vec3, maxDist: number, box: AABB): number | null {
  let tMin = 0;
  let tMax = maxDist;
  for (const axis of AXES) {
    const o = origin[axis];
    const d = dir[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (d === 0) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (lo - o) * inv;
    let t2 = (hi - o) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  return tMin;
}
