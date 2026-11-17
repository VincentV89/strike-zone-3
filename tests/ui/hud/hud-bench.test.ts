/**
 * hud bench (PD-H-08, TS-H-07). Timings go to reports/hud-bench.json and are
 * never asserted: this runtime is not target hardware (req-honest-verification).
 * The allocation probe is asserted (PR-H-11).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../src/contracts';
import { createHud, createHudViewModel, toHudViewModel } from '../../../src/ui/hud';
import {
  contact,
  damageToPlayer,
  kill,
  makeSnapshot,
  makeStats,
  playerHit,
  strictDiagnostics,
} from './fixtures';

const HEAP_LIMIT_BYTES = 1024 * 1024;

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run Vitest with --expose-gc (see vitest.config.ts)');
  collect();
}

describe('hud model path at 20 bots', () => {
  const snap = makeSnapshot({
    bots: 20,
    botsAlive: 14,
    radar: Array.from({ length: 20 }, (_, i) =>
      contact(i + 1, i - 10, -5 - i, i % 2 ? 'heard' : 'seen', i),
    ),
  });
  const stats = makeStats({ kills: 6, shotsFired: 40, shotsHit: 22 });
  const ctx = { round: 1 };
  const hud = createHud({ diagnostics: strictDiagnostics(), reducedMotion: false });
  const scratch = createHudViewModel();
  const none: readonly SimEvent[] = [];
  let sink = 0;

  const step = (n: number): void => {
    for (let i = 0; i < n; i++) {
      hud.feed(none);
      sink += toHudViewModel(snap, stats, ctx, scratch).radarCount;
    }
  };

  it('allocates less than 1 MB over 100 000 steady-state iterations (PR-H-11)', () => {
    step(1000); // warm up
    gc();
    const before = process.memoryUsage().heapUsed;
    step(100_000);
    gc();
    const delta = process.memoryUsage().heapUsed - before;
    expect(delta).toBeLessThan(HEAP_LIMIT_BYTES);
    expect(sink).toBeGreaterThan(0);
  });

  it('reports timings for the model path and a 4 096-event feed burst', () => {
    const iterations = 20_000;
    const t0 = performance.now();
    step(iterations);
    const modelUs = ((performance.now() - t0) * 1000) / iterations;

    const burst: SimEvent[] = [];
    for (let i = 0; i < 4096; i++) {
      const k = i % 8;
      if (k === 0) burst.push(damageToPlayer(i, (i % 20) + 1, 1, 0.5));
      else if (k === 1) burst.push(playerHit(i, (i % 20) + 1, i % 3 === 0));
      else if (k === 2) burst.push(kill(i, 0, (i % 20) + 1));
      else burst.push({ t: 'phase', tick: i, phase: 'live', outcome: null });
    }
    const runs = 50;
    const t1 = performance.now();
    for (let r = 0; r < runs; r++) hud.feed(burst);
    const burstMs = (performance.now() - t1) / runs;

    mkdirSync('reports', { recursive: true });
    writeFileSync(
      'reports/hud-bench.json',
      `${JSON.stringify(
        {
          note: 'Node on the CI runtime, not target hardware; reported, not asserted',
          modelPathMeanUs: Number(modelUs.toFixed(3)),
          feedBurst4096MeanMs: Number(burstMs.toFixed(3)),
        },
        null,
        2,
      )}\n`,
    );
    expect(Number.isFinite(modelUs)).toBe(true);
    expect(Number.isFinite(burstMs)).toBe(true);
  });
});
