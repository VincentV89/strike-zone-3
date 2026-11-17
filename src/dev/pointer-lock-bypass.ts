/**
 * Pointer-lock bypass for headless e2e (SD-05, test builds only). Every
 * request is granted at once; simulateLoss() plays the browser's Esc exit.
 * Structurally a PointerLockPort (test-seams has no edge to app-shell).
 */
import { ok, type Result } from '../core';
import { BYPASS_MARKER } from './markers';

export interface BypassLockPort {
  readonly marker: string;
  request(el: HTMLElement): Promise<Result<void, 'REFUSED'>>;
  exit(): void;
  isLocked(): boolean;
  onChange(cb: (locked: boolean) => void): () => void;
  /** Test hook: the lock is released as if the player pressed Esc. */
  simulateLoss(): void;
}

export function createPointerLockBypass(): BypassLockPort {
  const listeners = new Set<(locked: boolean) => void>();
  let locked = false;
  const notify = (): void => {
    for (const cb of [...listeners]) cb(locked);
  };
  return {
    marker: BYPASS_MARKER,
    request() {
      if (!locked) {
        locked = true;
        notify();
      }
      return Promise.resolve(ok(undefined));
    },
    exit() {
      if (!locked) return;
      locked = false;
      notify();
    },
    isLocked: () => locked,
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    simulateLoss() {
      this.exit();
    },
  };
}
