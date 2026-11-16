/**
 * SIM_TUNING (domain-entities-game-simulation). Agent dimensions are not
 * copied here; they come from MAP_RULES (game-simulation -> map-data is R).
 */
import { freezeNested } from './freeze';

export const SIM_TUNING = freezeNested({
  /** 3 s count plus 0.5 s GO (req-round-lifecycle). */
  countdownTicks: 210,
  /** Radar awareness runs at 10 Hz. */
  awarenessInterval: 6,
  awarenessRange: 30,
  /** Fixed half-angle of the player's awareness cone (60 degrees). */
  awarenessHalfFov: Math.PI / 3,
  /** Chest and head heights above the bot's feet for the awareness rays. */
  awarenessChest: 1.2,
  awarenessHead: 1.7,
  seenHoldTicks: 30,
  heardHoldTicks: 120,
  maxRadarContacts: 20,
  /** Sense-window length in sense intervals (BR-GS-43). */
  senseWindowIntervals: 2,
  senseWindowCapacity: 64,
  strideWalk: 2.0,
  strideRun: 2.4,
  footstepRadiusWalk: 10,
  footstepRadiusRun: 18,
  footstepRadiusCrouch: 4,
  landRadius: 12,
  /** BotView.moving threshold, horizontal m/s. */
  movingSpeed: 0.5,
  /** Heights above a candidate spawn that must all be hidden from the player's eye (BR-GS-21). */
  spawnProbeHeights: [0.3, 1.0, 1.6, 1.8] as const,
  /** Player eye height used for spawn hiding (BR-GS-21). */
  spawnEyeHeight: 1.6,
  minSpawns: 21,
  /** The largest BotCount; every player spawn needs this many candidates (BR-GS-13). */
  maxBots: 20,
  maxDurationSec: 3600,
  defaultSliceMs: 8,
});
