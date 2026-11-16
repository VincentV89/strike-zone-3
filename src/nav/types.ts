/**
 * navigation types (domain-entities-collision-nav). They live here, not in
 * src/contracts (SD-CN-03); other units import them from src/nav/index.ts.
 */
import type { Diagnostics, EntityId, Result, Vec3 } from '../core';
import type { Capsule } from '../physics';

/** Index into NavGraph.nodes. */
export type NavNodeId = number;
export type NavNodeKind = 'grid' | 'ramp' | 'anchor';

export type AnchorList = 'spawns' | 'cover' | 'navHints';

export type AnchorRef =
  | { readonly list: 'spawns' | 'cover'; readonly index: number }
  | { readonly list: 'navHints'; readonly index: number; readonly hint: 'patrol' | 'seed' };

export interface NavNode {
  readonly id: NavNodeId;
  /** Feet position on a walkable surface. */
  readonly pos: Readonly<Vec3>;
  readonly kind: NavNodeKind;
  /** Connected-component id, 0..k-1. */
  readonly component: number;
  /** The anchor that created the node, when kind === 'anchor'. */
  readonly anchor: AnchorRef | null;
}

/** Immutable after the bake; shared read-only by the path service and AI. */
export interface NavGraph {
  readonly nodes: readonly NavNode[];
  /** Nearest node by dxz^2 + (2 dy)^2 within 6 m and |dy| <= 2.5 m; ties to the lower id (BR-CN-70). */
  nearestNode(p: Vec3): NavNodeId | null;
  /** Same component; links are walkable both ways, so this equals path existence. */
  reachable(a: NavNodeId, b: NavNodeId): boolean;
  /** Ascending neighbour ids; a shared empty array for a bad id. */
  neighbours(id: NavNodeId): readonly NavNodeId[];
  /** Node of a spawn, cover point or patrol/seed hint, or null when it did not attach. */
  anchorNode(list: AnchorList, index: number): NavNodeId | null;
  readonly componentCount: number;
  /** Undirected edges. */
  readonly edgeCount: number;
}

export interface NavBakeOptions {
  /** Lattice spacing in [0.5, 4] (default 1.5). */
  readonly spacing?: number;
  /** The standing agent every node must fit. */
  readonly agent: Capsule;
  /** Default MAP_RULES.stepHeight (0.35). */
  readonly stepHeight?: number;
  /** Graph-query diagnostics (bad node ids, non-finite input). */
  readonly diagnostics?: Diagnostics;
}

export type NavBakePhase = 'candidates' | 'fitting' | 'linking' | 'components' | 'done' | 'failed';

export interface NavBaker {
  /**
   * Runs work items until the budget is spent (checked every 16 items) or the
   * bake is done; returns true when done. Always runs at least one item.
   */
  step(budgetMs: number, now: () => number): boolean;
  /** Monotonic in [0, 1]; 1 only when done. */
  progress(): number;
  readonly phase: NavBakePhase;
  result(): NavGraph;
}

export interface PathAvoid {
  readonly center: Vec3;
  readonly radius: number;
  readonly penalty: number;
}

export interface PathRequest {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly avoid?: PathAvoid;
}

/** Opaque; id is monotonic per service. */
export interface PathTicket {
  readonly id: number;
  readonly entity: EntityId;
}

/**
 * Waypoints are feet positions, ending with `to` exactly and excluding `from`.
 * The array is a read-only view reused per slot: valid until the ticket is
 * cancelled or superseded, so callers copy what they keep (SD-CN-16).
 */
export type PathResult = Result<readonly Readonly<Vec3>[], 'NO_PATH' | 'OFF_GRAPH'>;

export interface PathServiceStats {
  /** Requests resolved by a search (including OFF_GRAPH and cross-component NO_PATH). */
  readonly solved: number;
  readonly cacheHits: number;
  /** Requests waiting in the queue now. */
  readonly queued: number;
  readonly dropped: number;
}

export interface PathService {
  request(id: EntityId, req: PathRequest): PathTicket;
  poll(t: PathTicket): PathResult | 'pending';
  cancel(t: PathTicket): void;
  /** Pipeline stage 6: at most maxPathsPerTick searches and 16 cache hits. */
  tick(): void;
  readonly stats: PathServiceStats;
}

export interface PathServiceOptions {
  /** Integer in 1..8 (default 2). */
  readonly maxPathsPerTick?: number;
  /** Integer in 1..256 (default 64). */
  readonly cacheSize?: number;
  readonly diagnostics?: Diagnostics;
}

export interface NavReport {
  readonly components: number;
  readonly unattached: readonly { readonly list: AnchorList; readonly index: number }[];
  readonly unreachable: readonly {
    readonly fromSpawn: number;
    readonly list: 'spawns' | 'cover';
    readonly index: number;
  }[];
  /** unattached and unreachable are both empty. */
  readonly ok: boolean;
}
