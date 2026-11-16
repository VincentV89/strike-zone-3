/**
 * Bot locomotion (tick stage 7, business-logic-model-bot-ai §5, ADR-017).
 * Owns the path, the ticket, waypoint following, separation, exactly one
 * moveCapsule per live tick and the stuck watchdog. Never throws; allocates
 * nothing after createBotMotion (BR-AI-81).
 */
import { copy, vec3, type Diagnostics, type EntityId, type Vec3 } from '../../core';
import type { PathAvoid } from '../../nav';
import { finite3 } from './guard';
import { addSeparation } from './separation';
import { LOCOMOTION_TUNING as T, MAX_PATH_POINTS } from './tuning';
import type { BotMotionState, LocoContext } from './types';
import { watchdog } from './watchdog';

const isFiniteNum = Number.isFinite;

/** A bot at rest at its spawn. The spawn is copied, never aliased (SD-AI-09). */
export function createBotMotion(id: EntityId, spawn: Readonly<Vec3>, yaw: number): BotMotionState {
  return {
    id,
    pos: vec3(spawn.x, spawn.y, spawn.z),
    vel: vec3(),
    yaw: isFiniteNum(yaw) ? yaw : 0,
    grounded: false,
    crouch: false,
    crouched: false,
    speed: 'walk',
    status: 'idle',
    goal: null,
    avoid: null,
    ticket: null,
    path: new Float64Array(3 * MAX_PATH_POINTS),
    pathLen: 0,
    waypoint: 0,
    truncated: false,
    repath: false,
    waitLos: false,
    stage: 0,
    repaths: 0,
    progressRefTick: 0,
    progressRef: vec3(spawn.x, spawn.y, spawn.z),
    nudging: false,
    dest: vec3(),
    goalStore: vec3(),
    avoidStore: { center: vec3(), radius: 0, penalty: 0 },
    scratchA: vec3(),
    scratchB: vec3(),
    move: { position: vec3(), velocity: vec3(), grounded: false, hitCeiling: false, landed: false },
    reqPlain: { from: vec3(), to: vec3() },
    reqAvoid: { from: vec3(), to: vec3(), avoid: { center: vec3(), radius: 0, penalty: 0 } },
  };
}

function sameAvoid(a: PathAvoid | null, b: PathAvoid | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.center.x === b.center.x &&
    a.center.y === b.center.y &&
    a.center.z === b.center.z &&
    a.radius === b.radius &&
    a.penalty === b.penalty
  );
}

function validAvoid(a: PathAvoid | null): boolean {
  return a === null || (finite3(a.center) && isFiniteNum(a.radius) && isFiniteNum(a.penalty));
}

/**
 * Hands the brain's goal to locomotion (BR-AI-61). A path is requested only
 * when the goal moved more than 1 m, the avoid zone changed, the bot is
 * idle or stuck, or it has no path and the goal changed. Otherwise the current
 * path is kept. Bad input keeps the previous goal and reports `ai/bad-input`.
 */
export function setGoal(
  m: BotMotionState,
  goal: Readonly<Vec3> | null,
  avoid: PathAvoid | null,
  speed: 'walk' | 'run',
  diag: Diagnostics,
): void {
  m.speed = speed === 'run' ? 'run' : 'walk';
  if (goal === null) {
    m.goal = null;
    m.avoid = null;
    m.status = 'idle';
    m.repath = false;
    m.nudging = false;
    m.pathLen = 0;
    return;
  }
  if (!finite3(goal) || !validAvoid(avoid)) {
    diag.warnOnce('ai/bad-input');
    return;
  }
  const prev = m.goal;
  const d =
    prev === null ? Infinity : Math.hypot(goal.x - prev.x, goal.y - prev.y, goal.z - prev.z);
  const need =
    d > T.goalReplanDist ||
    !sameAvoid(m.avoid, avoid) ||
    m.status === 'idle' ||
    m.status === 'stuck' ||
    (m.status === 'no-path' && d > 0);
  if (!need) return;
  copy(goal, m.goalStore);
  m.goal = m.goalStore;
  if (avoid === null) {
    m.avoid = null;
  } else {
    const s = m.avoidStore;
    copy(avoid.center, s.center);
    s.radius = avoid.radius;
    s.penalty = avoid.penalty;
    m.avoid = s;
  }
  copy(m.goalStore, m.dest);
  m.nudging = false;
  m.repath = true;
  m.stage = 0;
  m.repaths = 0;
}

