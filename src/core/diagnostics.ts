/**
 * Diagnostics port (BR-F-11, BR-F-12, SEC-F-18).
 *
 * Tick-path code reports bad runtime data here instead of throwing. `detail`
 * is limited to numbers and booleans so free-form strings (including user
 * input) cannot reach the sink.
 */

export type DiagnosticDetail = Readonly<Record<string, number | boolean>>;
export type DiagnosticSink = (code: string, detail?: DiagnosticDetail) => void;

export interface Diagnostics {
  /** Counts every occurrence; calls the sink only the first time per code. */
  warnOnce(code: string, detail?: DiagnosticDetail): void;
  /** Counts an occurrence without calling the sink. */
  count(code: string): void;
  /** Frozen copy of all counts. */
  snapshot(): Readonly<Record<string, number>>;
}

export function createDiagnostics(sink: DiagnosticSink): Diagnostics {
  const counts = new Map<string, number>();
  const warned = new Set<string>();

  const bump = (code: string): void => {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  };

  return {
    warnOnce(code, detail) {
      bump(code);
      if (warned.has(code)) return;
      warned.add(code);
      sink(code, detail);
    },
    count(code) {
      bump(code);
    },
    snapshot() {
      const out: Record<string, number> = {};
      for (const [code, n] of counts) out[code] = n;
      return Object.freeze(out);
    },
  };
}
