import { StrikeZoneError } from './errors';

/** Integer in [0, 2^32 - 1] (BR-F-03). */
export type Seed = number;

/** 0 is the player; bots are 1..N (BR-F-23). */
export type EntityId = number & { __brand: 'EntityId' };

export const PLAYER_ID = 0 as EntityId;

/** Returns the EntityId of bot `n` (1-based). Throws on anything but a positive integer. */
export function botId(n: number): EntityId {
  if (!Number.isInteger(n) || n < 1) {
    throw new StrikeZoneError('core/invalid-bot-id', 'Bot id must be a positive integer', { n });
  }
  return n as EntityId;
}

/** True when `seed` is a valid Seed. */
export function isSeed(seed: unknown): seed is Seed {
  return typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
}
