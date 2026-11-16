/**
 * bot-locomotion (story-bots-patrol, story-bots-unstuck; BR-AI-60..68, SD-AI-09).
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT, createDiagnostics, ok, vec3, type EntityId, type Vec3 } from '../../src/core';
import { MAP_RULES } from '../../src/maps';
import type { PathRequest, PathResult, PathService } from '../../src/nav';
import type { CollisionWorld } from '../../src/physics';
import {
  LOCOMOTION_TUNING,
  MAX_PATH_POINTS,
  addSeparation,
  createBotMotion,
  releaseMotion,
  setGoal,
  stepBotMotion,
  type BotMotionState,
  type LocoContext,
  type NeighbourView,
} from '../../src/ai/locomotion';
import { box } from '../physics/fixtures';
import { recordingDiag, strictDiag } from '../sim/helpers';
import { countingPaths, zeroCounts } from './counting';
import { arena, must, pathService, prepare, v } from './fixtures';
import { CROUCHED, STANDING } from './harness';

const id = (n: number): EntityId => n as EntityId;
const open = prepare(arena());
const walled = prepare(arena({ solids: [box('wall', [-10, 0, -0.2], [10, 3, 0.2])] }));

function ctxFor(prep = open, over: Partial<LocoContext> = {}): LocoContext {
  return {
    tick: 0,
    dt: TICK_DT,
    world: prep.world,
    paths: pathService(prep),
    graph: prep.graph,
    neighbours: [],
    standing: STANDING,
    crouched: CROUCHED,
    stepHeight: MAP_RULES.stepHeight,
    diag: strictDiag(),
    ...over,
  };
}

function run(m: BotMotionState, ctx: LocoContext, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    ctx.tick++;
    ctx.paths.tick();
    stepBotMotion(m, ctx);
  }
}

/** A world that forwards to `base` except for the overridden queries. */
function wrap(base: CollisionWorld, over: Partial<CollisionWorld>): CollisionWorld {
  return {
    moveCapsule: over.moveCapsule ?? ((...a) => base.moveCapsule(...a)),
    raycast: (...a) => base.raycast(...a),
    lineOfSight: (a, b) => base.lineOfSight(a, b),
    capsuleFits: over.capsuleFits ?? ((p, c) => base.capsuleFits(p, c)),
    sweepClear: over.sweepClear ?? ((...a) => base.sweepClear(...a)),
    separate: (...a) => base.separate(...a),
    bounds: base.bounds,
    shapeCount: base.shapeCount,
  };
}

/** A path service that answers every request with a fixed list. */
function fixedPaths(points: readonly Vec3[]): PathService & { requests: PathRequest[] } {
  const requests: PathRequest[] = [];
  let n = 0;
  const value: PathResult = ok(points);
  return {
    requests,
    request(entity, req) {
      requests.push({
        from: vec3(req.from.x, req.from.y, req.from.z),
        to: vec3(req.to.x, req.to.y, req.to.z),
      });
      return { id: ++n, entity };
    },
    poll: () => value,
    cancel: () => undefined,
    tick: () => undefined,
    stats: { solved: 0, cacheHits: 0, queued: 0, dropped: 0 },
  };
}

describe('capsule copies (SD-AI-06)', () => {
  it('uses the MAP_RULES dimensions the player uses', () => {
    expect(STANDING).toEqual({ radius: MAP_RULES.agentRadius, height: MAP_RULES.agentHeight });
    expect(CROUCHED.height).toBe(MAP_RULES.crouchHeight);
    expect(Object.isFrozen(LOCOMOTION_TUNING)).toBe(true);
  });
});

