import type { Diagnostics } from './diagnostics';

export interface EventBuffer<E> {
  /** Appends an event. On overflow the newest event is dropped and counted. */
  push(e: E): void;
  /**
   * Returns all events in push order. The returned array is reused: it is
   * valid only until the next `drain()` call (BR-F-14). Copy anything you keep.
   */
  drain(): readonly E[];
}

export const DEFAULT_EVENT_CAPACITY = 4096;

/** Double-buffered, bounded event buffer (FD-F-11, BR-F-15, BR-F-16). */
export function createEventBuffer<E>(
  capacity: number = DEFAULT_EVENT_CAPACITY,
  diagnostics?: Diagnostics,
): EventBuffer<E> {
  let front: E[] = [];
  let back: E[] = [];

  return {
    push(e) {
      if (front.length >= capacity) {
        diagnostics?.warnOnce('core/event-buffer-overflow', { capacity });
        diagnostics?.count('core/event-buffer-dropped');
        return;
      }
      front.push(e);
    },
    drain() {
      const out = front;
      front = back;
      front.length = 0;
      back = out;
      return out;
    },
  };
}
