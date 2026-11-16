/**
 * Determinism (BR-GS-92, SD-GS-05, NFR-GS-Q2 = A, story-walking-skeleton AC3):
 * an exact in-process replay hash over 1,800 ticks, and the committed seed-42
 * golden of discrete facts. The golden is rewritten only with
 * SZ_UPDATE_GOLDEN=1, as a reviewed diff; a missing file fails.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapId, RoundConfig, SimEvent } from '../../src/contracts';
import { type prepareMap } from '../../src/sim';
import { hunter, scripted, type Driver } from './drivers';
import { createHasher, hashTick } from './hash';
import { rig } from './fixtures';

const GOLDEN = 'tests/sim/golden/seed-42.json';
const TICKS = 1800;

function replay(
  cfg: Partial<RoundConfig>,
  drive: (m: ReturnType<typeof prepareMap>) => Driver,
): number {
  const { sim, map } = rig(cfg, { allowed: ['ai/few-patrol-nodes', 'sim/step-after-end'] });
  const d = drive(map);
  const h = createHasher();
  for (let t = 0; t < TICKS; t++) {
    sim.step(d(sim.snapshot()));
    hashTick(h, sim.snapshot(), sim.drainEvents());
    hashTick(h, sim.previousSnapshot(), []);
  }
  return h.digest;
}

describe('in-process replay hash (1,800 ticks)', () => {
  it.each(['desert-compound', 'industrial-warehouse'] as MapId[])(
    '%s: two runs with one seed hash equal; another seed differs',
    (map) => {
      const cfg: Partial<RoundConfig> = { map, bots: 10, difficulty: 'hard', seed: 1234 };
      const drive = (m: ReturnType<typeof prepareMap>) => hunter(m, { fire: true });
      const first = replay(cfg, drive);
      expect(replay(cfg, drive)).toBe(first);
      expect(replay({ ...cfg, seed: 1235 }, drive)).not.toBe(first);
    },
  );
});

interface Golden {
  config: RoundConfig;
  ticks: number;
  spawn: { player: number; bots: number[] };
  events: string;
  outcome: string | null;
  botsAlive: number[];
  positions: number[][];
}

const round9 = (x: number): number => Number(x.toFixed(9));

function goldenRun(): Golden {
  const config: RoundConfig = {
    map: 'desert-compound',
    bots: 10,
    difficulty: 'normal',
    durationSec: 180,
    seed: 42,
  };
  const { sim, map } = rig(config, { allowed: ['ai/few-patrol-nodes'] });
  const spawnOf = (p: { x: number; z: number }): number =>
    map.def.spawns.findIndex((s) => s.pos.x === p.x && s.pos.z === p.z);
  const s0 = sim.snapshot();
  const spawn = { player: spawnOf(s0.player.pos), bots: s0.bots.map((b) => spawnOf(b.pos)) };
  const drive = scripted();
  const events: string[] = [];
  const botsAlive: number[] = [];
  const positions: number[][] = [];
  let ticks = 0;
  for (; ticks < TICKS && sim.snapshot().phase !== 'ended'; ticks++) {
    sim.step(drive(sim.snapshot()));
    for (const e of sim.drainEvents() as SimEvent[]) events.push(`${e.tick}:${e.t}`);
    const s = sim.snapshot();
    if (s.tick % 60 === 0) {
      botsAlive.push(s.botsAlive);
      positions.push(
        [s.player.pos, ...s.bots.map((b) => b.pos)].flatMap((p) => [
          round9(p.x),
          round9(p.y),
          round9(p.z),
        ]),
      );
    }
  }
  return {
    config,
    ticks,
    spawn,
    events: events.join(','),
    outcome: sim.snapshot().outcome,
    botsAlive,
    positions,
  };
}

describe('seed-42 golden (Desert Compound, 10 Normal bots)', () => {
  it('matches tests/sim/golden/seed-42.json', () => {
    const got = goldenRun();
    if (process.env.SZ_UPDATE_GOLDEN === '1') {
      writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    }
    expect(existsSync(GOLDEN), `${GOLDEN} is missing; run with SZ_UPDATE_GOLDEN=1`).toBe(true);
    const want = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
    expect(got.config).toEqual(want.config);
    expect(got.spawn).toEqual(want.spawn);
    expect(got.ticks).toBe(want.ticks);
    expect(got.outcome).toBe(want.outcome);
    expect(got.botsAlive).toEqual(want.botsAlive);
    expect(got.events).toBe(want.events);
    expect(got.positions).toEqual(want.positions);
    expect(got.spawn.bots).toHaveLength(10);
    expect(new Set([got.spawn.player, ...got.spawn.bots]).size).toBe(11);
  });
});
