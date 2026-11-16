/**
 * Stuck watchdog (BR-AI-65, FD-AI-Q2). Runs only while moving. Each 90-tick
 * window with less than 0.3 m xz progress escalates: repath, repath, nudge to
 * the nearest node, then snap to that node (only when it is at most 1.5 m away
 * and the standing capsule fits) and report `stuck` for one decide cycle.
 */
import { copy, type Vec3 } from '../../core';
import { LOCOMOTION_TUNING as T } from './tuning';
import type { BotMotionState, LocoContext } from './types';

function canSnap(m: BotMotionState, ctx: LocoContext, p: Readonly<Vec3>): boolean {
  return (
    Math.hypot(p.x - m.pos.x, p.y - m.pos.y, p.z - m.pos.z) <= T.snapMaxDist &&
    ctx.world.capsuleFits(p, ctx.standing)
  );
}

function snap(m: BotMotionState, ctx: LocoContext): void {
  let target: Readonly<Vec3> | null = null;
  const node = ctx.graph.nearestNode(m.pos);
  const n = node === null ? undefined : ctx.graph.nodes[node];
  if (n !== undefined && canSnap(m, ctx, n.pos)) target = n.pos;
  if (target !== null) {
    copy(target, m.pos);
    m.vel.x = 0;
    m.vel.y = 0;
    m.vel.z = 0;
    m.crouched = false;
    ctx.diag.count('ai/stuck-snap');
  } else {
    ctx.diag.count('ai/stuck-unresolved');
  }
}

export function watchdog(m: BotMotionState, ctx: LocoContext): void {
  if (m.status !== 'moving') {
    copy(m.pos, m.progressRef);
    m.progressRefTick = ctx.tick;
    return;
  }
  if (ctx.tick - m.progressRefTick < T.progressWindowTicks) return;
  const progress = Math.hypot(m.pos.x - m.progressRef.x, m.pos.z - m.progressRef.z);
  copy(m.pos, m.progressRef);
  m.progressRefTick = ctx.tick;
  if (progress >= T.progressMin) {
    m.stage = 0;
    return;
  }
  m.stage++;
  if (m.stage <= T.maxRepaths) {
    m.repath = true;
    m.repaths++;
    return;
  }
  if (m.stage === T.maxRepaths + 1) {
    const node = ctx.graph.nearestNode(m.pos);
    const n = node === null ? undefined : ctx.graph.nodes[node];
    if (n !== undefined) {
      copy(n.pos, m.dest);
      m.nudging = true;
      m.repath = true;
    }
    return;
  }
  snap(m, ctx);
  if (m.ticket !== null) ctx.paths.cancel(m.ticket);
  m.ticket = null;
  m.status = 'stuck';
  m.stage = 0;
  m.nudging = false;
  m.repath = false;
  m.pathLen = 0;
  if (m.goal !== null) copy(m.goal, m.dest);
}
