/**
 * The settings store: one per page, created by app-shell at boot. Holds a
 * frozen Settings that always satisfies SETTINGS_SPEC. Accepted changes save
 * synchronously (no debounce, FD-MS-03) and notify subscribers in order.
 */
import type { Settings } from '../contracts';
import type { SettingsRepo } from '../persistence';
import { normalise } from './normalise';
import { DEFAULT_SETTINGS, type SettingKey } from './spec';

export type Unsubscribe = () => void;
export type SettingsListener = (settings: Readonly<Settings>, changed: SettingKey) => void;

export interface SettingsStore {
  get(): Readonly<Settings>;
  set<K extends SettingKey>(key: K, value: Settings[K]): Settings[K];
  subscribe(cb: SettingsListener): Unsubscribe;
}

/** The part of SettingsRepo the store uses. `null` is the build without persistence. */
export type SettingsStoreRepo = Pick<SettingsRepo, 'load' | 'save'>;

export function createSettingsStore(repo: SettingsStoreRepo | null): SettingsStore {
  const loaded = repo?.load() ?? null;
  let state: Readonly<Settings> = Object.freeze({ ...(loaded ?? DEFAULT_SETTINGS) });
  const listeners: SettingsListener[] = [];
  const warned = new Set<SettingKey>();

  function notify(key: SettingKey): void {
    for (const cb of [...listeners]) {
      try {
        cb(state, key);
      } catch {
        // A failing subscriber never blocks the next one (BR-MS-05).
        if (!warned.has(key)) {
          warned.add(key);
          console.warn('settings/subscriber-failed', key);
        }
      }
    }
  }

  return {
    get: () => state,
    set<K extends SettingKey>(key: K, value: Settings[K]): Settings[K] {
      const v = normalise(key, value);
      if (v === null) return state[key]; // rejected: no save, no notify
      if (v === state[key]) return v; // unchanged: no save, no notify
      state = Object.freeze({ ...state, [key]: v });
      repo?.save(state);
      notify(key);
      return v;
    },
    subscribe(cb: SettingsListener): Unsubscribe {
      listeners.push(cb);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
}
