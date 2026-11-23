/**
 * V1/V2 validation (security-design-graphics-uplift §3, BR-G-06/07): every committed asset
 * passes, and crafted or mutated bytes are rejected with render/asset-invalid, never with an
 * uncoded throw (seeded fuzz, SR-G-10).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/core';
import {
  checkGlb,
  checkGltfJson,
  checkKtx2,
  codedError,
} from '../../../src/render/assets/glb-check';

function glb(json: unknown, bin = new Uint8Array(8)): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const j = new TextEncoder().encode(text);
  const out = new Uint8Array(12 + 8 + j.length + 8 + bin.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, j.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  dv.setUint32(20 + j.length, bin.length, true);
  dv.setUint32(24 + j.length, 0x004e4942, true);
  out.set(bin, 28 + j.length);
  return out;
}

const OK = {
  asset: { version: '2.0' },
  buffers: [{ byteLength: 8 }],
  bufferViews: [{ buffer: 0, byteLength: 8 }],
  accessors: [{ bufferView: 0, count: 2 }],
};

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'uncoded';
  }
}

describe('GLB checks (V1/V2)', () => {
  it('accepts a minimal valid GLB and every committed model', () => {
    expect(
      code(() => {
        checkGlb(glb(OK));
      }),
    ).toBeNull();
    for (const f of readdirSync('assets/models')) {
      expect(
        code(() => {
          checkGlb(new Uint8Array(readFileSync(`assets/models/${f}`)));
        }),
        f,
      ).toBeNull();
    }
  });

  it.each([
    ['images', { ...OK, images: [{ uri: 'x.png' }] }],
    ['textures', { ...OK, textures: [{}] }],
    ['samplers', { ...OK, samplers: [{}] }],
    ['buffer uri', { ...OK, buffers: [{ byteLength: 8, uri: 'data:,x' }] }],
    ['draco', { ...OK, extensionsRequired: ['KHR_draco_mesh_compression'] }],
    ['view out of range', { ...OK, bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 8 }] }],
    ['bad accessor view', { ...OK, accessors: [{ bufferView: 7, count: 1 }] }],
    ['huge count', { ...OK, accessors: [{ bufferView: 0, count: 5e6 }] }],
    ['extra buffer without fallback', { ...OK, buffers: [{ byteLength: 8 }, { byteLength: 4 }] }],
    ['not an object', [1, 2]],
  ])('rejects %s', (_name, json) => {
    expect(
      code(() => {
        checkGlb(glb(json));
      }),
    ).toBe('render/asset-invalid');
  });

  it('accepts a meshopt fallback buffer', () => {
    const json = {
      ...OK,
      buffers: [
        { byteLength: 8 },
        { byteLength: 64, extensions: { EXT_meshopt_compression: { fallback: true } } },
      ],
      bufferViews: [
        {
          buffer: 1,
          byteLength: 64,
          extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 8 } },
        },
      ],
    };
    expect(
      code(() => {
        checkGltfJson(json, 8);
      }),
    ).toBeNull();
  });

  it('rejects wrong magic, version, length, a JSON chunk over 1 MB and broken JSON', () => {
    const good = glb(OK);
    const bad = (mutate: (dv: DataView, b: Uint8Array) => void): string | null => {
      const b = good.slice();
      mutate(new DataView(b.buffer), b);
      return code(() => {
        checkGlb(b);
      });
    };
    expect(
      bad((dv) => {
        dv.setUint32(0, 1, true);
      }),
    ).toBe('render/asset-invalid');
    expect(
      bad((dv) => {
        dv.setUint32(4, 1, true);
      }),
    ).toBe('render/asset-invalid');
    expect(
      bad((dv) => {
        dv.setUint32(8, 3, true);
      }),
    ).toBe('render/asset-invalid');
    expect(bad((_dv, b) => b.fill(0x7b, 20, 24))).toBe('render/asset-invalid');
    expect(
      code(() => {
        checkGlb(new Uint8Array(10));
      }),
    ).toBe('render/asset-invalid');
    const big = { ...OK, pad: 'x'.repeat(1024 * 1024) };
    expect(
      code(() => {
        checkGlb(glb(big));
      }),
    ).toBe('render/asset-invalid');
  });

  it('seeded fuzz: mutated committed GLBs either pass or fail with a code (SR-G-10)', () => {
    const rng = createRng(42).fork('glb-fuzz');
    const src = new Uint8Array(readFileSync('assets/models/vm-rifle.glb'));
    for (let i = 0; i < 300; i++) {
      const b = src.slice();
      const n = 1 + Math.floor(rng.next() * 8);
      for (let k = 0; k < n; k++)
        b[Math.floor(rng.next() * Math.min(b.length, 2400))] = Math.floor(rng.next() * 256);
      const c = code(() => {
        checkGlb(b);
      });
      expect(c === null || c === 'render/asset-invalid').toBe(true);
    }
  });
});

describe('KTX2 checks (V1)', () => {
  it('accepts every committed texture with a full mip chain', () => {
    for (const dir of ['assets/textures', 'assets/sky']) {
      for (const f of readdirSync(dir)) {
        const h = checkKtx2(new Uint8Array(readFileSync(`${dir}/${f}`)), 2048);
        expect(h.levels, f).toBe(Math.floor(Math.log2(Math.max(h.width, h.height))) + 1);
      }
    }
  });

  it('rejects a bad identifier, an oversize texture and a truncated level index', () => {
    const src = new Uint8Array(readFileSync('assets/textures/tex-sand-bc.ktx2'));
    const b = src.slice();
    b[0] = 0;
    expect(code(() => checkKtx2(b, 2048))).toBe('render/asset-invalid');
    expect(code(() => checkKtx2(src, 512))).toBe('render/asset-invalid');
    expect(code(() => checkKtx2(src.slice(0, 100), 2048))).toBe('render/asset-invalid');
  });

  it('seeded fuzz over the KTX2 header never throws uncoded', () => {
    const rng = createRng(7).fork('ktx-fuzz');
    const src = new Uint8Array(readFileSync('assets/textures/tex-sand-n.ktx2'));
    for (let i = 0; i < 300; i++) {
      const b = src.slice();
      b[Math.floor(rng.next() * 200)] = Math.floor(rng.next() * 256);
      const c = code(() => checkKtx2(b, 2048));
      expect(c === null || c === 'render/asset-invalid').toBe(true);
    }
  });

  it('codedError carries the closed code', () => {
    expect(codedError('render/asset-upload').code).toBe('render/asset-upload');
  });
});
