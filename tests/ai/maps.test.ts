/**
 * Long harness runs on both real maps (NFR-AI-Q2 = A: inside npm run verify,
 * 180 s per-test timeouts). H-1 patrol variety (story-bots-patrol criteria 1
 * and 3), H-2 no wall crossing (BR-AI-60, criterion 2) and H-3 unstuck
 * (BR-AI-66, story-bots-unstuck criterion 1). These are harness-level only:
 * the stories close in game-simulation (BR-AI-93).
 */
import { describe, expect, it } from 'vitest';
import type { MapId } from '../../src/contracts';
import { createHarness, prepareMap } from './harness';

const MAPS: readonly MapId[] = ['desert-compound', 'industrial-warehouse'];
const LONG = 180_000;

/** True when `seq` repeats the same 3-node cycle 3 times back to back. */
function repeatsCycle(seq: readonly string[]): boolean {
  for (let i = 0; i + 9 <= seq.length; i++) {
    const c = seq.slice(i, i + 3);
    let same = true;
    for (let k = 3; k < 9 && same; k++) same = seq[i + k] === c[k % 3];
    if (same && new Set(c).size === 3) return true;
  }
  return false;
}

describe.each(MAPS)('%s', (map) => {
  const prepared = prepareMap(map);

  it(
    'H-1: five patrolling bots visit at least 4 distinct nodes in 3 minutes without a fixed loop',
    () => {
      const h = createHarness({
        map,
        prepared,
        bots: 5,
        difficulty: 'normal',
        seed: 11,
        player: { kind: 'absent' },
      });
      const seconds = 180;
      h.step(60 * seconds);
      for (let i = 0; i < 5; i++) {
        const goals = h.metrics.patrolGoals[i] ?? [];
        expect(new Set(goals).size, `bot ${i + 1}`).toBeGreaterThanOrEqual(4);
        expect(repeatsCycle(goals), `bot ${i + 1}`).toBe(false);
      }
      const served = h.paths.stats.solved + h.paths.stats.cacheHits;
      expect(served).toBeLessThanOrEqual(5 * seconds);
      expect(h.brains.every((b) => b.state === 'patrol')).toBe(true);
    },
    LONG,
  );

  it(
    'H-2 and H-3: twenty bots for 5 minutes never enter a solid and are never stuck for 5 s',
    () => {
      const h = createHarness({
        map,
        prepared,
        bots: 20,
        difficulty: 'normal',
        seed: 23,
        player: { kind: 'absent' },
      });
      const solids = prepared.def.solids;
      const bounds = prepared.def.bounds;
      const inside: string[] = [];
      for (let t = 0; t < 60 * 300; t++) {
        h.step();
        if (t % 10 !== 0) continue;
        for (let id = 1; id <= 20; id++) {
          const p = h.bot(id).pos;
          if (
            p.x < bounds.min.x ||
            p.x > bounds.max.x ||
            p.z < bounds.min.z ||
            p.z > bounds.max.z ||
            p.y < bounds.min.y
          ) {
            inside.push(`bot ${id} out of bounds at tick ${h.tick}`);
          }
          for (let s = 0; s < solids.length; s++) {
            const b = solids[s]?.box;
            if (b === undefined) continue;
            const e = 0.05;
            if (
              p.x > b.min.x + e &&
              p.x < b.max.x - e &&
              p.y > b.min.y + e &&
              p.y < b.max.y - e &&
              p.z > b.min.z + e &&
              p.z < b.max.z - e
            ) {
              inside.push(`bot ${id} inside solid ${s} at tick ${h.tick}`);
            }
          }
        }
      }
      expect(inside).toEqual([]);
      const worst = Math.max(...h.metrics.maxStuckSpan);
      expect(worst).toBeLessThan(300);
      const counts = h.diag.snapshot();
      // reported, not asserted: watchdog outcomes on this map
      console.log(
        `${map}: worst stuck span ${worst} ticks, stuck-snap ${counts['ai/stuck-snap'] ?? 0}, stuck-unresolved ${counts['ai/stuck-unresolved'] ?? 0}`,
      );
    },
    LONG,
  );
});
