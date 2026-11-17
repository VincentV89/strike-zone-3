/**
 * Frozen locomotion tuning (domain-entities-bot-ai, LocomotionTuning). Capsule
 * dimensions and step height are NOT here: locomotion has no map-data edge, so
 * they arrive through LocoContext (SD-AI-06).
 */
import { freezeNested } from './freeze';

export const LOCOMOTION_TUNING = freezeNested({
  walkSpeed: 3.2,
  runSpeed: 5.0,
  crouchSpeed: 1.8,
  accel: 25,
  gravity: 18,
  terminalSpeed: 50,
  /** Waypoint reached within this xz radius and |dy| < waypointDy (m). */
  waypointRadius: 0.4,
  waypointDy: 1.0,
  /** Ticks between sweepClear look-ahead skips. */
  lookAheadEveryTicks: 6,
  separationRadius: 1.2,
  separationGain: 2.5,
  separationMax: 2.0,
  /** Head-on avoidance starts here (m); extends BR-AI-64 (H-4). */
  avoidRadius: 2.5,
  /** Stuck watchdog window (ticks) and the minimum xz progress per window (m). */
  progressWindowTicks: 90,
  progressMin: 0.3,
  maxRepaths: 2,
  /** FD-AI-Q2: snap only to a node at most this far away (m). */
  snapMaxDist: 1.5,
  /** setGoal requests a path when the goal moves further than this (m). */
  goalReplanDist: 1.0,
  /** Facing follows travel above this speed (m/s). */
  faceSpeed: 0.5,
  /** Eye-level offset for the waiting-path straight-line check (m). */
  waitLosHeight: 1.0,
});

/** SD-AI-09: waypoints kept per bot; longer paths are truncated and repathed. */
export const MAX_PATH_POINTS = 64;
