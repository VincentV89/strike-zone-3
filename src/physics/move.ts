/**
 * Mover (LC-CN-04): moveCapsule, depenetration and separate
 * (business-logic-model-collision-nav §3 and §5, BR-CN-30..39, BR-CN-52).
 * Inputs are already guarded by the world; nothing here throws or allocates.
 */
import {
  DEPEN_MAX,
  EPS,
  GROUND_PROBE,
  MAX_CONTACTS,
  MAX_SPEED,
  MAX_SUBSTEP,
  MAX_SUBSTEPS,
  RAMP_CLIMB,
} from './constants';
import type { Geometry } from './geometry';
import {
  ceilingAbove,
  createContact,
  deepestContact,
  fits,
  footSupport,
  liftToClear,
  type Contact,
} from './shapes';

/** Mutable xyz record (scratch, never a frozen map value). */
export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Scratch owned by one world (LC-CN-13). */
export interface MoveScratch {
  /** Position being resolved. */
  readonly p: P3;
  /** Deepest contact. */
  readonly contact: Contact;
  readonly tmp: Contact;
}

export function createMoveScratch(): MoveScratch {
  return { p: { x: 0, y: 0, z: 0 }, contact: createContact(), tmp: createContact() };
}

/**
 * Pushes the position in s.p out of horizontal contacts, at most MAX_CONTACTS
 * times and at most `budget` metres in total. Returns true when it ends free.
 */
function pushOut(
  g: Geometry,
  s: MoveScratch,
  r: number,
  h: number,
  rampAllowance: number,
  budget: number,
): boolean {
  let moved = 0;
  const p = s.p;
  for (let iter = 0; iter < MAX_CONTACTS; iter++) {
    const id = deepestContact(g, p.x, p.y, p.z, r, h, rampAllowance, s.contact, s.tmp);
    if (id < 0) return true;
    const depth = s.contact.depth + EPS * 0.25;
    if (moved + depth > budget) return false;
    moved += depth;
    p.x += s.contact.nx * depth;
    p.z += s.contact.nz * depth;
  }
  return deepestContact(g, p.x, p.y, p.z, r, h, rampAllowance, s.contact, s.tmp) < 0;
}

/**
 * BR-CN-38: pushes a start position that does not fit out along the smaller
 * of a horizontal push and an upward lift, each capped at DEPEN_MAX. Writes
 * the result into s.p and returns true when the result fits.
 */
export function depenetrate(
  g: Geometry,
  s: MoveScratch,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
): boolean {
  // Upward candidate.
  const lift = liftToClear(g, x, y, z, r, h);
  const upOk = lift <= DEPEN_MAX && fits(g, x, y + lift, z, r, h);
  // Horizontal candidate.
  const p = s.p;
  p.x = x;
  p.y = y;
  p.z = z;
  const sideOk = pushOut(g, s, r, h, r, DEPEN_MAX) && fits(g, p.x, y, p.z, r, h);
  const side = Math.hypot(p.x - x, p.z - z);
  if (sideOk && (!upOk || side <= lift)) return true;
  if (upOk) {
    p.x = x;
    p.y = y + lift;
    p.z = z;
    return true;
  }
  return false;
}

export interface MoveIn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  h: number;
  dt: number;
  step: number;
}

/** Output of moveCore: position, velocity and flags in a flat record. */
export interface MoveOut {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  hitCeiling: boolean;
  landed: boolean;
  stuck: boolean;
}

function groundedAt(
  g: Geometry,
  x: number,
  y: number,
  z: number,
  r: number,
  climb: number,
): boolean {
  return (
    footSupport(g, x, z, r, y - GROUND_PROBE, y + EPS, y + Math.min(climb, GROUND_PROBE)) >
    -Infinity
  );
}

/**
 * moveCapsule body. Horizontal then vertical per substep (BR-CN-32), step-up
 * (BR-CN-33), ground snap (BR-CN-34), ceiling (BR-CN-36), depenetration
 * (BR-CN-38). Every returned position fits when the start fits (BR-CN-30).
 */
