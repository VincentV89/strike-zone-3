/**
 * sense() (tick stage 4, business-logic-model-bot-ai §2). Sight: range, FOV
 * cone and at most MAX_SENSE_RAYS lineOfSight calls with early exit. Hearing:
 * player gunfire only (FD-AI-Q3), offset uniformly over a disc. Damage: a
 * direction, never a position. Never throws, never allocates (BR-AI-09, SD-AI-07).
 */
import { PLAYER_ID, type Diagnostics, type Rng } from '../../core';
import type { CollisionWorld } from '../../physics';
import { finite3 } from './guard';
import type { PerceptionMemory, PerceptionProfile, SenseInput } from './types';

/** BR-AI-03: at most three rays per sense. */
export const MAX_SENSE_RAYS = 3;

const TWO_PI = Math.PI * 2;

function senseSight(
  mem: PerceptionMemory,
  input: SenseInput,
  world: CollisionWorld,
  p: PerceptionProfile,
  diag: Diagnostics,
): void {
  const eye = input.selfEye;
  const fx = -Math.sin(input.selfYaw);
  const fz = -Math.cos(input.selfYaw);
  const cosHalf = Math.cos(p.fovRad / 2);
  const range2 = p.sightRange * p.sightRange;
  const n = Math.min(input.targetPoints.length, MAX_SENSE_RAYS);
  const t = input.tick;
  for (let i = 0; i < n; i++) {
    const pt = input.targetPoints[i];
    if (pt === undefined || !finite3(pt)) {
      diag.warnOnce('ai/bad-input');
      continue;
    }
    const dx = pt.x - eye.x;
    const dy = pt.y - eye.y;
    const dz = pt.z - eye.z;
    if (dx * dx + dy * dy + dz * dz > range2) continue;
    const hl = Math.hypot(dx, dz);
    if (hl > 1e-6 && (dx * fx + dz * fz) / hl < cosHalf) continue;
    if (!world.lineOfSight(eye, pt)) continue;
    // BR-AI-04: a short break in sight keeps the reaction clock running.
    if (mem.firstSeenTick === null || t - mem.lastSeenTick > p.reacquireGraceTicks) {
      mem.firstSeenTick = t;
    }
    const s = mem.seenStore;
    s.x = pt.x;
    s.y = pt.y;
    s.z = pt.z;
    mem.lastSeenPos = s;
    mem.lastSeenTick = t;
    mem.visible = true;
    mem.suspectedPos = null;
    return;
  }
  mem.visible = false; // BR-AI-05: firstSeenTick is kept
}

function senseHearing(
  mem: PerceptionMemory,
  input: SenseInput,
  p: PerceptionProfile,
  rng: Rng,
  diag: Diagnostics,
): void {
  const eye = input.selfEye;
  for (let i = 0; i < input.noises.length; i++) {
    const e = input.noises[i];
    if (e === undefined) continue;
    if (e.source !== PLAYER_ID || e.kind !== 'gunfire' || !(e.tick > mem.lastSenseTick)) continue;
    if (!finite3(e.pos) || !Number.isFinite(e.radius)) {
      diag.warnOnce('ai/bad-input');
      continue;
    }
    const d = Math.hypot(e.pos.x - eye.x, e.pos.y - eye.y, e.pos.z - eye.z);
    if (d > e.radius * p.hearingMult) continue;
    if (mem.visible) continue; // sight already gives the exact point
    const r = Math.max(p.hearingErrorMin, d * p.hearingErrorFrac) * Math.sqrt(rng.next());
    const a = rng.next() * TWO_PI;
    const s = mem.suspectStore;
    s.x = e.pos.x + r * Math.cos(a);
    s.y = e.pos.y;
    s.z = e.pos.z + r * Math.sin(a);
    mem.suspectedPos = s;
    mem.suspectedTick = e.tick; // the latest noise wins
  }
}

function senseDamage(mem: PerceptionMemory, input: SenseInput, diag: Diagnostics): void {
  for (let i = 0; i < input.damageTaken.length; i++) {
    const e = input.damageTaken[i];
    if (e === undefined) continue;
    if (e.target !== input.selfId || !(e.tick > mem.lastSenseTick)) continue;
    mem.underFireTick = e.tick;
    if (!finite3(e.fromDir)) {
      diag.warnOnce('ai/bad-input');
      continue;
    }
    const l = Math.hypot(e.fromDir.x, e.fromDir.z);
    if (l < 1e-9) continue;
    const s = mem.threatStore;
    s.x = e.fromDir.x / l;
    s.y = 0;
    s.z = e.fromDir.z / l;
    mem.threatDir = s;
  }
}

/** Updates `mem` from one bot's senses. Bad input leaves memory unchanged apart from lastSenseTick. */
export function sense(
  mem: PerceptionMemory,
  input: SenseInput,
  world: CollisionWorld,
  profile: PerceptionProfile,
  rng: Rng,
  diag: Diagnostics,
): void {
  const tick = input.tick;
  if (!Number.isFinite(tick)) {
    diag.warnOnce('ai/bad-input');
    return;
  }
  if (!finite3(input.selfEye) || !Number.isFinite(input.selfYaw)) {
    diag.warnOnce('ai/bad-input');
    mem.lastSenseTick = tick;
    return;
  }
  senseSight(mem, input, world, profile, diag);
  senseHearing(mem, input, profile, rng, diag);
  senseDamage(mem, input, diag);
  mem.lastSenseTick = tick;
}
