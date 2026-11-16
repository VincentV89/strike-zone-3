/**
 * FNV-1a replay hash over every snapshot number and every drained event
 * field (SD-GS-05). Numbers are hashed through their IEEE bytes, so -0 and
 * NaN payloads count. Test-only.
 */
import type { SimEvent, SimSnapshot } from '../../src/contracts';

export interface Hasher {
  value(v: unknown): void;
  readonly digest: number;
}

export function createHasher(): Hasher {
  let h = 0x811c9dc5;
  const f64 = new Float64Array(1);
  const bytes = new Uint8Array(f64.buffer);
  const byte = (b: number): void => {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const value = (v: unknown): void => {
    if (typeof v === 'number') {
      f64[0] = v;
      for (const b of bytes) byte(b);
    } else if (typeof v === 'string') {
      for (let i = 0; i < v.length; i++) byte(v.charCodeAt(i) & 0xff);
      byte(0);
    } else if (typeof v === 'boolean') {
      byte(v ? 1 : 2);
    } else if (v === null || v === undefined) {
      byte(3);
    } else if (Array.isArray(v)) {
      byte(4);
      for (const x of v) value(x);
      byte(5);
    } else if (typeof v === 'object') {
      byte(6);
      for (const k of Object.keys(v).sort()) {
        value(k);
        value((v as Record<string, unknown>)[k]);
      }
      byte(7);
    }
  };
  return {
    value,
    get digest() {
      return h >>> 0;
    },
  };
}

export function hashTick(
  h: Hasher,
  snap: Readonly<SimSnapshot>,
  events: readonly SimEvent[],
): void {
  h.value(snap);
  h.value(events);
}
