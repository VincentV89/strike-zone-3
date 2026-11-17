/**
 * Read-side helpers: LoadoutView, view kick and the player's trigger. They
 * write only into `out` and never store it (SD-PC-09).
 */
import type { InputCommand, LoadoutView } from '../contracts';
import type { EntityId } from '../core';
import { vec3 } from '../core';
import type { FireRequest, Loadout, SlotIndex, WeaponTrigger } from './types';

/** Runtime boolean check: off-type values from untrusted callers read as false. */
const isTrue = (x: unknown): boolean => x === true;

/** Shown for an infinite reserve (bots only; the HUD never shows it). */
export const INFINITE_RESERVE_FACTOR = 99;

type ViewSlot = { id: LoadoutView['active']; mag: number; magSize: number; reserve: number };

/** A LoadoutView with its three slot objects, allocated once per round by the caller. */
export function createLoadoutView(): LoadoutView {
  const slots: ViewSlot[] = [
    { id: 'rifle', mag: 0, magSize: 0, reserve: 0 },
    { id: 'pistol', mag: 0, magSize: 0, reserve: 0 },
    { id: 'sniper', mag: 0, magSize: 0, reserve: 0 },
  ];
  return {
    active: 'rifle',
    slots,
    reloading: false,
    reloadProgress: 0,
    switching: false,
    spread: 0,
    scoped: false,
  };
}

/** Copies the loadout into `out` (whose slots come from createLoadoutView). */
export function toLoadoutView(l: Loadout, tick: number, out: LoadoutView): LoadoutView {
  const w = l.slots[l.active];
  const view = out;
  view.active = w.profile.id;
  for (let i = 0; i < 3; i++) {
    const s = l.slots[i as SlotIndex];
    const v = out.slots[i];
    if (v === undefined) continue;
    v.id = s.profile.id;
    v.mag = s.mag;
    v.magSize = s.profile.magSize;
    v.reserve = l.infiniteReserve ? s.profile.magSize * INFINITE_RESERVE_FACTOR : s.reserve;
  }
  const reloading = w.reloadEndTick >= 0;
  view.reloading = reloading;
  const span = w.reloadEndTick - w.reloadStartTick;
  view.reloadProgress =
    reloading && span > 0 ? Math.min(1, Math.max(0, (tick - w.reloadStartTick) / span)) : 0;
  view.switching = tick < l.switchingUntil;
  view.spread = l.lastSpread;
  view.scoped = l.scoped;
  return out;
}

/** The active weapon's recoil offset, shown as PlayerView.viewKick. */
export function viewKick(
  l: Loadout,
  out: { pitch: number; yaw: number },
): { pitch: number; yaw: number } {
  const w = l.slots[l.active];
  out.pitch = w.kickPitch;
  out.yaw = w.kickYaw;
  return out;
}

export function createWeaponTrigger(): WeaponTrigger {
  return { fire: false, firePressed: false, reload: false, scope: false, select: null, cycle: 0 };
}

/** Copies the player's input into a trigger. Off-type values read as no input. */
export function triggerFromInput(cmd: InputCommand, out: WeaponTrigger): WeaponTrigger {
  out.fire = isTrue(cmd.fire);
  out.firePressed = isTrue(cmd.firePressed);
  out.reload = isTrue(cmd.reload);
  out.scope = isTrue(cmd.scope);
  const sel: unknown = cmd.select;
  out.select = sel === 0 || sel === 1 || sel === 2 ? sel : null;
  const cyc: unknown = cmd.cycle;
  out.cycle = cyc === 1 || cyc === -1 ? cyc : 0;
  return out;
}

/** A FireRequest to reuse for one actor for the whole round. */
export function createFireRequest(shooter: EntityId): FireRequest {
  return { origin: vec3(), dir: vec3(0, 0, -1), weapon: 'rifle', slot: 0, shooter, tick: 0 };
}
