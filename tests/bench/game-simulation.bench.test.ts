/**
 * game-simulation bench (PR-GS-01..10, CI-GS-02). Per-section timings at 1,
 * 5, 10 and 20 Hard bots on both maps go to reports/game-simulation-bench.json.
 * Targets are reported as pass or miss; only 10x ceilings are asserted, plus
 * the 15 ms 5-bot ceiling (story-twenty-bots-playable AC3) and a heap delta
 * under 1 MB over 1e4 steady 20-bot ticks. This 2 vCPU runtime (often under
 * coverage) is not target hardware.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createDiagnostics, createProfiler, type Profiler } from '../../src/core';
import type { MapId } from '../../src/contracts';
import { createSimulation, prepareMap, type Simulation } from '../../src/sim';
import { __resetPreparedMapCache } from '../../src/sim/prepare';
import { hunter } from '../sim/drivers';
import { roundCfg } from '../sim/fixtures';
import { cmd } from '../sim/helpers';

const MAPS: readonly MapId[] = ['desert-compound', 'industrial-warehouse'];
const COUNTS = [1, 5, 10, 20] as const;
const LIVE = 60 * 30;
const HEAP_LIMIT = 1024 * 1024;
const report: Record<string, unknown> = {
  liveTicksPerRow: LIVE,
  runtime: 'Node, 2 vCPU arm64, inside vitest (coverage when run by verify)',
};

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run Vitest with --expose-gc (see vitest.config.ts)');
  collect();
}

function start(
  map: MapId,
  bots: (typeof COUNTS)[number],
  seed: number,
  profiler: Profiler,
): Simulation {
  const r = createSimulation(
    roundCfg({ map, bots, seed, difficulty: 'hard', durationSec: 600 }),
    prepareMap(map),
    {
      diag: createDiagnostics(() => undefined),
      profiler,
    },
  );
  if (!r.ok) throw new Error(r.error);
  for (let i = 0; i < 210; i++) r.value.step(cmd());
  r.value.drainEvents();
  return r.value;
}

/** Forwards to `real` only while `on`, so countdown ticks never reach a measured frame. */
function gated(real: Profiler): Profiler & { on: boolean } {
  const g = {
    on: false,
    begin: (x: Parameters<Profiler['begin']>[0]) => {
      if (g.on) real.begin(x);
    },
    end: (x: Parameters<Profiler['end']>[0]) => {
      if (g.on) real.end(x);
    },
    endFrame: () => {
      if (g.on) real.endFrame();
    },
    report: () => real.report(),
    reset: () => {
      real.reset();
    },
  };
  return g;
}

const verdict = (v: number, target: number): string => (v <= target ? 'pass' : 'miss');