describe('setGoal (BR-AI-61)', () => {
  it('requests a path for a new goal and keeps it for a goal moved less than 1 m', () => {
    const ctx = ctxFor();
    const counts = zeroCounts();
    ctx.paths = countingPaths(ctx.paths, counts);
    const m = createBotMotion(id(1), v(0, 0, 0), 0);
    setGoal(m, v(10, 0, 0), null, 'run', ctx.diag);
    run(m, ctx, 2);
    expect(counts.requests).toBe(1);
    setGoal(m, v(10.5, 0, 0.5), null, 'run', ctx.diag);
    run(m, ctx, 2);
    expect(counts.requests).toBe(1);
    setGoal(m, v(12, 0, 0), null, 'run', ctx.diag);
    run(m, ctx, 2);
    expect(counts.requests).toBe(2);
    setGoal(m, v(12, 0, 0), { center: v(5, 0, 0), radius: 3, penalty: 4 }, 'run', ctx.diag);
    run(m, ctx, 2);
    expect(counts.requests).toBe(3);
    setGoal(m, v(12, 0, 0), { center: v(5, 0, 0), radius: 3, penalty: 4 }, 'run', ctx.diag);
    run(m, ctx, 2);
    expect(counts.requests).toBe(3);
  });

  it('goes idle on a null goal and cancels the ticket', () => {
    const ctx = ctxFor();
    const m = createBotMotion(id(1), v(0, 0, 0), 0);
    setGoal(m, v(10, 0, 0), null, 'walk', ctx.diag);
    stepBotMotion(m, ctx);
    expect(m.ticket).not.toBeNull();
    setGoal(m, null, null, 'walk', ctx.diag);
    stepBotMotion(m, ctx);
    expect(m.status).toBe('idle');
    expect(m.ticket).toBeNull();
  });

  it('rejects a non-finite goal and keeps the old one', () => {
    const diag = recordingDiag();
    const m = createBotMotion(id(1), v(0, 0, 0), 0);
    setGoal(m, v(3, 0, 0), null, 'walk', diag);
    setGoal(m, v(NaN, 0, 0), null, 'walk', diag);
    setGoal(m, v(9, 0, 0), { center: v(Infinity, 0, 0), radius: 1, penalty: 1 }, 'walk', diag);
    expect(m.goal).toEqual({ x: 3, y: 0, z: 0 });
    expect(diag.codes).toEqual(['ai/bad-input']);
  });
});

describe('following a path (BR-AI-60, BR-AI-62)', () => {
  it('walks to a goal across open ground with one moveCapsule per tick and arrives', () => {
    const ctx = ctxFor();
    let moves = 0;
    const w = ctx.world;
    ctx.world = wrap(w, {
      moveCapsule: (...a) => {
        moves++;
        return w.moveCapsule(...a);
      },
    });
    const m = createBotMotion(id(1), v(-10, 0, -10), 0);
    setGoal(m, v(10, 0, 10), null, 'run', ctx.diag);
    run(m, ctx, 60 * 8);
    expect(m.status).toBe('arrived');
    expect(Math.hypot(m.pos.x - 10, m.pos.z - 10)).toBeLessThan(0.6);
    expect(moves).toBe(60 * 8);
  });

  it('goes around a wall and never ends inside it', () => {
    const ctx = ctxFor(walled);
    const m = createBotMotion(id(1), v(0, 0, -5), 0);
    setGoal(m, v(0, 0, 5), null, 'run', ctx.diag);
    for (let i = 0; i < 60 * 12; i++) {
      run(m, ctx, 1);
      expect(Math.abs(m.pos.z) > 0.2 + 0.35 || Math.abs(m.pos.x) > 10 + 0.35).toBe(true);
    }
    expect(m.status).toBe('arrived');
  });

  it('copies the poll view into its own buffer before anything else (SD-AI-09)', () => {
    const ctx = ctxFor();
    const a = createBotMotion(id(1), v(-10, 0, 0), 0);
    const b = createBotMotion(id(2), v(10, 0, 0), 0);
    setGoal(a, v(-10, 0, 10), null, 'walk', ctx.diag);
    run(a, ctx, 3);
    const copyOfA = Array.from(a.path.slice(0, 3 * a.pathLen));
    setGoal(b, v(10, 0, -10), null, 'walk', ctx.diag);
    run(b, ctx, 3);
    expect(Array.from(a.path.slice(0, 3 * a.pathLen))).toEqual(copyOfA);
  });

  it('truncates long paths to 64 points, counts it and repaths at the end', () => {
    const counted = createDiagnostics(() => undefined);
    const long = Array.from({ length: 100 }, (_, i) => v(-20 + i * 0.3, 0, 0));
    const paths = fixedPaths(long);
    const ctx = ctxFor(open, { paths, diag: counted });
    const m = createBotMotion(id(1), v(-20.2, 0, 0), 0);
    setGoal(m, v(10, 0, 0), null, 'run', counted);
    run(m, ctx, 2);
    expect(m.pathLen).toBe(MAX_PATH_POINTS);
    expect(m.truncated).toBe(true);
    expect(counted.snapshot()['ai/path-truncated']).toBe(1);
    run(m, ctx, 60 * 6);
    expect(paths.requests.length).toBeGreaterThan(1);
    expect(must(paths.requests[1]).from.x).toBeGreaterThan(-3);
  });

  it('moves straight toward a visible goal while the ticket is pending (BR-AI-63)', () => {
    const pending: PathService = {
      request: (e) => ({ id: 1, entity: e }),
      poll: () => 'pending',
      cancel: () => undefined,
      tick: () => undefined,
      stats: { solved: 0, cacheHits: 0, queued: 0, dropped: 0 },
    };
    const m = createBotMotion(id(1), v(0, 0, 5), 0);
    const ctx = ctxFor(walled, { paths: pending });
    setGoal(m, v(10, 0, 10), null, 'walk', ctx.diag);
    run(m, ctx, 30);
    expect(m.status).toBe('waiting-path');
    expect(m.waitLos).toBe(true);
    expect(m.pos.x).toBeGreaterThan(0.5);
    const blocked = createBotMotion(id(2), v(0, 0, 5), 0);
    setGoal(blocked, v(0, 0, -5), null, 'walk', ctx.diag);
    run(blocked, ctx, 30);
    expect(blocked.waitLos).toBe(false);
    expect(Math.hypot(blocked.pos.x, blocked.pos.z - 5)).toBeLessThan(0.05);
  });

  it('reports no-path when the service says so', () => {
    const none: PathService = {
      request: (e) => ({ id: 1, entity: e }),
      poll: () => ({ ok: false, error: 'NO_PATH' }),
      cancel: () => undefined,
      tick: () => undefined,
      stats: { solved: 0, cacheHits: 0, queued: 0, dropped: 0 },
    };
    const ctx = ctxFor(open, { paths: none });
    const m = createBotMotion(id(1), v(0, 0, 0), 0);
    setGoal(m, v(5, 0, 0), null, 'walk', ctx.diag);
    run(m, ctx, 2);
    expect(m.status).toBe('no-path');
    setGoal(m, v(5, 0, 0), null, 'walk', ctx.diag);
    expect(m.repath).toBe(false); // same goal: no new request
    setGoal(m, v(5.5, 0, 0), null, 'walk', ctx.diag);
    expect(m.repath).toBe(true); // goal changed after no-path
  });
});

