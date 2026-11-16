/**
 * sweepClear (business-logic-model-collision-nav §5, BR-CN-51): can an actor
 * walk on the ground from a to b? Samples the xz segment every SWEEP_SAMPLE
 * and follows the support under the axis (centre-on-top rule), so a drop off
 * a ledge or a gap fails and nav links stay walkable both ways.
 */
import type { Geometry } from './geometry';
import { EPS, MAX_SWEEP_LENGTH, SWEEP_SAMPLE } from './constants';
import { axisSupport, fits, footSupport } from './shapes';

/**
 * The cylinder fits standing at support height s, or after stepping up onto
 * a box top at most `step` above s that its rim overlaps. The step-up mirrors
 * moveCapsule (BR-CN-33): where a ramp meets a platform, the rim reaches the
 * platform while the axis is still on the ramp, up to 0.23 m below the top.
 */
function fitsOrSteps(
  g: Geometry,
  x: number,
  s: number,
  z: number,
  r: number,
  h: number,
  step: number,
): boolean {
  if (fits(g, x, s, z, r, h)) return true;
  const top = footSupport(g, x, z, r, s + EPS * 0.5, s + step, -Infinity);
  return top > -Infinity && fits(g, x, top, z, r, h);
}

export function sweepCore(
  g: Geometry,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
  h: number,
  step: number,
): boolean {
  if (!fits(g, ax, ay, az, r, h)) return false;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (!(len <= MAX_SWEEP_LENGTH)) return false; // bounded work, also catches overflow
  const n = Math.max(1, Math.ceil(len / SWEEP_SAMPLE));
  let prev = ay;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const qx = ax + dx * t;
    const qz = az + dz * t;
    const s = axisSupport(g, qx, qz, prev - step, prev + step);
    if (s === -Infinity) return false;
    if (!fitsOrSteps(g, qx, s, qz, r, h, step)) return false;
    prev = s;
  }
  return Math.abs(prev - by) <= step;
}
