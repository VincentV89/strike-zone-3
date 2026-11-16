/** Round-config gate (BR-GS-01, BR-GS-41, SD-GS-03): one case per field. */
import { describe, expect, it } from 'vitest';
import { StrikeZoneError } from '../../src/core';
import type { RoundConfig } from '../../src/contracts';
import { createSimulation, prepareMap, type SimulationDeps } from '../../src/sim';
import { allowDiag, quietProfiler, roundCfg } from './fixtures';

const deps = (ai?: SimulationDeps['ai']): SimulationDeps => ({
  diag: allowDiag(),
  profiler: quietProfiler(),
  ...(ai === undefined ? {} : { ai }),
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof StrikeZoneError ? e.code : 'not-a-strikezone-error';
  }
  return undefined;
}

describe('createSimulation config gate', () => {
  const map = prepareMap('desert-compound');
  const bad = (over: Record<string, unknown>): RoundConfig => ({ ...roundCfg(), ...over });

  it('accepts every BOT_COUNTS value and the three difficulties', () => {
    for (const bots of [1, 2, 3, 5, 8, 10, 15, 20] as const) {
      expect(createSimulation(roundCfg({ bots }), map, deps()).ok).toBe(true);
    }
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      expect(createSimulation(roundCfg({ difficulty }), map, deps()).ok).toBe(true);
    }
  });

  it.each([
    ['bots 0', { bots: 0 }],
    ['bots 4', { bots: 4 }],
    ['bots 21', { bots: 21 }],
    ['bots string', { bots: '5' }],
    ['difficulty unknown', { difficulty: 'insane' }],
    ['difficulty __proto__', { difficulty: '__proto__' }],
    ['difficulty constructor', { difficulty: 'constructor' }],
    ['difficulty empty', { difficulty: '' }],
    ['duration 0', { durationSec: 0 }],
    ['duration 3601', { durationSec: 3601 }],
    ['duration fractional', { durationSec: 1.5 }],
    ['duration NaN', { durationSec: Number.NaN }],
    ['seed negative', { seed: -1 }],
    ['seed too large', { seed: 2 ** 32 }],
    ['seed fractional', { seed: 0.5 }],
  ])('throws sim/bad-config for %s', (_name, over) => {
    expect(codeOf(() => createSimulation(bad(over), map, deps()))).toBe('sim/bad-config');
  });

  it('throws sim/bad-config for a null config and null deps', () => {
    expect(codeOf(() => createSimulation(null as unknown as RoundConfig, map, deps()))).toBe(
      'sim/bad-config',
    );
    expect(codeOf(() => createSimulation(roundCfg(), map, null as unknown as SimulationDeps))).toBe(
      'sim/bad-config',
    );
  });

  it('throws sim/invalid-map when cfg.map does not match the prepared map', () => {
    expect(
      codeOf(() => createSimulation(roundCfg({ map: 'industrial-warehouse' }), map, deps())),
    ).toBe('sim/invalid-map');
  });

  it('throws sim/invalid-map for a map whose validation failed', () => {
    const invalid = { ...map, validation: { ok: false, issues: [], spawnBudget: [] } };
    expect(codeOf(() => createSimulation(roundCfg(), invalid, deps()))).toBe('sim/invalid-map');
  });

  it('checks the AI rates: each must divide 60 and decide <= sense (BR-GS-41)', () => {
    expect(createSimulation(roundCfg(), map, deps({ senseHz: 15, decideHz: 5 })).ok).toBe(true);
    expect(createSimulation(roundCfg(), map, deps({ senseHz: 30 })).ok).toBe(true);
    for (const ai of [
      { senseHz: 7 },
      { decideHz: 0 },
      { senseHz: 10, decideHz: 20 },
      { senseHz: 2.5 },
    ]) {
      expect(codeOf(() => createSimulation(roundCfg(), map, deps(ai)))).toBe('sim/bad-config');
    }
  });
});
