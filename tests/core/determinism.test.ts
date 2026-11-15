/**
 * Kernel-only determinism probe (story-walking-skeleton AC3, foundation part).
 * The full criterion is re-asserted against createSimulation in game-simulation;
 * this probe alone does not close AC3 (BR-F-45, req-honest-verification).
 */
import { describe, expect, it } from 'vitest';
import {
  createDiagnostics,
  createEventBuffer,
  createFixedStepClock,
  createRng,
  TICK_DT,
  type Seed,
} from '../../src/core';

/** 240 frames between 10 and 40 ms with one 0.5 s stall, generated without randomness. */
const FIXED_JITTER_SEQUENCE: readonly number[] = Array.from({ length: 240 }, (_, i) =>
  i === 120 ? 0.5 : 0.01 + ((i * 7) % 31) / 1000,
);

function run(seed: Seed): string {
  const rng = createRng(seed).fork('probe');
  const clock = createFixedStepClock(60, 5);
  const diag = createDiagnostics(() => undefined);
  const events = createEventBuffer<{ tick: number; x: number }>(4096, diag);
  let tick = 0;
  let x = 0;
  for (const dt of FIXED_JITTER_SEQUENCE) {
    const steps = clock.advance(dt);
    for (let i = 0; i < steps; i++) {
      x += rng.range(-1, 1) * TICK_DT;
      tick += 1;
      events.push({ tick, x });
    }
  }
  return JSON.stringify({ x, events: events.drain(), diag: diag.snapshot(), alpha: clock.alpha() });
}

describe('kernel determinism probe', () => {
  it('produces identical output for seed 42 twice and different output for seed 43', () => {
    expect(FIXED_JITTER_SEQUENCE.every((dt) => dt >= 0.01 && dt <= 0.5)).toBe(true);
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(43));
  });
});
