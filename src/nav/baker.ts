/**
 * Nav baker (LC-CN-06, business-logic-model-collision-nav §6). A time-sliced
 * work list: candidates -> fitting -> linking -> components -> done. Work
 * items run in a fixed order, and the injected clock only decides how many
 * run per step() call, so the graph is the same for any budget (BR-CN-67).
 */
import { StrikeZoneError, vec3 } from '../core';
import { MAP_RULES, WALKABLE_KINDS, type MapDefinition } from '../maps';
import type { Capsule, CollisionWorld } from '../physics';
import {
  BAKE_CLOCK_EVERY,
  NAV_ANCHOR_LINK_FACTOR,
  NAV_LINK_FACTOR,
  NAV_MAX_NEIGHBOURS,
  NAV_MAX_NODES,
  NAV_MAX_SPACING,
  NAV_MERGE_DY,
  NAV_MERGE_XZ,
  NAV_MIN_SPACING,
  NAV_SPACING,
  UNION_BATCH,
} from './constants';
import { NOOP_DIAGNOSTICS } from './diagnostics';
import { buildNodeHash, createNavGraph, type NodeHash } from './graph';
import type {
  AnchorList,
  AnchorRef,
  NavBakeOptions,
  NavBakePhase,
  NavBaker,
  NavGraph,
  NavNodeKind,
} from './types';

const PHASE_WEIGHTS = { candidates: 0.05, fitting: 0.25, linking: 0.65, components: 0.05 };
const KIND_ANCHOR = 0;
const KIND_GRID = 1;
const KIND_RAMP = 2;
const KIND_NAMES: readonly NavNodeKind[] = ['anchor', 'grid', 'ramp'];

interface Source {
  readonly type: 'anchor' | 'top' | 'ramp';
  readonly index: number;
}

function invalidOptions(detail: Record<string, number>): never {
  throw new StrikeZoneError('nav/invalid-options', 'Invalid nav bake options', detail);
}

/** Lattice coordinates along one axis of an inset extent (BR-CN-61). */
function lattice(lo: number, hi: number, spacing: number): number[] {
  if (hi < lo) return [];
  if (hi - lo < spacing) return [(lo + hi) / 2];
  const out: number[] = [];
  const n = Math.floor((hi - lo) / spacing + 1e-9);
  for (let k = 0; k <= n; k++) out.push(lo + k * spacing);
  return out;
}

