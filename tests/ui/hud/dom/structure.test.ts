// @vitest-environment happy-dom
/**
 * Mount and structure (SD-H-05, SD-H-08, PD-H-05, BR-H-10). DOM nodes are
 * built only through the hud's own mount; no fixture markup, no URLs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { StrikeZoneError } from '../../../../src/core';
import { createHud, toHudViewModel, type Hud } from '../../../../src/ui/hud';
import { makeSnapshot, makeStats, strictDiagnostics } from '../fixtures';

const FOCUSABLE =
  'a, button, input, select, textarea, iframe, object, embed, [tabindex], [contenteditable]';

let hud: Hud | null = null;

function mounted(reducedMotion = false): { hud: Hud; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hud = createHud({ diagnostics: strictDiagnostics(), reducedMotion });
  hud.mount(host);
  return { hud, host };
}

afterEach(() => {
  hud?.unmount();
  hud = null;
  document.body.replaceChildren();
});

describe('hud mount', () => {
  it('builds an inert, aria-hidden root with no focusable element (SD-H-05)', () => {
    const { host } = mounted();
    const root = host.querySelector('.hud-root');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelectorAll(FOCUSABLE)).toHaveLength(0);
  });

  it('creates at most 250 elements, all in mount (PD-H-05)', () => {
    const { host } = mounted();
    const count = host.querySelectorAll('*').length;
    expect(count).toBeLessThanOrEqual(250);
    hud?.update(toHudViewModel(makeSnapshot({ bots: 20 }), makeStats()));
    expect(host.querySelectorAll('*').length).toBe(count);
  });

  it('adds nothing to window (SD-H-08)', () => {
    const before = Object.keys(window).sort();
    mounted();
    expect(Object.keys(window).sort()).toEqual(before);
  });

  it('throws hud/already-mounted on a second mount and allows a mount after unmount', () => {
    const { hud: h, host } = mounted();
    expect(() => {
      h.mount(host);
    }).toThrow(StrikeZoneError);
    h.unmount();
    h.unmount();
    expect(host.querySelector('.hud-root')).toBeNull();
    h.mount(host);
    expect(host.querySelectorAll('.hud-root')).toHaveLength(1);
  });

  it('exposes stable data-testid hooks for e2e tests', () => {
    const { host } = mounted();
    for (const id of [
      'hud-root',
      'hud-vitals',
      'hud-weapon',
      'hud-timer',
      'hud-enemies',
      'hud-crosshair',
      'hud-damage-ring',
      'hud-kill-feed',
      'hud-radar',
      'hud-scoreboard',
      'hud-scope',
    ]) {
      expect(host.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
  });

  it('keeps the crosshair group at the centre SVG origin (story-hud-vitals-ammo AC3)', () => {
    const { host } = mounted();
    const centre = host.querySelector('svg.hud-centre');
    expect(centre?.getAttribute('viewBox')).toBe('-540 -540 1080 1080');
    const crosshair = host.querySelector('[data-testid="hud-crosshair"]');
    expect(crosshair?.parentElement ?? crosshair?.parentNode).toBe(centre);
    expect(crosshair?.getAttribute('transform')).toBeNull();
  });

  it('pairs every status colour with a glyph or word (BR-H-10)', () => {
    const { host } = mounted();
    expect(host.querySelector('.hud-low-tag')?.textContent).toBe('LOW HEALTH');
    expect(host.querySelector('.hud-kill-hs')?.textContent).toBe('◎ HS');
    expect(host.querySelector('.hud-last-ten-tag')?.textContent).toBe('10 S LEFT');
    expect(host.querySelectorAll('.hud-hit.is-head line').length).toBeGreaterThan(
      host.querySelectorAll('.hud-hit.is-body line').length,
    );
  });

  it('marks the root for reduced motion when asked', () => {
    const { host } = mounted(true);
    expect(host.querySelector('.hud-root')?.classList.contains('reduced-motion')).toBe(true);
  });
});
