/**
 * WEAPON_PROFILES (domain-entities-player-combat, OQ-RA-2 settled). Deep-frozen
 * at module load (SD-PC-08). Bots and the player share the same table
 * (BR-PC-37): difficulty never changes weapon numbers.
 */
import { TICK_HZ } from '../core';
import { freezeNested } from './freeze';
import type { RecoilProfile, ScopeProfile, SpreadProfile, WeaponProfile } from './types';

/** Seconds to whole 60 Hz ticks, converted once. */
export function toTicks(sec: number): number {
  return Math.round(sec * TICK_HZ);
}

const POSTURE = { moveMult: 1.6, airMult: 3.0, crouchMult: 0.75 } as const;
const RECOVERY_DELAY_SEC = 0.1;

interface ProfileInput {
  id: WeaponProfile['id'];
  mode: WeaponProfile['mode'];
  magSize: number;
  reserve: number;
  damage: number;
  headMult: number;
  cooldownSec: number;
  reloadSec: number;
  switchSec: number;
  range: number;
  noiseRadius: number;
  spread: Omit<SpreadProfile, keyof typeof POSTURE>;
  recoil: RecoilProfile;
  scope: ScopeProfile | null;
}

function profile(p: ProfileInput): WeaponProfile {
  return {
    ...p,
    cooldownTicks: toTicks(p.cooldownSec),
    reloadTicks: toTicks(p.reloadSec),
    switchTicks: toTicks(p.switchSec),
    recoveryDelaySec: RECOVERY_DELAY_SEC,
    recoveryDelayTicks: toTicks(RECOVERY_DELAY_SEC),
    spread: { ...p.spread, ...POSTURE },
  };
}

export const RIFLE: WeaponProfile = profile({
  id: 'rifle',
  mode: 'auto',
  magSize: 30,
  reserve: 180,
  damage: 25,
  headMult: 2.5,
  cooldownSec: 0.1,
  reloadSec: 2.2,
  switchSec: 0.5,
  range: 120,
  noiseRadius: 45,
  spread: { base: 0.006, perShot: 0.004, max: 0.045, recoverPerSec: 0.12 },
  recoil: { pitchPerShot: 0.012, yawJitter: 0.004, maxPitch: 0.12, recoverPerSec: 0.35 },
  scope: null,
});

export const PISTOL: WeaponProfile = profile({
  id: 'pistol',
  mode: 'semi',
  magSize: 15,
  reserve: 90,
  damage: 18,
  headMult: 2.5,
  cooldownSec: 0.15,
  reloadSec: 1.4,
  switchSec: 0.35,
  range: 80,
  noiseRadius: 35,
  spread: { base: 0.008, perShot: 0.012, max: 0.05, recoverPerSec: 0.2 },
  recoil: { pitchPerShot: 0.02, yawJitter: 0.006, maxPitch: 0.08, recoverPerSec: 0.5 },
  scope: null,
});

export const SNIPER: WeaponProfile = profile({
  id: 'sniper',
  mode: 'semi',
  magSize: 5,
  reserve: 25,
  damage: 90,
  headMult: 2.0,
  cooldownSec: 1.25,
  reloadSec: 3.0,
  switchSec: 0.8,
  range: 250,
  noiseRadius: 60,
  spread: { base: 0.06, perShot: 0.03, max: 0.1, recoverPerSec: 0.1 },
  recoil: { pitchPerShot: 0.06, yawJitter: 0.01, maxPitch: 0.1, recoverPerSec: 0.25 },
  scope: { zoom: 4, spreadMult: 0.02 },
});

/** Slot order is fixed: index = 1/2/3 key minus one. */
export const WEAPON_PROFILES: readonly [WeaponProfile, WeaponProfile, WeaponProfile] = freezeNested(
  [RIFLE, PISTOL, SNIPER] as [WeaponProfile, WeaponProfile, WeaponProfile],
);

/** Head damage, rounded once (BR-PC-44): rifle 63, pistol 45, sniper 180. */
export function headDamage(p: WeaponProfile): number {
  return Math.round(p.damage * p.headMult);
}
