/** S7 countdown overlay. Writes only when the displayed digit changes. */
import { el, setText, text, type TextHandle } from '../components/dom';
import { createScope, type Scope } from '../components/scope';
import type { Screen } from '../components/screen';
import type { CountdownVM } from './view-models';

export function countdownLabel(vm: CountdownVM): string {
  return vm.go ? 'GO' : String(Math.max(0, Math.ceil(vm.secondsLeft)));
}

export function createCountdownScreen(): Screen<CountdownVM> {
  let scope: Scope | null = null;
  let digit: TextHandle | null = null;
  let last: CountdownVM | null = null;
  return {
    mount(root: HTMLElement, vm: CountdownVM): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      last = vm;
      const node = el('section', { cls: 'sz-overlay sz-countdown', testId: 'countdown-screen' });
      const big = el(
        'p',
        {
          cls: 'sz-countdown__digit',
          testId: 'countdown-digit',
          attrs: { 'aria-live': 'assertive' },
        },
        node,
      );
      digit = text(big, countdownLabel(vm));
      root.appendChild(node);
      s.add(() => {
        node.remove();
      });
    },
    update(vm: CountdownVM): void {
      if (scope === null || digit === null || vm === last) return;
      last = vm;
      setText(digit, countdownLabel(vm));
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      digit = null;
      last = null;
    },
    focusFirst(): void {
      // Nothing focusable.
    },
  };
}
