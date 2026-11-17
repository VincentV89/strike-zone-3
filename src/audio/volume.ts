/**
 * Volume helpers (BR-AU-20, BR-AU-21). Settings store integer percents.
 */
import { clamp } from '../core';

/** Rounds and clamps a percent; a non-finite value keeps `prev`. */
export function acceptPercent(p: number, prev: number): number {
  return Number.isFinite(p) ? clamp(Math.round(p), 0, 100) : prev;
}

/** Perceptual bus gain: (p/100)². curve(0) is exactly 0 and curve(100) exactly 1. */
export function curve(p: number): number {
  const x = clamp(Math.round(p), 0, 100) / 100;
  return x * x;
}

/** Time constant for bus gain changes, in seconds (BR-AU-21). */
export const GAIN_TIME_CONSTANT = 0.015;
