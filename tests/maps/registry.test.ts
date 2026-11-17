/**
 * Registry and public surface: BR-M-80 to BR-M-84, SD-M-03 (deep freeze),
 * SD-M-04 (prototype-safe lookup), SD-M-05 (single surface) and SD-M-08
 * (no globals).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { StrikeZoneError } from '../../src/core';
import type { MapId } from '../../src/contracts';
import { getMap, mapIds, MAP_RULES, WALKABLE_KINDS } from '../../src/maps';

describe('getMap and mapIds', () => {
  it('returns each registered map with its id and display name (BR-M-80)', () => {
    expect(getMap('desert-compound').id).toBe('desert-compound');
    expect(getMap('desert-compound').name).toBe('Desert Compound');
    expect(getMap('industrial-warehouse').id).toBe('industrial-warehouse');
    expect(getMap('industrial-warehouse').name).toBe('Industrial Warehouse');
  });

  it('returns the same object on every call (BR-M-81)', () => {
    expect(getMap('desert-compound')).toBe(getMap('desert-compound'));
  });

  it.each([['nope'], ['__proto__'], ['constructor'], ['toString'], ['']])(
    'throws maps/unknown-map for %j (BR-M-82, SEC-M-04)',
    (id) => {
      let caught: unknown;
      try {
        getMap(id);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrikeZoneError);
      expect((caught as StrikeZoneError).code).toBe('maps/unknown-map');
      expect((caught as StrikeZoneError).detail).toEqual({ id });
      expect((caught as StrikeZoneError).message).toBe('Unknown map id');
    },
  );

  it('lists ids in menu order, frozen, covering the whole MapId union (BR-M-84)', () => {
    expect(mapIds()).toEqual(['desert-compound', 'industrial-warehouse']);
    expect(Object.isFrozen(mapIds())).toBe(true);
    expect(mapIds()).toBe(mapIds());
    const all: Record<MapId, true> = { 'desert-compound': true, 'industrial-warehouse': true };
    expect(new Set(mapIds())).toEqual(new Set(Object.keys(all)));
  });
});

/** Every object reachable from `root`, iteratively. */
function reachable(root: object): object[] {
  const seen = new Set<object>();
  const stack: object[] = [root];
  while (stack.length > 0) {
    const o = stack.pop();
    if (o === undefined || seen.has(o)) continue;
    seen.add(o);
    for (const v of Object.values(o))
      if (typeof v === 'object' && v !== null) stack.push(v as object);
  }
  return [...seen];
}

describe('immutability (BR-M-83, SD-M-03)', () => {
  it('deep-freezes every registered definition', () => {
    for (const id of mapIds()) {
      const objects = reachable(getMap(id));
      expect(objects.length).toBeGreaterThan(500);
      expect(objects.every((o) => Object.isFrozen(o))).toBe(true);
    }
  });

  it('throws TypeError on writes to nested values', () => {
    const def = getMap('desert-compound');
    const spawn = def.spawns[0] as unknown as { pos: { x: number } };
    expect(() => {
      spawn.pos.x = 1;
    }).toThrow(TypeError);
    expect(() => {
      (def.solids as unknown as unknown[]).push(null);
    }).toThrow(TypeError);
  });

  it('keeps MAP_RULES and WALKABLE_KINDS read-only', () => {
    expect(Object.isFrozen(MAP_RULES)).toBe(true);
    expect([...WALKABLE_KINDS].sort()).toEqual(['floor', 'ground', 'platform', 'walkway']);
    const kinds = WALKABLE_KINDS as Set<string>;
    expect(() => kinds.add('crate')).toThrow(TypeError);
    expect(() => kinds.delete('ground')).toThrow(TypeError);
    expect(() => {
      kinds.clear();
    }).toThrow(TypeError);
    expect(WALKABLE_KINDS.has('ground')).toBe(true);
  });
});

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

/**
 * Module specifiers (static import, import type, export from) in files outside
 * src/maps that resolve into src/maps but not to its index (SD-M-05).
 */
function privateMapImports(files: readonly Src[]): string[] {
  const bad: string[] = [];
  for (const f of files) {
    if (f.path.startsWith('src/maps/')) continue;
    for (const ref of ts.preProcessFile(f.text, true, true).importedFiles) {
      if (!ref.fileName.startsWith('.')) continue;
      const target = posix
        .normalize(posix.join(dirname(f.path), ref.fileName))
        .replace(/\.ts$/, '');
      const inMaps = target === 'src/maps' || target.startsWith('src/maps/');
      const isIndex = target === 'src/maps' || target === 'src/maps/index';
      if (inMaps && !isIndex) bad.push(`${f.path} -> ${ref.fileName}`);
    }
  }
  return bad;
}

describe('single public surface (SD-M-05)', () => {
  it('finds no import of a private src/maps module outside src/maps', () => {
    expect(privateMapImports(listTs('src'))).toEqual([]);
  });

  it('detects private imports, type imports and re-exports', () => {
    const files: Src[] = [
      { path: 'src/sim/a.ts', text: "import { getMap } from '../maps';" },
      { path: 'src/sim/b.ts', text: "import { getMap } from '../maps/index';" },
      { path: 'src/sim/c.ts', text: "import { DESERT_COMPOUND } from '../maps/desert-compound';" },
      { path: 'src/render/d.ts', text: "import type { Solid } from '../maps/types';" },
      { path: 'src/nav/e.ts', text: "export { WALKABLE_KINDS } from '../maps/rules';" },
    ];
    expect(privateMapImports(files)).toEqual([
      'src/sim/c.ts -> ../maps/desert-compound',
      'src/render/d.ts -> ../maps/types',
      'src/nav/e.ts -> ../maps/rules',
    ]);
  });

  it('exports only the documented runtime values', async () => {
    const surface = await import('../../src/maps/index');
    expect(Object.keys(surface).sort()).toEqual([
      'MAP_RULES',
      'REQUIRED_FEATURES',
      'WALKABLE_KINDS',
      'checkMapData',
      'getMap',
      'mapIds',
    ]);
  });
});

describe('no globals (SD-M-08)', () => {
  it('adds no property to globalThis when the maps are evaluated', async () => {
    vi.resetModules();
    const before = new Set(Object.getOwnPropertyNames(globalThis));
    const fresh = await import('../../src/maps/index');
    fresh.getMap('industrial-warehouse');
    const added = Object.getOwnPropertyNames(globalThis).filter((n) => !before.has(n));
    expect(added).toEqual([]);
  });
});
