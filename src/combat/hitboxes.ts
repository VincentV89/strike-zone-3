/**
 * hitboxesFor (domain-entities-player-combat). Both boxes sit inside the
 * 0.4 m actor cylinder. The same function serves the player and bots.
 */
import { set, vec3, type Vec3 } from '../core';
import type { Hitboxes } from './types';

export const BODY_HALF_WIDTH = 0.35;
export const STAND_BODY_TOP = 1.45;
export const CROUCH_BODY_TOP = 0.85;
export const STAND_HEAD_Y = 1.62;
export const CROUCH_HEAD_Y = 1.02;
export const HEAD_HALF = Object.freeze({ x: 0.15, y: 0.17, z: 0.15 });

export function createHitboxes(): Hitboxes {
  return {
    head: { min: vec3(), max: vec3() },
    body: { min: vec3(), max: vec3() },
  };
}

/** Writes the head and body boxes for an actor whose feet are at `feet`. */
export function hitboxesFor(feet: Vec3, crouched: boolean, out: Hitboxes): Hitboxes {
  const top = crouched ? CROUCH_BODY_TOP : STAND_BODY_TOP;
  const headY = feet.y + (crouched ? CROUCH_HEAD_Y : STAND_HEAD_Y);
  const w = BODY_HALF_WIDTH;
  set(out.body.min, feet.x - w, feet.y, feet.z - w);
  set(out.body.max, feet.x + w, feet.y + top, feet.z + w);
  set(out.head.min, feet.x - HEAD_HALF.x, headY - HEAD_HALF.y, feet.z - HEAD_HALF.z);
  set(out.head.max, feet.x + HEAD_HALF.x, headY + HEAD_HALF.y, feet.z + HEAD_HALF.z);
  return out;
}
