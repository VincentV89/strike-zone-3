/**
 * The loading pipeline's only yield (PD-AS-10): scheduler.yield() when the
 * browser has it, else a setTimeout(0) promise created through the scope.
 */
import type { DisposableScope } from './scope';

/** Local typing for scheduler.yield (not in TS 6.0.3 lib.dom). */
export interface SchedulerLike {
  yield(): Promise<void>;
}

export function createYield(
  scheduler: SchedulerLike | null,
  scope: DisposableScope,
): () => Promise<void> {
  if (scheduler !== null) return () => scheduler.yield();
  return () =>
    new Promise<void>((resolve) => {
      scope.timeout(resolve, 0);
    });
}
