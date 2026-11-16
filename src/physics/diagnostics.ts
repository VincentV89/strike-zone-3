/** Diagnostics codes collision-world reports, as a closed tuple (SD-CN-10). */
import type { Diagnostics } from '../core';

export const PHYSICS_DIAGNOSTIC_CODES = [
  'physics/non-finite-input',
  'physics/stuck-in-geometry',
] as const;

export type PhysicsDiagnosticCode = (typeof PHYSICS_DIAGNOSTIC_CODES)[number];

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
