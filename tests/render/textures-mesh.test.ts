import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { fnv1a32 } from '../../src/core';
import { getMap, mapIds, type MapDefinition, type MaterialHint } from '../../src/maps';
import { MAP_TEXTURE_SIZE } from '../../src/render/constants';
import { buildBuckets, bucketGeometry, isCasterSolid } from '../../src/render/map-mesh';
import {
  hash32,
  hashUnit,
  makeTexture,
  paintDecal,
  paintDot,
  paintFlash,
  paintMaterial,
} from '../../src/render/textures';
import type { MapId } from '../../src/contracts';

const PATTERNS = ['noise', 'blocks', 'planks', 'corrugated', 'stripes', 'tiles', 'plain'] as const;

function hint(id: string, pattern: MaterialHint['pattern']): MaterialHint {
  return {
    id,
    pattern,
    base: 0x806040,
    accent: 0x202020,
    roughness: 0.8,
    metalness: 0,
    repeatM: 2,
  };
}

function digest(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

describe('procedural textures (req-original-assets)', () => {
  it('paints every pattern deterministically, opaque and full size', () => {
    for (const p of PATTERNS) {
      const a = paintMaterial(hint(`t-${p}`, p), 64);
      const b = paintMaterial(hint(`t-${p}`, p), 64);
      expect(a.length).toBe(64 * 64 * 4);
      expect(digest(a)).toBe(digest(b));
      for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
    }
  });

  it('seeds from the material id, so different ids paint different pixels', () => {
    const a = paintMaterial(hint('sand', 'noise'), 64);
    const b = paintMaterial(hint('sand-2', 'noise'), 64);
    expect(digest(a)).not.toBe(digest(b));
    expect(fnv1a32('sand')).not.toBe(fnv1a32('sand-2'));
  });

  it('patterns differ visibly from a flat fill', () => {
    for (const p of PATTERNS) {
      const px = paintMaterial(hint('v', p), 64);
      const reds = new Set<number>();
      for (let i = 0; i < px.length; i += 4) reds.add(px[i] ?? 0);
      expect(reds.size).toBeGreaterThan(2);
    }
  });

  it('paints sprite textures with alpha and wraps them as sRGB DataTextures', () => {
    for (const data of [paintFlash(32), paintDecal(32), paintDot(16)]) {
      let maxA = 0;
      let minA = 255;
      for (let i = 3; i < data.length; i += 4) {
        maxA = Math.max(maxA, data[i] ?? 0);
        minA = Math.min(minA, data[i] ?? 0);
      }
      expect(maxA).toBeGreaterThan(200);
      expect(minA).toBeLessThan(20);
    }
    const tex = makeTexture(paintDot(16), 16, { repeat: true, anisotropy: 4 });
    expect(tex.colorSpace).toBe('srgb');
    expect(tex.anisotropy).toBe(4);
    tex.dispose();
  });

  it('keeps map texture memory under 8 MB per map (PR-P-12)', () => {
    for (const id of mapIds()) {
      const def = getMap(id);
      const used = new Set([
        ...def.solids.map((s) => s.material),
        ...def.ramps.map((r) => r.material),
      ]);
      const bytes = used.size * MAP_TEXTURE_SIZE * MAP_TEXTURE_SIZE * 4 * (4 / 3);
      expect(bytes).toBeLessThan(8 * 1024 * 1024);
    }
  });

  it('hashes integers deterministically into [0, 1)', () => {
    expect(hash32(1, 2, 3)).toBe(hash32(1, 2, 3));
    expect(hash32(1, 2, 3)).not.toBe(hash32(1, 2, 4));
    for (let i = 0; i < 1000; i++) {
      const u = hashUnit(i, 7);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});

function checkBuckets(def: MapDefinition): void {
  const buckets = buildBuckets(def);
  const floorY = def.bounds.min.y;
  // One bucket per used material and caster flag; ≤ 16 per shipped map (PD-P-02).
  expect(buckets.length).toBeLessThanOrEqual(16);
  const used = new Set([...def.solids.map((s) => s.material), ...def.ramps.map((r) => r.material)]);
  expect(new Set(buckets.map((b) => b.material))).toEqual(used);
  // Triangles: 12 per solid minus 2 per dropped bottom face, plus 8 per ramp.
  let expected = 0;
  for (const s of def.solids) expected += Math.abs(s.box.min.y - floorY) < 1e-6 ? 10 : 12;
  expected += def.ramps.length * 8;
  expect(buckets.reduce((n, b) => n + b.triangles, 0)).toBe(expected);
  // Caster flags (BR-P-30).
  for (const b of buckets) {
    const solids = def.solids.filter(
      (s) => s.material === b.material && isCasterSolid(s) === b.caster,
    );
    expect(b.solidCount).toBe(solids.length);
    if (!b.caster) expect(b.rampCount).toBe(0);
  }
  const { min, max } = def.bounds;
  const a = new Vector3();
  const b2 = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  for (const b of buckets) {
    for (let i = 0; i < b.positions.length; i += 3) {
      const x = b.positions[i] ?? 0;
      const y = b.positions[i + 1] ?? 0;
      const z = b.positions[i + 2] ?? 0;
      expect(x).toBeGreaterThanOrEqual(min.x - 1e-3);
      expect(x).toBeLessThanOrEqual(max.x + 1e-3);
      expect(y).toBeGreaterThanOrEqual(min.y - 1e-3);
      expect(y).toBeLessThanOrEqual(max.y + 1e-3);
      expect(z).toBeGreaterThanOrEqual(min.z - 1e-3);
      expect(z).toBeLessThanOrEqual(max.z + 1e-3);
    }
    // Winding agrees with the stored outward normal on every triangle.
    for (let t = 0; t < b.indices.length; t += 3) {
      const ia = (b.indices[t] ?? 0) * 3;
      const ib = (b.indices[t + 1] ?? 0) * 3;
      const ic = (b.indices[t + 2] ?? 0) * 3;
      a.fromArray(b.positions, ia);
      b2.fromArray(b.positions, ib);
      c.fromArray(b.positions, ic);
      n.fromArray(b.normals, ia);
      const geo = b2.sub(a).cross(c.sub(a));
      if (geo.lengthSq() > 1e-12) expect(geo.dot(n)).toBeGreaterThan(0);
      expect(n.length()).toBeCloseTo(1, 5);
    }
  }
}

describe('map mesh (story-desert-compound-map render, BR-P-30)', () => {
  for (const id of ['desert-compound', 'industrial-warehouse'] as MapId[]) {
    it(`buckets ${id} by material with outward faces inside the bounds`, () => {
      checkBuckets(getMap(id));
    });
  }

  it('scales UVs with repeatM (world-space tiling)', () => {
    const base = getMap('desert-compound');
    const solid = base.solids.find((s) => s.kind === 'crate') ?? base.solids[1];
    if (solid === undefined) throw new Error('no solid');
    const mk = (repeatM: number): MapDefinition => ({
      ...base,
      solids: [solid],
      ramps: [],
      materials: base.materials.map((m) => (m.id === solid.material ? { ...m, repeatM } : m)),
    });
    const u1 = buildBuckets(mk(1))[0]?.uvs ?? new Float32Array(0);
    const u2 = buildBuckets(mk(2))[0]?.uvs ?? new Float32Array(0);
    expect(u1.length).toBeGreaterThan(0);
    for (let i = 0; i < u1.length; i++) expect(u2[i] ?? 0).toBeCloseTo((u1[i] ?? 0) / 2, 5);
  });

  it('builds indexed geometry with bounds for culling', () => {
    const [first] = buildBuckets(getMap('industrial-warehouse'));
    if (first === undefined) throw new Error('no bucket');
    const g = bucketGeometry(first);
    expect(g.index?.count).toBe(first.triangles * 3);
    expect(g.boundingSphere).not.toBeNull();
    g.dispose();
  });

  it('never mutates the frozen map data (BR-P-03)', () => {
    const def = getMap('desert-compound');
    expect(Object.isFrozen(def.solids[0]?.box.min)).toBe(true);
    expect(() => buildBuckets(def)).not.toThrow();
  });
});
