// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createPauseScreen } from '../../../../src/ui/screens';
import { byTestId, host, key, pauseVM, press, recorder } from './fixtures';

afterEach(() => {
  document.body.replaceChildren();
});

describe('S11 pause (BR-MS-28..30, FD-MS-Q1)', () => {
  it('opens modally with Resume focused; Resume emits resume synchronously', () => {
    const root = host();
    const r = recorder();
    createPauseScreen().mount(root, pauseVM(), r.emit);
    const dialog = byTestId<HTMLDialogElement>(root, 'pause-dialog');
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(byTestId(root, 'pause-resume'));
    press(root, 'pause-resume');
    expect(r.intents).toEqual([{ type: 'resume' }]);
  });

  it('Esc never emits resume: it focuses Resume and shows the hint', () => {
    const root = host();
    const r = recorder();
    createPauseScreen().mount(root, pauseVM(), r.emit);
    byTestId(root, 'pause-settings').focus();
    const dialog = byTestId(root, 'pause-dialog');
    const e = key(dialog, 'Escape');
    expect(e.defaultPrevented).toBe(true);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(r.intents).toEqual([]);
    expect(document.activeElement).toBe(byTestId(root, 'pause-resume'));
    expect(byTestId(root, 'pause-hint').textContent).toBe('Press Enter or click Resume.');
  });

  it('Restart Round opens a confirm with Cancel focused and the not-counted text', () => {
    const root = host();
    const r = recorder();
    createPauseScreen().mount(root, pauseVM(), r.emit);
    press(root, 'pause-restart');
    const confirm = byTestId(root, 'pause-confirm');
    expect(confirm.hidden).toBe(false);
    expect(confirm.textContent).toContain("It won't count toward rounds won or lost.");
    expect(document.activeElement).toBe(byTestId(root, 'pause-confirm-cancel'));
    expect(r.intents).toEqual([]);
    // Esc inside the confirm closes only the confirm.
    key(byTestId(root, 'pause-confirm-cancel'), 'Escape');
    expect(confirm.hidden).toBe(true);
    expect(document.activeElement).toBe(byTestId(root, 'pause-restart'));
    expect(r.intents).toEqual([]);
    press(root, 'pause-restart');
    press(root, 'pause-confirm-confirm');
    press(root, 'pause-confirm-confirm');
    expect(r.intents).toEqual([{ type: 'restart-confirmed' }]);
  });

  it('Main Menu confirm emits leave-confirmed; Cancel closes without emitting', () => {
    const root = host();
    const r = recorder();
    createPauseScreen().mount(root, pauseVM(), r.emit);
    press(root, 'pause-main-menu');
    press(root, 'pause-confirm-cancel');
    expect(byTestId(root, 'pause-confirm').hidden).toBe(true);
    press(root, 'pause-main-menu');
    expect(byTestId(root, 'pause-confirm').textContent).toContain('Leave to the main menu?');
    press(root, 'pause-confirm-confirm');
    expect(r.intents).toEqual([{ type: 'leave-confirmed' }]);
  });

  it('nested Settings opens in the dialog and Esc goes Back', () => {
    const root = host();
    const r = recorder();
    const screen = createPauseScreen();
    const vm = pauseVM();
    screen.mount(root, vm, r.emit);
    press(root, 'pause-settings');
    expect(byTestId(root, 'pause-nested').hidden).toBe(false);
    expect(byTestId(root, 'settings-duration-hint').textContent).toBe(
      'Applies from the next round.',
    );
    screen.update({
      ...vm,
      settings: { ...vm.settings, settings: { ...vm.settings.settings, fovDeg: 99 } },
    });
    expect(byTestId<HTMLInputElement>(root, 'settings-fov').value).toBe('99');
    key(byTestId(root, 'settings-fov'), 'Escape');
    expect(root.querySelector('[data-testid="settings-screen"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId(root, 'pause-settings'));
    expect(r.intents).toEqual([]);
  });

  it('shows the lock-refused hint and keeps Resume active', () => {
    const root = host();
    const r = recorder();
    const screen = createPauseScreen();
    const vm = pauseVM();
    screen.mount(root, vm, r.emit);
    press(root, 'pause-resume');
    screen.update({ ...vm, lockRefused: true });
    expect(byTestId(root, 'pause-hint').textContent).toContain('Mouse lock was refused');
    press(root, 'pause-resume');
    expect(r.intents).toEqual([{ type: 'resume' }, { type: 'resume' }]);
  });

  it('falls back to open = true when showModal is missing', () => {
    const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
    const original = proto.showModal;
    delete proto.showModal;
    try {
      const root = host();
      const screen = createPauseScreen();
      screen.mount(root, pauseVM(), recorder().emit);
      const dialog = byTestId<HTMLDialogElement>(root, 'pause-dialog');
      expect(dialog.open).toBe(true);
      expect(dialog.dataset['fallback']).toBe('true');
      // Manual focus trap: Tab from the last focusable wraps to the first.
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')].filter(
        (b) => b.closest('[hidden]') === null,
      );
      buttons.at(-1)?.focus();
      const e = key(dialog, 'Tab');
      expect(e.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(buttons[0]);
      screen.unmount();
      expect(dialog.open).toBe(false);
    } finally {
      proto.showModal = original;
    }
  });
});
