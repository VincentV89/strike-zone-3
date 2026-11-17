/**
 * bot-locomotion public surface (src/ai/locomotion). Other components import
 * this file only. Locomotion reads no player data (SD-AI-01).
 */
export { createBotMotion, releaseMotion, setGoal, stepBotMotion } from './motion';
export { addSeparation } from './separation';
export { LOCOMOTION_TUNING, MAX_PATH_POINTS } from './tuning';
export { LOCOMOTION_CODES, type LocomotionCode } from './codes';
export type { BotMotionState, LocoContext, NeighbourView } from './types';
