/**
 * Recording fakes for app-shell tests: a GameRenderer, a PointerLockPort, an
 * AudioFeature, a Hud and a manual rAF. No DOM is needed for these, so the
 * Node tests and the happy-dom tests share them.
 */
import { createDiagnostics, createProfiler, ok, type Diagnostics } from '../../src/core';
import type { SettingsIntent, SimEvent, UiIntent } from '../../src/contracts';
import type { AudioFeature, ListenerPose } from '../../src/app/features';
import type { PointerLockPort } from '../../src/app/ports';
import type { RequestFrame } from '../../src/app/frame-loop';
import type { GameRenderer, RenderStats } from '../../src/render';
import type { Hud, HudViewModel } from '../../src/ui/hud';

export interface FakeRenderer extends GameRenderer {
  calls: string[];
  renders: number;
  lastAlpha: number;
  lastEventCount: number;
  live: { geometries: number; textures: number };
  failNext: Partial<Record<'buildMap' | 'precompile' | 'applyAssets', boolean>>;
  /** When set, loadAssets waits for it (asset-step timing tests). */
  assetsGate: Promise<void> | null;
  initResult: 'ok' | 'NO_WEBGL2';
  throwOnRender: boolean;
  loseContext(): void;
  restoreContext(): void;
}

export function fakeRenderer(): FakeRenderer {
  const lost = new Set<() => void>();
  const restored = new Set<() => void>();
  const stats: RenderStats = {
    drawCalls: 0,
    worldDrawCalls: 0,
    vmDrawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    shadowLights: 0,
    shadowCasters: 0,
    activeFlashes: 0,
    activeTracers: 0,
    activeImpacts: 0,
    activeParticles: 0,
    frameFaults: 0,
    contextLost: false,
    shadowOnlyCalls: 0,
    textureBytesEstimate: 0,
    dressingInstances: 0,
    dressingBatches: 0,
    skinnedBots: 0,
    assetFallbacks: 0,
    envActive: false,
    textureFormats: [],
  };
  const r: FakeRenderer = {
    calls: [],
    renders: 0,
    lastAlpha: -1,
    lastEventCount: 0,
    live: { geometries: 0, textures: 0 },
    failNext: {},
    assetsGate: null,
    initResult: 'ok',
    throwOnRender: false,
    init() {
      r.calls.push('init');
      return r.initResult === 'ok' ? ok(undefined) : { ok: false, error: 'NO_WEBGL2' };
    },
    buildMap() {
      r.calls.push('buildMap');
      if (r.failNext.buildMap === true) {
        r.failNext.buildMap = false;
        return Promise.reject(new Error('build failed'));
      }
      r.live = { geometries: 12, textures: 6 };
      return Promise.resolve();
    },
    async loadAssets() {
      r.calls.push('loadAssets');
      if (r.assetsGate !== null) await r.assetsGate;
      return { requested: 0, loaded: 0, failed: [], aborted: 0, bytes: 0 };
    },
    applyAssets() {
      r.calls.push('applyAssets');
      if (r.failNext.applyAssets === true) {
        r.failNext.applyAssets = false;
        throw new Error('apply failed');
      }
    },
    spawnActors(n) {
      r.calls.push(`spawnActors:${String(n)}`);
    },
    precompile() {
      r.calls.push('precompile');
      if (r.failNext.precompile === true) {
        r.failNext.precompile = false;
        return Promise.reject(new Error('compile failed'));
      }
      return Promise.resolve();
    },
    render(_prev, _curr, alpha, events) {
      if (r.throwOnRender) throw new Error('render fault');
      r.renders += 1;
      r.lastAlpha = alpha;
      r.lastEventCount = events.length;
    },
    setPreset(p) {
      r.calls.push(`setPreset:${p}`);
    },
    setFov(d) {
      r.calls.push(`setFov:${String(d)}`);
    },
    resize(w, h) {
      r.calls.push(`resize:${String(w)}x${String(h)}`);
    },
    onContextLost(cb) {
      lost.add(cb);
      return () => lost.delete(cb);
    },
    onContextRestored(cb) {
      restored.add(cb);
      return () => restored.delete(cb);
    },
    disposeRound() {
      r.calls.push('disposeRound');
      r.live = { geometries: 0, textures: 0 };
    },
    stats() {
      stats.geometries = r.live.geometries;
      stats.textures = r.live.textures;
      return stats;
    },
    loseContext() {
      for (const cb of lost) cb();
    },
    restoreContext() {
      for (const cb of restored) cb();
    },
  };
  return r;
}

export interface FakeLock extends PointerLockPort {
  requests: number;
  exits: number;
  locked: boolean;
  /** 'grant' answers at once, 'refuse' refuses, 'manual' leaves the request pending. */
  mode: 'grant' | 'refuse' | 'manual';
  /** Depth counter set by the test's dispatch wrapper; records whether each request ran in a handler. */
  inHandler: () => boolean;
  requestsOutsideHandler: number;
  grant(): void;
  refuse(): void;
  /** The browser releases the lock (Esc). */
  lose(): void;
}

