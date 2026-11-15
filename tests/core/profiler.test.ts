import { describe, expect, it } from 'vitest';
import { createDiagnostics, createProfiler, PROFILE_SECTIONS } from '../../src/core';

function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe('createProfiler', () => {
  it('reports zero means before any frame ends (BR-F-17)', () => {
    const report = createProfiler(() => 0).report();
    expect(report.frames).toBe(0);
    expect(report.inclusive).toBe(true);
    expect(Object.keys(report.sections)).toEqual([...PROFILE_SECTIONS]);
    expect(report.sections.sim.meanMsPerFrame).toBe(0);
  });

  it('includes the physics section (FD-F-04)', () => {
    expect(PROFILE_SECTIONS).toContain('physics');
  });

  it('computes inclusive mean and max per frame across nested sections', () => {
    const clock = fakeClock();
    const p = createProfiler(clock.now);
    // frame 1: sim 3 ms containing ai-sense 1 ms
    p.begin('sim');
    clock.advance(1);
    p.begin('ai-sense');
    clock.advance(1);
    p.end('ai-sense');
    clock.advance(1);
    p.end('sim');
    p.endFrame();
    // frame 2: sim 1 ms, ai-sense not run (10 Hz AI)
    p.begin('sim');
    clock.advance(1);
    p.end('sim');
    p.endFrame();

    const r = p.report();
    expect(r.frames).toBe(2);
    expect(r.sections.sim).toEqual({ meanMsPerFrame: 2, maxMsPerFrame: 3, totalMs: 4, calls: 2 });
    expect(r.sections['ai-sense']).toEqual({
      meanMsPerFrame: 0.5,
      maxMsPerFrame: 1,
      totalMs: 1,
      calls: 1,
    });
  });

  it('counts misuse instead of throwing', () => {
    const diag = createDiagnostics(() => undefined);
    const p = createProfiler(() => 0, diag);
    expect(() => {
      p.end('nav');
      p.begin('nav');
      p.begin('nav');
    }).not.toThrow();
    expect(diag.snapshot()).toEqual({
      'core/profiler-unbalanced': 1,
      'core/profiler-reentrant': 1,
    });
  });

  it('reset clears every counter', () => {
    const clock = fakeClock();
    const p = createProfiler(clock.now);
    p.begin('combat');
    clock.advance(2);
    p.end('combat');
    p.endFrame();
    p.reset();
    const r = p.report();
    expect(r.frames).toBe(0);
    expect(r.sections.combat).toEqual({
      meanMsPerFrame: 0,
      maxMsPerFrame: 0,
      totalMs: 0,
      calls: 0,
    });
  });

  it('produces a JSON-serialisable report', () => {
    const r = createProfiler(() => 0).report();
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
