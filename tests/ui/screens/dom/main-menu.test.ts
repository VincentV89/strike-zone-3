// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { BOT_COUNTS } from '../../../../src/contracts';
import { createMainMenuScreen } from '../../../../src/ui/screens';
import { byTestId, choose, host, mainMenuVM, press, recorder, settingsVM } from './fixtures';

afterEach(() => {
  document.body.replaceChildren();
});

describe('S1 main menu (story-main-menu-setup)', () => {
  it('offers exactly 2 maps, the 8 BOT_COUNTS and 3 difficulties (BR-MS-22)', () => {
    const root = host();
    createMainMenuScreen().mount(root, mainMenuVM(), recorder().emit);
    const radios = (group: string): string[] =>
      [...byTestId(root, group).querySelectorAll<HTMLInputElement>('input[type=radio]')].map(
        (i) => i.dataset['testid'] ?? '',
      );
    expect(radios('main-menu-map-group')).toEqual([
      'main-menu-map-desert-compound',
      'main-menu-map-industrial-warehouse',
    ]);
    expect(radios('main-menu-bots-group')).toEqual(
      BOT_COUNTS.map((n) => `main-menu-bots-${String(n)}`),
    );
    expect(radios('main-menu-difficulty-group')).toEqual([
      'main-menu-difficulty-easy',
      'main-menu-difficulty-normal',
      'main-menu-difficulty-hard',
    ]);
    expect(root.textContent).toContain('Desert Compound');
    expect(root.textContent).toContain('Industrial Warehouse');
  });

  it('shows Play Game, Select Map, CPU Enemies, Difficulty, Settings, Controls, About (BR-MS-23)', () => {
    const root = host();
    createMainMenuScreen().mount(root, mainMenuVM(), recorder().emit);
    for (const t of [
      'PLAY GAME',
      'Select Map',
      'Configure CPU Enemies',
      'Select Difficulty',
      'SETTINGS',
      'CONTROLS',
      'ABOUT',
      'HISTORY',
    ]) {
      expect(root.textContent).toContain(t);
    }
  });

  it('hides HISTORY when S14 is not built (RA-05)', () => {
    const root = host();
    const vm = mainMenuVM({ features: { ...mainMenuVM().features, history: false } });
    createMainMenuScreen().mount(root, vm, recorder().emit);
    expect(root.querySelector('[data-testid="side-nav-history"]')).toBeNull();
  });

  it('emits start-game once with the draft (BR-MS-31)', () => {
    const root = host();
    const r = recorder();
    createMainMenuScreen().mount(root, mainMenuVM(), r.emit);
    choose(root, 'main-menu-map-industrial-warehouse');
    choose(root, 'main-menu-bots-20');
    choose(root, 'main-menu-difficulty-hard');
    expect(r.intents).toEqual([]); // draft changes stay local
    press(root, 'main-menu-start');
    press(root, 'main-menu-start');
    expect(r.intents).toEqual([
      { type: 'start-game', setup: { map: 'industrial-warehouse', bots: 20, difficulty: 'hard' } },
    ]);
  });

  it('starts from the setup in the view model (FD-MS-Q2)', () => {
    const root = host();
    const r = recorder();
    createMainMenuScreen().mount(
      root,
      mainMenuVM({ setup: { map: 'industrial-warehouse', bots: 15, difficulty: 'easy' } }),
      r.emit,
    );
    expect(byTestId<HTMLInputElement>(root, 'main-menu-bots-15').checked).toBe(true);
    expect(byTestId(root, 'main-menu-large-battle-hint').hidden).toBe(false);
    press(root, 'main-menu-start');
    expect(r.intents[0]).toEqual({
      type: 'start-game',
      setup: { map: 'industrial-warehouse', bots: 15, difficulty: 'easy' },
    });
  });

  it('shows the large-battle hint only for 15 or 20 bots and describes difficulty', () => {
    const root = host();
    createMainMenuScreen().mount(root, mainMenuVM(), recorder().emit);
    const hint = byTestId(root, 'main-menu-large-battle-hint');
    expect(hint.hidden).toBe(true);
    choose(root, 'main-menu-bots-15');
    expect(hint.hidden).toBe(false);
    choose(root, 'main-menu-bots-3');
    expect(hint.hidden).toBe(true);
    expect(root.textContent).toContain('Bot health is the same on every difficulty');
  });

  it('keeps the draft across panel switches and focuses the panel heading, then the nav item on Back', () => {
    const root = host();
    const r = recorder();
    const screen = createMainMenuScreen();
    screen.mount(root, mainMenuVM(), r.emit);
    choose(root, 'main-menu-map-industrial-warehouse');
    press(root, 'side-nav-settings');
    expect(byTestId(root, 'main-menu-play').hidden).toBe(true);
    expect(byTestId(root, 'settings-screen')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('SETTINGS');
    expect(byTestId(root, 'side-nav-settings').getAttribute('aria-current')).toBe('page');
    press(root, 'side-nav-controls');
    expect(root.querySelector('[data-testid="settings-screen"]')).toBeNull();
    expect(byTestId(root, 'controls-screen')).toBeTruthy();
    press(root, 'main-menu-back');
    expect(root.querySelector('[data-testid="controls-screen"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId(root, 'side-nav-controls'));
    expect(byTestId<HTMLInputElement>(root, 'main-menu-map-industrial-warehouse').checked).toBe(
      true,
    );
    press(root, 'main-menu-start');
    expect(r.intents).toEqual([
      { type: 'start-game', setup: { map: 'industrial-warehouse', bots: 5, difficulty: 'normal' } },
    ]);
  });

  it('forwards nested set-setting intents and settings updates to the S2 panel', () => {
    const root = host();
    const r = recorder();
    const screen = createMainMenuScreen();
    const vm = mainMenuVM();
    screen.mount(root, vm, r.emit);
    press(root, 'side-nav-settings');
    choose(root, 'settings-graphics-high');
    expect(r.intents).toEqual([{ type: 'set-setting', key: 'graphics', value: 'high' }]);
    screen.update({
      ...vm,
      settings: settingsVM({ settings: { ...vm.settings.settings, graphics: 'high' } }),
    });
    expect(byTestId<HTMLInputElement>(root, 'settings-graphics-high').checked).toBe(true);
  });

  it('opens a panel from vm.panel, and About shows the version', () => {
    const root = host();
    const screen = createMainMenuScreen();
    const vm = mainMenuVM({ panel: 'about' });
    screen.mount(root, vm, recorder().emit);
    expect(byTestId(root, 'about-version').textContent).toBe('Version 0.1.0');
    screen.update({ ...vm, version: '0.2.0' });
    expect(byTestId(root, 'about-version').textContent).toBe('Version 0.2.0');
  });

  it('History empty state goes back to Match Setup', () => {
    const root = host();
    createMainMenuScreen().mount(
      root,
      mainMenuVM({ history: { entries: [], status: 'fresh' } }),
      recorder().emit,
    );
    press(root, 'side-nav-history');
    expect(byTestId(root, 'history-empty').hidden).toBe(false);
    press(root, 'history-go-setup');
    expect(byTestId(root, 'main-menu-play').hidden).toBe(false);
    expect(root.querySelector('[data-testid="history-screen"]')).toBeNull();
  });

  it('a new setup in update resets the draft; focusFirst focuses Start Game', () => {
    const root = host();
    const screen = createMainMenuScreen();
    const vm = mainMenuVM();
    screen.mount(root, vm, recorder().emit);
    screen.update({ ...vm, setup: { map: 'desert-compound', bots: 10, difficulty: 'easy' } });
    expect(byTestId<HTMLInputElement>(root, 'main-menu-bots-10').checked).toBe(true);
    expect(byTestId<HTMLInputElement>(root, 'main-menu-difficulty-easy').checked).toBe(true);
    screen.focusFirst();
    expect(document.activeElement).toBe(byTestId(root, 'main-menu-start'));
    press(root, 'skip-link');
    expect(document.activeElement).toBe(byTestId(root, 'main-menu-start'));
  });

  it('removes its DOM on unmount and ignores update afterwards', () => {
    const root = host();
    const screen = createMainMenuScreen();
    screen.mount(root, mainMenuVM(), recorder().emit);
    screen.unmount();
    expect(root.childElementCount).toBe(0);
    expect(() => {
      screen.update(mainMenuVM());
    }).not.toThrow();
    expect(root.childElementCount).toBe(0);
  });
});
