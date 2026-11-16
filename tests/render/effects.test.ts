import { describe, expect, it } from 'vitest';
import { Color, Matrix4, Vector3 } from 'three';
import { createDiagnostics, TICK_DT } from '../../src/core';
import { capWorldSize, hFovToVFov, projectedPx } from '../../src/render/camera-math';
import { DECAL_LIFE_SEC, FLASH_CAP_PX_1080 } from '../../src/render/constants';
import { DecalPool, ParticlePool, TracerPool } from '../../src/render/effects';
import { makeTexture, paintDot } from '../../src/render/textures';

function diag(): { d: ReturnType<typeof createDiagnostics>; seen: string[] } {
  const seen: string[] = [];
  return { d: createDiagnostics((c) => seen.push(c)), seen };
}

const tex = makeTexture(paintDot(8), 8, { repeat: false, anisotropy: 1 });
const cam = new Vector3(0, 1.6, 5);

describe('tracer pool', () => {
  it('draws a fading camera-facing quad for 4 ticks, then hides it', () => {
    const { d } = diag();
    const pool = new TracerPool(d);
    pool.setCap(16);
    pool.add(0, 1.6, -2, 0, 1.6, -20, 10 * TICK_DT);
    pool.update(10 * TICK_DT, cam);
    expect(pool.live(10 * TICK_DT)).toBe(1);
    const m = new Matrix4();
    pool.mesh.getMatrixAt(0, m);
    expect(m.determinant()).not.toBe(0);
    const c0 = new Color();
    pool.mesh.getColorAt(0, c0);
    pool.update(12 * TICK_DT, cam);
    const c1 = new Color();
    pool.mesh.getColorAt(0, c1);
    expect(c1.r).toBeLessThan(c0.r);
    pool.update(14 * TICK_DT, cam);
    pool.mesh.getMatrixAt(0, m);
    expect(m.determinant()).toBe(0);
    expect(pool.live(14 * TICK_DT)).toBe(0);
  });

  it('recycles the oldest slot at the cap without allocating new objects', () => {
    const { d } = diag();
    const pool = new TracerPool(d);
    pool.setCap(16);
    const mesh = pool.mesh;
    const matrixArray = mesh.instanceMatrix.array;
    pool.update(0, cam);
    for (let i = 0; i < 40; i++) pool.add(0, 1, i, 0, 1, i - 10, 0);
    pool.update(0, cam);
    expect(pool.live(0)).toBe(16);
    expect(pool.mesh).toBe(mesh);
    expect(pool.mesh.instanceMatrix.array).toBe(matrixArray);
    expect(d.snapshot()['render/pool-recycled']).toBe(24);
    expect(mesh.count).toBe(16);
  });
});

describe('decal pool', () => {
  it('places a decal on the surface and fades it over the last second of 10 s', () => {
    const { d } = diag();
    const pool = new DecalPool(tex, d);
    pool.setCap(32);
    pool.add(1, 2, 3, 0, 0, 1, 0, 0.25);
    pool.update(0);
    const m = new Matrix4();
    pool.mesh.getMatrixAt(0, m);
    const p = new Vector3().setFromMatrixPosition(m);
    expect(p.z).toBeCloseTo(3.01);
    expect(pool.alphaAt(0)).toBe(1);
    pool.update(DECAL_LIFE_SEC - 0.5);
    expect(pool.alphaAt(0)).toBeCloseTo(0.5);
    pool.update(DECAL_LIFE_SEC + 0.1);
    expect(pool.alphaAt(0)).toBe(0);
    expect(pool.live(DECAL_LIFE_SEC + 0.1)).toBe(0);
  });
});

describe('particle pool', () => {
  it('emits perBurst particles that fall under gravity and fade over 0.35 s', () => {
    const { d } = diag();
    const pool = new ParticlePool(tex, d);
    pool.setCap(64, 6);
    pool.burst(0, 1, 0, 0, 1, 0, 0, 5, 0, 4, new Color(1, 0.5, 0));
    pool.update(0.01);
    expect(pool.live(0.01)).toBe(6);
    pool.update(0.3);
    const col = pool.points.geometry.getAttribute('color');
    expect(col.getW(0)).toBeGreaterThan(0);
    expect(col.getW(0)).toBeLessThan(0.3);
    pool.update(0.4);
    expect(pool.live(0.4)).toBe(0);
    expect(col.getW(0)).toBe(0);
  });

  it('is deterministic per (tick, event index)', () => {
    const { d } = diag();
    const a = new ParticlePool(tex, d);
    const b = new ParticlePool(tex, d);
    for (const p of [a, b]) {
      p.setCap(64, 8);
      p.burst(0, 1, 0, 0, 0, 1, 0, 42, 3, 4, new Color(1, 1, 1));
      p.update(0.1);
    }
    expect(Array.from(a.points.geometry.getAttribute('position').array)).toEqual(
      Array.from(b.points.geometry.getAttribute('position').array),
    );
  });
});

describe('muzzle flash cap (BR-P-45, SEC-P-12)', () => {
  for (const h of [1080, 1440]) {
    it(`never exceeds 160 × H/1080 px at ${String(h)} px`, () => {
      const cap = (FLASH_CAP_PX_1080 * h) / 1080;
      const v = hFovToVFov(90);
      for (const d of [0.5, 2, 10]) {
        const size = Math.min(0.35, capWorldSize(cap, d, v, h));
        expect(projectedPx(size, d, v, h)).toBeLessThanOrEqual(cap + 1e-6);
      }
    });
  }
});
