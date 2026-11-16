/**
 * Bounded graph searches for decide (BR-AI-13, business-logic-model-bot-ai §7).
 * BFS over graph.neighbours with a per-round BrainScratch: generation stamps
 * avoid per-call clearing, and nothing is allocated (SD-AI-12). No A* here.
 */
import { StrikeZoneError, type Diagnostics, type Rng, type Vec3 } from '../../core';
import { NAV_MAX_NODES, type NavGraph, type NavNodeId } from '../../nav';
import type { CollisionWorld } from '../../physics';
import type { BrainScratch } from './types';

/** Retreat ring probes: 8 bearings x 3 radii = 24 candidates (BR-AI-13 cap). */
export const RETREAT_BEARINGS = 8;
export const RETREAT_RADII = [14, 20, 26] as const;
export const RETREAT_PROBES = RETREAT_BEARINGS * RETREAT_RADII.length;
export const RETREAT_MIN_DIST = 12;
export const RETREAT_MAX_DIST = 30;
export const SEARCH_MAX_VISITED = 40;
export const SEARCH_MIN_DIST = 4;
export const SEARCH_MAX_DIST = 10;
/** Eye height above a retreat node for the blocked-sight test (m). */
export const RETREAT_EYE = 1.6;
/** Candidate buffer size (patrol lists can hold up to 64 hints + 80 cover anchors). */
export const MAX_CANDIDATES = 160;

/** @throws StrikeZoneError('ai/bad-config') unless nodeCount is an integer in 0..NAV_MAX_NODES. */
export function createBrainScratch(nodeCount: number): BrainScratch {
  if (!Number.isInteger(nodeCount) || nodeCount < 0 || nodeCount > NAV_MAX_NODES) {
    throw new StrikeZoneError('ai/bad-config', 'Bad nav node count for BrainScratch');
  }
  return {
    stamp: new Uint32Array(nodeCount),
    visited: new Int32Array(SEARCH_MAX_VISITED),
    candidates: new Int32Array(MAX_CANDIDATES),
    generation: 0,
  };
}

function nextGeneration(s: BrainScratch): number {
  s.generation = (s.generation + 1) >>> 0;
  if (s.generation === 0) {
    s.stamp.fill(0);
    s.generation = 1;
  }
  return s.generation;
}

/** Breadth-first visit from `start`; fills scratch.visited in visit order and returns the count. */
export function boundedBfs(
  graph: NavGraph,
  start: NavNodeId,
  maxVisited: number,
  s: BrainScratch,
): number {
  if (!Number.isInteger(start) || start < 0 || start >= s.stamp.length) return 0;
  const gen = nextGeneration(s);
  const cap = Math.min(maxVisited, s.visited.length);
  let head = 0;
  let tail = 0;
  s.visited[tail++] = start;
  s.stamp[start] = gen;
  while (head < tail && tail < cap) {
    const nbs = graph.neighbours(s.visited[head++] ?? 0);
    for (let i = 0; i < nbs.length && tail < cap; i++) {
      const nb = nbs[i] ?? -1;
      if (nb < 0 || nb >= s.stamp.length || s.stamp[nb] === gen) continue;
      s.stamp[nb] = gen;
      s.visited[tail++] = nb;
    }
  }
  return tail;
}

/**
 * BR-AI-30, adapted: a 64-node BFS on the 1.5 m lattice only reaches about
 * 6 m, never the 12-30 m band, so retreat candidates come from 24 ring probes
 * instead (8 bearings x 3 radii, snapped with nearestNode, same component as
 * the bot). Among candidates 12-30 m away, the one farthest from the threat
 * whose eye point the threat cannot see wins; if none is hidden, the farthest
 * one. Null when there is no candidate. At most 24 LOS tests.
 */
export function findRetreatNode(
  graph: NavGraph,
  from: Vec3,
  threat: Vec3,
  world: CollisionWorld,
  probe: Vec3,
  eye: Vec3,
): NavNodeId | null {
  const start = graph.nearestNode(from);
  if (start === null) return null;
  let bestHidden = -1;
  let bestHiddenD = -1;
  let bestAny = -1;
  let bestAnyD = -1;
  for (let k = 0; k < RETREAT_PROBES; k++) {
    const bearing = ((k % RETREAT_BEARINGS) * 2 * Math.PI) / RETREAT_BEARINGS;
    const radius = RETREAT_RADII[Math.floor(k / RETREAT_BEARINGS)] ?? RETREAT_MIN_DIST;
    probe.x = from.x + Math.cos(bearing) * radius;
    probe.y = from.y;
    probe.z = from.z + Math.sin(bearing) * radius;
    const id = graph.nearestNode(probe);
    const node = id === null ? undefined : graph.nodes[id];
    if (node === undefined || id === null || !graph.reachable(start, id)) continue;
    const d = Math.hypot(node.pos.x - from.x, node.pos.z - from.z);
    if (d < RETREAT_MIN_DIST || d > RETREAT_MAX_DIST) continue;
    const dt = Math.hypot(node.pos.x - threat.x, node.pos.z - threat.z);
    if (dt > bestAnyD) {
      bestAnyD = dt;
      bestAny = id;
    }
    eye.x = node.pos.x;
    eye.y = node.pos.y + RETREAT_EYE;
    eye.z = node.pos.z;
    if (dt > bestHiddenD && !world.lineOfSight(threat, eye)) {
      bestHiddenD = dt;
      bestHidden = id;
    }
  }
  if (bestHidden >= 0) return bestHidden;
  return bestAny >= 0 ? bestAny : null;
}

/** BR-AI-26: up to `out.length` (2) distinct nodes 4-10 m from `target`, chosen by rng. */
export function findSearchNodes(
  graph: NavGraph,
  target: Vec3,
  rng: Rng,
  s: BrainScratch,
  out: Int32Array,
): number {
  const start = graph.nearestNode(target);
  if (start === null) return 0;
  const count = boundedBfs(graph, start, SEARCH_MAX_VISITED, s);
  let m = 0;
  for (let k = 0; k < count; k++) {
    const id = s.visited[k] ?? -1;
    const node = graph.nodes[id];
    if (node === undefined) continue;
    const d = Math.hypot(node.pos.x - target.x, node.pos.z - target.z);
    if (d >= SEARCH_MIN_DIST && d <= SEARCH_MAX_DIST) s.candidates[m++] = id;
  }
  let n = 0;
  while (n < out.length && m > 0) {
    const pick = Math.floor(rng.next() * m);
    out[n++] = s.candidates[pick] ?? 0;
    s.candidates[pick] = s.candidates[m - 1] ?? 0;
    m--;
  }
  return n;
}

/**
 * Patrol destinations (BR-AI-25): nav anchors of `patrol` hints; with fewer
 * than 3, cover anchors are added and `ai/few-patrol-nodes` is reported.
 * Setup only (allocates).
 */
export function collectPatrolNodes(graph: NavGraph, diag: Diagnostics): readonly NavNodeId[] {
  const out: NavNodeId[] = [];
  for (const n of graph.nodes) {
    const a = n.anchor;
    if (a !== null && a.list === 'navHints' && a.hint === 'patrol') out.push(n.id);
  }
  if (out.length < 3) {
    diag.warnOnce('ai/few-patrol-nodes');
    for (const n of graph.nodes) {
      if (n.anchor !== null && n.anchor.list === 'cover' && !out.includes(n.id)) out.push(n.id);
    }
  }
  return Object.freeze(out.slice(0, MAX_CANDIDATES));
}
