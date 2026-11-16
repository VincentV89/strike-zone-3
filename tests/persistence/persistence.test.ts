import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Settings } from '../../src/contracts';
import {
  createLocalStorageRepos,
  HISTORY_KEY,
  SETTINGS_KEY,
  toValidEntry,
} from '../../src/persistence';
import { DEFAULT_SETTINGS, validateSettings } from '../../src/settings';
import { createFakeStorage, domError, entry } from './fake-storage';

const opts = { validateSettings };
const record = (body: unknown): string => JSON.stringify(body);

const errorSpy = vi.spyOn(console, 'error');
afterEach(() => {
  expect(errorSpy).not.toHaveBeenCalled(); // SEC-MS-05
});

describe('settings repo load decision tree', () => {
  it('storage null → unavailable, null, no saves', () => {
    const { settings } = createLocalStorageRepos(null, opts);
    expect(settings.load()).toBeNull();
    expect(settings.status()).toBe('unavailable');
    settings.save(DEFAULT_SETTINGS);
  });

  it('getItem throws → unavailable and saves are latched', () => {
    const st = createFakeStorage();
    st.throwOn.getItem = domError('SecurityError');
    const { settings } = createLocalStorageRepos(st, opts);
    expect(settings.load()).toBeNull();
    expect(settings.status()).toBe('unavailable');
    settings.save(DEFAULT_SETTINGS);
    expect(st.calls.setItem).toBe(0);
  });

  it('missing item → fresh', () => {
    const { settings } = createLocalStorageRepos(createFakeStorage(), opts);
    expect(settings.load()).toBeNull();
    expect(settings.status()).toBe('fresh');
  });

  it.each([
    ['unparsable JSON', '{nope'],
    ['an array', '[1,2]'],
    ['a number', '42'],
    ['wrong schemaVersion', record({ schemaVersion: 2, settings: DEFAULT_SETTINGS })],
    ['missing schemaVersion', record({ settings: DEFAULT_SETTINGS })],
    ['settings not an object', record({ schemaVersion: 1, settings: 'x' })],
    ['oversized value', 'x'.repeat(65_537)],
  ])('%s → reset, record left in place (BR-MS-13)', (_name, raw) => {
    const st = createFakeStorage({ [SETTINGS_KEY]: raw });
    const { settings } = createLocalStorageRepos(st, opts);
    expect(settings.load()).toBeNull();
    expect(settings.status()).toBe('reset');
    expect(st.data.get(SETTINGS_KEY)).toBe(raw);
  });

  it('valid record → loaded; invalid field → repaired', () => {
    const good = { ...DEFAULT_SETTINGS, fovDeg: 100 };
    const st = createFakeStorage({ [SETTINGS_KEY]: record({ schemaVersion: 1, settings: good }) });
    const a = createLocalStorageRepos(st, opts).settings;
    expect(a.load()).toEqual(good);
    expect(a.status()).toBe('loaded');

    st.data.set(
      SETTINGS_KEY,
      record({ schemaVersion: 1, settings: { ...good, sensitivity: 'fast' } }),
    );
    const b = createLocalStorageRepos(st, opts).settings;
    expect(b.load()).toEqual({ ...good, sensitivity: 1 });
    expect(b.status()).toBe('repaired');
  });

  it('save round-trips through load', () => {
    const st = createFakeStorage();
    const s: Settings = { ...DEFAULT_SETTINGS, graphics: 'low', roundDurationSec: 600 };
    createLocalStorageRepos(st, opts).settings.save(s);
    expect(JSON.parse(st.data.get(SETTINGS_KEY) ?? '')).toEqual({ schemaVersion: 1, settings: s });
    expect(createLocalStorageRepos(st, opts).settings.load()).toEqual(s);
  });

  it('a failed write latches: one failing setItem, then no more (BR-MS-12)', () => {
    const st = createFakeStorage();
    st.throwOn.setItem = domError('QuotaExceededError');
    const { settings } = createLocalStorageRepos(st, opts);
    settings.load();
    settings.save(DEFAULT_SETTINGS);
    settings.save({ ...DEFAULT_SETTINGS, fovDeg: 100 });
    expect(st.calls.setItem).toBe(1);
    expect(settings.status()).toBe('unavailable');
  });
});