export function fakeLock(): FakeLock {
  const listeners = new Set<(locked: boolean) => void>();
  let pending:
    ((r: { ok: true; value: undefined } | { ok: false; error: 'REFUSED' }) => void) | null = null;
  const notify = (): void => {
    for (const cb of [...listeners]) cb(l.locked);
  };
  const l: FakeLock = {
    requests: 0,
    exits: 0,
    locked: false,
    mode: 'grant',
    inHandler: () => true,
    requestsOutsideHandler: 0,
    request() {
      l.requests += 1;
      if (!l.inHandler()) l.requestsOutsideHandler += 1;
      return new Promise((resolve) => {
        pending = resolve;
        if (l.mode === 'grant') l.grant();
        else if (l.mode === 'refuse') l.refuse();
      });
    },
    exit() {
      l.exits += 1;
      if (!l.locked) return;
      l.locked = false;
      notify();
    },
    isLocked: () => l.locked,
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    grant() {
      const p = pending;
      pending = null;
      l.locked = true;
      notify();
      p?.(ok(undefined));
    },
    refuse() {
      const p = pending;
      pending = null;
      p?.({ ok: false, error: 'REFUSED' });
    },
    lose() {
      if (!l.locked) return;
      l.locked = false;
      notify();
    },
  };
  return l;
}

export interface FakeAudio extends AudioFeature {
  log: string[];
  plays: number;
  lastPose: ListenerPose | null;
  poses: Set<ListenerPose>;
  cues: (UiIntent | SettingsIntent)['type'][];
}

export function fakeAudio(supported = true): FakeAudio {
  const a: FakeAudio = {
    supported,
    log: [],
    plays: 0,
    lastPose: null,
    poses: new Set(),
    cues: [],
    unlock() {
      a.log.push('unlock');
    },
    play(_events: readonly SimEvent[], pose) {
      a.plays += 1;
      a.lastPose = pose;
      a.poses.add(pose);
    },
    cue(intent) {
      a.cues.push(intent.type);
    },
    error() {
      a.log.push('error');
    },
    setVolumes(m, s) {
      a.log.push(`volumes:${String(m)}/${String(s)}`);
    },
    suspend() {
      a.log.push('suspend');
    },
    dispose() {
      a.log.push('dispose');
    },
  };
  return a;
}

export interface FakeHud extends Hud {
  log: string[];
  updates: number;
  feeds: number;
  resets: number;
  scoreboard: boolean;
  throwOnUpdate: number;
  lastVm: HudViewModel | null;
}

export function fakeHud(): FakeHud {
  const h: FakeHud = {
    log: [],
    updates: 0,
    feeds: 0,
    resets: 0,
    scoreboard: false,
    throwOnUpdate: 0,
    lastVm: null,
    writes: 0,
    mount() {
      h.log.push('mount');
    },
    update(vm) {
      if (h.throwOnUpdate > 0) {
        h.throwOnUpdate -= 1;
        throw new Error('hud fault');
      }
      h.updates += 1;
      h.log.push('update');
      h.lastVm = vm;
    },
    feed() {
      h.feeds += 1;
      h.log.push('feed');
    },
    setScoreboard(v) {
      h.scoreboard = v;
    },
    reset() {
      h.resets += 1;
    },
    unmount() {
      h.log.push('unmount');
    },
  };
  return h;
}

export interface ManualFrames {
  request: RequestFrame;
  pending: number;
  /** Runs one queued frame at `t` ms. */
  run(t: number): void;
  /** Runs n frames 1/60 s apart starting after the last time. */
  advance(n: number, stepMs?: number): void;
  readonly now: number;
}

export function manualFrames(): ManualFrames {
  let queue: ((t: number) => void)[] = [];
  let now = 0;
  const f: ManualFrames = {
    request(cb) {
      queue.push(cb);
    },
    get pending() {
      return queue.length;
    },
    run(t) {
      now = t;
      const q = queue;
      queue = [];
      for (const cb of q) cb(t);
    },
    advance(n, stepMs = 1000 / 60) {
      for (let i = 0; i < n; i++) f.run(now + stepMs);
    },
    get now() {
      return now;
    },
  };
  return f;
}

export function recordingDiag(): Diagnostics & { codes: string[] } {
  const codes: string[] = [];
  return Object.assign(
    createDiagnostics((code) => {
      codes.push(code);
    }),
    { codes },
  );
}

export const zeroProfiler = () => createProfiler(() => 0);

/** Lets every pending promise callback run. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise<void>((r) => {
    setImmediate(r);
  });
}
