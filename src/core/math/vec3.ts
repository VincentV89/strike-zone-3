/**
 * Vec3 math. World convention (FD-F-10): metres, right-handed, +Y up,
 * yaw 0 faces -Z, positive yaw turns left, positive pitch looks up.
 *
 * Every op takes an optional `out`: when given, the result is written into
 * it and returned; otherwise a new object is allocated. Hot paths pass `out`.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const NEAR_ZERO_SQ = 1e-24; // length < 1e-12

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(a: Vec3, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x, a.y, a.z);
}

export function add(a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(a: Vec3, s: number, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x * s, a.y * s, a.z * s);
}

/** a + b * s */
export function addScaled(a: Vec3, b: Vec3, s: number, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 {
  return set(out, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function lengthSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function length(a: Vec3): number {
  return Math.sqrt(lengthSq(a));
}

export function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSq(a, b));
}

/** Unit vector; a vector shorter than 1e-12 gives (0,0,0), never NaN (BR-F-21). */
export function normalize(a: Vec3, out: Vec3 = vec3()): Vec3 {
  const lsq = lengthSq(a);
  if (lsq < NEAR_ZERO_SQ) return set(out, 0, 0, 0);
  const inv = 1 / Math.sqrt(lsq);
  return set(out, a.x * inv, a.y * inv, a.z * inv);
}

export function lerpVec3(a: Vec3, b: Vec3, t: number, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

export function equalsApprox(a: Vec3, b: Vec3, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
}

/** Unit look direction: (-sin yaw * cos pitch, sin pitch, -cos yaw * cos pitch). */
export function dirFromYawPitch(yaw: number, pitch: number, out: Vec3 = vec3()): Vec3 {
  const cp = Math.cos(pitch);
  return set(out, -Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}
