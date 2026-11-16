// @vitest-environment happy-dom
/**
 * Rendering and write budgets (PR-H-05..07, BR-H-06) plus the visible
 * acceptance criteria of the hud stories.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../../src/contracts';
import {
  createHud,
  createHudViewModel,
  toHudViewModel,
  type Hud,
  type HudStats,
} from '../../../../src/ui/hud';
import {
  contact,
  damageToPlayer,
  kill,
  makeSnapshot,
  makeStats,
  playerHit,
  strictDiagnostics,
  type SnapshotOptions,
} from '../fixtures';

let hud: Hud | null = null;
let host: HTMLElement;
const scratch = createHudViewModel();

function setup(): Hud {
  host = document.createElement('div');
  document.body.appendChild(host);
  hud = createHud({ diagnostics: strictDiagnostics(), reducedMotion: false });
  hud.mount(host);
  return hud;
}

function frame(
  h: Hud,
  o: SnapshotOptions,
  stats: HudStats = makeStats(),
  events: SimEvent[] = [],
): void {
  h.feed(events);
  h.update(toHudViewModel(makeSnapshot(o), stats, { round: 1 }, scratch));
}

function q(sel: string): Element {
  const found = host.querySelector(sel);
  if (found === null) throw new Error(`missing ${sel}`);
  return found;
}

function text(sel: string): string {
  return q(sel).textContent;
}

function has(sel: string, cls: string): boolean {
  return q(sel).classList.contains(cls);
}

afterEach(() => {
  hud?.unmount();
  hud = null;
  document.body.replaceChildren();
});

describe('write budgets', () => {
  it('makes zero DOM writes for a second identical update (PR-H-05)', () => {
    const h = setup();
    const o: SnapshotOptions = { tick: 10, bots: 20, radar: [contact(1, 3, -8)] };
    frame(h, o);
    const before = h.writes;
    const observer = new MutationObserver(() => undefined);
    observer.observe(host, {
      subtree: true,
      attributes: true,
      characterData: true,
      childList: true,
    });
    frame(h, o);
    expect(h.writes - before).toBe(0);
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });

  it('keeps a typical frame at 8 writes or fewer (PR-H-06)', () => {
    const h = setup();
    frame(h, { tick: 100, timeLeftSec: 120.5, radar: [contact(1, 3, -8)] }, makeStats(), [
      damageToPlayer(100, 1, 1, 0),
    ]);
    const before = h.writes;
    frame(h, { tick: 101, timeLeftSec: 119.9, radar: [contact(1, 3.2, -8)] });
    const delta = h.writes - before;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(8);
  });

  it('keeps the worst steady frame at 80 writes or fewer (PR-H-07)', () => {
    const h = setup();
    const radar = (shift: number, age: number) =>
      Array.from({ length: 20 }, (_, i) => contact(i + 1, i - 10 + shift, -4 - i, 'heard', age));
    const hits = [1, 2, 3, 4].map((s) => damageToPlayer(200, s, s - 2.5, -1));
    frame(
      h,
      { tick: 200, health: 80, armor: 40, mag: 20, spread: 0.01, radar: radar(0, 0) },
      makeStats(),
      hits,
    );
    const before = h.writes;
    frame(
      h,
      {
        tick: 202,
        yaw: 0.3,
        health: 62,
        armor: 30,
        mag: 19,
        spread: 0.03,
        bots: 5,
        botsAlive: 4,
        timeLeftSec: 170,
        radar: radar(1.5, 2),
      },
      makeStats({ kills: 1 }),
    );
    const delta = h.writes - before;
    expect(delta).toBeGreaterThan(40);
    expect(delta).toBeLessThanOrEqual(80);
  });
});

describe('story-hud-vitals-ammo', () => {
  it('shows new health, armor, weapon and ammo in the same update (AC1)', () => {
    const h = setup();
    frame(h, { health: 100, armor: 50, active: 'rifle', mag: 30, reserve: 90 });
    expect(text('.hud-health')).toBe('100');
    frame(h, { tick: 1, health: 73, armor: 12, active: 'pistol', mag: 9, reserve: 36 });
    expect(text('.hud-health')).toBe('73');
    expect(text('.hud-armor')).toBe('12');
    expect(text('.hud-weapon-name')).toBe('PISTOL');
    expect(text('.hud-mag')).toBe('9');
    expect(text('.hud-reserve')).toBe('36');
    expect(host.querySelectorAll('.hud-slot.is-active')).toHaveLength(1);
    expect(host.querySelectorAll('.hud-slot')[1]?.classList.contains('is-active')).toBe(true);
  });

  it('adds the LOW HEALTH cue at 24 and not at 25 (AC2)', () => {
    const h = setup();
    frame(h, { health: 25 });
    expect(has('.hud-vitals', 'is-low')).toBe(false);
    frame(h, { tick: 1, health: 24 });
    expect(has('.hud-vitals', 'is-low')).toBe(true);
  });

  it('shows the reload bar while reloading and the empty-magazine prompt otherwise', () => {
    const h = setup();
    frame(h, { mag: 0, reserve: 60 });
    expect(text('.hud-prompt-text')).toBe('R TO RELOAD');
    expect(has('.hud-prompt', 'is-visible')).toBe(true);
    frame(h, { tick: 1, mag: 0, reserve: 60, reloading: true, reloadProgress: 0.5 });
    expect(has('.hud-weapon', 'is-reloading')).toBe(true);
    expect(has('.hud-prompt', 'is-visible')).toBe(false);
    frame(h, { tick: 2, mag: 0, reserve: 0 });
    expect(text('.hud-prompt-text')).toBe('OUT OF AMMO');
  });

  it('hides the crosshair while scoped and shows the scope overlay', () => {
    const h = setup();
    frame(h, {});
    expect(has('.hud-crosshair', 'hidden')).toBe(false);
    frame(h, { tick: 1, active: 'sniper', scoped: true });
    expect(has('.hud-crosshair', 'hidden')).toBe(true);
    expect(has('.hud-scope', 'is-visible')).toBe(true);
  });
});

describe('story-hud-round-info', () => {
  it('shows ENEMIES n / n and KILLS 0, then the kill in the same update (AC1, AC2)', () => {
    const h = setup();
    frame(h, { bots: 8 });
    expect([text('.hud-alive'), text('.hud-total'), text('.hud-kills')]).toEqual(['8', '8', '0']);
    frame(h, { tick: 1, bots: 8, botsAlive: 7 }, makeStats({ kills: 1 }));
    expect([text('.hud-alive'), text('.hud-total'), text('.hud-kills')]).toEqual(['7', '8', '1']);
  });

  it('shows the configured duration in countdown and the last-ten cue in live (AC3)', () => {
    const h = setup();
    frame(h, { phase: 'countdown', timeLeftSec: 180 });
    expect(text('.hud-clock')).toBe('3:00');
    expect(has('.hud-timer', 'is-counting')).toBe(false);
    expect(has('.hud-timer', 'has-round')).toBe(true);
    frame(h, { tick: 1, phase: 'live', timeLeftSec: 8.2 });
    expect(text('.hud-clock')).toBe('0:09');
    expect(has('.hud-timer', 'is-last-ten')).toBe(true);
  });
});

describe('hit markers and damage direction', () => {
  it('shows a body marker for 9 ticks and a distinct headshot marker', () => {
    const h = setup();
    frame(h, { tick: 50 }, makeStats(), [playerHit(50, 2)]);
    expect(has('.hud-hit.is-body', 'is-visible')).toBe(true);
    frame(h, { tick: 59 });
    expect(has('.hud-hit.is-body', 'is-visible')).toBe(false);
    frame(h, { tick: 60 }, makeStats(), [playerHit(60, 2, true), playerHit(60, 3)]);
    expect(has('.hud-hit.is-head', 'is-visible')).toBe(true);
    expect(has('.hud-hit.is-body', 'is-visible')).toBe(false);
  });

  it('points an arc left for a hit from the left and re-orients it as the player turns', () => {
    const h = setup();
    frame(h, { tick: 10, yaw: 0 }, makeStats(), [damageToPlayer(10, 4, -1, 0)]);
    const arc = host.querySelector<SVGElement>('.hud-arc.is-visible');
    expect(arc).not.toBeNull();
    expect(arc?.style.getPropertyValue('--arc-rot')).toBe('270deg');
    frame(h, { tick: 11, yaw: Math.PI / 2 });
    expect(arc?.style.getPropertyValue('--arc-rot')).toBe('0deg');
    expect(has('.hud-vignette', 'is-visible')).toBe(true);
    frame(h, { tick: 70, yaw: Math.PI / 2 });
    expect(host.querySelectorAll('.hud-arc.is-visible')).toHaveLength(0);
  });
});

describe('story-kill-feed', () => {
  it('adds a row with killer, weapon and HS marker, and removes it after 5 s', () => {
    const h = setup();
    expect(has('.hud-killfeed', 'is-empty')).toBe(true);
    frame(h, { tick: 30 }, makeStats(), [kill(30, 0, 3, 'sniper', true)]);
    const row = q('.hud-kill.is-visible');
    expect(row.textContent).toBe('YOU[SNIPER]◎ HSBOT 03');
    expect(row.classList.contains('has-hs')).toBe(true);
    expect(row.classList.contains('is-player')).toBe(true);
    expect(has('.hud-killfeed', 'is-empty')).toBe(false);
    frame(h, { tick: 330 });
    expect(host.querySelectorAll('.hud-kill.is-visible')).toHaveLength(0);
    expect(has('.hud-killfeed', 'is-empty')).toBe(true);
  });
});

describe('story-radar', () => {
  it('draws a heard contact as a ring and hides unused blips', () => {
    const h = setup();
    frame(h, { radar: [contact(1, 0, -15, 'heard', 60), contact(2, 6, 0)] });
    const blips = host.querySelectorAll('.hud-blip.is-visible');
    expect(blips).toHaveLength(2);
    expect(host.querySelectorAll('.hud-blip.is-heard.is-visible')).toHaveLength(1);
    expect(host.querySelectorAll('.hud-blip')).toHaveLength(20);
  });
});

describe('story-scoreboard-overlay', () => {
  it('shows while held in live, hides on release and stays hidden when ended (AC1, AC2)', () => {
    const h = setup();
    h.setScoreboard(true);
    frame(h, { bots: 3, botsAlive: 1 }, makeStats({ kills: 2, shotsFired: 4, shotsHit: 3 }));
    expect(has('.hud-scoreboard', 'is-visible')).toBe(true);
    const rows = host.querySelectorAll('.hud-sb-bot.is-visible');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toBe('BOT 01● ALIVE');
    expect(rows[2]?.textContent).toBe('BOT 03✕ DEAD');
    expect(q('.hud-sb-player').textContent).toContain('ACC75%');
    h.setScoreboard(false);
    frame(h, { tick: 1, bots: 3, botsAlive: 1 });
    expect(has('.hud-scoreboard', 'is-visible')).toBe(false);
    h.setScoreboard(true);
    frame(h, { tick: 2, phase: 'ended' });
    expect(has('.hud-scoreboard', 'is-visible')).toBe(false);
  });

  it('uses two columns above 10 bots', () => {
    const h = setup();
    h.setScoreboard(true);
    frame(h, { bots: 15 });
    expect(has('.hud-sb-bots', 'two-col')).toBe(true);
  });
});
