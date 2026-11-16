/**
 * SETTINGS_SPEC: the single table of setting ranges, steps, allowed values
 * and defaults (BR-MS-01). The store, the stored-settings validator and the
 * sliders all read it.
 */
import type { Settings } from '../contracts';

export type SettingKey = keyof Settings;

export interface NumberSpec {
  readonly kind: 'number';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Decimal places kept after snapping (removes float error such as 1.1500000002). */
  readonly decimals: number;
  readonly default: number;
}

export interface EnumSpec<T extends string | number> {
  readonly kind: 'enum';
  readonly values: readonly T[];
  readonly default: T;
}

export interface SettingsSpec {
  readonly sensitivity: NumberSpec;
  readonly fovDeg: NumberSpec;
  readonly masterVolume: NumberSpec;
  readonly sfxVolume: NumberSpec;
  readonly graphics: EnumSpec<Settings['graphics']>;
  readonly roundDurationSec: EnumSpec<number>;
}

export const SETTINGS_SPEC: SettingsSpec = Object.freeze<SettingsSpec>({
  sensitivity: { kind: 'number', min: 0.1, max: 5, step: 0.05, decimals: 2, default: 1 },
  // Horizontal FOV at a 16:9 reference aspect (presentation-3d), 70–110°.
  fovDeg: { kind: 'number', min: 70, max: 110, step: 1, decimals: 0, default: 90 },
  // Integer percent; audio divides by 100 (FD-MS-02).
  masterVolume: { kind: 'number', min: 0, max: 100, step: 1, decimals: 0, default: 80 },
  sfxVolume: { kind: 'number', min: 0, max: 100, step: 1, decimals: 0, default: 100 },
  graphics: { kind: 'enum', values: ['low', 'medium', 'high'], default: 'medium' },
  // Segmented 2:00 / 3:00 / 5:00 / 10:00 (FD-MS-01). Applies from the next round.
  roundDurationSec: { kind: 'enum', values: [120, 180, 300, 600], default: 180 },
});

/** The spec's own keys in display order. Loading rebuilds Settings from these only. */
export const SPEC_KEYS: readonly SettingKey[] = Object.freeze([
  'sensitivity',
  'fovDeg',
  'masterVolume',
  'sfxVolume',
  'graphics',
  'roundDurationSec',
]);

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sensitivity: SETTINGS_SPEC.sensitivity.default,
  fovDeg: SETTINGS_SPEC.fovDeg.default,
  masterVolume: SETTINGS_SPEC.masterVolume.default,
  sfxVolume: SETTINGS_SPEC.sfxVolume.default,
  graphics: SETTINGS_SPEC.graphics.default,
  roundDurationSec: SETTINGS_SPEC.roundDurationSec.default,
});
