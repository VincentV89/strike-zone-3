/**
 * S6 ready gate ("Click to deploy"). The click emits `deploy` synchronously in
 * the handler so app-shell can call requestPointerLock under the same user
 * activation (BR-MS-28). If the lock was refused, the player clicks again.
 */
import { el, setHidden } from '../components/dom';
import { menuButton } from '../components/menu-button';
import { createScope, type Scope } from '../components/scope';
import type { Emit, Screen } from '../components/screen';
import type { ReadyVM } from './view-models';

export const LOCK_REFUSED_MESSAGE = 'Mouse lock was refused by the browser. Click again.';

export function createReadyGateScreen(): Screen<ReadyVM> {
  let scope: Scope | null = null;
  let last: ReadyVM | null = null;
  let sent = false;
  let ui: { button: HTMLButtonElement; refused: HTMLElement } | null = null;
  return {
    mount(root: HTMLElement, vm: ReadyVM, emit: Emit): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      last = vm;
      sent = false;
      const node = el('section', { cls: 'sz-overlay sz-ready', testId: 'ready-screen' });
      const button = menuButton(
        s,
        {
          label: 'CLICK TO DEPLOY',
          variant: 'primary',
          testId: 'ready-deploy',
          onPress: () => {
            if (sent) return;
            sent = true;
            emit({ type: 'deploy' });
          },
        },
        node,
      ).el;
      el('p', { cls: 'sz-ready__hint', text: 'Captures the mouse. Press Esc to pause.' }, node);
      const refused = el(
        'p',
        {
          cls: 'sz-ready__refused',
          text: LOCK_REFUSED_MESSAGE,
          testId: 'ready-lock-refused',
          attrs: { role: 'alert' },
        },
        node,
      );
      refused.hidden = !vm.lockRefused;
      ui = { button, refused };
      root.appendChild(node);
      s.add(() => {
        node.remove();
      });
    },
    update(vm: ReadyVM): void {
      if (scope === null || ui === null || vm === last) return;
      // A refused lock re-arms the button for a second click.
      if (vm.lockRefused && last?.lockRefused !== true) sent = false;
      last = vm;
      setHidden(ui.refused, !vm.lockRefused);
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      ui = null;
      last = null;
    },
    focusFirst(): void {
      ui?.button.focus();
    },
  };
}