describe('crouch (BR-AI-67)', () => {
  it('stays crouched under a low ceiling and stands up in the open', () => {
    const roofed = prepare(arena({ solids: [box('wall', [-2, 1.5, -2], [2, 3, 2])] }));
    const ctx = ctxFor(roofed);
    const m = createBotMotion(id(1), v(0, 0, 0), 0);
    m.crouch = true;
    run(m, ctx, 3);
    expect(m.crouched).toBe(true);
    m.crouch = false;
    run(m, ctx, 3);
    expect(m.crouched).toBe(true);
    const free = createBotMotion(id(2), v(10, 0, 10), 0);
    free.crouch = true;
    run(free, ctx, 2);
    free.crouch = false;
    run(free, ctx, 2);
    expect(free.crouched).toBe(false);
  });
});

describe('separation (BR-AI-64)', () => {
  const n = (i: number, pos: Vec3, alive = true): NeighbourView => ({ id: id(i), pos, alive });

  it('pushes away from close alive neighbours, clamped to 2 m/s', () => {
    const out = addSeparation(id(1), v(0, 0, 0), [n(2, v(0.6, 0, 0))], vec3());
    expect(out.x).toBeCloseTo(-((1.2 - 0.6) / 1.2) * 2.5);
    const crowd = addSeparation(
      id(1),
      v(0, 0, 0),
      [n(2, v(0.1, 0, 0)), n(3, v(0.1, 0, 0.01))],
      vec3(),
    );
    expect(Math.hypot(crowd.x, crowd.z)).toBeCloseTo(LOCOMOTION_TUNING.separationMax);
  });

  it('ignores itself, dead and distant bots, and splits coincident bots by id', () => {
    const none = addSeparation(
      id(1),
      v(0, 0, 0),
      [n(1, v(0, 0, 0)), n(2, v(0.5, 0, 0), false), n(3, v(5, 0, 0))],
      vec3(),
    );
    expect(none).toEqual({ x: 0, y: 0, z: 0 });
    const low = addSeparation(id(1), v(0, 0, 0), [n(2, v(0, 0, 0))], vec3());
    const high = addSeparation(id(2), v(0, 0, 0), [n(1, v(0, 0, 0))], vec3());
    expect(low.x).toBeGreaterThan(0);
    expect(high.x).toBeLessThan(0);
  });
});

