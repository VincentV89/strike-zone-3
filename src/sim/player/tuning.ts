/**
 * PLAYER_TUNING (domain-entities-player-combat). player-controller has no edge
 * to map-data, so radius, heights, standEye and stepHeight are copies of
 * MAP_RULES; tests/sim/player/tuning.test.ts asserts they are equal (BR-PC-16).
 */
import { freezeNested } from './freeze';
import type { MovementTuning } from './types';

export const PLAYER_TUNING: MovementTuning = freezeNested({
  radius: 0.4,
  standHeight: 1.8,
  crouchHeight: 1.2,
  standEye: 1.6,
  crouchEye: 1.1,
  stepHeight: 0.35,
  walkSpeed: 4.5,
  sprintSpeed: 6.5,
  crouchSpeed: 2.2,
  scopedSpeedMult: 0.6,
  groundAccel: 30,
  groundDecel: 35,
  airAccel: 8,
  gravity: 18,
  jumpSpeed: 6.0,
  terminalSpeed: 40,
  eyeSpeed: 6,
  lookRadPerCount: 0.0022,
  pitchLimit: 1.553,
  strideWalk: 2.2,
  strideSprint: 2.8,
  strideCrouch: 1.6,
  footstepMinSpeed: 0.5,
  outOfWorldMargin: 10,
});
