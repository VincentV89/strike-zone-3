/**
 * Enum lists used to validate stored history entries (SD-MS-04). Each list is
 * checked against its contracts type in both directions, so adding a member
 * to MapId, Difficulty or RoundOutcome fails tsc until the list is updated.
 */
import {
  BOT_COUNTS,
  type BotCount,
  type Difficulty,
  type MapId,
  type RoundOutcome,
} from '../contracts';

export const MAP_IDS = ['desert-compound', 'industrial-warehouse'] as const;
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export const OUTCOMES = ['victory', 'defeat', 'time-expired'] as const;

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Compile-time exhaustiveness: every element must be `true`. */
export const KNOWN_VALUES_EXACT: readonly [
  Equals<(typeof MAP_IDS)[number], MapId>,
  Equals<(typeof DIFFICULTIES)[number], Difficulty>,
  Equals<(typeof OUTCOMES)[number], RoundOutcome>,
] = [true, true, true];

export function isMapId(x: unknown): x is MapId {
  return MAP_IDS.some((v) => v === x);
}
export function isDifficulty(x: unknown): x is Difficulty {
  return DIFFICULTIES.some((v) => v === x);
}
export function isOutcome(x: unknown): x is RoundOutcome {
  return OUTCOMES.some((v) => v === x);
}
export function isBotCount(x: unknown): x is BotCount {
  return BOT_COUNTS.some((v) => v === x);
}
