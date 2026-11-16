/**
 * Plain rectangle and box arithmetic used by checkMapData and the checklist
 * (business-logic-model-map-data, workflow 3). Nothing here is a collision
 * query, nothing allocates through throwing core constructors, and nothing
 * throws on type-valid input (SD-M-06).
 */
import type { AABB, Vec3 } from '../core';
import { EPS, MAP_RULES, WALKABLE_KINDS } from './rules';
import type { Ramp, Solid } from './types';

/** xz rectangle. */
export interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Box with plain fields (never built through core aabb()). */
export interface Box {
  readonly min: Readonly<Vec3>;
  readonly max: Readonly<Vec3>;
}

/** A walkable top: a solid's top face or nothing else (ramps are handled separately). */
export interface Top extends Rect {
  readonly y: number;
  /** Index into solids. */
  readonly source: number;
}

export function rectOf(b: Box): Rect {
  return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
}

export function rampRect(r: Ramp): Rect {
  return { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
}

export function rampBox(r: Ramp): Box {
  return { min: { x: r.minX, y: r.baseY, z: r.minZ }, max: { x: r.maxX, y: r.topY, z: r.maxZ } };
}

/** Strict overlap: touching faces do not overlap (same semantics as core aabbOverlaps). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}

/** Strict xz overlap of two rectangles. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

/** Inclusive containment of a point, with tolerance. */
export function boxContains(b: Box, p: Readonly<Vec3>, eps = EPS): boolean {
  return (
    p.x >= b.min.x - eps &&
    p.x <= b.max.x + eps &&
    p.y >= b.min.y - eps &&
    p.y <= b.max.y + eps &&
    p.z >= b.min.z - eps &&
    p.z <= b.max.z + eps
  );
}

/** Inclusive containment of box `inner` in box `outer`, with tolerance. */
export function boxInside(inner: Box, outer: Box, eps = EPS): boolean {
  return boxContains(outer, inner.min, eps) && boxContains(outer, inner.max, eps);
}

export function rectContainsXZ(r: Rect, x: number, z: number, shrink = 0): boolean {
  return (
    x >= r.minX + shrink - EPS &&
    x <= r.maxX - shrink + EPS &&
    z >= r.minZ + shrink - EPS &&
    z <= r.maxZ - shrink + EPS
  );
}

/** True when the xz centre of `b` lies inside `region` (how "inside the tag region" is read). */
export function centreInside(b: Box, region: Box): boolean {
  return rectContainsXZ(rectOf(region), (b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
}

export function width(r: Rect): number {
  return r.maxX - r.minX;
}

export function depth(r: Rect): number {
  return r.maxZ - r.minZ;
}

/** Walkable tops from WALKABLE_KINDS solids, skipping the indices in `skip`. */
export function walkableTops(solids: readonly Solid[], skip: ReadonlySet<number>): Top[] {
  const tops: Top[] = [];
  solids.forEach((s, i) => {
    if (skip.has(i) || !WALKABLE_KINDS.has(s.kind)) return;
    tops.push({ ...rectOf(s.box), y: s.box.max.y, source: i });
  });
  return tops;
}

/** Is there a top at p.y whose rectangle, shrunk by `shrink`, contains (p.x, p.z)? */
export function standsOn(p: Readonly<Vec3>, tops: readonly Top[], shrink: number): boolean {
  return tops.some((t) => Math.abs(t.y - p.y) <= EPS && rectContainsXZ(t, p.x, p.z, shrink));
}

/** Surface height of a ramp at (x, z), or null when (x, z) is outside the footprint. */
export function rampSurfaceY(r: Ramp, x: number, z: number): number | null {
  if (!rectContainsXZ(rampRect(r), x, z)) return null;
  const rise = r.topY - r.baseY;
  let t: number;
  switch (r.up) {
    case '+x':
      t = (x - r.minX) / (r.maxX - r.minX);
      break;
    case '-x':
      t = (r.maxX - x) / (r.maxX - r.minX);
      break;
    case '+z':
      t = (z - r.minZ) / (r.maxZ - r.minZ);
      break;
    case '-z':
      t = (r.maxZ - z) / (r.maxZ - r.minZ);
      break;
  }
  return r.baseY + Math.min(1, Math.max(0, t)) * rise;
}

/** Extent of the ramp along `up` (run) and across it (width). */
export function rampRunWidth(r: Ramp): { run: number; width: number } {
  const dx = r.maxX - r.minX;
  const dz = r.maxZ - r.minZ;
  return r.up === '+x' || r.up === '-x' ? { run: dx, width: dz } : { run: dz, width: dx };
}

/** Length of the overlap of [a0, a1] and [b0, b1] (0 when disjoint). */
export function overlapLength(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * The ramp's low or high edge as a segment at baseY or topY. True when a
 * walkable top at that height contains the edge line and overlaps the segment
 * over at least width - EPS (BR-M-40).
 */
export function edgeSupported(r: Ramp, end: 'low' | 'high', tops: readonly Top[]): boolean {
  const y = end === 'low' ? r.baseY : r.topY;
  const alongX = r.up === '+z' || r.up === '-z';
  const highAtMax = r.up === '+x' || r.up === '+z';
  const atMax = end === 'high' ? highAtMax : !highAtMax;
  const line = alongX ? (atMax ? r.maxZ : r.minZ) : atMax ? r.maxX : r.minX;
  const { width: w } = rampRunWidth(r);
  return tops.some((t) => {
    if (Math.abs(t.y - y) > EPS) return false;
    if (alongX) {
      if (line < t.minZ - EPS || line > t.maxZ + EPS) return false;
      return overlapLength(t.minX, t.maxX, r.minX, r.maxX) >= w - EPS;
    }
    if (line < t.minX - EPS || line > t.maxX + EPS) return false;
    return overlapLength(t.minZ, t.maxZ, r.minZ, r.maxZ) >= w - EPS;
  });
}

/** Closest point of a rectangle to (x, z). */
export function closestPoint(r: Rect, x: number, z: number): { x: number; z: number } {
  return {
    x: Math.min(r.maxX, Math.max(r.minX, x)),
    z: Math.min(r.maxZ, Math.max(r.minZ, z)),
  };
}

/** xz distance from (x, z) to a rectangle (0 inside). */
export function rectDistance(r: Rect, x: number, z: number): number {
  const c = closestPoint(r, x, z);
  return Math.hypot(c.x - x, c.z - z);
}

/** Total length of the union of intervals. */
export function unionLength(intervals: readonly (readonly [number, number])[]): number {
  const sorted = intervals.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let curA = Number.NEGATIVE_INFINITY;
  let curB = Number.NEGATIVE_INFINITY;
  for (const [a, b] of sorted) {
    if (a > curB) {
      if (curB > curA) total += curB - curA;
      curA = a;
      curB = b;
    } else if (b > curB) {
      curB = b;
    }
  }
  if (curB > curA) total += curB - curA;
  return total;
}

export type Side = '-x' | '+x' | '-z' | '+z';

/**
 * Fraction of one side of `region` touched by the given solids: a solid
 * touches when its xz extent spans the side line (within EPS). The covered
 * length is the union of the solids' intervals along the side, clipped to it.
 */
export function sideContact(region: Rect, side: Side, solids: readonly Solid[]): number {
  const alongX = side === '-z' || side === '+z';
  const line =
    side === '-x'
      ? region.minX
      : side === '+x'
        ? region.maxX
        : side === '-z'
          ? region.minZ
          : region.maxZ;
  const a0 = alongX ? region.minX : region.minZ;
  const a1 = alongX ? region.maxX : region.maxZ;
  const intervals: [number, number][] = [];
  for (const s of solids) {
    const r = rectOf(s.box);
    const lo = alongX ? r.minZ : r.minX;
    const hi = alongX ? r.maxZ : r.maxX;
    if (line < lo - EPS || line > hi + EPS) continue;
    const b0 = Math.max(a0, alongX ? r.minX : r.minZ);
    const b1 = Math.min(a1, alongX ? r.maxX : r.maxZ);
    if (b1 > b0) intervals.push([b0, b1]);
  }
  const len = a1 - a0;
  return len > 0 ? unionLength(intervals) / len : 0;
}

/** The box a capsule of `height` occupies when standing at p (BR-M-49). */
export function capsuleBox(p: Readonly<Vec3>, height: number): Box {
  const r = MAP_RULES.agentRadius;
  return {
    min: { x: p.x - r, y: p.y + EPS, z: p.z - r },
    max: { x: p.x + r, y: p.y + height, z: p.z + r },
  };
}

/** Index of the first solid or ramp bounding box the capsule strictly overlaps, or null. */
export function capsuleBlocked(
  cap: Box,
  solids: readonly Solid[],
  ramps: readonly Ramp[],
  skipSolids: ReadonlySet<number>,
  skipRamps: ReadonlySet<number>,
): string | null {
  for (let i = 0; i < solids.length; i += 1) {
    const s = solids[i];
    if (s !== undefined && !skipSolids.has(i) && boxesOverlap(cap, s.box)) return `solid ${i}`;
  }
  for (let i = 0; i < ramps.length; i += 1) {
    const r = ramps[i];
    if (r !== undefined && !skipRamps.has(i) && boxesOverlap(cap, rampBox(r))) return `ramp ${i}`;
  }
  return null;
}

/** True when every component of the box is finite. */
export function boxFinite(b: Box | AABB): boolean {
  return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite);
}
