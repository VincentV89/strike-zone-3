/** check:assets (TS-G-07): rules over a fixture tree and the committed assets/. */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chainTexels, glbFindings, ktx2Info, runCheckAssets } from '../../scripts/check-assets.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixture(extra: Record<string, string | Uint8Array> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'sz-assets-'));
  dirs.push(root);
  cpSync('assets', join(root, 'assets'), { recursive: true });
  const basis = join(root, 'node_modules/three/examples/jsm/libs/basis');
  mkdirSync(basis, { recursive: true });
  cpSync(
    'node_modules/three/examples/jsm/libs/basis/basis_transcoder.js',
    join(basis, 'basis_transcoder.js'),
  );
  cpSync(
    'node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm',
    join(basis, 'basis_transcoder.wasm'),
  );
  const dist = join(root, 'dist/assets');
  mkdirSync(dist, { recursive: true });
  cpSync(join(basis, 'basis_transcoder.js'), join(dist, 'basis_transcoder-aa.js'));
  cpSync(join(basis, 'basis_transcoder.wasm'), join(dist, 'basis_transcoder-aa.wasm'));
  writeFileSync(join(dist, 'kit-aa.js'), 'export {};');
  writeFileSync(join(dist, 'index-aa.js'), 'export {};');
  for (const [k, v] of Object.entries(extra)) writeFileSync(join(root, k), v);
  return root;
}

const rules = (root: string): string[] => runCheckAssets(root).findings.map((f) => f.rule);

describe('check:assets', () => {
  it('passes the committed assets with a well-formed dist', () => {
    const r = runCheckAssets(fixture());
    expect(r.findings).toEqual([]);
    expect(r.inventoryTexels['both']).toBeGreaterThan(0);
    expect(r.perMapBytes['desert-compound']).toBeGreaterThan(0);
  });

  it('fails an unknown extension, a missing kit chunk and a changed transcoder', () => {
    const root = fixture({
      'dist/assets/font-aa.woff2': 'x',
      'dist/assets/basis_transcoder-aa.js': 'changed',
    });
    rmSync(join(root, 'dist/assets/kit-aa.js'));
    expect(rules(root).sort()).toEqual(['kit-chunk', 'partition', 'transcoder']);
  });

  it('fails a missing dist', () => {
    const root = fixture();
    rmSync(join(root, 'dist'), { recursive: true });
    expect(rules(root)).toContain('dist-missing');
  });

  it('flags GLB images, buffer URIs and broken files; reads KTX2 headers', () => {
    const json = JSON.stringify({ images: [{}], buffers: [{ uri: 'x' }] }).padEnd(48, ' ');
    const j = new TextEncoder().encode(json);
    const b = new Uint8Array(20 + j.length);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(12, j.length, true);
    b.set(j, 20);
    expect(glbFindings('x.glb', b).map((f) => f.detail)).toEqual([
      'x.glb: has images',
      'x.glb: buffer uri',
    ]);
    expect(glbFindings('y.glb', new Uint8Array(4))[0]?.detail).toBe('y.glb: not a GLB');
    expect(ktx2Info(new Uint8Array(10))).toBeNull();
    expect(chainTexels(4, 2)).toBe(8 + 2 + 1);
  });
});
