/** PathService (BR-CN-71..85, SD-CN-14..16). */
import { describe, expect, it } from 'vitest';
import {
  botId,
  createDiagnostics,
  StrikeZoneError,
  type EntityId,
  type Vec3,
} from '../../src/core';
import { MAP_RULES } from '../../src/maps';
import {
  bakeNavGraph,
  createPathService,
  type NavGraph,
  type PathResult,
  type PathService,
  type PathTicket,
} from '../../src/nav';
import { buildCollisionWorld } from '../../src/physics';
import { STANDING, fixtureMap, vec } from '../physics/fixtures';

const def = fixtureMap();
const world = buildCollisionWorld(def);
const graph = bakeNavGraph(def, world, { agent: STANDING });
const bot = (n: number): EntityId => botId(n);

function solve(ps: PathService, t: PathTicket, maxTicks = 50): PathResult {
  for (let i = 0; i < maxTicks; i++) {
    const r = ps.poll(t);
    if (r !== 'pending') return r;
    ps.tick();
  }
  throw new Error('path never resolved');
}

function waypoints(r: PathResult): Vec3[] {
  if (!r.ok) throw new Error(`expected a path, got ${r.error}`);
  return r.value.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

function pathLength(from: Vec3, pts: readonly Vec3[]): number {
  let len = 0;
  let prev = from;
  for (const p of pts) {
    len += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    prev = p;
  }
  return len;
}

describe('path requests', () => {
  it('is pending in the request tick and resolves on tick() (BR-CN-81)', () => {
    const ps = createPathService(graph, world);
    const t = ps.request(bot(1), { from: vec(-8, 0, -8), to: vec(8, 0, -2) });
    expect(ps.poll(t)).toBe('pending');
    ps.tick();
    expect(ps.poll(t)).not.toBe('pending');
  });

  it('ends exactly at `to`, excludes `from`, and every leg is sweepClear (BR-CN-75, BR-CN-76)', () => {
    const ps = createPathService(graph, world);
    const from = vec(-8, 0, -8);
    const to = vec(7, 2, 3);
    const pts = waypoints(solve(ps, ps.request(bot(1), { from, to })));
    expect(pts.at(-1)).toEqual(to);
    expect(pts[0]).not.toEqual(from);
    let prev = from;
    for (const p of pts) {
      expect(world.sweepClear(prev, p, STANDING, MAP_RULES.stepHeight)).toBe(true);
      prev = p;
    }
  });

  it('string-pulls an open straight line to the single waypoint `to`', () => {
    const ps = createPathService(graph, world);
    const pts = waypoints(
      solve(ps, ps.request(bot(1), { from: vec(-3, 0, -2), to: vec(3, 0, -2) })),
    );
    expect(pts).toEqual([vec(3, 0, -2)]);
  });

  it('routes through the doorway around the wall', () => {
    const ps = createPathService(graph, world);
    const from = vec(-8, 0, 1);
    const to = vec(-8, 0, 5);
    const pts = waypoints(solve(ps, ps.request(bot(1), { from, to })));
    expect(pathLength(from, pts)).toBeGreaterThan(4);
  });

  it('returns NO_PATH to the island and OFF_GRAPH from inside a wall (BR-CN-71, BR-CN-72)', () => {
    const ps = createPathService(graph, world);
    const island = solve(ps, ps.request(bot(1), { from: vec(-8, 0, -8), to: vec(-2, 1.2, 7) }));
    expect(island).toEqual({ ok: false, error: 'NO_PATH' });
    const wall = solve(ps, ps.request(bot(2), { from: vec(-5, 0, -5), to: vec(3, 0, -2) }));
    expect(wall).toEqual({ ok: false, error: 'OFF_GRAPH' });
  });

  it('detours around an avoid zone and ignores a malformed one (BR-CN-74)', () => {
    const codes: string[] = [];
    const ps = createPathService(graph, world, {
      diagnostics: createDiagnostics((c) => codes.push(c)),
    });
    const from = vec(-3, 0, -2);
    const to = vec(3, 0, -2);
    const avoided = waypoints(
      solve(
        ps,
        ps.request(bot(1), { from, to, avoid: { center: vec(0, 0, -2), radius: 2, penalty: 10 } }),
      ),
    );
    expect(avoided.length).toBeGreaterThan(1);
    expect(avoided.some((p) => Math.hypot(p.x, p.z + 2) > 2)).toBe(true);
    const bad = waypoints(
      solve(
        ps,
        ps.request(bot(2), { from, to, avoid: { center: vec(0, 0, -2), radius: -1, penalty: 10 } }),
      ),
    );
    expect(bad).toEqual([to]);
    expect(codes).toEqual(['nav/bad-avoid']);
  });

  it('resolves a non-finite request as OFF_GRAPH and reports it once', () => {
    const codes: string[] = [];
    const ps = createPathService(graph, world, {
      diagnostics: createDiagnostics((c) => codes.push(c)),
    });
    const r = solve(ps, ps.request(bot(1), { from: vec(Number.NaN, 0, 0), to: vec(1, 0, 1) }));
    expect(r).toEqual({ ok: false, error: 'OFF_GRAPH' });
    solve(ps, ps.request(bot(2), { from: vec(0, 0, 0), to: vec(Infinity, 0, 1) }));
    expect(codes).toEqual(['nav/non-finite-input']);
  });
});

describe('scheduling', () => {
  it('serves at most maxPathsPerTick searches per tick (ADR-006)', () => {
    const ps = createPathService(graph, world);
    const tickets = [1, 2, 3, 4, 5].map((n) =>
      ps.request(bot(n), { from: vec(-8, 0, -8 + n), to: vec(8, 0, -3 + n) }),
    );
    ps.tick();
    expect(tickets.filter((t) => ps.poll(t) !== 'pending')).toHaveLength(2);
    expect(ps.stats.queued).toBe(3);
    ps.tick();
    ps.tick();
    expect(tickets.every((t) => ps.poll(t) !== 'pending')).toBe(true);
    expect(ps.stats.solved).toBe(5);
  });

  it('drains a 20-bot repath burst within 10 ticks (PR-CN-08)', () => {
    const ps = createPathService(graph, world);
    const tickets = Array.from({ length: 20 }, (_, i) =>
      ps.request(bot(i + 1), {
        from: vec(-8 + (i % 5) * 0.5, 0, -8 + Math.floor(i / 5)),
        to: vec(8, 0, 8 - i * 0.3),
      }),
    );
    for (let tick = 0; tick < 10; tick++) ps.tick();
    expect(tickets.every((t) => ps.poll(t) !== 'pending')).toBe(true);
  });

  it('serves cache hits without spending the search budget (BR-CN-82)', () => {
    const ps = createPathService(graph, world);
    const req = { from: vec(-8, 0, -8), to: vec(8, 0, 8) };
    solve(ps, ps.request(bot(1), req));
    expect(ps.stats.solved).toBe(1);
    const tickets = [2, 3, 4, 5].map((n) => ps.request(bot(n), req));
    ps.tick();
    expect(tickets.every((t) => ps.poll(t) !== 'pending')).toBe(true);
    expect(ps.stats.cacheHits).toBe(4);
    expect(ps.stats.solved).toBe(1);
    const first = solve(ps, ps.request(bot(6), req));
    expect(waypoints(first)).toEqual(waypoints(ps.poll(tickets[0] as PathTicket) as PathResult));
  });

  it('supersedes the previous ticket of an entity and cancels cleanly (BR-CN-80, BR-CN-84)', () => {
    const ps = createPathService(graph, world);
    const old = ps.request(bot(1), { from: vec(-8, 0, -8), to: vec(8, 0, 8) });
    const fresh = ps.request(bot(1), { from: vec(-8, 0, -8), to: vec(3, 0, -2) });
    expect(fresh.id).toBeGreaterThan(old.id);
    expect(ps.poll(old)).toEqual({ ok: false, error: 'NO_PATH' });
    ps.tick();
    expect(ps.poll(fresh)).not.toBe('pending');
    expect(ps.stats.solved).toBe(1);
    ps.cancel(fresh);
    expect(ps.poll(fresh)).toEqual({ ok: false, error: 'NO_PATH' });
    ps.cancel(fresh);
    ps.cancel(old);
  });

  it('drops requests past 64 live tickets with nav/queue-full once (BR-CN-83, SD-CN-15)', () => {
    const codes: string[] = [];
    const ps = createPathService(graph, world, {
      diagnostics: createDiagnostics((c) => codes.push(c)),
    });
    const tickets = Array.from({ length: 1000 }, (_, i) =>
      ps.request(bot(i + 1), { from: vec(-8, 0, -8), to: vec(8, 0, 8) }),
    );
    expect(ps.stats.queued).toBe(64);
    expect(ps.stats.dropped).toBe(936);
    expect(ps.poll(tickets[999] as PathTicket)).toEqual({ ok: false, error: 'NO_PATH' });
    expect(codes).toEqual(['nav/queue-full']);
    for (let i = 0; i < 40; i++) ps.tick();
    expect(tickets.slice(0, 64).every((t) => ps.poll(t) !== 'pending')).toBe(true);
  });

  it('keeps the ring consistent when entities churn tickets', () => {
    const ps = createPathService(graph, world);
    for (let round = 0; round < 300; round++) {
      const t = ps.request(bot((round % 7) + 1), {
        from: vec(-8, 0, -8),
        to: vec(3, 0, round % 5),
      });
      if (round % 3 === 0) ps.cancel(t);
      if (round % 4 === 0) ps.tick();
    }
    for (let i = 0; i < 20; i++) ps.tick();
    expect(ps.stats.queued).toBe(0);
  });

  it('is deterministic for the same request script (BR-CN-85)', () => {
    const script = (): unknown[] => {
      const ps = createPathService(graph, world);
      const log: unknown[] = [];
      const live: PathTicket[] = [];
      for (let tick = 0; tick < 30; tick++) {
        if (tick < 20) {
          live.push(
            ps.request(bot((tick % 9) + 1), {
              from: vec(-8, 0, -8 + tick * 0.2),
              to: vec(8 - tick * 0.3, 0, 8),
            }),
          );
          live.push(
            ps.request(bot((tick % 4) + 10), {
              from: vec(7, 2, 3),
              to: vec(-8, 0, 8 - tick * 0.4),
            }),
          );
        }
        ps.tick();
        for (const t of live) {
          const r = ps.poll(t);
          log.push([
            tick,
            t.id,
            r === 'pending' ? 'p' : r.ok ? r.value.map((p) => [p.x, p.y, p.z]) : r.error,
          ]);
        }
      }
      return log;
    };
    expect(script()).toEqual(script());
  });
});

describe('createPathService options', () => {
  it('validates maxPathsPerTick and cacheSize', () => {
    const codeOf = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        return e instanceof StrikeZoneError ? e.code : 'other';
      }
      return 'no-throw';
    };
    expect(codeOf(() => createPathService(graph, world, { maxPathsPerTick: 0 }))).toBe(
      'nav/invalid-options',
    );
    expect(codeOf(() => createPathService(graph, world, { maxPathsPerTick: 9 }))).toBe(
      'nav/invalid-options',
    );
    expect(codeOf(() => createPathService(graph, world, { cacheSize: 1.5 }))).toBe(
      'nav/invalid-options',
    );
    const fake: NavGraph = { ...graph };
    expect(codeOf(() => createPathService(fake, world))).toBe('nav/invalid-options');
  });

  it('resolves everything OFF_GRAPH on a graph with zero nodes (BR-CN-13)', () => {
    const empty = fixtureMap({ solids: [], ramps: [], spawns: [], cover: [], navHints: [] });
    const w = buildCollisionWorld(empty);
    const g = bakeNavGraph(empty, w, { agent: STANDING });
    expect(g.nodes).toHaveLength(0);
    const ps = createPathService(g, w);
    expect(solve(ps, ps.request(bot(1), { from: vec(0, 0, 0), to: vec(1, 0, 1) }))).toEqual({
      ok: false,
      error: 'OFF_GRAPH',
    });
  });

  it('evicts the least recently used cache entry with a small cache', () => {
    const ps = createPathService(graph, world, { cacheSize: 1, maxPathsPerTick: 8 });
    const a = { from: vec(-8, 0, -8), to: vec(8, 0, 8) };
    const b = { from: vec(-8, 0, -8), to: vec(7, 2, 3) };
    solve(ps, ps.request(bot(1), a));
    solve(ps, ps.request(bot(2), b));
    solve(ps, ps.request(bot(3), a));
    expect(ps.stats.cacheHits).toBe(0);
    solve(ps, ps.request(bot(4), a));
    expect(ps.stats.cacheHits).toBe(1);
  });
});
