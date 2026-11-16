/**
 * A* over the nav graph (BR-CN-73, BR-CN-74). Preallocated arrays sized to
 * the node count with a generation stamp, an indexed binary heap keyed on
 * (f, node id), and an inline avoid-zone penalty. Allocates nothing per search.
 */
import type { GraphData } from './graph';

export interface AvoidZone {
  active: boolean;
  x: number;
  z: number;
  radius: number;
  penalty: number;
}

export interface AStar {
  /** Node ids from start to goal written by search(); length is the return value. */
  readonly path: Int32Array;
  search(start: number, goal: number, avoid: AvoidZone): number;
}

export function createAStar(d: GraphData): AStar {
  const n = d.n;
  const g = new Float64Array(n);
  const f = new Float64Array(n);
  const parent = new Int32Array(n);
  const seen = new Uint32Array(n);
  const closed = new Uint32Array(n);
  const heap = new Int32Array(n);
  const heapPos = new Int32Array(n);
  const path = new Int32Array(n);
  let gen = 0;
  let size = 0;

  const less = (a: number, b: number): boolean => {
    const fa = f[a] ?? 0;
    const fb = f[b] ?? 0;
    return fa < fb || (fa === fb && a < b);
  };
  const place = (i: number, node: number): void => {
    heap[i] = node;
    heapPos[node] = i;
  };
  const up = (start: number): void => {
    let i = start;
    const node = heap[i] ?? 0;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pn = heap[p] ?? 0;
      if (!less(node, pn)) break;
      place(i, pn);
      i = p;
    }
    place(i, node);
  };
  const down = (start: number): void => {
    let i = start;
    const node = heap[i] ?? 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= size) break;
      const rgt = l + 1;
      const c = rgt < size && less(heap[rgt] ?? 0, heap[l] ?? 0) ? rgt : l;
      const cn = heap[c] ?? 0;
      if (!less(cn, node)) break;
      place(i, cn);
      i = c;
    }
    place(i, node);
  };
  const h = (a: number, goal: number): number => {
    const dx = (d.px[a] ?? 0) - (d.px[goal] ?? 0);
    const dy = (d.py[a] ?? 0) - (d.py[goal] ?? 0);
    const dz = (d.pz[a] ?? 0) - (d.pz[goal] ?? 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  function search(start: number, goal: number, avoid: AvoidZone): number {
    gen++;
    if (gen >= 0xffffffff) {
      seen.fill(0);
      closed.fill(0);
      gen = 1;
    }
    size = 0;
    g[start] = 0;
    f[start] = h(start, goal);
    parent[start] = -1;
    seen[start] = gen;
    place(0, start);
    size = 1;
    const r2 = avoid.radius * avoid.radius;
    while (size > 0) {
      const cur = heap[0] ?? 0;
      size--;
      if (size > 0) {
        place(0, heap[size] ?? 0);
        down(0);
      }
      if (cur === goal) {
        let len = 0;
        for (let v = goal; v >= 0; v = parent[v] ?? -1) path[len++] = v;
        path.subarray(0, len).reverse();
        return len;
      }
      closed[cur] = gen;
      const gc = g[cur] ?? 0;
      const end = d.edgeStart[cur + 1] ?? 0;
      for (let e = d.edgeStart[cur] ?? 0; e < end; e++) {
        const nb = d.edgeTo[e] ?? 0;
        if (closed[nb] === gen) continue;
        let cost = d.edgeCost[e] ?? 0;
        if (avoid.active) {
          const mx = ((d.px[cur] ?? 0) + (d.px[nb] ?? 0)) / 2 - avoid.x;
          const mz = ((d.pz[cur] ?? 0) + (d.pz[nb] ?? 0)) / 2 - avoid.z;
          if (mx * mx + mz * mz <= r2) cost += avoid.penalty * cost;
        }
        const ng = gc + cost;
        if (seen[nb] === gen && ng >= (g[nb] ?? 0)) continue;
        g[nb] = ng;
        f[nb] = ng + h(nb, goal);
        parent[nb] = cur;
        if (seen[nb] !== gen) {
          seen[nb] = gen;
          place(size, nb);
          size++;
          up(size - 1);
        } else {
          up(heapPos[nb] ?? 0);
        }
      }
    }
    return 0;
  }

  return { path, search };
}
