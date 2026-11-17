// @vitest-environment happy-dom
/**
 * Lifecycle and reliability (BR-H-19, RD-H-01..05, SC-H-05,
 * story-play-again-no-reload AC4).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../../src/contracts';
import { createHud, createHudViewModel, toHudViewModel, type Hud } from '../../../../src/ui/hud';
import {
  damageToPlayer,
  kill,
  makeSnapshot,
  makeStats,
  playerHit,
  recordingDiagnostics,
  strictDiagnostics,
} from '../fixtures';

let hud: Hud | null = null;

afterEach(() => {
  hud?.unmount();
  hud = null;
  document.body.replaceChildren();
});

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function transientsVisible(root: HTMLElement): number {
  return root.querySelectorAll(
    '.hud-hit.is-visible, .hud-arc.is-visible, .hud-kill.is-visible, .hud-vignette.is-visible',
  ).length;
}

describe('round boundaries', () => {
  it('reset() clears every marker, arc, row and the vignette (BR-H-19)', () => {
    const root = host();
    hud = createHud({ diagnostics: strictDiagnostics(), reducedMotion: false });
    hud.mount(root);
    hud.feed([playerHit(5, 1), damageToPlayer(5, 2, 1, 0), kill(5, 0, 1)]);
    hud.update(toHudViewModel(makeSnapshot({ tick: 5 }), makeStats()));
    expect(transientsVisible(root)).toBe(4);
    hud.reset();
    expect(transientsVisible(root)).toBe(0);
    hud.update(toHudViewModel(makeSnapshot({ tick: 0 }), makeStats()));
    expect(transientsVisible(root)).toBe(0);
  });

  it('treats a tick regression as a forgotten reset', () => {
    const { diagnostics } = recordingDiagnostics();
    const root = host();
    hud = createHud({ diagnostics, reducedMotion: false });
    hud.mount(root);
    hud.feed([kill(500, 1, 0)]);
    hud.update(toHudViewModel(makeSnapshot({ tick: 500 }), makeStats()));
    expect(transientsVisible(root)).toBe(1);
    hud.update(toHudViewModel(makeSnapshot({ tick: 0 }), makeStats()));
    expect(transientsVisible(root)).toBe(0);
    expect(diagnostics.snapshot()['hud/tick-regression']).toBe(1);
  });

  it('keeps node count and pools constant over 50 rounds (SC-H-05)', () => {
    const root = host();
    hud = createHud({ diagnostics: strictDiagnostics(), reducedMotion: true });
    hud.mount(root);
    const nodes = root.querySelectorAll('*').length;
    const scratch = createHudViewModel();
    for (let round = 0; round < 50; round++) {
      hud.reset();
      for (let t = 0; t < 40; t += 4) {
        hud.feed([damageToPlayer(t, (t % 5) + 1, 1, 1), kill(t, 0, (t % 5) + 1)]);
        hud.update(
          toHudViewModel(makeSnapshot({ tick: t, bots: 20 }), makeStats(), { round }, scratch),
        );
      }
    }
    expect(root.querySelectorAll('*').length).toBe(nodes);
  });

  it('removes the DOM on unmount and leaves nothing behind', () => {
    const root = host();
    hud = createHud({ diagnostics: strictDiagnostics() });
    hud.mount(root);
    hud.unmount();
    expect(root.childNodes).toHaveLength(0);
  });
});

describe('never-throw tick path', () => {
  it('reports update before mount and returns', () => {
    const { diagnostics, reported } = recordingDiagnostics();
    hud = createHud({ diagnostics, reducedMotion: false });
    expect(() => {
      hud?.update(toHudViewModel(makeSnapshot(), makeStats()));
    }).not.toThrow();
    expect(reported).toEqual(['hud/update-before-mount']);
  });

  it('reports malformed input once per code however often it repeats (SD-H-07)', () => {
    const { diagnostics, reported } = recordingDiagnostics();
    hud = createHud({ diagnostics, reducedMotion: false });
    hud.mount(host());
    const scratch = createHudViewModel();
    for (let i = 0; i < 10_000; i++) {
      const snap = makeSnapshot({ tick: i, health: Number.NaN, bots: 22 });
      hud.feed([{ ...damageToPlayer(i, 1, 0, 0), fromDir: null } as unknown as SimEvent]);
      hud.update(toHudViewModel(snap, makeStats(), undefined, scratch));
    }
    expect(reported.sort()).toEqual([
      'hud/bot-overflow',
      'hud/event-fault',
      'hud/non-finite-value',
    ]);
  });

  it('confines a widget fault to that widget (RD-H-03)', () => {
    const { diagnostics, reported } = recordingDiagnostics();
    const root = host();
    hud = createHud({ diagnostics, reducedMotion: false });
    hud.mount(root);
    const vm = toHudViewModel(makeSnapshot({ health: 42 }), makeStats());
    const broken = { ...vm, radar: undefined as never, radarCount: 3 };
    expect(() => {
      hud?.update(broken);
    }).not.toThrow();
    expect(reported).toEqual(['hud/widget-fault']);
    expect(root.querySelector('.hud-health')?.textContent).toBe('42');
  });

  it('ignores unknown event variants', () => {
    hud = createHud({ diagnostics: strictDiagnostics(), reducedMotion: false });
    expect(() => {
      hud?.feed([{ t: 'teleport', tick: 1 } as never]);
    }).not.toThrow();
  });
});
