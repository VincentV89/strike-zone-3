import { describe, expect, it } from 'vitest';
import { createDiagnostics, type DiagnosticDetail } from '../../src/core';

describe('createDiagnostics', () => {
  it('calls the sink once per code and counts every occurrence (BR-F-12)', () => {
    const calls: [string, DiagnosticDetail | undefined][] = [];
    const diag = createDiagnostics((code, detail) => calls.push([code, detail]));
    diag.warnOnce('combat/unknown-target', { id: 3 });
    diag.warnOnce('combat/unknown-target', { id: 4 });
    diag.warnOnce('nav/no-path');
    expect(calls).toEqual([
      ['combat/unknown-target', { id: 3 }],
      ['nav/no-path', undefined],
    ]);
    expect(diag.snapshot()).toEqual({ 'combat/unknown-target': 2, 'nav/no-path': 1 });
  });

  it('count never calls the sink', () => {
    let sinkCalls = 0;
    const diag = createDiagnostics(() => {
      sinkCalls += 1;
    });
    diag.count('core/event-buffer-dropped');
    diag.count('core/event-buffer-dropped');
    expect(sinkCalls).toBe(0);
    expect(diag.snapshot()['core/event-buffer-dropped']).toBe(2);
  });

  it('returns a frozen snapshot that later counts do not change', () => {
    const diag = createDiagnostics(() => undefined);
    diag.count('a/b');
    const snap = diag.snapshot();
    diag.count('a/b');
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap['a/b']).toBe(1);
  });

  it('passes only the code and the numeric/boolean record to the sink (SEC-F-18)', () => {
    const received: unknown[][] = [];
    const diag = createDiagnostics((...args: unknown[]) => received.push(args));
    diag.warnOnce('core/event-buffer-overflow', { capacity: 4096, dropped: true });
    expect(received).toEqual([['core/event-buffer-overflow', { capacity: 4096, dropped: true }]]);
  });
});
