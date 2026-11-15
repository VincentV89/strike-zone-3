import type { EntityId } from '../core/types';
import type { Vec3 } from '../core/math/vec3';
import type { RoundOutcome, RoundPhase, WeaponId } from './round';

export interface LoadoutView {
  active: WeaponId;
  slots: readonly { id: WeaponId; mag: number; magSize: number; reserve: number }[];
  reloading: boolean;
  reloadProgress: number;
  switching: boolean;
  spread: number;
  scoped: boolean;
}

export interface PlayerView {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  eyeHeight: number;
  stance: 'stand' | 'crouch';
  grounded: boolean;
  health: number;
  armor: number;
  alive: boolean;
  loadout: LoadoutView;
  viewKick: { pitch: number; yaw: number };
  lastFireTick: number;
}

/** No AI state: presentation must not leak it into the HUD (BR-F-28). */
export interface BotView {
  id: EntityId;
  pos: Vec3;
  yaw: number;
  pitch: number;
  alive: boolean;
  deathTick: number | null;
  crouch: boolean;
  moving: boolean;
  lastFireTick: number;
  weapon: WeaponId;
}

export interface RadarContact {
  id: EntityId;
  pos: Vec3;
  kind: 'seen' | 'heard';
  ageTicks: number;
}

export interface SimSnapshot {
  tick: number;
  phase: RoundPhase;
  countdownLeftSec: number;
  timeLeftSec: number;
  outcome: RoundOutcome | null;
  player: PlayerView;
  bots: readonly BotView[];
  botsAlive: number;
  radar: readonly RadarContact[];
}
