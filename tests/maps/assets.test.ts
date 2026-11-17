/**
 * Original, procedural assets only (BR-M-36, SD-M-07, req-original-assets):
 * src/maps holds only TypeScript, definitions reference no URL, data: or blob:
 * resource, and every material is a recipe of numbers and enum strings.
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

  it('keeps assets-provenance.json empty', () => {
    expect(JSON.parse(readFileSync('assets-provenance.json', 'utf8'))).toEqual([]);
  });

  it.each(mapIds().map((id) => [id]))('%s references no external resource', (id) => {
    const bad = strings(getMap(id)).filter((s) => /:\/\/|data:|blob:/i.test(s));
    expect(bad).toEqual([]);
  });

  it.each(mapIds().map((id) => [id]))('%s materials are procedural recipes', (id) => {
    const def = getMap(id);
    for (const m of def.materials) {
      expect(PATTERNS.has(m.pattern)).toBe(true);
      expect(Object.keys(m).sort()).toEqual(
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