export function moveCore(g: Geometry, s: MoveScratch, a: MoveIn, o: MoveOut): void {
  const { r, h } = a;
  const step = Math.max(0, a.step);
  const climb = Math.max(step, RAMP_CLIMB);
  let { x, y, z, vx, vy, vz } = a;
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (speed > MAX_SPEED) {
    const k = MAX_SPEED / speed;
    vx *= k;
    vy *= k;
    vz *= k;
  }
  o.stuck = false;
  o.hitCeiling = false;

  if (!fits(g, x, y, z, r, h)) {
    if (!depenetrate(g, s, x, y, z, r, h)) {
      o.x = a.x;
      o.y = a.y;
      o.z = a.z;
      o.vx = 0;
      o.vy = 0;
      o.vz = 0;
      o.grounded = false;
      o.landed = false;
      o.stuck = true;
      return;
    }
    x = s.p.x;
    y = s.p.y;
    z = s.p.z;
  }

  const wasGrounded = vy <= 0 && groundedAt(g, x, y, z, r, climb);
  let onGround = wasGrounded;
  let grounded = false;
  const horiz = Math.sqrt(vx * vx + vz * vz) * a.dt;
  const vert = Math.abs(vy) * a.dt;
  const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.max(horiz, vert) / MAX_SUBSTEP)));
  const hdt = a.dt / n;

  for (let i = 0; i < n; i++) {
    // Horizontal.
    const p = s.p;
    if (vx !== 0 || vz !== 0) {
      p.x = x + vx * hdt;
      p.y = y;
      p.z = z + vz * hdt;
      let free = false;
      for (let iter = 0; iter < MAX_CONTACTS; iter++) {
        const id = deepestContact(g, p.x, p.y, p.z, r, h, climb, s.contact, s.tmp);
        if (id < 0) {
          free = true;
          break;
        }
        if (id < g.boxCount && onGround) {
          const top = g.bMaxY[id] ?? 0;
          if (top > p.y && top - p.y <= step && fits(g, p.x, top, p.z, r, h)) {
            p.y = top; // step-up (BR-CN-33)
            continue;
          }
        }
        const { nx, nz } = s.contact;
        const depth = s.contact.depth + EPS * 0.25;
        p.x += nx * depth;
        p.z += nz * depth;
        const vn = vx * nx + vz * nz;
        if (vn < 0) {
          vx -= nx * vn; // slide (BR-CN-32)
          vz -= nz * vn;
        }
      }
      if (!free) free = deepestContact(g, p.x, p.y, p.z, r, h, climb, s.contact, s.tmp) < 0;
      if (free && fits(g, p.x, p.y, p.z, r, h)) {
        x = p.x;
        y = p.y;
        z = p.z;
      }
      // else: revert this substep's horizontal move (§3).
    }

    // Vertical.
    const y0 = y;
    let ny = y + vy * hdt;
    if (vy > 0) {
      const ceiling = ceilingAbove(g, x, z, r, h, y, ny);
      if (ceiling < Infinity) {
        ny = Math.max(y, ceiling - h - EPS * 0.5);
        vy = 0;
        o.hitCeiling = true;
      }
    }
    grounded = false;
    if (vy <= 0) {
      const lo = onGround ? Math.min(ny, y - step) - EPS : ny - EPS;
      const sup = footSupport(g, x, z, r, lo, y + EPS, y + climb);
      if (sup > -Infinity && fits(g, x, sup, z, r, h)) {
        ny = sup;
        vy = 0;
        grounded = true;
      }
    }
    y = ny;
    if (!fits(g, x, y, z, r, h)) {
      p.x = x;
      p.y = y;
      p.z = z;
      if (pushOut(g, s, r, h, r, DEPEN_MAX) && fits(g, p.x, y, p.z, r, h)) {
        x = p.x;
        z = p.z;
      } else {
        y = y0; // revert the vertical move; the old position fits
        vy = 0;
        grounded = groundedAt(g, x, y, z, r, climb);
      }
    }
    onGround = grounded;
  }

  if (wasGrounded && !grounded && vy <= 0) {
    // Ground snap downwards by up to stepHeight (BR-CN-34).
    const sup = footSupport(g, x, z, r, y - step - EPS, y + EPS, y + EPS);
    if (sup > -Infinity && fits(g, x, sup, z, r, h)) {
      y = sup;
      vy = 0;
      grounded = true;
    }
  }
  if (!grounded && vy <= 0) {
    // A surface within GROUND_PROBE below the feet grounds the actor (BR-CN-34).
    const sup = footSupport(g, x, z, r, y - GROUND_PROBE, y + EPS, y + EPS);
    if (sup > -Infinity && fits(g, x, sup, z, r, h)) {
      y = sup;
      grounded = true;
    }
  }
  if (grounded) vy = 0; // BR-CN-37
  if (o.hitCeiling && vy > 0) vy = 0; // BR-CN-36

  o.x = x;
  o.y = y;
  o.z = z;
  o.vx = vx;
  o.vy = vy;
  o.vz = vz;
  o.grounded = grounded;
  o.landed = grounded && !wasGrounded;
}

/**
 * BR-CN-52: pushes two overlapping upright cylinders apart along the xz line
 * between their axes. Positions are updated in place; y never changes.
 * Returns true if any position changed.
 */
export function separateCore(
  g: Geometry,
  a: P3,
  ra: number,
  ha: number,
  b: P3,
  rb: number,
  hb: number,
): boolean {
  const { x: ax, y: ay, z: az } = a;
  const { x: bx, y: by, z: bz } = b;
  const dx = bx - ax;
  const dz = bz - az;
  const d = Math.sqrt(dx * dx + dz * dz);
  const need = ra + rb - EPS;
  if (d >= need) return false;
  if (!(ay < by + hb && by < ay + ha)) return false;
  let nx = 1;
  let nz = 0;
  if (d > 1e-6) {
    nx = dx / d;
    nz = dz / d;
  }
  const pen = Math.min(need - d, DEPEN_MAX);
  const half = pen / 2;
  const fa = fits(g, ax - nx * half, ay, az - nz * half, ra, ha);
  const fb = fits(g, bx + nx * half, by, bz + nz * half, rb, hb);
  if (fa && fb) {
    a.x = ax - nx * half;
    a.z = az - nz * half;
    b.x = bx + nx * half;
    b.z = bz + nz * half;
    return true;
  }
  if (!fa && fb && fits(g, bx + nx * pen, by, bz + nz * pen, rb, hb)) {
    b.x = bx + nx * pen;
    b.z = bz + nz * pen;
    return true;
  }
  if (fa && !fb && fits(g, ax - nx * pen, ay, az - nz * pen, ra, ha)) {
    a.x = ax - nx * pen;
    a.z = az - nz * pen;
    return true;
  }
  return false;
}
