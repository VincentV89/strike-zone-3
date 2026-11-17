/** SkipLink: first Tab stop on S1; moves focus straight to the target. */
import { el } from './dom';
import type { Scope } from './scope';

export function skipLink(
  scope: Scope,
  label: string,
  target: () => HTMLElement | null,
  parent?: Node,
): HTMLButtonElement {
  const b = el(
    'button',
    { cls: 'sz-skip', text: label, testId: 'skip-link', attrs: { type: 'button' } },
    parent,
  );
  scope.on(b, 'click', () => {
    target()?.focus();
  });
  return b;
}
