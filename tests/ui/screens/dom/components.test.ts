// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  el,
  removeAttr,
  setAttr,
  setStyleVar,
  toggleClass,
} from '../../../../src/ui/components/dom';
import { createScope } from '../../../../src/ui/components/scope';
import { domWrites, type Screen } from '../../../../src/ui/screens';

describe('dom helper', () => {
  it('writes only on change and counts each write', () => {
    const node = el('div', { cls: 'a', text: 'x', testId: 't', attrs: { role: 'note' } });
    expect(node.outerHTML).toBe('<div class="a" data-testid="t" role="note">x</div>');
    const before = domWrites.count;
    setAttr(node, 'aria-label', 'L');
    setAttr(node, 'aria-label', 'L');
    removeAttr(node, 'aria-label');
    removeAttr(node, 'aria-label');
    toggleClass(node, 'b', true);
    toggleClass(node, 'b', true);
    setStyleVar(node, '--p', '0.5');
    setStyleVar(node, '--p', '0.5');
    expect(node.style.getPropertyValue('--p')).toBe('0.5');
    expect(domWrites.count - before).toBe(4);
  });
});

describe('scope', () => {
  it('removes listeners, cancels timers and unmounts children on dispose', () => {
    vi.useFakeTimers();
    const s = createScope();
    const target = new EventTarget();
    const fn = vi.fn();
    s.on(target, 'ping', fn);
    const timer = vi.fn();
    s.timeout(100, timer);
    const cancelled = vi.fn();
    s.timeout(100, cancelled)();
    const unmount = vi.fn();
    const child: Screen<number> = {
      mount: vi.fn(),
      update: vi.fn(),
      unmount,
      focusFirst: vi.fn(),
    };
    s.child(child, document.createElement('div'), 1, () => undefined);
    target.dispatchEvent(new Event('ping'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    s.dispose();
    s.dispose();
    target.dispatchEvent(new Event('ping'));
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(timer).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(s.disposed).toBe(true);
    // After dispose nothing new is registered; add() runs immediately.
    const late = vi.fn();
    s.add(late);
    expect(late).toHaveBeenCalledTimes(1);
    s.on(target, 'ping', fn);
    target.dispatchEvent(new Event('ping'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.timeout(1, timer)).toBeTypeOf('function');
    expect(s.child(child, document.createElement('div'), 1, () => undefined)).toBeTypeOf(
      'function',
    );
    vi.useRealTimers();
  });

  it('a fired timer releases itself', () => {
    vi.useFakeTimers();
    const s = createScope();
    const fn = vi.fn();
    s.timeout(10, fn);
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledTimes(1);
    s.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
