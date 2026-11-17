/**
 * contracts: shared cross-component vocabulary (types only, BR-F-24).
 * Changes are additive only (Contracts Change Rule, BR-F-26).
 * Core types (Seed, EntityId, Vec3) are imported from src/core, not re-exported here.
 */
export { BOT_COUNTS } from './round';
export type {
  MapId,
  WeaponId,
  BotCount,
  Difficulty,
  RoundConfig,
  RoundPhase,
  RoundOutcome,
} from './round';
export type { InputCommand } from './input';
export type { LoadoutView, PlayerView, BotView, RadarContact, SimSnapshot } from './views';
export type { SimEvent, LocomotionStatus } from './events';
export type { AvoidZone, BotIntent } from './ai';
export type { UiIntent, Settings, SettingsIntent } from './ui';
export type { HistoryEntry } from './history';
export type { SeamTarget } from './seams';
