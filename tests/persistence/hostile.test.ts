/** Hostile stored data (security-design-menus-settings, SEC-MS-03/-04/-05). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalStorageRepos, HISTORY_KEY, SETTINGS_KEY } from '../../src/persistence';
import { DEFAULT_SETTINGS, SPEC_KEYS, validateSettings } from '../../src/settings';
import { createFakeStorage, domError, entry } from './fake-storage';

const opts = { validateSettings };
const errorSpy = vi.spyOn(console, 'error');
afterEach(() => {
  expect(errorSpy).not.toHaveBeenCalled();
  expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  expect(Object.prototype).not.toHaveProperty('x');
});

describe('prototype pollution', () => {
  it.each([
    '{"schemaVersion":1,"settings":{"__proto__":{"x":1},"fovDeg":100}}',
    '{"schemaVersion":1,"__proto__":{"x":1},"settings":{"constructor":{"prototype":{"x":1}}}}',
    '{"__proto__":{"schemaVersion":1},"settings":{}}',
  ])('ignores %s', (raw) => {
    const { settings } = createLocalStorageRepos(createFakeStorage({ [SETTINGS_KEY]: raw }), opts);
    const loaded = settings.load();
    if (loaded !== null) expect(Object.keys(loaded)).toEqual([...SPEC_KEYS]);
  });

  it('keeps only spec keys and ignores extra keys', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS, evil: '<img>' },
    });
    const loaded = createLocalStorageRepos(
      createFakeStorage({ [SETTINGS_KEY]: raw }),
      opts,
    ).settings.load();
    expect(Object.keys(loaded ?? {})).toEqual([...SPEC_KEYS]);
  });

  it('history entries with __proto__ are rebuilt without it', () => {
    const raw = `{"schemaVersion":1,"entries":[${JSON.stringify(entry(1)).slice(0, -1)},"__proto__":{"x":1}}]}`;
    const list = createLocalStorageRepos(
      createFakeStorage({ [HISTORY_KEY]: raw }),
      opts,
    ).history.list();
    expect(list).toHaveLength(1);
    expect(Object.getPrototypeOf(list[0])).toBe(Object.prototype);
  });
});

describe('size and volume limits', () => {
  it('treats a 1 MB value as corrupt without parsing', () => {
    const parse = vi.spyOn(JSON, 'parse');
    const big = JSON.stringify({ schemaVersion: 1, settings: { pad: 'x'.repeat(1 << 20) } });
    const { settings } = createLocalStorageRepos(createFakeStorage({ [SETTINGS_KEY]: big }), opts);
    expect(settings.load()).toBeNull();
    expect(settings.status()).toBe('reset');
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it('accepts at most 50 of 10 000 stored entries', () => {
    // 10 000 small entries would exceed 64 KB, so the record is reset unparsed.
    const many = Array.from({ length: 10_000 }, (_v, i) => entry(i % 50));
    const raw = JSON.stringify({ schemaVersion: 1, entries: many });
    const { history } = createLocalStorageRepos(createFakeStorage({ [HISTORY_KEY]: raw }), opts);
    expect(history.list()).toEqual([]);
    expect(history.status()).toBe('reset');
    // 200 entries fit under the size cap: only the first 50 are read.
    const some = JSON.stringify({
      schemaVersion: 1,
      entries: Array.from({ length: 200 }, (_v, i) => entry(i)),
    });
    const h2 = createLocalStorageRepos(createFakeStorage({ [HISTORY_KEY]: some }), opts).history;
    expect(h2.list()).toHaveLength(50);
    expect(h2.status()).toBe('repaired');
  });
});

describe('storage that throws on every method', () => {
  it.each(['SecurityError', 'QuotaExceededError'])('%s never escapes', (name) => {
    const st = createFakeStorage();
    st.throwOn = { getItem: domError(name), setItem: domError(name) };
    const { settings, history } = createLocalStorageRepos(st, opts);
    expect(() => {
      settings.load();
      settings.save(DEFAULT_SETTINGS);
      history.list();
      history.append(entry(1));
      history.clear();
    }).not.toThrow();
    expect(settings.status()).toBe('unavailable');
    expect(history.status()).toBe('unavailable');
  });
});
