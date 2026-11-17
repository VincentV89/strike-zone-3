/** Nav bake and graph (BR-CN-60..70, SD-CN-04, SD-CN-06). */
import { describe, expect, it } from 'vitest';
import { createDiagnostics, StrikeZoneError } from '../../src/core';
import { MAP_RULES } from '../../src/maps';
import { bakeNavGraph, createNavBaker, NAV_DIAGNOSTIC_CODES, type NavGraph } from '../../src/nav';
import { buildCollisionWorld } from '../../src/physics';
import { STANDING, box, fixtureMap, vec } from '../physics/fixtures';

const def = fixtureMap();
const world = buildCollisionWorld(def);
const opts = { agent: STANDING };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof StrikeZoneError) return e.code;
    throw e;
  }
  return 'no-throw';
}

/** Everything observable about a graph, for equality checks. */
export function fingerprint(g: NavGraph): unknown {
  return {
    nodes: g.nodes.map((n) => [n.pos.x, n.pos.y, n.pos.z, n.kind, n.component, n.anchor]),
    links: g.nodes.map((n) => g.neighbours(n.id)),
    comps: g.componentCount,
    edges: g.edgeCount,
    anchors: [
      ...def.spawns.map((_, i) => g.anchorNode('spawns', i)),
      ...def.cover.map((_, i) => g.anchorNode('cover', i)),
      ...def.navHints.map((_, i) => g.anchorNode('navHints', i)),
    ],
  };
}

describe('bakeNavGraph on the fixture', () => {
  const graph = bakeNavGraph(def, world, opts);

  it('puts anchors first, in spawns, cover, hints order (BR-CN-60)', () => {
    const anchors = graph.nodes.filter((n) => n.kind === 'anchor');
    expect(anchors.map((n) => n.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(anchors.map((n) => n.anchor)).toEqual([
      { list: 'spawns', index: 0 },
      { list: 'spawns', index: 1 },
      { list: 'spawns', index: 2 },
      { list: 'cover', index: 0 },
      { list: 'navHints', index: 0, hint: 'patrol' },
      { list: 'navHints', index: 1, hint: 'seed' },
    ]);
    expect(graph.anchorNode('spawns', 2)).toBe(2);
    expect(graph.anchorNode('navHints', 1)).toBe(5);
    expect(graph.anchorNode('spawns', 99)).toBeNull();
    expect(graph.anchorNode('spawns', 0.5)).toBeNull();
  });

  it('places grid nodes only where a standing agent fits, ramps included', () => {
    for (const n of graph.nodes) expect(world.capsuleFits(n.pos, STANDING)).toBe(true);
    expect(graph.nodes.some((n) => n.kind === 'ramp')).toBe(true);
    expect(graph.nodes.some((n) => n.kind === 'grid' && n.pos.y === 2)).toBe(true);
  });

  it('links nodes with walkable edges both ways and caps neighbours at 12 (BR-CN-64)', () => {
    let edges = 0;
    for (const n of graph.nodes) {
      const nb = graph.neighbours(n.id);
      expect(nb.length).toBeLessThanOrEqual(12);
      expect([...nb]).toEqual([...nb].sort((a, b) => a - b));
      for (const m of nb) {
        const other = graph.nodes[m];
        if (other === undefined) throw new Error('missing node');
        expect(world.sweepClear(n.pos, other.pos, STANDING, MAP_RULES.stepHeight)).toBe(true);
        expect(graph.neighbours(m)).toContain(n.id);
        edges++;
      }
    }
    expect(edges / 2).toBe(graph.edgeCount);
  });

  it('connects the ramp to the platform and isolates the island (BR-CN-66)', () => {
    const ground = graph.anchorNode('spawns', 0);
    const platform = graph.anchorNode('spawns', 2);
    const island = graph.nodes.find((n) => n.pos.y === 1.2);
    expect(ground).not.toBeNull();
    expect(platform).not.toBeNull();
    expect(island).toBeDefined();
    if (ground === null || platform === null || island === undefined) return;
    expect(graph.reachable(ground, platform)).toBe(true);
    expect(graph.reachable(ground, island.id)).toBe(false);
    expect(graph.componentCount).toBeGreaterThanOrEqual(2);
    // Component ids follow each component's lowest node id.
    expect(graph.nodes[0]?.component).toBe(0);
  });

  it('nearestNode is geometric with ties to the lower id (BR-CN-70)', () => {
    const n0 = graph.nodes[0];
    if (n0 === undefined) throw new Error('no nodes');
    expect(graph.nearestNode(n0.pos)).toBe(0);
    expect(graph.nearestNode(vec(0, 50, 0))).toBeNull();
    expect(graph.nearestNode(vec(100, 0, 100))).toBeNull();
  });

  it('reports bad ids and non-finite input once and returns safe values (BR-CN-12)', () => {
    const codes: string[] = [];
    const g = bakeNavGraph(def, world, {
      ...opts,
      diagnostics: createDiagnostics((c) => codes.push(c)),
    });
    expect(g.reachable(-1, 0)).toBe(false);
    expect(g.reachable(0, 1e9)).toBe(false);
    expect(g.neighbours(1.5)).toEqual([]);
    expect(g.nearestNode(vec(Number.NaN, 0, 0))).toBeNull();
    expect(codes).toEqual(['nav/bad-node-id', 'nav/non-finite-input']);
    const listed: readonly string[] = NAV_DIAGNOSTIC_CODES;
    expect(codes.every((c) => listed.includes(c))).toBe(true);
  });

  it('freezes the graph, nodes and neighbour lists', () => {
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.nodes)).toBe(true);
    expect(Object.isFrozen(graph.nodes[0])).toBe(true);
    expect(Object.isFrozen(graph.neighbours(0))).toBe(true);
  });
});

