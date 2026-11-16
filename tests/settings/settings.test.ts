import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../src/contracts';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  normalise,
  SETTINGS_SPEC,
  SPEC_KEYS,
  validateSettings,
  type SettingsStoreRepo,
} from '../../src/settings';

function spyRepo(initial: Settings | null = null): SettingsStoreRepo & { saves: Settings[] } {
  const saves: Settings[] = [];
  return { saves, load: () => initial, save: (s) => saves.push({ ...s }) };
}

describe('SETTINGS_SPEC (BR-MS-01, BR-MS-02)', () => {
  it('has the agreed ranges, steps and defaults', () => {
    expect(SETTINGS_SPEC.sensitivity).toMatchObject({ min: 0.1, max: 5, step: 0.05, default: 1 });
    expect(SETTINGS_SPEC.fovDeg).toMatchObject({ min: 70, max: 110, step: 1, default: 90 });
    expect(SETTINGS_SPEC.masterVolume).toMatchObject({ min: 0, max: 100, step: 1, default: 80 });
    expect(SETTINGS_SPEC.sfxVolume).toMatchObject({ min: 0, max: 100, step: 1, default: 100 });
    expect(SETTINGS_SPEC.graphics.values).toEqual(['low', 'medium', 'high']);
    expect(SETTINGS_SPEC.roundDurationSec.values).toEqual([120, 180, 300, 600]);
    expect(DEFAULT_SETTINGS).toEqual({
      sensitivity: 1,
      fovDeg: 90,
      masterVolume: 80,
      sfxVolume: 100,
      graphics: 'medium',
      roundDurationSec: 180,
    });
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect([...SPEC_KEYS].sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('gives every default a value that normalises to itself', () => {
    for (const k of SPEC_KEYS) expect(normalise(k, DEFAULT_SETTINGS[k])).toBe(DEFAULT_SETTINGS[k]);
  });
});

describe('normalise (SEC-MS-07, BR-MS-03)', () => {
  it.each([
    ['sensitivity', 1.13, 1.15],
    ['sensitivity', 1.12, 1.1],
    ['sensitivity', 0, 0.1],
    ['sensitivity', 99, 5],
    ['sensitivity', 1e308, 5],
    ['sensitivity', -1e308, 0.1],
    ['fovDeg', 89.6, 90],
    ['fovDeg', 10, 70],
    ['fovDeg', 200, 110],
    ['masterVolume', 50.4, 50],
    ['sfxVolume', -5, 0],
  ] as const)('clamps and snaps %s %s to %s', (key, raw, expected) => {
    expect(normalise(key, raw)).toBe(expected);
  });

  it('removes float error from the 0.05 step', () => {
    for (let i = 0; i <= 98; i++) {
      const v = normalise('sensitivity', 0.1 + i * 0.05);
      expect(v).not.toBeNull();
      expect(String(v)).toMatch(/^\d+(\.\d{1,2})?$/);
    }
  });

  it.each([NaN, Infinity, -Infinity, '1', null, undefined, {}, [], true])('rejects %s', (raw) => {
    expect(normalise('sensitivity', raw)).toBeNull();
    expect(normalise('fovDeg', raw)).toBeNull();
  });

  it('accepts only listed enum values', () => {
    expect(normalise('graphics', 'high')).toBe('high');
    expect(normalise('graphics', 'ultra')).toBeNull();
    expect(normalise('graphics', 'HIGH')).toBeNull();
    expect(normalise('roundDurationSec', 300)).toBe(300);
    expect(normalise('roundDurationSec', 240)).toBeNull();
    expect(normalise('roundDurationSec', '300')).toBeNull();
  });
});

describe('validateSettings (SD-MS-01)', () => {
  it('returns null for a non-object body', () => {
    for (const b of [null, undefined, 1, 'x', []]) expect(validateSettings(b)).toBeNull();
  });

  it('repairs invalid fields per field and ignores unknown keys', () => {
    const r = validateSettings({ ...DEFAULT_SETTINGS, fovDeg: 'wide', sensitivity: 2.5, extra: 1 });
    expect(r?.repaired).toBe(true);
    expect(r?.value).toEqual({ ...DEFAULT_SETTINGS, sensitivity: 2.5 });
    expect(Object.keys(r?.value ?? {})).toEqual([...SPEC_KEYS]);
    expect(Object.isFrozen(r?.value)).toBe(true);
  });

  it('marks a complete valid body as not repaired', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS })).toEqual({
      value: DEFAULT_SETTINGS,
      repaired: false,
    });
  });

  it('never reads inherited keys', () => {
    const body = Object.create({ fovDeg: 100 }) as Record<string, unknown>;
    expect(validateSettings(body)?.value.fovDeg).toBe(90);
  });
});

describe('createSettingsStore', () => {
  it('starts from defaults with a null repo and from the loaded value otherwise', () => {
    expect(createSettingsStore(null).get()).toEqual(DEFAULT_SETTINGS);
    const loaded = { ...DEFAULT_SETTINGS, fovDeg: 100 };
    const store = createSettingsStore(spyRepo(loaded));
    expect(store.get().fovDeg).toBe(100);
    expect(Object.isFrozen(store.get())).toBe(true);
  });

  it('accepted set: 1 save and 1 notification per subscriber, frozen new state (PERF-MS-03)', () => {
    const repo = spyRepo();
    const store = createSettingsStore(repo);
    const seen: string[] = [];
    store.subscribe((s, k) => seen.push(`a:${k}:${String(s[k])}`));
    store.subscribe((s, k) => seen.push(`b:${k}:${String(s[k])}`));
    const before = store.get();
    expect(store.set('fovDeg', 100.4)).toBe(100);
    expect(repo.saves).toHaveLength(1);
    expect(repo.saves[0]?.fovDeg).toBe(100);
    expect(seen).toEqual(['a:fovDeg:100', 'b:fovDeg:100']);
    expect(store.get()).not.toBe(before);
    expect(Object.isFrozen(store.get())).toBe(true);
  });

  it('unchanged or rejected set: 0 saves, 0 notifications (PERF-MS-02)', () => {
    const repo = spyRepo();
    const store = createSettingsStore(repo);
    const cb = vi.fn();
    store.subscribe(cb);
    const before = store.get();
    expect(store.set('fovDeg', 90)).toBe(90);
    expect(store.set('fovDeg', Number.NaN)).toBe(90);
    expect(store.set('graphics', 'ultra' as Settings['graphics'])).toBe('medium');
    expect(store.set('fovDeg', 90.2)).toBe(90);
    expect(repo.saves).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
    expect(store.get()).toBe(before);
  });

  it('isolates a throwing subscriber and warns once per key (BR-MS-05)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createSettingsStore(null);
    const after = vi.fn();
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(after);
    store.set('fovDeg', 100);
    store.set('fovDeg', 101);
    expect(after).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('settings/subscriber-failed', 'fovDeg');
    warn.mockRestore();
  });

  it('unsubscribe is idempotent and stops notifications', () => {
    const store = createSettingsStore(null);
    const cb = vi.fn();
    const off = store.subscribe(cb);
    off();
    off();
    store.set('sensitivity', 2);
    expect(cb).not.toHaveBeenCalled();
  });
});
