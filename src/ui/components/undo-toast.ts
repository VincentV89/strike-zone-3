/**
 * UndoToast: <div role="status"> with an Undo button, shown for 5 s. The timer
 * pauses while the toast has hover or focus. It is created once and shown or
 * hidden, never recreated (S2 node budget).
 */
import { el, setHidden, setText, text } from './dom';
import { menuButton } from './menu-button';
import type { Scope } from './scope';

export interface UndoToast {
  readonly el: HTMLDivElement;
  readonly undoButton: HTMLButtonElement;
  show(message: string, onUndo: () => void): void;
  hide(): void;
  readonly visible: boolean;
}

export function undoToast(
  scope: Scope,
  testId: string,
  durationMs = 5000,
  parent?: Node,
): UndoToast {
  const box = el('div', { cls: 'sz-toast', testId, attrs: { role: 'status' } }, parent);
  box.hidden = true;
  const msg = text(el('span', { cls: 'sz-toast__text' }, box));
  let onUndo: (() => void) | null = null;
  let cancelTimer: (() => void) | null = null;
  let remaining = durationMs;
  let startedAt = 0;
  let paused = false;

  function stopTimer(): void {
    cancelTimer?.();
    cancelTimer = null;
  }
  function startTimer(): void {
    stopTimer();
    startedAt = Date.now();
    cancelTimer = scope.timeout(remaining, hide);
  }
  function hide(): void {
    stopTimer();
    onUndo = null;
    setHidden(box, true);
  }
  const undo = menuButton(
    scope,
    {
      label: 'Undo',
      testId: `${testId}-undo`,
      onPress: () => {
        const cb = onUndo;
        hide();
        cb?.();
      },
    },
    box,
  );
  const pause = (): void => {
    if (paused || cancelTimer === null) return;
    paused = true;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
    stopTimer();
  };
  const resume = (): void => {
    if (!paused || onUndo === null) return;
    paused = false;
    startTimer();
  };
  scope.on(box, 'mouseenter', pause);
  scope.on(box, 'focusin', pause);
  scope.on(box, 'mouseleave', resume);
  scope.on(box, 'focusout', resume);

  return {
    el: box,
    undoButton: undo.el,
    get visible() {
      return !box.hidden;
    },
    show(message: string, cb: () => void): void {
      onUndo = cb;
      paused = false;
      remaining = durationMs;
      setText(msg, message);
      setHidden(box, false);
      startTimer();
    },
    hide,
  };
}
