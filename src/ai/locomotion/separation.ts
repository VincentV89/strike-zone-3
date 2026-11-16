/**
 * Soft bot-bot separation (BR-AI-64). For every alive neighbour within
 * separationRadius (xz), with w = (r - d) / r:
 * - a push of w x separationGain away from it, the sum clamped to
 *   separationMax (BR-AI-64);
 * - within avoidRadius, the part of `out` (the desired velocity) that points
 *   at the neighbour is cut by wa = (ra - d) / ra and turned 90 degrees. Both
 *   bots turn the same way, so head-on bots sidestep in opposite directions.
 * The tangential and braking terms extend BR-AI-64; without them two bots
 * meeting head-on in a corridor pass through each other (H-4).
 */
import type { EntityId, Vec3 } from '../../core';
import { finite3 } from './guard';
import { LOCOMOTION_TUNING as T } from './tuning';
import type { NeighbourView } from './types';

export function addSeparation(
  id: EntityId,
  pos: Readonly<Vec3>,
  neighbours: readonly NeighbourView[],
  out: Vec3,
): Vec3 {
  let sx = 0;
  let sz = 0;
  const r = T.separationRadius;
  const ra = T.avoidRadius;
  for (let i = 0; i < neighbours.length; i++) {
    const n = neighbours[i];
    if (n === undefined || n.id === id || !n.alive || !finite3(n.pos)) continue;
    const dx = pos.x - n.pos.x;
    const dz = pos.z - n.pos.z;
    const d = Math.hypot(dx, dz);
    if (d >= ra) continue;
    const w = d < r ? (r - d) / r : 0;
    const wa = (ra - d) / ra;
    let ux: number;
    let uz: number;
    if (d < 0.01) {
      ux = id < n.id ? 1 : -1; // deterministic split for coincident bots
      uz = 0;
    } else {
      ux = dx / d;
      uz = dz / d;
    }
    const toward = -(out.x * ux + out.z * uz);
    if (toward > 0) {
      // brake toward the neighbour and turn the cut part sideways
      out.x += (ux - uz) * toward * wa;
      out.z += (uz + ux) * toward * wa;
    }
    const push = w * T.separationGain;
    sx += ux * push;
    sz += uz * push;
  }
  const l = Math.hypot(sx, sz);
  if (l > T.separationMax) {
    sx *= T.separationMax / l;
    sz *= T.separationMax / l;
  }
  out.x += sx;
  out.z += sz;
  return out;
}
