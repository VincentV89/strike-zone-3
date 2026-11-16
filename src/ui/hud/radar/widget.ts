/**
 * Radar widget (Should, story-radar). A disc with a fixed upward view cone and
 * 20 pre-built blips. Seen contacts are filled dots and heard contacts are
 * hollow rings, so the kinds differ in shape as well as colour. It draws only
 * vm.radar, which radar/project.ts builds from snap.radar (SD-H-04).
 */
import { cls, prop, svg, svgCircle } from '../dom/build';
import type { ClassSlot, PropSlot } from '../dom/writer';
import type { HudWidget } from '../widgets/widget';

/** Disc radius in the radar's own viewBox units. */
export const RADAR_DISC_R = 90;

interface BlipParts {
  x: PropSlot;
  y: PropSlot;
  opacity: PropSlot;
  heard: ClassSlot;
  visible: ClassSlot;
}

export function createRadarWidget(): HudWidget {
  let blips: BlipParts[] | null = null;
  return {
    name: 'radar',
    build(layout, doc) {
      const disc = svg(doc, layout.topLeft, 'svg', 'hud-plate hud-radar');
      disc.dataset['testid'] = 'hud-radar';
      disc.setAttribute('viewBox', '-100 -100 200 200');
      svgCircle(doc, disc, RADAR_DISC_R, 'hud-radar-disc');
      svgCircle(doc, disc, RADAR_DISC_R / 2, 'hud-radar-range');
      const cone = svg(doc, disc, 'path', 'hud-radar-cone');
      cone.setAttribute('d', 'M 0 0 L -52 -73 A 90 90 0 0 1 52 -73 Z');
      svgCircle(doc, disc, 4, 'hud-radar-self');
      const list: BlipParts[] = [];
      for (let i = 0; i < 20; i++) {
        const blip = svgCircle(doc, disc, 4.5, 'hud-blip');
        list.push({
          x: prop(blip, '--blip-x'),
          y: prop(blip, '--blip-y'),
          opacity: prop(blip, '--o'),
          heard: cls(blip, 'is-heard'),
          visible: cls(blip, 'is-visible'),
        });
      }
      blips = list;
    },
    render(vm, w) {
      if (blips === null) return;
      for (let i = 0; i < blips.length; i++) {
        const p = blips[i];
        if (p === undefined) continue;
        const b = i < vm.radarCount ? vm.radar[i] : undefined;
        w.toggle(p.visible, b !== undefined);
        if (b === undefined) continue;
        w.px(p.x, b.x * RADAR_DISC_R);
        w.px(p.y, b.y * RADAR_DISC_R);
        w.fraction(p.opacity, b.opacity);
        w.toggle(p.heard, b.heard);
      }
    },
    clear(w) {
      if (blips === null) return;
      for (const p of blips) w.toggle(p.visible, false);
    },
  };
}
