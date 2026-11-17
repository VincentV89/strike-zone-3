/**
 * Stuck watchdog (BR-AI-65, FD-AI-Q2). Runs only while moving. Each 90-tick
 * window with less than 0.3 m of path progress escalates: repath, repath, nudge to
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

/** Remaining xz path length: to the current waypoint, then along the kept waypoints. */
function remaining(m: BotMotionState): number {
  const p = m.path;
  let i = m.waypoint;
  if (i >= m.pathLen) return 0;
  let d = Math.hypot((p[3 * i] ?? 0) - m.pos.x, (p[3 * i + 2] ?? 0) - m.pos.z);
  for (i++; i < m.pathLen; i++) {
    d += Math.hypot(
      (p[3 * i] ?? 0) - (p[3 * i - 3] ?? 0),
      (p[3 * i + 2] ?? 0) - (p[3 * i - 1] ?? 0),
    );
  }
  return d;
}

/**
 * Progress is the reduction in remaining path length over the window, not net
 * displacement: a bot sliding back and forth along a ramp side moves a metre
 * per window but gets no closer, and must still escalate to the snap. The
 * window keeps running across repaths, and a nudge never resets the stage.
 */
export function watchdog(m: BotMotionState, ctx: LocoContext): void {
  if (m.status === 'waiting-path') return; // a repath keeps the window running
  if (m.status !== 'moving') {
    m.progressRefRemaining = -1;
    m.stage = 0;
    return;
  }
  if (m.progressRefRemaining < 0) {
    m.progressRefRemaining = remaining(m);
    m.progressRefTick = ctx.tick;
    copy(m.pos, m.progressRef);
    return;
  }
  if (ctx.tick - m.progressRefTick < T.progressWindowTicks) return;
  const now = remaining(m);
  const progress = m.progressRefRemaining - now;
  m.progressRefRemaining = now;
  copy(m.pos, m.progressRef);
  m.progressRefTick = ctx.tick;
  if (progress >= T.progressMin && !m.nudging) {
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
