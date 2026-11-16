import { describe, expect, it } from 'vitest';
import { CUE_IDS, RECIPES } from '../../src/audio/recipes';
import type { Recipe } from '../../src/audio/types';

const MAX_PEAK = 0.5;
const MAX_NODES = 6;

/** Worst-case nodes for one voice of this recipe (SD-AU-02). */
function worstCaseNodes(r: Recipe): number {
  const layerNodes = r.layers.reduce((n, l) => n + 2 + (l.filter === undefined ? 0 : 1), 0);
  const placement = r.placement === 'positional' ? 2 : r.placement === 'directional' ? 1 : 0;
  return layerNodes + 1 + placement;
}

describe('RECIPES budgets (SD-AU-02, BR-AU-60..65)', () => {
  it.each(CUE_IDS.map((c) => [c]))(
    '%s stays within peak, node, envelope and duration limits',
    (cue) => {
      const r = RECIPES[cue];
      const peak = r.gain * r.layers.reduce((s, l) => s + l.gain, 0);
      expect(peak).toBeLessThanOrEqual(MAX_PEAK);
      expect(worstCaseNodes(r)).toBeLessThanOrEqual(MAX_NODES);
      expect(r.layers.length).toBeGreaterThanOrEqual(1);
      expect(r.layers.length).toBeLessThanOrEqual(3);
      const isSting = cue === 'victory' || cue === 'defeat' || cue === 'time-up';
      expect(r.duration).toBeLessThanOrEqual(isSting ? 2 : 0.6);
      expect(r.jitter).toBeGreaterThanOrEqual(0);
      expect(r.jitter).toBeLessThanOrEqual(0.05);
      for (const l of r.layers) {
        expect(l.gain).toBeGreaterThan(0);
        expect(l.attack).toBeGreaterThan(0);
        // The envelope reaches 0 before the hard stop (no clicks).
        expect((l.delay ?? 0) + l.attack + l.decay + 0.01).toBeLessThanOrEqual(r.duration + 1e-9);
        if (l.source !== 'noise') expect(l.freq).toBeGreaterThan(0);
      }
      expect(r.placement === 'positional').toBe(r.spatial !== null);
    },
  );

  it('is deep-frozen', () => {
    expect(Object.isFrozen(RECIPES)).toBe(true);
    expect(Object.isFrozen(RECIPES['fire-rifle'].layers[0])).toBe(true);
    expect(Object.isFrozen(RECIPES['bot-fire-rifle'].spatial)).toBe(true);
  });

  it('applies the caps and priorities of BR-AU-51/52', () => {
    expect(RECIPES['bot-fire-rifle']).toMatchObject({ group: 'bot-fire', maxConcurrent: 6 });
    expect(RECIPES['bot-step']).toMatchObject({ maxConcurrent: 6, priority: 3 });
    expect(RECIPES.hit).toMatchObject({ group: 'hit', maxConcurrent: 3 });
    expect(RECIPES.victory.maxConcurrent).toBe(1);
    expect(RECIPES['ui-tick']).toMatchObject({ group: 'ui', maxConcurrent: 2, priority: 0 });
    expect(RECIPES['fire-rifle'].maxConcurrent).toBe(2);
  });

  it('makes bot fire 0.8× the player voice peak, with a distinct crack per weapon (BR-AU-64)', () => {
    const peak = (r: Recipe): number => r.gain * r.layers.reduce((s, l) => s + l.gain, 0);
    for (const w of ['rifle', 'pistol', 'sniper'] as const) {
      expect(peak(RECIPES[`bot-fire-${w}`])).toBeCloseTo(0.8 * peak(RECIPES[`fire-${w}`]), 10);
      expect(RECIPES[`bot-fire-${w}`].spatial).toEqual({ refDist: 3, maxDist: 90 });
    }
    expect(RECIPES['fire-sniper'].duration).toBeGreaterThan(RECIPES['fire-rifle'].duration);
    expect(RECIPES['fire-pistol'].duration).toBeLessThan(RECIPES['fire-rifle'].duration);
  });
});
