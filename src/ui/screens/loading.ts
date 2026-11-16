/**
 * S5 loading. Shows the four steps and progress from the view model; the
 * screen never computes progress itself (req-loading-screen). Esc or Cancel
 * emits `cancel-loading`; the error state offers Retry and Main Menu.
 */
import { el, setAttr, setHidden, setText, text, type TextHandle } from '../components/dom';
import { menuButton } from '../components/menu-button';
import { notice, type Notice } from '../components/notice';
import { createScope, type Scope } from '../components/scope';
import type { Emit, Screen } from '../components/screen';
import type { LoadingStepId, LoadingVM } from './view-models';

const STEP_GLYPH = { pending: '○', running: '▸', done: '✓', failed: '✕' } as const;

interface StepRow {
  readonly li: HTMLLIElement;
  readonly glyph: TextHandle;
  readonly label: TextHandle;
  readonly pct: TextHandle;
}

export function createLoadingScreen(): Screen<LoadingVM> {
  let scope: Scope | null = null;
  let last: LoadingVM | null = null;
  let sent = false;
  let retrySent = false;
  let ui: {
    bar: HTMLElement;
    rows: Map<LoadingStepId, StepRow>;
    list: HTMLOListElement;
    error: Notice;
    cancel: HTMLButtonElement;
    errorActions: HTMLElement;
  } | null = null;

  function overall(vm: LoadingVM): number {
    if (vm.steps.length === 0) return 0;
    const sum = vm.steps.reduce((a, st) => a + Math.min(1, Math.max(0, st.progress)), 0);
    return Math.round((sum / vm.steps.length) * 100);
  }

  function render(vm: LoadingVM): void {
    if (ui === null) return;
    setAttr(ui.bar, 'aria-valuenow', String(overall(vm)));
    for (const st of vm.steps) {
      let r = ui.rows.get(st.id);
      if (r === undefined) {
        const li = el('li', { cls: 'sz-loading__step' }, ui.list);
        r = {
          li,
          glyph: text(
            el('span', { cls: 'sz-loading__glyph', attrs: { 'aria-hidden': 'true' } }, li),
          ),
          label: text(li),
          pct: text(el('span', { cls: 'sz-loading__pct' }, li)),
        };
        ui.rows.set(st.id, r);
      }
      setAttr(r.li, 'data-state', st.state);
      setText(r.glyph, STEP_GLYPH[st.state]);
      setText(r.label, ` ${st.label} `);
      setText(r.pct, `${String(Math.round(Math.min(1, Math.max(0, st.progress)) * 100))}%`);
    }
    const failed = vm.error !== null;
    if (!failed) retrySent = false;
    ui.error.set(vm.error ?? '');
    setHidden(ui.error.el, !failed);
    setHidden(ui.errorActions, !failed);
    setHidden(ui.cancel, failed);
  }

  return {
    mount(root: HTMLElement, vm: LoadingVM, emit: Emit): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      sent = false;
      retrySent = false;
      const node = el('section', { cls: 'sz-overlay sz-loading', testId: 'loading-screen' });
      el('h2', { cls: 'sz-panel__title', text: 'LOADING' }, node);
      const bar = el(
        'div',
        {
          cls: 'sz-loading__bar',
          testId: 'loading-progress',
          attrs: {
            role: 'progressbar',
            'aria-valuemin': '0',
            'aria-valuemax': '100',
            'aria-label': 'Loading progress',
          },
        },
        node,
      );
      const list = el('ol', { cls: 'sz-loading__steps', testId: 'loading-steps' }, node);
      const error = notice('alert', 'loading-error', '', node);
      const navOnce = (intent: 'cancel-loading' | 'main-menu'): void => {
        if (sent) return;
        sent = true;
        emit({ type: intent });
      };
      const cancel = menuButton(
        s,
        {
          label: 'Cancel',
          testId: 'loading-cancel',
          onPress: () => {
            navOnce('cancel-loading');
          },
        },
        node,
      ).el;
      const errorActions = el('div', { cls: 'sz-loading__actions' }, node);
      menuButton(
        s,
        {
          label: 'Retry',
          variant: 'primary',
          testId: 'loading-retry',
          onPress: () => {
            if (retrySent || sent) return;
            retrySent = true;
            emit({ type: 'retry-loading' });
          },
        },
        errorActions,
      );
      menuButton(
        s,
        {
          label: 'Main Menu',
          testId: 'loading-main-menu',
          onPress: () => {
            navOnce('main-menu');
          },
        },
        errorActions,
      );
      s.onKey(document, (e) => {
        if (e.key !== 'Escape' || last?.error != null) return;
        e.preventDefault();
        navOnce('cancel-loading');
      });
      ui = { bar, rows: new Map(), list, error, cancel, errorActions };
      render(vm);
      last = vm;
      root.appendChild(node);
      s.add(() => {
        node.remove();
      });
    },
    update(vm: LoadingVM): void {
      if (scope === null || vm === last) return;
      render(vm);
      last = vm;
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      ui = null;
      last = null;
    },
    focusFirst(): void {
      if (ui === null) return;
      if (last?.error != null) ui.errorActions.querySelector('button')?.focus();
      else ui.cancel.focus();
    },
  };
}