export function createNavBaker(
  def: MapDefinition,
  world: CollisionWorld,
  opts: NavBakeOptions,
): NavBaker {
  const spacing = opts.spacing ?? NAV_SPACING;
  const agent: Capsule = Object.freeze({ radius: opts.agent.radius, height: opts.agent.height });
  const stepHeight = opts.stepHeight ?? MAP_RULES.stepHeight;
  if (!Number.isFinite(spacing) || spacing < NAV_MIN_SPACING || spacing > NAV_MAX_SPACING) {
    invalidOptions({ spacing });
  }
  if (
    !Number.isFinite(agent.radius) ||
    !Number.isFinite(agent.height) ||
    agent.radius <= 0 ||
    agent.height <= 0
  ) {
    invalidOptions({ radius: agent.radius, height: agent.height });
  }
  if (!Number.isFinite(stepHeight) || stepHeight < 0) invalidOptions({ stepHeight });
  const diagnostics = opts.diagnostics ?? NOOP_DIAGNOSTICS;
  const r = agent.radius;
  const linkRadius = NAV_LINK_FACTOR * spacing;

  // Copies of the map data the bake reads (SD-CN-05).
  const b = def.bounds;
  const bounds = { minX: b.min.x, minZ: b.min.z, maxX: b.max.x, maxZ: b.max.z };
  const anchors: { x: number; y: number; z: number; ref: AnchorRef }[] = [];
  def.spawns.forEach((s, index) => {
    anchors.push({ x: s.pos.x, y: s.pos.y, z: s.pos.z, ref: { list: 'spawns', index } });
  });
  def.cover.forEach((c, index) => {
    anchors.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z, ref: { list: 'cover', index } });
  });
  const excludes: number[][] = [];
  def.navHints.forEach((h, index) => {
    if (h.kind === 'exclude') {
      const { min, max } = h.region;
      excludes.push([min.x, min.y, min.z, max.x, max.y, max.z]);
    } else {
      anchors.push({
        x: h.pos.x,
        y: h.pos.y,
        z: h.pos.z,
        ref: { list: 'navHints', index, hint: h.kind },
      });
    }
  });
  const tops: number[][] = [];
  def.solids.forEach((s) => {
    if (!WALKABLE_KINDS.has(s.kind)) return;
    tops.push([s.box.min.x, s.box.min.z, s.box.max.x, s.box.max.z, s.box.max.y]);
  });
  const ramps = def.ramps.map((rp) => ({
    minX: rp.minX,
    maxX: rp.maxX,
    minZ: rp.minZ,
    maxZ: rp.maxZ,
    baseY: rp.baseY,
    topY: rp.topY,
    up: rp.up,
  }));
  const sources: Source[] = [
    ...anchors.map((_, index) => ({ type: 'anchor' as const, index })),
    ...tops.map((_, index) => ({ type: 'top' as const, index })),
    ...ramps.map((_, index) => ({ type: 'ramp' as const, index })),
  ];

  // Candidate list (setup-time arrays; the bake is not on the tick path).
  const cx: number[] = [];
  const cy: number[] = [];
  const cz: number[] = [];
  const cKind: number[] = [];
  const cAnchor: number[] = [];

  // Node arrays preallocated at the cap (SD-CN-06).
  const px = new Float64Array(NAV_MAX_NODES);
  const py = new Float64Array(NAV_MAX_NODES);
  const pz = new Float64Array(NAV_MAX_NODES);
  const nodeKind = new Uint8Array(NAV_MAX_NODES);
  const nodeAnchor = new Int32Array(NAV_MAX_NODES).fill(-1);
  const anchorNodeOf = new Int32Array(anchors.length).fill(-1);
  let n = 0;
  const mergeHash = new Map<number, number[]>();
  const mergeCols = Math.max(1, Math.ceil(bounds.maxX - bounds.minX) + 3);
  const mergeKey = (x: number, z: number): number =>
    Math.floor(z - bounds.minZ + 1) * mergeCols + Math.floor(x - bounds.minX + 1);

  // Links.
  const deg = new Int32Array(NAV_MAX_NODES);
  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const edgeCost: number[] = [];
  let linkHash: NodeHash | null = null;

  let phase: NavBakePhase = 'candidates';
  let cursor = 0;
  let graph: NavGraph | null = null;
  let parent: Int32Array | null = null;
  const pa = vec3();
  const pb = vec3();

  const pushCandidate = (x: number, y: number, z: number, kind: number, anchor: number): void => {
    cx.push(x);
    cy.push(y);
    cz.push(z);
    cKind.push(kind);
    cAnchor.push(anchor);
  };

  function emitSource(src: Source): void {
    if (src.type === 'anchor') {
      const a = anchors[src.index];
      if (a !== undefined) pushCandidate(a.x, a.y, a.z, KIND_ANCHOR, src.index);
      return;
    }
    if (src.type === 'top') {
      const t = tops[src.index];
      if (t === undefined) return;
      const [x0 = 0, z0 = 0, x1 = 0, z1 = 0, y = 0] = t;
      for (const zz of lattice(z0 + r, z1 - r, spacing)) {
        for (const xx of lattice(x0 + r, x1 - r, spacing)) pushCandidate(xx, y, zz, KIND_GRID, -1);
      }
      return;
    }
    const rp = ramps[src.index];
    if (rp === undefined) return;
    const alongX = rp.up === '+x' || rp.up === '-x';
    const run = alongX ? rp.maxX - rp.minX : rp.maxZ - rp.minZ;
    const across = alongX
      ? lattice(rp.minZ + r, rp.maxZ - r, spacing)
      : lattice(rp.minX + r, rp.maxX - r, spacing);
    // Rows from 0.5 x spacing after the low edge (BR-CN-61), plus one row on the
    // high edge so the ramp links to the lattice of the top it leads onto.
    const rows: number[] = [];
    for (let s = 0.5 * spacing; s < run; s += spacing) rows.push(s);
    rows.push(run);
    for (const s of rows) {
      const t = s / run;
      const y = rp.baseY + (rp.topY - rp.baseY) * t;
      for (const w of across) {
        const along =
          rp.up === '+x'
            ? rp.minX + s
            : rp.up === '-x'
              ? rp.maxX - s
              : rp.up === '+z'
                ? rp.minZ + s
                : rp.maxZ - s;
        if (alongX) pushCandidate(along, y, w, KIND_RAMP, -1);
        else pushCandidate(w, y, along, KIND_RAMP, -1);
      }
    }
  }

  const excluded = (x: number, y: number, z: number): boolean =>
    excludes.some(
      ([x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0]) =>
        x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1,
    );

  function findMerge(x: number, y: number, z: number): number {
    let best = -1;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = mergeHash.get(mergeKey(x + dx, z + dz));
        if (list === undefined) continue;
        for (const id of list) {
          const ex = (px[id] ?? 0) - x;
          const ez = (pz[id] ?? 0) - z;
          if (ex * ex + ez * ez > NAV_MERGE_XZ * NAV_MERGE_XZ) continue;
          if (Math.abs((py[id] ?? 0) - y) > NAV_MERGE_DY) continue;
          if (best < 0 || id < best) best = id;
        }
      }
    }
    return best;
  }

  function fitCandidate(k: number): void {
    const x = cx[k] ?? 0;
    const y = cy[k] ?? 0;
    const z = cz[k] ?? 0;
    const anchor = cAnchor[k] ?? -1;
    if (excluded(x, y, z)) return;
    pa.x = x;
    pa.y = y;
    pa.z = z;
    if (!world.capsuleFits(pa, agent)) return;
    const merged = findMerge(x, y, z);
    if (merged >= 0) {
      if (anchor >= 0) anchorNodeOf[anchor] = merged;
      return;
    }
    if (n >= NAV_MAX_NODES) {
      phase = 'failed';
      throw new StrikeZoneError('nav/node-budget', 'Nav graph exceeds the node budget', {
        max: NAV_MAX_NODES,
      });
    }
    const id = n++;
    px[id] = x;
    py[id] = y;
    pz[id] = z;
    nodeKind[id] = cKind[k] ?? KIND_GRID;
    if (anchor >= 0) {
      nodeAnchor[id] = anchor;
      anchorNodeOf[anchor] = id;
    }
    const key = mergeKey(x, z);
    const list = mergeHash.get(key);
    if (list === undefined) mergeHash.set(key, [id]);
    else list.push(id);
  }

  function walkable(i: number, j: number): boolean {
    pa.x = px[i] ?? 0;
    pa.y = py[i] ?? 0;
    pa.z = pz[i] ?? 0;
    pb.x = px[j] ?? 0;
    pb.y = py[j] ?? 0;
    pb.z = pz[j] ?? 0;
    return (
      world.sweepClear(pa, pb, agent, stepHeight) && world.sweepClear(pb, pa, agent, stepHeight)
    );
  }

  function linkNode(i: number): void {
    const h = linkHash;
    if (h === null) return;
    const isAnchor = nodeKind[i] === KIND_ANCHOR;
    const radius = isAnchor ? NAV_ANCHOR_LINK_FACTOR * linkRadius : linkRadius;
    const dyMax = radius * MAP_RULES.maxRampSlope + stepHeight;
    const x = px[i] ?? 0;
    const y = py[i] ?? 0;
    const z = pz[i] ?? 0;
    const span = Math.ceil(radius / h.cellSize);
    const hx = Math.floor((x - h.originX) / h.cellSize);
    const hz = Math.floor((z - h.originZ) / h.cellSize);
    const cand: [number, number][] = [];
    for (let qz = Math.max(0, hz - span); qz <= Math.min(h.nz - 1, hz + span); qz++) {
      for (let qx = Math.max(0, hx - span); qx <= Math.min(h.nx - 1, hx + span); qx++) {
        const c = qz * h.nx + qx;
        for (let q = h.cellStart[c] ?? 0; q < (h.cellStart[c + 1] ?? 0); q++) {
          const j = h.cellItems[q] ?? 0;
          if (j <= i) continue;
          const dx = (px[j] ?? 0) - x;
          const dz = (pz[j] ?? 0) - z;
          const dy = (py[j] ?? 0) - y;
          if (dx * dx + dz * dz > radius * radius || Math.abs(dy) > dyMax) continue;
          cand.push([Math.sqrt(dx * dx + dy * dy + dz * dz), j]);
        }
      }
    }
    cand.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    for (const [dist, j] of cand) {
      if ((deg[i] ?? 0) >= NAV_MAX_NEIGHBOURS) break;
      if ((deg[j] ?? 0) >= NAV_MAX_NEIGHBOURS) continue;
      if (!walkable(i, j)) continue;
      edgeA.push(i);
      edgeB.push(j);
      edgeCost.push(dist);
      deg[i] = (deg[i] ?? 0) + 1;
      deg[j] = (deg[j] ?? 0) + 1;
    }
  }

  function find(p: Int32Array, i: number): number {
    let root = i;
    while ((p[root] ?? root) !== root) root = p[root] ?? root;
    let cur = i;
    while (cur !== root) {
      const next = p[cur] ?? root;
      p[cur] = root;
      cur = next;
    }
    return root;
  }

  function unionBatch(batch: number): void {
    const p = parent;
    if (p === null) return;
    const end = Math.min(edgeA.length, (batch + 1) * UNION_BATCH);
    for (let e = batch * UNION_BATCH; e < end; e++) {
      const ra = find(p, edgeA[e] ?? 0);
      const rb = find(p, edgeB[e] ?? 0);
      // Union by lower root id keeps the result independent of edge order.
      if (ra < rb) p[rb] = ra;
      else if (rb < ra) p[ra] = rb;
    }
  }

  function finish(): NavGraph {
    const p = parent ?? new Int32Array(0);
    // Component ids in order of each component's lowest node id (BR-CN-66).
    const comp = new Int32Array(n);
    const label = new Int32Array(n).fill(-1);
    let components = 0;
    for (let i = 0; i < n; i++) {
      const root = find(p, i);
      if ((label[root] ?? -1) < 0) label[root] = components++;
      comp[i] = label[root] ?? 0;
    }
    // CSR, both directions, neighbours ascending.
    const edgeStart = new Int32Array(n + 1);
    for (let e = 0; e < edgeA.length; e++) {
      const a = (edgeA[e] ?? 0) + 1;
      const bb = (edgeB[e] ?? 0) + 1;
      edgeStart[a] = (edgeStart[a] ?? 0) + 1;
      edgeStart[bb] = (edgeStart[bb] ?? 0) + 1;
    }
    for (let i = 0; i < n; i++) edgeStart[i + 1] = (edgeStart[i + 1] ?? 0) + (edgeStart[i] ?? 0);
    const total = edgeStart[n] ?? 0;
    const pairs: [number, number, number][][] = Array.from({ length: n }, () => []);
    for (let e = 0; e < edgeA.length; e++) {
      const a = edgeA[e] ?? 0;
      const bb = edgeB[e] ?? 0;
      const c = edgeCost[e] ?? 0;
      pairs[a]?.push([bb, c, 0]);
      pairs[bb]?.push([a, c, 0]);
    }
    const edgeTo = new Int32Array(total);
    const cost = new Float64Array(total);
    for (let i = 0; i < n; i++) {
      const list = (pairs[i] ?? []).sort((u, w) => u[0] - w[0]);
      let at = edgeStart[i] ?? 0;
      for (const [to, c] of list) {
        edgeTo[at] = to;
        cost[at] = c;
        at++;
      }
    }
    const fx = px.slice(0, n);
    const fz = pz.slice(0, n);
    const tables: Record<AnchorList, Int32Array> = {
      spawns: new Int32Array(def.spawns.length).fill(-1),
      cover: new Int32Array(def.cover.length).fill(-1),
      navHints: new Int32Array(def.navHints.length).fill(-1),
    };
    anchors.forEach((a, k) => {
      tables[a.ref.list][a.ref.index] = anchorNodeOf[k] ?? -1;
    });
    const kinds: NavNodeKind[] = [];
    const anchorOfNode: (AnchorRef | null)[] = [];
    for (let i = 0; i < n; i++) {
      kinds.push(KIND_NAMES[nodeKind[i] ?? KIND_GRID] ?? 'grid');
      const k = nodeAnchor[i] ?? -1;
      anchorOfNode.push(
        k >= 0 ? Object.freeze({ ...(anchors[k]?.ref ?? { list: 'spawns', index: 0 }) }) : null,
      );
    }
    return createNavGraph({
      data: {
        n,
        px: fx,
        py: py.slice(0, n),
        pz: fz,
        comp,
        edgeStart,
        edgeTo,
        edgeCost: cost,
        hash: buildNodeHash(fx, fz, n, bounds, linkRadius),
        agent,
        stepHeight,
      },
      kinds,
      anchorOfNode,
      anchorTables: tables,
      componentCount: components,
      diagnostics,
    });
  }

  const unionItems = (): number => Math.ceil(edgeA.length / UNION_BATCH) + 1;

  function doOneItem(): void {
    switch (phase) {
      case 'candidates': {
        const src = sources[cursor];
        if (src !== undefined) emitSource(src);
        cursor++;
        if (cursor >= sources.length) {
          phase = 'fitting';
          cursor = 0;
        }
        return;
      }
      case 'fitting': {
        if (cursor < cx.length) fitCandidate(cursor);
        cursor++;
        if (cursor >= cx.length) {
          phase = 'linking';
          cursor = 0;
          linkHash = buildNodeHash(px, pz, n, bounds, linkRadius);
        }
        return;
      }
      case 'linking': {
        if (cursor < n) linkNode(cursor);
        cursor++;
        if (cursor >= n) {
          phase = 'components';
          cursor = 0;
          parent = new Int32Array(n);
          for (let i = 0; i < n; i++) parent[i] = i;
        }
        return;
      }
      case 'components': {
        if (cursor < unionItems() - 1) {
          unionBatch(cursor);
          cursor++;
          return;
        }
        graph = finish();
        phase = 'done';
        cursor = 0;
        return;
      }
      case 'done':
      case 'failed':
        return;
    }
  }

  function phaseTotal(): number {
    switch (phase) {
      case 'candidates':
        return sources.length;
      case 'fitting':
        return cx.length;
      case 'linking':
        return n;
      case 'components':
        return unionItems();
      default:
        return 1;
    }
  }

  const baker: NavBaker = {
    step(budgetMs, now) {
      if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
        throw new StrikeZoneError('nav/bad-step-budget', 'step budget must be finite and > 0', {
          budgetMs,
        });
      }
      if (phase === 'failed') {
        throw new StrikeZoneError('nav/node-budget', 'Nav graph exceeds the node budget', {
          max: NAV_MAX_NODES,
        });
      }
      if (phase === 'done') return true;
      const t0 = now();
      let items = 0;
      do {
        doOneItem();
        items++;
      } while (
        (phase as NavBakePhase) !== 'done' &&
        (items % BAKE_CLOCK_EVERY !== 0 || now() - t0 < budgetMs)
      );
      return (phase as NavBakePhase) === 'done';
    },
    progress() {
      if (phase === 'done') return 1;
      if (phase === 'failed') return 0;
      const order = ['candidates', 'fitting', 'linking', 'components'] as const;
      let done = 0;
      for (const p of order) {
        if (p === phase) break;
        done += PHASE_WEIGHTS[p];
      }
      const total = phaseTotal();
      const frac = total > 0 ? Math.min(cursor / total, 1) : 0;
      return Math.min(done + PHASE_WEIGHTS[phase] * frac, 0.999999);
    },
    get phase() {
      return phase;
    },
    result() {
      if (phase === 'failed') {
        throw new StrikeZoneError('nav/node-budget', 'Nav graph exceeds the node budget', {
          max: NAV_MAX_NODES,
        });
      }
      if (graph === null) {
        throw new StrikeZoneError('nav/bake-incomplete', 'result() called before the bake is done');
      }
      return graph;
    },
  };
  return Object.freeze(baker);
}

/** Synchronous bake for tests and tools: steps with an unbounded budget. */
export function bakeNavGraph(
  def: MapDefinition,
  world: CollisionWorld,
  opts: NavBakeOptions,
): NavGraph {
  const baker = createNavBaker(def, world, opts);
  while (!baker.step(1e9, () => 0)) {
    // the first call finishes; the loop guards against a future budget change
  }
  return baker.result();
}
