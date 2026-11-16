/**
 * Spawn allocation (BR-GS-20..26, FD-GS-Q3 = A): the spawn matrix for every
 * BOT_COUNTS value on both maps with three seeds (story-spawn-exact-bots,
 * req-spawn-allocation, req-match-setup-bot-count).
 */
import { describe, expect, it } from 'vitest';
import { createRng, vec3 } from '../../src/core';
import { BOT_COUNTS, type MapId } from '../../src/contracts';
import type { CollisionWorld } from '../../src/physics';
import { allocateSpawns, createSimulation, prepareMap, type PreparedMap } from '../../src/sim';
import { MAPS, allowDiag, quietProfiler, roundCfg } from './fixtures';

const SEEDS = [1, 42, 9001];

describe('spawn matrix: 8 counts x 2 maps x 3 seeds', () => {
  for (const map of MAPS) {
    it.each(BOT_COUNTS.flatMap((n) => SEEDS.map((s) => [n, s] as const)))(
      `${map}: %i bots, seed %i`,
      (bots, seed) => {
        const m = prepareMap(map);
        const r = createSimulation(roundCfg({ map, bots, seed }), m, {
          diag: allowDiag(),
          profiler: quietProfiler(),
        });
        if (!r.ok) throw new Error(r.error);
        const snap = r.value.snapshot();
        expect(snap.bots).toHaveLength(bots);
        expect(snap.botsAlive).toBe(bots);
        expect(snap.bots.map((b) => b.id)).toEqual(Array.from({ length: bots }, (_, i) => i + 1));
        const p = snap.player.pos;
        const eye = vec3(p.x, p.y + 1.6, p.z);
        const keys = new Set([`${p.x},${p.z}`]);
        for (const b of snap.bots) {
          expect(b.alive).toBe(true);
          expect(Math.hypot(b.pos.x - p.x, b.pos.z - p.z)).toBeGreaterThanOrEqual(20);
          for (const h of [0.3, 1.0, 1.6, 1.8]) {
            expect(m.world.lineOfSight(eye, vec3(b.pos.x, b.pos.y + h, b.pos.z))).toBe(false);
          }
          keys.add(`${b.pos.x},${b.pos.z}`);
        }
        expect(keys.size).toBe(bots + 1); // every entity on its own spawn
      },
    );
  }
});

describe('allocateSpawns', () => {
  const m = prepareMap('desert-compound');

  it('gives the same plan for the same seed and varied plans across seeds (BR-GS-26)', () => {
    const plan = (seed: number) => {
      const r = allocateSpawns(m, 10, createRng(seed).fork('spawn'));
      if (!r.ok) throw new Error(r.error);
      return JSON.stringify(r.value);
    };
    expect(plan(5)).toBe(plan(5));
    const distinct = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(plan));
    expect(distinct.size).toBeGreaterThan(3);
  });

  it('draws the player from player-eligible spawns only, and every eligible spawn is used across seeds', () => {
    const used = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const r = allocateSpawns(m, 20, createRng(seed).fork('spawn'));
      if (!r.ok) throw new Error(r.error);
      expect(m.def.spawns[r.value.player]?.player).toBe(true);
      used.add(r.value.player);
    }
    expect(used.size).toBe(m.def.spawns.filter((s) => s.player).length);
  });

  it('returns SPAWN_ALLOCATION_FAILED when no player spawn has enough hidden candidates (BR-GS-23)', () => {
    const seeAll: CollisionWorld = { ...m.world, lineOfSight: () => true };
    const bad: PreparedMap = { ...m, world: seeAll };
    expect(allocateSpawns(bad, 1, createRng(1).fork('spawn'))).toEqual({
      ok: false,
      error: 'SPAWN_ALLOCATION_FAILED',
    });
    const r = createSimulation(roundCfg({ bots: 1 }), bad, {
      diag: allowDiag(),
      profiler: quietProfiler(),
    });
    expect(r).toEqual({ ok: false, error: 'SPAWN_ALLOCATION_FAILED' });
  });

  it('falls back to another player spawn when the first has too few candidates', () => {
    const counts = m.validation.spawnBudget;
    const best = Math.max(...counts);
    // Only spawns with the largest budget can host `best` bots; over many seeds every pick still succeeds.
    for (let seed = 0; seed < 30; seed++) {
      const r = allocateSpawns(m, best as 20, createRng(seed).fork('spawn'));
      if (!r.ok) throw new Error(r.error);
      expect(counts[r.value.player]).toBe(best);
    }
  });
});

it('maps both have enough player spawns for the matrix', () => {
  for (const id of MAPS as MapId[]) {
    expect(prepareMap(id).def.spawns.filter((s) => s.player).length).toBeGreaterThan(1);
  }
});
