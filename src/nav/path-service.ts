/**
 * PathService (LC-CN-08, business-logic-model-collision-nav §7). Requests are
 * queued and served by tick(): at most maxPathsPerTick searches and 16 cache
 * hits per call. One live ticket per entity; a released or unknown ticket
 * polls as NO_PATH. Created per round by game-simulation.
 */
import { err, StrikeZoneError, vec3, type EntityId, type Vec3 } from '../core';
import type { CollisionWorld } from '../physics';
import { createAStar, type AvoidZone } from './astar';
import {
  ATTACH_CANDIDATES,
  ATTACH_RADIUS,
  CACHE_SIZE,
  MAX_CACHE_HITS_PER_TICK,
  MAX_CACHED_PATH,
  MAX_PATHS_PER_TICK,
  MAX_PATHS_PER_TICK_LIMIT,
  MAX_QUEUE,
  PULL_LOOKAHEAD,
} from './constants';
import { NOOP_DIAGNOSTICS } from './diagnostics';
import { graphData, nearestNodes, type GraphData } from './graph';
import type {
  NavGraph,
  PathRequest,
  PathResult,
  PathService,
  PathServiceOptions,
  PathServiceStats,
  PathTicket,
} from './types';

const ERR_NO_PATH: PathResult = Object.freeze(err('NO_PATH' as const));
const ERR_OFF_GRAPH: PathResult = Object.freeze(err('OFF_GRAPH' as const));

const FREE = 0;
const QUEUED = 1;
const RESOLVED = 2;

interface Slot {
  state: number;
  ticketId: number;
  entity: number;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  bad: boolean;
  avoid: AvoidZone;
  /** -2 = not attached yet, -1 = failed, >= 0 node id. */
  startNode: number;
  endNode: number;
  result: PathResult;
  readonly points: Vec3[];
  readonly view: Vec3[];
  readonly ok: PathResult;
}

function makeSlot(): Slot {
  const view: Vec3[] = [];
  return {
    state: FREE,
    ticketId: 0,
    entity: -1,
    fx: 0,
    fy: 0,
    fz: 0,
    tx: 0,
    ty: 0,
    tz: 0,
    bad: false,
    avoid: { active: false, x: 0, z: 0, radius: 0, penalty: 0 },
    startNode: -2,
    endNode: -2,
    result: ERR_NO_PATH,
    points: [],
    view,
    ok: Object.freeze({ ok: true as const, value: view }),
  };
}

const finite3 = (v: Vec3): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

function checkInt(name: string, value: number, lo: number, hi: number): number {
  if (!Number.isInteger(value) || value < lo || value > hi) {
    throw new StrikeZoneError('nav/invalid-options', `${name} must be an integer in ${lo}..${hi}`, {
      value,
    });
  }
  return value;
}

