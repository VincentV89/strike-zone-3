/** Diagnostics codes navigation reports, as a closed tuple (SD-CN-10). */
import type { Diagnostics } from '../core';

export const NAV_DIAGNOSTIC_CODES = [
  'nav/non-finite-input',
  'nav/bad-node-id',
  'nav/bad-avoid',
  'nav/queue-full',
] as const;

export type NavDiagnosticCode = (typeof NAV_DIAGNOSTIC_CODES)[number];

const EMPTY_COUNTS: Readonly<Record<string, number>> = Object.freeze({});

/** Used when no Diagnostics port is given (tests and tools). */
export const NOOP_DIAGNOSTICS: Diagnostics = Object.freeze({
  warnOnce(): void {
    // no sink
  },
  count(): void {
    // no sink
  },
  snapshot(): Readonly<Record<string, number>> {
    return EMPTY_COUNTS;
  },
});
