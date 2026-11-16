/**
 * Single public surface for collision-world and navigation (SD-CN-03): code
 * outside src/physics and src/nav imports only their index.ts files, and
 * src/nav reaches map-data only through src/maps/index.ts (BR-CN-03).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface Src {
  path: string;
  text: string;
}

function listTs(dir: string): Src[] {
  return readdirSync(dir).flatMap((name): Src[] => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return listTs(p);
    if (!p.endsWith('.ts')) return [];
    return [{ path: p.split('\\').join('/'), text: readFileSync(p, 'utf8') }];
  });
}

/** Imports from outside `module` that resolve into it but not to its index. */
export function deepImports(files: readonly Src[], module: string): string[] {
  const bad: string[] = [];
  for (const f of files) {
    if (f.path.startsWith(`${module}/`)) continue;
    for (const ref of ts.preProcessFile(f.text, true, true).importedFiles) {
      if (!ref.fileName.startsWith('.')) continue;
      const target = posix
        .normalize(posix.join(dirname(f.path), ref.fileName))
        .replace(/\.ts$/, '');
      const inside = target === module || target.startsWith(`${module}/`);
      const isIndex = target === module || target === `${module}/index`;
      if (inside && !isIndex) bad.push(`${f.path} -> ${ref.fileName}`);
    }
  }
  return bad;
}

describe('collision-nav public surface (SD-CN-03)', () => {
  const src = listTs('src');

  it.each(['src/physics', 'src/nav'])('finds no deep import into %s from src/', (module) => {
    expect(deepImports(src, module)).toEqual([]);
  });

  it('detects deep imports, type imports and re-exports', () => {
    const files: Src[] = [
      { path: 'src/sim/a.ts', text: "import { buildCollisionWorld } from '../physics';" },
      { path: 'src/sim/b.ts', text: "import type { Geometry } from '../physics/geometry';" },
      { path: 'src/ai/locomotion/c.ts', text: "export { createAStar } from '../../nav/astar';" },
      { path: 'src/nav/d.ts', text: "import { fits } from '../physics/shapes';" },
    ];
    expect(deepImports(files, 'src/physics')).toEqual([
      'src/sim/b.ts -> ../physics/geometry',
      'src/nav/d.ts -> ../physics/shapes',
    ]);
    expect(deepImports(files, 'src/nav')).toEqual(['src/ai/locomotion/c.ts -> ../../nav/astar']);
  });

  it('keeps no copy of WALKABLE_KINDS or MAP_RULES values in src/physics or src/nav (BR-CN-03)', () => {
    const own = src.filter(
      (f) => f.path.startsWith('src/physics/') || f.path.startsWith('src/nav/'),
    );
    for (const f of own) {
      expect(f.text).not.toMatch(/'walkway'|'platform'/);
      expect(f.text).not.toMatch(/0\.5774/);
    }
  });
});
