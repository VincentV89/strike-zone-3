/**
 * Centre-screen feedback (Must): Crosshair, HitMarker, DamageRing,
 * DamageVignette and ScopeOverlay. The centre SVG's viewBox is centred on
 * 0,0 in 1080p reference pixels, so geometry scales with viewport height.
 */
import { cls, el, prop, svg, svgCircle, svgLine } from '../dom/build';
import type { ClassSlot, PropSlot } from '../dom/writer';
import { relativeBearing, toDegrees } from '../model/bearing';
import {
  arcOpacity,
  clearHitMarker,
  visibleHitMarker,
  vignetteOpacity,
  type DamageArc,
  type HitMarkerState,
  type VignetteState,
} from '../model/transients';
import type { HudWidget } from './widget';

// ---------------------------------------------------------------- crosshair

interface CrosshairParts {
  gap: PropSlot;
  hidden: ClassSlot;
}

export function createCrosshairWidget(): HudWidget {
  let parts: CrosshairParts | null = null;
  return {
    name: 'crosshair',
    build(layout, doc) {
      const g = svg(doc, layout.centre, 'g', 'hud-crosshair hidden');
      g.dataset['testid'] = 'hud-crosshair';
      svgLine(doc, g, 0, -4, 0, -14, 'hud-xh-arm is-up');
      svgLine(doc, g, 0, 4, 0, 14, 'hud-xh-arm is-down');
      svgLine(doc, g, -4, 0, -14, 0, 'hud-xh-arm is-left');
      svgLine(doc, g, 4, 0, 14, 0, 'hud-xh-arm is-right');
      parts = { gap: prop(g, '--gap'), hidden: cls(g, 'hidden') };
    },
    render(vm, w) {
      if (parts === null) return;
      w.toggle(parts.hidden, !vm.crosshair.visible);
      w.px(parts.gap, vm.crosshair.gapPx);
    },
    clear() {
      // No transient visuals.
    },
  };
}

// ---------------------------------------------------------------- hit marker

interface HitParts {
  body: ClassSlot;
  head: ClassSlot;
}

export function createHitMarkerWidget(marker: HitMarkerState): HudWidget {
  let parts: HitParts | null = null;
  return {
    name: 'hit-marker',
    build(layout, doc) {
      const body = svg(doc, layout.centre, 'g', 'hud-hit is-body');
      body.dataset['testid'] = 'hud-hit-body';
      svgLine(doc, body, -12, -12, -5, -5);
      svgLine(doc, body, 12, -12, 5, -5);
      svgLine(doc, body, -12, 12, -5, 5);
      svgLine(doc, body, 12, 12, 5, 5);
      const head = svg(doc, layout.centre, 'g', 'hud-hit is-head');
      head.dataset['testid'] = 'hud-hit-head';
      svgLine(doc, head, -18, -18, -6, -6);
      svgLine(doc, head, 18, -18, 6, -6);
      svgLine(doc, head, -18, 18, -6, 6);
      svgLine(doc, head, 18, 18, 6, 6);
      svgLine(doc, head, 0, -30, 0, -24);
      svgLine(doc, head, 0, 30, 0, 24);
      svgLine(doc, head, -30, 0, -24, 0);
      svgLine(doc, head, 30, 0, 24, 0);
      parts = { body: cls(body, 'is-visible'), head: cls(head, 'is-visible') };
    },
    render(vm, w) {
      if (parts === null) return;
      if (!vm.vitals.alive) clearHitMarker(marker);
      const kind = visibleHitMarker(marker, vm.tick);
      w.toggle(parts.body, kind === 'body');
      w.toggle(parts.head, kind === 'head');
    },
    clear(w) {
      if (parts === null) return;
      w.toggle(parts.body, false);
      w.toggle(parts.head, false);
    },
  };
}

// ---------------------------------------------------------------- damage

/** 50 degree arc on a radius-120 ring, centred straight up. */
const ARC_PATH = 'M -50.71 -108.76 A 120 120 0 0 1 50.71 -108.76';

interface ArcParts {
  rot: PropSlot;
  opacity: PropSlot;
  visible: ClassSlot;
}

interface DamageParts {
  arcs: ArcParts[];
  vignette: PropSlot;
  vignetteOn: ClassSlot;
}

export function createDamageWidget(
  arcs: readonly DamageArc[],
  vignette: VignetteState,
  reducedMotion: boolean,
): HudWidget {
  let parts: DamageParts | null = null;
  return {
    name: 'damage',
    build(layout, doc) {
      const ring = svg(doc, layout.centre, 'g', 'hud-damage-ring');
      ring.dataset['testid'] = 'hud-damage-ring';
      const arcParts: ArcParts[] = [];
      for (let i = 0; i < arcs.length; i++) {
        const path = svg(doc, ring, 'path', 'hud-arc');
        path.setAttribute('d', ARC_PATH);
        arcParts.push({
          rot: prop(path, '--arc-rot'),
          opacity: prop(path, '--o'),
          visible: cls(path, 'is-visible'),
        });
      }
      const vig = el(doc, layout.root, 'div', 'hud-vignette');
      vig.dataset['testid'] = 'hud-vignette';
      parts = { arcs: arcParts, vignette: prop(vig, '--v'), vignetteOn: cls(vig, 'is-visible') };
    },
    render(vm, w) {
      if (parts === null) return;
      for (let i = 0; i < parts.arcs.length; i++) {
        const arc = arcs[i];
        const p = parts.arcs[i];
        if (arc === undefined || p === undefined) continue;
        const o = arcOpacity(arc, vm.tick);
        w.toggle(p.visible, o > 0);
        if (o <= 0) continue;
        w.deg(p.rot, toDegrees(relativeBearing(arc.dirX, arc.dirZ, vm.view.yaw)));
        w.fraction(p.opacity, o);
      }
      const v = vignetteOpacity(vignette, vm.tick, reducedMotion);
      w.toggle(parts.vignetteOn, v > 0);
      w.fraction(parts.vignette, v);
    },
    clear(w) {
      if (parts === null) return;
      for (const p of parts.arcs) w.toggle(p.visible, false);
      w.toggle(parts.vignetteOn, false);
      w.fraction(parts.vignette, 0);
    },
  };
}

// ---------------------------------------------------------------- scope

export function createScopeWidget(): HudWidget {
  let visible: ClassSlot | null = null;
  return {
    name: 'scope',
    build(layout, doc) {
      const overlay = el(doc, layout.root, 'div', 'hud-scope');
      overlay.dataset['testid'] = 'hud-scope';
      const reticle = svg(doc, overlay, 'svg', 'hud-scope-reticle');
      reticle.setAttribute('viewBox', '-540 -540 1080 1080');
      svgCircle(doc, reticle, 420, 'hud-scope-ring');
      svgLine(doc, reticle, -420, 0, -12, 0);
      svgLine(doc, reticle, 12, 0, 420, 0);
      svgLine(doc, reticle, 0, -420, 0, -12);
      svgLine(doc, reticle, 0, 12, 0, 420);
      visible = cls(overlay, 'is-visible');
    },
    render(vm, w) {
      if (visible === null) return;
      w.toggle(visible, vm.scoped);
    },
    clear() {
      // No transient visuals.
    },
  };
}
