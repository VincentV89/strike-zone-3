/**
 * Per-round seed source (FD-AS-Q2, SD-AS-14). Every round, including Play
 * Again and Restart, gets a fresh 32-bit seed from crypto.getRandomValues.
 * The test seam's setSeed overrides the next round only. The seed is never
 * passed to Diagnostics or the console.
 */
import type { Diagnostics } from '../core';

export type GetRandomValues = (array: Uint32Array<ArrayBuffer>) => unknown;

export interface SeedSource {
  next(): number;
  /** Test seam: the next round uses this seed, later rounds are random again. */
  override(seed: number): void;
}

export interface SeedSourceDeps {
  readonly getRandomValues: GetRandomValues | null;
  /** Fallback entropy (wall clock); only used without crypto. */
  readonly fallback: () => number;
  readonly diag: Diagnostics;
}

export function isSeed(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 0xffffffff;
}

export function createSeedSource(deps: SeedSourceDeps): SeedSource {
  const buf = new Uint32Array(new ArrayBuffer(4));
  let pending: number | null = null;
  return {
    next() {
      if (pending !== null) {
        const s = pending;
        pending = null;
        return s;
      }
      if (deps.getRandomValues !== null) {
        deps.getRandomValues(buf);
        return buf[0] ?? 0;
      }
      deps.diag.warnOnce('app/weak-seed');
      return deps.fallback() >>> 0;
    },
    override(seed) {
      if (isSeed(seed)) pending = seed;
    },
  };
}
