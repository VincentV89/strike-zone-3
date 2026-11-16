/** Settings repository over `strikezone:settings` (business-logic-model load decision tree). */
import type { Settings } from '../contracts';
import { readEnvelope, writeEnvelope } from './envelope';
import {
  SETTINGS_KEY,
  type SettingsRepo,
  type SettingsValidator,
  type StorageLike,
  type StorageStatus,
} from './types';

export function createSettingsRepo(
  storage: StorageLike | null,
  validateSettings: SettingsValidator,
): SettingsRepo {
  let status: StorageStatus = storage === null ? 'unavailable' : 'fresh';
  let latched = storage === null; // one-way: after a failed write, saves are skipped

  return {
    load(): Settings | null {
      const read = readEnvelope(storage, SETTINGS_KEY);
      if (read.status !== 'ok') {
        status = read.status;
        if (read.status === 'unavailable') latched = true;
        return null;
      }
      const body = Object.hasOwn(read.data, 'settings') ? read.data['settings'] : undefined;
      const result = validateSettings(body);
      if (result === null) {
        status = 'reset';
        return null;
      }
      status = result.repaired ? 'repaired' : 'loaded';
      return { ...result.value };
    },
    save(s: Readonly<Settings>): void {
      if (latched || storage === null) return;
      const record: Settings = {
        sensitivity: s.sensitivity,
        fovDeg: s.fovDeg,
        masterVolume: s.masterVolume,
        sfxVolume: s.sfxVolume,
        graphics: s.graphics,
        roundDurationSec: s.roundDurationSec,
      };
      if (!writeEnvelope(storage, SETTINGS_KEY, { settings: record })) {
        latched = true;
        status = 'unavailable';
      }
    },
    status: () => status,
  };
}
