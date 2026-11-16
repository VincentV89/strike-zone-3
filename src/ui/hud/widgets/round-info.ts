/**
 * RoundTimer and EnemyCounter (Must, story-hud-round-info). The timer counts
 * only in live; in countdown it shows the configured duration (BR-H-14). The
 * counter starts at the selected bot count and drops as bots die (BR-H-13).
 */
import { cls, el, textEl } from '../dom/build';
import type { ClassSlot, TextSlot } from '../dom/writer';
import type { HudWidget } from './widget';

interface TimerParts {
  clock: TextSlot;
  round: TextSlot;
  hasRound: ClassSlot;
  lastTen: ClassSlot;
  counting: ClassSlot;
}

export function createTimerWidget(): HudWidget {
  let parts: TimerParts | null = null;

  return {
    name: 'timer',
    build(layout, doc) {
      const panel = el(doc, layout.topCentre, 'div', 'hud-plate hud-timer');
      panel.dataset['testid'] = 'hud-timer';
      const roundLine = el(doc, panel, 'div', 'hud-round');
      el(doc, roundLine, 'span', 'hud-label', 'ROUND');
      const round = textEl(doc, roundLine, 'hud-num');
      const clock = textEl(doc, panel, 'hud-num hud-clock');
      el(doc, panel, 'span', 'hud-tag hud-last-ten-tag', '10 S LEFT');
      parts = {
        clock,
        round,
        hasRound: cls(panel, 'has-round'),
        lastTen: cls(panel, 'is-last-ten'),
        counting: cls(panel, 'is-counting'),
      };
    },
    render(vm, w) {
      if (parts === null) return;
      const t = vm.timer;
      w.label(parts.clock, t.text);
      w.toggle(parts.hasRound, t.round !== null);
      if (t.round !== null) w.int(parts.round, t.round);
      w.toggle(parts.lastTen, t.lastTen);
      w.toggle(parts.counting, t.counting);
    },
    clear() {
      // No transient visuals.
    },
  };
}

interface CounterParts {
  alive: TextSlot;
  total: TextSlot;
  kills: TextSlot;
}

export function createCounterWidget(): HudWidget {
  let parts: CounterParts | null = null;

  return {
    name: 'counter',
    build(layout, doc) {
      const panel = el(doc, layout.topRight, 'div', 'hud-plate hud-counter');
      panel.dataset['testid'] = 'hud-enemies';
      el(doc, panel, 'span', 'hud-label', 'ENEMIES');
      const alive = textEl(doc, panel, 'hud-num hud-alive');
      el(doc, panel, 'span', 'hud-sep', '/');
      const total = textEl(doc, panel, 'hud-num hud-total');
      el(doc, panel, 'span', 'hud-sep', '·');
      el(doc, panel, 'span', 'hud-label', 'KILLS');
      const kills = textEl(doc, panel, 'hud-num hud-kills');
      parts = { alive, total, kills };
    },
    render(vm, w) {
      if (parts === null) return;
      w.int(parts.alive, vm.enemies.alive);
      w.int(parts.total, vm.enemies.total);
      w.int(parts.kills, vm.enemies.kills);
    },
    clear() {
      // No transient visuals.
    },
  };
}
