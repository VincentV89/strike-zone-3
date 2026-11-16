/**
 * Stereo spatialisation (BR-AU-40..47, business-logic-model-audio "spatialise").
 *
 * Kernel convention: yaw 0 faces -Z and positive yaw turns left, so in XZ
 * forward = (-sin yaw, -cos yaw) and right = (cos yaw, -sin yaw). These match
 * the hud bearing convention. Pan -1 is left.
 */
import { clamp } from '../core';
import { NO_FILTER_HZ, type SpatialProfile, type SpatialResult } from './types';

const BEHIND_MIN_HZ = 4000;

/**
 * Pan, distance gain and behind-muffle for a source at (px, py, pz). Writes
 * into `out` and returns false when the source is culled (beyond maxDist) or
 * any input is non-finite. Allocates nothing.
 */
export function spatialise(
  lx: number,
  ly: number,
  lz: number,
  yaw: number,
  px: number,
  py: number,
  pz: number,
  prof: SpatialProfile,
  out: SpatialResult,
): boolean {
  const dx = px - lx;
  const dy = py - ly;
  const dz = pz - lz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(dist) || !Number.isFinite(yaw) || !(dist <= prof.maxDist)) return false;
  const hl = Math.sqrt(dx * dx + dz * dz);
  let pan = 0;
  let front = 1;
  if (hl >= 1e-6) {
    const hx = dx / hl;
    const hz = dz / hl;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    pan = clamp(hx * cos - hz * sin, -1, 1);
    front = -hx * sin - hz * cos;
  }
  out.pan = pan;
  out.gain = prof.refDist / (prof.refDist + Math.max(0, dist - prof.refDist));
  out.lowpassHz =
    front < 0 ? NO_FILTER_HZ - (NO_FILTER_HZ - BEHIND_MIN_HZ) * Math.min(1, -front) : NO_FILTER_HZ;
  return true;
}

/**
 * Pan for a world XZ direction, used for `hurt` with `damage.fromDir`
 * (target-to-attacker, BR-AU-44). A zero or non-finite direction gives 0.
 */
export function panFromDirection(dirX: number, dirZ: number, yaw: number): number {
  const hl = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (!Number.isFinite(hl) || !Number.isFinite(yaw) || hl < 1e-6) return 0;
  return clamp((dirX / hl) * Math.cos(yaw) - (dirZ / hl) * Math.sin(yaw), -1, 1);
}
