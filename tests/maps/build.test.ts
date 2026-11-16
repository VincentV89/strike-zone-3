/** Authoring helpers (business-logic-model-map-data, test plan: build.test.ts). */
import { describe, expect, it } from 'vitest';
import { dirFromYawPitch, StrikeZoneError, vec3 } from '../../src/core';
import {
  block,
  box,
  container,
  COVER_OFFSET,
  coverAt,
  crate,
  ramp,
  rampMid,
  spawnGrid,
  unit,
  wallAlongX,
  wallAlongZ,
  yawToward,
} from '../../src/maps/build';
import { rampSurfaceY } from '../../src/maps/geometry';

describe('box and block', () => {
  it('builds boxes from corners and from a centre and size', () => {
    expect(box('crate', [0, 0, 0], [1, 2, 3], 'wood').box).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 2, z: 3 },
    });
    expect(block('barrier', 10, -4, [3, 1.3, 0.6], 2, 'c').box).toEqual({
      min: { x: 8.5, y: 2, z: -4.3 },
      max: { x: 11.5, y: 3.3, z: -3.7 },
    });
  });

  it('throws core/aabb-inverted for an inverted box (BR-M-05)', () => {
    expect(() => box('wall', [1, 0, 0], [0, 1, 1], 'x')).toThrow(StrikeZoneError);
  });
});

describe('walls with doorways', () => {
  it('leaves the stated gap and adds a lintel above it', () => {
    const parts = wallAlongX(-10, 10, 5, 0.5, 4, 'w', [{ at: 2, width: 2, height: 2.5 }]);
    expect(parts.map((p) => [p.box.min.x, p.box.max.x, p.box.min.y, p.box.max.y])).toEqual([
      [-10, 1, 0, 4],
      [3, 10, 0, 4],
      [1, 3, 2.5, 4],
    ]);
    for (const p of parts) {
      expect(p.box.min.z).toBeCloseTo(4.75);
      expect(p.box.max.z).toBeCloseTo(5.25);
    }
  });

  it('adds no lintel for a full-height gate and handles several doors in any order', () => {
    const parts = wallAlongZ(0, 20, -3, 0.6, 3, 'w', [
      { at: 15, width: 2, height: 3 },
      { at: 5, width: 2, height: 2 },
    ]);
    expect(parts.map((p) => [p.box.min.z, p.box.max.z, p.box.min.y])).toEqual([
      [0, 4, 0],
      [6, 14, 0],
      [16, 20, 0],
      [4, 6, 2],
    ]);
  });

  it('rejects a doorway that does not fit its wall', () => {
    expect(() => wallAlongX(0, 4, 0, 0.5, 3, 'w', [{ at: 3.5, width: 2, height: 2 }])).toThrow(
      StrikeZoneError,
    );
  });
});

describe('props', () => {
  it('builds 1.25 m crates', () => {
    const c = crate(0, 0, 1.25, 'wood').box;
    expect(c.max.x - c.min.x).toBeCloseTo(1.25);
    expect(c.min.y).toBe(1.25);
    expect(c.max.y).toBe(2.5);
  });

  it('builds ISO containers along either axis, level 1 on top of level 0', () => {
    const a = container(0, 0, 'x', 12.19, 0, 'red').box;
    const b = container(0, 0, 'z', 6.06, 1, 'red').box;
    expect(a.max.x - a.min.x).toBeCloseTo(12.19);
    expect(a.max.z - a.min.z).toBeCloseTo(2.44);
    expect(a.max.y).toBeCloseTo(2.59);
    expect(b.max.z - b.min.z).toBeCloseTo(6.06);
    expect(b.min.y).toBeCloseTo(2.59);
  });
});

describe('ramps', () => {
  it.each([
    ['+x', { minX: 0, maxX: 8, minZ: -1, maxZ: 1 }],
    ['-x', { minX: -8, maxX: 0, minZ: -1, maxZ: 1 }],
    ['+z', { minX: -1, maxX: 1, minZ: 0, maxZ: 8 }],
    ['-z', { minX: -1, maxX: 1, minZ: -8, maxZ: 0 }],
  ] as const)('places a %s ramp from its low-edge midpoint', (up, rect) => {
    const r = ramp([0, 0, 0], up, 8, 2, 4, 'm');
    expect(r).toMatchObject({ ...rect, baseY: 0, topY: 4, up });
    expect(rampMid(r)).toEqual({
      x: (rect.minX + rect.maxX) / 2,
      y: 2,
      z: (rect.minZ + rect.maxZ) / 2,
    });
  });

  it('interpolates the surface height along the up direction', () => {
    const r = ramp([0, 1, 0], '-z', 10, 2, 5, 'm');
    expect(rampSurfaceY(r, 0, 0)).toBeCloseTo(1);
    expect(rampSurfaceY(r, 0, -10)).toBeCloseTo(6);
    expect(rampSurfaceY(r, 0, -4)).toBeCloseTo(3);
    expect(rampSurfaceY(r, 5, -4)).toBeNull();
  });
});

describe('spawns and cover', () => {
  it('lays out a spawn grid with player slots and an optional count', () => {
    const grid = spawnGrid('z', vec3(1, 0, 2), 4, 2, 2.5, 0.5, [1, 6], 7);
    expect(grid).toHaveLength(7);
    expect(grid[5]?.pos).toEqual({ x: 3.5, y: 0, z: 4.5 });
    expect(grid.filter((s) => s.player).map((s) => s.pos.x)).toEqual([3.5, 6]);
    expect(grid.every((s) => s.zone === 'z' && s.yaw === 0.5)).toBe(true);
  });

  it('puts a cover point 0.6 m off the chosen face, facing the solid', () => {
    const solids = [box('crate', [0, 0, 0], [2, 1.3, 4], 'w')];
    expect(coverAt(solids, 0, '+x', 'low')).toEqual({
      pos: { x: 2 + COVER_OFFSET, y: 0, z: 2 },
      facing: { x: -1, y: 0, z: 0 },
      height: 'low',
      solid: 0,
    });
    expect(coverAt(solids, 0, '-z', 'high', 0.5).pos).toEqual({ x: 0.5, y: 0, z: -COVER_OFFSET });
    expect(coverAt(solids, 0, '-x', 'low').facing).toEqual({ x: 1, y: 0, z: 0 });
    expect(coverAt(solids, 0, '+z', 'low').facing).toEqual({ x: 0, y: 0, z: -1 });
    expect(() => coverAt(solids, 3, '+x', 'low')).toThrow(StrikeZoneError);
  });
});

describe('directions', () => {
  it('normalises vectors', () => {
    const u = unit(3, -4, 0);
    expect(u.x).toBeCloseTo(0.6);
    expect(u.y).toBeCloseTo(-0.8);
  });

  it('yawToward agrees with core dirFromYawPitch', () => {
    const from = { x: 10, z: 10 };
    const to = { x: 0, z: 0 };
    const d = dirFromYawPitch(yawToward(from, to), 0);
    expect(d.x).toBeCloseTo(-Math.SQRT1_2);
    expect(d.z).toBeCloseTo(-Math.SQRT1_2);
  });
});
