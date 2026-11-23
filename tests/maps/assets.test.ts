/**
 * Map data stays data (BR-M-36, SD-M-07, BR-G-27): src/maps holds only TypeScript,
 * definitions reference no URL, data: or blob: resource, and every material is a
 * procedural recipe plus at most an authored PBR set key (graphics uplift RULE CHANGE:
 * binary assets live under assets/ with v2 provenance, never in src/maps).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMap, mapIds } from '../../src/maps';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

function strings(root: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'object' && v !== null) stack.push(...(Object.values(v) as unknown[]));
  }
  return out;
}

const PATTERNS = new Set(['noise', 'blocks', 'planks', 'corrugated', 'stripes', 'tiles', 'plain']);

describe('map assets', () => {
  it('ships only .ts files under src/maps', () => {
    const all = files('src/maps');
    expect(all.length).toBeGreaterThan(5);
    expect(all.filter((f) => !f.endsWith('.ts'))).toEqual([]);
  });

  it('lists every binary asset in assets-provenance.json as CC0, original or procedural (BR-G-80)', () => {
    const entries = JSON.parse(readFileSync('assets-provenance.json', 'utf8')) as {
      path: string;
      origin: string;
    }[];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(['cc0', 'original', 'procedural']).toContain(e.origin);
      expect(e.path.startsWith('assets/')).toBe(true);
    }
  });

  it.each(mapIds().map((id) => [id]))('%s keys match ^[a-z0-9-]+$ (BR-G-27)', (id) => {
    const def = getMap(id);
    const keys = [
      ...def.materials.flatMap((m) => (m.pbr === undefined ? [] : [m.pbr])),
      ...(def.lighting.atmosphere === undefined ? [] : [def.lighting.atmosphere.sky]),
      ...(def.dressing?.props.map((p) => p[0]) ?? []),
      ...(def.dressing?.scatter.map((s) => s.kind) ?? []),
      ...(def.dressing?.backdrop.map((b) => b.model) ?? []),
    ];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]+$/);
  });

  it.each(mapIds().map((id) => [id]))('%s references no external resource', (id) => {
    const bad = strings(getMap(id)).filter((s) => /:\/\/|data:|blob:/i.test(s));
    expect(bad).toEqual([]);
  });

  it.each(mapIds().map((id) => [id]))('%s materials are procedural recipes', (id) => {
    const def = getMap(id);
    for (const m of def.materials) {
      expect(PATTERNS.has(m.pattern)).toBe(true);
      const keys = Object.keys(m).filter((k) => k !== 'pbr' && k !== 'pbrTint');
      expect(keys.sort()).toEqual(
        ['accent', 'base', 'id', 'metalness', 'pattern', 'repeatM', 'roughness'].sort(),
      );
    }
    const used = new Set([
      ...def.solids.map((s) => s.material),
      ...def.ramps.map((r) => r.material),
    ]);
    expect([...used].every((u) => def.materials.some((m) => m.id === u))).toBe(true);
  });
});
