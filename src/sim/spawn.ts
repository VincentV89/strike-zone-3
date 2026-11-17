/**
 * Spawn allocation (BR-GS-20..26, FD-GS-Q3 = A). Shuffling the whole
 * eligible list and taking its head is a uniform player draw, and the rest
 * of the shuffled list is the BR-GS-23 fallback order.
 */
import { err, ok, type Result, type Rng } from '../core';
import type { BotCount } from '../contracts';
import type { PreparedMap, SpawnPlan } from './types';
import { spawnCandidates } from './validate';

/** Fisher-Yates in place with `rng` (BR-GS-22). */
function shuffle(xs: number[], rng: Rng): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    const a = xs[i] as number;
    xs[i] = xs[j] as number;
    xs[j] = a;
  }
}

/** Picks the player spawn and `botCount` hidden, distant bot spawns from the `spawn` stream. */
export function allocateSpawns(
  map: PreparedMap,
  botCount: BotCount,
  rng: Rng,
): Result<SpawnPlan, 'SPAWN_ALLOCATION_FAILED'> {
  const eligible: number[] = [];
  map.def.spawns.forEach((s, i) => {
    if (s.player) eligible.push(i);
  });
  shuffle(eligible, rng);
  for (const p of eligible) {
    const cand = spawnCandidates(map.def, map.world, p);
    if (cand.length >= botCount) {
      shuffle(cand, rng);
      return ok(Object.freeze({ player: p, bots: Object.freeze(cand.slice(0, botCount)) }));
    }
  }
  return err('SPAWN_ALLOCATION_FAILED');
}
