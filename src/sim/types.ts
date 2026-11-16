/**
 * game-simulation types (domain-entities-game-simulation). They live here,
 * not in src/contracts (BR-GS-90); other components import them from
 * src/sim/index.ts.
 */
import type { Diagnostics, Profiler } from '../core';
import type { InputCommand, RoundOutcome, SimEvent, SimSnapshot } from '../contracts';
import type { MapDataIssueCode, MapDataList, MapDefinition } from '../maps';
import type { NavGraph } from '../nav';
import type { CollisionWorld } from '../physics';

export type SimValidationCode =
  | 'sim/nav-unattached'
  | 'sim/nav-unreachable'
  | 'sim/spawn-blocked'
  | 'sim/spawn-budget'
  | 'sim/too-few-spawns';

export interface MapValidationIssue {
  readonly code: SimValidationCode | MapDataIssueCode;
  readonly list?: MapDataList;
  readonly index?: number;
  readonly detail: string;
}

export interface MapValidationReport {
  readonly ok: boolean;
  readonly issues: readonly MapValidationIssue[];
  /** Bot candidates per player-eligible spawn (BR-GS-21); -1 for spawns the player cannot use. */
  readonly spawnBudget: readonly number[];
}

/** Map geometry, nav graph and validation; immutable and cached per MapId (BR-GS-14). */
export interface PreparedMap {
  readonly def: MapDefinition;
  readonly world: CollisionWorld;
  readonly nav: NavGraph;
  readonly validation: MapValidationReport;
}

export type PrepareStep = 'map-geometry' | 'nav-data';

export interface PrepareOptions {
  readonly signal: AbortSignal;
  readonly onProgress: (step: PrepareStep, fraction: number) => void;
  readonly yieldFn: () => Promise<void>;
  /** Clock for the bake slice budget only; the bake result does not depend on it. */
  readonly now: () => number;
  readonly sliceMs?: number;
  /** Validation issue codes are reported here once each (BR-GS-12). */
  readonly diag?: Diagnostics;
}

/** Spawn indices into def.spawns. `bots[i]` is the spawn of bot id i + 1. */
export interface SpawnPlan {
  readonly player: number;
  readonly bots: readonly number[];
}

export interface SimulationDeps {
  readonly diag: Diagnostics;
  readonly profiler: Profiler;
  /** AI rates; each must divide 60 (BR-GS-41). Defaults 20 and 10. */
  readonly ai?: { readonly senseHz?: number; readonly decideHz?: number };
}

export interface Simulation {
  /** Advances one tick (countdown or live); a no-op after the round ended (BR-GS-34). */
  step(cmd: InputCommand): void;
  /**
   * State after the latest tick. The object is reused: it stays valid until
   * the second following step() call. Copy what you keep.
   */
  snapshot(): Readonly<SimSnapshot>;
  /** State after the tick before; always exactly one tick older. */
  previousSnapshot(): Readonly<SimSnapshot>;
  /** Sim-owned copies, valid until the next drainEvents() call (BR-GS-63). */
  drainEvents(): readonly SimEvent[];
  setSensitivity(v: number): void;
}

export interface HeadlessRunReport {
  /** null when maxTicks ran out first. */
  readonly outcome: RoundOutcome | null;
  readonly ticks: number;
  readonly botsSpawned: number;
  readonly playerKills: number;
  readonly playerAlive: boolean;
  readonly eventCounts: Readonly<Record<SimEvent['t'], number>>;
  /** Codes seen, sorted. */
  readonly diagnostics: readonly string[];
}
