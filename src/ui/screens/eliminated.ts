/** S12 eliminated overlay. */
import { el, setText, text, type TextHandle } from '../components/dom';
import { createScope, type Scope } from '../components/scope';
import type { Screen } from '../components/screen';
import { botName } from './format';
import type { EliminatedVM } from './view-models';

export function eliminatedCause(vm: EliminatedVM): string {
  return vm.killerId === null
    ? 'You were eliminated.'
    : `You were eliminated by ${botName(vm.killerId)}.`;
}

export function createEliminatedScreen(): Screen<EliminatedVM> {
  let scope: Scope | null = null;
  let cause: TextHandle | null = null;
  let last: EliminatedVM | null = null;
  return {
    mount(root: HTMLElement, vm: EliminatedVM): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      last = vm;
      const node = el('section', {
        cls: 'sz-overlay sz-eliminated',
        testId: 'eliminated-screen',
        attrs: { 'aria-live': 'polite' },
      });
      el('h2', { cls: 'sz-eliminated__title', text: 'ELIMINATED' }, node);
      cause = text(el('p', { testId: 'eliminated-cause' }, node), eliminatedCause(vm));
      root.appendChild(node);
      s.add(() => {
        node.remove();
      });
    },
    update(vm: EliminatedVM): void {
      if (scope === null || cause === null || vm === last) return;
      last = vm;
      setText(cause, eliminatedCause(vm));
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      cause = null;
      last = null;
    },
    focusFirst(): void {
      // Nothing focusable.
    },
  };
}
