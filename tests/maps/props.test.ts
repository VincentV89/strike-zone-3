/**
 * Prop collision data (BR-G-20..27, BR-G-86): colliders come from the generated catalog,
 * quarter turns and scale transform them like the visual, the catalog matches the pack
 * GLBs, and vegetation stays visual and low in the play space.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getMap, mapIds } from '../../src/maps';
import { PROP_CATALOG, placeBox, propSolids } from '../../src/maps/props';

function glbNodes(file: string): Set<string> {
  const b = readFileSync(file);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const len = dv.getUint32(12, true);
  const json = JSON.parse(b.subarray(20, 20 + len).toString()) as { nodes: { name?: string }[] };
  return new Set(json.nodes.map((n) => n.name ?? ''));
}

describe('prop catalog (BR-G-86)', () => {
  it('every entry resolves to a pack node with its LOD children', () => {
    for (const c of PROP_CATALOG.values()) {
      const nodes = glbNodes(`assets/models/${c.asset}.glb`);
      expect(c.node).toBe(c.id);
      expect(nodes.has(c.id), c.id).toBe(true);
      expect(nodes.has(`${c.id}_LOD0`), c.id).toBe(true);
      if (c.lods === 2) expect(nodes.has(`${c.id}_LOD1`), c.id).toBe(true);
      expect(c.colliders.length === 0).toBe(c.kind === 'visual');
    }
  });

  it('colliders sit inside the visual within the BR-G-22 tolerance', () => {
    for (const c of PROP_CATALOG.values()) {
      const tol = c.kind === 'rock' ? 0.25 : 0.1;
      for (const col of c.colliders) {
        for (let i = 0; i < 3; i++) {
          expect((col.min[i] ?? 0) - (c.visualBounds.min[i] ?? 0)).toBeGreaterThanOrEqual(-1e-6);
          expect((c.visualBounds.max[i] ?? 0) - (col.max[i] ?? 0)).toBeGreaterThanOrEqual(-1e-6);
          expect((col.min[i] ?? 0) - (c.visualBounds.min[i] ?? 0)).toBeLessThanOrEqual(tol);
          if (i !== 1)
            expect((c.visualBounds.max[i] ?? 0) - (col.max[i] ?? 0)).toBeLessThanOrEqual(tol);
        }
      }
    }
  });
});

describe('placement transform (BR-G-21)', () => {
  const box = { min: [-1, 0, -0.5], max: [1, 2, 0.5] };
  it.each([
    [0, [-1, -0.5, 1, 0.5]],
    [1, [-0.5, -1, 0.5, 1]],
    [2, [-1, -0.5, 1, 0.5]],
    [3, [-0.5, -1, 0.5, 1]],
  ] as const)('quarter turn %i swaps the footprint axes', (q, [x0, z0, x1, z1]) => {
    const b = placeBox(box, ['boulder-a', 10, 0, 20, q, 2]);
    expect(b.min.x).toBeCloseTo(10 + x0 * 2);
    expect(b.min.z).toBeCloseTo(20 + z0 * 2);
    expect(b.max.x).toBeCloseTo(10 + x1 * 2);
    expect(b.max.z).toBeCloseTo(20 + z1 * 2);
    expect(b.max.y).toBeCloseTo(4);
  });

  it('visual props make no solid and unknown models throw maps/prop-unknown-model', () => {
    expect(propSolids([['grass-dry', 0, 0, 0, 0, 1]], () => 'x')).toEqual([]);
    expect(() => propSolids([['nope', 0, 0, 0, 0, 1]], () => 'x')).toThrow(/unknown prop/);
  });
});

describe('shipped dressing', () => {
  it.each(mapIds().map((id) => [id]))(
    '%s has blocking props as solids, all five dressing classes and budgets',
    (id) => {
      const def = getMap(id);
      const d = def.dressing;
      expect(d).toBeDefined();
      if (d === undefined) return;
      const blocking = d.props.filter((p) => PROP_CATALOG.get(p[0])?.kind !== 'visual');
      const propSolidCount = def.solids.filter((s) => s.prop !== undefined).length;
      expect(propSolidCount).toBe(blocking.length);
      expect(def.solids.length).toBeLessThanOrEqual(400);
      expect(d.props.some((p) => PROP_CATALOG.get(p[0])?.kind === 'visual')).toBe(true);
      expect(d.scatter.length).toBeGreaterThan(0);
      expect(d.backdrop.length).toBeGreaterThan(0);
      expect(def.materials.some((m) => m.pbr !== undefined)).toBe(true);
      expect(def.lighting.atmosphere).toBeDefined();
      for (const s of def.solids.filter((x) => x.prop !== undefined)) {
        expect(['rock', 'debris', 'vehicle', 'structure']).toContain(s.kind);
      }
    },
  );
});
