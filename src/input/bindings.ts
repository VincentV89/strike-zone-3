/**
 * Control bindings (RA-02, req-control-bindings, SD-AS-09). Keys are matched
 * by KeyboardEvent.code, so the layout does not matter (AZERTY players get
 * positional WASD). Ctrl is not bound. tests/input checks that the
 * `action`/`keys` columns equal CONTROL_BINDINGS on the Controls screen.
 */

export type KeyAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'reload'
  | 'select-1'
  | 'select-2'
  | 'select-3'
  | 'scoreboard';

/** KeyboardEvent.code → action. Frozen; no rebinding (RA-02). */
export const KEY_BINDINGS: Readonly<Record<string, KeyAction>> = Object.freeze({
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouch',
  KeyR: 'reload',
  Digit1: 'select-1',
  Digit2: 'select-2',
  Digit3: 'select-3',
  Tab: 'scoreboard',
});

/** Codes whose browser default is cancelled in gameplay and look-only (SD-AS-09). */
export const PREVENT_DEFAULT_CODES: ReadonlySet<string> = new Set([
  'Tab',
  'Space',
  'Digit1',
  'Digit2',
  'Digit3',
]);

export const FIRE_BUTTON = 0;
export const SCOPE_BUTTON = 2;

/** The player-facing table, in Controls-screen order. */
export const BINDING_TABLE: readonly { readonly action: string; readonly keys: string }[] =
  Object.freeze([
    { action: 'Move', keys: 'W A S D' },
    { action: 'Look', keys: 'Mouse' },
    { action: 'Fire', keys: 'Left mouse button' },
    { action: 'Sniper scope', keys: 'Hold right mouse button' },
    { action: 'Jump', keys: 'Space' },
    { action: 'Sprint', keys: 'Shift' },
    { action: 'Crouch', keys: 'C' },
    { action: 'Reload', keys: 'R' },
    { action: 'Switch weapon', keys: '1 / 2 / 3 or mouse wheel' },
    { action: 'Scoreboard', keys: 'Hold Tab' },
    { action: 'Pause', keys: 'Esc' },
  ]);

/** True for keys input never handles: modifiers held, function keys (SD-AS-09). */
export function isIgnoredKey(
  e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): boolean {
  return e.ctrlKey || e.metaKey || e.altKey || /^F\d{1,2}$/.test(e.code);
}