describe('stuck watchdog (BR-AI-65, FD-AI-Q2)', () => {
  /** A world whose moveCapsule never moves the bot. */
  function frozenWorld(base: CollisionWorld, fits = true): CollisionWorld {
    return wrap(base, {
      moveCapsule: (pos, _vel, _c, _dt, _s, out) => {
        const r = out ?? {
          position: vec3(),
          velocity: vec3(),
          grounded: true,
          hitCeiling: false,
          landed: false,
        };
        r.position.x = pos.x;
        r.position.y = pos.y;
        r.position.z = pos.z;
        r.velocity.x = 0;
        r.velocity.y = 0;
        r.velocity.z = 0;
        r.grounded = true;
        return r;
      },
      sweepClear: () => false,
      capsuleFits: () => fits,
    });
  }

  it('escalates repath, repath, nudge, snap and then reports stuck', () => {
    const diag = createDiagnostics(() => undefined);
    const ctx = ctxFor(open, { world: frozenWorld(open.world), diag });
    const counts = zeroCounts();
    ctx.paths = countingPaths(ctx.paths, counts);
    const m = createBotMotion(id(1), v(0.3, 0, 0.2), 0);
    setGoal(m, v(15, 0, 15), null, 'run', diag);
    const statuses = new Set<string>();
    for (let i = 0; i < 90 * 6 && m.status !== 'stuck'; i++) {
      run(m, ctx, 1);
      statuses.add(m.status);
    }
    expect(m.status).toBe('stuck');
    expect(counts.requests).toBeGreaterThanOrEqual(4); // first + 2 repaths + nudge
    expect(m.repaths).toBe(2);
    expect(diag.snapshot()['ai/stuck-snap']).toBe(1);
    const node = must(open.graph.nodes[must(open.graph.nearestNode(v(0.3, 0, 0.2)))]);
    expect(m.pos).toEqual(node.pos);
    // the next goal (any goal) starts over
    setGoal(m, v(15, 0, 15), null, 'run', diag);
    expect(m.repath).toBe(true);
    expect(m.stage).toBe(0);
  });

  it('counts ai/stuck-unresolved when the snap node does not fit', () => {
    const diag = createDiagnostics(() => undefined);
    const ctx = ctxFor(open, { world: frozenWorld(open.world, false), diag });
    const m = createBotMotion(id(1), v(0.3, 0, 0.2), 0);
    setGoal(m, v(15, 0, 15), null, 'run', diag);
    for (let i = 0; i < 90 * 6 && m.status !== 'stuck'; i++) run(m, ctx, 1);
    expect(diag.snapshot()['ai/stuck-unresolved']).toBe(1);
    expect(m.pos).toEqual({ x: 0.3, y: 0, z: 0.2 });
  });

  it('does not run while waiting for a path or after arriving', () => {
    const ctx = ctxFor(open, { world: frozenWorld(open.world) });
    const m = createBotMotion(id(1), v(0, 0, 0), 0);
    run(m, ctx, 400);
    expect(m.stage).toBe(0);
    expect(m.status).toBe('idle');
  });
});

describe('bad input and release (BR-AI-81)', () => {
  it('makes the bot inert for the tick on a non-finite position or dt', () => {
    const diag = recordingDiag();
    const ctx = ctxFor(open, { diag });
    const m = createBotMotion(id(1), v(0, 0, 0), NaN);
    expect(m.yaw).toBe(0);
    m.vel.x = 3;
    m.pos.x = NaN;
    stepBotMotion(m, ctx);
    expect(m.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(m.status).toBe('stuck');
    const n = createBotMotion(id(2), v(0, 0, 0), 0);
    stepBotMotion(n, { ...ctx, dt: 0 });
    expect(n.status).toBe('stuck');
    expect(diag.codes).toEqual(['ai/bad-input']);
  });

  it('releaseMotion cancels the ticket and goes idle', () => {
    const ctx = ctxFor();
    const m = createBotMotion(id(1), v(0, 0, 0), 0);
    setGoal(m, v(10, 0, 0), null, 'walk', ctx.diag);
    stepBotMotion(m, ctx);
    releaseMotion(m, ctx);
    expect(m.ticket).toBeNull();
    expect(m.status).toBe('idle');
    expect(m.goal).toBeNull();
  });
});
