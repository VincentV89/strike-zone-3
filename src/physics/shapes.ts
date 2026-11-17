/**
 * Cylinder against boxes and ramps (business-logic-model-collision-nav §2).
 * Internal to src/physics. Every function allocates nothing; results that are
 * more than one number go into caller-owned records.
 */
import { EPS } from './constants';
import { cellOf, gatherShapes, type Geometry } from './geometry';

/** Horizontal push-out: unit xz normal and depth. */
export interface Contact {
  nx: number;
  nz: number;
  depth: number;
}

export function createContact(): Contact {
  return { nx: 0, nz: 0, depth: 0 };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Squared horizontal contact limit for radius r: (r - EPS)^2, or 0 for tiny radii. */
export function contactLimitSq(r: number): number {
  const d = r - EPS;
  return d > 0 ? d * d : 0;
}

/** Ramp surface height at (x, z), with the position clamped to the footprint. */
export function rampSurface(g: Geometry, j: number, x: number, z: number): number {
  const minX = g.rMinX[j] ?? 0;
  const maxX = g.rMaxX[j] ?? 0;
  const minZ = g.rMinZ[j] ?? 0;
  const maxZ = g.rMaxZ[j] ?? 0;
  const axis = g.rAxis[j] ?? 0;
  let t: number;
  if (axis === 0) t = (x - minX) / (maxX - minX);
  else if (axis === 1) t = (maxX - x) / (maxX - minX);
  else if (axis === 2) t = (z - minZ) / (maxZ - minZ);
  else t = (maxZ - z) / (maxZ - minZ);
  const base = g.rBase[j] ?? 0;
  return base + ((g.rTop[j] ?? 0) - base) * clamp(t, 0, 1);
}

/** Highest ramp surface point under a circle of radius r around (x, z) (BR-CN-24). */
function rampHighUnder(g: Geometry, j: number, x: number, z: number, r: number): number {
  const axis = g.rAxis[j] ?? 0;
  const hx = axis === 0 ? x + r : axis === 1 ? x - r : x;
  const hz = axis === 2 ? z + r : axis === 3 ? z - r : z;
  return rampSurface(
    g,
    j,
    clamp(hx, g.rMinX[j] ?? 0, g.rMaxX[j] ?? 0),
    clamp(hz, g.rMinZ[j] ?? 0, g.rMaxZ[j] ?? 0),
  );
}

/** Squared xz distance from (x, z) to a rectangle. */
function rectDistSq(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  x: number,
  z: number,
): number {
  const dx = x - clamp(x, minX, maxX);
  const dz = z - clamp(z, minZ, maxZ);
  return dx * dx + dz * dz;
}

/** BR-CN-23: box i intersects the cylinder (feet x, y, z). */
export function boxIntersects(
  g: Geometry,
  i: number,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
): boolean {
  if (!(y < (g.bMaxY[i] ?? 0) - EPS && y + h > (g.bMinY[i] ?? 0) + EPS)) return false;
  const d2 = rectDistSq(g.bMinX[i] ?? 0, g.bMaxX[i] ?? 0, g.bMinZ[i] ?? 0, g.bMaxZ[i] ?? 0, x, z);
  return d2 < contactLimitSq(r);
}

/**
 * Ramp j intrudes into the cylinder by more than `allowance` (BR-CN-24). Fit
 * uses allowance = r; movement uses the smaller RAMP_CLIMB / step allowance.
 */
export function rampIntrudes(
  g: Geometry,
  j: number,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  allowance: number,
): boolean {
  if (!(y < (g.rTop[j] ?? 0) - EPS && y + h > (g.rBase[j] ?? 0) + EPS)) return false;
  const d2 = rectDistSq(g.rMinX[j] ?? 0, g.rMaxX[j] ?? 0, g.rMinZ[j] ?? 0, g.rMaxZ[j] ?? 0, x, z);
  if (!(d2 < contactLimitSq(r))) return false;
  return rampHighUnder(g, j, x, z, r) > y + allowance;
}

/** BR-CN-50: nothing intersects the cylinder. */
export function fits(g: Geometry, x: number, y: number, z: number, r: number, h: number): boolean {
  const n = gatherShapes(g, x - r, z - r, x + r, z + r);
  const S = g.boxCount;
  for (let k = 0; k < n; k++) {
    const s = g.gathered[k] ?? 0;
    if (s < S ? boxIntersects(g, s, x, y, z, r, h) : rampIntrudes(g, s - S, x, y, z, r, h, r)) {
      return false;
    }
  }
  return true;
}

/**
 * Push-out of a cylinder from an xz rectangle, written into out.
 * Outside the rectangle the normal points from the closest point to the axis;
 * inside it points out through the nearest face (§2).
 */
function rectPush(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  x: number,
  z: number,
  r: number,
  out: Contact,
): void {
  const dx = x - clamp(x, minX, maxX);
  const dz = z - clamp(z, minZ, maxZ);
  const d2 = dx * dx + dz * dz;
  if (d2 > 1e-18) {
    const d = Math.sqrt(d2);
    out.nx = dx / d;
    out.nz = dz / d;
    out.depth = r - d;
    return;
  }
  // Axis inside the rectangle: leave through the nearest face; ties go -x, +x, -z, +z.
  const toMinX = x - minX;
  const toMaxX = maxX - x;
  const toMinZ = z - minZ;
  const toMaxZ = maxZ - z;
  let best = toMinX;
  out.nx = -1;
  out.nz = 0;
  if (toMaxX < best) {
    best = toMaxX;
    out.nx = 1;
    out.nz = 0;
  }
  if (toMinZ < best) {
    best = toMinZ;
    out.nx = 0;
    out.nz = -1;
  }
  if (toMaxZ < best) {
    best = toMaxZ;
    out.nx = 0;
    out.nz = 1;
  }
  out.depth = best + r;
}

/**
 * Deepest horizontal contact at a position: intersecting boxes and ramps that
 * rise more than `rampAllowance` above the feet. Ties go to the lower shape id.
 * Returns the shape id or -1, and writes the push-out into out.
 */
export function deepestContact(
  g: Geometry,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  rampAllowance: number,
  out: Contact,
  tmp: Contact,
): number {
  const n = gatherShapes(g, x - r, z - r, x + r, z + r);
  const S = g.boxCount;
  let bestId = -1;
  let bestDepth = -1;
  for (let k = 0; k < n; k++) {
    const s = g.gathered[k] ?? 0;
    if (s < S) {
      if (!boxIntersects(g, s, x, y, z, r, h)) continue;
      rectPush(g.bMinX[s] ?? 0, g.bMaxX[s] ?? 0, g.bMinZ[s] ?? 0, g.bMaxZ[s] ?? 0, x, z, r, tmp);
    } else {
      const j = s - S;
      if (!rampIntrudes(g, j, x, y, z, r, h, rampAllowance)) continue;
      rectPush(g.rMinX[j] ?? 0, g.rMaxX[j] ?? 0, g.rMinZ[j] ?? 0, g.rMaxZ[j] ?? 0, x, z, r, tmp);
    }
    const depth = tmp.depth;
    if (depth > bestDepth || (depth === bestDepth && s < bestId)) {
      bestDepth = depth;
      bestId = s;
      out.nx = tmp.nx;
      out.nz = tmp.nz;
      out.depth = depth;
    }
  }
  return bestId;
}

/**
 * Movement support (BR-CN-34): the highest box top whose rectangle the
 * cylinder's footprint overlaps, within [lo, boxHi], or the highest ramp
 * surface under the axis within [lo, rampHi]. Returns -Infinity when none.
 */
export function footSupport(
  g: Geometry,
  x: number,
  z: number,
  r: number,
  lo: number,
  boxHi: number,
  rampHi: number,
): number {
  const n = gatherShapes(g, x - r, z - r, x + r, z + r);
  const S = g.boxCount;
  const lim = contactLimitSq(r);
  let best = -Infinity;
  for (let k = 0; k < n; k++) {
    const s = g.gathered[k] ?? 0;
    if (s < S) {
      const top = g.bMaxY[s] ?? 0;
      if (top < lo || top > boxHi || top <= best) continue;
      const d2 = rectDistSq(
        g.bMinX[s] ?? 0,
        g.bMaxX[s] ?? 0,
        g.bMinZ[s] ?? 0,
        g.bMaxZ[s] ?? 0,
        x,
        z,
      );
      if (d2 < lim) best = top;
    } else {
      const j = s - S;
      if (!inRampFootprint(g, j, x, z)) continue;
      const surf = rampSurface(g, j, x, z);
      if (surf >= lo && surf <= rampHi && surf > best) best = surf;
    }
  }
  return best;
}

function inRampFootprint(g: Geometry, j: number, x: number, z: number): boolean {
  return (
    x >= (g.rMinX[j] ?? 0) &&
    x <= (g.rMaxX[j] ?? 0) &&
    z >= (g.rMinZ[j] ?? 0) &&
    z <= (g.rMaxZ[j] ?? 0)
  );
}

/**
 * Nav support (BR-CN-51): the highest box top or ramp surface directly under
 * the axis (centre-on-top rule) within [lo, hi]. Returns -Infinity when none.
 */
export function axisSupport(g: Geometry, x: number, z: number, lo: number, hi: number): number {
  const c = cellOf(g, x, z);
  const end = g.cellStart[c + 1] ?? 0;
  const S = g.boxCount;
  let best = -Infinity;
  for (let k = g.cellStart[c] ?? 0; k < end; k++) {
    const s = g.cellItems[k] ?? 0;
    let top: number;
    if (s < S) {
      if (
        x < (g.bMinX[s] ?? 0) ||
        x > (g.bMaxX[s] ?? 0) ||
        z < (g.bMinZ[s] ?? 0) ||
        z > (g.bMaxZ[s] ?? 0)
      ) {
        continue;
      }
      top = g.bMaxY[s] ?? 0;
    } else {
      const j = s - S;
      if (!inRampFootprint(g, j, x, z)) continue;
      top = rampSurface(g, j, x, z);
    }
    if (top >= lo && top <= hi && top > best) best = top;
  }
  return best;
}

/**
 * Lowest ceiling the head would enter when rising from feet y0 to y1: the
 * bottom of a box or ramp overlapping the footprint that was above the head
 * at y0. Returns +Infinity when none.
 */
export function ceilingAbove(
  g: Geometry,
  x: number,
  z: number,
  r: number,
  h: number,
  y0: number,
  y1: number,
): number {
  const n = gatherShapes(g, x - r, z - r, x + r, z + r);
  const S = g.boxCount;
  const lim = contactLimitSq(r);
  let best = Infinity;
  for (let k = 0; k < n; k++) {
    const s = g.gathered[k] ?? 0;
    let bottom: number;
    let d2: number;
    if (s < S) {
      bottom = g.bMinY[s] ?? 0;
      d2 = rectDistSq(g.bMinX[s] ?? 0, g.bMaxX[s] ?? 0, g.bMinZ[s] ?? 0, g.bMaxZ[s] ?? 0, x, z);
    } else {
      const j = s - S;
      bottom = g.rBase[j] ?? 0;
      d2 = rectDistSq(g.rMinX[j] ?? 0, g.rMaxX[j] ?? 0, g.rMinZ[j] ?? 0, g.rMaxZ[j] ?? 0, x, z);
    }
    if (!(d2 < lim)) continue;
    if (bottom >= y0 + h - EPS && y1 + h > bottom + EPS && bottom < best) best = bottom;
  }
  return best;
}

/**
 * Upward lift that clears every shape intersecting the cylinder at (x, y, z).
 * Used by depenetration; the caller checks the lifted position fits.
 */
export function liftToClear(
  g: Geometry,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
): number {
  const n = gatherShapes(g, x - r, z - r, x + r, z + r);
  const S = g.boxCount;
  let lift = 0;
  for (let k = 0; k < n; k++) {
    const s = g.gathered[k] ?? 0;
    if (s < S) {
      if (boxIntersects(g, s, x, y, z, r, h)) lift = Math.max(lift, (g.bMaxY[s] ?? 0) - y);
    } else {
      const j = s - S;
      if (rampIntrudes(g, j, x, y, z, r, h, r)) {
        lift = Math.max(lift, rampHighUnder(g, j, x, z, r) - r - y + EPS);
      }
    }
  }
  return lift;
}
