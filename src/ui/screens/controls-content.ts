/**
 * The Controls screen table (RA-02, BR-MS-24). Crouch is C only and there is
 * no Ctrl row. tests/ui/screens/controls-readme.test.ts asserts the README
 * "Controls" table equals this list.
 */
export interface ControlBinding {
  readonly action: string;
  readonly keys: string;
}

export const CONTROL_BINDINGS: readonly ControlBinding[] = Object.freeze([
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
