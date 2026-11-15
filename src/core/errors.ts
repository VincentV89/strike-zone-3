/**
 * Errors and results for the whole code base (BR-F-09, BR-F-10).
 *
 * - Programmer errors throw `StrikeZoneError` with an `area/kebab-name` code.
 * - Expected failures return `Result<T, E>` and never throw.
 */

const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class StrikeZoneError extends Error {
  override readonly name = 'StrikeZoneError';
  readonly code: string;
  readonly detail?: unknown;

  constructor(code: string, message?: string, detail?: unknown) {
    super(message ?? code);
    this.code = CODE_PATTERN.test(code) ? code : 'core/invalid-error-code';
    if (detail !== undefined) this.detail = detail;
  }
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

/** Ends every exhaustive switch over a contracts union (BR-F-13). */
export function assertNever(x: never): never {
  throw new StrikeZoneError('core/unreachable', 'Unreachable case reached', { value: x });
}
