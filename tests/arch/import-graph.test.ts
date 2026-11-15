import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeImports, checkTable, type SourceFile, type ViolationKind } from './analyze-imports';
import { COMPONENTS, type ComponentSpec } from './component-table';

function listSourceFiles(dir: string): SourceFile[] {
  return readdirSync(dir).flatMap((name): SourceFile[] => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return listSourceFiles(p);
    if (!p.endsWith('.ts') || p.endsWith('.test.ts') || p.endsWith('.d.ts')) return [];
    return [{ path: p.split('\\').join('/'), text: readFileSync(p, 'utf8') }];
  });
}

function kinds(files: SourceFile[], table: readonly ComponentSpec[] = COMPONENTS): ViolationKind[] {
  return analyzeImports(files, table).map((v) => v.kind);
}

const f = (path: string, text: string): SourceFile => ({ path, text });

describe('import graph of src/ (check:imports)', () => {
  it('has no violations in the real source tree', () => {
    const files = listSourceFiles('src');
    expect(files.length).toBeGreaterThan(10);
    expect(analyzeImports(files, COMPONENTS)).toEqual([]);
  });

  it('encodes 24 components with a valid, acyclic declared table', () => {
    expect(COMPONENTS).toHaveLength(24);
    expect(checkTable(COMPONENTS)).toEqual([]);
  });

  it('keeps app-shell -> audio out until the audio unit adds it', () => {
    const appShell = COMPONENTS.find((c) => c.id === 'app-shell');
    expect(appShell?.deps['audio']).toBeUndefined();
  });

  it('gives only app-shell edges into both rings, not counting the shared kernel (BR-F-36)', () => {
    // core-kernel and contracts are the shared kernel every adapter may use;
    // the composition-root rule is about the other sim-ring components.
    const sharedKernel = new Set(['core-kernel', 'contracts']);
    const ringOf = new Map(COMPONENTS.map((c) => [c.id, c.ring]));
    const bothRings = COMPONENTS.filter((c) => {
      const deps = Object.keys(c.deps).filter((d) => !sharedKernel.has(d));
      const rings = new Set(deps.map((d) => ringOf.get(d)));
      return rings.has('sim') && rings.has('adapter');
    }).map((c) => c.id);
    expect(bothRings).toEqual(['app-shell']);
  });
});

