/** S3 Controls: the RA-02 binding table, read-only (story-controls-about). */
import { el } from '../components/dom';
import { createScope, type Scope } from '../components/scope';
import type { Screen } from '../components/screen';
import { CONTROL_BINDINGS } from './controls-content';

export function createControlsScreen(): Screen<null> {
  let scope: Scope | null = null;
  let heading: HTMLHeadingElement | null = null;
  return {
    mount(root: HTMLElement): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      const node = el('section', { cls: 'sz-controls', testId: 'controls-screen' });
      heading = el(
        'h2',
        { cls: 'sz-panel__title', text: 'CONTROLS', attrs: { tabindex: '-1' } },
        node,
      );
      const table = el('table', { cls: 'sz-table', testId: 'controls-table' }, node);
      el('caption', { cls: 'sz-visually-hidden', text: 'Keyboard and mouse controls' }, table);
      const head = el('tr', {}, el('thead', {}, table));
      el('th', { text: 'Action', attrs: { scope: 'col' } }, head);
      el('th', { text: 'Keys', attrs: { scope: 'col' } }, head);
      const body = el('tbody', {}, table);
      for (const b of CONTROL_BINDINGS) {
        const tr = el('tr', {}, body);
        el('th', { text: b.action, attrs: { scope: 'row' } }, tr);
        el('td', { cls: 'sz-keys', text: b.keys }, tr);
      }
      el('p', { cls: 'sz-panel__hint', text: 'Controls cannot be rebound.' }, node);
      root.appendChild(node);
      s.add(() => {
        node.remove();
      });
    },
    update(): void {
      // Static content: nothing to update.
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      heading = null;
    },
    focusFirst(): void {
      heading?.focus();
    },
  };
}
