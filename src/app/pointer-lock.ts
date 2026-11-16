/**
 * Real PointerLockPort over `document` (business-logic-model-app-shell §9).
 * Browser-only: excluded from coverage and covered by the manual browser
 * script (manual-pending). The request is made synchronously; the answer is
 * the next pointerlockchange or pointerlockerror, or REFUSED after 2 s.
 */
import { err, ok, type Diagnostics, type Result } from '../core';
import type { PointerLockPort } from './ports';
import type { DisposableScope } from './scope';

export const LOCK_TIMEOUT_MS = 2000;

export function createPointerLockPort(
  doc: Document,
  scope: DisposableScope,
  diag: Diagnostics,
): PointerLockPort {
  const listeners = new Set<(locked: boolean) => void>();
  let settle: ((r: Result<void, 'REFUSED'>) => void) | null = null;
  let cancelTimer: () => void = () => undefined;

  const finish = (r: Result<void, 'REFUSED'>): void => {
    const s = settle;
    settle = null;
    cancelTimer();
    s?.(r);
  };

  scope.on(doc, 'pointerlockchange', () => {
    const locked = doc.pointerLockElement !== null;
    if (locked) finish(ok(undefined));
    for (const cb of [...listeners]) cb(locked);
  });
  scope.on(doc, 'pointerlockerror', () => {
    finish(err('REFUSED'));
  });

  return {
    request(el) {
      if (doc.pointerLockElement === el) return Promise.resolve(ok(undefined));
      return new Promise((resolve) => {
        finish(err('REFUSED')); // a superseded request is refused
        settle = resolve;
        cancelTimer = scope.timeout(() => {
          diag.count('app/lock-timeout');
          finish(err('REFUSED'));
        }, LOCK_TIMEOUT_MS);
        try {
          const maybe = el.requestPointerLock() as unknown;
          if (maybe instanceof Promise) {
            maybe.then(
              () => undefined,
              () => {
                finish(err('REFUSED'));
              },
            );
          }
        } catch {
          finish(err('REFUSED'));
        }
      });
    },
    exit() {
      if (doc.pointerLockElement !== null) doc.exitPointerLock();
    },
    isLocked: () => doc.pointerLockElement !== null,
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
