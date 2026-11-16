/**
 * runHeadless (business-logic-model-game-simulation §9). The driver is a
 * parameter, so the bundle holds no code that aims from snap.bots; drivers
 * live in tests/sim/drivers.ts (SD-GS-08). app-shell never imports this.
 */
import { PLAYER_ID, StrikeZoneError, createDiagnostics, createProfiler } from '../core';
import type { InputCommand, RoundConfig, SimEvent, SimSnapshot } from '../contracts';
import { prepareMap } from './prepare';
import { createSimulation } from './simulation';
import type { HeadlessRunReport, PreparedMap, SimulationDeps } from './types';

export interface HeadlessOptions {
  /** A prepared map to use instead of prepareMap(cfg.map). */
  readonly map?: PreparedMap;
  readonly ai?: SimulationDeps['ai'];
}

/**
 * Runs one round until it ends or `maxTicks` steps ran. The time-free
 * profiler (now = 0) keeps the sim ring off the wall clock.
 * @throws StrikeZoneError('sim/headless-spawn') when spawns cannot be allocated.
 */
export function runHeadless(
  cfg: RoundConfig,
  driver: (s: Readonly<SimSnapshot>) => InputCommand,
  maxTicks: number,
  opts: HeadlessOptions = {},
): HeadlessRunReport {
  const map = opts.map ?? prepareMap(cfg.map);
  const seen = new Set<string>();
  const diag = createDiagnostics((code) => {
    seen.add(code);
  });
  const deps: SimulationDeps = {
    diag,
    profiler: createProfiler(() => 0),
    ...(opts.ai === undefined ? {} : { ai: opts.ai }),
  };
  const created = createSimulation(cfg, map, deps);
  if (!created.ok) throw new StrikeZoneError('sim/headless-spawn', 'Spawn allocation failed');
  const sim = created.value;
  const eventCounts: Record<SimEvent['t'], number> = {
    shot: 0,
    impact: 0,
    damage: 0,
    kill: 0,
    noise: 0,
    weapon: 0,
    phase: 0,
  };
  let playerKills = 0;
  let ticks = 0;
  while (ticks < maxTicks && sim.snapshot().phase !== 'ended') {
    sim.step(driver(sim.snapshot()));
    ticks++;
    for (const e of sim.drainEvents()) {
      eventCounts[e.t]++;
      if (e.t === 'kill' && e.killer === PLAYER_ID && e.victim !== PLAYER_ID) playerKills++;
    }
  }
  const snap = sim.snapshot();
  for (const code of Object.keys(diag.snapshot())) seen.add(code);
  return Object.freeze({
    outcome: snap.outcome,
    ticks,
    botsSpawned: snap.bots.length,
    playerKills,
    playerAlive: snap.player.alive,
    eventCounts: Object.freeze(eventCounts),
    diagnostics: Object.freeze([...seen].sort()),
  });
}
