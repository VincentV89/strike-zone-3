/** check:seams (SD-AS-02, PD-AS-15): one finding per bad fixture, none for a clean bundle. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ENTRY_MAX_BROTLI_BYTES,
  ENTRY_MAX_BYTES,
  entryChunkOf,
  runCheckSeams,
} from '../../scripts/check-seams.ts';

const scratch = mkdtempSync(join(tmpdir(), 'sz-seams-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const HTML =
  '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-abc.js"></script></head><body></body></html>';

function fixture(name: string, files: Record<string, string | Buffer>): string {
  const root = join(scratch, name);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, 'dist', rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

// Marker literals are built by concatenation so this file carries none.
const MARKERS = [
  '__strike' + 'zone',
  'strikezone:' + 'pointer-lock-bypass',
  'strikezone:' + 'dev-overlay',
  'install' + 'TestSeams',
];

describe('check:seams', () => {
  it('passes a clean bundle and writes the report', () => {
    const root = fixture('clean', { 'index.html': HTML, 'assets/index-abc.js': 'export {};' });
    const r = runCheckSeams(root);
    expect(r.ok).toBe(true);
    expect(r.entry.file).toBe('assets/index-abc.js');
    expect(r.entry.bytes).toBe(10);
    const saved = JSON.parse(
      readFileSync(join(root, 'reports', 'app-shell-bundle.json'), 'utf8'),
    ) as {
      ok: boolean;
    };
    expect(saved.ok).toBe(true);
  });

  it.each(MARKERS)('fails exactly once on marker %s', (marker) => {
    const root = fixture(`m-${marker.replace(/\W/g, '')}`, {
      'index.html': HTML,
      'assets/index-abc.js': `const x = "${marker}";`,
    });
    const r = runCheckSeams(root);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.rule).toBe('seam-marker');
  });

  it('fails on a dev chunk', () => {
    const root = fixture('devchunk', {
      'index.html': HTML,
      'assets/index-abc.js': 'export {};',
      'assets/dev-xyz.js': 'export {};',
    });
    expect(runCheckSeams(root).findings.map((f) => f.rule)).toEqual(['dev-chunk']);
  });

  it('fails an oversize entry chunk (minified budget)', () => {
    // Random-looking bytes do not compress, so this also trips the brotli budget.
    let seed = 1;
    const big = Buffer.alloc(ENTRY_MAX_BYTES + 1);
    for (let i = 0; i < big.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      big[i] = 97 + ((seed >>> 16) % 26);
    }
    const root = fixture('big', { 'index.html': HTML, 'assets/index-abc.js': big });
    const rules = runCheckSeams(root).findings.map((f) => f.rule);
    expect(rules).toContain('entry-oversize');
    expect(ENTRY_MAX_BROTLI_BYTES).toBe(200 * 1024);
    const ok = fixture('compressible', {
      'index.html': HTML,
      'assets/index-abc.js': 'a'.repeat(ENTRY_MAX_BYTES),
    });
    expect(runCheckSeams(ok).ok).toBe(true);
  });

  it('fails when dist/ or the entry script is missing', () => {
    expect(runCheckSeams(join(scratch, 'none')).findings.map((f) => f.rule)).toEqual([
      'dist-missing',
    ]);
    const root = fixture('noentry', { 'index.html': '<html></html>', 'x.txt': '' });
    expect(runCheckSeams(root).findings.map((f) => f.rule)).toEqual(['entry-missing']);
    const noIndex = fixture('noindex', { 'assets/a.js': '' });
    expect(runCheckSeams(noIndex).findings.map((f) => f.rule)).toEqual(['entry-missing']);
  });

  it('reads the module script tag only', () => {
    expect(entryChunkOf(HTML)).toBe('assets/index-abc.js');
    expect(entryChunkOf('<script src="/x.js"></script>')).toBeNull();
  });
});
