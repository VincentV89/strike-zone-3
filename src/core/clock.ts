import type { Diagnostics } from './diagnostics';

/** The simulation tick rate. The only place it is written down (BR-F-08). */
export const TICK_HZ = 60;
/** Seconds per simulation tick. */
export const TICK_DT = 1 / TICK_HZ;

/** Tolerance so a frame of exactly one step's length yields exactly one step. */
const EPS = 1e-9;

export interface FixedStepClock {
  /** Adds a frame's elapsed seconds and returns how many fixed steps to run (0..maxStepsPerFrame). */
  advance(frameDtSec: number): number;
  /** Interpolation factor in [0, 1] for the renderer. */
  alpha(): number;
  /** Clears the accumulator. Called on every entry to countdown or live. */
  reset(): void;
}

/**
 * Fixed-step clock (FD-F-03, BR-F-06, BR-F-07). Reads no time source: the
 * caller supplies `dt`. A non-finite or negative `dt` counts as 0 and is
 * counted as `core/invalid-dt`. A backlog beyond `maxStepsPerFrame` is
 * discarded, never carried into the next frame.
 */
export function createFixedStepClock(
  hz: number = TICK_HZ,
  maxStepsPerFrame = 5,
  diagnostics?: Diagnostics,
): FixedStepClock {
  const step = 1 / hz;
  let acc = 0;

  return {
    advance(frameDtSec) {
      let dt = 0;
      if (Number.isFinite(frameDtSec) && frameDtSec >= 0) {
        dt = frameDtSec;
      } else {
        diagnostics?.count('core/invalid-dt');
      }
      acc += dt;
      let steps = Math.floor((acc + EPS) / step);
      if (steps > maxStepsPerFrame) {
        steps = maxStepsPerFrame;
        acc = 0;
      } else {
        acc = Math.max(0, acc - steps * step);
      }
      return steps;
    },
    alpha() {
      return Math.min(1, acc / step);
    },
    reset() {
      acc = 0;
    },
  };
}
