/**
 * Difficulty behaviour runs: BR-AI-44 hit rate below 100 % at every level,
 * and H-13 / BR-AI-52 (story-difficulty-levels criterion 3): Hard takes cover
 * and flanks more often than Easy on Desert Compound.
 */
import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../../src/contracts';
import { arena, v } from './fixtures';
import { createHarness, prepareMap } from './harness';

const open = prepareMap(arena());
const LEVELS: readonly Difficulty[] = ['easy', 'normal', 'hard'];

describe('BR-AI-44: 0 < hit rate < 1 at every difficulty', () => {
  it.each(LEVELS)(
    '%s bots firing 200+ shots at an exposed stand-in 15-25 m away',
    (difficulty) => {
      const h = createHarness({
        map: open.def,
        prepared: open,
        bots: 3,
        difficulty,
        seed: 99,
        botSpawns: [
          { pos: v(-5, 0, -5), yaw: 0 },
          { pos: v(0, 0, -5), yaw: 0 },
          { pos: v(5, 0, -5), yaw: 0 },
        ],
        player: { kind: 'static', pos: v(0, 0, 13) },
        playerHealth: 1e9,
        profileOverride: { coverChance: 0, flankChance: 0, engageMin: 15, engageMax: 25 },
      });
      const shots = (): number => h.metrics.shots.reduce((a, b) => a + b, 0);
      for (let t = 0; t < 60 * 120 && shots() < 200; t++) h.step();
      const hits = h.metrics.hits.reduce((a, b) => a + b, 0);
      expect(shots()).toBeGreaterThanOrEqual(200);
      expect(hits).toBeGreaterThan(0);
      expect(hits / shots()).toBeLessThan(1);
      expect(h.metrics.reactionViolations).toBe(0);
    },
    120_000,
  );
});

describe('H-13: Hard uses cover and flanking more than Easy (BR-AI-52)', () => {
  const desert = prepareMap('desert-compound');
  const tactics = (difficulty: Difficulty, seed: number): number => {
    const h = createHarness({
      map: 'desert-compound',
      prepared: desert,
      bots: 5,
      difficulty,
      seed,
      player: {
        kind: 'route',
        points: [v(-28.8, 0, 0), v(-10, 0, 0), v(0, 0, 0), v(-10, 0, 10)],
        speed: 3,
        fireEvery: 10,
      },
      playerHealth: 1e9,
    });
    h.step(60 * 60);
    return h.brains.reduce((sum, b) => sum + b.stats['take-cover'] + b.stats.flank, 0);
  };

  it('sums take-cover + flank entries over 3 seeds of 60 s', () => {
    let easy = 0;
    let hard = 0;
    for (const seed of [1, 2, 3]) {
      easy += tactics('easy', seed);
      hard += tactics('hard', seed);
    }
    console.log(`H-13 take-cover + flank entries: easy ${easy}, hard ${hard}`);
    expect(hard).toBeGreaterThan(easy);
  }, 180_000);
});