export function createPathService(
  graph: NavGraph,
  world: CollisionWorld,
  opts: PathServiceOptions = {},
): PathService {
  const maxPaths = checkInt(
    'maxPathsPerTick',
    opts.maxPathsPerTick ?? MAX_PATHS_PER_TICK,
    1,
    MAX_PATHS_PER_TICK_LIMIT,
  );
  const cacheSize = checkInt('cacheSize', opts.cacheSize ?? CACHE_SIZE, 1, 256);
  const diagnostics = opts.diagnostics ?? NOOP_DIAGNOSTICS;
  const data = graphData(graph);
  if (data === undefined) {
    throw new StrikeZoneError('nav/invalid-options', 'graph was not produced by the nav baker');
  }
  const d: GraphData = data;
  const astar = createAStar(d);

  const slots: Slot[] = Array.from({ length: MAX_QUEUE }, makeSlot);
  const entitySlot = new Map<number, number>();
  // FIFO of slot indices; stale entries (released tickets) are skipped.
  const RING = MAX_QUEUE * 2;
  const ringSlot = new Int32Array(RING);
  const ringTicket = new Float64Array(RING);
  let head = 0;
  let count = 0;
  let queuedLive = 0;
  let nextTicket = 0;

  // Cache: index-based LRU over typed arrays (SD-CN-11).
  const cValid = new Uint8Array(cacheSize);
  const cStart = new Int32Array(cacheSize);
  const cEnd = new Int32Array(cacheSize);
  const cKey = new Float64Array(cacheSize * 5);
  const cUsed = new Float64Array(cacheSize);
  const cLen = new Int32Array(cacheSize);
  const cPath = new Int32Array(cacheSize * MAX_CACHED_PATH);
  let useClock = 0;
  const key = new Float64Array(5);

  // String-pull scratch: [from, nodes..., to].
  const sx = new Float64Array(d.n + 2);
  const sy = new Float64Array(d.n + 2);
  const sz = new Float64Array(d.n + 2);
  const nodePath = new Int32Array(Math.max(1, d.n));
  const ids = new Int32Array(ATTACH_CANDIDATES);
  const scores = new Float64Array(ATTACH_CANDIDATES);
  const va = vec3();
  const vb = vec3();

  const stats = { solved: 0, cacheHits: 0, queued: 0, dropped: 0 };

  function release(index: number): void {
    const s = slots[index];
    if (s === undefined) return;
    if (s.state === QUEUED) queuedLive--;
    entitySlot.delete(s.entity);
    s.state = FREE;
    s.ticketId = 0;
    s.entity = -1;
    s.result = ERR_NO_PATH;
  }

  function compactRing(): void {
    let w = 0;
    for (let k = 0; k < count; k++) {
      const at = (head + k) % RING;
      const si = ringSlot[at] ?? 0;
      const tid = ringTicket[at] ?? 0;
      const s = slots[si];
      if (s?.state !== QUEUED || s.ticketId !== tid) continue;
      const to = (head + w) % RING;
      ringSlot[to] = si;
      ringTicket[to] = tid;
      w++;
    }
    count = w;
  }

  function sweep(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    va.x = ax;
    va.y = ay;
    va.z = az;
    vb.x = bx;
    vb.y = by;
    vb.z = bz;
    return world.sweepClear(va, vb, d.agent, d.stepHeight);
  }

  /** BR-CN-71: first of the 4 nearest nodes within 3 m that the point walks to (or from). */
  function attach(x: number, y: number, z: number, toNode: boolean): number {
    const found = nearestNodes(d, x, y, z, ATTACH_RADIUS, ATTACH_CANDIDATES, ids, scores);
    for (let k = 0; k < found; k++) {
      const id = ids[k] ?? 0;
      const nx = d.px[id] ?? 0;
      const ny = d.py[id] ?? 0;
      const nz = d.pz[id] ?? 0;
      const okWalk = toNode ? sweep(x, y, z, nx, ny, nz) : sweep(nx, ny, nz, x, y, z);
      if (okWalk) return id;
    }
    return -1;
  }

  function fillKey(s: Slot): void {
    key[0] = s.startNode;
    key[1] = s.endNode;
    if (s.avoid.active) {
      key[2] = Math.round(s.avoid.x);
      key[3] = Math.round(s.avoid.z) * 4096 + Math.round(s.avoid.radius);
      key[4] = Math.round(s.avoid.penalty * 10);
    } else {
      key[2] = NaN;
      key[3] = 0;
      key[4] = 0;
    }
  }

  function cacheFind(): number {
    for (let e = 0; e < cacheSize; e++) {
      if (cValid[e] !== 1) continue;
      if (cStart[e] !== key[0] || cEnd[e] !== key[1]) continue;
      const b = e * 5;
      const k2 = key[2] ?? 0;
      const c2 = cKey[b + 2] ?? 0;
      const sameAvoid = Number.isNaN(k2) ? Number.isNaN(c2) : c2 === k2;
      if (sameAvoid && cKey[b + 3] === key[3] && cKey[b + 4] === key[4]) return e;
    }
    return -1;
  }

  function cacheStore(len: number): void {
    if (len > MAX_CACHED_PATH) return;
    let slot = -1;
    let oldest = Infinity;
    for (let e = 0; e < cacheSize; e++) {
      if (cValid[e] !== 1) {
        slot = e;
        break;
      }
      const used = cUsed[e] ?? 0;
      if (used < oldest) {
        oldest = used;
        slot = e;
      }
    }
    if (slot < 0) return;
    cValid[slot] = 1;
    cStart[slot] = key[0] ?? 0;
    cEnd[slot] = key[1] ?? 0;
    for (let k = 0; k < 5; k++) cKey[slot * 5 + k] = key[k] ?? 0;
    cUsed[slot] = ++useClock;
    cLen[slot] = len;
    cPath.set(nodePath.subarray(0, len), slot * MAX_CACHED_PATH);
  }

  /** Squared xz distance from point k of the pull list to the avoid centre. */
  function avoidDist2(av: AvoidZone, k: number): number {
    const dx = (sx[k] ?? 0) - av.x;
    const dz = (sz[k] ?? 0) - av.z;
    return dx * dx + dz * dz;
  }

  /**
   * A shortcut cur -> j keeps out of an active avoid zone unless the A* route
   * between them already entered it, so pulling never undoes the detour.
   */
  function respectsAvoid(av: AvoidZone, cur: number, j: number): boolean {
    if (!av.active) return true;
    const r2 = av.radius * av.radius;
    for (let k = cur; k <= j; k++) if (avoidDist2(av, k) < r2) return true;
    const ax = sx[cur] ?? 0;
    const az = sz[cur] ?? 0;
    const ex = (sx[j] ?? 0) - ax;
    const ez = (sz[j] ?? 0) - az;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((av.x - ax) * ex + (av.z - az) * ez) / l2)) : 0;
    const qx = ax + ex * t - av.x;
    const qz = az + ez * t - av.z;
    return qx * qx + qz * qz >= r2;
  }

  /** BR-CN-75: string pull [from, nodes..., to] into the slot's waypoint view. */
  function pull(s: Slot, len: number): void {
    sx[0] = s.fx;
    sy[0] = s.fy;
    sz[0] = s.fz;
    for (let k = 0; k < len; k++) {
      const id = nodePath[k] ?? 0;
      sx[k + 1] = d.px[id] ?? 0;
      sy[k + 1] = d.py[id] ?? 0;
      sz[k + 1] = d.pz[id] ?? 0;
    }
    const last = len + 1;
    sx[last] = s.tx;
    sy[last] = s.ty;
    sz[last] = s.tz;
    let out = 0;
    let cur = 0;
    while (cur < last) {
      let best = cur + 1;
      for (let j = Math.min(cur + PULL_LOOKAHEAD, last); j > cur + 1; j--) {
        if (
          respectsAvoid(s.avoid, cur, j) &&
          sweep(sx[cur] ?? 0, sy[cur] ?? 0, sz[cur] ?? 0, sx[j] ?? 0, sy[j] ?? 0, sz[j] ?? 0)
        ) {
          best = j;
          break;
        }
      }
      let p = s.points[out];
      if (p === undefined) {
        p = vec3();
        s.points.push(p);
      }
      p.x = sx[best] ?? 0;
      p.y = sy[best] ?? 0;
      p.z = sz[best] ?? 0;
      s.view[out] = p;
      out++;
      cur = best;
    }
    s.view.length = out;
    s.result = s.ok;
  }

  /** Serves one queued slot. Returns 'search', 'hit' or 'blocked' (budget). */
  function serve(s: Slot, searchesLeft: boolean, hitsLeft: boolean): 'search' | 'hit' | 'blocked' {
    if (s.bad || d.n === 0) {
      if (!searchesLeft) return 'blocked';
      s.result = ERR_OFF_GRAPH;
      return 'search';
    }
    if (s.startNode === -2) {
      s.startNode = attach(s.fx, s.fy, s.fz, true); // walk from -> node
      s.endNode = attach(s.tx, s.ty, s.tz, false); // walk node -> to
    }
    if (s.startNode < 0 || s.endNode < 0) {
      if (!searchesLeft) return 'blocked';
      s.result = ERR_OFF_GRAPH;
      return 'search';
    }
    if (d.comp[s.startNode] !== d.comp[s.endNode]) {
      if (!searchesLeft) return 'blocked';
      s.result = ERR_NO_PATH;
      return 'search';
    }
    fillKey(s);
    const hit = cacheFind();
    if (hit >= 0) {
      if (!hitsLeft) return 'blocked';
      cUsed[hit] = ++useClock;
      const len = cLen[hit] ?? 0;
      nodePath.set(cPath.subarray(hit * MAX_CACHED_PATH, hit * MAX_CACHED_PATH + len));
      pull(s, len);
      return 'hit';
    }
    if (!searchesLeft) return 'blocked';
    const len = astar.search(s.startNode, s.endNode, s.avoid);
    if (len === 0) {
      s.result = ERR_NO_PATH;
      return 'search';
    }
    nodePath.set(astar.path.subarray(0, len));
    cacheStore(len);
    pull(s, len);
    return 'search';
  }

  const service: PathService = {
    request(id: EntityId, req: PathRequest): PathTicket {
      const ticket: PathTicket = Object.freeze({ id: ++nextTicket, entity: id });
      const previous = entitySlot.get(id);
      if (previous !== undefined) release(previous);
      let index = -1;
      if (queuedLive < MAX_QUEUE) index = slots.findIndex((s) => s.state === FREE);
      const s = index >= 0 ? slots[index] : undefined;
      if (s === undefined) {
        stats.dropped++;
        diagnostics.warnOnce('nav/queue-full');
        return ticket;
      }
      s.state = QUEUED;
      s.ticketId = ticket.id;
      s.entity = id;
      s.startNode = -2;
      s.endNode = -2;
      s.result = ERR_NO_PATH;
      s.bad = !finite3(req.from) || !finite3(req.to);
      if (s.bad) diagnostics.warnOnce('nav/non-finite-input');
      s.fx = req.from.x;
      s.fy = req.from.y;
      s.fz = req.from.z;
      s.tx = req.to.x;
      s.ty = req.to.y;
      s.tz = req.to.z;
      const av = req.avoid;
      s.avoid.active = false;
      if (av !== undefined) {
        const valid =
          finite3(av.center) &&
          Number.isFinite(av.radius) &&
          av.radius > 0 &&
          Number.isFinite(av.penalty) &&
          av.penalty >= 0;
        if (valid) {
          s.avoid.active = true;
          s.avoid.x = av.center.x;
          s.avoid.z = av.center.z;
          s.avoid.radius = av.radius;
          s.avoid.penalty = av.penalty;
        } else {
          diagnostics.warnOnce('nav/bad-avoid');
        }
      }
      entitySlot.set(id, index);
      queuedLive++;
      if (count >= RING) compactRing();
      const at = (head + count) % RING;
      ringSlot[at] = index;
      ringTicket[at] = ticket.id;
      count++;
      return ticket;
    },

    poll(t) {
      const index = entitySlot.get(t.entity);
      const s = index === undefined ? undefined : slots[index];
      if (s?.ticketId !== t.id) return ERR_NO_PATH;
      return s.state === QUEUED ? 'pending' : s.result;
    },

    cancel(t) {
      const index = entitySlot.get(t.entity);
      if (index === undefined) return;
      if (slots[index]?.ticketId === t.id) release(index);
    },

    tick() {
      let searches = 0;
      let hits = 0;
      while (count > 0) {
        const si = ringSlot[head] ?? 0;
        const tid = ringTicket[head] ?? 0;
        const s = slots[si];
        if (s?.state !== QUEUED || s.ticketId !== tid) {
          head = (head + 1) % RING;
          count--;
          continue;
        }
        const outcome = serve(s, searches < maxPaths, hits < MAX_CACHE_HITS_PER_TICK);
        if (outcome === 'blocked') break;
        if (outcome === 'hit') {
          hits++;
          stats.cacheHits++;
        } else {
          searches++;
          stats.solved++;
        }
        s.state = RESOLVED;
        queuedLive--;
        head = (head + 1) % RING;
        count--;
      }
    },

    get stats(): PathServiceStats {
      stats.queued = queuedLive;
      return stats;
    },
  };
  return Object.freeze(service);
}
