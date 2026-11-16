/**
 * bot-brain public surface (src/ai/brain). Other components import this file
 * only. Brain reads perception and weapons as types only (component table:
 * bot-brain -> bot-perception T, weapons T), so it cannot call sense,
 * stepWeapon or executeShot (SD-AI-06, SD-AI-11).
 */
export { createBotBrain, BRAIN_TUNING } from './fsm';
export { createBotAim, stepBotAim, AIM_TUNING } from './aim';
export { createCoverRegistry, COVER_MAX_LOS, COVER_RADIUS_M, MAX_COVER_POINTS } from './cover';
export {
  collectPatrolNodes,
  createBrainScratch,
  RETREAT_PROBES,
  SEARCH_MAX_VISITED,
} from './search';
export { createAiScheduler, MAX_BOTS, type AiSchedulerOptions } from './scheduler';
export { DIFFICULTY_PROFILES, getDifficultyProfile } from './difficulty';
export { BRAIN_CODES, type BrainCode } from './codes';
export type {
  AiScheduler,
  BotAimContext,
  BotAimState,
  BotBrain,
  BotSelf,
  BotStateName,
  BrainContext,
  BrainScratch,
  CoverPointId,
  CoverPointLike,
  CoverRegistry,
  DifficultyProfile,
} from './types';
