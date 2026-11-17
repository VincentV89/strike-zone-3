/**
 * normalise(key, raw): the trust boundary for every setting value, from the
 * DOM and from storage (SEC-MS-07). Numbers are clamped and snapped to the
 * step; non-finite numbers and unknown enum values are rejected (null).
 */
import type { Settings } from '../contracts';
import { SETTINGS_SPEC, type EnumSpec, type NumberSpec, type SettingKey } from './spec';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function normaliseNumber(spec: NumberSpec, raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const clamped = clamp(raw, spec.min, spec.max);
  const snapped = spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step;
  return clamp(Number(snapped.toFixed(spec.decimals)), spec.min, spec.max);
}

export function normaliseEnum<T extends string | number>(
  spec: EnumSpec<T>,
  raw: unknown,
): T | null {
  return spec.values.find((v) => v === raw) ?? null;
}

export function normalise<K extends SettingKey>(key: K, raw: unknown): Settings[K] | null {
  const spec = SETTINGS_SPEC[key];
  if (spec.kind === 'number') return normaliseNumber(spec, raw) as Settings[K] | null;
  return normaliseEnum<string | number>(spec, raw) as Settings[K] | null;
}
