/** player-controller types (domain-entities-player-combat). */
import type { Vec3 } from '../../core';

export type Stance = 'stand' | 'crouch';
export type FootstepKind = 'walk' | 'sprint' | 'crouch';

/** Aggregate root of player movement; lives for one round. */
export interface PlayerState {
  /** Feet position, owned by the state (never aliased to map data). */
  pos: Vec3;
  vel: Vec3;
  /** Wrapped to (-PI, PI]. Yaw 0 faces -Z, positive yaw turns left. */
  yaw: number;
  /** Clamped to +-pitchLimit. Positive pitch looks up. */
  pitch: number;
  stance: Stance;
  eyeHeight: number;
  grounded: boolean;
  /** Jump edge latch, so holding Space jumps once. */
  jumpHeld: boolean;
  strideAccum: number;
  /** Last grounded position, for the out-of-world guard. */
  lastSafePos: Vec3;
}

/** Reused per call through `out`. */
export interface PlayerStepResult {
  footstep: FootstepKind | null;
  landed: boolean;
  /** Downward speed at touchdown (m/s), 0 when not landed. */
  landSpeed: number;
}

export interface MovementTuning {
  readonly radius: number;
  readonly standHeight: number;
  readonly crouchHeight: number;
  readonly standEye: number;
  readonly crouchEye: number;
  readonly stepHeight: number;
  readonly walkSpeed: number;
  readonly sprintSpeed: number;
  readonly crouchSpeed: number;
  readonly scopedSpeedMult: number;
  readonly groundAccel: number;
  readonly groundDecel: number;
  readonly airAccel: number;
  readonly gravity: number;
  readonly jumpSpeed: number;
  readonly terminalSpeed: number;
  readonly eyeSpeed: number;
  readonly lookRadPerCount: number;
  readonly pitchLimit: number;
  readonly strideWalk: number;
  readonly strideSprint: number;
  readonly strideCrouch: number;
  readonly footstepMinSpeed: number;
  readonly outOfWorldMargin: number;
}
