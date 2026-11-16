// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore, DEFAULT_SETTINGS } from '../../../../src/settings';
import {
  createSettingsScreen,
  domWrites,
  type Intent,
  type SettingsVM,
} from '../../../../src/ui/screens';
import {
  ALL_FEATURES,
  B8_FEATURES,
  byTestId,
  choose,
  host,
  press,
  recorder,
  settingsVM,
  slide,
} from './fixtures';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** Wires S2 to a real store, the way app-shell will (PD-MS-05). */
function wired(vm: SettingsVM): {
  root: HTMLElement;
  intents: Intent[];
  store: ReturnType<typeof createSettingsStore>;
} {
  const root = host();
  const store = createSettingsStore(null);
  const intents: Intent[] = [];
  const screen = createSettingsScreen();
  let current = vm;
  screen.mount(root, vm, (i) => {
    intents.push(i);
    if (i.type !== 'set-setting') return;
    store.set(i.key, i.value);
    current = { ...current, settings: store.get() };
    screen.update(current);
  });
  return { root, intents, store };
}

describe('S2 settings (story-settings-screen)', () => {
  it('B8 build has no Audio group; the audio flag adds it (BR-MS-07)', () => {
    const a = host();
    createSettingsScreen().mount(a, settingsVM({ features: B8_FEATURES }), recorder().emit);
    expect(a.querySelector('[data-testid="settings-group-audio"]')).toBeNull();
    expect(a.querySelector('[data-testid="settings-master-volume"]')).toBeNull();
    const b = host();
    createSettingsScreen().mount(b, settingsVM({ features: ALL_FEATURES }), recorder().emit);
    expect(byTestId(b, 'settings-group-audio')).toBeTruthy();
  });

  it('removes the Video group and footer when those features are cut', () => {
    const root = host();
    createSettingsScreen().mount(
      root,
      settingsVM({ features: { ...B8_FEATURES, graphicsPresets: false, persistence: false } }),
      recorder().emit,
    );
    expect(root.querySelector('[data-testid="settings-group-video"]')).toBeNull();
    expect(root.querySelector('[data-testid="settings-storage-status"]')).toBeNull();
    expect(byTestId(root, 'settings-fov')).toBeTruthy();
  });

  it('slider ranges come from SETTINGS_SPEC', () => {
    const root = host();
    createSettingsScreen().mount(root, settingsVM(), recorder().emit);
    const s = byTestId<HTMLInputElement>(root, 'settings-sensitivity');
    expect([s.min, s.max, s.step]).toEqual(['0.1', '5', '0.05']);
    const f = byTestId<HTMLInputElement>(root, 'settings-fov');
    expect([f.min, f.max, f.step, f.value]).toEqual(['70', '110', '1', '90']);
  });

  it('emits set-setting for FOV, sensitivity, graphics and duration', () => {
    const root = host();
    const r = recorder();
    createSettingsScreen().mount(root, settingsVM(), r.emit);
    slide(root, 'settings-fov', '100');
    slide(root, 'settings-sensitivity', '2.5');
    choose(root, 'settings-graphics-low');
    choose(root, 'settings-round-duration-600');
    expect(r.intents).toEqual([
      { type: 'set-setting', key: 'fovDeg', value: 100 },
      { type: 'set-setting', key: 'sensitivity', value: 2.5 },
      { type: 'set-setting', key: 'graphics', value: 'low' },
      { type: 'set-setting', key: 'roundDurationSec', value: 600 },
    ]);
  });

  it('shows the store-accepted value in the same task (PERF-MS-09)', () => {
    const { root, store } = wired(settingsVM());
    slide(root, 'settings-fov', '104');
    expect(store.get().fovDeg).toBe(104);
    const fov = byTestId<HTMLInputElement>(root, 'settings-fov');
    expect(fov.getAttribute('aria-valuetext')).toBe('104°');
    expect(fov.parentElement?.textContent).toContain('104°');
  });

  it('a setting change writes at most 4 nodes; an unchanged update writes 0 (PERF-MS-08)', () => {
    const root = host();
    const screen = createSettingsScreen();
    const vm = settingsVM();
    screen.mount(root, vm, recorder().emit);
    let before = domWrites.count;
    screen.update({ ...vm });
    expect(domWrites.count - before).toBe(0);
    before = domWrites.count;
    screen.update({ ...vm, settings: { ...vm.settings, fovDeg: 101 }, storage: 'unavailable' });
    expect(domWrites.count - before).toBeLessThanOrEqual(4);
  });

  it('pushes a clamped value back into the range input during a drag', () => {
    const root = host();
    const screen = createSettingsScreen();
    const vm = settingsVM();
    screen.mount(root, vm, recorder().emit);
    const fov = byTestId<HTMLInputElement>(root, 'settings-fov');
    fov.value = '95';
    screen.update({ ...vm, settings: { ...vm.settings } });
    expect(fov.value).toBe('90');
  });

  it('shows the pause hint for round duration and the storage footer text', () => {
    const root = host();
    createSettingsScreen().mount(
      root,
      settingsVM({ context: 'pause', storage: 'unavailable' }),
      recorder().emit,
    );
    expect(byTestId(root, 'settings-duration-hint').textContent).toBe(
      'Applies from the next round.',
    );
    expect(byTestId(root, 'settings-storage-status').textContent).toBe(
      'This browser is blocking storage. Settings last until you close the tab.',
    );
  });

  it('reset to defaults emits only changed keys and Undo restores them (BR-MS-08)', () => {
    vi.useFakeTimers();
    const custom = { ...DEFAULT_SETTINGS, fovDeg: 105, graphics: 'low' as const };
    const root = host();
    const store = createSettingsStore(null);
    store.set('fovDeg', 105);
    store.set('graphics', 'low');
    const intents: Intent[] = [];
    const screen = createSettingsScreen();
    let vm = settingsVM({ settings: custom });
    screen.mount(root, vm, (i) => {
      intents.push(i);
      if (i.type === 'set-setting') store.set(i.key, i.value);
      vm = { ...vm, settings: store.get() };
      screen.update(vm);
    });
    press(root, 'settings-reset');
    expect(intents).toEqual([
      { type: 'set-setting', key: 'fovDeg', value: 90 },
      { type: 'set-setting', key: 'graphics', value: 'medium' },
    ]);
    const toast = byTestId(root, 'settings-undo-toast');
    expect(toast.hidden).toBe(false);
    expect(toast.textContent).toContain('Settings reset to defaults.');
    press(root, 'settings-undo-toast-undo');
    expect(store.get()).toEqual(custom);
    expect(toast.hidden).toBe(true);

    press(root, 'settings-reset');
    vi.advanceTimersByTime(4999);
    expect(toast.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toast.hidden).toBe(true);
  });

  it('the toast timer pauses while hovered or focused', () => {
    vi.useFakeTimers();
    const root = host();
    createSettingsScreen().mount(
      root,
      settingsVM({ settings: { ...DEFAULT_SETTINGS, fovDeg: 100 } }),
      recorder().emit,
    );
    press(root, 'settings-reset');
    const toast = byTestId(root, 'settings-undo-toast');
    toast.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(10_000);
    expect(toast.hidden).toBe(false);
    toast.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(5000);
    expect(toast.hidden).toBe(true);
  });

  it('reset with everything at default shows no toast', () => {
    const root = host();
    const r = recorder();
    createSettingsScreen().mount(root, settingsVM(), r.emit);
    press(root, 'settings-reset');
    expect(r.intents).toEqual([]);
    expect(byTestId(root, 'settings-undo-toast').hidden).toBe(true);
  });
});
