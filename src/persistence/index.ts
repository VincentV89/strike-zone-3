/**
 * persistence: guarded localStorage repositories. Only app-shell reads
 * window.localStorage (inside try) and passes it, or null, here (SD-MS-03).
 */
import { createHistoryRepo } from './history-repo';
import { createSettingsRepo } from './settings-repo';
import type { HistoryRepo, SettingsRepo, SettingsValidator, StorageLike } from './types';

export interface LocalStorageRepoOptions {
  /** settings' validateSettings, injected to avoid a persistence -> settings edge (SD-MS-01). */
  readonly validateSettings: SettingsValidator;
}

export function createLocalStorageRepos(
  storage: StorageLike | null,
  options: LocalStorageRepoOptions,
): { settings: SettingsRepo; history: HistoryRepo } {
  return {
    settings: createSettingsRepo(storage, options.validateSettings),
    history: createHistoryRepo(storage),
  };
}

export { toValidEntry } from './history-repo';
export {
  SETTINGS_KEY,
  HISTORY_KEY,
  SCHEMA_VERSION,
  MAX_STORED_LENGTH,
  HISTORY_CAP,
  type StorageStatus,
  type StorageLike,
  type SettingsValidator,
  type SettingsRepo,
  type HistoryRepo,
} from './types';
