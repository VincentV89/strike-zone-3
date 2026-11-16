/**
 * Test seams (ADR-012, SD-AS-04, story-test-seams-inert). installTestSeams
 * defines `window.__strikezone` as a frozen, non-writable, non-configurable
 * object. It is reachable only from the guarded import in main.ts, so it is
 * absent from production builds (check:seams proves it).
 */
import type { SeamTarget, SimSnapshot } from '../contracts';
import { SEAM_GLOBAL } from './markers';

/** What the seams need from the app (structural; no app-shell edge). */
export interface SeamHost extends SeamTarget {
  diagnostics(): Readonly<Record<string, number>>;
}

export interface SeamApi {
  state(): string;
  snapshot(): SimSnapshot | null;
  setSeed(seed: number): void;
  fastForward(ticks: number): void;
  diagnostics(): Readonly<Record<string, number>>;
  /** Constant for the page; a changed marker means the page reloaded. */
  readonly marker: string;
  /** Present only when the bypass is active. */
  simulateLockLoss?: () => void;
}

export interface SeamOptions {
  readonly marker: string;
  readonly simulateLockLoss?: () => void;
}

export function installTestSeams(app: SeamHost, win: object, opts: SeamOptions): SeamApi {
  const api: SeamApi = Object.freeze({
    state: () => app.state(),
    snapshot: () => app.snapshot(),
    setSeed: (seed: number) => {
      app.setSeed(seed);
    },
    fastForward: (ticks: number) => {
      app.fastForward(ticks);
    },
    diagnostics: () => app.diagnostics(),
    marker: opts.marker,
    ...(opts.simulateLockLoss === undefined ? {} : { simulateLockLoss: opts.simulateLockLoss }),
  });
  Object.defineProperty(win, SEAM_GLOBAL, {
    value: api,
    writable: false,
    configurable: false,
    enumerable: false,
  });
  return api;
}
