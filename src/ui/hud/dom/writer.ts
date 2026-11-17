/**
 * DomWriter: the only path from the HUD to the DOM (PD-H-03, SD-H-01, SD-H-02).
 *
 * A slot is created once per (node, channel) in build and remembers the last
 * written primitive. Each write quantises first, compares second and formats
 * third, so an unchanged value costs no DOM write and no string work. Text is
 * written to a Text node's `data` (same channel as textContent: never parsed
 * as markup). Styling uses CSSOM custom properties and classList only.
 */
import { intText, normaliseDeg, opacityText, quantiseOpacity, degText } from '../model/format';

/** Minimal structural types so Node tests can drive the writer with fakes. */
export interface TextTarget {
  data: string;
}
export interface StyleTarget {
  setProperty(name: string, value: string): void;
}
export interface ClassTarget {
  readonly classList: { toggle(token: string, force?: boolean): boolean };
}

export interface TextSlot {
  readonly node: TextTarget;
  last: string | number | null;
}
export interface PropSlot {
  readonly style: StyleTarget;
  readonly name: string;
  last: number;
}
export interface ClassSlot {
  readonly el: ClassTarget;
  readonly cls: string;
  on: boolean;
}

export interface DomWriter {
  /** Integer text (ammo, health, counts). */
  int(slot: TextSlot, value: number): void;
  /** Fixed-table strings only (weapon names, BOT nn, prompts). Compared by reference. */
  label(slot: TextSlot, value: string): void;
  /** Unitless integer custom property; CSS multiplies it by 1px. */
  px(slot: PropSlot, value: number): void;
  /** 0..1 custom property quantised to 0.01 (opacity, bar fill). */
  fraction(slot: PropSlot, value: number): void;
  /** Whole-degree custom property, 0..359. */
  deg(slot: PropSlot, value: number): void;
  toggle(slot: ClassSlot, on: boolean): void;
  /** DOM mutations since this writer was created. */
  readonly writes: number;
}

export function textSlot(node: TextTarget): TextSlot {
  return { node, last: null };
}

export function propSlot(style: StyleTarget, name: string): PropSlot {
  return { style, name, last: Number.NaN };
}

/** `initial` must match the element's current class state. */
export function classSlot(el: ClassTarget, cls: string, initial = false): ClassSlot {
  return { el, cls, on: initial };
}

export function createDomWriter(): DomWriter {
  let writes = 0;
  return {
    int(slot, value) {
      const n = Math.round(value);
      if (slot.last === n) return;
      slot.last = n;
      slot.node.data = intText(n);
      writes++;
    },
    label(slot, value) {
      if (slot.last === value) return;
      slot.last = value;
      slot.node.data = value;
      writes++;
    },
    px(slot, value) {
      const n = Number.isFinite(value) ? Math.round(value) : 0;
      if (slot.last === n) return;
      slot.last = n;
      slot.style.setProperty(slot.name, intText(n));
      writes++;
    },
    fraction(slot, value) {
      const q = quantiseOpacity(value);
      if (slot.last === q) return;
      slot.last = q;
      slot.style.setProperty(slot.name, opacityText(q));
      writes++;
    },
    deg(slot, value) {
      const d = Number.isFinite(value) ? normaliseDeg(value) : 0;
      if (slot.last === d) return;
      slot.last = d;
      slot.style.setProperty(slot.name, degText(d));
      writes++;
    },
    toggle(slot, on) {
      if (slot.on === on) return;
      slot.on = on;
      slot.el.classList.toggle(slot.cls, on);
      writes++;
    },
    get writes() {
      return writes;
    },
  };
}
