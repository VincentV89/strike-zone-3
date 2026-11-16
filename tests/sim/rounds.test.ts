/**
 * Full-round runs through the real pipeline:
 * - 5 minutes of live 20-bot play per map (story-bots-patrol,
 *   story-bots-unstuck). The player's death ends a round, so consecutive
 *   seeded rounds run until 18,000 live ticks have passed.
 * - the bot-count matrix 1/5/10/20 x both maps with 60 s rounds
 *   (req-bot-count-test-matrix), written to reports/game-simulation-matrix.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapId, SimSnapshot } from '../../src/contracts';
import { createDiagnostics, createProfiler } from '../../src/core';
import { createSimulation, prepareMap, runHeadless } from '../../src/sim';
import { hunter, idle } from './drivers';
import { MAPS, roundCfg } from './fixtures';

const LIVE_TICKS = 5 * 60 * 60;
const WINDOW = 90;
/** Codes a healthy round may count (watchdog snaps, truncated long paths). */
const EXPECTED = new Set([
  'ai/stuck-snap',
  'ai/path-truncated',
  'ai/few-patrol-nodes',
  'nav/queue-full',
]);

interface BotTrack {
  cells: Set<string>;
  refX: number;
  refZ: number;
  movingTicks: number;
  spanStart: number;
  longest: number;
}

function track(s: Readonly<SimSnapshot>, tracks: Map<number, BotTrack>, liveTick: number): void {
  for (const b of s.bots) {
    let t = tracks.get(b.id);
    if (t === undefined) {
      t = {
        cells: new Set(),
        refX: b.pos.x,
        refZ: b.pos.z,
        movingTicks: 0,
        spanStart: -1,
        longest: 0,
      };
      tracks.set(b.id, t);
    }
    if (!b.alive) continue;
    t.cells.add(`${Math.floor(b.pos.x / 4)},${Math.floor(b.pos.z / 4)}`);
    if (b.moving) t.movingTicks++;
    if (liveTick % WINDOW !== 0) continue;
    // A window counts as "no progress" when the bot tried to move (moving in half the
    // ticks) but its net displacement stayed under 0.3 m (the BR-AI-66 measure).
    const progress = Math.hypot(b.pos.x - t.refX, b.pos.z - t.refZ);
    if (t.movingTicks >= WINDOW / 2 && progress < 0.3) {
      if (t.spanStart < 0) t.spanStart = liveTick - WINDOW;
      t.longest = Math.max(t.longest, liveTick - t.spanStart);
    } else {
      t.spanStart = -1;
    }
    t.refX = b.pos.x;
    t.refZ = b.pos.z;
    t.movingTicks = 0;
  }
}

describe('5 minutes of live 20-bot play per map', () => {
  it.each(MAPS)(
    '%s: bots patrol varied places, no stuck-unresolved, and the run is reported',
    (map: MapId) => {
      const prepared = prepareMap(map);
      let live = 0;
      let rounds = 0;
      const counts: Record<string, number> = {};
      const longest: number[] = [];
      const cellsPerBot: number[] = [];
      for (let seed = 100; live < LIVE_TICKS; seed++) {
        rounds++;
        const diag = createDiagnostics(() => undefined);
        const r = createSimulation(roundCfg({ map, bots: 20, seed, durationSec: 300 }), prepared, {
          diag,
          profiler: createProfiler(() => 0),
        });
        if (!r.ok) throw new Error(r.error);
        const sim = r.value;
        const tracks = new Map<number, BotTrack>();
        let roundLive = 0;
        while (sim.snapshot().phase !== 'ended' && live < LIVE_TICKS) {
          sim.step(idle(sim.snapshot()));
          sim.drainEvents();
          if (sim.snapshot().phase !== 'live') continue;
          live++;
          roundLive++;
          track(sim.snapshot(), tracks, roundLive);
        }
        for (const [code, n] of Object.entries(diag.snapshot()))
          counts[code] = (counts[code] ?? 0) + n;
        for (const t of tracks.values()) {
          longest.push(t.longest);
          if (roundLive >= 1200) cellsPerBot.push(t.cells.size);
        }
      }
      expect(counts['ai/stuck-unresolved'] ?? 0).toBe(0);
      for (const code of Object.keys(counts)) expect(EXPECTED.has(code), code).toBe(true);
      cellsPerBot.sort((a, b) => a - b);
      const median = cellsPerBot[Math.floor(cellsPerBot.length / 2)] ?? 0;
      expect(median).toBeGreaterThanOrEqual(3); // patrol goals vary: bots cover several 4 m cells
      const worst = Math.max(...longest);
      mkdirSync('reports', { recursive: true });
      writeFileSync(
        `reports/game-simulation-stuck-${map}.json`,
        `${JSON.stringify(
          {
            map,
            bots: 20,
            liveTicks: live,
            rounds,
            diagnostics: counts,
            longestNoProgressSpanTicks: worst,
            target300: worst <= 300 ? 'pass' : 'miss',
            medianCellsVisited: median,
            note: 'Snapshot-based measure: windows of 90 ticks with the bot moving in >= half the ticks and < 0.3 m net progress. The watchdog episode limit (< 600 ticks) is asserted in bot-ai H-3; here the pipeline asserts zero ai/stuck-unresolved.',
          },
          null,
          2,
        )}\n`,
      );
    },
    180_000,
  );
});

describe('bot-count matrix (req-bot-count-test-matrix)', () => {
  const cells: Record<string, unknown>[] = [];

  for (const map of MAPS) {
    it.each([1, 5, 10, 20] as const)(
      `${map}: %i bots reach an outcome with only expected diagnostics`,
      (bots) => {
        const prepared = prepareMap(map);
        const r = runHeadless(
          roundCfg({ map, bots, seed: 500 + bots, durationSec: 60, difficulty: 'normal' }),
          hunter(prepared, { fire: true }),
          60 * 60 + 300,
          { map: prepared },
        );
        const unexpected = r.diagnostics.filter((c) => !EXPECTED.has(c));
        const pass = r.outcome !== null && r.botsSpawned === bots && unexpected.length === 0;
        cells.push({
          map,
          bots,
          pass,
          outcome: r.outcome,
          ticks: r.ticks,
          kills: r.playerKills,
          diagnostics: r.diagnostics,
        });
        mkdirSync('reports', { recursive: true });
        writeFileSync(
          'reports/game-simulation-matrix.json',
          `${JSON.stringify({ roundSec: 60, difficulty: 'normal', driver: 'hunter (test-only)', cells }, null, 2)}\n`,
        );
        expect(r.botsSpawned).toBe(bots);
        expect(r.outcome).not.toBeNull();
        expect(unexpected).toEqual([]);
      },
      60_000,
    );
  }
});
