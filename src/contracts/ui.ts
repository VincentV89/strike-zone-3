import type { RoundConfig } from './round';

export type UiIntent =
  | { type: 'start-game'; setup: Omit<RoundConfig, 'seed' | 'durationSec'> }
  | { type: 'cancel-loading' }
  | { type: 'retry-loading' }
  | { type: 'deploy' }
  | { type: 'resume' }
  | { type: 'restart-confirmed' }
  | { type: 'leave-confirmed' }
  | { type: 'play-again' }
  | { type: 'main-menu' }
  /** Added by menus-settings with S14 match history (FD-MS-08, additive). */
  | { type: 'clear-history' };

export interface Settings {
  sensitivity: number;
  masterVolume: number;
  sfxVolume: number;
  graphics: 'low' | 'medium' | 'high';
  fovDeg: number;
  roundDurationSec: number;
}

export type SettingsIntent = {
  [K in keyof Settings]: { type: 'set-setting'; key: K; value: Settings[K] };
}[keyof Settings];
