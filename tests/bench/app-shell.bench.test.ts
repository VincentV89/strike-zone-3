/**
 * app-shell bench (performance-design-app-shell, PR-AS-01..09). Runs the
 * real simulation through the real frame loop with recording fakes for the
 * renderer, hud and audio, and writes reports/app-shell-bench.json. Targets
 * are reported as pass or miss; only the 10x ceilings, the 16.6 ms 5-bot
 * frame body and the 1 MB heap delta are asserted. Timings are indirect:
 * 2 vCPU arm64, inside vitest (coverage when run by verify).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createFrameLoop, type FrameHost } from '../../src/app/frame-loop';
import { createLoader } from '../../src/app/loading';
import type { AppStateName } from '../../src/app/machine';
import { createRoundSession, type RoundSession } from '../../src/app/round-session';
import { createScope } from '../../src/app/scope';
import type { BotCount, MapId } from '../../src/contracts';
import { createFixedStepClock, createProfiler, type Profiler } from '../../src/core';
import { createInputSystem } from '../../src/input';
import { prepareMapAsync, type PreparedMap } from '../../src/sim';
import { __resetPreparedMapCache } from '../../src/sim/prepare';
import { EMPTY_SESSION } from '../../src/sim/stats';
import { fakeAudio, fakeHud, fakeRenderer, recordingDiag } from '../app/fakes';

const report: Record<string, unknown> = {
  runtime: 'Node, 2 vCPU arm64, inside vitest (coverage when run by verify); indirect',
};
const HEAP_LIMIT = 1024 * 1024;
const FRAME_MS = 1000 / 60;

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run Vitest with --expose-gc');
  collect();
}

function verdict(value: number, target: number): string {
  return value <= target ? 'pass' : 'miss';
}

async function prepare(map: MapId): Promise<PreparedMap> {
  const r = await prepareMapAsync(map, {
    signal: new AbortController().signal,
    onProgress: () => undefined,
    yieldFn: () => Promise.resolve(),
    now: () => performance.now(),
  });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function loopRig(prepared: PreparedMap, bots: BotCount) {
  const diag = recordingDiag();
  const profiler: Profiler = createProfiler(() => performance.now());
  const renderer = fakeRenderer();
  const hud = fakeHud();
  const audio = fakeAudio();
  const scope = createScope();
  let seed = 11;
  const makeSession = (): RoundSession => {
    const s = createRoundSession(
      prepared,
      { map: prepared.def.id, bots, difficulty: 'easy', durationSec: 600, seed: seed++ },
      EMPTY_SESSION,
      1,
      scope,
      { diag, profiler, renderer, hud, sensitivity: 1 },
    );
    if (!s.ok) throw new Error(s.error);
    return s.value;
  };
  let session = makeSession();
  let state: AppStateName = 'countdown';
  const host: FrameHost = {
    state: () => state,
    rebuilding: () => false,
    session: () => session,
    canRender: () => true,
    dispatch: (e) => {
      if (e.kind === 'sim-live') state = 'live';
      if (e.kind === 'sim-ended') {
        session.scope.dispose();
        session = makeSession();
        state = 'countdown';
      }
    },
    countdown: () => undefined,
    pendingResize: () => null,
    afterFrame: () => undefined,
  };
  const target = new EventTarget();
  const input = createInputSystem({ keys: target, pointer: target, canvas: target });
  input.attach(scope);
  input.setMap('gameplay');
  const loop = createFrameLoop(host, {
    clock: createFixedStepClock(),
    input,
    hud,
    renderer,
    audio,
    profiler,
    diag,
    requestFrame: () => undefined,
    lookScale: () => 1,
  });
  let t = 0;
  const run = (frames: number): number => {
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      t += FRAME_MS;
      loop.frame(t);
    }
    return performance.now() - t0;
  };
  return { loop, profiler, run, diag };
}

describe('app-shell bench', () => {
  it('frame body and own cost at 5 and 20 bots, heap over 1e4 frames', async () => {
    const prepared = await prepare('desert-compound');
    const rows: Record<string, unknown> = {};
    for (const bots of [5, 20] as const) {
      const r = loopRig(prepared, bots);
      r.run(300); // warm-up through the countdown
      r.profiler.reset();
      const frames = 1800;
      const total = r.run(frames);
      const rep = r.profiler.report();
      const sections = (['sim', 'hud', 'audio', 'render-submit'] as const).reduce(
        (a, s) => a + rep.sections[s].totalMs,
        0,
      );
      const frameMean = total / frames;
      const own = Math.max(0, total - sections) / frames;
      rows[String(bots)] = {
        frameBodyMeanMs: frameMean,
        ownCostMeanMs: own,
        simMeanMs: rep.sections.sim.meanMsPerFrame,
        ownTarget: 0.2,
        ownVerdict: verdict(own, 0.2),
      };
      expect(own).toBeLessThan(2);
      if (bots === 5) expect(frameMean).toBeLessThan(16.6);
      expect(r.diag.codes.filter((c) => c.startsWith('app/'))).toEqual([]);
    }
    report['frames'] = rows;

    const r = loopRig(prepared, 20);
    r.run(600);
    gc();
    const before = process.memoryUsage().heapUsed;
    r.run(10_000);
    gc();
    const delta = process.memoryUsage().heapUsed - before;
    report['heapDeltaBytes1e4Frames20Bots'] = delta;
    expect(delta).toBeLessThan(HEAP_LIMIT);
  }, 180_000);

  it('cold load, cached re-entry and rebuild timings', async () => {
    __resetPreparedMapCache();
    const renderer = fakeRenderer();
    const diag = recordingDiag();
    const scope = createScope();
    const loader = createLoader({
      prepare: prepareMapAsync,
      renderer,
      createSession: (p) =>
        createRoundSession(
          p,
          { map: p.def.id, bots: 20, difficulty: 'normal', durationSec: 180, seed: 1 },
          EMPTY_SESSION,
          1,
          scope,
          {
            diag,
            profiler: createProfiler(() => 0),
            renderer,
            hud: fakeHud(),
            sensitivity: 1,
          },
        ),
      disposeSession: (s) => {
        s.scope.dispose();
      },
      yieldFn: () => Promise.resolve(),
      now: () => performance.now(),
      diag,
      onProgress: () => undefined,
    });
    const time = async (from: 'map' | 'shaders'): Promise<number> => {
      const t0 = performance.now();
      const o = await loader.run('desert-compound', from, new AbortController().signal);
      if (o.kind !== 'done') throw new Error(o.kind);
      o.session.scope.dispose();
      return performance.now() - t0;
    };
    const cold = await time('map');
    const cached = await time('map');
    const rebuild = await time('map');
    report['loading'] = {
      coldMs: cold,
      coldTarget: 2000,
      coldVerdict: verdict(cold, 2000),
      cachedReentryMs: cached,
      cachedTarget: 200,
      cachedVerdict: verdict(cached, 200),
      rebuildMs: rebuild,
      rebuildTarget: 250,
      rebuildVerdict: verdict(rebuild, 250),
      note: 'Fake renderer: buildMap/precompile cost is not included (measured in presentation-3d).',
    };
    expect(cold).toBeLessThan(20_000);
    expect(cached).toBeLessThan(2000);
    expect(rebuild).toBeLessThan(2500);
    mkdirSync('reports', { recursive: true });
    writeFileSync('reports/app-shell-bench.json', `${JSON.stringify(report, null, 2)}\n`);
  }, 180_000);
});
