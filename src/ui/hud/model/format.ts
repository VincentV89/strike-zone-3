/**
 * Pre-built string tables (PD-H-04). Formatting a changed number would be the
 * only remaining source of garbage once unchanged values are skipped, so every
 * value the HUD writes comes from a table built once at module load. Values
 * outside a table fall back to String(n): correct, but they allocate, and they
 * only come from malformed input that the view model already reports.
 */

export const INT_MIN = -1024;
export const INT_MAX = 4096;

const INT_TEXT: readonly string[] = Array.from({ length: INT_MAX - INT_MIN + 1 }, (_, i) =>
  String(i + INT_MIN),
);

/** "0", "0.01", ... "1" in 0.01 steps. */
const OPACITY_TEXT: readonly string[] = Array.from({ length: 101 }, (_, i) => String(i / 100));

/** "0deg" .. "359deg". */
const DEG_TEXT: readonly string[] = Array.from({ length: 360 }, (_, i) => `${i}deg`);

const CLOCK_SLOTS = 3600;
const CLOCK_TEXT: (string | undefined)[] = new Array<string | undefined>(CLOCK_SLOTS);
let clockMisses = 0;

/** Decimal text for an integer. `n` must already be an integer. */
export function intText(n: number): string {
  if (n >= INT_MIN && n <= INT_MAX) return INT_TEXT[n - INT_MIN] ?? String(n);
  return String(n);
}

/** Opacity quantised to 0.01. Input is clamped to [0, 1]. */
export function quantiseOpacity(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 1) return 100;
  return Math.round(v * 100);
}

/** Text for a quantised opacity step 0..100. */
export function opacityText(step: number): string {
  return OPACITY_TEXT[step] ?? '0';
}

/** Whole degrees normalised to 0..359. */
export function normaliseDeg(deg: number): number {
  const d = Math.round(deg) % 360;
  return d < 0 ? d + 360 : d;
}

/** Text for a normalised degree value 0..359. */
export function degText(deg: number): string {
  return DEG_TEXT[deg] ?? '0deg';
}

/** Whole seconds shown for a time left, using the ceiling so 0 appears only at expiry. */
export function clockSeconds(timeLeftSec: number): number {
  const t = Number.isFinite(timeLeftSec) ? timeLeftSec : 0;
  return Math.max(0, Math.ceil(t - 1e-6));
}

function buildClock(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m)}:${r < 10 ? '0' : ''}${String(r)}`;
}

/** m:ss text for a whole-second value, cached per second (PR-H-12). */
export function clockText(seconds: number): string {
  if (seconds >= CLOCK_SLOTS) return buildClock(seconds);
  const cached = CLOCK_TEXT[seconds];
  if (cached !== undefined) return cached;
  clockMisses++;
  const text = buildClock(seconds);
  CLOCK_TEXT[seconds] = text;
  return text;
}

/** m:ss for a time left in seconds (business-logic-model-hud, View-Model Derivation). */
export function formatClock(timeLeftSec: number): string {
  return clockText(clockSeconds(timeLeftSec));
}

/** Number of clock strings built so far. Read by tests (PR-H-12). */
export function clockCacheMisses(): number {
  return clockMisses;
}