describe('analyzeImports fixtures', () => {
  const core = f('src/core/index.ts', 'export const x = 1;\nexport type T = number;');

  it('accepts declared runtime and type-only edges', () => {
    expect(
      kinds([
        core,
        f(
          'src/weapons/a.ts',
          "import { x } from '../core';\nimport type { T } from '../core/index';",
        ),
      ]),
    ).toEqual([]);
  });

  it('reports an undeclared edge', () => {
    expect(
      kinds([
        core,
        f('src/weapons/a.ts', 'export {}'),
        f('src/core/b.ts', "import '../weapons/a';"),
      ]),
    ).toContain('undeclared-edge');
  });

  it('reports a type-only edge used at runtime, counting inline type specifiers correctly', () => {
    const contracts = f('src/contracts/round.ts', 'export type MapId = string;');
    expect(
      kinds([contracts, f('src/weapons/a.ts', "import { type MapId } from '../contracts/round';")]),
    ).toEqual([]);
    expect(
      kinds([contracts, f('src/weapons/a.ts', "import { MapId } from '../contracts/round';")]),
    ).toEqual(['type-edge-used-at-runtime']);
  });

  it('reports a sim-ring file importing an adapter component or three (ring rule)', () => {
    const app = f('src/render/r.ts', 'export const r = 1;');
    const result = kinds([
      app,
      f('src/physics/p.ts', "import { r } from '../render/r';\nimport * as THREE from 'three';"),
    ]);
    expect(result.filter((k) => k === 'ring-violation')).toHaveLength(2);
    expect(result).toContain('undeclared-edge');
  });

  it('reports npm packages outside the ring allowlist (SEC-F-03, QS-SEC-2)', () => {
    expect(kinds([f('src/sim/s.ts', "import _ from 'lodash';")])).toEqual(['ring-violation']);
    expect(
      kinds([f('src/render/r.ts', "import _ from 'lodash';\nimport { Mesh } from 'three';")]),
    ).toEqual(['package-not-allowed']);
    expect(kinds([f('src/render/r.ts', "import { readFileSync } from 'node:fs';")])).toEqual([
      'package-not-allowed',
    ]);
  });

  it('reports runtime code in contracts but allows types, as-const tables and contracts re-exports', () => {
    expect(
      kinds([
        f('src/core/types.ts', 'export type Seed = number;'),
        f(
          'src/contracts/round.ts',
          "import type { Seed } from '../core/types';\nexport const BOT_COUNTS = [1, 2] as const;\nexport interface R { seed: Seed }",
        ),
        f(
          'src/contracts/index.ts',
          "export { BOT_COUNTS } from './round';\nexport type { R } from './round';",
        ),
      ]),
    ).toEqual([]);
    expect(
      kinds([f('src/contracts/bad.ts', 'export function f() { return 1; }\nexport let y = 2;')]),
    ).toEqual(['contracts-runtime-code', 'contracts-runtime-code']);
  });

  it('reports bot AI importing the sim world (perception rule)', () => {
    const result = kinds([
      f('src/sim/world.ts', 'export const w = 1;'),
      f('src/ai/brain/b.ts', "import { w } from '../../sim/world';"),
    ]);
    expect(result).toContain('perception-bypass');
    expect(result).toContain('undeclared-edge');
  });

  it('reports a cycle that only type-only imports create', () => {
    const table: ComponentSpec[] = [
      { id: 'a', ring: 'sim', prefixes: ['src/a'], deps: { b: 'T' } },
      { id: 'b', ring: 'sim', prefixes: ['src/b'], deps: {} },
    ];
    const files = [
      f('src/a/x.ts', "import type { Y } from '../b/y';\nexport type X = number;"),
      f('src/b/y.ts', "import type { X } from '../a/x';\nexport type Y = number;"),
    ];
    const violations = analyzeImports(files, table);
    expect(violations.map((v) => v.kind).sort()).toEqual(['cycle', 'undeclared-edge']);
    expect(violations.find((v) => v.kind === 'cycle')?.path).toEqual(['a', 'b']);
  });

  it('reports unmapped files and unresolved imports', () => {
    expect(kinds([f('src/misc/z.ts', 'export {}')])).toEqual(['unmapped-file']);
    expect(kinds([f('src/core/a.ts', "import { q } from './missing';")])).toEqual([
      'unresolved-import',
    ]);
  });

  it('counts dynamic import() and import types as edges', () => {
    const files = [
      f('src/render/r.ts', 'export const r = 1;'),
      f('src/core/a.ts', "export async function load() { return import('../render/r'); }"),
      f('src/core/b.ts', "export type R = typeof import('../render/r');"),
    ];
    expect(kinds(files).filter((k) => k === 'undeclared-edge')).toHaveLength(2);
  });

  it('reports an invalid declared table', () => {
    const table: ComponentSpec[] = [
      { id: 'a', ring: 'sim', prefixes: ['src/a'], deps: { b: 'R', ghost: 'T' } },
      { id: 'b', ring: 'sim', prefixes: ['src/b'], deps: { a: 'R' } },
    ];
    const result = checkTable(table);
    expect(result.map((v) => v.kind)).toEqual(['table-invalid', 'table-invalid']);
    expect(result.map((v) => v.message).join('\n')).toMatch(/unknown ghost[\s\S]*cycle/);
  });

  it('maps files by longest prefix (src/sim/player is player-controller)', () => {
    expect(
      kinds([
        core,
        f('src/sim/player/p.ts', "import { x } from '../../core';"),
        f('src/sim/s.ts', "import '../sim/player/p';"),
      ]),
    ).toEqual([]);
  });
});
