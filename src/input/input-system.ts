/**
 * InputSystem (component-methods; business-logic-model-app-shell §8). Holds
 * flags, not queues: held keys and buttons, edge flags consumed by the next
 * sample(), and a look accumulator. Listeners register through the scope
 * passed to attach(), so input owns no timers and no global listeners.
 */
import type { InputCommand } from '../contracts';
import {
  FIRE_BUTTON,
  KEY_BINDINGS,
  PREVENT_DEFAULT_CODES,
  SCOPE_BUTTON,
  isIgnoredKey,
  type KeyAction,
} from './bindings';

/** The part of app-shell's DisposableScope that input uses (no src/app edge). */
export interface ListenerScope {
  on(
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
    options?: AddEventListenerOptions,
  ): void;
}

export type InputMap = 'none' | 'ui' | 'look-only' | 'gameplay';
export type HeldAction = 'scoreboard';

export interface InputTargets {
  /** Keyboard and blur events (the window). */
  readonly keys: EventTarget;
  /** Mouse buttons, movement and wheel (the document). */
  readonly pointer: EventTarget;
  /** The game canvas: its context menu is suppressed in a round. */
  readonly canvas: EventTarget;
}

export interface InputSystem {
  attach(scope: ListenerScope): void;
  setMap(map: InputMap): void;
  map(): InputMap;
  /** Writes the command for `tick` into a reused object and consumes edges and look. */
  sample(tick: number): InputCommand;
  clearHeld(): void;
  held(action: HeldAction): boolean;
}

function createCommand(): InputCommand {
  return {
    tick: 0,
    move: { x: 0, z: 0 },
    lookDx: 0,
    lookDy: 0,
    jump: false,
    sprint: false,
    crouch: false,
    fire: false,
    firePressed: false,
    scope: false,
    reload: false,
    select: null,
    cycle: 0,
  };
}

const axis = (neg: boolean, pos: boolean): -1 | 0 | 1 => (neg === pos ? 0 : neg ? -1 : 1);

export function createInputSystem(targets: InputTargets): InputSystem {
  const cmd = createCommand();
  const held = new Set<KeyAction>();
  let map: InputMap = 'none';
  let fireHeld = false;
  let scopeHeld = false;
  let firePressed = false;
  let jump = false;
  let reload = false;
  let select: 0 | 1 | 2 | null = null;
  let cycle: -1 | 0 | 1 = 0;
  let lookDx = 0;
  let lookDy = 0;

  const inRound = (): boolean => map === 'gameplay' || map === 'look-only';

  function clearEdges(): void {
    firePressed = false;
    jump = false;
    reload = false;
    select = null;
    cycle = 0;
  }

  function clearHeld(): void {
    held.clear();
    fireHeld = false;
    scopeHeld = false;
    clearEdges();
    lookDx = 0;
    lookDy = 0;
  }

  function onKeyDown(e: Event): void {
    const k = e as KeyboardEvent;
    if (!inRound() || isIgnoredKey(k)) return;
    const action = KEY_BINDINGS[k.code];
    if (action === undefined) return;
    if (PREVENT_DEFAULT_CODES.has(k.code)) k.preventDefault();
    if (map !== 'gameplay') return; // look-only drops inputs; they are not queued
    if (!k.repeat) {
      if (action === 'jump') jump = true;
      else if (action === 'reload') reload = true;
      else if (action === 'select-1') select = 0;
      else if (action === 'select-2') select = 1;
      else if (action === 'select-3') select = 2;
    }
    held.add(action);
  }

  function onKeyUp(e: Event): void {
    const k = e as KeyboardEvent;
    const action = KEY_BINDINGS[k.code];
    if (action !== undefined) held.delete(action);
  }

  function onMouseDown(e: Event): void {
    const m = e as MouseEvent;
    if (map !== 'gameplay') return;
    if (m.button === FIRE_BUTTON) {
      if (!fireHeld) firePressed = true;
      fireHeld = true;
    } else if (m.button === SCOPE_BUTTON) {
      scopeHeld = true;
    }
  }

  function onMouseUp(e: Event): void {
    const m = e as MouseEvent;
    if (m.button === FIRE_BUTTON) fireHeld = false;
    else if (m.button === SCOPE_BUTTON) scopeHeld = false;
  }

  function onMouseMove(e: Event): void {
    if (!inRound()) return;
    const m = e as MouseEvent;
    const dx = m.movementX;
    const dy = m.movementY;
    if (Number.isFinite(dx)) lookDx += dx;
    if (Number.isFinite(dy)) lookDy += dy;
  }

  function onWheel(e: Event): void {
    if (!inRound()) return;
    const w = e as WheelEvent;
    w.preventDefault();
    if (map !== 'gameplay' || w.deltaY === 0 || !Number.isFinite(w.deltaY)) return;
    cycle = w.deltaY > 0 ? 1 : -1;
  }

  function onContextMenu(e: Event): void {
    if (inRound()) e.preventDefault();
  }

  return {
    attach(scope) {
      scope.on(targets.keys, 'keydown', onKeyDown);
      scope.on(targets.keys, 'keyup', onKeyUp);
      scope.on(targets.keys, 'blur', clearHeld);
      scope.on(targets.pointer, 'mousedown', onMouseDown);
      scope.on(targets.pointer, 'mouseup', onMouseUp);
      scope.on(targets.pointer, 'mousemove', onMouseMove, { passive: true });
      scope.on(targets.pointer, 'wheel', onWheel, { passive: false });
      scope.on(targets.canvas, 'contextmenu', onContextMenu);
    },
    setMap(next) {
      if (next === map) return;
      map = next;
      if (next !== 'gameplay') clearHeld();
    },
    map: () => map,
    sample(tick) {
      cmd.tick = tick;
      if (map === 'gameplay') {
        cmd.move.x = axis(held.has('left'), held.has('right'));
        cmd.move.z = axis(held.has('forward'), held.has('back'));
        cmd.jump = jump;
        cmd.sprint = held.has('sprint');
        cmd.crouch = held.has('crouch');
        cmd.fire = fireHeld;
        cmd.firePressed = firePressed;
        cmd.scope = scopeHeld;
        cmd.reload = reload;
        cmd.select = select;
        cmd.cycle = cycle;
      } else {
        cmd.move.x = 0;
        cmd.move.z = 0;
        cmd.jump = cmd.sprint = cmd.crouch = false;
        cmd.fire = cmd.firePressed = cmd.scope = cmd.reload = false;
        cmd.select = null;
        cmd.cycle = 0;
      }
      const looking = map === 'gameplay' || map === 'look-only';
      cmd.lookDx = looking ? lookDx : 0;
      cmd.lookDy = looking ? lookDy : 0;
      // One mouse delta is applied once: later samples this frame get 0.
      lookDx = 0;
      lookDy = 0;
      clearEdges();
      return cmd;
    },
    clearHeld,
    held(action) {
      return map === 'gameplay' && held.has(action);
    },
  };
}
