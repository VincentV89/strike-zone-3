/**
 * Tick-path guards (SD-AI-07). Allocation-free; callers report failures with
 * diag.warnOnce and no detail object.
 */
import type { Vec3 } from '../../core';

export function finite3(v: Readonly<Vec3> | null | undefined): boolean {
  return (
    v !== null &&
    v !== undefined &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.z)
  );
}
