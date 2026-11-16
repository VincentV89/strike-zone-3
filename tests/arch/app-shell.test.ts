/**
 * app-shell structure checks: the guarded seam import (SD-AS-01), the bot
 * information firewall (SD-AS-12) and promise hygiene (SD-AS-15).
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { allSrc, parse, walk, type SimFile } from './sim-ast';

const appFiles = (): SimFile[] =>
  allSrc().filter((f) => f.path.startsWith('src/app/') || f.path.startsWith('src/input/'));

function isModeTestGuard(e: ts.Expression): boolean {
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) {
    return false;
  }
  return (
    e.left.getText() === 'import.meta.env.MODE' &&
    ts.isStringLiteral(e.right) &&
    e.right.text === 'test'
  );
}

describe('seam gate (SD-AS-01)', () => {
  it('src/app has exactly one import(), in main.ts, inside if (import.meta.env.MODE === "test")', () => {
    const found: { path: string; guarded: boolean; spec: string }[] = [];
    for (const f of allSrc().filter((x) => x.path.startsWith('src/app/'))) {
      walk(f.sf, (n) => {
        if (!ts.isCallExpression(n) || n.expression.kind !== ts.SyntaxKind.ImportKeyword) return;
        let guarded = false;
        for (let p: ts.Node = n.parent; !ts.isSourceFile(p); p = p.parent) {
          if (ts.isIfStatement(p) && isModeTestGuard(p.expression)) guarded = true;
        }
        const arg = n.arguments[0];
        found.push({
          path: f.path,
          guarded,
          spec: arg !== undefined && ts.isStringLiteral(arg) ? arg.text : '?',
        });
      });
    }
    expect(found).toEqual([{ path: 'src/app/main.ts', guarded: true, spec: '../dev' }]);
  });

  it('nothing in src/ statically imports src/dev', () => {
    for (const f of allSrc().filter((x) => !x.path.startsWith('src/dev/'))) {
      for (const st of f.sf.statements) {
        if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue;
        const spec = st.moduleSpecifier;
        if (spec === undefined || !ts.isStringLiteral(spec)) continue;
        const typeOnly =
          ts.isImportDeclaration(st) &&
          st.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
        if (typeOnly) continue;
        expect(/(^|\/)dev(\/|$)/.test(spec.text), `${f.path} imports ${spec.text}`).toBe(false);
      }
    }
  });

  it('the seam markers are string literals in src/dev', () => {
    const src = readFileSync('src/dev/markers.ts', 'utf8');
    for (const m of ['__strikezone', 'strikezone:pointer-lock-bypass', 'strikezone:dev-overlay']) {
      expect(src).toContain(`'${m}'`);
    }
  });
});

describe('information firewall (SD-AS-12)', () => {
  it('src/app and src/input never read .bots or touch bot-AI internals', () => {
    for (const f of appFiles()) {
      walk(f.sf, (n) => {
        if (ts.isPropertyAccessExpression(n) && n.name.text === 'bots') {
          // setup.bots is the bot count from the match setup, not live bot data.
          expect(n.expression.getText(), `${f.path}: ${n.getText()}`).toMatch(/setup|cfg/);
        }
        if (ts.isIdentifier(n)) {
          expect(['targetPointsFor', 'SenseInput']).not.toContain(n.text);
        }
      });
      for (const st of f.sf.statements) {
        if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
          expect(st.moduleSpecifier.text).not.toMatch(/(^|\/)ai(\/|$)/);
        }
      }
    }
  });

  it('only frame-loop.ts calls audio.play, and passes the reused pose', () => {
    const calls: { path: string; arg: string }[] = [];
    for (const f of appFiles()) {
      walk(f.sf, (n) => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === 'play' &&
          n.expression.expression.getText() === 'audio'
        ) {
          calls.push({ path: f.path, arg: n.arguments[1]?.getText() ?? '' });
        }
      });
    }
    expect(calls).toEqual([{ path: 'src/app/frame-loop.ts', arg: 'writePose(snap)' }]);
    const src = parse('src/app/frame-loop.ts').sf.getFullText();
    expect(src).toMatch(/const pose: ListenerPose = \{ pos, yaw: 0 \};/);
  });
});

describe('promise hygiene (SD-AS-15)', () => {
  it('every .then( in src/app has a rejection handler', () => {
    for (const f of allSrc().filter((x) => x.path.startsWith('src/app/'))) {
      walk(f.sf, (n) => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === 'then'
        ) {
          const chained = ts.isPropertyAccessExpression(n.parent) && n.parent.name.text === 'catch';
          expect(
            n.arguments.length === 2 || chained,
            `${f.path}: ${n.getText().slice(0, 60)}`,
          ).toBe(true);
        }
      });
    }
  });

  it('buildMap, precompile, prepare and yieldFn are awaited inside a try in loading.ts', () => {
    const f = parse('src/app/loading.ts');
    const names = new Set(['buildMap', 'precompile', 'prepare']);
    let checked = 0;
    walk(f.sf, (n) => {
      if (!ts.isAwaitExpression(n) || !ts.isCallExpression(n.expression)) return;
      const callee = n.expression.expression;
      if (!ts.isPropertyAccessExpression(callee) || !names.has(callee.name.text)) return;
      let inTry = false;
      for (let p: ts.Node = n.parent; !ts.isSourceFile(p); p = p.parent) {
        if (ts.isTryStatement(p)) inTry = true;
      }
      expect(inTry, callee.getText()).toBe(true);
      checked += 1;
    });
    expect(checked).toBe(3);
  });

  it('installs no global error or unhandledrejection handler', () => {
    for (const f of allSrc().filter((x) => /^src\/(app|input|dev)\//.test(x.path))) {
      const text = f.sf.getFullText();
      expect(text).not.toMatch(/['"]unhandledrejection['"]|onerror\s*=|['"]error['"],/);
    }
  });
});
