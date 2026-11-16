/**
 * validateSettings(body): rebuild Settings from an untrusted stored body.
 * Injected into persistence by app-shell (SD-MS-01), so persistence does not
 * import settings (that edge would close a cycle with settings -> persistence).
 * Only the spec's own keys are read, each through Object.hasOwn, so
 * __proto__, constructor and unknown keys are never visited (SEC-MS-03).
 */
import type { Settings } from '../contracts';
import { normalise } from './normalise';
import { DEFAULT_SETTINGS, SPEC_KEYS, type SettingKey } from './spec';

export interface ValidatedSettings {
  readonly value: Readonly<Settings>;
  readonly repaired: boolean;
}

function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function validateSettings(body: unknown): ValidatedSettings | null {
  if (!isPlainRecord(body)) return null;
  const out: Partial<Record<SettingKey, unknown>> = {};
  let repaired = false;
  for (const key of SPEC_KEYS) {
    const v = Object.hasOwn(body, key) ? normalise(key, body[key]) : null;
    if (v === null) repaired = true;
    out[key] = v ?? DEFAULT_SETTINGS[key];
  }
  return { value: Object.freeze(out as Settings), repaired };
}
