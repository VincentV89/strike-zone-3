/** Every screen with its maximal fixture and node budget (PERF-MS-07). */
import {
  createAboutScreen,
  createBootScreen,
  createControlsScreen,
  createCountdownScreen,
  createEliminatedScreen,
  createEndOfRoundScreen,
  createHistoryScreen,
  createLoadingScreen,
  createMainMenuScreen,
  createPauseScreen,
  createReadyGateScreen,
  createSettingsScreen,
  type Screen,
} from '../../../../src/ui/screens';
import { endVM, historyVM, loadingVM, mainMenuVM, pauseVM, settingsVM } from './fixtures';

export interface SweepCase {
  readonly name: string;
  readonly budget: number;
  readonly make: () => Screen<unknown>;
  readonly vm: () => unknown;
}

const c = <VM>(name: string, budget: number, make: () => Screen<VM>, vm: () => VM): SweepCase => ({
  name,
  budget,
  make: make,
  vm,
});

export const SCREENS: readonly SweepCase[] = [
  c('S0 boot', 80, createBootScreen, () => ({ unsupported: true })),
  c('S1 main menu', 250, createMainMenuScreen, () => mainMenuVM()),
  c('S2 settings', 200, createSettingsScreen, () => settingsVM()),
  c('S3 controls', 80, createControlsScreen, () => null),
  c('S4 about', 80, createAboutScreen, () => ({ version: '0.1.0' })),
  c('S5 loading', 80, createLoadingScreen, () => loadingVM({ error: 'Something failed.' })),
  c('S6 ready gate', 80, createReadyGateScreen, () => ({ lockRefused: true })),
  c('S7 countdown', 80, createCountdownScreen, () => ({ secondsLeft: 3, go: false })),
  c('S11 pause', 80, createPauseScreen, () => pauseVM({ lockRefused: true })),
  c('S12 eliminated', 80, createEliminatedScreen, () => ({ killerId: 20 })),
  c('S13 end of round', 120, createEndOfRoundScreen, () =>
    endVM({ outcome: 'defeat', killerId: 20 }),
  ),
  c('S14 history', 400, createHistoryScreen, () => historyVM(50)),
];
