/**
 * GameRenderer asset path (business-logic-model §2.1, §5, §7, §8; BR-G-02/08/12/14/16/73):
 * the init gate, apply with zero fallbacks, kit failure, per-asset fallback, rebuild reuse,
 * preset re-tier without fetches, context restore, and the per-preset world ceilings.
 */
import { describe, expect, it } from 'vitest';
import type { Diagnostics } from '../../../src/core';
import { getMap } from '../../../src/maps';
import { PRESETS } from '../../../src/render/presets';
import { createHarness, FAKE_CANVAS, snapshot, type Harness } from '../fixtures';
import { fakePort, type FakePort } from './node-kit';

interface Rig extends Harness {
  port: FakePort;
}

function rig(setup: (p: FakePort) => void = () => undefined): Rig {
  const box: { port?: FakePort } = {};
  const h = createHarness({
    assets: (d: Diagnostics) => {
      const port = fakePort(d);
      setup(port);
      box.port = port;
      return port;
    },
  });
  if (box.port === undefined) throw new Error('no port');
  return { ...h, port: box.port };
}

const live = (): AbortSignal => new AbortController().signal;

async function build(
  r: Rig,
  map: 'desert-compound' | 'industrial-warehouse',
  bots: number,
  preset: 'low' | 'medium' | 'high' = 'medium',
) {
  r.renderer.init(FAKE_CANVAS);
  r.renderer.setPreset(preset);
  r.renderer.resize(1920, 1080);
  const report = await r.renderer.loadAssets(map, live(), () => undefined);
  await r.renderer.buildMap(getMap(map));
  r.renderer.applyAssets();
  r.renderer.spawnActors(bots);
  await r.renderer.precompile();
  return report;
}

function frame(r: Rig, tick: number, bots: number): void {
  const s = snapshot(tick, bots);
  r.renderer.render(s, s, 1, []);
}

