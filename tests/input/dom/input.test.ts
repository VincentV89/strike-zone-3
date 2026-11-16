// @vitest-environment happy-dom
/** InputSystem (business-logic-model-app-shell §8, SD-AS-09, req-control-bindings). */
import { afterEach, describe, expect, it } from 'vitest';
import { createScope } from '../../../src/app/scope';
import { BINDING_TABLE, createInputSystem, isIgnoredKey, KEY_BINDINGS } from '../../../src/input';
import { CONTROL_BINDINGS } from '../../../src/ui/screens';

const scopes: ReturnType<typeof createScope>[] = [];
afterEach(() => {
  for (const s of scopes.splice(0)) s.dispose();
});

function rig() {
  const canvas = document.createElement('canvas');
  const scope = createScope();
  scopes.push(scope);
  const input = createInputSystem({ keys: window, pointer: document, canvas });
  input.attach(scope);
  input.setMap('gameplay');
  const key = (
    code: string,
    type: 'keydown' | 'keyup' = 'keydown',
    init: KeyboardEventInit = {},
  ) => {
    const e = new KeyboardEvent(type, { code, cancelable: true, ...init });
    window.dispatchEvent(e);
    return e;
  };
  const mouse = (type: string, init: MouseEventInit) => {
    document.dispatchEvent(new MouseEvent(type, { cancelable: true, ...init }));
  };
  return { input, scope, key, mouse, canvas };
}

describe('bindings', () => {
  it('the binding table equals the Controls screen table (RA-02)', () => {
    expect(BINDING_TABLE.map((b) => ({ ...b }))).toEqual(CONTROL_BINDINGS.map((b) => ({ ...b })));
  });

  it('Ctrl is not bound and modifier chords and function keys are ignored', () => {
    expect(Object.keys(KEY_BINDINGS).some((k) => /control/i.test(k))).toBe(false);
    expect(isIgnoredKey({ code: 'KeyW', ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(isIgnoredKey({ code: 'F5', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    const r = rig();
    r.key('KeyW', 'keydown', { ctrlKey: true });
    r.key('ControlLeft');
    expect(r.input.sample(1).move).toEqual({ x: 0, z: 0 });
  });
});

describe('sampling', () => {
  it('maps WASD, sprint, crouch and opposite keys cancel', () => {
    const r = rig();
    r.key('KeyW');
    r.key('KeyA');
    r.key('ShiftLeft');
    r.key('KeyC');
    let c = r.input.sample(1);
    expect(c.move).toEqual({ x: -1, z: -1 });
    expect(c.sprint && c.crouch).toBe(true);
    r.key('KeyS');
    r.key('KeyD');
    c = r.input.sample(2);
    expect(c.move).toEqual({ x: 0, z: 0 });
    r.key('KeyW', 'keyup');
    r.key('KeyA', 'keyup');
    expect(r.input.sample(3).move).toEqual({ x: 1, z: 1 });
  });

  it('edges (jump, reload, select, cycle, firePressed) fire once', () => {
    const r = rig();
    r.key('Space');
    r.key('KeyR');
    r.key('Digit3');
    r.mouse('mousedown', { button: 0 });
    document.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, cancelable: true }));
    let c = r.input.sample(1);
    expect(c).toMatchObject({
      jump: true,
      reload: true,
      select: 2,
      cycle: -1,
      fire: true,
      firePressed: true,
    });
    c = r.input.sample(2);
    expect(c).toMatchObject({
      jump: false,
      reload: false,
      select: null,
      cycle: 0,
      fire: true,
      firePressed: false,
    });
    r.key('Space', 'keydown', { repeat: true });
    expect(r.input.sample(3).jump).toBe(false);
    r.mouse('mouseup', { button: 0 });
    r.mouse('mousedown', { button: 2 });
    c = r.input.sample(4);
    expect(c.fire).toBe(false);
    expect(c.scope).toBe(true);
    r.mouse('mouseup', { button: 2 });
    expect(r.input.sample(5).scope).toBe(false);
    r.key('Digit1');
    expect(r.input.sample(6).select).toBe(0);
    r.key('Digit2');
    document.dispatchEvent(new WheelEvent('wheel', { deltaY: 4, cancelable: true }));
    c = r.input.sample(7);
    expect(c.select).toBe(1);
    expect(c.cycle).toBe(1);
  });

  it('look deltas go to the first sample of a frame only', () => {
    const r = rig();
    r.mouse('mousemove', { movementX: 3, movementY: -2 });
    r.mouse('mousemove', { movementX: 2, movementY: 1 });
    const c = r.input.sample(1);
    expect([c.lookDx, c.lookDy]).toEqual([5, -1]);
    expect(r.input.sample(2).lookDx).toBe(0);
  });

  it('look-only keeps look and drops everything else, unqueued', () => {
    const r = rig();
    r.input.setMap('look-only');
    r.key('Space');
    r.key('KeyW');
    r.mouse('mousedown', { button: 0 });
    r.mouse('mousemove', { movementX: 4 });
    const c = r.input.sample(1);
    expect(c).toMatchObject({ jump: false, fire: false, firePressed: false, lookDx: 4 });
    expect(c.move).toEqual({ x: 0, z: 0 });
    r.input.setMap('gameplay');
    expect(r.input.sample(2)).toMatchObject({ jump: false, firePressed: false });
  });

  it('ui and none maps sample nothing and do not cancel defaults', () => {
    const r = rig();
    r.input.setMap('ui');
    const tab = r.key('Tab');
    expect(tab.defaultPrevented).toBe(false);
    r.mouse('mousemove', { movementX: 4 });
    expect(r.input.sample(1).lookDx).toBe(0);
    expect(r.input.map()).toBe('ui');
  });

  it('preventDefault runs only for Tab, Space and digits in a round, plus wheel and context menu', () => {
    const r = rig();
    expect(r.key('Tab').defaultPrevented).toBe(true);
    expect(r.key('Space').defaultPrevented).toBe(true);
    expect(r.key('Digit2').defaultPrevented).toBe(true);
    expect(r.key('KeyW').defaultPrevented).toBe(false);
    const ctx = new MouseEvent('contextmenu', { cancelable: true });
    r.canvas.dispatchEvent(ctx);
    expect(ctx.defaultPrevented).toBe(true);
  });

  it('Tab hold drives held(scoreboard); clearHeld and blur clear everything', () => {
    const r = rig();
    r.key('Tab');
    r.key('KeyW');
    expect(r.input.held('scoreboard')).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(r.input.held('scoreboard')).toBe(false);
    expect(r.input.sample(1).move.z).toBe(0);
    r.key('KeyW');
    r.input.clearHeld();
    expect(r.input.sample(2).move.z).toBe(0);
  });

  it('listeners go away with the scope', () => {
    const r = rig();
    r.scope.dispose();
    r.key('KeyW');
    expect(r.input.sample(1).move.z).toBe(0);
  });
});
