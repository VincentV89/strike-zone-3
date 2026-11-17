/**
 * VitalsPanel (Must, story-hud-vitals-ammo). Health and armor numbers and
 * bars, plus the LOW HEALTH tag and outline below 25, so colour is never the
 * only cue (BR-H-10). The outline pulses at 1 Hz on simulation ticks; reduced
 * motion keeps it static.
 */
import { cls, el, prop, textEl } from '../dom/build';
import type { ClassSlot, PropSlot, TextSlot } from '../dom/writer';
import { LOW_HEALTH_PULSE_TICKS } from '../model/timing';
import type { HudWidget } from './widget';

interface VitalsParts {
  health: TextSlot;
  armor: TextSlot;
  hpBar: PropSlot;
  apBar: PropSlot;
  low: ClassSlot;
  pulse: PropSlot;
}

export function lowHealthPulse(tick: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return 0.8 + 0.2 * Math.cos((2 * Math.PI * tick) / LOW_HEALTH_PULSE_TICKS);
}

export function createVitalsWidget(reducedMotion: boolean): HudWidget {
  let parts: VitalsParts | null = null;

  return {
    name: 'vitals',
    build(layout, doc) {
      const panel = el(doc, layout.bottomLeft, 'div', 'hud-plate hud-vitals');
      panel.dataset['testid'] = 'hud-vitals';
      const hpRow = el(doc, panel, 'div', 'hud-vitals-row is-health');
      el(doc, hpRow, 'span', 'hud-glyph', '✚');
      const health = textEl(doc, hpRow, 'hud-num hud-health');
      const hpTrack = el(doc, hpRow, 'span', 'hud-bar');
      const hpFill = el(doc, hpTrack, 'span', 'hud-bar-fill');
      el(doc, hpRow, 'span', 'hud-tag hud-low-tag', 'LOW HEALTH');
      const apRow = el(doc, panel, 'div', 'hud-vitals-row is-armor');
      el(doc, apRow, 'span', 'hud-glyph', '⛉');
      const armor = textEl(doc, apRow, 'hud-num hud-armor');
      const apTrack = el(doc, apRow, 'span', 'hud-bar');
      const apFill = el(doc, apTrack, 'span', 'hud-bar-fill');
      parts = {
        health,
        armor,
        hpBar: prop(hpFill, '--fill'),
        apBar: prop(apFill, '--fill'),
        low: cls(panel, 'is-low'),
        pulse: prop(panel, '--pulse'),
      };
    },
    render(vm, w) {
      if (parts === null) return;
      const v = vm.vitals;
      w.int(parts.health, v.health);
      w.int(parts.armor, v.armor);
      w.fraction(parts.hpBar, v.health / 100);
      w.fraction(parts.apBar, v.armor / 100);
      w.toggle(parts.low, v.low);
      w.fraction(parts.pulse, v.low ? lowHealthPulse(vm.tick, reducedMotion) : 1);
    },
    clear() {
      // No transient visuals.
    },
  };
}
