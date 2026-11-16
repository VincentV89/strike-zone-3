/**
 * InlineConfirm: <div role="group"> with Cancel and a confirm button.
 * Cancel gets focus on open, so the Enter that opened it cannot confirm it
 * (SEC-MS-09). Esc cancels and stops propagation so a host dialog does not
 * also handle it. Close returns focus to the trigger (BR-MS-45).
 */
import { el, setHidden, setText, text } from './dom';
import { menuButton } from './menu-button';
import type { Scope } from './scope';

export interface InlineConfirmProps {
  readonly testId: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
}

export interface InlineConfirm {
  readonly el: HTMLDivElement;
  readonly cancelButton: HTMLButtonElement;
  readonly confirmButton: HTMLButtonElement;
  open(question: string, trigger: HTMLElement | null): void;
  close(): void;
  readonly isOpen: boolean;
}

export function inlineConfirm(
  scope: Scope,
  props: InlineConfirmProps,
  parent?: Node,
): InlineConfirm {
  const box = el(
    'div',
    { cls: 'sz-confirm', testId: props.testId, attrs: { role: 'group' } },
    parent,
  );
  box.hidden = true;
  const p = el('p', { cls: 'sz-confirm__question' }, box);
  const question = text(p);
  const actions = el('div', { cls: 'sz-confirm__actions' }, box);
  let trigger: HTMLElement | null = null;
  let isOpen = false;

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    setHidden(box, true);
    trigger?.focus();
    trigger = null;
  }
  const cancel = menuButton(
    scope,
    { label: 'Cancel', testId: `${props.testId}-cancel`, onPress: close },
    actions,
  );
  const confirm = menuButton(
    scope,
    {
      label: props.confirmLabel,
      variant: 'danger',
      testId: `${props.testId}-confirm`,
      onPress: () => {
        if (isOpen) props.onConfirm();
      },
    },
    actions,
  );
  scope.onKey(box, (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });
  return {
    el: box,
    cancelButton: cancel.el,
    confirmButton: confirm.el,
    get isOpen() {
      return isOpen;
    },
    open(q: string, t: HTMLElement | null): void {
      trigger = t;
      setText(question, q);
      isOpen = true;
      setHidden(box, false);
      cancel.el.focus();
    },
    close,
  };
}
