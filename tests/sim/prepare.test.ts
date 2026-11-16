/** Map preparation and the PreparedMap cache (BR-GS-10..14, SD-GS-06). */
import { performance } from 'node:perf_hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrikeZoneError, createDiagnostics } from '../../src/core';
import { getMap } from '../../src/maps';
import { bakeNavGraph } from '../../src/nav';
import { buildCollisionWorld } from '../../src/physics';
import { prepareMap, prepareMapAsync, type PrepareOptions, type PrepareStep } from '../../src/sim';
import { __resetPreparedMapCache, prepareDefinition } from '../../src/sim/prepare';
import * as validate from '../../src/sim/validate';

const failNext = vi.hoisted(() => ({ on: false }));
vi.mock('../../src/sim/validate', async (importOriginal) => {
  const real = await importOriginal<typeof validate>();
  return {
    ...real,
    validateMap: (...a: Parameters<typeof real.validateMap>) => {
      const r = real.validateMap(...a);
      if (!failNext.on) return r;
      return Object.freeze({
        ok: false,
        issues: [
          { code: 'sim/spawn-budget', list: 'spawns', index: 0, detail: 'forced' },
          { code: 'sim/spawn-budget', list: 'spawns', index: 1, detail: 'forced' },
        ],
        spawnBudget: r.spawnBudget,
      });
    },
  };
});

function opts(over: Partial<PrepareOptions> = {}): PrepareOptions & {
  progress: [PrepareStep, number][];
  yields: number;
} {
  const progress: [PrepareStep, number][] = [];
  const o = {
    signal: new AbortController().signal,
    onProgress: (s: PrepareStep, f: number) => progress.push([s, f]),
    yieldFn: () => {
      o.yields++;
      return Promise.resolve();
    },
    now: () => performance.now(),
    sliceMs: 1,
    progress,
    yields: 0,
    ...over,
  };
  return o;
}

beforeEach(() => {
  __resetPreparedMapCache();
  failNext.on = false;
});

describe('prepareMapAsync', () => {
  it('runs geometry, a sliced nav bake with yields, then validation, with monotonic progress', async () => {
    const o = opts();
    const r = await prepareMapAsync('industrial-warehouse', o);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.validation.ok).toBe(true);
    expect(o.yields).toBeGreaterThan(1);
    expect(o.progress[0]).toEqual(['map-geometry', 1]);
    const nav = o.progress.filter(([s]) => s === 'nav-data').map(([, f]) => f);
    for (let i = 1; i < nav.length; i++) expect(nav[i]).toBeGreaterThanOrEqual(nav[i - 1] ?? 0);
    expect(nav.slice(0, -1).every((f) => f < 1)).toBe(true);
    expect(nav[nav.length - 1]).toBe(1);
    expect(Object.isFrozen(r.value)).toBe(true);
  });

  it('gives the same graph as the synchronous bake whatever the clock (bake is budget-free)', async () => {
    const frozenClock = await prepareMapAsync('industrial-warehouse', opts({ now: () => 0 }));
    __resetPreparedMapCache();
    const fast = opts({
      now: (() => {
        let t = 0;
        return () => (t += 5);
      })(),
    });
    const sliced = await prepareMapAsync('industrial-warehouse', fast);
    const def = getMap('industrial-warehouse');
    const ref = bakeNavGraph(def, buildCollisionWorld(def), { agent: validate.STANDING });
    for (const r of [frozenClock, sliced]) {
      if (!r.ok) throw new Error('prepare failed');
      expect(r.value.nav.nodes.length).toBe(ref.nodes.length);
      expect(r.value.nav.edgeCount).toBe(ref.edgeCount);
      expect(r.value.nav.nodes.map((n) => n.pos)).toEqual(ref.nodes.map((n) => n.pos));
    }
    expect(fast.yields).toBeGreaterThan(10);
  });

  it('caches per map: later calls and prepareMap return the same object', async () => {
    const a = await prepareMapAsync('desert-compound', opts());
    const o = opts();
    const b = await prepareMapAsync('desert-compound', o);
    if (!a.ok || !b.ok) throw new Error('prepare failed');
    expect(b.value).toBe(a.value);
    expect(o.yields).toBe(0);
    expect(o.progress).toEqual([
      ['map-geometry', 1],
      ['nav-data', 1],
    ]);
    expect(prepareMap('desert-compound')).toBe(a.value);
  });

  it('returns ABORTED before work, and mid-bake keeps geometry and re-bakes to the same graph', async () => {
    const ctl = new AbortController();
    ctl.abort();
    expect(await prepareMapAsync('desert-compound', opts({ signal: ctl.signal }))).toEqual({
      ok: false,
      error: 'ABORTED',
    });
    const mid = new AbortController();
    let n = 0;
    const o = opts({
      signal: mid.signal,
      yieldFn: () => {
        if (++n === 3) mid.abort();
        return Promise.resolve();
      },
    });
    expect(await prepareMapAsync('desert-compound', o)).toEqual({ ok: false, error: 'ABORTED' });
    const again = await prepareMapAsync('desert-compound', opts());
    if (!again.ok) throw new Error('prepare failed');
    __resetPreparedMapCache();
    expect(again.value.nav.edgeCount).toBe(prepareMap('desert-compound').nav.edgeCount);
  });

  it('returns ABORTED when the signal fires between geometry and the bake', async () => {
    const ctl = new AbortController();
    const o = opts({
      signal: ctl.signal,
      onProgress: (s) => {
        if (s === 'map-geometry') ctl.abort();
      },
    });
    expect(await prepareMapAsync('desert-compound', o)).toEqual({ ok: false, error: 'ABORTED' });
  });

  it('INVALID_MAP: not cached, each code reported once, prepareMap throws sim/invalid-map', async () => {
    failNext.on = true;
    const seen: string[] = [];
    const diag = createDiagnostics((c) => seen.push(c));
    expect(await prepareMapAsync('desert-compound', opts({ diag }))).toEqual({
      ok: false,
      error: 'INVALID_MAP',
    });
    expect(seen).toEqual(['sim/spawn-budget']);
    expect(diag.snapshot()['sim/spawn-budget']).toBe(2);
    expect(() => prepareMap('desert-compound')).toThrow(StrikeZoneError);
    try {
      prepareMap('desert-compound');
    } catch (e) {
      expect((e as StrikeZoneError).code).toBe('sim/invalid-map');
    }
    failNext.on = false;
    const ok = await prepareMapAsync('desert-compound', opts({ sliceMs: 50 }));
    expect(ok.ok).toBe(true);
  });

  it('rejects unknown map ids through getMap', async () => {
    await expect(prepareMapAsync('__proto__' as never, opts())).rejects.toThrow(StrikeZoneError);
  });
});

describe('prepareDefinition', () => {
  it('prepares a fixture definition without caching it', () => {
    const p = prepareDefinition(getMap('industrial-warehouse'));
    expect(p.validation.ok).toBe(true);
    expect(prepareDefinition(getMap('industrial-warehouse'))).not.toBe(p);
  });
});
