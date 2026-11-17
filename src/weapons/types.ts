/**
 * weapons types (domain-entities-player-combat). They live here, not in
 * src/contracts (TS-PC-07); other components import them from index.ts.
 */
import type { EntityId, Vec3 } from '../core';
import type { WeaponId } from '../contracts';

export type FireMode = 'auto' | 'semi';
export type SlotIndex = 0 | 1 | 2;

export interface SpreadProfile {
  /** Half-angle (rad) of the cone for the first shot. */
  readonly base: number;
  readonly perShot: number;
  readonly max: number;
  readonly recoverPerSec: number;
  readonly moveMult: number;
  readonly airMult: number;
  readonly crouchMult: number;
}

export interface RecoilProfile {
  readonly pitchPerShot: number;
  readonly yawJitter: number;
  readonly maxPitch: number;
  readonly recoverPerSec: number;
}

export interface ScopeProfile {
  /** Camera zoom on tan(vFov/2), read by presentation-3d. */
  readonly zoom: number;
  readonly spreadMult: number;
}

/** Frozen rule data for one weapon. Seconds are converted once to 60 Hz ticks. */
export interface WeaponProfile {
  readonly id: WeaponId;
  readonly mode: FireMode;
  readonly magSize: number;
  /** Player starting reserve. */
  readonly reserve: number;
  /** Body damage. */
  readonly damage: number;
  readonly headMult: number;
  readonly cooldownSec: number;
  readonly cooldownTicks: number;
  readonly reloadSec: number;
  readonly reloadTicks: number;
  readonly switchSec: number;
  readonly switchTicks: number;
  readonly recoveryDelaySec: number;
  readonly recoveryDelayTicks: number;
  /** Hard range cap (m); no falloff. */
  readonly range: number;
  readonly noiseRadius: number;
  readonly spread: SpreadProfile;
  readonly recoil: RecoilProfile;
  readonly scope: ScopeProfile | null;
}

/** One slot. Invariants: 0 <= mag <= magSize, reserve >= 0. */
export interface WeaponState {
  readonly profile: WeaponProfile;
  mag: number;
  reserve: number;
  nextFireTick: number;
  /** -1 when not reloading. */
  reloadStartTick: number;
  reloadEndTick: number;
  bloom: number;
  kickPitch: number;
  kickYaw: number;
  /** -1 before the first shot. */
  lastFireTick: number;
  triggerLatched: boolean;
}

/** Aggregate root, one per actor. Slots are always rifle, pistol, sniper. */
export interface Loadout {
  readonly slots: readonly [WeaponState, WeaponState, WeaponState];
  active: SlotIndex;
  switchingUntil: number;
  scoped: boolean;
  readonly infiniteReserve: boolean;
  /** Effective spread from the last step (LoadoutView.spread). */
  lastSpread: number;
}

export interface WeaponTrigger {
  fire: boolean;
  firePressed: boolean;
  reload: boolean;
  scope: boolean;
  select: SlotIndex | null;
  cycle: -1 | 0 | 1;
}

/** Aim plus the posture spread needs. `origin` is the eye position. */
export interface AimContext {
  origin: Vec3;
  yaw: number;
  pitch: number;
  moving: boolean;
  grounded: boolean;
  crouched: boolean;
}

/** Reused per actor. `dir` is unit length. */
export interface FireRequest {
  origin: Vec3;
  dir: Vec3;
  weapon: WeaponId;
  slot: SlotIndex;
  shooter: EntityId;
  tick: number;
}
