/**
 * Guarded read of one `strikezone:*` record. Fixed order: size, parse,
 * shape, schema (SD-MS-02). Never throws and never logs (SEC-MS-05).
 */
import { MAX_STORED_LENGTH, SCHEMA_VERSION, type StorageLike } from './types';

export type EnvelopeRead =
  | { readonly status: 'unavailable' | 'fresh' | 'reset' }
  | { readonly status: 'ok'; readonly data: Readonly<Record<string, unknown>> };

export function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function readEnvelope(storage: StorageLike | null, key: string): EnvelopeRead {
  if (storage === null) return { status: 'unavailable' };
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { status: 'unavailable' };
  }
  if (raw === null) return { status: 'fresh' };
  if (typeof raw !== 'string' || raw.length > MAX_STORED_LENGTH) return { status: 'reset' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'reset' };
  }
  if (!isPlainRecord(data)) return { status: 'reset' };
  if (!Object.hasOwn(data, 'schemaVersion') || data['schemaVersion'] !== SCHEMA_VERSION) {
    return { status: 'reset' };
  }
  return { status: 'ok', data };
}

/** Writes inside try. Returns false on any throw (QuotaExceededError, SecurityError). */
export function writeEnvelope(storage: StorageLike, key: string, body: object): boolean {
  try {
    storage.setItem(key, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...body }));
    return true;
  } catch {
    return false;
  }
}
