/** Loading pipeline (business-logic-model-app-shell §5): progress, abort, retry, failures. */
import { describe, expect, it } from 'vitest';
import { createLoader, type LoaderDeps } from '../../src/app/loading';
import { createRoundSession, type RoundSession } from '../../src/app/round-session';
import { createScope } from '../../src/app/scope';
import { prepareMapAsync, type PreparedMap } from '../../src/sim';
import { EMPTY_SESSION } from '../../src/sim/stats';
import { fakeHud, fakeRenderer, recordingDiag, zeroProfiler } from './fakes';

function deps(over: Partial<LoaderDeps> = {}) {
  const renderer = fakeRenderer();
  const scope = createScope();
  const diag = recordingDiag();
  const progress: number[] = [];
  const d: LoaderDeps = {
    prepare: prepareMapAsync,
    renderer,
    createSession: (p: PreparedMap) =>
      createRoundSession(
        p,
        { map: p.def.id, bots: 5, difficulty: 'normal', durationSec: 180, seed: 3 },
        EMPTY_SESSION,
        1,
        scope,
        { diag, profiler: zeroProfiler(), renderer, hud: fakeHud(), sensitivity: 1 },
      ),
    disposeSession: (s: RoundSession) => {
      s.scope.dispose();
    },
    yieldFn: () => Promise.resolve(),
    now: () => 0,
    diag,
    onProgress: (p) => {
      progress.push(p.map.progress + p.nav.progress + p.bots.progress + p.shaders.progress);
    },
    ...over,
  };
  return { d, renderer, diag, progress };
}

describe('loader', () => {
  it('runs map, nav, bots and shaders with monotonic progress', async () => {
    const { d, renderer, progress } = deps();
    const loader = createLoader(d);
    const o = await loader.run('desert-compound', 'map', new AbortController().signal);
    expect(o.kind).toBe('done');
    expect(renderer.calls).toEqual(['buildMap', 'spawnActors:5', 'precompile']);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual((progress[i - 1] ?? 0) - 1e-9);
    }
    expect(progress.at(-1)).toBe(4);
    expect(progress.slice(0, -1).every((p) => p < 4)).toBe(true);
  });

  it('retry from shaders keeps the built map and session', async () => {
    const { d, renderer } = deps();
    renderer.failNext.precompile = true;
    const loader = createLoader(d);
    const o = await loader.run('desert-compound', 'map', new AbortController().signal);
    expect(o).toMatchObject({ kind: 'failed', step: 'shaders' });
    expect(loader.progress().shaders.state).toBe('failed');
    const again = await loader.run('desert-compound', 'shaders', new AbortController().signal);
    expect(again.kind).toBe('done');
    expect(renderer.calls.filter((c) => c === 'buildMap')).toHaveLength(1);
  });

  it('a spawn failure fails bots with its message', async () => {
    const { d } = deps({ createSession: () => ({ ok: false, error: 'SPAWN_ALLOCATION_FAILED' }) });
    const o = await createLoader(d).run('desert-compound', 'map', new AbortController().signal);
    expect(o).toMatchObject({ kind: 'failed', step: 'bots' });
  });

  it('a thrown createSession is caught at the step boundary', async () => {
    const { d, diag } = deps({
      createSession: () => {
        throw new Error('sim/bad-config');
      },
    });
    const o = await createLoader(d).run('desert-compound', 'map', new AbortController().signal);
    expect(o).toMatchObject({ kind: 'failed', step: 'bots' });
    expect(diag.codes).toContain('app/load-failed');
  });

  it('abort before or during the run stops and frees the scene', async () => {
    const { d, renderer } = deps();
    const c = new AbortController();
    c.abort();
    expect((await createLoader(d).run('desert-compound', 'map', c.signal)).kind).toBe('aborted');
    const c2 = new AbortController();
    const slow = deps({
      renderer,
      prepare: async (id, opts) => {
        const r = await prepareMapAsync(id, opts);
        c2.abort();
        return r;
      },
    });
    const o = await createLoader(slow.d).run('desert-compound', 'map', c2.signal);
    expect(o.kind).toBe('aborted');
    const aborted = deps({ prepare: () => Promise.resolve({ ok: false, error: 'ABORTED' }) });
    expect(
      (await createLoader(aborted.d).run('desert-compound', 'map', new AbortController().signal))
        .kind,
    ).toBe('aborted');
  });

  it('a nav failure after geometry is reported as nav; a new map restarts from map', async () => {
    const { d } = deps({
      prepare: (_id, opts) => {
        opts.onProgress('map-geometry', 1);
        opts.onProgress('nav-data', 0.5);
        return Promise.reject(new Error('bake'));
      },
    });
    const loader = createLoader(d);
    expect(await loader.run('desert-compound', 'map', new AbortController().signal)).toMatchObject({
      step: 'nav',
    });
    expect(loader.current()).toBe('nav');
    const ok = deps();
    const l2 = createLoader(ok.d);
    await l2.run('desert-compound', 'map', new AbortController().signal);
    expect(
      (await l2.run('industrial-warehouse', 'shaders', new AbortController().signal)).kind,
    ).toBe('done');
    expect(ok.renderer.calls.filter((c) => c === 'buildMap')).toHaveLength(2);
    l2.reset();
    expect(l2.progress().map.state).toBe('pending');
  });
});
