/**
 * game-simulation and match-stats structure (SD-GS-08, BR-GS-90, TS-GS-03,
 * TS-GS-07): exact public surfaces, no deep imports, the one changed
 * component-table row, match-stats isolation, the seventh byte-identical
 * freeze.ts copy, and no shipped code that imports runHeadless.
 */
import { readFileSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as sim from '../../src/sim';
import * as stats from '../../src/sim/stats';
import { COMPONENTS } from './component-table';
import { allSrc, statsFiles, walk, type SimFile } from './sim-ast';

const resolveRel = (from: string, spec: string): string =>
  posix.normalize(posix.join(dirname(from), spec)).replace(/\.ts$/, '');

function specs(f: SimFile): { spec: string; names: string[] }[] {
  const out: { spec: string; names: string[] }[] = [];
  walk(f.sf, (n) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier !== undefined &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      const names: string[] = [];
      const clause = ts.isImportDeclaration(n) ? n.importClause : undefined;
      if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const e of clause.namedBindings.elements) names.push((e.propertyName ?? e.name).text);
      }
      out.push({ spec: n.moduleSpecifier.text, names });
    }
  });
  return out;
}

describe('game-simulation public surface', () => {
  it('exports exactly the documented runtime names', () => {
    expect(Object.keys(sim).sort()).toEqual(
      [
        'SIM_CODES',
        'SIM_THROWN_CODES',
        'SIM_TUNING',
        'allocateSpawns',
        'createSimulation',
        'prepareMap',
        'prepareMapAsync',
        'runHeadless',
        'validateMap',
      ].sort(),
    );
    expect(Object.keys(stats).sort()).toEqual(['EMPTY_SESSION', 'createStatsTracker']);
    expect(Object.isFrozen(sim.SIM_TUNING)).toBe(true);
    expect(Object.isFrozen(sim.SIM_CODES)).toBe(true);
  });

  it('is imported from outside only through src/sim/index.ts and src/sim/stats/index.ts', () => {
    const bad: string[] = [];
    for (const f of allSrc()) {
      if (f.path.startsWith('src/sim/')) continue;
      for (const { spec } of specs(f)) {
        if (!spec.startsWith('.')) continue;
        const t = resolveRel(f.path, spec);
        if (!t.startsWith('src/sim')) continue;
        const ok = ['src/sim', 'src/sim/index', 'src/sim/stats', 'src/sim/stats/index'].includes(t);
        const player = t === 'src/sim/player' || t === 'src/sim/player/index';
        if (!ok && !player) bad.push(`${f.path} -> ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps match-stats away from game-simulation (no edge, events-only input)', () => {
    for (const f of statsFiles()) {
      for (const { spec } of specs(f)) {
        if (!spec.startsWith('.')) continue;
        const t = resolveRel(f.path, spec);
        expect(
          t.startsWith('src/sim/') && !t.startsWith('src/sim/stats'),
          `${f.path} -> ${spec}`,
        ).toBe(false);
        expect(
          t.startsWith('src/core') ||
            t.startsWith('src/contracts') ||
            t.startsWith('src/sim/stats'),
        ).toBe(true);
      }
    }
  });

  it('changes only the contracts edge of the game-simulation row to R (NFR-GS-Q1 = A)', () => {
    const row = COMPONENTS.find((c) => c.id === 'game-simulation');
    expect(row?.deps).toEqual({
      'core-kernel': 'R',
      contracts: 'R',
      'map-data': 'R',
      'collision-world': 'R',
      navigation: 'R',
      'player-controller': 'R',
      weapons: 'R',
      combat: 'R',
      'bot-perception': 'R',
      'bot-locomotion': 'R',
      'bot-brain': 'R',
    });
    expect(COMPONENTS.find((c) => c.id === 'match-stats')?.deps).toEqual({
      'core-kernel': 'R',
      contracts: 'T',
    });
  });

  it('keeps src/sim/freeze.ts byte-identical to the other six private copies', () => {
    const ref = readFileSync('src/sim/player/freeze.ts', 'utf8');
    expect(readFileSync('src/sim/freeze.ts', 'utf8')).toBe(ref);
  });

  it('ships no caller of runHeadless or __resetPreparedMapCache outside src/sim', () => {
    for (const f of allSrc()) {
      if (f.path.startsWith('src/sim/')) continue;
      for (const { names } of specs(f)) {
        expect(names, f.path).not.toContain('runHeadless');
        expect(names, f.path).not.toContain('__resetPreparedMapCache');
      }
    }
  });
});
