/**
 * player-controller public surface (src/sim/player). Other components import
 * this file only; guard, step and tuning are private (SD-PC-04).
 */
export { PLAYER_TUNING } from './tuning';
export { createPlayerState, createPlayerStepResult, eyePosition, stepPlayer } from './step';
export type { FootstepKind, MovementTuning, PlayerState, PlayerStepResult, Stance } from './types';
