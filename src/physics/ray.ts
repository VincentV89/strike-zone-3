/**
 * Ray caster (business-logic-model-collision-nav §4, BR-CN-40..44). A 2D DDA
 * over the xz grid; within a cell every shape not yet stamped for this ray is
 * tested. Internal to src/physics; the world wraps it with input guards.
 */
import { EPS } from './constants';
import { nextStamp, type Geometry } from './geometry';

/** Result record of rayCore. */
export interface RayScratch {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  shape: number;
}

export function createRayScratch(): RayScratch {
  return { t: 0, nx: 0, ny: 0, nz: 0, shape: -1 };
}

/** Clip state of one slab walk: entry and exit distance and the entry face. */
interface ClipState {
  tMin: number;
  tMax: number;
  /** 0..2 for x, y, z; -1 when the origin is inside. */
  axis: number;
  sign: number;
}

/** Hit of one shape: distance and normal. */
const SLAB = { t: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Slab test for one axis. A ray parallel to the y slab that only touches a
 * top or bottom face misses, so a ray grazing a floor top reports no hit. On
 * x and z the test is inclusive, so a ray running exactly along the seam of
 * two touching boxes still hits them (BR-CN-21). Returns false on a miss.
 */
function slab(
  o: number,
  d: number,
  lo: number,
  hi: number,
  axis: number,
  state: ClipState,
): boolean {
  if (d === 0) return axis === 1 ? o > lo && o < hi : o >= lo && o <= hi;
  const inv = 1 / d;
  let t1 = (lo - o) * inv;
  let t2 = (hi - o) * inv;
  let sign = -1; // entering through the lo face: normal points -axis
  if (t1 > t2) {
    const tmp = t1;
    t1 = t2;
    t2 = tmp;
    sign = 1;
  }
  if (t1 > state.tMin) {
    state.tMin = t1;
    state.axis = axis;
    state.sign = sign;
  }
  if (t2 < state.tMax) state.tMax = t2;
  return state.tMin <= state.tMax;
}

const STATE: ClipState = { tMin: 0, tMax: 0, axis: -1, sign: 0 };

function resetState(maxT: number): void {
  STATE.tMin = 0;
  STATE.tMax = maxT;
  STATE.axis = -1;
  STATE.sign = 0;
}

/** Box hit: writes [t, nx, ny, nz] into SLAB, returns false on a miss. */
function hitBox(
  g: Geometry,
  i: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): boolean {
  resetState(maxT);
  if (!slab(ox, dx, g.bMinX[i] ?? 0, g.bMaxX[i] ?? 0, 0, STATE)) return false;
  if (!slab(oy, dy, g.bMinY[i] ?? 0, g.bMaxY[i] ?? 0, 1, STATE)) return false;
  if (!slab(oz, dz, g.bMinZ[i] ?? 0, g.bMaxZ[i] ?? 0, 2, STATE)) return false;
  finishHit(dx, dy, dz);
  return true;
}

/** Writes SLAB from STATE; an origin inside the shape gets the normal -dir (BR-CN-40). */
function finishHit(dx: number, dy: number, dz: number): void {
  SLAB.t = STATE.tMin;
  const { axis, sign } = STATE;
  if (axis < 0) {
    SLAB.nx = -dx;
    SLAB.ny = -dy;
    SLAB.nz = -dz;
  } else {
    SLAB.nx = axis === 0 ? sign : 0;
    SLAB.ny = axis === 1 ? sign : 0;
    SLAB.nz = axis === 2 ? sign : 0;
  }
}

/** Ramp wedge hit: slab clip against the ramp AABB, then the surface half-space. */
function hitRamp(
  g: Geometry,
  j: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): boolean {
  resetState(maxT);
  if (!slab(ox, dx, g.rMinX[j] ?? 0, g.rMaxX[j] ?? 0, 0, STATE)) return false;
  if (!slab(oy, dy, g.rBase[j] ?? 0, g.rTop[j] ?? 0, 1, STATE)) return false;
  if (!slab(oz, dz, g.rMinZ[j] ?? 0, g.rMaxZ[j] ?? 0, 2, STATE)) return false;
  const a = g.rPA[j] ?? 0;
  const c = g.rPC[j] ?? 0;
  const e = g.rPE[j] ?? 0;
  const f0 = a * ox + oy + c * oz + e;
  const nd = a * dx + dy + c * dz;
  let planeEntry = false;
  if (nd === 0) {
    if (f0 >= 0) return false; // parallel and on or above the surface
  } else {
    const t = -f0 / nd;
    if (nd < 0) {
      if (t > STATE.tMin) {
        STATE.tMin = t;
        planeEntry = true;
      }
    } else if (t < STATE.tMax) {
      STATE.tMax = t;
    }
    if (STATE.tMin > STATE.tMax) return false;
  }
  if (planeEntry) {
    const len = Math.sqrt(a * a + 1 + c * c);
    SLAB.t = STATE.tMin;
    SLAB.nx = a / len;
    SLAB.ny = 1 / len;
    SLAB.nz = c / len;
    return true;
  }
  finishHit(dx, dy, dz);
  return true;
}

/**
 * Nearest hit along the unit direction d within maxDist. Writes the hit into
 * out and returns true on a hit. Inputs must be
 * finite and d must be unit length (the world guards both).
 */
export function rayCore(
  g: Geometry,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  out: RayScratch,
): boolean {
  // Enter the grid's xz rectangle; shapes lie inside it (BR-CN-25).
  const gx0 = g.originX;
  const gz0 = g.originZ;
  const gx1 = gx0 + g.nx * g.cellSize;
  const gz1 = gz0 + g.nz * g.cellSize;
  resetState(maxDist);
  if (!slab(ox, dx, gx0, gx1, 0, STATE)) return false;
  if (!slab(oz, dz, gz0, gz1, 2, STATE)) return false;
  const tEnter = STATE.tMin;

  const cs = g.cellSize;
  const px = ox + dx * tEnter;
  const pz = oz + dz * tEnter;
  let cx = Math.min(g.nx - 1, Math.max(0, Math.floor((px - gx0) / cs)));
  let cz = Math.min(g.nz - 1, Math.max(0, Math.floor((pz - gz0) / cs)));
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = dx !== 0 ? cs / Math.abs(dx) : Infinity;
  const tDeltaZ = dz !== 0 ? cs / Math.abs(dz) : Infinity;
  let tMaxX =
    dx > 0 ? (gx0 + (cx + 1) * cs - ox) / dx : dx < 0 ? (gx0 + cx * cs - ox) / dx : Infinity;
  let tMaxZ =
    dz > 0 ? (gz0 + (cz + 1) * cs - oz) / dz : dz < 0 ? (gz0 + cz * cs - oz) / dz : Infinity;

  const stamp = nextStamp(g);
  const S = g.boxCount;
  let best = maxDist;
  let bestShape = -1;
  // A DDA walk visits at most nx + nz cells; the cap also covers float edge cases.
  for (let visited = 0; visited <= g.nx + g.nz; visited++) {
    const c = cz * g.nx + cx;
    const end = g.cellStart[c + 1] ?? 0;
    for (let k = g.cellStart[c] ?? 0; k < end; k++) {
      const s = g.cellItems[k] ?? 0;
      if (g.stamp[s] === stamp) continue;
      g.stamp[s] = stamp;
      const hit =
        s < S
          ? hitBox(g, s, ox, oy, oz, dx, dy, dz, best)
          : hitRamp(g, s - S, ox, oy, oz, dx, dy, dz, best);
      if (!hit) continue;
      const t = SLAB.t;
      if (t < best || (t === best && (bestShape < 0 || s < bestShape))) {
        best = t;
        bestShape = s;
        out.nx = SLAB.nx;
        out.ny = SLAB.ny;
        out.nz = SLAB.nz;
      }
    }
    const cellExit = Math.min(tMaxX, tMaxZ);
    if (bestShape >= 0 && best <= cellExit) break;
    if (cellExit > maxDist) break;
    if (tMaxX < tMaxZ) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cz += stepZ;
      tMaxZ += tDeltaZ;
    }
    if (cx < 0 || cx >= g.nx || cz < 0 || cz >= g.nz) break;
  }
  if (bestShape < 0) return false;
  out.t = best;
  out.shape = bestShape;
  return true;
}

/** Segment a-b is clear when no hit lies strictly before |b - a| - EPS (BR-CN-43). */
export function segmentClear(
  g: Geometry,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  scratch: RayScratch,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(len)) return false; // overflow: fail closed
  if (len <= EPS) return true;
  const inv = 1 / len;
  if (!rayCore(g, ax, ay, az, dx * inv, dy * inv, dz * inv, len, scratch)) return true;
  return scratch.t >= len - EPS;
}
