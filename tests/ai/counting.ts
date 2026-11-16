/**
 * Counting wrappers (SD-AI-03, SD-AI-12): they forward to the real world and
 * path service and count calls, so tests can assert the per-call caps.
 */
import type { EntityId } from '../../src/core';
import type { PathRequest, PathService, PathTicket } from '../../src/nav';
import type { CollisionWorld } from '../../src/physics';

export interface Counts {
  lineOfSight: number;
  moveCapsule: number;
  sweepClear: number;
  capsuleFits: number;
  requests: number;
}

export interface CountingWorld extends CollisionWorld {
  readonly counts: Counts;
}

export function countingWorld(w: CollisionWorld, counts: Counts = zeroCounts()): CountingWorld {
  return {
    counts,
    moveCapsule: (...a) => {
      counts.moveCapsule++;
      return w.moveCapsule(...a);
    },
    raycast: (...a) => w.raycast(...a),
    lineOfSight: (a, b) => {
      counts.lineOfSight++;
      return w.lineOfSight(a, b);
    },
    capsuleFits: (p, c) => {
      counts.capsuleFits++;
      return w.capsuleFits(p, c);
    },
    sweepClear: (...a) => {
      counts.sweepClear++;
      return w.sweepClear(...a);
    },
    separate: (...a) => w.separate(...a),
    get bounds() {
      return w.bounds;
    },
    get shapeCount() {
      return w.shapeCount;
    },
  };
}

export function countingPaths(p: PathService, counts: Counts): PathService {
  return {
    request: (id: EntityId, req: PathRequest): PathTicket => {
      counts.requests++;
      return p.request(id, req);
    },
    poll: (t) => p.poll(t),
    cancel: (t) => {
      p.cancel(t);
    },
    tick: () => {
      p.tick();
    },
    get stats() {
      return p.stats;
    },
  };
}

export function zeroCounts(): Counts {
  return { lineOfSight: 0, moveCapsule: 0, sweepClear: 0, capsuleFits: 0, requests: 0 };
}
