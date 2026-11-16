/** SideNav: <nav> of buttons; the active one carries aria-current="page". */
import { el, removeAttr, setAttr } from './dom';
import type { Scope } from './scope';

export interface NavItem<T extends string> {
  readonly id: T;
  readonly label: string;
}

export interface SideNav<T extends string> {
  readonly el: HTMLElement;
  update(active: T): void;
  focus(id: T): void;
}

export function sideNav<T extends string>(
  scope: Scope,
  props: { items: readonly NavItem<T>[]; active: T; label: string; onSelect: (id: T) => void },
  parent?: Node,
): SideNav<T> {
  const nav = el(
    'nav',
    { cls: 'sz-nav', testId: 'side-nav', attrs: { 'aria-label': props.label } },
    parent,
  );
  const list = el('ul', { cls: 'sz-nav__list' }, nav);
  const buttons = new Map<T, HTMLButtonElement>();
  for (const item of props.items) {
    const li = el('li', {}, list);
    const b = el(
      'button',
      {
        cls: 'sz-nav__item',
        text: item.label,
        testId: `side-nav-${item.id}`,
        attrs: { type: 'button' },
      },
      li,
    );
    if (item.id === props.active) b.setAttribute('aria-current', 'page');
    scope.on(b, 'click', () => {
      props.onSelect(item.id);
    });
    buttons.set(item.id, b);
  }
  return {
    el: nav,
    update(active: T): void {
      for (const [id, b] of buttons) {
        if (id === active) setAttr(b, 'aria-current', 'page');
        else removeAttr(b, 'aria-current');
      }
    },
    focus(id: T): void {
      buttons.get(id)?.focus();
    },
  };
}
