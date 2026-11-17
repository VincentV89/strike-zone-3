/**
 * collision-nav bench (LC-CN-16, PR-CN-01..09). Timings go to
 * reports/collision-nav-bench.json and only their 10x ceilings are asserted:
 * this runtime is not target hardware (req-honest-verification). The heap
 * delta over 1e6 queries is asserted (PR-CN-09).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { botId, createRng } from '../../src/core';
import type { MapId } from '../../src/contracts';
import { getMap, MAP_RULES } from '../../src/maps';
import { bakeNavGraph, createPathService } from '../../src/nav';
import { buildCollisionWorld, type MoveResult, type RayHit } from '../../src/physics';

const STANDING = { radius: MAP_RULES.agentRadius, height: MAP_RULES.agentHeight };
const MAPS: readonly MapId[] = ['desert-compound', 'industrial-warehouse'];
const HEAP_LIMIT_BYTES = 1024 * 1024;
const report: Record<string, unknown> = {};

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run Vitest with --expose-gc (see vitest.config.ts)');
  collect();
}

function time(body: () => void): number {
  const start = performance.now();
  body();
  return performance.now() - start;
}

describe.each(MAPS)('collision-nav bench on %s', (id) => {
  const def = getMap(id);

  it('builds the world, bakes the graph and runs the hot queries within 10x of the targets', () => {
    let world = buildCollisionWorld(def);
    const buildMs = time(() => {
      world = buildCollisionWorld(def);
    });
    let graph = bakeNavGraph(def, world, { agent: STANDING });
    const bakeMs = time(() => {
      graph = bakeNavGraph(def, world, { agent: STANDING });
    });

    const rng = createRng(42);
    const N = 100_000;
    const pts = Array.from({ length: 256 }, () => {
      const s = def.spawns[rng.int(0, def.spawns.length)];
      return s === undefined ? { x: 0, y: 0, z: 0 } : { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    });
    const vel = { x: 4, y: 0, z: 3 };
    const out: MoveResult = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      hitCeiling: false,
      landed: false,
    };
    const moveUs =
      (time(() => {
        for (let i = 0; i < N; i++) {
          world.moveCapsule(pts[i & 255] ?? out.position, vel, STANDING, 1 / 60, 0.35, out);
        }
      }) *
        1000) /
      N;
    const hit: RayHit = {
      distance: 0,
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 0 },
      solidIndex: -1,
      rampIndex: -1,
    };
    const dir = { x: 0.6, y: -0.05, z: 0.8 };
    const rayUs =
      (time(() => {
        for (let i = 0; i < N; i++) world.raycast(pts[i & 255] ?? hit.point, dir, 60, hit);
      }) *
        1000) /
      N;

    // A*: distinct spawn-to-spawn requests with a 1-entry cache, 8 per tick.
    const ps = createPathService(graph, world, { cacheSize: 1, maxPathsPerTick: 8 });
    const pairs = 64;
    const astarMs =
      time(() => {
        for (let i = 0; i < pairs; i++) {
          const a = def.spawns[i % def.spawns.length];
          const b = def.spawns[(i * 7 + 3) % def.spawns.length];
          if (a === undefined || b === undefined) continue;
          ps.request(botId((i % 8) + 1), { from: a.pos, to: b.pos });
          if (i % 8 === 7) ps.tick();
        }
        ps.tick();
      }) / pairs;

    report[id] = {
      nodes: graph.nodes.length,
      edges: graph.edgeCount,
      components: graph.componentCount,
      shapes: world.shapeCount,
      worldBuildMs: buildMs,
      bakeMs,
      moveCapsuleUs: moveUs,
      raycastUs: rayUs,
      pathRequestMs: astarMs,
    };
    // Targets: build < 50 ms, bake <= 1 s, move <= 10 us, ray <= 5 us, A* <= 0.5 ms.
    expect(buildMs).toBeLessThan(500);
    expect(bakeMs).toBeLessThan(10_000);
    expect(moveUs).toBeLessThan(100);
    expect(rayUs).toBeLessThan(50);
    expect(astarMs).toBeLessThan(5);
  });

  it('allocates less than 1 MB over 1e6 tick-path queries (PR-CN-09, SD-CN-16)', () => {
    const world = buildCollisionWorld(def);
    const s = def.spawns[0];
    const p = s === undefined ? { x: 0, y: 0, z: 0 } : { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    const eye = { x: p.x, y: p.y + 1.6, z: p.z };
    const far = { x: 0, y: 1.6, z: 0 };
    const vel = { x: 3, y: 0, z: -2 };
    const out: MoveResult = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      hitCeiling: false,
      landed: false,
    };
    const hit: RayHit = {
      distance: 0,
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 0 },
      solidIndex: -1,
      rampIndex: -1,
    };
    let sink = 0;
    const body = (): void => {
      for (let i = 0; i < 250_000; i++) {
        world.moveCapsule(p, vel, STANDING, 1 / 60, 0.35, out);
        if (world.raycast(eye, vel, 30, hit) !== null) sink += hit.distance;
        if (world.lineOfSight(eye, far)) sink++;
        if (world.capsuleFits(p, STANDING)) sink++;
      }
    };
    body();
    gc();
    const before = process.memoryUsage().heapUsed;
    body();
    gc();
    const delta = process.memoryUsage().heapUsed - before;
    report[`${id}:heap`] = { heapDeltaBytes: delta, queries: 1_000_000 };
    expect(sink).toBeGreaterThan(0);
    expect(delta).toBeLessThan(HEAP_LIMIT_BYTES);
  });
});

it('writes reports/collision-nav-bench.json', () => {
  mkdirSync('reports', { recursive: true });
  writeFileSync(
    'reports/collision-nav-bench.json',
    `${JSON.stringify({ generatedBy: 'tests/bench/collision-nav.bench.test.ts', report }, null, 2)}\n`,
  );
  expect(Object.keys(report).length).toBeGreaterThan(0);
});
