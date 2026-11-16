/**
 * stepPlayer (tick stage 2, business-logic-model-player-combat): guard, look,
 * stance, eye height, wish direction, acceleration, jump, gravity, one
 * moveCapsule, footsteps and the out-of-world guard. Allocates nothing.
 */
import {
  TICK_DT,
  clamp,
  copy,
  set,
  vec3,
  wrapAngle,
  type Diagnostics,
  type Vec3,
} from '../../core';
import type { InputCommand, RoundPhase } from '../../contracts';
import type { CollisionWorld, MoveResult } from '../../physics';
import { sanitiseInput, type SafeInput } from './guard';
import { PLAYER_TUNING } from './tuning';
import type { FootstepKind, MovementTuning, PlayerState, PlayerStepResult } from './types';

/** Runtime boolean check: off-type values from untrusted callers read as false. */
const isTrue = (x: unknown): boolean => x === true;

const input: SafeInput = {
  lookDx: 0,
  lookDy: 0,
  moveX: 0,
  moveZ: 0,
  lookOk: true,
  jump: false,
  crouch: false,
  sprint: false,
};
const move: MoveResult = {
  position: vec3(),
  velocity: vec3(),
  grounded: false,
  hitCeiling: false,
  landed: false,
};
const capsule = { radius: 0.4, height: 1.8 };

/** A fresh state at a spawn. The spawn is copied, never aliased (SD-PC-07). */
export function createPlayerState(spawn: Vec3, yaw: number): PlayerState {
  return {
    pos: vec3(spawn.x, spawn.y, spawn.z),
    vel: vec3(),
    yaw: Number.isFinite(yaw) ? wrapAngle(yaw) : 0,
    pitch: 0,
    stance: 'stand',
    eyeHeight: PLAYER_TUNING.standEye,
    grounded: true,
    jumpHeld: false,
    strideAccum: 0,
    lastSafePos: vec3(spawn.x, spawn.y, spawn.z),
  };
}

export function createPlayerStepResult(): PlayerStepResult {
  return { footstep: null, landed: false, landSpeed: 0 };
}

/** Eye position = feet + eyeHeight (the weapon origin and camera). */
export function eyePosition(s: PlayerState, out: Vec3): Vec3 {
  return set(out, s.pos.x, s.pos.y + s.eyeHeight, s.pos.z);
}

function look(s: PlayerState, tuning: MovementTuning, sensitivity: number): void {
  if (!input.lookOk) return;
  const k = sensitivity * tuning.lookRadPerCount;
  const yaw = s.yaw - input.lookDx * k;
  const pitch = s.pitch - input.lookDy * k;
  if (Number.isFinite(yaw)) s.yaw = wrapAngle(yaw);
  if (!Number.isNaN(pitch)) s.pitch = clamp(pitch, -tuning.pitchLimit, tuning.pitchLimit);
}

function updateStance(s: PlayerState, world: CollisionWorld, tuning: MovementTuning): void {
  if (input.crouch) {
    s.stance = 'crouch';
  } else if (s.stance === 'crouch') {
    capsule.radius = tuning.radius;
    capsule.height = tuning.standHeight;
    if (world.capsuleFits(s.pos, capsule)) s.stance = 'stand';
  }
  const target = s.stance === 'stand' ? tuning.standEye : tuning.crouchEye;
  const step = tuning.eyeSpeed * TICK_DT;
  const d = target - s.eyeHeight;
  s.eyeHeight = Math.abs(d) <= step ? target : s.eyeHeight + Math.sign(d) * step;
}

