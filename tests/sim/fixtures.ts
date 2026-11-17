/**
 * Shared fixtures for game-simulation tests: round configs, a time-free
 * profiler, diagnostics that fail on unexpected codes, and step helpers.
 */
import { createDiagnostics, createProfiler, type Diagnostics, type Profiler } from '../../src/core';
import type { MapId, RoundConfig, SimEvent } from '../../src/contracts';
import { createSimulation, prepareMap, type PreparedMap, type Simulation } from '../../src/sim';
import type { Driver } from './drivers';

export const MAPS: readonly MapId[] = ['desert-compound', 'industrial-warehouse'];
export const COUNTDOWN = 210;

export function roundCfg(over: Partial<RoundConfig> = {}): RoundConfig {
  return {
    map: 'desert-compound',
    bots: 5,
    difficulty: 'normal',
    durationSec: 180,
    seed: 7,
    ...over,
  };
}

export const quietProfiler = (): Profiler => createProfiler(() => 0);

/** Records every code and throws on any first-time code outside `allowed`. */
export function allowDiag(allowed: readonly string[] = []): Diagnostics & { codes: string[] } {
  const codes: string[] = [];
  const d = createDiagnostics((code) => {
    codes.push(code);
    if (!allowed.includes(code)) throw new Error(`unexpected diagnostic ${code}`);
  });
  return Object.assign(d, { codes });
}

export interface Rig {
  readonly sim: Simulation;
  readonly map: PreparedMap;
  readonly diag: Diagnostics & { codes: string[] };
  readonly cfg: RoundConfig;
}

export function rig(
  over: Partial<RoundConfig> = {},
  o: { allowed?: readonly string[]; ai?: { senseHz?: number; decideHz?: number } } = {},
): Rig {
  const cfg = roundCfg(over);
  const map = prepareMap(cfg.map);
  const diag = allowDiag(o.allowed ?? []);
  const r = createSimulation(cfg, map, {
    diag,
    profiler: quietProfiler(),
    ...(o.ai === undefined ? {} : { ai: o.ai }),
  });
  if (!r.ok) throw new Error(r.error);
  return { sim: r.value, map, diag, cfg };
}

/** Steps `n` ticks with `driver`, returning a deep copy of every drained event. */
export function run(sim: Simulation, n: number, driver: Driver): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step(driver(sim.snapshot()));
    for (const e of sim.drainEvents()) out.push(structuredClone(e));
  }
  return out;
}

/** Steps until the round ends or `max` ticks ran. */
export function runToEnd(sim: Simulation, driver: Driver, max: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < max && sim.snapshot().phase !== 'ended'; i++) {
    sim.step(driver(sim.snapshot()));
    for (const e of sim.drainEvents()) out.push(structuredClone(e));
  }
  return out;
}
