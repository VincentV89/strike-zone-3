/**
 * NavGraph (LC-CN-07): immutable node positions, CSR links, component ids,
 * an anchor table and a node spatial hash. The typed arrays are private; the
 * path service reaches them through graphData(), which index.ts does not
 * export.
 */
import { vec3, type Diagnostics, type Vec3 } from '../core';
import type { Capsule } from '../physics';
import { NEAREST_DY, NEAREST_RADIUS } from './constants';
import type { AnchorList, AnchorRef, NavGraph, NavNode, NavNodeId, NavNodeKind } from './types';

export interface NodeHash {
  readonly originX: number;
  readonly originZ: number;
  readonly cellSize: number;
  readonly nx: number;
  readonly nz: number;
  readonly cellStart: Int32Array;
  readonly cellItems: Int32Array;
}

export interface GraphData {
  readonly n: number;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pz: Float64Array;
  readonly comp: Int32Array;
  readonly edgeStart: Int32Array;
  readonly edgeTo: Int32Array;
  readonly edgeCost: Float64Array;
  readonly hash: NodeHash;
  readonly agent: Capsule;
  readonly stepHeight: number;
}

const DATA = new WeakMap<NavGraph, GraphData>();

/** Internal accessor for the path service. */
export function graphData(graph: NavGraph): GraphData | undefined {
  return DATA.get(graph);
}

const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** CSR spatial hash of n points over the xz rectangle starting at (originX, originZ). */
export function buildNodeHash(
  px: Float64Array,
  pz: Float64Array,
  n: number,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  cellSize: number,
): NodeHash {
  const nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
  const nz = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize));
  const cellOf = (i: number): number =>
    clampInt(Math.floor(((pz[i] ?? 0) - bounds.minZ) / cellSize), 0, nz - 1) * nx +
    clampInt(Math.floor(((px[i] ?? 0) - bounds.minX) / cellSize), 0, nx - 1);
  const cellStart = new Int32Array(nx * nz + 1);
  for (let i = 0; i < n; i++) {
    const c = cellOf(i) + 1;
    cellStart[c] = (cellStart[c] ?? 0) + 1;
  }
  for (let c = 0; c < nx * nz; c++)
    cellStart[c + 1] = (cellStart[c + 1] ?? 0) + (cellStart[c] ?? 0);
  const fill = new Int32Array(nx * nz);
  const cellItems = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = cellOf(i);
    cellItems[(cellStart[c] ?? 0) + (fill[c] ?? 0)] = i;
    fill[c] = (fill[c] ?? 0) + 1;
  }
  return { originX: bounds.minX, originZ: bounds.minZ, cellSize, nx, nz, cellStart, cellItems };
}

/**
 * The k best nodes for point (x, y, z) by dxz^2 + (2 dy)^2, within `radius`
 * horizontally and NEAREST_DY vertically, ties to the lower id (BR-CN-70).
 * Writes ids into outIds (sorted best first) and returns the count.
 */
