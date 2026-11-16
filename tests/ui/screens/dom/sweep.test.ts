// @vitest-environment happy-dom
/**
 * Sweeps over every screen: node budgets (PERF-MS-07), zero writes on an
 * unchanged update (PERF-MS-08), no listeners or timers left after 10
 * mount/unmount cycles (PERF-MS-10, BR-MS-32), no inline style or on*
 * attributes (SEC-MS-02) and keyboard reachability (BR-MS-40).
 */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { countNodes, domWrites } from '../../../../src/ui/screens';
import { host, recorder } from './fixtures';
import { SCREENS } from './sweep';

type Entry = { target: EventTarget; type: string; fn: unknown };
const live = new Set<Entry>();
const proto = EventTarget.prototype;
// eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with .call below
const realAdd = proto.addEventListener;
// eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with .call below
const realRemove = proto.removeEventListener;

beforeAll(() => {
  proto.addEventListener = function (this: EventTarget, type: string, fn: unknown, opts?: unknown) {
    live.add({ target: this, type, fn });
    realAdd.call(this, type, fn as EventListener, opts as AddEventListenerOptions);
  };
  proto.removeEventListener = function (
    this: EventTarget,
    type: string,
    fn: unknown,
    opts?: unknown,
  ) {
    for (const e of live) if (e.target === this && e.type === type && e.fn === fn) live.delete(e);
    realRemove.call(this, type, fn as EventListener, opts as EventListenerOptions);
  };
});
afterAll(() => {
  proto.addEventListener = realAdd;
  proto.removeEventListener = realRemove;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe.each(SCREENS)('$name', ({ budget, make, vm }) => {
  it(`stays within ${String(budget)} nodes`, () => {
    const root = host();
    make().mount(root, vm(), recorder().emit);
    const top = root.firstElementChild;
    expect(top).not.toBeNull();
    if (top !== null) expect(countNodes(top)).toBeLessThanOrEqual(budget);
  });

  it('makes 0 DOM writes on an unchanged update', () => {
    const root = host();
    const screen = make();
    const model = vm();
    screen.mount(root, model, recorder().emit);
    const before = domWrites.count;
    screen.update(model);
    if (typeof model === 'object' && model !== null) screen.update({ ...model });
    expect(domWrites.count - before).toBe(0);
  });

  it('leaves no listener, timer or node after 10 mount/unmount cycles', () => {
    vi.useFakeTimers();
    const root = host();
    const baseline = live.size;
    for (let i = 0; i < 10; i++) {
      const screen = make();
      screen.mount(root, vm(), recorder().emit);
      // Exercise the timer path where one exists (S2 reset toast).
      root.querySelector<HTMLButtonElement>('[data-testid="settings-reset"]')?.click();
      screen.unmount();
      screen.update(vm()); // no-op after unmount
    }
    expect(live.size).toBe(baseline);
    expect(vi.getTimerCount()).toBe(0);
    expect(root.childElementCount).toBe(0);
  });

  it('has no style or on* attribute on any element', () => {
    const root = host();
    make().mount(root, vm(), recorder().emit);
    for (const node of root.querySelectorAll('*')) {
      for (const attr of node.getAttributeNames()) {
        expect(attr === 'style' || attr.startsWith('on')).toBe(false);
      }
    }
  });

  it('keeps every control keyboard-reachable', () => {
    const root = host();
    make().mount(root, vm(), recorder().emit);
    const controls = root.querySelectorAll<HTMLElement>('button, input, a, select');
    for (const ctl of controls) {
      expect(ctl.getAttribute('tabindex')).not.toBe('-1');
      expect(ctl.tagName === 'BUTTON' ? ctl.getAttribute('type') : 'button').toBe('button');
    }
  });
});

describe('PERF-MS-10 with settings toasts', () => {
  it('a reset toast timer is cancelled by unmount', () => {
    vi.useFakeTimers();
    const s = SCREENS.find((x) => x.name === 'S2 settings');
    expect(s).toBeDefined();
    if (s === undefined) return;
    const root = host();
    const screen = s.make();
    const model = s.vm() as { settings: object };
    screen.mount(root, { ...model, settings: { ...model.settings, fovDeg: 100 } }, recorder().emit);
    root.querySelector<HTMLButtonElement>('[data-testid="settings-reset"]')?.click();
    expect(vi.getTimerCount()).toBe(1);
    screen.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
