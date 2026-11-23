/**
 * Probes for the renderer ESLint blocks (security-design-presentation-3d
 * SEC-P-09): block A for src/render/** and block B for gl-host*.ts. Linted at
 * virtual paths, so the probe files never exist under src/.
 */
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
const RENDER = 'src/render/__probe__.ts';
const HOST = 'src/render/gl-host.__probe__.ts';
const KIT = 'src/render/assets/__probe__.ts';

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  const messages = result?.messages ?? [];
  const fatal = messages.find((m) => m.fatal === true);
  if (fatal !== undefined) throw new Error(`ESLint could not parse the probe: ${fatal.message}`);
  return messages.map((m) => m.ruleId ?? 'unknown');
}

const BANNED_BODY = [
  'export async function f(el: HTMLElement, c: HTMLCanvasElement, x: string): Promise<unknown> {',
  '  el.innerHTML = x;',
  '  const r = Math.random();',
  '  const d = Date.now();',
  '  const p = performance.now();',
  "  await fetch('/x');",
  "  localStorage.setItem('a', 'b');",
  '  const w = window.innerWidth;',
  "  await import('./x');",
  "  c.addEventListener('webglcontextlost', () => undefined);",
  '  return [r, d, p, w, import.meta.env.VITE_X];',
  '}',
  '',
].join('\n');

describe('render lint rules', () => {
  it('block A rejects inherited and renderer bans under src/render (override trap)', async () => {
    const ids = await ruleIds(BANNED_BODY, RENDER);
    // innerHTML, Math.random, performance.now
    expect(ids.filter((id) => id === 'no-restricted-properties').length).toBeGreaterThanOrEqual(3);
    // Date, fetch, localStorage, window
    expect(ids.filter((id) => id === 'no-restricted-globals').length).toBeGreaterThanOrEqual(4);
    // import(), import.meta.env.VITE_X, addEventListener
    expect(ids.filter((id) => id === 'no-restricted-syntax').length).toBeGreaterThanOrEqual(3);
  });

  it('block A rejects loaders, addons, DOM test libraries and WebGLRenderer imports', async () => {
    const ids = await ruleIds(
      [
        "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",
        "import { TextureLoader, WebGLRenderer } from 'three';",
        "import { Window } from 'happy-dom';",
        'export const x = [GLTFLoader, TextureLoader, WebGLRenderer, Window];',
        '',
      ].join('\n'),
      RENDER,
    );
    expect(ids.filter((id) => id === 'no-restricted-imports').length).toBeGreaterThanOrEqual(2);
    expect(ids.filter((id) => id === 'no-restricted-syntax').length).toBeGreaterThanOrEqual(2);
  });

  it('block B lets gl-host listen on the canvas and construct WebGLRenderer', async () => {
    const ids = await ruleIds(
      [
        "import { WebGLRenderer } from 'three';",
        'export function f(c: HTMLCanvasElement): WebGLRenderer {',
        "  c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });",
        '  return new WebGLRenderer({ canvas: c });',
        '}',
        '',
      ].join('\n'),
      HOST,
    );
    expect(ids).toEqual([]);
  });

  it('block B still rejects innerHTML, Math.random, fetch and import()', async () => {
    const ids = await ruleIds(
      BANNED_BODY.replace("  c.addEventListener('webglcontextlost', () => undefined);\n", ''),
      HOST,
    );
    expect(ids).toContain('no-restricted-properties');
    expect(ids).toContain('no-restricted-globals');
    expect(ids.filter((id) => id === 'no-restricted-syntax').length).toBeGreaterThanOrEqual(2);
  });

  it('block C accepts exactly the four kit addons (BR-G-03)', async () => {
    const ids = await ruleIds(
      [
        "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",
        "import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';",
        "import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';",
        "import { clone } from 'three/addons/utils/SkeletonUtils.js';",
        "import type { WebGLRenderer } from 'three';",
        'export const x: unknown[] = [GLTFLoader, KTX2Loader, MeshoptDecoder, clone];',
        'export type R = WebGLRenderer;',
        '',
      ].join('\n'),
      KIT,
    );
    expect(ids).toEqual([]);
  });

  it('block C rejects other loaders and addons, and keeps the inherited bans', async () => {
    const imports = await ruleIds(
      [
        "import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';",
        "import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';",
        "import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';",
        "import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';",
        'export const x: unknown[] = [OBJLoader, DRACOLoader, mergeGeometries, FBXLoader];',
        '',
      ].join('\n'),
      KIT,
    );
    expect(imports.filter((id) => id === 'no-restricted-imports')).toHaveLength(4);
    const body = await ruleIds(
      BANNED_BODY.replace(
        "  c.addEventListener('webglcontextlost', () => undefined);\n",
        '',
      ).replace('  return [r,', "  JSON.parse('1');\n  return [r,"),
      KIT,
    );
    expect(body).toContain('no-restricted-globals'); // fetch, localStorage, window, Date
    expect(body.filter((id) => id === 'no-restricted-properties').length).toBeGreaterThanOrEqual(4);
    expect(body).toContain('no-restricted-syntax'); // import(), import.meta.env
  });

  it('a GLTFLoader import outside kit.ts is still rejected (block A)', async () => {
    const ids = await ruleIds(
      [
        "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",
        'export const x = GLTFLoader;',
        '',
      ].join('\n'),
      RENDER,
    );
    expect(ids).toContain('no-restricted-imports');
    expect(ids).toContain('no-restricted-syntax');
  });
});
