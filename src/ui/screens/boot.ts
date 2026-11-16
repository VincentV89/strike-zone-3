/** S0 boot notice: shown when the browser cannot run StrikeZone (req-boot-capability-check). */
import { el, setHidden } from '../components/dom';
import { notice } from '../components/notice';
import { createScope, type Scope } from '../components/scope';
import type { Screen } from '../components/screen';
import type { BootVM } from './view-models';

export const UNSUPPORTED_MESSAGE =
  "StrikeZone needs WebGL 2, which this browser couldn't start. Try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration turned on.";

export function createBootScreen(): Screen<BootVM> {
  let scope: Scope | null = null;
  let box: HTMLElement | null = null;
  let last: BootVM | null = null;
  return {
    mount(root: HTMLElement, vm: BootVM): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      last = vm;
      const node = el('section', { cls: 'sz-boot', testId: 'boot-screen' });
      const n = notice('alert', 'boot-unsupported', UNSUPPORTED_MESSAGE, node);
      n.el.hidden = !vm.unsupported;
      box = n.el;
      root.appendChild(node);
      s.add(() => {
        node.remove();
      });
    },
    update(vm: BootVM): void {
      if (scope === null || box === null || vm === last) return;
      last = vm;
      setHidden(box, !vm.unsupported);
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      box = null;
      last = null;
    },
    focusFirst(): void {
      // Nothing focusable.
    },
  };
}
