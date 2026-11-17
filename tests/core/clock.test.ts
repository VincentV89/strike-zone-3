import { describe, expect, it } from 'vitest';
import { createDiagnostics, createFixedStepClock, TICK_DT, TICK_HZ } from '../../src/core';

describe('createFixedStepClock', () => {
  it('exports the 60 Hz tick rate', () => {
    expect(TICK_HZ).toBe(60);
    expect(TICK_DT).toBe(1 / 60);
  });

  it('yields exactly one step for a frame of exactly 1/60 s, repeatedly', () => {
    const clock = createFixedStepClock(60, 5);
    for (let i = 0; i < 600; i++) expect(clock.advance(1 / 60)).toBe(1);
  });

  it('accumulates short frames and reports alpha', () => {
    const clock = createFixedStepClock(60, 5);
    expect(clock.advance(0.01)).toBe(0);
    expect(clock.alpha()).toBeCloseTo(0.6, 6);
    expect(clock.advance(0.01)).toBe(1);
    expect(clock.alpha()).toBeCloseTo(0.2, 6);
  });

  it('caps at maxStepsPerFrame and discards the backlog (FD-F-03)', () => {
    const clock = createFixedStepClock(60, 5);
    expect(clock.advance(0.5)).toBe(5);
    expect(clock.alpha()).toBe(0);
    expect(clock.advance(1 / 60)).toBe(1);
  });

  it('runs exactly maxStepsPerFrame without discarding when the backlog fits', () => {
    const clock = createFixedStepClock(60, 5);
    expect(clock.advance(5 / 60)).toBe(5);
    expect(clock.advance(0)).toBe(0);
  });

  it.each([Number.NaN, -0.1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'treats dt %s as 0, counts it and never throws (BR-F-06, BR-F-11)',
    (dt) => {
      const diag = createDiagnostics(() => undefined);
      const clock = createFixedStepClock(60, 5, diag);
      clock.advance(0.01);
      expect(clock.advance(dt)).toBe(0);
      expect(clock.alpha()).toBeCloseTo(0.6, 6);
      expect(diag.snapshot()['core/invalid-dt']).toBe(1);
    },
  );

  it('reset clears the accumulator', () => {
    const clock = createFixedStepClock(60, 5);
    clock.advance(0.015);
    clock.reset();
    expect(clock.alpha()).toBe(0);
    expect(clock.advance(0.01)).toBe(0);
  });

  it('gives identical step counts for an identical dt sequence', () => {
    const seq = [0.016, 0.017, 0.033, 0.001, 0.25, 0.016];
    const run = (): number[] => {
      const clock = createFixedStepClock(60, 5);
      return seq.map((dt) => clock.advance(dt));
    };
    expect(run()).toEqual(run());
  });
});
