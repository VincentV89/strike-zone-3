/**
 * RoundSession lifecycle (business-logic-model-app-shell §6). One session at
 * a time: a new Simulation, a new StatsTracker and a child DisposableScope
 * per round. Disposal is the only teardown path (RL-AS-01).
 */
import type { RoundConfig } from '../contracts';
import type { Diagnostics, Profiler, Result } from '../core';
import { err, ok } from '../core';
import type { GameRenderer } from '../render';
import { createSimulation, type PreparedMap, type Simulation } from '../sim';
import { createStatsTracker, type SessionStats, type StatsTracker } from '../sim/stats';
import type { Hud } from '../ui/hud';
import type { DisposableScope } from './scope';

export interface RoundSession {
  readonly sim: Simulation;
  readonly stats: StatsTracker;
  readonly scope: DisposableScope;
  readonly cfg: RoundConfig;
  /** Monotonic round number for HudContext. */
  readonly round: number;
  readonly prepared: PreparedMap;
  /** Set once commit() or discard() ran, so a round is settled exactly once (BR-AS-06). */
  settled: boolean;
}

export interface SessionDeps {
  readonly diag: Diagnostics;
  readonly profiler: Profiler;
  readonly renderer: Pick<GameRenderer, 'spawnActors'>;
  readonly hud: Pick<Hud, 'reset'>;
  readonly sensitivity: number;
  readonly ai?: { readonly senseHz?: number; readonly decideHz?: number };
}

export function createRoundSession(
  prepared: PreparedMap,
  cfg: RoundConfig,
  session: SessionStats,
  round: number,
  parent: DisposableScope,
  deps: SessionDeps,
): Result<RoundSession, 'SPAWN_ALLOCATION_FAILED'> {
  const simDeps = {
    diag: deps.diag,
    profiler: deps.profiler,
    ...(deps.ai === undefined ? {} : { ai: deps.ai }),
  };
  const sim = createSimulation(cfg, prepared, simDeps);
  if (!sim.ok) return err(sim.error);
  sim.value.setSensitivity(deps.sensitivity);
  const stats = createStatsTracker(session, cfg.bots);
  deps.renderer.spawnActors(cfg.bots);
  deps.hud.reset();
  return ok({
    sim: sim.value,
    stats,
    scope: parent.child(),
    cfg,
    round,
    prepared,
    settled: false,
  });
}

/** Abandoned round (RA-03): discard, never written to history. */
export function discardRound(s: RoundSession): void {
  if (s.settled) return;
  s.settled = true;
  s.stats.discard();
}

export function disposeRoundSession(s: RoundSession): void {
  s.scope.dispose();
}
