/**
 * Frozen perception tuning (SD-AI-10). Target point heights above the feet
 * follow BR-AI-02: [chest, head, knees], standing and crouched.
 */
import { set, type Vec3 } from '../../core';
import { freezeNested } from './freeze';

export const PERCEPTION_TUNING = freezeNested({
  standOffsets: [1.25, 1.6, 0.5] as const,
  crouchOffsets: [0.8, 1.1, 0.35] as const,
});

/**
 * Writes the player's three target points into `out` (length >= 3) and
 * returns it. For game-simulation and the harness, never for brain code.
 */
export function targetPointsFor(feet: Readonly<Vec3>, crouched: boolean, out: Vec3[]): Vec3[] {
  const o = crouched ? PERCEPTION_TUNING.crouchOffsets : PERCEPTION_TUNING.standOffsets;
  for (let i = 0; i < 3; i++) {
    const p = out[i];
    if (p !== undefined) set(p, feet.x, feet.y + (o[i] ?? 0), feet.z);
  }
  return out;
}
