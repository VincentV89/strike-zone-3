/**
 * Shot direction inside the spread cone (BR-PC-33, BR-PC-34). Module scratch
 * vectors only; nothing allocates per shot.
 */
import { clamp, cross, dirFromYawPitch, normalize, set, vec3, type Vec3 } from '../core';

/** 89 degrees, the same pitch limit as player-controller (BR-PC-01). */
export const PITCH_LIMIT = 1.553;

const UP: Readonly<Vec3> = Object.freeze(vec3(0, 1, 0));
const base = vec3();
const right = vec3();
const up = vec3();

/**
 * Writes the unit shot direction into `out`. `u` and `v` are uniform draws in
 * [0, 1): radius = tan(spread * sqrt(u)) and angle = 2 pi v give a uniform disc.
 */
export function coneDirection(
  yaw: number,
  pitch: number,
  spread: number,
  u: number,
  v: number,
  out: Vec3,
): Vec3 {
  dirFromYawPitch(yaw, clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT), base);
  if (Math.abs(base.y) > 0.999) set(right, 1, 0, 0);
  else normalize(cross(base, UP, right), right);
  cross(right, base, up);
  const r = Math.tan(spread * Math.sqrt(u));
  const theta = 2 * Math.PI * v;
  const a = r * Math.cos(theta);
  const b = r * Math.sin(theta);
  set(
    out,
    base.x + right.x * a + up.x * b,
    base.y + right.y * a + up.y * b,
    base.z + right.z * a + up.z * b,
  );
  return normalize(out, out);
}
