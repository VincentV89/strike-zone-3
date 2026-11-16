/**
 * bot-perception public surface (src/ai/perception). Other components import
 * this file only. sense() is the only reader of live player data (SD-AI-01).
 */
export { createPerceptionMemory } from './memory';
export { MAX_SENSE_RAYS, sense } from './sense';
export { PERCEPTION_TUNING, targetPointsFor } from './tuning';
export { PERCEPTION_CODES, type PerceptionCode } from './codes';
export type {
  DamageEvent,
  NoiseEvent,
  PerceptionMemory,
  PerceptionProfile,
  SenseInput,
} from './types';
