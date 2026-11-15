import { describe, expect, it } from 'vitest';
import {
  classSlot,
  createDomWriter,
  propSlot,
  textSlot,
  type ClassTarget,
  type StyleTarget,
  type TextTarget,
} from '../../../src/ui/hud/dom/writer';

/** DOM-free fakes that count real mutations, to cross-check the writer's own counter. */
function fakes(): {
  text: TextTarget;
  style: StyleTarget & { props: Map<string, string> };
  el: ClassTarget & { classes: Set<string> };
  mutations: () => number;
} {
  let mutations = 0;
  const props = new Map<string, string>();
  const classes = new Set<string>();
  let data = '';
  return {
    text: {
      get data() {
        return data;
      },
      set data(v: string) {
        data = v;
        mutations++;
      },
    },
    style: {
      props,
      setProperty(name, value) {
        props.set(name, value);
        mutations++;
      },
    },
    el: {
      classes,
      classList: {
        toggle(token, force) {
          mutations++;
          if (force === true) classes.add(token);
          else classes.delete(token);
          return force === true;
        },
      },
    },
    mutations: () => mutations,
  };
}

describe('DomWriter node cache (PD-H-03, BR-H-06)', () => {
  it('writes integers once per change and never for an equal value', () => {
    const f = fakes();
    const w = createDomWriter();
    const s = textSlot(f.text);
    w.int(s, 30);
    w.int(s, 30);
    w.int(s, 30.2);
    expect(f.text.data).toBe('30');
    w.int(s, 29);
    expect(f.text.data).toBe('29');
    expect(w.writes).toBe(2);
    expect(f.mutations()).toBe(2);
  });

  it('compares labels by value and skips equal strings', () => {
    const f = fakes();
    const w = createDomWriter();
    const s = textSlot(f.text);
    w.label(s, 'RIFLE');
    w.label(s, 'RIFLE');
    w.label(s, 'PISTOL');
    expect(f.text.data).toBe('PISTOL');
    expect(w.writes).toBe(2);
  });

  it('quantises before comparing: px to integers, fractions to 0.01, degrees to whole', () => {
    const f = fakes();
    const w = createDomWriter();
    const px = propSlot(f.style, '--gap');
    const o = propSlot(f.style, '--o');
    const d = propSlot(f.style, '--arc-rot');
    w.px(px, 3.2);
    w.px(px, 2.8);
    w.px(px, Number.NaN);
    w.fraction(o, 0.501);
    w.fraction(o, 0.499);
    w.deg(d, -90.2);
    w.deg(d, 270.4);
    w.deg(d, Number.NaN);
    expect(f.style.props.get('--gap')).toBe('0');
    expect(f.style.props.get('--o')).toBe('0.5');
    expect(f.style.props.get('--arc-rot')).toBe('0deg');
    expect(w.writes).toBe(5);
    expect(f.mutations()).toBe(w.writes);
  });

  it('toggles a class only on change, starting from the initial state', () => {
    const f = fakes();
    const w = createDomWriter();
    const c = classSlot(f.el, 'is-low');
    w.toggle(c, false);
    w.toggle(c, true);
    w.toggle(c, true);
    expect(f.el.classes.has('is-low')).toBe(true);
    w.toggle(c, false);
    expect(w.writes).toBe(2);
  });

  it('formats changed moving values without growing the heap (PD-H-04 claim)', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (gc === undefined) throw new Error('Run Vitest with --expose-gc');
    const f = fakes();
    const w = createDomWriter();
    const slots = Array.from({ length: 20 }, (_, i) => ({
      x: propSlot(f.style, `--x${String(i)}`),
      o: propSlot(f.style, `--o${String(i)}`),
    }));
    const body = (): void => {
      for (let it = 0; it < 10_000; it++) {
        for (const [i, s] of slots.entries()) {
          w.px(s.x, ((it + i) % 180) - 90);
          w.fraction(s.o, ((it + i) % 100) / 100);
        }
      }
    };
    body();
    gc();
    const before = process.memoryUsage().heapUsed;
    body();
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(1024 * 1024);
  });
});