/** BR-PC-04..06: wish direction, target speed and acceleration. Returns true when sprinting. */
function accelerate(s: PlayerState, tuning: MovementTuning, scoped: boolean): boolean {
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  // w = right * x - forward * z, forward = (-sin, 0, -cos), right = (cos, 0, -sin).
  let wx = cos * input.moveX + sin * input.moveZ;
  let wz = -sin * input.moveX + cos * input.moveZ;
  const wl = Math.hypot(wx, wz);
  const hasInput = wl > 1e-9;
  if (hasInput) {
    wx /= wl;
    wz /= wl;
  }
  const crouched = s.stance === 'crouch';
  const sprinting = input.sprint && !crouched && !scoped && input.moveZ === -1;
  let speed = crouched ? tuning.crouchSpeed : sprinting ? tuning.sprintSpeed : tuning.walkSpeed;
  if (scoped) speed *= tuning.scopedSpeedMult;

  const vx = s.vel.x;
  const vz = s.vel.z;
  let dx = wx * speed - vx;
  let dz = wz * speed - vz;
  let a: number;
  if (s.grounded) a = hasInput ? tuning.groundAccel : tuning.groundDecel;
  else a = hasInput ? tuning.airAccel : 0;
  const dl = Math.hypot(dx, dz);
  const lim = a * TICK_DT;
  if (dl > lim) {
    const f = dl > 0 ? lim / dl : 0;
    dx *= f;
    dz *= f;
  }
  let nx = vx + dx;
  let nz = vz + dz;
  if (!s.grounded) {
    const cap = Math.max(Math.hypot(vx, vz), tuning.walkSpeed);
    const ns = Math.hypot(nx, nz);
    if (ns > cap) {
      nx *= cap / ns;
      nz *= cap / ns;
    }
  }
  s.vel.x = nx;
  s.vel.z = nz;
  return sprinting;
}

function footstep(
  s: PlayerState,
  tuning: MovementTuning,
  sprinting: boolean,
  out: PlayerStepResult,
): void {
  out.footstep = null;
  const h = Math.hypot(s.vel.x, s.vel.z);
  if (!s.grounded || !(h > tuning.footstepMinSpeed)) return;
  const kind: FootstepKind = s.stance === 'crouch' ? 'crouch' : sprinting ? 'sprint' : 'walk';
  const stride =
    kind === 'crouch'
      ? tuning.strideCrouch
      : kind === 'sprint'
        ? tuning.strideSprint
        : tuning.strideWalk;
  s.strideAccum += h * TICK_DT;
  if (s.strideAccum >= stride) {
    out.footstep = kind;
    s.strideAccum -= stride;
  }
}

/**
 * One player tick. In `countdown` only look applies (BR-PC-03). Never throws:
 * bad input reads as no input and reports `player/bad-input` once.
 */
export function stepPlayer(
  s: PlayerState,
  cmd: InputCommand,
  world: CollisionWorld,
  tuning: MovementTuning,
  sensitivity: number,
  phase: RoundPhase,
  opts: { scoped: boolean },
  diag: Diagnostics,
  out: PlayerStepResult,
): PlayerStepResult {
  sanitiseInput(cmd, sensitivity, diag, input);
  look(s, tuning, sensitivity);
  out.footstep = null;
  out.landed = false;
  out.landSpeed = 0;
  if (phase !== 'live') return out;

  updateStance(s, world, tuning);
  const sprinting = accelerate(s, tuning, isTrue(opts.scoped));
  if (input.jump && !s.jumpHeld && s.grounded) {
    s.vel.y = tuning.jumpSpeed;
    s.grounded = false;
  }
  s.jumpHeld = input.jump;
  if (!s.grounded) s.vel.y = Math.max(s.vel.y - tuning.gravity * TICK_DT, -tuning.terminalSpeed);

  const preVy = s.vel.y;
  capsule.radius = tuning.radius;
  capsule.height = s.stance === 'stand' ? tuning.standHeight : tuning.crouchHeight;
  world.moveCapsule(s.pos, s.vel, capsule, TICK_DT, tuning.stepHeight, move);
  copy(move.position, s.pos);
  copy(move.velocity, s.vel);
  s.grounded = move.grounded;
  out.landed = move.landed;
  out.landSpeed = move.landed ? Math.max(0, -preVy) : 0;
  if (s.grounded) copy(s.pos, s.lastSafePos);

  footstep(s, tuning, sprinting, out);

  if (s.pos.y < world.bounds.min.y - tuning.outOfWorldMargin) {
    copy(s.lastSafePos, s.pos);
    set(s.vel, 0, 0, 0);
    s.strideAccum = 0;
    out.footstep = null;
    diag.warnOnce('player/out-of-world');
  }
  return out;
}
