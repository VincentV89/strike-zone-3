/**
 * Staggered AI scheduler (BR-AI-10, BR-AI-11). A bot is due when
 * (tick + id) % I === 0 with I = 60 / hz, so 20 bots at decide 10 Hz give at
 * most 4 decides per tick. wake(id) forces one sense and one decide.
 */
import { StrikeZoneError, TICK_HZ, type EntityId } from '../../core';
import type { AiScheduler } from './types';

export const MAX_BOTS = 20;

export interface AiSchedulerOptions {
  readonly senseHz?: number;
  readonly decideHz?: number;
}

function validHz(hz: number): boolean {
  return Number.isInteger(hz) && hz >= 1 && hz <= TICK_HZ && TICK_HZ % hz === 0;
}

/** @throws StrikeZoneError('ai/bad-config') on bad rates or bot count. */
export function createAiScheduler(botCount: number, opts: AiSchedulerOptions = {}): AiScheduler {
  const senseHz = opts.senseHz ?? 20;
  const decideHz = opts.decideHz ?? 10;
  if (!Number.isInteger(botCount) || botCount < 0 || botCount > MAX_BOTS) {
    throw new StrikeZoneError('ai/bad-config', 'Bot count must be an integer in 0..20');
  }
  if (!validHz(senseHz) || !validHz(decideHz) || decideHz > senseHz) {
    throw new StrikeZoneError('ai/bad-config', 'Rates must divide 60 and decideHz <= senseHz');
  }
  const senseInterval = TICK_HZ / senseHz;
  const decideInterval = TICK_HZ / decideHz;
  const wakeSense = new Uint8Array(MAX_BOTS + 1);
  const wakeDecide = new Uint8Array(MAX_BOTS + 1);
  const ok = (id: number, tick: number): boolean =>
    Number.isInteger(id) && id >= 1 && id <= botCount && Number.isInteger(tick) && tick >= 0;
  return {
    senseInterval,
    decideInterval,
    shouldSense(id: EntityId, tick: number): boolean {
      if (!ok(id, tick)) return false;
      if (wakeSense[id] === 1) {
        wakeSense[id] = 0;
        return true;
      }
      return (tick + id) % senseInterval === 0;
    },
    shouldDecide(id: EntityId, tick: number): boolean {
      if (!ok(id, tick)) return false;
      if (wakeDecide[id] === 1) {
        wakeDecide[id] = 0;
        return true;
      }
      return (tick + id) % decideInterval === 0;
    },
    wake(id: EntityId): void {
      if (!Number.isInteger(id) || id < 1 || id > botCount) return;
      wakeSense[id] = 1;
      wakeDecide[id] = 1;
    },
  };
}
