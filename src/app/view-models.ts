/**
 * Pure view-model builders for every screen app-shell mounts
 * (frontend-components-app-shell §3). Node-tested; no DOM.
 */
import type { HistoryEntry, RoundOutcome, Settings } from '../contracts';
import type { RoundStats, SessionStats } from '../sim/stats';
import {
  DIFFICULTY_LABELS,
  MAP_LABELS,
  type CountdownVM,
  type EndOfRoundVM,
  type Features,
  type HistoryVM,
  type LoadingStepId,
  type LoadingStepVM,
  type LoadingVM,
  type MainMenuVM,
  type MatchSetup,
  type PauseVM,
  type SettingsVM,
  type StorageStatusView,
} from '../ui/screens';

export const LOADING_STEPS: readonly LoadingStepId[] = Object.freeze([
  'map',
  'nav',
  'assets',
  'bots',
  'shaders',
]);

export const STEP_LABELS: Readonly<Record<LoadingStepId, string>> = Object.freeze({
  map: 'Map geometry',
  nav: 'Navigation',
  assets: 'Assets',
  bots: 'Bots',
  shaders: 'Shaders',
});

export const DEFAULT_SETUP: MatchSetup = Object.freeze({
  map: 'desert-compound',
  bots: 5,
  difficulty: 'normal',
});

export type StepState = LoadingStepVM['state'];

export interface StepProgress {
  progress: number;
  state: StepState;
}

export type LoadingProgress = Record<LoadingStepId, StepProgress>;

export function createLoadingProgress(): LoadingProgress {
  return {
    map: { progress: 0, state: 'pending' },
    nav: { progress: 0, state: 'pending' },
    assets: { progress: 0, state: 'pending' },
    bots: { progress: 0, state: 'pending' },
    shaders: { progress: 0, state: 'pending' },
  };
}

export function loadingVM(p: Readonly<LoadingProgress>, error: string | null): LoadingVM {
  return {
    steps: LOADING_STEPS.map((id) => ({
      id,
      label: STEP_LABELS[id],
      progress: clamp01(p[id].progress),
      state: p[id].state,
    })),
    error,
  };
}

/** True only when every step is done (BR-AS-08). */
export function loadingComplete(p: Readonly<LoadingProgress>): boolean {
  return LOADING_STEPS.every((id) => p[id].state === 'done' && p[id].progress >= 1);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function clockText(totalSec: number): string {
  const s = Number.isFinite(totalSec) ? Math.max(0, Math.ceil(totalSec)) : 0;
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export function pauseSummary(setup: MatchSetup, timeLeftSec: number): string {
  const bots = `${String(setup.bots)} ${setup.bots === 1 ? 'bot' : 'bots'}`;
  return `${MAP_LABELS[setup.map]} · ${bots} · ${DIFFICULTY_LABELS[setup.difficulty]} · ${clockText(timeLeftSec)} left`;
}

export function settingsVM(
  settings: Readonly<Settings>,
  context: SettingsVM['context'],
  features: Features,
  storage: StorageStatusView | null,
): SettingsVM {
  return { settings, context, features, storage: features.persistence ? storage : null };
}

export function pauseVM(
  summary: string,
  lockRefused: boolean,
  restoring: boolean,
  settings: SettingsVM,
): PauseVM {
  return { summary, lockRefused, restoring, settings };
}

export function mainMenuVM(
  setup: MatchSetup,
  features: Features,
  settings: SettingsVM,
  history: HistoryVM | null,
  version: string,
): MainMenuVM {
  const base = { setup, panel: 'play' as const, features, settings, version };
  return features.history && history !== null ? { ...base, history } : base;
}

/** Whole seconds for S7; GO once the simulation is live (PD-AS-05). */
export function countdownVM(countdownLeftSec: number, live: boolean): CountdownVM {
  const s = Number.isFinite(countdownLeftSec) ? Math.max(0, Math.ceil(countdownLeftSec)) : 0;
  return { secondsLeft: s, go: live || s === 0 };
}

export function endOfRoundVM(
  r: Readonly<RoundStats>,
  outcome: RoundOutcome,
  session: Readonly<SessionStats>,
  setup: MatchSetup,
): EndOfRoundVM {
  return {
    outcome,
    botCount: r.enemiesTotal,
    enemiesLeft: r.enemiesLeft,
    killerId: r.killerId,
    kills: r.kills,
    headshots: r.headshots,
    shotsFired: r.shotsFired,
    accuracy: r.shotsFired === 0 ? 0 : r.accuracy,
    damageDealt: r.damageDealt,
    damageTaken: r.damageTaken,
    deaths: r.deaths,
    roundTimeSec: r.durationSec,
    session: { won: session.roundsWon, lost: session.roundsLost },
    setup,
  };
}

export function historyEntry(
  r: Readonly<RoundStats>,
  outcome: RoundOutcome,
  setup: MatchSetup,
  endedAt: string,
): HistoryEntry {
  return {
    schemaVersion: 1,
    endedAt,
    map: setup.map,
    bots: setup.bots,
    difficulty: setup.difficulty,
    outcome,
    kills: r.kills,
    accuracy: r.shotsFired === 0 ? 0 : r.accuracy,
    durationSec: r.durationSec,
  };
}
