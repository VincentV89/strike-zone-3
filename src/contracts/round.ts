import type { Seed } from '../core/types';

export type MapId = 'desert-compound' | 'industrial-warehouse';
export type WeaponId = 'rifle' | 'pistol' | 'sniper';

/** The only selectable CPU enemy counts (req-match-setup-bot-count). */
export const BOT_COUNTS = [1, 2, 3, 5, 8, 10, 15, 20] as const;
/** Derived from BOT_COUNTS so there is one source of truth (FD-F-05). */
export type BotCount = (typeof BOT_COUNTS)[number];

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface RoundConfig {
  map: MapId;
  bots: BotCount;
  difficulty: Difficulty;
  durationSec: number;
  seed: Seed;
}

export type RoundPhase = 'countdown' | 'live' | 'ended';
export type RoundOutcome = 'victory' | 'defeat' | 'time-expired';
