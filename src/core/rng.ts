import { StrikeZoneError } from './errors';
import { isSeed, type Seed } from './types';

/**
 * A seeded random stream. See `createRng`.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). Requires finite min <= max. */
  range(min: number, max: number): number;
  /** Uniform integer in [min, maxExcl). Requires integers with min < maxExcl. */
  int(min: number, maxExcl: number): number;
  /** Uniform element of a non-empty list. */
  pick<T>(xs: readonly T[]): T;
  /** Independent child stream derived from the root seed and the stream path (FD-F-02). */
  fork(stream: string): Rng;
}

const TWO_POW_32 = 4294967296;
const WARM_UP_DRAWS = 12;

/** FNV-1a 32-bit hash over UTF-16 code units. fnv1a32("") = 0x811C9DC5. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32 generator, used only to seed the four sfc32 words. */
function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

class Sfc32Stream implements Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private readonly rootSeed: number;
  private readonly path: string;

  constructor(rootSeed: number, path: string) {
    this.rootSeed = rootSeed;
    this.path = path;
    const sm = splitmix32((rootSeed ^ fnv1a32(path)) >>> 0);
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    for (let i = 0; i < WARM_UP_DRAWS; i++) this.nextUint32();
  }

  /** One sfc32 step; returns an unsigned 32-bit integer. Allocates nothing. */
  private nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  next(): number {
    return this.nextUint32() / TWO_POW_32;
  }

  range(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new StrikeZoneError('core/invalid-range', 'range() needs finite min <= max', {
        min,
        max,
      });
    }
    return min + (max - min) * this.next();
  }

  int(min: number, maxExcl: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxExcl) || min >= maxExcl) {
      throw new StrikeZoneError('core/invalid-int-range', 'int() needs integers min < maxExcl', {
        min,
        maxExcl,
      });
    }
    return min + Math.floor(this.next() * (maxExcl - min));
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) {
      throw new StrikeZoneError('core/empty-pick', 'pick() needs a non-empty list');
    }
    return xs[this.int(0, xs.length)] as T;
  }

  fork(stream: string): Rng {
    return new Sfc32Stream(this.rootSeed, this.path === '' ? stream : `${this.path}/${stream}`);
  }
}

/**
 * Deterministic sfc32 PRNG for simulation only. Not cryptographically secure.
 * Never use for tokens, ids that must be unguessable, or anything
 * security-relevant (SEC-F-13). If a CSPRNG is needed, use
 * `crypto.getRandomValues` in the adapter ring.
 *
 * The algorithm is fixed (BR-F-05): sfc32 with its four words seeded from
 * splitmix32(rootSeed XOR fnv1a32(path)), then 12 warm-up draws. Changing it
 * breaks every seeded fixture and needs an ADR.
 *
 * @throws StrikeZoneError('core/invalid-seed') unless seed is an integer in [0, 2^32 - 1].
 */
export function createRng(seed: Seed): Rng {
  if (!isSeed(seed)) {
    throw new StrikeZoneError('core/invalid-seed', 'Seed must be an integer in [0, 2^32 - 1]');
  }
  return new Sfc32Stream(seed >>> 0, '');
}
