/** Shared TypeScript-AST helpers for the game-simulation arch tests. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export interface SimFile {
  readonly path: string;
  readonly sf: ts.SourceFile;
}

function list(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return list(p);
    return p.endsWith('.ts') ? [p.split('\\').join('/')] : [];
  });
}

export function parse(path: string): SimFile {
  return {
    path,
    sf: ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true),
  };
}

/** game-simulation's own files: src/sim without src/sim/player and src/sim/stats. */
export function gameSimFiles(): SimFile[] {
  return list('src/sim')
    .filter((p) => !p.startsWith('src/sim/player/') && !p.startsWith('src/sim/stats/'))
    .map(parse);
}

export function statsFiles(): SimFile[] {
  return list('src/sim/stats').map(parse);
}

export function allSrc(): SimFile[] {
  return list('src').map(parse);
}

export function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((c) => {
    walk(c, visit);
  });
}

/** Name of the nearest enclosing named function (declaration, variable or method). */
export function enclosingFunction(node: ts.Node): string | null {
  for (let p: ts.Node = node.parent; !ts.isSourceFile(p); p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name !== undefined) return p.name.text;
    if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      const q: ts.Node = p.parent;
      if (ts.isVariableDeclaration(q) && ts.isIdentifier(q.name)) return q.name.text;
      if (ts.isPropertyAssignment(q) && ts.isIdentifier(q.name)) return q.name.text;
    }
  }
  return null;
}

export function calls(f: SimFile, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  walk(f.sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      out.push(n);
    }
  });
  return out;
}
