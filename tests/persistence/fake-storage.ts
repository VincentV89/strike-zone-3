import type { HistoryEntry } from '../../src/contracts';

/** Map-backed Storage double with call counters and a throw switch. */
export interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly data: Map<string, string>;
  readonly calls: { getItem: number; setItem: number };
  throwOn: { getItem?: Error; setItem?: Error };
}

export function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  const calls = { getItem: 0, setItem: 0 };
  const store: FakeStorage = {
    data,
    calls,
    throwOn: {},
    getItem(key) {
      calls.getItem++;
      if (store.throwOn.getItem !== undefined) throw store.throwOn.getItem;
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      calls.setItem++;
      if (store.throwOn.setItem !== undefined) throw store.throwOn.setItem;
      data.set(key, value);
    },
  };
  return store;
}

export function domError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

/** A valid history entry; i shifts endedAt by minutes. */
export function entry(i: number, over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    schemaVersion: 1,
    endedAt: new Date(Date.UTC(2026, 10, 1, 12, i)).toISOString(),
    map: 'desert-compound',
    bots: 5,
    difficulty: 'normal',
    outcome: 'victory',
    kills: 5,
    accuracy: 0.41,
    durationSec: 120,
    ...over,
  };
}
