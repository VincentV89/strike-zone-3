import type { BotCount, Difficulty, MapId, RoundOutcome } from './round';

/** Schema version 1. A new version adds a union member; it never changes this one. */
export interface HistoryEntry {
  schemaVersion: 1;
  endedAt: string;
  map: MapId;
  bots: BotCount;
  difficulty: Difficulty;
  outcome: RoundOutcome;
  kills: number;
  accuracy: number;
  durationSec: number;
}
