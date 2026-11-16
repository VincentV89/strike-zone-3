// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAboutScreen,
  createBootScreen,
  createControlsScreen,
  createCountdownScreen,
  createEliminatedScreen,
  createLoadingScreen,
  createReadyGateScreen,
  domWrites,
} from '../../../../src/ui/screens';
import { byTestId, host, key, loadingVM, press, recorder } from './fixtures';

afterEach(() => {
  document.body.replaceChildren();
});

describe('S5 loading', () => {
  it('renders the four steps from the view model', () => {
    const root = host();
    createLoadingScreen().mount(root, loadingVM(), recorder().emit);
    const steps = byTestId(root, 'loading-steps').querySelectorAll('li');
    expect([...steps].map((s) => s.getAttribute('data-state'))).toEqual([
      'done',
      'running',
      'pending',
      'pending',
    ]);
    expect(byTestId(root, 'loading-progress').getAttribute('aria-valuenow')).toBe('38');
    expect(steps[1]?.textContent).toContain('Navigation data');
    expect(steps[1]?.textContent).toContain('50%');
  });

  it('Cancel and Esc emit cancel-loading once', () => {
    const root = host();
    const r = recorder();
    createLoadingScreen().mount(root, loadingVM(), r.emit);
    key(document, 'Escape');
    press(root, 'loading-cancel');
    expect(r.intents).toEqual([{ type: 'cancel-loading' }]);
  });

  it('error state offers Retry and Main Menu', () => {
    const root = host();
    const r = recorder();
    const screen = createLoadingScreen();
    const vm = loadingVM();
    screen.mount(root, vm, r.emit);
    screen.update({ ...vm, error: "Couldn't build the map. Retry usually fixes this." });
    expect(byTestId(root, 'loading-error').hidden).toBe(false);
    expect(byTestId(root, 'loading-cancel').hidden).toBe(true);
    key(document, 'Escape');
    screen.focusFirst();
    expect(document.activeElement).toBe(byTestId(root, 'loading-retry'));
    press(root, 'loading-retry');
    press(root, 'loading-retry');
    expect(r.intents).toEqual([{ type: 'retry-loading' }]);
    screen.update(loadingVM());
    screen.update({ ...loadingVM(), error: 'Again.' });
    press(root, 'loading-retry');
    press(root, 'loading-main-menu');
    expect(r.intents).toEqual([
      { type: 'retry-loading' },
      { type: 'retry-loading' },
      { type: 'main-menu' },
    ]);
  });
});

describe('S6 ready gate', () => {
  it('emits deploy synchronously once, and re-arms after a refused lock', () => {
    const root = host();
    const r = recorder();
    const screen = createReadyGateScreen();
    screen.mount(root, { lockRefused: false }, r.emit);
    screen.focusFirst();
    expect(document.activeElement).toBe(byTestId(root, 'ready-deploy'));
    press(root, 'ready-deploy');
    press(root, 'ready-deploy');
    expect(r.intents).toEqual([{ type: 'deploy' }]);
    expect(byTestId(root, 'ready-lock-refused').hidden).toBe(true);
    screen.update({ lockRefused: true });
    expect(byTestId(root, 'ready-lock-refused').hidden).toBe(false);
    press(root, 'ready-deploy');
    expect(r.intents).toEqual([{ type: 'deploy' }, { type: 'deploy' }]);
  });
});

describe('S7 countdown', () => {
  it('writes only when the digit changes', () => {
    const root = host();
    const screen = createCountdownScreen();
    screen.mount(root, { secondsLeft: 3, go: false }, recorder().emit);
    expect(byTestId(root, 'countdown-digit').textContent).toBe('3');
    const before = domWrites.count;
    screen.update({ secondsLeft: 2.5, go: false });
    screen.update({ secondsLeft: 2.1, go: false });
    expect(domWrites.count - before).toBe(0);
    expect(byTestId(root, 'countdown-digit').textContent).toBe('3');
    screen.update({ secondsLeft: 1.5, go: false });
    expect(domWrites.count - before).toBe(1);
    expect(byTestId(root, 'countdown-digit').textContent).toBe('2');
    screen.update({ secondsLeft: 0, go: true });
    expect(byTestId(root, 'countdown-digit').textContent).toBe('GO');
  });
});

describe('S12, S0, S3, S4', () => {
  it('S12 names the killer', () => {
    const root = host();
    const screen = createEliminatedScreen();
    screen.mount(root, { killerId: 3 }, recorder().emit);
    expect(byTestId(root, 'eliminated-cause').textContent).toBe('You were eliminated by Bot-03.');
    screen.update({ killerId: null });
    expect(byTestId(root, 'eliminated-cause').textContent).toBe('You were eliminated.');
  });

  it('S0 shows the unsupported notice only when unsupported', () => {
    const root = host();
    const screen = createBootScreen();
    screen.mount(root, { unsupported: false }, recorder().emit);
    expect(byTestId(root, 'boot-unsupported').hidden).toBe(true);
    screen.update({ unsupported: true });
    expect(byTestId(root, 'boot-unsupported').hidden).toBe(false);
    expect(byTestId(root, 'boot-unsupported').getAttribute('role')).toBe('alert');
  });

  it('S3 has crouch on C and no Ctrl row (BR-MS-24)', () => {
    const root = host();
    createControlsScreen().mount(root, null, recorder().emit);
    const text = byTestId(root, 'controls-table').textContent;
    expect(text).toContain('Crouch');
    expect(text).not.toMatch(/ctrl/i);
  });

  it('S4 states that assets are original or procedural and lists three.js (BR-MS-25)', () => {
    const root = host();
    createAboutScreen().mount(root, { version: '1.2.3' }, recorder().emit);
    const assets = byTestId(root, 'about-assets').textContent;
    for (const w of [
      'branding',
      'maps',
      'textures',
      'models',
      'sounds',
      'original or procedurally generated',
    ]) {
      expect(assets).toContain(w);
    }
    expect(byTestId(root, 'about-libraries').textContent).toBe('three.js (MIT)');
  });
});
