/** Maximal view-model fixtures and DOM helpers for the screen tests. */
import type { HistoryEntry } from '../../../../src/contracts';
import { DEFAULT_SETTINGS } from '../../../../src/settings';
import type {
  EndOfRoundVM,
  Features,
  HistoryVM,
  Intent,
  LoadingVM,
  MainMenuVM,
  PauseVM,
  SettingsVM,
} from '../../../../src/ui/screens';

export const ALL_FEATURES: Features = {
  audio: true,
  graphicsPresets: true,
  persistence: true,
  history: true,
};
export const B8_FEATURES: Features = {
  audio: false,
  graphicsPresets: true,
  persistence: true,
  history: true,
};

export function settingsVM(over: Partial<SettingsVM> = {}): SettingsVM {
  return {
    settings: DEFAULT_SETTINGS,
    context: 'menu',
    features: ALL_FEATURES,
    storage: 'loaded',
    ...over,
  };
}

export function historyEntries(n: number): HistoryEntry[] {
  return Array.from({ length: n }, (_v, i) => ({
    schemaVersion: 1,
    endedAt: new Date(Date.UTC(2026, 10, 1, 12, 59 - (i % 60), 0)).toISOString(),
    map: i % 2 === 0 ? 'desert-compound' : 'industrial-warehouse',
    bots: 20,
    difficulty: 'hard',
    outcome: (['victory', 'defeat', 'time-expired'] as const)[i % 3] ?? 'victory',
    kills: 12,
    accuracy: 0.375,
    durationSec: 300,
  }));
}

export function historyVM(n = 50): HistoryVM {
  return { entries: Object.freeze(historyEntries(n)), status: 'loaded' };
}

export function mainMenuVM(over: Partial<MainMenuVM> = {}): MainMenuVM {
  return {
    setup: { map: 'desert-compound', bots: 5, difficulty: 'normal' },
    panel: 'play',
    features: ALL_FEATURES,
    settings: settingsVM(),
    history: historyVM(3),
    version: '0.1.0',
    ...over,
  };
}

export function endVM(over: Partial<EndOfRoundVM> = {}): EndOfRoundVM {
  return {
    outcome: 'victory',
    botCount: 5,
    enemiesLeft: 0,
    killerId: null,
    kills: 5,
    headshots: 2,
    shotsFired: 40,
    accuracy: 0.412,
    damageDealt: 520.5,
    damageTaken: 64.4,
    deaths: 0,
    roundTimeSec: 151.9,
    session: { won: 2, lost: 1 },
    setup: { map: 'industrial-warehouse', bots: 5, difficulty: 'hard' },
    ...over,
  };
}

export function loadingVM(over: Partial<LoadingVM> = {}): LoadingVM {
  return {
    steps: [
      { id: 'map', label: 'Map geometry', progress: 1, state: 'done' },
      { id: 'nav', label: 'Navigation data', progress: 0.5, state: 'running' },
      { id: 'bots', label: 'Bots', progress: 0, state: 'pending' },
      { id: 'shaders', label: 'Shaders', progress: 0, state: 'pending' },
    ],
    error: null,
    ...over,
  };
}

export function pauseVM(over: Partial<PauseVM> = {}): PauseVM {
  return {
    summary: 'Desert Compound · 5 bots · 3 left · 1:42',
    lockRefused: false,
    restoring: false,
    settings: settingsVM({ context: 'pause' }),
    ...over,
  };
}

export function host(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

export function recorder(): { emit: (i: Intent) => void; intents: Intent[] } {
  const intents: Intent[] = [];
  return { intents, emit: (i) => intents.push(i) };
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed lookup helper for tests
export function byTestId<T extends HTMLElement = HTMLElement>(root: ParentNode, id: string): T {
  const node = root.querySelector<T>(`[data-testid="${id}"]`);
  if (node === null) throw new Error(`missing data-testid=${id}`);
  return node;
}

export function press(root: ParentNode, id: string): void {
  byTestId(root, id).click();
}

export function choose(root: ParentNode, id: string): void {
  const input = byTestId<HTMLInputElement>(root, id);
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function slide(root: ParentNode, id: string, value: string): void {
  const input = byTestId<HTMLInputElement>(root, id);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function key(target: EventTarget, k: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}
