/**
 * createLoadout: setup validation (the only throws in the unit, LC-PC-R6) and
 * the slot layout. All slots start full with the rifle active (BR-PC-20).
 */
import { StrikeZoneError } from '../core';
import type { WeaponId } from '../contracts';
import type { Loadout, WeaponProfile, WeaponState } from './types';

const SLOT_IDS: readonly WeaponId[] = ['rifle', 'pistol', 'sniper'];

const posInt = (n: number): boolean => Number.isInteger(n) && n > 0;
const posNum = (n: number): boolean => Number.isFinite(n) && n > 0;

function badProfile(reason: string): never {
  throw new StrikeZoneError('weapons/bad-profile', `Weapon profile check failed: ${reason}`);
}

function checkOne(p: WeaponProfile): void {
  const ints = [p.magSize, p.cooldownTicks, p.reloadTicks, p.switchTicks, p.recoveryDelayTicks];
  if (!ints.every(posInt) || !(Number.isInteger(p.reserve) && p.reserve >= 0)) {
    badProfile(`${p.id} counts must be positive integers`);
  }
  const s = p.spread;
  const r = p.recoil;
  const nums = [
    p.damage,
    p.headMult,
    p.range,
    p.noiseRadius,
    s.base,
    s.perShot,
    s.max,
    s.recoverPerSec,
    s.moveMult,
    s.airMult,
    s.crouchMult,
    r.pitchPerShot,
    r.yawJitter,
    r.maxPitch,
    r.recoverPerSec,
  ];
  if (!nums.every(posNum)) badProfile(`${p.id} numbers must be finite and positive`);
  if (s.max < s.base) badProfile(`${p.id} spread.max is below spread.base`);
  if (p.scope !== null && (!posNum(p.scope.zoom) || !posNum(p.scope.spreadMult))) {
    badProfile(`${p.id} scope numbers must be finite and positive`);
  }
}

/** BR-PC-36: profile ordering rules over the rifle, pistol, sniper triple. */
export function checkProfiles(profiles: readonly WeaponProfile[]): void {
  const [rifle, pistol, sniper] = profiles;
  if (
    profiles.length !== 3 ||
    rifle === undefined ||
    pistol === undefined ||
    sniper === undefined ||
    profiles.some((p, i) => p.id !== SLOT_IDS[i])
  ) {
    throw new StrikeZoneError('weapons/bad-loadout', 'Loadout must be rifle, pistol, sniper');
  }
  for (const p of profiles) checkOne(p);
  if (rifle.magSize !== 30 || rifle.mode !== 'auto') badProfile('rifle must be auto with 30');
  if (pistol.magSize !== 15 || pistol.mode !== 'semi') badProfile('pistol must be semi with 15');
  if (sniper.magSize > 10 || sniper.mode !== 'semi') badProfile('sniper must be semi with <= 10');
  if (!(sniper.damage > rifle.damage && rifle.damage > pistol.damage)) {
    badProfile('body damage must be sniper > rifle > pistol');
  }
  if (!(pistol.reloadSec < rifle.reloadSec && pistol.reloadSec < sniper.reloadSec)) {
    badProfile('pistol must reload fastest');
  }
  if (!(pistol.switchSec < rifle.switchSec && pistol.switchSec < sniper.switchSec)) {
    badProfile('pistol must switch fastest');
  }
  if (rifle.scope !== null || pistol.scope !== null || sniper.scope === null) {
    badProfile('only the sniper has a scope');
  }
  if (!(sniper.scope.spreadMult < 1)) badProfile('scoped spread must be lower than unscoped');
  if (
    !(sniper.recoil.pitchPerShot > rifle.recoil.pitchPerShot) ||
    !(sniper.recoil.pitchPerShot > pistol.recoil.pitchPerShot)
  ) {
    badProfile('sniper must have the highest pitchPerShot');
  }
  if (!(sniper.cooldownSec > rifle.cooldownSec && sniper.cooldownSec > pistol.cooldownSec)) {
    badProfile('sniper must have the longest cooldown');
  }
}

function slot(profile: WeaponProfile): WeaponState {
  return {
    profile,
    mag: profile.magSize,
    reserve: profile.reserve,
    nextFireTick: 0,
    reloadStartTick: -1,
    reloadEndTick: -1,
    bloom: 0,
    kickPitch: 0,
    kickYaw: 0,
    lastFireTick: -1,
    triggerLatched: false,
  };
}

/**
 * A fresh loadout. Bots pass `{ infiniteReserve: true }` (FD-PC-Q2).
 * @throws StrikeZoneError 'weapons/bad-loadout' | 'weapons/bad-profile'.
 */
export function createLoadout(
  profiles: readonly WeaponProfile[],
  opts: { infiniteReserve?: boolean } = {},
): Loadout {
  checkProfiles(profiles);
  const [rifle, pistol, sniper] = profiles as readonly [
    WeaponProfile,
    WeaponProfile,
    WeaponProfile,
  ];
  return {
    slots: [slot(rifle), slot(pistol), slot(sniper)],
    active: 0,
    switchingUntil: 0,
    scoped: false,
    infiniteReserve: opts.infiniteReserve === true,
    lastSpread: rifle.spread.base,
  };
}
