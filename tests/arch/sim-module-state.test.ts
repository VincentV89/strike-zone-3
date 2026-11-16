/**
 * Round isolation (SEC-GS-12, SD-GS-06): no file in game-simulation or
 * match-stats has top-level let/var, and the only top-level mutable
 * container (the PreparedMap cache and its partial-geometry table) lives in
 * src/sim/prepare.ts. Frozen tables are allowed.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { gameSimFiles, statsFiles } from './sim-ast';

const files = [...gameSimFiles(), ...statsFiles()];

function isFrozenTable(e: ts.Expression): boolean {
  if (ts.isAsExpression(e)) return true; // `as const`
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    e.expression.name.text === 'freeze'
  ) {
    return true;
  }
  return (
    ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'freezeNested'
  );
}

function mutableContainer(e: ts.Expression): boolean {
  if (ts.isArrayLiteralExpression(e) || ts.isObjectLiteralExpression(e)) return true;
  return ts.isNewExpression(e);
}

describe('game-simulation module state', () => {
  it('has no top-level let or var', () => {
    for (const f of files) {
      for (const st of f.sf.statements) {
        if (ts.isVariableStatement(st)) {
          expect(
            st.declarationList.flags & ts.NodeFlags.Const,
            `${f.path}: top-level let/var`,
          ).not.toBe(0);
        }
      }
    }
  });

  it('allows top-level mutable containers only in prepare.ts (the map cache)', () => {
    const found: string[] = [];
    for (const f of files) {
      for (const st of f.sf.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
          const init = d.initializer;
          if (init === undefined || isFrozenTable(init)) continue;
          if (mutableContainer(init)) found.push(`${f.path}:${d.name.getText(f.sf)}`);
        }
      }
    }
    expect(found.sort()).toEqual(['src/sim/prepare.ts:cache', 'src/sim/prepare.ts:partial']);
  });
});
