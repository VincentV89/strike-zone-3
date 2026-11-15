/**
 * BR-F-08: the tick rate is written down only in src/core/clock.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listTs(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('tick rate has one source', () => {
  it('finds `1 / 60` only in src/core/clock.ts', () => {
    const offenders = listTs('src')
      .filter((f) => /\b1\s*\/\s*60\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative('.', f).split('\\').join('/'))
      .filter((f) => f !== 'src/core/clock.ts');
    expect(offenders).toEqual([]);
  });
});
