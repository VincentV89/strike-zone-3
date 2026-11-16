/** Data minimisation (SEC-MS-06) and record sizes (PERF-MS-04). */
import { describe, expect, it } from 'vitest';
import { createLocalStorageRepos, HISTORY_KEY, SETTINGS_KEY } from '../../src/persistence';
import { DEFAULT_SETTINGS, SETTINGS_SPEC, validateSettings } from '../../src/settings';
import { createFakeStorage, entry } from './fake-storage';

const SETTINGS_ALLOWED = [
  'fovDeg',
  'graphics',
  'masterVolume',
  'roundDurationSec',
  'sensitivity',
  'sfxVolume',
];
const ENTRY_ALLOWED = [
  'accuracy',
  'bots',
  'difficulty',
  'durationSec',
  'endedAt',
  'kills',
  'map',
  'outcome',
  'schemaVersion',
];

describe('serialised records', () => {
  it('hold exactly the allowed keys', () => {
    const st = createFakeStorage();
    const repos = createLocalStorageRepos(st, { validateSettings });
    repos.settings.save({ ...DEFAULT_SETTINGS, ...({ extra: 1 } as object) });
    repos.history.append(entry(1));
    const s = JSON.parse(st.data.get(SETTINGS_KEY) ?? '') as { settings: object };
    expect(Object.keys(s).sort()).toEqual(['schemaVersion', 'settings']);
    expect(Object.keys(s.settings).sort()).toEqual(SETTINGS_ALLOWED);
    const h = JSON.parse(st.data.get(HISTORY_KEY) ?? '') as { entries: object[] };
    expect(Object.keys(h).sort()).toEqual(['entries', 'schemaVersion']);
    expect(Object.keys(h.entries[0] ?? {}).sort()).toEqual(ENTRY_ALLOWED);
  });

  it('stay under 256 bytes (settings) and 16 KB (50 history entries)', () => {
    const st = createFakeStorage();
    const repos = createLocalStorageRepos(st, { validateSettings });
    repos.settings.save({
      sensitivity: 4.95,
      fovDeg: SETTINGS_SPEC.fovDeg.max,
      masterVolume: 100,
      sfxVolume: 100,
      graphics: 'medium',
      roundDurationSec: 600,
    });
    for (let i = 0; i < 50; i++) {
      repos.history.append(
        entry(i, {
          map: 'industrial-warehouse',
          outcome: 'time-expired',
          bots: 20,
          kills: 999_999,
          accuracy: 0.123456789012345,
          durationSec: 999_999,
        }),
      );
    }
    expect(st.data.get(SETTINGS_KEY)?.length).toBeLessThan(256);
    expect(st.data.get(HISTORY_KEY)?.length).toBeLessThan(16 * 1024);
  });
});
