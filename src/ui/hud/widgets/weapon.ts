/**
 * WeaponPanel and CentrePrompt (Must, story-hud-vitals-ammo). Weapon name,
 * magazine and reserve, the 1-2-3 slot strip, the reload bar and the
 * "R TO RELOAD" / "OUT OF AMMO" prompt.
 */
import { cls, el, prop, textEl } from '../dom/build';
import type { ClassSlot, PropSlot, TextSlot } from '../dom/writer';
import { PROMPT_LABELS } from '../model/labels';
import type { HudWidget } from './widget';

interface WeaponParts {
  name: TextSlot;
  mag: TextSlot;
  reserve: TextSlot;
  slots: [ClassSlot, ClassSlot, ClassSlot];
  reloading: ClassSlot;
  reloadBar: PropSlot;
  switching: ClassSlot;
  empty: ClassSlot;
  prompt: TextSlot;
  promptVisible: ClassSlot;
}

export function createWeaponWidget(): HudWidget {
  let parts: WeaponParts | null = null;

  return {
    name: 'weapon',
    build(layout, doc) {
      const panel = el(doc, layout.bottomRight, 'div', 'hud-plate hud-weapon');
      panel.dataset['testid'] = 'hud-weapon';
      const name = textEl(doc, panel, 'hud-weapon-name');
      const ammo = el(doc, panel, 'div', 'hud-ammo');
      const mag = textEl(doc, ammo, 'hud-num hud-mag');
      el(doc, ammo, 'span', 'hud-sep', '│');
      const reserve = textEl(doc, ammo, 'hud-num hud-reserve');
      const strip = el(doc, panel, 'div', 'hud-slots');
      const s1 = el(doc, strip, 'span', 'hud-slot', '1');
      const s2 = el(doc, strip, 'span', 'hud-slot', '2');
      const s3 = el(doc, strip, 'span', 'hud-slot', '3');
      const reload = el(doc, panel, 'div', 'hud-reload');
      el(doc, reload, 'span', 'hud-tag', 'RELOADING');
      const track = el(doc, reload, 'span', 'hud-bar');
      const fill = el(doc, track, 'span', 'hud-bar-fill');

      const promptEl = el(doc, layout.root, 'div', 'hud-plate hud-prompt');
      promptEl.dataset['testid'] = 'hud-prompt';
      const prompt = textEl(doc, promptEl, 'hud-prompt-text');

      parts = {
        name,
        mag,
        reserve,
        slots: [cls(s1, 'is-active'), cls(s2, 'is-active'), cls(s3, 'is-active')],
        reloading: cls(panel, 'is-reloading'),
        reloadBar: prop(fill, '--fill'),
        switching: cls(panel, 'is-switching'),
        empty: cls(panel, 'is-empty'),
        prompt,
        promptVisible: cls(promptEl, 'is-visible'),
      };
    },
    render(vm, w) {
      if (parts === null) return;
      const wp = vm.weapon;
      w.label(parts.name, wp.label);
      w.int(parts.mag, wp.mag);
      w.int(parts.reserve, wp.reserve);
      w.toggle(parts.slots[0], wp.activeSlot === 0);
      w.toggle(parts.slots[1], wp.activeSlot === 1);
      w.toggle(parts.slots[2], wp.activeSlot === 2);
      w.toggle(parts.reloading, wp.reloading);
      if (wp.reloading) w.fraction(parts.reloadBar, wp.reloadProgress);
      w.toggle(parts.switching, wp.switching);
      w.toggle(parts.empty, wp.mag === 0);
      w.label(parts.prompt, PROMPT_LABELS[wp.prompt]);
      w.toggle(parts.promptVisible, wp.prompt !== 'none');
    },
    clear() {
      // No transient visuals.
    },
  };
}
