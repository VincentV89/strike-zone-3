/**
 * The single DOM helper for menus-settings (PD-MS-02, SD-MS-07).
 * - Nodes are created with createElement and text with Text nodes, never HTML.
 * - Every write after mount goes through set* below and only happens when the
 *   value changed; `domWrites.count` is the PERF-MS-08 measure.
 * - Attribute names are restricted by the AllowedAttr type, so `style` and
 *   `on*` cannot be written (CSP style-src 'self', SEC-MS-02).
 */

export type AllowedAttr =
  | `aria-${string}`
  | `data-${string}`
  | 'role'
  | 'tabindex'
  | 'for'
  | 'id'
  | 'type'
  | 'name'
  | 'min'
  | 'max'
  | 'step'
  | 'value'
  | 'scope';

/** Write counter. Tests read deltas around an update. */
export const domWrites = { count: 0 };

export interface ElOptions {
  readonly cls?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Partial<Record<AllowedAttr, string>>>;
  readonly testId?: string;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  parent?: Node,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.cls !== undefined) node.className = opts.cls;
  if (opts.text !== undefined) node.append(document.createTextNode(opts.text));
  if (opts.testId !== undefined) node.dataset['testid'] = opts.testId;
  if (opts.attrs !== undefined) {
    for (const [name, value] of Object.entries(opts.attrs) as [AllowedAttr, string][]) {
      node.setAttribute(name, value);
    }
  }
  parent?.appendChild(node);
  return node;
}

/** A Text node plus the last value written to it. */
export interface TextHandle {
  readonly node: Text;
  last: string;
}

export function text(parent: Node, initial = ''): TextHandle {
  const node = document.createTextNode(initial);
  parent.appendChild(node);
  return { node, last: initial };
}

export function setText(h: TextHandle, value: string): void {
  if (h.last === value) return;
  h.last = value;
  h.node.data = value;
  domWrites.count++;
}

export function setAttr(node: Element, name: AllowedAttr, value: string): void {
  if (node.getAttribute(name) === value) return;
  node.setAttribute(name, value);
  domWrites.count++;
}

export function removeAttr(node: Element, name: AllowedAttr): void {
  if (!node.hasAttribute(name)) return;
  node.removeAttribute(name);
  domWrites.count++;
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden === hidden) return;
  node.hidden = hidden;
  domWrites.count++;
}

export function setChecked(input: HTMLInputElement, checked: boolean): void {
  if (input.checked === checked) return;
  input.checked = checked;
  domWrites.count++;
}

/**
 * Range inputs compare against the live DOM value, not a cache: during a drag
 * the DOM moves ahead, and a clamped value must still be pushed back.
 */
export function setInputValue(input: HTMLInputElement, value: string): void {
  if (input.value === value) return;
  input.value = value;
  domWrites.count++;
}

export function toggleClass(node: Element, cls: string, on: boolean): void {
  if (node.classList.contains(cls) === on) return;
  node.classList.toggle(cls, on);
  domWrites.count++;
}

/** CSSOM custom property; allowed by style-src 'self' because it is not a style attribute. */
export function setStyleVar(node: HTMLElement, name: `--${string}`, value: string): void {
  if (node.style.getPropertyValue(name) === value) return;
  node.style.setProperty(name, value);
  domWrites.count++;
}

/** Number of element nodes in a tree, counting the root (node budgets, PERF-MS-07). */
export function countNodes(root: Element): number {
  return root.querySelectorAll('*').length + 1;
}
