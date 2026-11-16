/**
 * KillFeed widget (Should, story-kill-feed). Four pre-built rows, newest
 * first: "Killer [WEAPON] ◎ HS Victim". Rows involving the player carry the
 * accent edge. The container is hidden while empty.
 */
import { cls, el, prop, textEl } from '../dom/build';
import type { ClassSlot, PropSlot, TextSlot } from '../dom/writer';
import type { HudWidget } from '../widgets/widget';
import { expireKills, killRowOpacity, rowNewestFirst, type KillFeedRing } from './ring';

interface RowParts {
  killer: TextSlot;
  weapon: TextSlot;
  victim: TextSlot;
  headshot: ClassSlot;
  player: ClassSlot;
  visible: ClassSlot;
  opacity: PropSlot;
}

interface FeedParts {
  rows: RowParts[];
  empty: ClassSlot;
}

export function createKillFeedWidget(ring: KillFeedRing, reducedMotion: boolean): HudWidget {
  let parts: FeedParts | null = null;
  return {
    name: 'kill-feed',
    build(layout, doc) {
      const list = el(doc, layout.topRight, 'div', 'hud-killfeed is-empty');
      list.dataset['testid'] = 'hud-kill-feed';
      const rows: RowParts[] = [];
      for (let i = 0; i < ring.rows.length; i++) {
        const row = el(doc, list, 'div', 'hud-plate hud-kill');
        const killer = textEl(doc, row, 'hud-kill-name');
        const weapon = textEl(doc, row, 'hud-kill-weapon');
        el(doc, row, 'span', 'hud-kill-hs', '◎ HS');
        const victim = textEl(doc, row, 'hud-kill-name');
        rows.push({
          killer,
          weapon,
          victim,
          headshot: cls(row, 'has-hs'),
          player: cls(row, 'is-player'),
          visible: cls(row, 'is-visible'),
          opacity: prop(row, '--o'),
        });
      }
      parts = { rows, empty: cls(list, 'is-empty') };
    },
    render(vm, w) {
      if (parts === null) return;
      expireKills(ring, vm.tick);
      let shown = 0;
      for (let i = 0; i < parts.rows.length; i++) {
        const p = parts.rows[i];
        const row = rowNewestFirst(ring, i);
        if (p === undefined) continue;
        const o = row === undefined ? 0 : killRowOpacity(row, vm.tick, reducedMotion);
        w.toggle(p.visible, o > 0);
        if (row === undefined || o <= 0) continue;
        shown++;
        w.label(p.killer, row.killerLabel);
        w.label(p.weapon, row.weaponTag);
        w.label(p.victim, row.victimLabel);
        w.toggle(p.headshot, row.headshot);
        w.toggle(p.player, row.involvesPlayer);
        w.fraction(p.opacity, o);
      }
      w.toggle(parts.empty, shown === 0);
    },
    clear(w) {
      if (parts === null) return;
      for (const p of parts.rows) w.toggle(p.visible, false);
      w.toggle(parts.empty, true);
    },
  };
}