function copyPath(m: BotMotionState, pts: readonly Readonly<Vec3>[], ctx: LocoContext): void {
  const n = Math.min(pts.length, MAX_PATH_POINTS);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (p === undefined) break;
    m.path[3 * i] = p.x;
    m.path[3 * i + 1] = p.y;
    m.path[3 * i + 2] = p.z;
  }
  m.pathLen = n;
  m.waypoint = 0;
  m.truncated = pts.length > MAX_PATH_POINTS;
  if (m.truncated) ctx.diag.count('ai/path-truncated');
}

function pollTicket(m: BotMotionState, ctx: LocoContext): void {
  if (m.goal === null && m.ticket !== null) {
    ctx.paths.cancel(m.ticket);
    m.ticket = null;
  }
  if (m.ticket === null) return;
  const r = ctx.paths.poll(m.ticket);
  if (r === 'pending') return;
  m.ticket = null;
  if (r.ok) {
    copyPath(m, r.value, ctx); // copied in the same call as poll (SD-AI-09)
    m.status = m.pathLen > 0 ? 'moving' : 'arrived';
  } else {
    m.pathLen = 0;
    m.status = 'no-path';
  }
}

function requestPath(m: BotMotionState, ctx: LocoContext): void {
  if (!m.repath || m.goal === null) return;
  m.repath = false;
  let ticketReq;
  if (m.avoid !== null && !m.nudging) {
    ticketReq = m.reqAvoid;
    copy(m.avoid.center, ticketReq.avoid.center);
    ticketReq.avoid.radius = m.avoid.radius;
    ticketReq.avoid.penalty = m.avoid.penalty;
  } else {
    ticketReq = m.reqPlain;
  }
  copy(m.pos, ticketReq.from);
  copy(m.dest, ticketReq.to);
  m.ticket = ctx.paths.request(m.id, ticketReq);
  m.status = 'waiting-path';
  m.pathLen = 0;
  const a = m.scratchA;
  const b = m.scratchB;
  a.x = m.pos.x;
  a.y = m.pos.y + T.waitLosHeight;
  a.z = m.pos.z;
  b.x = m.dest.x;
  b.y = m.dest.y + T.waitLosHeight;
  b.z = m.dest.z;
  m.waitLos = ctx.world.lineOfSight(a, b);
}

function speedFor(m: BotMotionState): number {
  if (m.crouched) return T.crouchSpeed;
  return m.speed === 'run' ? T.runSpeed : T.walkSpeed;
}

/** Sets out.xz to the unit xz direction from `pos` to (x, z) times `speed`. */
function steer(pos: Vec3, x: number, z: number, speed: number, out: Vec3): void {
  const dx = x - pos.x;
  const dz = z - pos.z;
  const l = Math.hypot(dx, dz);
  if (l < 1e-6) return;
  out.x = (dx / l) * speed;
  out.z = (dz / l) * speed;
}

function onPathEnd(m: BotMotionState): void {
  if (m.truncated) {
    m.truncated = false;
    m.repath = true; // continue from the last kept waypoint (BR-AI-62)
    return;
  }
  if (m.nudging) {
    m.nudging = false;
    if (m.goal !== null) copy(m.goal, m.dest);
    m.repath = true;
    return;
  }
  m.status = 'arrived';
}

