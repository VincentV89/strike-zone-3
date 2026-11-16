/**
 * Seeded fuzz of the navigation tick path (SD-CN-08..10): nearestNode,
 * reachable, neighbours and the path service never throw, waypoints are
 * finite, and only listed diagnostics codes reach the sink, once each.
 */
import { describe, expect, it } from 'vitest';
import { botId, createDiagnostics, createRng, type Rng } from '../../src/core';
import { getMap, MAP_RULES } from '../../src/maps';
import { bakeNavGraph, createPathService, NAV_DIAGNOSTIC_CODES } from '../../src/nav';
import { buildCollisionWorld } from '../../src/physics';

const SPECIAL = [Number.NaN, Infinity, -Infinity, 1e300, -0];
const num = (rng: Rng, lo: number, hi: number): number =>
  rng.next() < 0.05 ? (SPECIAL[rng.int(0, SPECIAL.length)] ?? 0) : rng.range(lo, hi);

describe.each(['desert-compound', 'industrial-warehouse'] as const)('nav fuzz on %s', (id) => {
  it('never throws and never returns non-finite waypoints', () => {
    const codes: string[] = [];
    const diagnostics = createDiagnostics((c) => codes.push(c));
    const def = getMap(id);
    const world = buildCollisionWorld(def);
    const graph = bakeNavGraph(def, world, {
      agent: { radius: MAP_RULES.agentRadius, height: MAP_RULES.agentHeight },
      diagnostics,
    });
    const ps = createPathService(graph, world, { diagnostics });
    const rng = createRng(7);
    const tickets = [];
    for (let i = 0; i < 2000; i++) {
      const p = { x: num(rng, -50, 50), y: num(rng, -1, 8), z: num(rng, -50, 50) };
      const q = { x: num(rng, -50, 50), y: num(rng, -1, 8), z: num(rng, -50, 50) };
      const near = graph.nearestNode(p);
      expect(near === null || Number.isInteger(near)).toBe(true);
      const a = rng.next() < 0.1 ? num(rng, -10, 1e4) : rng.int(0, graph.nodes.length);
      const b = rng.int(0, graph.nodes.length);
      expect(typeof graph.reachable(a, b)).toBe('boolean');
      expect(Array.isArray(graph.neighbours(a))).toBe(true);
      if (i % 20 === 0) {
        const avoid =
          rng.next() < 0.3
            ? {
                center: { x: num(rng, -50, 50), y: 0, z: 0 },
                radius: num(rng, -5, 10),
                penalty: num(rng, -1, 10),
              }
            : undefined;
        tickets.push(
          ps.request(botId(rng.int(1, 30)), { from: p, to: q, ...(avoid ? { avoid } : {}) }),
        );
        ps.tick();
      }
    }
    for (let t = 0; t < 60; t++) ps.tick();
    for (const t of tickets) {
      const r = ps.poll(t);
      if (r !== 'pending' && r.ok) {
        for (const w of r.value) {
          expect(Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.z)).toBe(true);
        }
      }
    }
    const listed: readonly string[] = NAV_DIAGNOSTIC_CODES;
    expect(codes.every((c) => listed.includes(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('nav/non-finite-input');
    expect(codes).toContain('nav/bad-node-id');
  });
});
