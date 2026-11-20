/**
 * Screen view models (domain-entities-menus-settings, FD-MS-06). app-shell
 * builds them; screens only read them. EndOfRoundVM has plain fields so this
 * unit does not depend on game-simulation's RoundStats field names.
 */
import type {
  Difficulty,
  HistoryEntry,
  MapId,
  RoundConfig,
  RoundOutcome,
  Settings,
} from '../../contracts';

export type MatchSetup = Omit<RoundConfig, 'seed' | 'durationSec'>;

/**
 * Mirrors persistence's StorageStatus. menus-ui has no edge to persistence, so
 * tests/ui/screens/view-models.test-d.ts checks the two types are equal.
 */
export type StorageStatusView = 'fresh' | 'loaded' | 'repaired' | 'reset' | 'unavailable';

/** Which optional features are built. A false flag removes the control (RA-05). */
export interface Features {
  readonly audio: boolean;
  readonly graphicsPresets: boolean;
  readonly persistence: boolean;
  readonly history: boolean;
}

export type MenuPanel = 'play' | 'settings' | 'controls' | 'about' | 'history';

export interface SettingsVM {
  readonly settings: Readonly<Settings>;
  readonly context: 'menu' | 'pause';
  readonly features: Features;
  /** null = persistence not built; the footer line is not rendered. */
  readonly storage: StorageStatusView | null;
}

export interface HistoryVM {
  readonly entries: readonly HistoryEntry[];
  readonly status: StorageStatusView;
}

export interface MainMenuVM {
  readonly setup: MatchSetup;
  readonly panel: MenuPanel;
  readonly features: Features;
  readonly settings: SettingsVM;
  readonly history?: HistoryVM;
  readonly version: string;
}

export interface AboutVM {
  readonly version: string;
}

export interface EndOfRoundVM {
  readonly outcome: RoundOutcome;
  readonly botCount: number;
  readonly enemiesLeft: number;
  readonly killerId: number | null;
  readonly kills: number;
  readonly headshots: number;
  readonly shotsFired: number;
  /** 0..1; shown as "—" when shotsFired is 0 (BR-MS-27). */
  readonly accuracy: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly deaths: number;
  readonly roundTimeSec: number;
  readonly session: { readonly won: number; readonly lost: number };
  readonly setup: MatchSetup;
}

export type LoadingStepId = 'map' | 'nav' | 'assets' | 'bots' | 'shaders';

export interface LoadingStepVM {
  readonly id: LoadingStepId;
  readonly label: string;
  /** 0..1, computed by app-shell from real readiness. */
  readonly progress: number;
  readonly state: 'pending' | 'running' | 'done' | 'failed';
}

export interface LoadingVM {
  readonly steps: readonly LoadingStepVM[];
  readonly error: string | null;
}

export interface ReadyVM {
  readonly lockRefused: boolean;
}

export interface CountdownVM {
  readonly secondsLeft: number;
  readonly go: boolean;
}

export interface PauseVM {
  readonly summary: string;
  readonly lockRefused: boolean;
  readonly restoring: boolean;
  readonly settings: SettingsVM;
}

export interface EliminatedVM {
  readonly killerId: number | null;
}

export interface BootVM {
  readonly unsupported: boolean;
}

export type { Difficulty, MapId };
