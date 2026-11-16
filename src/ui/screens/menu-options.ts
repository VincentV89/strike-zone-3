/**
 * Map and difficulty choices offered by S1 (BR-MS-22). Typed against the
 * contracts unions with a two-way check so a new member fails tsc.
 */
import type { Difficulty, MapId } from '../../contracts';

export const MAP_IDS_FOR_MENU = [
  'desert-compound',
  'industrial-warehouse',
] as const satisfies readonly MapId[];
export const DIFFICULTIES_FOR_MENU = [
  'easy',
  'normal',
  'hard',
] as const satisfies readonly Difficulty[];

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const MENU_OPTIONS_EXACT: readonly [
  Equals<(typeof MAP_IDS_FOR_MENU)[number], MapId>,
  Equals<(typeof DIFFICULTIES_FOR_MENU)[number], Difficulty>,
] = [true, true];
