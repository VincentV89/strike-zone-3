/** Second line behind lint (SEC-MS-08, SD-MS-03): grep the four unit paths. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src/ui/screens', 'src/ui/components', 'src/settings', 'src/persistence'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const ALL = ROOTS.flatMap(files);

describe('menus-settings sources', () => {
  it('contain only .ts and .css files', () => {
    expect(ALL.length).toBeGreaterThan(20);
    for (const f of ALL) expect(f).toMatch(/\.(ts|css)$/);
  });

  it.each([
    /sendBeacon/,
    /\bfetch\(/,
    /new Function/,
    /\beval\(/,
    /XMLHttpRequest/,
    /WebSocket/,
    /innerHTML/,
  ])('never use %s', (re) => {
    for (const f of ALL) expect(readFileSync(f, 'utf8'), f).not.toMatch(re);
  });

  it('read window.localStorage nowhere (only app-shell may)', () => {
    for (const f of ALL.filter((x) => x.endsWith('.ts'))) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/\blocalStorage\b/);
    }
  });

  it('call console.error nowhere (SEC-MS-05)', () => {
    for (const f of ALL) expect(readFileSync(f, 'utf8'), f).not.toMatch(/console\.error/);
  });
});