function follow(m: BotMotionState, ctx: LocoContext, desired: Vec3): void {
  const p = m.path;
  let i = m.waypoint;
  const reached =
    Math.hypot((p[3 * i] ?? 0) - m.pos.x, (p[3 * i + 2] ?? 0) - m.pos.z) <= T.waypointRadius &&
    Math.abs((p[3 * i + 1] ?? 0) - m.pos.y) < T.waypointDy;
  if (reached) {
    i++;
    m.waypoint = i;
    if (i >= m.pathLen) {
      onPathEnd(m);
      return;
    }
  }
  if ((ctx.tick + m.id) % T.lookAheadEveryTicks === 0 && i + 1 < m.pathLen) {
    const next = m.scratchB;
    next.x = p[3 * (i + 1)] ?? 0;
    next.y = p[3 * (i + 1) + 1] ?? 0;
    next.z = p[3 * (i + 1) + 2] ?? 0;
    const cap = m.crouched ? ctx.crouched : ctx.standing;
    // only skip along one level: sweepClear says nothing about climbing to a waypoint above
    if (
      Math.abs(next.y - m.pos.y) <= ctx.stepHeight &&
      ctx.world.sweepClear(m.pos, next, cap, ctx.stepHeight)
    ) {
      i++;
      m.waypoint = i;
    }
  }
  steer(m.pos, p[3 * i] ?? 0, p[3 * i + 2] ?? 0, speedFor(m), desired);
}

function integrate(m: BotMotionState, ctx: LocoContext, desired: Vec3): void {
  const k = T.accel * ctx.dt;
  let dvx = desired.x - m.vel.x;
  let dvz = desired.z - m.vel.z;
  const l = Math.hypot(dvx, dvz);
  if (l > k && l > 0) {
    dvx *= k / l;
    dvz *= k / l;
  }
  m.vel.x += dvx;
  m.vel.z += dvz;
  if (!m.grounded) m.vel.y = Math.max(m.vel.y - T.gravity * ctx.dt, -T.terminalSpeed);
  let cap = ctx.standing;
  if (m.crouch) {
    cap = ctx.crouched;
  } else if (m.crouched && !ctx.world.capsuleFits(m.pos, ctx.standing)) {
    cap = ctx.crouched; // BR-AI-67: stand only where the standing capsule fits
  }
  m.crouched = cap === ctx.crouched;
  const r = ctx.world.moveCapsule(m.pos, m.vel, cap, ctx.dt, ctx.stepHeight, m.move);
  copy(r.position, m.pos);
  copy(r.velocity, m.vel);
  m.grounded = r.grounded;
  if (Math.hypot(m.vel.x, m.vel.z) > T.faceSpeed) m.yaw = Math.atan2(-m.vel.x, -m.vel.z);
}

/** One tick of movement for one alive bot. Bad state makes the bot inert for the tick. */
export function stepBotMotion(m: BotMotionState, ctx: LocoContext): void {
  if (
    !finite3(m.pos) ||
    !finite3(m.vel) ||
    !isFiniteNum(ctx.dt) ||
    ctx.dt <= 0 ||
    !isFiniteNum(ctx.tick)
  ) {
    ctx.diag.warnOnce('ai/bad-input');
    m.vel.x = 0;
    m.vel.y = 0;
    m.vel.z = 0;
    m.status = 'stuck';
    return;
  }
  pollTicket(m, ctx);
  requestPath(m, ctx);
  const desired = m.scratchA;
  desired.x = 0;
  desired.y = 0;
  desired.z = 0;
  if (m.status === 'moving') follow(m, ctx, desired);
  else if (m.status === 'waiting-path' && m.waitLos)
    steer(m.pos, m.dest.x, m.dest.z, speedFor(m), desired);
  addSeparation(m.id, m.pos, ctx.neighbours, desired);
  integrate(m, ctx, desired);
  watchdog(m, ctx);
}

/** Cancels the bot's ticket (death, round end). */
export function releaseMotion(m: BotMotionState, ctx: Pick<LocoContext, 'paths'>): void {
  if (m.ticket !== null) ctx.paths.cancel(m.ticket);
  m.ticket = null;
  m.goal = null;
  m.status = 'idle';
  m.pathLen = 0;
}
