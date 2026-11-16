/**
 * Real-map navigation checks: H-M-03 (BR-CN-92), H-M-04 (BR-CN-93),
 * H-M-05 (BR-CN-94) and H-M-06 (BR-CN-95), plus bake determinism across step
 * budgets (SD-CN-13).
 */
import { describe, expect, it } from 'vitest';
import { botId, type Vec3 } from '../../src/core';
import type { MapId } from '../../src/contracts';
import { getMap, MAP_RULES } from '../../src/maps';
import {
  bakeNavGraph,
  createNavBaker,
  createPathService,
  navReport,
  type NavGraph,
  type PathResult,
  type PathService,
  type PathTicket,
} from '../../src/nav';
import { buildCollisionWorld, type CollisionWorld } from '../../src/physics';

const STANDING = { radius: MAP_RULES.agentRadius, height: MAP_RULES.agentHeight };
const MAPS: readonly MapId[] = ['desert-compound', 'industrial-warehouse'];

function solve(ps: PathService, t: PathTicket): PathResult {
  for (let i = 0; i < 20; i++) {
    const r = ps.poll(t);
    if (r !== 'pending') return r;
    ps.tick();
  }
  throw new Error('unresolved');
}

function polyline(from: Vec3, r: PathResult): Vec3[] {
  if (!r.ok) return [];
  return [from, ...r.value.map((p) => ({ x: p.x, y: p.y, z: p.z }))];
}

function lengthOf(pts: readonly Vec3[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a !== undefined && b !== undefined) len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
}

/** The point halfway along a polyline. */
function midpoint(pts: readonly Vec3[]): Vec3 {
  const half = lengthOf(pts) / 2;
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined) continue;
    const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (walked + seg >= half) {
      const t = seg > 0 ? (half - walked) / seg : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
    walked += seg;
  }
  return pts.at(-1) ?? { x: 0, y: 0, z: 0 };
}

describe.each(MAPS)('%s', (id) => {
  const def = getMap(id);
  const world: CollisionWorld = buildCollisionWorld(def);
  const graph: NavGraph = bakeNavGraph(def, world, { agent: STANDING });

  it('attaches every spawn, cover point and patrol hint and reaches them all (H-M-03, BR-CN-92)', () => {
    const report = navReport(def, graph);
    expect(report.unattached).toEqual([]);
    expect(report.unreachable).toEqual([]);
    expect(report.ok).toBe(true);
    expect(graph.nodes.length).toBeLessThan(8000);
  });

  it('has a second route between every pair of spawn zones (H-M-04, BR-CN-93)', () => {
    const zones = [...new Set(def.spawns.map((s) => s.zone))];
    // Representative per zone: the spawn closest to the zone centroid.
    const reps = zones.map((zone) => {
      const members = def.spawns.filter((s) => s.zone === zone);
      const cx = members.reduce((a, s) => a + s.pos.x, 0) / members.length;
      const cz = members.reduce((a, s) => a + s.pos.z, 0) / members.length;
      const best = [...members].sort(
        (a, b) => Math.hypot(a.pos.x - cx, a.pos.z - cz) - Math.hypot(b.pos.x - cx, b.pos.z - cz),
      )[0];
      if (best === undefined) throw new Error('empty zone');
      return { x: best.pos.x, y: best.pos.y, z: best.pos.z };
    });
    const ps = createPathService(graph, world, { maxPathsPerTick: 8 });
    const failures: string[] = [];
    reps.forEach((from, i) => {
      reps.forEach((to, j) => {
        if (i === j) return;
        const first = polyline(from, solve(ps, ps.request(botId(1), { from, to })));
        if (first.length === 0) {
          failures.push(`${zones[i] ?? ''}->${zones[j] ?? ''}: no path`);
          return;
        }
        const avoid = { center: midpoint(first), radius: 8, penalty: 10 };
        const second = polyline(from, solve(ps, ps.request(botId(2), { from, to, avoid })));
        if (second.length === 0)
          failures.push(`${zones[i] ?? ''}->${zones[j] ?? ''}: no second route`);
        else if (lengthOf(second) > 1.6 * lengthOf(first)) {
          failures.push(`${zones[i] ?? ''}->${zones[j] ?? ''}: second route too long`);
        }
      });
    });
    expect(failures).toEqual([]);
  });

  it('hides a bot at every cover point from a threat 10 m beyond the cover (H-M-05, BR-CN-94)', () => {
    const exposed = def.cover.flatMap((c, i) => {
      const threat = {
        x: c.pos.x + 10 * c.facing.x,
        y: c.pos.y + MAP_RULES.standEye,
        z: c.pos.z + 10 * c.facing.z,
      };
      const head = { x: c.pos.x, y: c.pos.y + (c.height === 'high' ? 1.6 : 1.1), z: c.pos.z };
      return world.lineOfSight(threat, head) ? [i] : [];
    });
    expect(exposed).toEqual([]);
  });

  it('reaches every elevated feature region from a spawn (H-M-06, BR-CN-95)', () => {
    const regions = def.features.filter(
      (f) => f.feature === 'elevated-position' || f.feature === 'elevated-platform',
    );
    expect(regions.length).toBeGreaterThan(0);
    const spawnNode = graph.anchorNode('spawns', 0);
    expect(spawnNode).not.toBeNull();
    const missing = regions.flatMap((f) => {
      const { min, max } = f.region;
      const inside = graph.nodes.filter(
        (n) =>
          n.pos.x >= min.x &&
          n.pos.x <= max.x &&
          n.pos.z >= min.z &&
          n.pos.z <= max.z &&
          n.pos.y >= min.y - 0.01 &&
          n.pos.y <= max.y + 0.01 &&
          n.pos.y > 0.5,
      );
      const reached = inside.some((n) => spawnNode !== null && graph.reachable(spawnNode, n.id));
      return reached ? [] : [f.label];
    });
    expect(missing).toEqual([]);
  });

  it('bakes the same graph for step budgets 1e9, 8 and 0.001 ms (BR-CN-67, SD-CN-13)', () => {
    const fp = (g: NavGraph): string =>
      JSON.stringify([
        g.nodes.map((n) => [n.pos.x, n.pos.y, n.pos.z, n.component, n.kind]),
        g.nodes.map((n) => g.neighbours(n.id)),
        def.spawns.map((_, i) => g.anchorNode('spawns', i)),
        def.cover.map((_, i) => g.anchorNode('cover', i)),
      ]);
    const reference = fp(graph);
    for (const budget of [8, 0.001]) {
      let t = 0;
      const baker = createNavBaker(def, world, { agent: STANDING });
      while (!baker.step(budget, () => (t += 0.01))) {
        // keep stepping
      }
      expect(fp(baker.result())).toBe(reference);
    }
  });
});
