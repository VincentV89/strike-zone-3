/**
 * Match-history repository over `strikezone:history` (Could, story-match-history).
 * Newest first, at most 50 valid version-1 entries. Each kept entry is rebuilt
 * as a fresh frozen literal; stored objects are never returned as-is.
 */
import type { HistoryEntry } from '../contracts';
import { isPlainRecord, readEnvelope, writeEnvelope } from './envelope';
import { isBotCount, isDifficulty, isMapId, isOutcome } from './known-values';
import {
  HISTORY_CAP,
  HISTORY_KEY,
  type HistoryRepo,
  type StorageLike,
  type StorageStatus,
} from './types';

const MAX_ENDED_AT_LENGTH = 40;

function isNonNegativeInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
}

function field(e: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(e, key) ? e[key] : undefined;
}

/** Returns a fresh frozen entry, or null if any field is invalid (SEC-MS-04, SEC-MS-11). */
export function toValidEntry(raw: unknown): HistoryEntry | null {
  if (!isPlainRecord(raw)) return null;
  const endedAt = field(raw, 'endedAt');
  const map = field(raw, 'map');
  const bots = field(raw, 'bots');
  const difficulty = field(raw, 'difficulty');
  const outcome = field(raw, 'outcome');
  const kills = field(raw, 'kills');
  const accuracy = field(raw, 'accuracy');
  const durationSec = field(raw, 'durationSec');
  if (field(raw, 'schemaVersion') !== 1) return null;
  if (typeof endedAt !== 'string' || endedAt.length > MAX_ENDED_AT_LENGTH) return null;
  if (!Number.isFinite(Date.parse(endedAt))) return null;
  if (!isMapId(map) || !isBotCount(bots) || !isDifficulty(difficulty) || !isOutcome(outcome)) {
    return null;
  }
  if (!isNonNegativeInt(kills) || !isNonNegativeInt(durationSec)) return null;
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) {
    return null;
  }
  return Object.freeze({
    schemaVersion: 1,
    endedAt,
    map,
    bots,
    difficulty,
    outcome,
    kills,
    accuracy,
    durationSec,
  });
}

function newestFirst(list: HistoryEntry[]): readonly HistoryEntry[] {
  list.sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
  return Object.freeze(list.slice(0, HISTORY_CAP));
}

export function createHistoryRepo(storage: StorageLike | null): HistoryRepo {
  let status: StorageStatus = storage === null ? 'unavailable' : 'fresh';
  let latched = storage === null;
  let cache: readonly HistoryEntry[] | null = null;

  function load(): readonly HistoryEntry[] {
    const read = readEnvelope(storage, HISTORY_KEY);
    if (read.status !== 'ok') {
      status = read.status;
      if (read.status === 'unavailable') latched = true;
      return Object.freeze([]);
    }
    const entries = Object.hasOwn(read.data, 'entries') ? read.data['entries'] : undefined;
    if (!Array.isArray(entries)) {
      status = 'reset';
      return Object.freeze([]);
    }
    const kept: HistoryEntry[] = [];
    let dropped = false;
    for (const raw of entries.slice(0, HISTORY_CAP) as unknown[]) {
      const e = toValidEntry(raw);
      if (e === null) dropped = true;
      else kept.push(e);
    }
    status = dropped || entries.length > HISTORY_CAP ? 'repaired' : 'loaded';
    return newestFirst(kept);
  }

  function persist(list: readonly HistoryEntry[]): void {
    cache = list;
    if (latched || storage === null) return;
    if (!writeEnvelope(storage, HISTORY_KEY, { entries: list })) {
      latched = true;
      status = 'unavailable';
    }
  }

  return {
    list(): readonly HistoryEntry[] {
      cache ??= load();
      return cache;
    },
    append(e: HistoryEntry): void {
      const valid = toValidEntry(e);
      if (valid === null) return;
      cache ??= load();
      persist(newestFirst([valid, ...cache]));
    },
    clear(): void {
      persist(Object.freeze([]));
    },
    status(): StorageStatus {
      cache ??= load();
      return status;
    },
  };
}
