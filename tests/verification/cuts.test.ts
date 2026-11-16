// @vitest-environment happy-dom
/**
 * RA-05 cut check (BR-VE-52): for every cut in the register, none of its
 * removed controls exists in any rendered screen. The sweep is the
 * menus-settings fixture set with every feature enabled.
 */
import { describe, expect, it } from 'vitest';
import { CUTS } from '../../scripts/verification/checks.ts';
import { host, recorder } from '../ui/screens/dom/fixtures.ts';
import { SCREENS } from '../ui/screens/dom/sweep.ts';

function renderedTestIds(): Set<string> {
  const ids = new Set<string>();
  for (const { make, vm } of SCREENS) {
    const root = host();
    const screen = make();
    screen.mount(root, vm(), recorder().emit);
    for (const el of root.querySelectorAll('[data-testid]')) {
      const id = el.getAttribute('data-testid');
      if (id !== null) ids.add(id);
    }
    screen.unmount();
    root.remove();
  }
  return ids;
}

describe('cuts (RA-05)', () => {
  const ids = renderedTestIds();

  it('the sweep renders the menu controls it is meant to search', () => {
    for (const id of [
      'main-menu-start',
      'pause-resume',
      'end-of-round-play-again',
      'history-screen',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('no cut control is rendered by any screen', () => {
    const shown = CUTS.flatMap((c) => c.removedControls.filter((id) => ids.has(id)));
    expect(shown).toEqual([]);
  });
});
