/**
 * Seeded fuzz of the tick path (SEC-GS-09, SD-GS-03), split per NFR-GS-D1 = A:
 * a guard tier of 2,000 sequences x 60 hostile ticks at 1 bot and a pipeline
 * tier of 20 sequences x 600 hostile ticks at 20 bots (10 per map). Both
 * assert no throw, no non-finite snapshot number and only known codes.
 */
import { describe, expect, it } from 'vitest';
import { createDiagnostics, createProfiler, createRng, type Rng } from '../../src/core';
import type { InputCommand, MapId, SimSnapshot } from '../../src/contracts';
import { SIM_CODES, createSimulation, prepareMap } from '../../src/sim';
import { COUNTDOWN, MAPS, roundCfg } from './fixtures';
import { cmd } from './helpers';

const HOSTILE: readonly unknown[] = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  1e300,
  -1e300,
  -0,
  'x',
  {},
  null,
  undefined,
  true,
  7,
  -3,
];

function hostileCommand(rng: Rng): InputCommand {
  const c = cmd({
    move: { x: rng.pick([-1, 0, 1] as const), z: rng.pick([-1, 0, 1] as const) },
    lookDx: rng.range(-50, 50),
    lookDy: rng.range(-50, 50),
    jump: rng.next() < 0.1,
    sprint: rng.next() < 0.5,
    crouch: rng.next() < 0.2,
    fire: rng.next() < 0.5,
    firePressed: rng.next() < 0.3,
    scope: rng.next() < 0.2,
    reload: rng.next() < 0.05,
    select: rng.pick([null, 0, 1, 2] as const),
    cycle: rng.pick([-1, 0, 1] as const),
  });
  const fields: (keyof InputCommand)[] = [
    'tick',
    'lookDx',
    'lookDy',
    'jump',
    'sprint',
    'crouch',
    'fire',
    'firePressed',
    'scope',
    'reload',
    'select',
    'cycle',
  ];
  const r = c as unknown as Record<string, unknown>;
  for (let i = rng.int(0, 4); i > 0; i--) r[rng.pick(fields)] = rng.pick(HOSTILE);
  if (rng.next() < 0.1) r.move = rng.pick(HOSTILE);
  else if (rng.next() < 0.2) (r.move as Record<string, unknown>).x = rng.pick(HOSTILE);
  return c;
}

function finiteSnapshot(s: Readonly<SimSnapshot>): boolean {
  let ok = true;
  const walk = (v: unknown): void => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) ok = false;
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (typeof v === 'object' && v !== null) {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(s);
  return ok;
}

const KNOWN = /^(sim|core|player|weapons|combat|ai|nav|physics)\/[a-z0-9-]+$/;

function fuzz(map: MapId, bots: 1 | 20, seed: number, ticks: number, codes: Set<string>): void {
  const prepared = prepareMap(map);
  const diag = createDiagnostics((code) => codes.add(code));
  const r = createSimulation(roundCfg({ map, bots, seed, durationSec: 600 }), prepared, {
    diag,
    profiler: createProfiler(() => 0),
  });
  if (!r.ok) throw new Error(r.error);
  const sim = r.value;
  for (let i = 0; i < COUNTDOWN; i++) sim.step(cmd());
  sim.drainEvents();
  const rng = createRng(seed).fork('fuzz');
  for (let i = 0; i < ticks; i++) {
    sim.step(hostileCommand(rng));
    if (i % 5 === 0) sim.setSensitivity(rng.pick([1, 0, -1, Number.NaN, 1e9] as const));
    else sim.setSensitivity(1);
    expect(finiteSnapshot(sim.snapshot())).toBe(true);
    sim.drainEvents();
  }
  for (const code of Object.keys(diag.snapshot())) codes.add(code);
}

describe('tick-path fuzz (NFR-GS-D1 = A)', () => {
  it('guard tier: 2,000 sequences x 60 hostile ticks at 1 bot never throw or write non-finite values', () => {
    const codes = new Set<string>();
    for (let s = 0; s < 2000; s++) fuzz(MAPS[s % 2] as MapId, 1, 10_000 + s, 60, codes);
    for (const c of codes) expect(c).toMatch(KNOWN);
    for (const c of codes) if (c.startsWith('sim/')) expect(SIM_CODES).toContain(c);
    expect(codes.has('player/bad-input')).toBe(true); // the hostile values did reach the guards
  }, 180_000);

  it('pipeline tier: 20 sequences x 600 hostile ticks at 20 bots (10 per map)', () => {
    const codes = new Set<string>();
    for (let s = 0; s < 20; s++) fuzz(MAPS[s % 2] as MapId, 20, 20_000 + s, 600, codes);
    for (const c of codes) expect(c).toMatch(KNOWN);
    for (const c of codes) if (c.startsWith('sim/')) expect(SIM_CODES).toContain(c);
  }, 180_000);
});
