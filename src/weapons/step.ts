/**
 * stepWeapon (tick stage 8, business-logic-model-player-combat). Order per call:
 * guard aim, switch, reload end, reload start, scope, spread, fire or dry-fire,
 * recovery, semi latch. Allocates nothing: events go through one reused
 * scratch object (SD-PC-10).
 */
import { TICK_DT, clamp, copy, type Diagnostics, type EntityId, type Rng } from '../core';
import type { SimEvent } from '../contracts';
import { coneDirection } from './spread';
import type {
  AimContext,
  FireRequest,
  Loadout,
  SlotIndex,
  WeaponState,
  WeaponTrigger,
} from './types';

/** Runtime boolean check: off-type values from untrusted callers read as false. */
const isTrue = (x: unknown): boolean => x === true;

type WeaponEvent = Extract<SimEvent, { t: 'weapon' }>;
type WeaponEventKind = WeaponEvent['kind'];

const scratchEvent: WeaponEvent = { t: 'weapon', tick: 0, actor: 0 as EntityId, kind: 'switch' };

/** Moving faster than this (m/s) counts as moving for spread (BR-PC-30). */
export const MOVING_SPEED = 0.5;

const finite = Number.isFinite;

function aimIsFinite(aim: AimContext): boolean {
  const o = aim.origin;
  return finite(o.x) && finite(o.y) && finite(o.z) && finite(aim.yaw) && finite(aim.pitch);
}

function emitWeapon(
  emit: (e: SimEvent) => void,
  tick: number,
  actor: EntityId,
  kind: WeaponEventKind,
): void {
  scratchEvent.tick = tick;
  scratchEvent.actor = actor;
  scratchEvent.kind = kind;
  emit(scratchEvent);
}

function isSlot(x: unknown): x is SlotIndex {
  return x === 0 || x === 1 || x === 2;
}

/** Slot to switch to this tick, or -1. `select` wins over `cycle` (BR-PC-28). */
function switchTarget(l: Loadout, trigger: WeaponTrigger): number {
  if (trigger.select !== null) {
    return isSlot(trigger.select) && trigger.select !== l.active ? trigger.select : -1;
  }
  if (trigger.cycle === 1 || trigger.cycle === -1) return (l.active + trigger.cycle + 3) % 3;
  return -1;
}

function cancelReload(w: WeaponState): void {
  w.reloadStartTick = -1;
  w.reloadEndTick = -1;
}

function scopeOut(l: Loadout, emit: (e: SimEvent) => void, tick: number, actor: EntityId): void {
  if (!l.scoped) return;
  l.scoped = false;
  emitWeapon(emit, tick, actor, 'scope-out');
}

function finishReload(l: Loadout, w: WeaponState): void {
  const need = w.profile.magSize - w.mag;
  if (l.infiniteReserve) {
    w.mag = w.profile.magSize;
  } else {
    const n = Math.min(need, w.reserve);
    w.mag += n;
    w.reserve -= n;
  }
  cancelReload(w);
}

function canStartReload(l: Loadout, w: WeaponState, switching: boolean): boolean {
  return (
    !switching &&
    w.reloadEndTick < 0 &&
    w.mag < w.profile.magSize &&
    (w.reserve > 0 || l.infiniteReserve)
  );
}

function effectiveSpread(l: Loadout, w: WeaponState, aim: AimContext): number {
  const s = w.profile.spread;
  let posture = !isTrue(aim.grounded) ? s.airMult : isTrue(aim.moving) ? s.moveMult : 1;
  if (isTrue(aim.crouched)) posture *= s.crouchMult;
  const scope = l.scoped && w.profile.scope !== null ? w.profile.scope.spreadMult : 1;
  return Math.min(s.max, s.base + w.bloom) * posture * scope;
}

function recover(w: WeaponState, tick: number): void {
  if (w.lastFireTick >= 0 && tick - w.lastFireTick <= w.profile.recoveryDelayTicks) return;
  const s = w.profile.spread;
  const r = w.profile.recoil;
  w.bloom = Math.max(0, w.bloom - s.recoverPerSec * TICK_DT);
  const k = r.recoverPerSec * TICK_DT;
  w.kickPitch = w.kickPitch > k ? w.kickPitch - k : w.kickPitch < -k ? w.kickPitch + k : 0;
  w.kickYaw = w.kickYaw > k ? w.kickYaw - k : w.kickYaw < -k ? w.kickYaw + k : 0;
}