describe('history repo', () => {
  it('fresh storage lists [] and append keeps newest first', () => {
    const st = createFakeStorage();
    const { history } = createLocalStorageRepos(st, opts);
    expect(history.list()).toEqual([]);
    expect(history.status()).toBe('fresh');
    history.append(entry(1));
    history.append(entry(3));
    history.append(entry(2));
    expect(history.list().map((e) => e.endedAt)).toEqual(
      [entry(3), entry(2), entry(1)].map((e) => e.endedAt),
    );
    const reloaded = createLocalStorageRepos(st, opts).history;
    expect(reloaded.list()).toEqual(history.list());
    expect(reloaded.status()).toBe('loaded');
  });

  it('caps at 50 entries (BR-MS-14)', () => {
    const st = createFakeStorage();
    const { history } = createLocalStorageRepos(st, opts);
    for (let i = 0; i < 55; i++) history.append(entry(i));
    expect(history.list()).toHaveLength(50);
    expect(history.list()[0]?.endedAt).toBe(entry(54).endedAt);
    const stored = JSON.parse(st.data.get(HISTORY_KEY) ?? '') as { entries: unknown[] };
    expect(stored.entries).toHaveLength(50);
  });

  it('returns the same frozen array until it changes', () => {
    const { history } = createLocalStorageRepos(createFakeStorage(), opts);
    const a = history.list();
    expect(history.list()).toBe(a);
    history.append(entry(1));
    const b = history.list();
    expect(b).not.toBe(a);
    expect(Object.isFrozen(b)).toBe(true);
    expect(Object.isFrozen(b[0])).toBe(true);
  });

  it('drops invalid entries and reports repaired', () => {
    const st = createFakeStorage({
      [HISTORY_KEY]: record({
        schemaVersion: 1,
        entries: [entry(1), { ...entry(2), map: 'moon' }, 'x'],
      }),
    });
    const { history } = createLocalStorageRepos(st, opts);
    expect(history.list()).toEqual([entry(1)]);
    expect(history.status()).toBe('repaired');
  });

  it('bad envelope → [] and reset; entries not an array → reset', () => {
    for (const raw of ['{', record({ schemaVersion: 1, entries: {} })]) {
      const { history } = createLocalStorageRepos(createFakeStorage({ [HISTORY_KEY]: raw }), opts);
      expect(history.list()).toEqual([]);
      expect(history.status()).toBe('reset');
    }
  });

  it('clear writes an empty list', () => {
    const st = createFakeStorage();
    const { history } = createLocalStorageRepos(st, opts);
    history.append(entry(1));
    history.clear();
    expect(history.list()).toEqual([]);
    expect(JSON.parse(st.data.get(HISTORY_KEY) ?? '')).toEqual({ schemaVersion: 1, entries: [] });
  });

  it('ignores an invalid appended entry', () => {
    const st = createFakeStorage();
    const { history } = createLocalStorageRepos(st, opts);
    history.append({ ...entry(1), kills: -1 });
    expect(history.list()).toEqual([]);
    expect(st.calls.setItem).toBe(0);
  });

  it('keeps working in memory when writes fail', () => {
    const st = createFakeStorage();
    st.throwOn.setItem = domError('QuotaExceededError');
    const { history } = createLocalStorageRepos(st, opts);
    history.append(entry(1));
    history.append(entry(2));
    expect(history.list()).toHaveLength(2);
    expect(st.calls.setItem).toBe(1);
    expect(history.status()).toBe('unavailable');
  });
});

describe('toValidEntry (SEC-MS-04, SEC-MS-11)', () => {
  it.each([
    ['schemaVersion', { schemaVersion: 2 }],
    ['unknown map', { map: 'moon' }],
    ['unknown difficulty', { difficulty: 'insane' }],
    ['unknown outcome', { outcome: 'draw' }],
    ['bots not in BOT_COUNTS', { bots: 4 }],
    ['negative kills', { kills: -1 }],
    ['fractional kills', { kills: 1.5 }],
    ['fractional duration', { durationSec: 1.5 }],
    ['accuracy above 1', { accuracy: 1.2 }],
    ['accuracy NaN', { accuracy: Number.NaN }],
    ['unparsable endedAt', { endedAt: 'yesterday' }],
    ['long endedAt', { endedAt: `2026-11-01T00:00:00.000Z${' '.repeat(30)}` }],
  ])('drops an entry with %s', (_n, over) => {
    expect(toValidEntry({ ...entry(1), ...over })).toBeNull();
  });

  it('rebuilds a valid entry with exactly the schema keys', () => {
    const e = toValidEntry({ ...entry(1), note: 'free text' });
    expect(e).toEqual(entry(1));
    expect(Object.keys(e ?? {}).sort()).toEqual(Object.keys(entry(1)).sort());
  });
});
