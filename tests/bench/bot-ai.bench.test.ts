/**
 * bot-ai bench (H-14, NFR-AI-Q1 = A, CI-AI-02). Per-section timings for 1, 5,
 * 10 and 20 bots on both maps go to reports/bot-ai-bench.json. Only the 10x
 * ceilings are asserted (AI total 20 ms, sense + decide 12 ms, locomotion +
 * nav 8 ms mean per frame), plus the per-call work caps and a heap delta under
 * 1 MB over 3,600 ticks at 20 bots. The 2 ms target is reported, not gated:
 * this 2 vCPU runtime under coverage is not target hardware.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapId } from '../../src/contracts';
import { COVER_MAX_LOS, RETREAT_PROBES } from '../../src/ai/brain';
import { MAX_SENSE_RAYS } from '../../src/ai/perception';
import { createHarness, prepareMap, type HarnessOptions } from '../ai/harness';
import { v } from '../ai/fixtures';

const MAPS: readonly MapId[] = ['desert-compound', 'industrial-warehouse'];
const COUNTS = [1, 5, 10, 20] as const;
const TICKS = 60 * 30;
const HEAP_LIMIT = 1024 * 1024;
const report: Record<string, unknown> = {
  ticksPerRun: TICKS,
  runtime: 'Node, 2 vCPU arm64, inside vitest (coverage when run by verify)',
};

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run Vitest with --expose-gc (see vitest.config.ts)');
  collect();
}

const ROUTES: Record<MapId, HarnessOptions['player']> = {
  'desert-compound': {
    kind: 'route',
    points: [v(-28.8, 0, 0), v(0, 0, 0), v(28.8, 0, 0)],
    speed: 3,
    fireEvery: 12,
  },
  'industrial-warehouse': {
    kind: 'route',
    points: [v(-30, 0, -20), v(0, 0, -20), v(30, 0, -20)],
    speed: 3,
    fireEvery: 12,
  },
};

describe('bot-ai bench (H-14)', () => {
  it.each(MAPS)(
    '%s: timings within 10x ceilings and work caps hold',
    (map) => {
      const prepared = prepareMap(map);
      const rows: Record<string, unknown> = {};
      for (const bots of COUNTS) {
        const h = createHarness({
          map,
          prepared,
          bots,
          difficulty: 'hard',
          seed: 31,
          player: ROUTES[map],
          playerHealth: 1e9,
          counting: true,
          lean: true,
        });
        h.step(TICKS);
        const s = h.profiler.report().sections;
        const senseDecide = s['ai-sense'].meanMsPerFrame + s['ai-decide'].meanMsPerFrame;
        const locoNav = s.locomotion.meanMsPerFrame + s.nav.meanMsPerFrame;
        const total = senseDecide + locoNav;
        const worst = Math.max(
          s['ai-sense'].maxMsPerFrame +
            s['ai-decide'].maxMsPerFrame +
            s.locomotion.maxMsPerFrame +
            s.nav.maxMsPerFrame,
        );
        rows[`${bots}`] = {
          meanMs: {
            total,
            senseDecide,
            locoNav,
            sense: s['ai-sense'].meanMsPerFrame,
            decide: s['ai-decide'].meanMsPerFrame,
            nav: s.nav.meanMsPerFrame,
            locomotion: s.locomotion.meanMsPerFrame,
          },
          maxMs: {
            sense: s['ai-sense'].maxMsPerFrame,
            decide: s['ai-decide'].maxMsPerFrame,
            nav: s.nav.maxMsPerFrame,
            locomotion: s.locomotion.maxMsPerFrame,
            sumOfMaxima: worst,
          },
          target2ms: total <= 2 ? 'pass' : 'miss',
          caps: {
            maxLosPerSense: h.metrics.maxLosPerSense,
            maxLosPerDecide: h.metrics.maxLosPerDecide,
            maxSensesPerTick: h.metrics.maxSensesPerTick,
            maxDecidesPerTick: h.metrics.maxDecidesPerTick,
            pathRequests: h.counts.requests,
            pathsServed: h.paths.stats.solved + h.paths.stats.cacheHits,
          },
          diagnostics: h.diag.snapshot(),
        };
        expect(total).toBeLessThan(20);
        expect(senseDecide).toBeLessThan(12);
        expect(locoNav).toBeLessThan(8);
        expect(h.metrics.maxLosPerSense).toBeLessThanOrEqual(MAX_SENSE_RAYS);
        expect(h.metrics.maxLosPerDecide).toBeLessThanOrEqual(COVER_MAX_LOS + RETREAT_PROBES);
        expect(h.metrics.maxSensesPerTick).toBeLessThanOrEqual(bots);
        if (bots === 20) expect(h.metrics.maxDecidesPerTick).toBeLessThanOrEqual(20);
      }
      report[map] = rows;
    },
    180_000,
  );

  it('heap delta stays under 1 MB over 3,600 ticks at 20 bots', () => {
    const h = createHarness({
      map: 'desert-compound',
      bots: 20,
      difficulty: 'normal',
      seed: 8,
      player: ROUTES['desert-compound'],
      playerHealth: 1e9,
      lean: true,
    });
    h.step(600); // warm up: paths cached, every bot has state
    gc();
    const before = process.memoryUsage().heapUsed;
    h.step(3600);
    gc();
    const delta = process.memoryUsage().heapUsed - before;
    report.heapDeltaBytes20Bots3600Ticks = delta;
    mkdirSync('reports', { recursive: true });
    writeFileSync('reports/bot-ai-bench.json', `${JSON.stringify(report, null, 2)}\n`);
    expect(delta).toBeLessThan(HEAP_LIMIT);
  }, 180_000);
});
