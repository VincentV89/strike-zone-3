/**
 * HUD durations in simulation ticks (BR-H-17, BR-H-20). Timers run on the
 * simulation tick, so every fade and expiry pauses with the simulation.
 */
import { TICK_HZ } from '../../../core';

/** Converts milliseconds to whole simulation ticks. */
export function ticks(ms: number): number {
  return Math.round((ms * TICK_HZ) / 1000);
}

export const BODY_MARKER_TICKS = ticks(150); // 9
export const HEAD_MARKER_TICKS = ticks(250); // 15
export const DAMAGE_ARC_TICKS = ticks(1000); // 60
export const VIGNETTE_FADE_TICKS = ticks(600); // 36
export const VIGNETTE_COOLDOWN_TICKS = ticks(333); // 20: at most 3 rises per second
export const KILL_ROW_TICKS = ticks(5000); // 300
export const KILL_ROW_FADE_TICKS = ticks(300); // 18
export const RADAR_HEARD_MAX_TICKS = ticks(2000); // 120
export const LOW_HEALTH_PULSE_TICKS = ticks(1000); // 60 (1 Hz)

/** Caps (BR-H-18, SC-H-01..03). */
export const MAX_ARCS = 4;
export const MAX_KILL_ROWS = 4;
export const MAX_BLIPS = 20;
export const MAX_SCOREBOARD_BOTS = 20;

/** Radar range in metres. */
export const RADAR_RANGE_M = 30;
/** Health shown below this value gets the LOW HEALTH cue (BR-H-12). */
export const LOW_HEALTH_BELOW = 25;
