/**
 * The tick path never throws (SEC-GS-09, BR-GS-91): no throw statement and no
 * try statement in the step-path files. Setup throws live in config.ts and
 * prepare.ts only.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse, walk } from './sim-ast';

const STEP_FILES = [
  'src/sim/simulation.ts',
  'src/sim/awareness.ts',
  'src/sim/events.ts',
  'src/sim/snapshot.ts',
  'src/sim/command.ts',
  'src/sim/shots.ts',
];

describe('game-simulation step purity', () => {
  it.each(STEP_FILES)('%s has no throw and no try', (path) => {
    const f = parse(path);
    const found: string[] = [];
    walk(f.sf, (n) => {
      if (ts.isThrowStatement(n) || ts.isTryStatement(n)) found.push(n.getText(f.sf).slice(0, 60));
    });
    expect(found).toEqual([]);
  });

  it('keeps the step method free of StrikeZoneError construction', () => {
    const f = parse('src/sim/simulation.ts');
    walk(f.sf, (n) => {
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) {
        expect(n.expression.text).not.toBe('StrikeZoneError');
      }
    });
  });
});
