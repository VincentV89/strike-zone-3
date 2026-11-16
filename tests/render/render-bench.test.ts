/**
 * Renderer timing report (performance-design-presentation-3d, "Benchmarks and
 * Evidence"). Timings are written to reports/render-bench.json and labelled
 * "reported (Node, indirect)": this 2 vCPU runtime with no GPU is not target
 * hardware (req-honest-verification). Only 10x ceilings are asserted.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { botId, createDiagnostics, PLAYER_ID } from '../../src/core';
import type { MapId, SimEvent, SimSnapshot } from '../../src/contracts';
import { getMap } from '../../src/maps';
import { createGameRendererWith } from '../../src/render/game-renderer';
import { createFakeHost, FAKE_CANVAS, impact, liveHarness, shot, snapshot } from './fixtures';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const UPDATE_CEILING_MS = 3;
const BUILD_CEILING_MS = 1500;
const BURST_CEILING_MS = 20;
const FRAMES = 2000;

async function updatePathMs(bots: number): Promise<number> {
  const h = await liveHarness('desert-compound', bots, { preset: 'medium' });
  h.host.recording = false;
  const prev = snapshot(0, bots) as Mutable<SimSnapshot>;
  const curr = snapshot(1, bots) as Mutable<SimSnapshot>;
  const events: Mutable<SimEvent>[] = [];
  for (let i = 0; i < 4; i++) events.push(shot(1, botId((i % bots) + 1)));
  events.push(
    impact(1),
    impact(1, -22),
    shot(1, PLAYER_ID),
    shot(1, PLAYER_ID, { weapon: 'pistol' }),
  );
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      prev.tick += 1;
      curr.tick = prev.tick + 1;
      for (const e of events) (e as { tick: number }).tick = curr.tick;
      h.renderer.render(prev, curr, 0.5, events);
    }
  };
  run(200);
  const t0 = performance.now();
  run(FRAMES);
  return (performance.now() - t0) / FRAMES;
}

async function buildMapMs(id: MapId): Promise<{ totalMs: number; stepsMs: number[] }> {
  const stamps: number[] = [];
  const host = createFakeHost();
  const r = createGameRendererWith(
    { diagnostics: createDiagnostics(() => undefined) },
    {
      hostFactory: () => host,
      yieldTask: () => {
        stamps.push(performance.now());
        return Promise.resolve();
      },
    },
  );
  r.init(FAKE_CANVAS);
  const t0 = performance.now();
  await r.buildMap(getMap(id));
  const t1 = performance.now();
  const steps: number[] = [];
  let last = t0;
  for (const s of [...stamps, t1]) {
    steps.push(s - last);
    last = s;
  }
  return { totalMs: t1 - t0, stepsMs: steps };
}

async function burstMs(): Promise<number> {
  const h = await liveHarness('industrial-warehouse', 20, { preset: 'high' });
  h.host.recording = false;
  const events: SimEvent[] = [];
  for (let i = 0; i < 4096; i++) {
    events.push(i % 2 === 0 ? shot(11, botId((i % 20) + 1)) : impact(11, -20 - (i % 50) * 0.1));
  }
  h.renderer.render(snapshot(10, 20), snapshot(11, 20), 1, events.slice(0, 64));
  const t0 = performance.now();
  h.renderer.render(snapshot(11, 20), snapshot(12, 20), 1, events);
  return performance.now() - t0;
}

describe('renderer bench (reported, not asserted beyond 10x ceilings)', () => {
  it('writes reports/render-bench.json', async () => {
    const update: Record<string, number> = {};
    for (const n of [1, 5, 10, 20]) update[`bots${String(n)}`] = await updatePathMs(n);
    const desert = await buildMapMs('desert-compound');
    const warehouse = await buildMapMs('industrial-warehouse');
    const burst = await burstMs();
    const report = {
      label:
        'reported (Node, indirect): CPU-side render() with a fake GL host; GPU time is manual-pending',
      updatePathMsPerFrame: update,
      buildMapMs: { 'desert-compound': desert, 'industrial-warehouse': warehouse },
      burst4096EventsMs: burst,
      ceilingsMs: {
        update: UPDATE_CEILING_MS,
        buildMap: BUILD_CEILING_MS,
        burst: BURST_CEILING_MS,
      },
    };
    mkdirSync('reports', { recursive: true });
    writeFileSync('reports/render-bench.json', `${JSON.stringify(report, null, 2)}\n`);
    for (const v of Object.values(update)) expect(v).toBeLessThan(UPDATE_CEILING_MS);
    expect(desert.totalMs).toBeLessThan(BUILD_CEILING_MS);
    expect(warehouse.totalMs).toBeLessThan(BUILD_CEILING_MS);
    expect(burst).toBeLessThan(BURST_CEILING_MS);
  });
});
