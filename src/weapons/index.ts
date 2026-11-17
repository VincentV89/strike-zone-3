/**
 * weapons public surface (src/weapons). Other components import this file
 * only; profiles, loadout, spread, step and view are private (SD-PC-04).
 */
export { WEAPON_PROFILES, headDamage } from './profiles';
export { createLoadout } from './loadout';
export { stepWeapon } from './step';
export {
  createFireRequest,
  createLoadoutView,
  createWeaponTrigger,
  toLoadoutView,
  triggerFromInput,
  viewKick,
} from './view';
export type {
  AimContext,
  FireMode,
  FireRequest,
  Loadout,
  RecoilProfile,
  ScopeProfile,
  SlotIndex,
  SpreadProfile,
  WeaponProfile,
  WeaponState,
  WeaponTrigger,
} from './types';
