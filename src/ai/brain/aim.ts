/**
 * stepBotAim (tick stage 7, business-logic-model-bot-ai §4). Turns the view
 * at turnRateRad, applies the settling aim error, and gates fire on
 * visibility, reaction delay, settled aim and the burst budget. Writes only
 * the trigger; brain cannot call stepWeapon (SD-AI-11). Never throws.
 */
import { angleDelta, clamp, wrapAngle, type Vec3 } from '../../core';
import type { BotIntent } from '../../contracts';
import type { WeaponTrigger } from '../../weapons';
import type { PerceptionMemory } from '../perception';
import { finite3 } from './guard';
import { freezeNested } from './freeze';
import type { BotAimContext, BotAimState } from './types';

export const AIM_TUNING = freezeNested({
  /** Ticks between aim error redraws. */
  errRedrawTicks: 30,
  /** Fire only when the remaining turn is within this on both axes (rad). */
  onTargetRad: 0.05,
  pitchLimit: 1.4,
  faceSpeed: 0.5,
});

const TWO_PI = Math.PI * 2;

export function createBotAim(yaw: number): BotAimState {
  return {
    yaw: Number.isFinite(yaw) ? wrapAngle(yaw) : 0,
    pitch: 0,
    errYaw: 0,
    errPitch: 0,
    errRedrawTick: 0,
    burstUntilTick: -1,
    pauseUntilTick: 0,
    lastFireAllowed: false,
  };
}

function release(out: WeaponTrigger): WeaponTrigger {
  out.fire = false;
  out.firePressed = false;
  out.reload = false;
  out.scope = false;
  out.select = null;
  out.cycle = 0;
  return out;
}

function turn(from: number, to: number, maxStep: number): number {
  return wrapAngle(from + clamp(angleDelta(from, to), -maxStep, maxStep));
}

/** One tick of aim for one alive bot. `out` is the bot's reused trigger. */
export function stepBotAim(
  a: BotAimState,
  intent: Readonly<BotIntent>,
  mem: Readonly<PerceptionMemory>,
  ctx: BotAimContext,
  out: WeaponTrigger,
): WeaponTrigger {
  const t = ctx.tick;
  if (
    !Number.isFinite(t) ||
    !Number.isFinite(ctx.dt) ||
    !finite3(ctx.eye) ||
    !finite3(ctx.vel) ||
    !Number.isFinite(a.yaw) ||
    !Number.isFinite(a.pitch)
  ) {
    ctx.diag.warnOnce('ai/bad-input');
    a.lastFireAllowed = false;
    return release(out);
  }
  release(out);
  const D = ctx.profile;
  const target: Readonly<Vec3> | null = mem.visible ? mem.lastSeenPos : intent.aimAt;
  let dy = a.yaw;
  let dp = a.pitch;
  if (target !== null && finite3(target)) {
    if (t >= a.errRedrawTick) {
      const r = 0.5 + 0.5 * ctx.rng.next();
      const th = ctx.rng.next() * TWO_PI;
      a.errYaw = Math.cos(th) * r;
      a.errPitch = Math.sin(th) * r;
      a.errRedrawTick = t + AIM_TUNING.errRedrawTicks;
    }
    const fs = mem.firstSeenTick;
    const track = fs === null || !Number.isFinite(fs) ? 0 : t - fs;
    const e = D.aimErrorRad * clamp(1 - track / D.aimSettleTicks, D.aimSettleFloor, 1);
    const vx = target.x - ctx.eye.x;
    const vy = target.y - ctx.eye.y;
    const vz = target.z - ctx.eye.z;
    dy = Math.atan2(-vx, -vz) + e * a.errYaw;
    dp = Math.atan2(vy, Math.hypot(vx, vz)) + e * a.errPitch;
  } else if (Math.hypot(ctx.vel.x, ctx.vel.z) > AIM_TUNING.faceSpeed) {
    dy = Math.atan2(-ctx.vel.x, -ctx.vel.z);
    dp = 0;
  }
  const step = D.turnRateRad * ctx.dt;
  a.yaw = turn(a.yaw, dy, step);
  a.pitch = clamp(
    a.pitch + clamp(dp - a.pitch, -step, step),
    -AIM_TUNING.pitchLimit,
    AIM_TUNING.pitchLimit,
  );
  const onTarget =
    Math.abs(angleDelta(a.yaw, dy)) <= AIM_TUNING.onTargetRad &&
    Math.abs(dp - a.pitch) <= AIM_TUNING.onTargetRad;
  const reacted =
    mem.firstSeenTick !== null &&
    Number.isFinite(mem.firstSeenTick) &&
    t - mem.firstSeenTick >= D.reactionTicks;
  const allowed = intent.fire && mem.visible && reacted && onTarget;
  if (allowed && t >= a.pauseUntilTick && a.burstUntilTick < t) a.burstUntilTick = t + D.burstTicks;
  if (t >= a.burstUntilTick && a.burstUntilTick >= 0 && a.lastFireAllowed) {
    a.pauseUntilTick = t + D.burstPauseTicks;
    a.burstUntilTick = -1;
  }
  const fire = allowed && t <= a.burstUntilTick;
  out.firePressed = fire && !a.lastFireAllowed;
  out.fire = fire;
  a.lastFireAllowed = fire;
  out.reload = intent.reload || (ctx.mag === 0 && !ctx.reloading);
  return out;
}
