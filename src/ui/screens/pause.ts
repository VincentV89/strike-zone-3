/**
 * S11 Pause dialog. Resume emits `resume` synchronously inside the click
 * (BR-MS-28). Restart Round and Main Menu need an InlineConfirm (BR-MS-30).
 * Esc never emits `resume` (FD-MS-Q1, BR-MS-29): it closes the confirm, then
 * the nested Settings panel; otherwise it focuses Resume and shows a hint.
 */
import { el, setHidden, setText, text, type TextHandle } from '../components/dom';
import { inlineConfirm, type InlineConfirm } from '../components/inline-confirm';
import { menuButton } from '../components/menu-button';
import { openModal } from '../components/modal-host';
import { createScope, type Scope } from '../components/scope';
import type { Emit, Screen } from '../components/screen';
import { createSettingsScreen } from './settings';
import type { PauseVM } from './view-models';

export const PAUSE_ESC_HINT = 'Press Enter or click Resume.';
export const PAUSE_LOCK_REFUSED = 'Mouse lock was refused by the browser. Click Resume again.';
export const PAUSE_RESTORING = 'Returning to the round…';
export const RESTART_QUESTION = "Restart this round? It won't count toward rounds won or lost.";
export const LEAVE_QUESTION = "Leave to the main menu? It won't count toward rounds won or lost.";

export function createPauseScreen(): Screen<PauseVM> {
  let scope: Scope | null = null;
  let last: PauseVM | null = null;
  let sent = false;
  let nested: { release: () => void; update: (vm: PauseVM) => void } | null = null;
  let ui: {
    dialog: HTMLDialogElement;
    main: HTMLElement;
    slot: HTMLElement;
    resume: HTMLButtonElement;
    settingsButton: HTMLButtonElement;
    hint: TextHandle;
    summary: TextHandle;
    confirm: InlineConfirm;
  } | null = null;
  let pending: 'restart-confirmed' | 'leave-confirmed' = 'restart-confirmed';

  function closeNested(): void {
    if (ui === null || nested === null) return;
    nested.release();
    nested = null;
    setHidden(ui.slot, true);
    setHidden(ui.main, false);
    ui.settingsButton.focus();
  }

  function statusText(vm: PauseVM): string {
    if (vm.lockRefused) return PAUSE_LOCK_REFUSED;
    if (vm.restoring) return PAUSE_RESTORING;
    return '';
  }

  function handleEscape(): void {
    if (ui === null) return;
    if (ui.confirm.isOpen) {
      ui.confirm.close();
      return;
    }
    if (nested !== null) {
      closeNested();
      return;
    }
    ui.resume.focus();
    setText(ui.hint, PAUSE_ESC_HINT);
  }

  return {
    mount(root: HTMLElement, vm: PauseVM, emit: Emit): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      last = vm;
      sent = false;
      const dialog = el('dialog', {
        cls: 'sz-pause',
        testId: 'pause-dialog',
        attrs: { 'aria-labelledby': 'sz-pause-title' },
      });
      const main = el('div', { cls: 'sz-pause__main' }, dialog);
      el('h2', { cls: 'sz-panel__title', text: 'PAUSED', attrs: { id: 'sz-pause-title' } }, main);
      const summary = text(
        el('p', { cls: 'sz-pause__summary', testId: 'pause-summary' }, main),
        vm.summary,
      );
      const hintP = el(
        'p',
        { cls: 'sz-pause__hint', testId: 'pause-hint', attrs: { 'aria-live': 'polite' } },
        main,
      );
      const hint = text(hintP, statusText(vm));
      const actions = el('div', { cls: 'sz-pause__actions' }, main);
      const resume = menuButton(
        s,
        {
          label: 'Resume',
          variant: 'primary',
          testId: 'pause-resume',
          onPress: () => {
            emit({ type: 'resume' }); // synchronous, inside the gesture
          },
        },
        actions,
      ).el;
      const settingsButton = menuButton(
        s,
        {
          label: 'Settings',
          testId: 'pause-settings',
          onPress: () => {
            if (ui === null || last === null || nested !== null) return;
            const screen = createSettingsScreen();
            setHidden(ui.main, true);
            setHidden(ui.slot, false);
            nested = {
              release: s.child(screen, ui.slot, last.settings, emit),
              update: (v) => {
                screen.update(v.settings);
              },
            };
            screen.focusFirst();
          },
        },
        actions,
      ).el;
      const confirm = inlineConfirm(s, {
        testId: 'pause-confirm',
        confirmLabel: 'Confirm',
        onConfirm: () => {
          if (sent) return;
          sent = true;
          emit({ type: pending });
        },
      });
      const restart = menuButton(
        s,
        {
          label: 'Restart Round',
          testId: 'pause-restart',
          onPress: () => {
            pending = 'restart-confirmed';
            confirm.open(RESTART_QUESTION, restart.el);
          },
        },
        actions,
      );
      const leave = menuButton(
        s,
        {
          label: 'Main Menu',
          testId: 'pause-main-menu',
          onPress: () => {
            pending = 'leave-confirmed';
            confirm.open(LEAVE_QUESTION, leave.el);
          },
        },
        actions,
      );
      main.appendChild(confirm.el);
      const slot = el('div', { cls: 'sz-pause__nested', testId: 'pause-nested' }, dialog);
      slot.hidden = true;
      menuButton(s, { label: '‹ Back', testId: 'pause-settings-back', onPress: closeNested }, slot);

      // Esc: keydown runs first; preventing it stops the dialog's own cancel.
      s.onKey(dialog, (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        handleEscape();
      });
      // A close request without a keydown (other platforms) still never resumes.
      s.on(dialog, 'cancel', (e) => {
        e.preventDefault();
        handleEscape();
      });
      ui = { dialog, main, slot, resume, settingsButton, hint, summary, confirm };
      root.appendChild(dialog);
      s.add(() => {
        dialog.remove();
      });
      openModal(s, dialog);
      resume.focus();
    },
    update(vm: PauseVM): void {
      if (scope === null || ui === null || vm === last) return;
      last = vm;
      setText(ui.summary, vm.summary);
      const status = statusText(vm);
      if (status !== '' || ui.hint.last !== PAUSE_ESC_HINT) setText(ui.hint, status);
      nested?.update(vm);
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      ui = null;
      nested = null;
      last = null;
    },
    focusFirst(): void {
      ui?.resume.focus();
    },
  };
}