export function nearestNodes(
  d: GraphData,
  x: number,
  y: number,
  z: number,
  radius: number,
  k: number,
  outIds: Int32Array,
  outScore: Float64Array,
): number {
  const h = d.hash;
  const cx0 = clampInt(Math.floor((x - radius - h.originX) / h.cellSize), 0, h.nx - 1);
  const cx1 = clampInt(Math.floor((x + radius - h.originX) / h.cellSize), 0, h.nx - 1);
  const cz0 = clampInt(Math.floor((z - radius - h.originZ) / h.cellSize), 0, h.nz - 1);
  const cz1 = clampInt(Math.floor((z + radius - h.originZ) / h.cellSize), 0, h.nz - 1);
  const r2 = radius * radius;
  let count = 0;
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cz * h.nx + cx;
      const end = h.cellStart[c + 1] ?? 0;
      for (let q = h.cellStart[c] ?? 0; q < end; q++) {
        const id = h.cellItems[q] ?? 0;
        const dx = (d.px[id] ?? 0) - x;
        const dz = (d.pz[id] ?? 0) - z;
        const dy = (d.py[id] ?? 0) - y;
        const dxz2 = dx * dx + dz * dz;
        if (dxz2 > r2 || Math.abs(dy) > NEAREST_DY) continue;
        const score = dxz2 + 4 * dy * dy;
        // Insertion into the sorted top-k list.
        let pos = count < k ? count : k;
        while (pos > 0) {
          const ps = outScore[pos - 1] ?? 0;
          const pid = outIds[pos - 1] ?? 0;
          if (ps < score || (ps === score && pid < id)) break;
          pos--;
        }
        if (pos >= k) continue;
        const last = Math.min(count, k - 1);
        for (let m = last; m > pos; m--) {
          outIds[m] = outIds[m - 1] ?? 0;
          outScore[m] = outScore[m - 1] ?? 0;
        }
        outIds[pos] = id;
        outScore[pos] = score;
        if (count < k) count++;
      }
    }
  }
  return count;
}

export interface GraphParts {
  readonly data: GraphData;
  readonly kinds: readonly NavNodeKind[];
  readonly anchorOfNode: readonly (AnchorRef | null)[];
  readonly anchorTables: Readonly<Record<AnchorList, Int32Array>>;
  readonly componentCount: number;
  readonly diagnostics: Diagnostics;
}

const EMPTY: readonly NavNodeId[] = Object.freeze([]);

export function createNavGraph(parts: GraphParts): NavGraph {
  const { data, diagnostics } = parts;
  const n = data.n;
  const nodes: NavNode[] = [];
  const neighbourLists: (readonly NavNodeId[])[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push(
      Object.freeze({
        id: i,
        pos: Object.freeze(vec3(data.px[i] ?? 0, data.py[i] ?? 0, data.pz[i] ?? 0)),
        kind: parts.kinds[i] ?? 'grid',
        component: data.comp[i] ?? 0,
        anchor: parts.anchorOfNode[i] ?? null,
      }),
    );
    const list: NavNodeId[] = [];
    for (let e = data.edgeStart[i] ?? 0; e < (data.edgeStart[i + 1] ?? 0); e++) {
      list.push(data.edgeTo[e] ?? 0);
    }
    neighbourLists.push(Object.freeze(list));
  }
  Object.freeze(nodes);
  const ids = new Int32Array(1);
  const scores = new Float64Array(1);
  const validId = (id: number): boolean => Number.isInteger(id) && id >= 0 && id < n;

  const graph: NavGraph = {
    nodes,
    nearestNode(p: Vec3): NavNodeId | null {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
        diagnostics.warnOnce('nav/non-finite-input');
        return null;
      }
      const found = nearestNodes(data, p.x, p.y, p.z, NEAREST_RADIUS, 1, ids, scores);
      return found > 0 ? (ids[0] ?? null) : null;
    },
    reachable(a, b) {
      if (!validId(a) || !validId(b)) {
        diagnostics.warnOnce('nav/bad-node-id');
        return false;
      }
      return data.comp[a] === data.comp[b];
    },
    neighbours(id) {
      if (!validId(id)) {
        diagnostics.warnOnce('nav/bad-node-id');
        return EMPTY;
      }
      return neighbourLists[id] ?? EMPTY;
    },
    anchorNode(list, index) {
      const table = Object.hasOwn(parts.anchorTables, list) ? parts.anchorTables[list] : undefined;
      if (table === undefined || !Number.isInteger(index) || index < 0 || index >= table.length) {
        return null;
      }
      const node = table[index] ?? -1;
      return node >= 0 ? node : null;
    },
    componentCount: parts.componentCount,
    edgeCount: (data.edgeStart[n] ?? 0) / 2,
  };
  Object.freeze(graph);
  DATA.set(graph, data);
  return graph;
}
