/**
 * ScoreboardOverlay (Should, story-scoreboard-overlay). Shown while Tab is
 * held and the round has not ended. Render is skipped entirely while hidden
 * (PD-H-07); the node cache keeps the last values for the next show.
 */
import { cls, el, textEl } from '../dom/build';
import type { ClassSlot, TextSlot } from '../dom/writer';
import { ALIVE_LABEL, DEAD_LABEL, entityLabel } from '../model/labels';
import type { HudWidget } from '../widgets/widget';

interface BotRowParts {
  name: TextSlot;
  status: TextSlot;
  dead: ClassSlot;
  visible: ClassSlot;
}

interface BoardParts {
  visible: ClassSlot;
  hasRound: ClassSlot;
  round: TextSlot;
  clock: TextSlot;
  alive: TextSlot;
  total: TextSlot;
  kills: TextSlot;
  deaths: TextSlot;
  headshots: TextSlot;
  accuracy: TextSlot;
  twoColumns: ClassSlot;
  bots: BotRowParts[];
}

function stat(doc: Document, parent: Element, label: string, suffix?: string): TextSlot {
  const cell = el(doc, parent, 'div', 'hud-sb-stat');
  el(doc, cell, 'span', 'hud-label', label);
  const value = textEl(doc, cell, 'hud-num');
  if (suffix !== undefined) el(doc, cell, 'span', 'hud-num', suffix);
  return value;
}

export function createScoreboardWidget(isHeld: () => boolean): HudWidget {
  let parts: BoardParts | null = null;
  return {
    name: 'scoreboard',
    build(layout, doc) {
      const panel = el(doc, layout.root, 'div', 'hud-plate hud-scoreboard');
      panel.dataset['testid'] = 'hud-scoreboard';
      const header = el(doc, panel, 'div', 'hud-sb-header');
      el(doc, header, 'span', 'hud-label hud-sb-round-label', 'ROUND');
      const round = textEl(doc, header, 'hud-num hud-sb-round');
      const clock = textEl(doc, header, 'hud-num');
      el(doc, header, 'span', 'hud-label', 'ENEMIES');
      const alive = textEl(doc, header, 'hud-num');
      el(doc, header, 'span', 'hud-sep', '/');
      const total = textEl(doc, header, 'hud-num');
      const player = el(doc, panel, 'div', 'hud-sb-player');
      const kills = stat(doc, player, 'K');
      const deaths = stat(doc, player, 'D');
      const headshots = stat(doc, player, 'HS');
      const accuracy = stat(doc, player, 'ACC', '%');
      const list = el(doc, panel, 'div', 'hud-sb-bots');
      const bots: BotRowParts[] = [];
      for (let i = 0; i < 20; i++) {
        const row = el(doc, list, 'div', 'hud-sb-bot');
        bots.push({
          name: textEl(doc, row, 'hud-sb-bot-name'),
          status: textEl(doc, row, 'hud-sb-bot-status'),
          dead: cls(row, 'is-dead'),
          visible: cls(row, 'is-visible'),
        });
      }
      parts = {
        visible: cls(panel, 'is-visible'),
        hasRound: cls(panel, 'has-round'),
        round,
        clock,
        alive,
        total,
        kills,
        deaths,
        headshots,
        accuracy,
        twoColumns: cls(list, 'two-col'),
        bots,
      };
    },
    render(vm, w) {
      if (parts === null) return;
      const show = isHeld() && vm.phase !== 'ended';
      w.toggle(parts.visible, show);
      if (!show) return;
      const sb = vm.scoreboard;
      w.toggle(parts.hasRound, sb.round !== null);
      if (sb.round !== null) w.int(parts.round, sb.round);
      w.label(parts.clock, sb.timeText);
      w.int(parts.alive, sb.alive);
      w.int(parts.total, sb.total);
      w.int(parts.kills, sb.kills);
      w.int(parts.deaths, sb.deaths);
      w.int(parts.headshots, sb.headshots);
      w.int(parts.accuracy, sb.accuracyPct);
      w.toggle(parts.twoColumns, sb.twoColumns);
      for (let i = 0; i < parts.bots.length; i++) {
        const p = parts.bots[i];
        if (p === undefined) continue;
        const bot = i < sb.botCount ? sb.bots[i] : undefined;
        w.toggle(p.visible, bot !== undefined);
        if (bot === undefined) continue;
        w.label(p.name, entityLabel(bot.id));
        w.label(p.status, bot.alive ? ALIVE_LABEL : DEAD_LABEL);
        w.toggle(p.dead, !bot.alive);
      }
    },
    clear() {
      // Visibility follows the held flag, which reset() leaves unchanged.
    },
  };
}
