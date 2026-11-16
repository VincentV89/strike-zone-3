/**
 * View-relative bearing (business-logic-model-hud, Damage direction arcs).
 * Kernel convention: yaw 0 faces -Z and positive yaw turns left, so
 * forward = (-sin yaw, -cos yaw) and right = (cos yaw, -sin yaw) in XZ.
 */

/** Bearing of a world XZ direction relative to the view. 0 = ahead, +PI/2 = right, -PI/2 = left. */
export function relativeBearing(dirX: number, dirZ: number, yaw: number): number {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const forward = -sin * dirX - cos * dirZ;
  const right = cos * dirX - sin * dirZ;
  return Math.atan2(right, forward);
}

/** Radians to degrees. */
export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}
