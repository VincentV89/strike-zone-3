import { vec3 } from '../../core';
import type { PerceptionMemory } from './types';

/** A fresh, empty memory. Created once per bot per round. */
export function createPerceptionMemory(): PerceptionMemory {
  return {
    visible: false,
    lastSeenPos: null,
    lastSeenTick: -1,
    firstSeenTick: null,
    suspectedPos: null,
    suspectedTick: -1,
    threatDir: null,
    underFireTick: -1,
    lastSenseTick: -1,
    seenStore: vec3(),
    suspectStore: vec3(),
    threatStore: vec3(),
  };
}
