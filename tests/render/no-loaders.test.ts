/**
 * Source tests for the renderer boundary (SEC-P-01, SEC-P-04, SEC-P-08):
 * no loaders or image files, and only gl-host.ts reaches WebGLRenderer, the
 * canvas listeners and the DOM.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = 'src/render';
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
const source = (f: string): string => readFileSync(join(DIR, f), 'utf8');

describe('renderer source boundary', () => {
  it('contains only TypeScript files (no images, models or fonts)', () => {
    expect(readdirSync(DIR).every((f) => f.endsWith('.ts'))).toBe(true);
  });

  it('uses no three.js loaders', () => {
    for (const f of files) expect(source(f)).not.toMatch(/\b\w*Loader\b|Loader\(/);
  });

  it('keeps WebGLRenderer, canvas listeners and getContext in gl-host.ts only', () => {
    for (const f of files) {
      if (f === 'gl-host.ts') continue;
      const s = source(f);
      expect(s, f).not.toMatch(/import[^;]*\bWebGLRenderer\b[^;]*from/);
      expect(s, f).not.toMatch(/addEventListener|removeEventListener|getContext\(/);
      expect(s, f).not.toMatch(/\bdocument\./);
    }
    expect(source('gl-host.ts')).toMatch(/new WebGLRenderer/);
  });

  it('imports three by bare name only (no addons or examples)', () => {
    for (const f of files) {
      for (const m of source(f).matchAll(/from '(three[^']*)'/g)) expect(m[1]).toBe('three');
    }
  });

  it('assigns nothing to window or globalThis (SEC-P-11)', () => {
    for (const f of files) expect(source(f)).not.toMatch(/\b(window|globalThis)\b/);
  });
});