describe('renderer asset path', () => {
  it('makes no kit request and no fetch before init or after NO_WEBGL2 (BR-G-02)', async () => {
    const r = rig();
    const before = await r.renderer.loadAssets('desert-compound', live(), () => undefined);
    expect(before.requested).toBe(0);
    expect(r.port.kitLoads).toBe(0);
    let port: FakePort | null = null;
    const h = createHarness({
      noWebgl: true,
      assets: (d) => {
        port = fakePort(d);
        return port;
      },
    });
    expect(h.renderer.init(FAKE_CANVAS).ok).toBe(false);
    await h.renderer.loadAssets('desert-compound', live(), () => undefined);
    expect((port as FakePort | null)?.kitLoads).toBe(0);
  });

  it('loads every map entry, applies with zero fallbacks and reaches the authored look', async () => {
    const r = rig();
    const progress: number[] = [];
    r.renderer.init(FAKE_CANVAS);
    const report = await r.renderer.loadAssets('desert-compound', live(), (p) => progress.push(p));
    expect(report.failed).toEqual([]);
    expect(report.loaded).toBe(report.requested);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((p, i) => i === 0 || p >= (progress[i - 1] ?? 0))).toBe(true);
    expect(r.port.fetches.some((u) => u.includes('warehouse-storm'))).toBe(false); // other map not fetched
    expect(r.host.calls).toContain('bindKit');
    await r.renderer.buildMap(getMap('desert-compound'));
    r.renderer.applyAssets();
    r.renderer.spawnActors(5);
    await r.renderer.precompile();
    frame(r, 10, 5);
    const s = r.renderer.stats();
    expect(s.assetFallbacks).toBe(0);
    expect(s.envActive).toBe(true);
    expect(s.skinnedBots).toBe(5);
    expect(s.dressingInstances).toBeGreaterThan(0);
    expect(s.shadowOnlyCalls).toBe(9); // the 9-part rig as shadow proxy (performance-design §3.3)
    expect(s.textureFormats.length).toBeGreaterThan(0);
    expect(r.host.exposure).toBeCloseTo(
      getMap('desert-compound').lighting.atmosphere?.exposure ?? 0,
    );
    expect(r.sink.filter((x) => x.code.startsWith('render/asset'))).toEqual([]);
  });

  it('rebuilds (Play Again) and preset changes make zero fetches (BR-G-08/16)', async () => {
    const r = rig();
    await build(r, 'desert-compound', 5);
    const fetched = r.port.fetches.length;
    const before = r.renderer.stats();
    const geoms = before.geometries;
    for (let i = 0; i < 3; i++) {
      r.renderer.disposeRound();
      await r.renderer.loadAssets('desert-compound', live(), () => undefined);
      await r.renderer.buildMap(getMap('desert-compound'));
      r.renderer.applyAssets();
      r.renderer.spawnActors(5);
      await r.renderer.precompile();
    }
    r.renderer.setPreset('low');
    frame(r, 5, 5);
    r.renderer.setPreset('high');
    frame(r, 6, 5);
    expect(r.port.fetches.length).toBe(fetched);
    expect(r.renderer.stats().geometries).toBe(geoms);
    expect(r.port.kitLoads).toBe(1);
  });

  it('a failed kit chunk falls back to the procedural renderer and the round still renders (BR-G-12)', async () => {
    const r = rig((p) => {
      p.kitFails = true;
    });
    const report = await build(r, 'industrial-warehouse', 5);
    expect(report.requested).toBe(0);
    frame(r, 3, 5);
    const s = r.renderer.stats();
    expect(s.assetFallbacks).toBe(1);
    expect(s.skinnedBots).toBe(0);
    expect(s.envActive).toBe(false);
    expect(s.shadowOnlyCalls).toBe(0);
    expect(r.sink.map((x) => x.code)).toContain('render/asset-kit-failed');
    await r.renderer.loadAssets('industrial-warehouse', live(), () => undefined);
    expect(r.port.fetches).toEqual([]);
  });

  it('per-asset failures fall back per class: bot rig, box viewmodel, flat sky (BR-G-14)', async () => {
    const r = rig((p) => {
      p.failing = ['/bot-soldier.glb', '/vm-rifle.glb', '/sky-desert-dusk.ktx2'];
    });
    const report = await build(r, 'desert-compound', 4);
    expect([...report.failed].sort()).toEqual(['bot-soldier', 'sky-desert-dusk', 'vm-rifle']);
    frame(r, 4, 4);
    const s = r.renderer.stats();
    expect(s.assetFallbacks).toBe(3);
    expect(s.skinnedBots).toBe(0);
    expect(s.envActive).toBe(false);
    expect(s.dressingInstances).toBeGreaterThan(0);
    expect(r.sink.map((x) => x.code)).toContain('render/asset-fetch-failed');
  });

  it('an abort leaves entries absent; the next run fetches only what is missing (S6)', async () => {
    const r = rig();
    r.renderer.init(FAKE_CANVAS);
    let open = (): void => undefined;
    r.port.gate = new Promise<void>((res) => (open = res));
    const ctl = new AbortController();
    const p = r.renderer.loadAssets('desert-compound', ctl.signal, () => undefined);
    await new Promise((res) => setTimeout(res, 5));
    ctl.abort();
    open();
    const aborted = await p;
    expect(aborted.aborted).toBeGreaterThan(0);
    r.port.gate = null;
    const again = await r.renderer.loadAssets('desert-compound', live(), () => undefined);
    expect(again.failed).toEqual([]);
    expect(r.renderer.stats().assetFallbacks).toBe(0);
  });

  it('restores after a context loss with no fetch (BR-G-17)', async () => {
    const r = rig();
    await build(r, 'desert-compound', 2);
    const n = r.port.fetches.length;
    r.host.loseContext();
    r.host.restoreContext();
    await new Promise((res) => setTimeout(res, 0));
    expect(r.port.fetches.length).toBe(n);
    expect(r.renderer.stats().envActive).toBe(true);
  });

  it.each([
    ['low', 20],
    ['medium', 20],
    ['high', 20],
    ['medium', 10],
  ] as const)(
    '%s with %i bots stays within the world ceilings on both maps (BR-G-73)',
    async (preset, bots) => {
      for (const map of ['desert-compound', 'industrial-warehouse'] as const) {
        const r = rig();
        await build(r, map, bots, preset);
        frame(r, 2, bots);
        const s = r.renderer.stats();
        const p = PRESETS[preset];
        expect(s.worldDrawCalls, `${map} calls`).toBeLessThanOrEqual(p.worldDrawCallCeiling);
        expect(s.triangles, `${map} tris`).toBeLessThanOrEqual(p.triangleCeiling);
        expect(s.vmDrawCalls).toBeLessThanOrEqual(5);
        expect(s.dressingBatches).toBeLessThanOrEqual(p.dressingBatchCap);
        expect(s.dressingInstances).toBeLessThanOrEqual(p.dressingCap);
        expect(s.textureBytesEstimate).toBeLessThanOrEqual(p.textureBudgetMB * 1024 * 1024);
        expect(s.shadowCasters).toBeLessThanOrEqual(p.maxShadowCasters + 9);
      }
    },
    120_000,
  );
});
