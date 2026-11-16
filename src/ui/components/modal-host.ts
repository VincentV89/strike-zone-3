/**
 * Native <dialog> host (TS-MS-05). Uses showModal() where it exists; otherwise
 * falls back to `open = true` plus a manual Tab focus trap (req-browser-support).
 */
import type { Scope } from './scope';

const FOCUSABLE = 'button:not([hidden]), input, [tabindex]:not([tabindex="-1"])';

export function supportsShowModal(dialog: HTMLDialogElement): boolean {
  return typeof (dialog as Partial<HTMLDialogElement>).showModal === 'function';
}

function visibleFocusables(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (n) => n.closest('[hidden]') === null,
  );
}

/** Opens the dialog modally. Returns true when the fallback path was used. */
export function openModal(scope: Scope, dialog: HTMLDialogElement): boolean {
  if (supportsShowModal(dialog)) {
    if (!dialog.open) dialog.showModal();
    scope.add(() => {
      if (dialog.open) dialog.close();
    });
    return false;
  }
  dialog.open = true;
  dialog.dataset['fallback'] = 'true';
  scope.onKey(dialog, (e) => {
    if (e.key !== 'Tab') return;
    const items = visibleFocusables(dialog);
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
  scope.add(() => {
    dialog.open = false;
  });
  return true;
}
