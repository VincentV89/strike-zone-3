/**
 * DOM construction helpers, used only while a widget builds its nodes in
 * mount. Attribute names are literals (SD-H-02); values are numbers or
 * constants from the widget modules.
 */
import {
  classSlot,
  propSlot,
  textSlot,
  type ClassSlot,
  type PropSlot,
  type TextSlot,
} from './writer';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Element counts per widget are bounded; mount asserts the total (PD-H-05). */
export const MAX_HUD_ELEMENTS = 250;

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  parent: Element,
  tag: K,
  className: string,
  staticText?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (staticText !== undefined) node.textContent = staticText;
  parent.appendChild(node);
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  parent: Element,
  tag: K,
  className?: string,
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG_NS, tag);
  if (className !== undefined) node.setAttribute('class', className);
  parent.appendChild(node);
  return node;
}

export function svgLine(
  doc: Document,
  parent: Element,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  className?: string,
): SVGLineElement {
  const line = svg(doc, parent, 'line', className);
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  return line;
}

export function svgCircle(
  doc: Document,
  parent: Element,
  r: number,
  className?: string,
): SVGCircleElement {
  const circle = svg(doc, parent, 'circle', className);
  circle.setAttribute('cx', '0');
  circle.setAttribute('cy', '0');
  circle.setAttribute('r', String(r));
  return circle;
}

/** A span holding one Text node the writer updates through `data`. */
export function textEl(doc: Document, parent: Element, className: string): TextSlot {
  const span = el(doc, parent, 'span', className);
  const text = doc.createTextNode('');
  span.appendChild(text);
  return textSlot(text);
}

export function cls(target: Element, name: string): ClassSlot {
  return classSlot(target, name, target.classList.contains(name));
}

export function prop(target: HTMLElement | SVGElement, name: string): PropSlot {
  return propSlot(target.style, name);
}

/** Root containers the widgets attach to. */
export interface HudLayout {
  readonly root: HTMLElement;
  readonly topLeft: HTMLElement;
  readonly topCentre: HTMLElement;
  readonly topRight: HTMLElement;
  readonly centre: SVGSVGElement;
  readonly bottomLeft: HTMLElement;
  readonly bottomRight: HTMLElement;
}
