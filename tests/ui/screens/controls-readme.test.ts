/** story-controls-about AC3: the README Controls table equals CONTROL_BINDINGS. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTROL_BINDINGS } from '../../../src/ui/screens/controls-content';

function readmeControls(): { action: string; keys: string }[] {
  const md = readFileSync('README.md', 'utf8');
  const section = /## Controls\n([\s\S]*?)(\n## |$)/.exec(md)?.[1] ?? '';
  return section
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .slice(2) // header and separator
    .map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim()),
    )
    .map(([action = '', keys = '']) => ({ action, keys }));
}

describe('Controls (BR-MS-24)', () => {
  it('README table equals CONTROL_BINDINGS', () => {
    expect(readmeControls()).toEqual(CONTROL_BINDINGS.map((b) => ({ ...b })));
  });

  it('crouch is C only and there is no Ctrl binding', () => {
    expect(CONTROL_BINDINGS.find((b) => b.action === 'Crouch')?.keys).toBe('C');
    expect(JSON.stringify(CONTROL_BINDINGS)).not.toMatch(/ctrl/i);
  });
});
