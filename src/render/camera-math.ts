/**
 * Pure camera and time helpers (business-logic-model §2.7, §3.1, §3.2).
 * Nothing here allocates.
 */
import { angleDelta, clamp, TICK_DT } from '../core';
import { FOV_MAX_DEG, FOV_MIN_DEG, REFERENCE_ASPECT, SCOPE_ZOOM, TELEPORT_M } from './constants';

const DEG = Math.PI / 180;

/** Horizontal FOV at the 16:9 reference aspect -> vertical FOV, both in degrees. 90 -> 58.72. */
export function hFovToVFov(hDeg: number): number {
  return (2 * Math.atan(Math.tan((hDeg * DEG) / 2) / REFERENCE_ASPECT)) / DEG;
}

/** Vertical FOV seen through the scope: tan(v'/2) = tan(v/2) / zoom (BR-P-42). */
export function scopedVFov(vDeg: number, zoom: number = SCOPE_ZOOM): number {
  return (2 * Math.atan(Math.tan((vDeg * DEG) / 2) / zoom)) / DEG;
}

/** Clamps a horizontal FOV setting into 70..110. A non-finite value gives the nearest legal default (90). */
export function clampFov(hDeg: number): number {
  if (!Number.isFinite(hDeg)) return 90;
  return clamp(hDeg, FOV_MIN_DEG, FOV_MAX_DEG);
}

/** Render time in seconds of simulation time (§2.7). */
export function renderTime(prevTick: number, currTick: number, alpha: number): number {
  return (prevTick + alpha * (currTick - prevTick)) * TICK_DT;
}

/** Shortest-arc angle interpolation. */
export function lerpAngle(from: number, to: number, t: number): number {
  return from + angleDelta(from, to) * t;
}

export function isFinite3(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

/** True when the entity moved far enough in one tick that interpolation must be skipped (BR-P-44). */
export function isTeleport(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  return dx * dx + dy * dy + dz * dz > TELEPORT_M * TELEPORT_M;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

export function easeInOut(t: number): number {
  return smoothstep(0, 1, t);
}

/**
 * World size of a sprite whose projected longer side is exactly `capPx` at
 * distance `d` (BR-P-45): capPx * 2 * d * tan(vFov/2) / viewportHeightPx.
 */
export function capWorldSize(capPx: number, d: number, vFovDeg: number, heightPx: number): number {
  if (!(heightPx > 0) || !(d > 0)) return 0;
  return (capPx * 2 * d * Math.tan((vFovDeg * DEG) / 2)) / heightPx;
}

/** Projected size in pixels of a world-space length `size` at distance d. */
export function projectedPx(size: number, d: number, vFovDeg: number, heightPx: number): number {
  return (size * heightPx) / (2 * d * Math.tan((vFovDeg * DEG) / 2));
}
