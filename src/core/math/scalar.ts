/** Scalar helpers. Angles are radians. */

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function approxEq(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

const TWO_PI = Math.PI * 2;

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % TWO_PI;
  if (r <= -Math.PI) r += TWO_PI;
  else if (r > Math.PI) r -= TWO_PI;
  return r;
}

/** Shortest signed difference `to - from`, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}
