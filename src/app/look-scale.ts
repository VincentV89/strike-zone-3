/**
 * Scoped look factor (FD-AS-Q1, PD-AS-3). While the sniper scope is held,
 * mouse deltas are multiplied by k = tan(scopedVFov(v)/2) / tan(v/2), where
 * v is the vertical FOV for the player's horizontal setting. k is computed
 * once per FOV change, never per frame.
 */
import { hFovToVFov, scopedVFov } from '../render';

const DEG = Math.PI / 180;

export function scopedLookScale(fovDeg: number): number {
  const v = hFovToVFov(fovDeg);
  const k = Math.tan((scopedVFov(v) * DEG) / 2) / Math.tan((v * DEG) / 2);
  return Number.isFinite(k) && k > 0 ? k : 1;
}
