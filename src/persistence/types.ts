import type { HistoryEntry, Settings } from '../contracts';

/** Load/save outcome shown in the S2 footer (business-logic-model storage status line). */
export type StorageStatus = 'fresh' | 'loaded' | 'repaired' | 'reset' | 'unavailable';

/** The part of the DOM Storage interface persistence uses. app-shell passes window.localStorage. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Injected stored-settings validator (SD-MS-01); app-shell passes settings' validateSettings. */
export type SettingsValidator = (
  body: unknown,
) => { readonly value: Readonly<Settings>; readonly repaired: boolean } | null;

export interface SettingsRepo {
  load(): Settings | null;
  save(s: Readonly<Settings>): void;
  status(): StorageStatus;
}

export interface HistoryRepo {
  list(): readonly HistoryEntry[];
  append(e: HistoryEntry): void;
  clear(): void;
  status(): StorageStatus;
}

export const SETTINGS_KEY = 'strikezone:settings';
export const HISTORY_KEY = 'strikezone:history';
export const SCHEMA_VERSION = 1;
/** Stored values longer than this (UTF-16 code units) are corrupt without parsing (SEC-MS-04). */
export const MAX_STORED_LENGTH = 65_536;
export const HISTORY_CAP = 50;