describe('bake rules', () => {
  it('drops candidates inside exclude hints, but anchors still attach elsewhere (BR-CN-62)', () => {
    const excluded = fixtureMap({
      navHints: [{ kind: 'exclude', region: { min: vec(2, 1.9, 1), max: vec(8, 2.1, 5) } }],
    });
    const g = bakeNavGraph(excluded, buildCollisionWorld(excluded), opts);
    expect(g.nodes.some((n) => n.pos.y === 2 && n.kind === 'grid')).toBe(false);
    expect(g.anchorNode('spawns', 2)).toBeNull(); // the platform spawn is inside the region
    expect(g.anchorNode('navHints', 0)).toBeNull(); // exclude hints are not anchors
  });

  it('merges a second anchor into the first and keeps both addressable (BR-CN-63)', () => {
    const twin = fixtureMap({
      spawns: [
        { pos: vec(-8, 0, -8), yaw: 0, zone: 'a', player: true },
        { pos: vec(-8.2, 0, -8), yaw: 0, zone: 'a', player: false },
      ],
    });
    const g = bakeNavGraph(twin, buildCollisionWorld(twin), opts);
    expect(g.anchorNode('spawns', 0)).toBe(0);
    expect(g.anchorNode('spawns', 1)).toBe(0);
  });

  it('records an anchor in a wall as unattached instead of throwing', () => {
    const walled = fixtureMap({
      spawns: [{ pos: vec(-5, 0, -5), yaw: 0, zone: 'a', player: true }],
    });
    const g = bakeNavGraph(walled, buildCollisionWorld(walled), opts);
    expect(g.anchorNode('spawns', 0)).toBeNull();
  });

  it('gives a narrow top no samples and a thin top a centre line (BR-CN-61)', () => {
    const tops = fixtureMap({
      solids: [
        box('ground', [-10, -1, -10], [10, 0, 10]),
        box('floor', [0, 0, 0], [0.7, 0.2, 5]), // narrower than 0.8 m: no samples
        box('floor', [3, 0, 0], [4.5, 0.2, 5]), // 1.5 m wide: one centre line at x = 3.75
      ],
      ramps: [],
      spawns: [],
      cover: [],
      navHints: [],
    });
    const g = bakeNavGraph(tops, buildCollisionWorld(tops), opts);
    const raised = g.nodes.filter((n) => n.pos.y === 0.2);
    expect(raised.length).toBeGreaterThan(0);
    expect(raised.every((n) => n.pos.x === 3.75)).toBe(true);
  });

  it('throws nav/node-budget past 8 000 nodes', () => {
    const big = fixtureMap({
      solids: [box('ground', [-100, -1, -100], [100, 0, 100])],
      ramps: [],
      spawns: [],
      cover: [],
      navHints: [],
      bounds: { min: vec(-100, -1, -100), max: vec(100, 5, 100) },
    });
    const w = buildCollisionWorld(big);
    expect(codeOf(() => bakeNavGraph(big, w, opts))).toBe('nav/node-budget');
    const baker = createNavBaker(big, w, opts);
    expect(codeOf(() => baker.step(1e9, () => 0))).toBe('nav/node-budget');
    expect(baker.phase).toBe('failed');
    expect(codeOf(() => baker.step(1, () => 0))).toBe('nav/node-budget');
    expect(codeOf(() => baker.result())).toBe('nav/node-budget');
    expect(baker.progress()).toBe(0);
  });

  it('validates options and step budgets (BR-CN-10)', () => {
    expect(codeOf(() => createNavBaker(def, world, { agent: STANDING, spacing: 0.1 }))).toBe(
      'nav/invalid-options',
    );
    expect(codeOf(() => createNavBaker(def, world, { agent: STANDING, spacing: 5 }))).toBe(
      'nav/invalid-options',
    );
    expect(codeOf(() => createNavBaker(def, world, { agent: { radius: 0, height: 1.8 } }))).toBe(
      'nav/invalid-options',
    );
    expect(codeOf(() => createNavBaker(def, world, { agent: STANDING, stepHeight: -1 }))).toBe(
      'nav/invalid-options',
    );
    const baker = createNavBaker(def, world, opts);
    expect(codeOf(() => baker.result())).toBe('nav/bake-incomplete');
    expect(codeOf(() => baker.step(0, () => 0))).toBe('nav/bad-step-budget');
    expect(codeOf(() => baker.step(Number.NaN, () => 0))).toBe('nav/bad-step-budget');
  });
});

describe('time-sliced bake (BR-CN-67, BR-CN-68, SD-CN-04)', () => {
  const reference = fingerprint(bakeNavGraph(def, world, opts));

  it.each([0.01, 1, 8])('gives the same graph for budget %s ms under a fake clock', (budget) => {
    let t = 0;
    const now = (): number => (t += 0.5);
    const baker = createNavBaker(def, world, opts);
    let calls = 0;
    let last = 0;
    while (!baker.step(budget, now)) {
      calls++;
      const p = baker.progress();
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeLessThan(1);
      last = p;
    }
    expect(baker.progress()).toBe(1);
    expect(baker.phase).toBe('done');
    expect(baker.step(budget, now)).toBe(true);
    expect(fingerprint(baker.result())).toEqual(reference);
    if (budget < 1) expect(calls).toBeGreaterThan(10);
  });

  it('reads the clock on entry and then only every 16 items', () => {
    let reads = 0;
    const baker = createNavBaker(def, world, opts);
    baker.step(1e9, () => {
      reads++;
      return 0;
    });
    // One read on entry plus one per 16 items; far fewer reads than items.
    expect(reads).toBeGreaterThan(1);
    const items = reads * 16;
    expect(items).toBeGreaterThan(reads);
  });
});