describe('game-simulation bench', () => {
  it('times preparation and round creation (PR-GS-07, PR-GS-09)', () => {
    const rows: Record<string, unknown> = {};
    for (const map of MAPS) {
      __resetPreparedMapCache();
      let t = performance.now();
      prepareMap(map);
      const uncached = performance.now() - t;
      t = performance.now();
      prepareMap(map);
      const cached = performance.now() - t;
      t = performance.now();
      const r = createSimulation(roundCfg({ map, bots: 20, seed: 9 }), prepareMap(map), {
        diag: createDiagnostics(() => undefined),
        profiler: createProfiler(() => 0),
      });
      const create = performance.now() - t;
      expect(r.ok).toBe(true);
      rows[map] = {
        prepareUncachedMs: uncached,
        prepareTarget1000: verdict(uncached, 1000),
        prepareCachedMs: cached,
        createSimulation20Ms: create,
        createTarget20: verdict(create, 20),
      };
      expect(uncached).toBeLessThan(10_000);
      expect(cached).toBeLessThan(10);
      expect(create).toBeLessThan(200);
    }
    report.setup = rows;
  });

  it.each(MAPS)(
    '%s: per-section means within 10x ceilings',
    (map) => {
      const rows: Record<string, unknown> = {};
      for (const bots of COUNTS) {
        const profiler = gated(createProfiler(() => performance.now()));
        let ticks = 0;
        let seed = 31;
        while (ticks < LIVE) {
          profiler.on = false;
          const sim = start(map, bots, seed++, profiler);
          profiler.on = true;
          const drive = hunter(prepareMap(map), { fire: true });
          while (ticks < LIVE && sim.snapshot().phase === 'live') {
            sim.step(drive(sim.snapshot()));
            sim.drainEvents();
            profiler.endFrame();
            ticks++;
          }
        }
        const s = profiler.report().sections;
        const ai =
          s['ai-sense'].meanMsPerFrame +
          s['ai-decide'].meanMsPerFrame +
          s.nav.meanMsPerFrame +
          s.locomotion.meanMsPerFrame;
        const other = s.sim.meanMsPerFrame - s.player.meanMsPerFrame - ai - s.combat.meanMsPerFrame;
        rows[`bots-${bots}`] = {
          simMean: s.sim.meanMsPerFrame,
          simMax: s.sim.maxMsPerFrame,
          player: s.player.meanMsPerFrame,
          aiSense: s['ai-sense'].meanMsPerFrame,
          aiDecide: s['ai-decide'].meanMsPerFrame,
          nav: s.nav.meanMsPerFrame,
          locomotion: s.locomotion.meanMsPerFrame,
          aiTotal: ai,
          combat: s.combat.meanMsPerFrame,
          snapshotAwarenessOther: other,
          ...(bots === 20
            ? {
                simTarget3: verdict(s.sim.meanMsPerFrame, 3),
                aiTarget2: verdict(ai, 2),
                worstTickTarget6: verdict(s.sim.maxMsPerFrame, 6),
                combatTarget03: verdict(s.combat.meanMsPerFrame, 0.3),
                otherTarget01: verdict(other, 0.1),
              }
            : {}),
          ...(bots === 5 ? { simTarget15: verdict(s.sim.meanMsPerFrame, 1.5) } : {}),
        };
        if (bots === 20) {
          expect(s.sim.meanMsPerFrame).toBeLessThan(30);
          expect(ai).toBeLessThan(20);
          expect(s.sim.maxMsPerFrame).toBeLessThan(60);
          expect(s.combat.meanMsPerFrame).toBeLessThan(3);
        }
        if (bots === 5) expect(s.sim.meanMsPerFrame).toBeLessThan(15); // < 16.6 ms frame (AC3)
      }
      report[map] = rows;
    },
    180_000,
  );

  it('heap delta under 1 MB over 1e4 steady 20-bot ticks (PR-GS-10)', () => {
    let measured = 0;
    let delta = 0;
    let seed = 70;
    const profiler = createProfiler(() => 0);
    while (measured < 10_000) {
      const sim = start('industrial-warehouse', 20, seed++, profiler);
      const drive = () => cmd();
      for (let i = 0; i < 120 && sim.snapshot().phase === 'live'; i++) {
        sim.step(drive());
        sim.drainEvents(); // warm-up: pools reach their high-water marks
      }
      if (sim.snapshot().phase !== 'live') continue;
      gc();
      const before = process.memoryUsage().heapUsed;
      let n = 0;
      while (measured + n < 10_000 && sim.snapshot().phase === 'live') {
        sim.step(drive());
        sim.drainEvents();
        n++;
      }
      gc();
      delta += process.memoryUsage().heapUsed - before;
      measured += n;
    }
    report.heap = { ticks: measured, deltaBytes: delta, limitBytes: HEAP_LIMIT };
    mkdirSync('reports', { recursive: true });
    writeFileSync('reports/game-simulation-bench.json', `${JSON.stringify(report, null, 2)}\n`);
    expect(delta).toBeLessThan(HEAP_LIMIT);
  }, 180_000);
});
