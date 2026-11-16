/**
 * Firewall source test (SEC-GS-04, SD-GS-01): in game-simulation, only the
 * private stage-4 function `senseDue` reads the live player position for
 * bot-ai. Renaming senseDue needs this test updated in the same change.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { calls, enclosingFunction, gameSimFiles, walk } from './sim-ast';

const files = gameSimFiles();

describe('game-simulation information firewall (source)', () => {
  it('has exactly one targetPointsFor call, inside senseDue', () => {
    const sites = files.flatMap((f) => calls(f, 'targetPointsFor').map((c) => ({ f, c })));
    expect(sites).toHaveLength(1);
    expect(sites[0]?.f.path).toBe('src/sim/simulation.ts');
    expect(sites[0] && enclosingFunction(sites[0].c)).toBe('senseDue');
  });

  it('writes .targetPoints only inside senseDue', () => {
    const writers: string[] = [];
    for (const f of files) {
      walk(f.sf, (n) => {
        if (
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(n.left) &&
          n.left.name.text === 'targetPoints'
        ) {
          writers.push(`${f.path}:${enclosingFunction(n) ?? '<module>'}`);
        }
      });
    }
    expect(writers.length).toBeGreaterThanOrEqual(2); // the per-bot write and the reset to EMPTY_POINTS
    expect(new Set(writers)).toEqual(new Set(['src/sim/simulation.ts:senseDue']));
  });

  it('creates exactly one SenseInput-shaped object, once per round', () => {
    const literals: string[] = [];
    for (const f of files) {
      walk(f.sf, (n) => {
        if (
          ts.isObjectLiteralExpression(n) &&
          n.properties.some(
            (p) =>
              p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'targetPoints',
          )
        ) {
          literals.push(`${f.path}:${enclosingFunction(n) ?? '<module>'}`);
        }
      });
    }
    expect(literals).toEqual(['src/sim/simulation.ts:createSenseInput']);
    const creators = files.flatMap((f) => calls(f, 'createSenseInput'));
    expect(creators).toHaveLength(1);
    expect(creators[0] && enclosingFunction(creators[0])).toBe('createSimulation');
  });

  it('never passes the player agent to the stage-5 and stage-7 fill functions', () => {
    for (const f of files) {
      for (const name of ['fillBotSelf', 'fillLocoContext', 'fillAimContext']) {
        for (const c of calls(f, name)) {
          for (const a of c.arguments) {
            walk(a, (n) => {
              if (ts.isIdentifier(n)) expect(n.text, `${name} argument`).not.toBe('player');
            });
          }
        }
      }
      walk(f.sf, (n) => {
        if (
          ts.isFunctionDeclaration(n) &&
          n.name !== undefined &&
          ['fillBotSelf', 'fillLocoContext', 'fillAimContext'].includes(n.name.text)
        ) {
          const params = n.parameters.map((p) => p.getText(f.sf));
          expect(params.join(','), n.name.text).not.toMatch(/player|PlayerAgent|SenseInput/i);
        }
      });
    }
  });
});
