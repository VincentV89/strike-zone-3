/**
 * Source-level checks that the lint rules cannot express (SD-H-01, SD-H-04,
 * SD-H-05) and the hud's import boundary (BR-H-22).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HUD_DIR = 'src/ui/hud';

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p, ext);
    return p.endsWith(ext) ? [p] : [];
  });
}

const sources = files(HUD_DIR, '.ts').map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('hud source rules', () => {
  it('passes only table strings to label(): no template literals, + or String() (SD-H-01)', () => {
    const offenders: string[] = [];
    for (const { path, text } of sources) {
      for (const m of text.matchAll(/\.label\(([^;]*)\);/g)) {
        if (/[`+]|String\(/.test(m[1] ?? '')) offenders.push(`${path}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never reads .bots inside the radar module (SD-H-04)', () => {
    const radar = sources.filter((s) => s.path.includes(join(HUD_DIR, 'radar')));
    expect(radar.length).toBeGreaterThan(0);
    for (const { text } of radar) expect(text).not.toMatch(/\.bots\b/);
  });

  it('imports no npm package and src/contracts type-only (BR-H-22, SD-H-06)', () => {
    // The import-graph test is the authority on edges; this is a fast, local guard.
    let imports = 0;
    for (const { path, text } of sources) {
      for (const m of text.matchAll(/^(?:import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)) {
        imports++;
        const spec = m[2] ?? '';
        expect(spec.startsWith('.'), `${path} imports ${spec}`).toBe(true);
        if (spec.endsWith('/contracts')) expect(m[1], `${path} -> ${spec}`).toBeDefined();
      }
    }
    expect(imports).toBeGreaterThan(20);
  });

  it('keeps the overlay inert in CSS: pointer-events none on .hud-root and never auto (SD-H-05)', () => {
    const css = readFileSync(join(HUD_DIR, 'hud.css'), 'utf8');
    expect(css).toMatch(/\.hud-root\s*\{[^}]*pointer-events:\s*none;/);
    expect(css).not.toMatch(/pointer-events:\s*(auto|all|visible)/);
    expect(css).not.toMatch(/url\(/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
