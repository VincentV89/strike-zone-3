/**
 * The Hud (business-logic-model-hud, Public Interface). A read-only DOM and
 * SVG projection of simulation output: it never writes simulation state
 * (BR-H-01). feed and update are tick-path calls and never throw (BR-H-03).
 */
import { PLAYER_ID, StrikeZoneError, type Diagnostics } from '../../core';
import type { SimEvent } from '../../contracts';
import { HUD_CODES } from './diagnostics-codes';
import { el, svg, MAX_HUD_ELEMENTS, type HudLayout } from './dom/build';
import { createDomWriter, type DomWriter } from './dom/writer';
import { clearKills, createKillFeedRing, pushKill } from './kill-feed/ring';
import { createKillFeedWidget } from './kill-feed/widget';
import {
  clearArcs,
  clearHitMarker,
  clearVignette,
  createArcPool,
  createHitMarker,
  createVignette,
  expireArcs,
  recordArc,
  triggerHitMarker,
  triggerVignette,
} from './model/transients';
import { createRadarWidget } from './radar/widget';
import { createScoreboardWidget } from './scoreboard/widget';
import type { HudViewModel } from './view-model';
import {
  createCrosshairWidget,
  createDamageWidget,
  createHitMarkerWidget,
  createScopeWidget,
} from './widgets/centre';
import { createCounterWidget, createTimerWidget } from './widgets/round-info';
import { createVitalsWidget } from './widgets/vitals';
import { createWeaponWidget } from './widgets/weapon';
import type { HudWidget } from './widgets/widget';

export interface HudOptions {
  diagnostics: Diagnostics;
  /** Defaults to the prefers-reduced-motion media query, read once. */
  reducedMotion?: boolean;
}

export interface Hud {
  /** Builds the DOM once. A second mount while mounted throws hud/already-mounted. */
  mount(root: HTMLElement): void;
  /** Tick path: expires transients against vm.tick and writes changed values. Never throws. */
  update(vm: Readonly<HudViewModel>): void;
  /** Tick path: queues hit markers, damage arcs, vignette triggers and kill-feed rows. Never throws. */
  feed(events: readonly SimEvent[]): void;
  /** Hold-Tab state from input.held('scoreboard'). */
  setScoreboard(visible: boolean): void;
  /** Clears every transient. Call on every round (re)start. */
  reset(): void;
  /** Removes the DOM and clears state. Safe to call twice. */
  unmount(): void;
  /** DOM writes since the last mount (profiling and tests). */
  readonly writes: number;
}

function defaultReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function buildLayout(doc: Document, reducedMotion: boolean): HudLayout {
  const root = doc.createElement('div');
  root.className = reducedMotion ? 'hud-root reduced-motion' : 'hud-root';
  root.setAttribute('aria-hidden', 'true');
  root.dataset['testid'] = 'hud-root';
  const topLeft = el(doc, root, 'div', 'hud-corner hud-tl');
  const topCentre = el(doc, root, 'div', 'hud-corner hud-tc');
  const topRight = el(doc, root, 'div', 'hud-corner hud-tr');
  const centre = svg(doc, root, 'svg', 'hud-centre');
  centre.setAttribute('viewBox', '-540 -540 1080 1080');
  const bottomLeft = el(doc, root, 'div', 'hud-corner hud-bl');
  const bottomRight = el(doc, root, 'div', 'hud-corner hud-br');
  return { root, topLeft, topCentre, topRight, centre, bottomLeft, bottomRight };
}

function finiteTick(t: number): boolean {
  return Number.isFinite(t);
}

