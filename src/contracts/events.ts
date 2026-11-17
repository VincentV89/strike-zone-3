import type { EntityId } from '../core/types';
import type { Vec3 } from '../core/math/vec3';
import type { RoundOutcome, RoundPhase, WeaponId } from './round';

/** Discriminated on `t`. Every switch over it ends in assertNever (BR-F-13). */
export type SimEvent =
  | {
      t: 'shot';
      tick: number;
      shooter: EntityId;
      weapon: WeaponId;
      origin: Vec3;
      end: Vec3;
      hit: EntityId | null;
      headshot: boolean;
    }
  | { t: 'impact'; tick: number; point: Vec3; normal: Vec3 }
  | {
      t: 'damage';
      tick: number;
      target: EntityId;
      source: EntityId;
      amount: number;
      armorLoss: number;
      fromDir: Vec3;
      headshot: boolean;
    }
  | {
      t: 'kill';
      tick: number;
      victim: EntityId;
      killer: EntityId;
      weapon: WeaponId;
      headshot: boolean;
    }
  | {
      t: 'noise';
      tick: number;
      source: EntityId;
      kind: 'gunfire' | 'footstep' | 'land';
      pos: Vec3;
      radius: number;
    }
  | {
      t: 'weapon';
      tick: number;
      actor: EntityId;
      kind: 'reload-start' | 'reload-end' | 'switch' | 'dry-fire' | 'scope-in' | 'scope-out';
    }
  | { t: 'phase'; tick: number; phase: RoundPhase; outcome: RoundOutcome | null };

export type LocomotionStatus = 'idle' | 'moving' | 'arrived' | 'waiting-path' | 'no-path' | 'stuck';
