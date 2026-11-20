/**
 * Source tests for the renderer boundary (SEC-P-01/04/08, graphics uplift BR-G-01..05,
 * security-design-graphics-uplift §2.2/§2.3):
 * - src/render holds only TypeScript; binaries live under the repo-root assets/.
 * - three/addons only in assets/kit.ts, and only the four allowed modules.
 * - no Loader identifier outside kit.ts; glb-check.ts imports nothing from three/addons.
 * - no AnimationMixer, AnimationAction or PropertyBinding anywhere in src (TS-G-02).
 * - only gl-host.ts reaches WebGLRenderer, canvas listeners and the DOM; kit.ts may name
 *   the WebGLRenderer type it is handed through GlHost.bindKit (BR-G-04).
 * - entry modules import the kit-chunk modules as types only (§2.1).
 * - manifest URLs are ?url import bindings, never string literals (§2.3).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const DIR = 'src/render';
const all = walk(DIR).map((p) => p.split('\\').join('/'));
const files = all.filter((f) => f.endsWith('.ts'));
const source = (f: string): string => readFileSync(f, 'utf8');
const KIT = 'src/render/assets/kit.ts';
const ALLOWED_ADDONS = new Set([
  'three/addons/loaders/GLTFLoader.js',
  'three/addons/loaders/KTX2Loader.js',
  'three/addons/libs/meshopt_decoder.module.js',
  'three/addons/utils/SkeletonUtils.js',
]);
/** Modules that only run after the kit loaded; they belong to the lazy chunk. */
const KIT_CHUNK = [
  'assets/kit',
  'assets/glb-check',
  'assets/manifest',
  'assets/manifest.data',
  'assets/texture-sets',
  'assets/texture-sets.data',
  'assets/character',
  'assets/dressing',
  'assets/runtime',
  'assets/apply',
];

function imports(text: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = [];
  for (const m of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)';/gms)) {
    out.push({ spec: m[2] ?? '', typeOnly: m[1] !== undefined });
  }
  return out;
}

describe('renderer source boundary', () => {
  it('contains only TypeScript files (no images, models or fonts)', () => {
    expect(all.filter((f) => !f.endsWith('.ts'))).toEqual([]);
  });

  it('imports three/addons only in kit.ts, and only the four allowed modules (BR-G-03)', () => {
    for (const f of files) {
      for (const { spec } of imports(source(f))) {
        if (!spec.startsWith('three/')) continue;
        expect(f, spec).toBe(KIT);
        expect(ALLOWED_ADDONS.has(spec), spec).toBe(true);
      }
      for (const m of source(f).matchAll(/from '(three[^']*)'/g)) {
        if (f !== KIT) expect(m[1]).toBe('three');
      }
    }
  });

  it('names loaders only in kit.ts and glb-check.ts', () => {
    for (const f of files) {
      if (f === KIT || f.endsWith('/glb-check.ts')) continue;
      expect(source(f), f).not.toMatch(/\b\w*Loader\b|Loader\(/);
    }
    expect(source('src/render/assets/glb-check.ts')).not.toMatch(/from 'three/);
  });

  it('never references AnimationMixer, AnimationAction or PropertyBinding (TS-G-02)', () => {
    for (const f of walk('src').filter((x) => x.endsWith('.ts'))) {
      expect(source(f), f).not.toMatch(/\b(AnimationMixer|AnimationAction|PropertyBinding)\b/);
    }
  });

  it('keeps WebGLRenderer, canvas listeners and getContext in gl-host.ts only', () => {
    for (const f of files) {
      if (f.endsWith('/gl-host.ts')) continue;
      const s = source(f);
      if (f !== KIT) expect(s, f).not.toMatch(/import[^;]*\bWebGLRenderer\b[^;]*from/);
      expect(s, f).not.toMatch(/addEventListener|removeEventListener|getContext\(/);
      expect(s, f).not.toMatch(/\bdocument\./);
    }
    expect(source('src/render/gl-host.ts')).toMatch(/new WebGLRenderer/);
  });

  it('does no I/O: no fetch, no URL building (BR-G-01)', () => {
    for (const f of files) {
      const s = source(f);
      expect(s, f).not.toMatch(/\bfetch\(|XMLHttpRequest|new URL\(/);
    }
  });

  it('entry modules import kit-chunk modules as types only (security-design §2.1)', () => {
    const kitFiles = new Set(KIT_CHUNK.map((m) => `${DIR}/${m}.ts`));
    for (const f of files) {
      if (kitFiles.has(f)) continue;
      for (const { spec, typeOnly } of imports(source(f))) {
        if (!spec.startsWith('.')) continue;
        const target = `${posix.join(posix.dirname(f), spec)}.ts`;
        if (kitFiles.has(target)) expect(typeOnly, `${f} -> ${spec}`).toBe(true);
      }
    }
  });

  it('takes every manifest URL from a ?url import binding (BR-G-05)', () => {
    const s = source('src/render/assets/manifest.data.ts');
    expect(s).not.toMatch(/url:\s*['"]/);
    const urls = [...s.matchAll(/^import u\d+ from '\.\.\/\.\.\/\.\.\/assets\/[^']+\?url';$/gm)];
    const entries = [...s.matchAll(/url: u\d+/g)];
    expect(urls.length).toBeGreaterThan(0);
    expect(entries.length).toBe(urls.length);
  });

  it('assigns nothing to window or globalThis (SEC-P-11)', () => {
    for (const f of files) expect(source(f)).not.toMatch(/\b(window|globalThis)\b/);
  });
});