export function createHud(opts: HudOptions): Hud {
  const { diagnostics } = opts;
  const reducedMotion = opts.reducedMotion ?? defaultReducedMotion();

  // Transient state, created once and cleared in place (PD-H-05).
  const hitMarker = createHitMarker();
  const arcs = createArcPool();
  const vignette = createVignette();
  const killFeed = createKillFeedRing();
  let held = false;
  let batch = 0;
  let lastTick: number | null = null;

  let layout: HudLayout | null = null;
  let writer: DomWriter = createDomWriter();
  let widgets: HudWidget[] = [];

  /** Degradation tiers (RD-H-03): critical widgets render first, Should features last. */
  const createWidgets = (): HudWidget[] => [
    createVitalsWidget(reducedMotion),
    createWeaponWidget(),
    createTimerWidget(),
    createCounterWidget(),
    createCrosshairWidget(),
    createHitMarkerWidget(hitMarker),
    createDamageWidget(arcs, vignette, reducedMotion),
    createScopeWidget(),
    createKillFeedWidget(killFeed, reducedMotion),
    createRadarWidget(),
    createScoreboardWidget(() => held),
  ];

  const clearTransients = (): void => {
    clearHitMarker(hitMarker);
    clearArcs(arcs);
    clearVignette(vignette);
    clearKills(killFeed);
    lastTick = null;
    widgets.forEach((widget, i) => {
      try {
        widget.clear(writer);
      } catch {
        diagnostics.warnOnce(HUD_CODES.widgetFault, { widget: i });
      }
    });
  };

  const handleEvent = (e: SimEvent): void => {
    switch (e.t) {
      case 'damage': {
        if (!finiteTick(e.tick)) {
          diagnostics.warnOnce(HUD_CODES.nonFinite);
          return;
        }
        if (e.source === PLAYER_ID && e.target !== PLAYER_ID) {
          triggerHitMarker(hitMarker, e.headshot ? 'head' : 'body', e.tick, batch);
        } else if (e.target === PLAYER_ID) {
          const amount = Number.isFinite(e.amount) ? e.amount : 0;
          triggerVignette(vignette, amount, e.tick, batch);
          if (!recordArc(arcs, e.source, e.fromDir.x, e.fromDir.z, e.tick)) {
            diagnostics.count(HUD_CODES.damageNoDirection);
          }
        }
        return;
      }
      case 'kill':
        if (!finiteTick(e.tick)) {
          diagnostics.warnOnce(HUD_CODES.nonFinite);
          return;
        }
        pushKill(killFeed, e.killer, e.victim, e.weapon, e.headshot, e.tick);
        return;
      case 'shot':
      case 'impact':
      case 'noise':
      case 'weapon':
      case 'phase':
        return;
      default: {
        // Compile-time exhaustiveness (BR-F-13); unknown variants are ignored at runtime.
        const unknown: never = e;
        return unknown;
      }
    }
  };

  const reportFaults = (vm: Readonly<HudViewModel>): void => {
    const f = vm.faults;
    if (f.nonFinite > 0) diagnostics.warnOnce(HUD_CODES.nonFinite, { count: f.nonFinite });
    if (f.activeSlotMissing) diagnostics.warnOnce(HUD_CODES.activeSlotMissing);
    if (f.botOverflow > 0) diagnostics.warnOnce(HUD_CODES.botOverflow, { count: f.botOverflow });
  };

  return {
    mount(root) {
      if (layout !== null) {
        throw new StrikeZoneError(HUD_CODES.alreadyMounted, 'The HUD is already mounted');
      }
      const doc = root.ownerDocument;
      writer = createDomWriter();
      widgets = createWidgets();
      const built = buildLayout(doc, reducedMotion);
      for (const widget of widgets) widget.build(built, doc);
      const elements = built.root.querySelectorAll('*').length + 1;
      if (elements > MAX_HUD_ELEMENTS) {
        diagnostics.warnOnce(HUD_CODES.nodeBudget, { elements });
      }
      root.appendChild(built.root);
      layout = built;
      lastTick = null;
    },

    update(vm) {
      if (layout === null) {
        diagnostics.warnOnce(HUD_CODES.updateBeforeMount);
        return;
      }
      try {
        reportFaults(vm);
        if (lastTick !== null && vm.tick < lastTick) {
          diagnostics.count(HUD_CODES.tickRegression);
          clearTransients();
        }
        lastTick = vm.tick;
        expireArcs(arcs, vm.tick);
      } catch {
        diagnostics.warnOnce(HUD_CODES.widgetFault, { widget: -1 });
      }
      for (let i = 0; i < widgets.length; i++) {
        try {
          widgets[i]?.render(vm, writer);
        } catch {
          diagnostics.warnOnce(HUD_CODES.widgetFault, { widget: i });
        }
      }
    },

    feed(events) {
      batch++;
      for (const e of events) {
        try {
          handleEvent(e);
        } catch {
          diagnostics.warnOnce(HUD_CODES.eventFault);
        }
      }
    },

    setScoreboard(visible) {
      held = visible;
    },

    reset() {
      clearTransients();
    },

    unmount() {
      if (layout === null) return;
      layout.root.remove();
      layout = null;
      clearHitMarker(hitMarker);
      clearArcs(arcs);
      clearVignette(vignette);
      clearKills(killFeed);
      widgets = [];
      lastTick = null;
    },

    get writes() {
      return writer.writes;
    },
  };
}
