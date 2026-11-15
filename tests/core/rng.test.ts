import { describe, expect, it } from 'vitest';
import { createRng, fnv1a32, StrikeZoneError } from '../../src/core';

function draws(rng: { next(): number }, n: number): number[] {
  return Array.from({ length: n }, () => rng.next());
}

describe('createRng', () => {
  it('pins the algorithm with golden values for seed 42 (BR-F-05)', () => {
    expect(draws(createRng(42), 8)).toEqual(GOLDEN_SEED_42);
  });

  it('gives the same sequence for the same seed and a different one for another seed', () => {
    expect(draws(createRng(7), 32)).toEqual(draws(createRng(7), 32));
    expect(draws(createRng(7), 32)).not.toEqual(draws(createRng(8), 32));
  });

  it('returns values in [0, 1)', () => {
    const rng = createRng(1);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  it('forks from the root seed and path, independent of parent draws (FD-F-02)', () => {
    const fresh = createRng(42).fork('spawn');
    const parent = createRng(42);
    draws(parent, 100);
    const afterDraws = parent.fork('spawn');
    expect(draws(afterDraws, 16)).toEqual(draws(fresh, 16));
  });

  it('treats nested forks as a path and gives equal fresh streams for the same name', () => {
    const root = createRng(9);
    expect(draws(root.fork('a').fork('b'), 8)).toEqual(draws(createRng(9).fork('a/b'), 8));
    expect(draws(root.fork('x'), 8)).toEqual(draws(root.fork('x'), 8));
    expect(draws(root.fork('ai:1'), 8)).not.toEqual(draws(root.fork('ai:2'), 8));
  });

  it('int never returns maxExcl and is uniform within 3 % over 100 000 draws', () => {
    const rng = createRng(123);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const v = rng.int(0, 10);
      expect(Number.isInteger(v) && v >= 0 && v < 10).toBe(true);
      buckets[v] = (buckets[v] ?? 0) + 1;
    }
    for (const count of buckets) expect(Math.abs(count - 10_000)).toBeLessThanOrEqual(300);
  });

  it('range and pick stay inside their bounds', () => {
    const rng = createRng(5);
    const xs = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 1000; i++) {
      const r = rng.range(-2, 3);
      expect(r >= -2 && r < 3).toBe(true);
      expect(xs).toContain(rng.pick(xs));
    }
    expect(rng.range(4, 4)).toBe(4);
  });

  it.each([-1, 2 ** 32, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '42' as unknown as number])(
    'rejects invalid seed %s with core/invalid-seed (BR-F-03)',
    (seed) => {
      expect(() => createRng(seed)).toThrow(expect.objectContaining({ code: 'core/invalid-seed' }));
    },
  );

  it('accepts the boundary seeds 0 and 2^32 - 1', () => {
    expect(() => createRng(0)).not.toThrow();
    expect(() => createRng(0xffffffff)).not.toThrow();
  });

  it('throws StrikeZoneError on invalid range, int and pick arguments (BR-F-09)', () => {
    const rng = createRng(1);
    expect(() => rng.range(2, 1)).toThrow(StrikeZoneError);
    expect(() => rng.range(0, Number.NaN)).toThrow(StrikeZoneError);
    expect(() => rng.int(3, 3)).toThrow(StrikeZoneError);
    expect(() => rng.int(0.5, 3)).toThrow(StrikeZoneError);
    expect(() => rng.pick([])).toThrow(expect.objectContaining({ code: 'core/empty-pick' }));
  });

  it('hashes the empty path to the FNV offset basis', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });
});

// Cross-checked against an independent plain-JS sfc32/splitmix32 implementation at code-generation.
const GOLDEN_SEED_42: number[] = [
  0.6247991565614939, 0.5244054791983217, 0.644877819577232, 0.6688713920302689, 0.9080222574993968,
  0.7217219381127506, 0.451867051422596, 0.8994577426929027,
];
