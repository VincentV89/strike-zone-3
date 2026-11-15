import { describe, expect, it } from 'vitest';
import { createDiagnostics, createEventBuffer, DEFAULT_EVENT_CAPACITY } from '../../src/core';

describe('createEventBuffer', () => {
  it('drains events in push order (BR-F-16)', () => {
    const buf = createEventBuffer<number>();
    [3, 1, 2].forEach((n) => {
      buf.push(n);
    });
    expect([...buf.drain()]).toEqual([3, 1, 2]);
    expect(buf.drain()).toHaveLength(0);
  });

  it('reuses drained arrays, so a drained array is valid only until the next drain (BR-F-14)', () => {
    const buf = createEventBuffer<string>();
    buf.push('a');
    const first = buf.drain();
    buf.push('b');
    const second = buf.drain();
    expect(second).not.toBe(first);
    buf.push('c');
    const third = buf.drain();
    expect(third).toBe(first);
    expect([...third]).toEqual(['c']);
  });

  it('caps at 4096 by default, drops the newest and counts it (BR-F-15)', () => {
    const sink: string[] = [];
    const diag = createDiagnostics((code) => sink.push(code));
    const buf = createEventBuffer<number>(undefined, diag);
    for (let i = 0; i < DEFAULT_EVENT_CAPACITY + 1; i++) buf.push(i);
    const out = buf.drain();
    expect(DEFAULT_EVENT_CAPACITY).toBe(4096);
    expect(out).toHaveLength(4096);
    expect(out[4095]).toBe(4095);
    expect(diag.snapshot()['core/event-buffer-dropped']).toBe(1);
    expect(sink).toEqual(['core/event-buffer-overflow']);
  });

  it('drops silently without diagnostics and keeps working after a drain', () => {
    const buf = createEventBuffer<number>(2);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect([...buf.drain()]).toEqual([1, 2]);
    buf.push(4);
    expect([...buf.drain()]).toEqual([4]);
  });
});