/** Fires the active weapon into `out`; spread and kick from before the increment (BR-PC-33). */
function fire(
  w: WeaponState,
  slot: SlotIndex,
  aim: AimContext,
  spread: number,
  tick: number,
  rng: Rng,
  shooter: EntityId,
  out: FireRequest,
): FireRequest {
  const p = w.profile;
  // Exactly three draws per shot, in this order (BR-PC-34).
  const u = rng.next();
  const v = rng.next();
  const j = rng.next();
  copy(aim.origin, out.origin);
  coneDirection(aim.yaw + w.kickYaw, aim.pitch + w.kickPitch, spread, u, v, out.dir);
  out.weapon = p.id;
  out.slot = slot;
  out.shooter = shooter;
  out.tick = tick;

  w.mag -= 1;
  w.nextFireTick = tick + p.cooldownTicks;
  w.lastFireTick = tick;
  w.triggerLatched = true;
  w.bloom = Math.min(w.bloom + p.spread.perShot, p.spread.max - p.spread.base);
  const jitter = p.recoil.yawJitter;
  w.kickYaw = clamp(w.kickYaw + (2 * j - 1) * jitter, -2 * jitter, 2 * jitter);
  w.kickPitch = Math.min(w.kickPitch + p.recoil.pitchPerShot, p.recoil.maxPitch);
  return out;
}

/**
 * One weapon tick for one actor. Returns `out` when a shot fires, else null.
 *
 * `emit` receives a reused scratch `weapon` event: the sink must copy every
 * field it keeps before returning, must not throw and must not call back into
 * weapons (SD-PC-10).
 */
export function stepWeapon(
  l: Loadout,
  trigger: WeaponTrigger,
  aim: AimContext,
  tick: number,
  rng: Rng,
  emit: (e: SimEvent) => void,
  shooter: EntityId,
  diag: Diagnostics,
  out: FireRequest,
): FireRequest | null {
  const aimOk = aimIsFinite(aim);
  if (!aimOk) diag.warnOnce('weapons/bad-aim');

  const target = switchTarget(l, trigger);
  if (target >= 0) {
    cancelReload(l.slots[l.active]);
    scopeOut(l, emit, tick, shooter);
    l.active = target as SlotIndex;
    l.switchingUntil = tick + l.slots[l.active].profile.switchTicks;
    emitWeapon(emit, tick, shooter, 'switch');
  }

  const slot = l.active;
  const w = l.slots[slot];
  const switching = tick < l.switchingUntil;

  if (w.reloadEndTick >= 0 && tick >= w.reloadEndTick) {
    finishReload(l, w);
    emitWeapon(emit, tick, shooter, 'reload-end');
  }
  if (isTrue(trigger.reload) && canStartReload(l, w, switching)) {
    w.reloadStartTick = tick;
    w.reloadEndTick = tick + w.profile.reloadTicks;
    scopeOut(l, emit, tick, shooter);
    emitWeapon(emit, tick, shooter, 'reload-start');
  }
  const reloading = w.reloadEndTick >= 0;

  const wantScope = isTrue(trigger.scope) && w.profile.scope !== null && !reloading && !switching;
  if (wantScope && !l.scoped) {
    l.scoped = true;
    emitWeapon(emit, tick, shooter, 'scope-in');
  } else if (!wantScope) {
    scopeOut(l, emit, tick, shooter);
  }

  const spread = effectiveSpread(l, w, aim);
  l.lastSpread = spread;

  let shot: FireRequest | null = null;
  if (aimOk && !switching && !reloading) {
    const pulled =
      w.profile.mode === 'auto'
        ? isTrue(trigger.fire)
        : isTrue(trigger.firePressed) && !w.triggerLatched;
    if (w.mag === 0) {
      if (isTrue(trigger.firePressed)) emitWeapon(emit, tick, shooter, 'dry-fire');
    } else if (pulled && tick >= w.nextFireTick) {
      shot = fire(w, slot, aim, spread, tick, rng, shooter, out);
    }
  }

  // A weapon that fired this tick is inside its recovery delay, so recover() skips it.
  recover(l.slots[0], tick);
  recover(l.slots[1], tick);
  recover(l.slots[2], tick);
  w.triggerLatched = w.triggerLatched && isTrue(trigger.fire);
  return shot;
}
