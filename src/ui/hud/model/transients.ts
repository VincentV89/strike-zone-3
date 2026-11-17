/**
 * Transient feedback models (business-logic-model-hud, Transient Feedback
 * Algorithms). Each is a fixed record or pool created once, written in place
 * by Hud.feed and read by the widgets. Nothing here touches the DOM.
 */
import {
  BODY_MARKER_TICKS,
  DAMAGE_ARC_TICKS,
  HEAD_MARKER_TICKS,
  MAX_ARCS,
  VIGNETTE_COOLDOWN_TICKS,
  VIGNETTE_FADE_TICKS,
} from './timing';

// ---------------------------------------------------------------- hit marker

export type HitKind = 'body' | 'head';

export interface HitMarkerState {
  active: boolean;
  kind: HitKind;
  startTick: number;
  batch: number;
}

export function createHitMarker(): HitMarkerState {
  return { active: false, kind: 'body', startTick: 0, batch: -1 };
}

/** A confirmed player hit. Within one feed batch a headshot wins over a body hit. */
export function triggerHitMarker(
  m: HitMarkerState,
  kind: HitKind,
  tick: number,
  batch: number,
): void {
  if (m.active && m.batch === batch && m.kind === 'head' && kind === 'body') return;
  m.active = true;
  m.kind = kind;
  m.startTick = tick;
  m.batch = batch;
}

/** Which marker shows at `tick`, or null. */
export function visibleHitMarker(m: Readonly<HitMarkerState>, tick: number): HitKind | null {
  if (!m.active) return null;
  const age = tick - m.startTick;
  const life = m.kind === 'head' ? HEAD_MARKER_TICKS : BODY_MARKER_TICKS;
  return age >= 0 && age < life ? m.kind : null;
}

export function clearHitMarker(m: HitMarkerState): void {
  m.active = false;
  m.batch = -1;
}

// ---------------------------------------------------------------- damage arcs

export interface DamageArc {
  active: boolean;
  sourceId: number;
  dirX: number;
  dirZ: number;
  startTick: number;
}

export function createArcPool(): DamageArc[] {
  return Array.from({ length: MAX_ARCS }, () => ({
    active: false,
    sourceId: -1,
    dirX: 0,
    dirZ: 0,
    startTick: 0,
  }));
}

/**
 * Records a hit on the player. `dirX`/`dirZ` point from the player toward the
 * attacker. Returns false when the XZ direction is too short to draw.
 */
export function recordArc(
  pool: DamageArc[],
  sourceId: number,
  dirX: number,
  dirZ: number,
  tick: number,
): boolean {
  const len = Math.hypot(dirX, dirZ);
  if (!(len >= 1e-6)) return false;
  let slot: DamageArc | undefined;
  for (const arc of pool) {
    if (arc.active && arc.sourceId === sourceId) {
      slot = arc;
      break;
    }
  }
  if (slot === undefined) {
    for (const arc of pool) {
      if (!arc.active) {
        slot = arc;
        break;
      }
    }
  }
  if (slot === undefined) {
    for (const arc of pool) {
      if (slot === undefined || arc.startTick < slot.startTick) slot = arc;
    }
  }
  if (slot === undefined) return false;
  slot.active = true;
  slot.sourceId = sourceId;
  slot.dirX = dirX / len;
  slot.dirZ = dirZ / len;
  slot.startTick = tick;
  return true;
}

/** Opacity of an arc at `tick`: 1 at the hit, 0 after 60 ticks. Future hits show 0. */
export function arcOpacity(arc: Readonly<DamageArc>, tick: number): number {
  if (!arc.active) return 0;
  const age = tick - arc.startTick;
  if (age < 0) return 0;
  return Math.max(0, 1 - age / DAMAGE_ARC_TICKS);
}

/** Frees arcs whose fade has finished. */
export function expireArcs(pool: DamageArc[], tick: number): void {
  for (const arc of pool) {
    if (arc.active && tick - arc.startTick >= DAMAGE_ARC_TICKS) arc.active = false;
  }
}

export function clearArcs(pool: DamageArc[]): void {
  for (const arc of pool) {
    arc.active = false;
    arc.sourceId = -1;
  }
}

// ---------------------------------------------------------------- vignette

export interface VignetteState {
  active: boolean;
  peak: number;
  startTick: number;
  lastTriggerTick: number;
  /** Feed batch that started the current rise; later events in it merge. */
  batch: number;
  batchAmount: number;
  rises: number;
}

export function createVignette(): VignetteState {
  return {
    active: false,
    peak: 0,
    startTick: 0,
    lastTriggerTick: Number.NEGATIVE_INFINITY,
    batch: -1,
    batchAmount: 0,
    rises: 0,
  };
}

function peakFor(amount: number): number {
  return Math.min(0.6, 0.2 + 0.01 * Math.max(0, amount));
}

/**
 * Damage to the player (WCAG 2.3.1 flash safety, BR-H-11). A new rise is
 * accepted only 20 ticks after the previous one. Damage in the same feed batch
 * as an accepted rise merges into it (amounts summed). Other damage inside the
 * cooldown leaves the vignette unchanged.
 */
export function triggerVignette(
  v: VignetteState,
  amount: number,
  tick: number,
  batch: number,
): void {
  if (v.active && v.batch === batch) {
    v.batchAmount += amount;
    v.peak = peakFor(v.batchAmount);
    return;
  }
  if (tick - v.lastTriggerTick < VIGNETTE_COOLDOWN_TICKS) return;
  v.active = true;
  v.batch = batch;
  v.batchAmount = amount;
  v.peak = peakFor(amount);
  v.startTick = tick;
  v.lastTriggerTick = tick;
  v.rises++;
}

/** Vignette opacity at `tick`. Reduced motion keeps a static tint for the same life. */
export function vignetteOpacity(
  v: Readonly<VignetteState>,
  tick: number,
  reducedMotion: boolean,
): number {
  if (!v.active) return 0;
  const age = tick - v.startTick;
  if (age < 0 || age >= VIGNETTE_FADE_TICKS) return 0;
  return reducedMotion ? v.peak : v.peak * (1 - age / VIGNETTE_FADE_TICKS);
}

export function clearVignette(v: VignetteState): void {
  v.active = false;
  v.peak = 0;
  v.batch = -1;
  v.batchAmount = 0;
  v.lastTriggerTick = Number.NEGATIVE_INFINITY;
}
