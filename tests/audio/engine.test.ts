import { describe, expect, it } from 'vitest';
import { createAudioEngine, type AudioEngine } from '../../src/audio';
import { LIMITER } from '../../src/audio/engine';
import { RECIPES } from '../../src/audio/recipes';
import { vec3 } from '../../src/core';
import type { SimEvent } from '../../src/contracts';
import {
  fakeFactory,
  type FakeBiquad,
  FakeCompressor,
  FakeGain,
  type FakePanner,
  FakeSource,
  type FakeAudioContext,
  type FakeNode,
  type FakeOptions,
} from './fake-context';
import {
  damage,
  noise,
  phase,
  POSE,
  recordingDiagnostics,
  shot,
  weapon,
  type RecordingDiagnostics,
} from './fixtures';

interface Rig {
  engine: AudioEngine;
  diagnostics: RecordingDiagnostics;
  factory: ReturnType<typeof fakeFactory>;
}

function rig(opts: FakeOptions = {}, seed?: number): Rig {
  const diagnostics = recordingDiagnostics();
  const factory = fakeFactory(opts);
  const engine = createAudioEngine({
    diagnostics,
    createContext: factory.create,
    ...(seed === undefined ? {} : { seed }),
  });
  return { engine, diagnostics, factory };
}

async function running(opts: FakeOptions = {}): Promise<Rig & { ctx: FakeAudioContext }> {
  const r = rig(opts);
  const res = await r.engine.unlock();
  expect(res.ok).toBe(true);
  const ctx = r.factory.last;
  if (ctx === null) throw new Error('no context');
  return { ...r, ctx };
}

const bus = (
  ctx: FakeAudioContext,
): { sfx: FakeGain; master: FakeGain; limiter: FakeCompressor } => {
  const [sfx, master, limiter] = ctx.nodes;
  if (
    !(sfx instanceof FakeGain) ||
    !(master instanceof FakeGain) ||
    !(limiter instanceof FakeCompressor)
  )
    throw new Error('unexpected graph order');
  return { sfx, master, limiter };
};

/** Nodes from `node` to the end of its first-output chain. */
function chain(node: FakeNode): FakeNode[] {
  const out = [node];
  let n = node;
  while (n.outputs.length > 0 && out.length < 32) {
    const next = n.outputs[0];
    if (next === undefined) break;
    out.push(next);
    n = next;
  }
  return out;
}

/** Voices currently connected to the sfx bus. */
const liveVoices = (ctx: FakeAudioContext): FakeNode[] => bus(ctx).sfx.inputs;

describe('AudioEngine construction and unlock (BR-AU-01..08)', () => {
  it('throws a StrikeZoneError when diagnostics are missing (BR-AU-71)', () => {
    expect(() => createAudioEngine({} as never)).toThrow(/diagnostics/);
  });

  it('creates no context before unlock, whatever else is called (BR-AU-01)', () => {
    const { engine, factory } = rig();
    engine.setVolumes(50, 50);
    engine.play([shot(0, 'rifle')], POSE);
    engine.ui('confirm');
    engine.suspend();
    expect(factory.calls).toBe(0);
    expect(engine.supported).toBe(true);
  });

  it('constructs the context synchronously, before the first await (BR-AU-02)', async () => {
    const { engine, factory } = rig();
    const p = engine.unlock();
    expect(factory.calls).toBe(1);
    expect(factory.last?.nodes.length).toBeGreaterThan(0);
    expect(await p).toEqual({ ok: true, value: undefined });
  });

  it('is idempotent and creates at most one context (BR-AU-04)', async () => {
    const { engine, factory } = rig({ resume: 'hang' });
    const a = engine.unlock();
    const b = engine.unlock();
    expect(a).toBe(b);
    expect(factory.calls).toBe(1);
    const ok = rig();
    await ok.engine.unlock();
    expect(await ok.engine.unlock()).toEqual({ ok: true, value: undefined });
    expect(ok.factory.last?.resumeCalls).toBe(1);
  });

  it.each(['reject', 'stay-suspended', 'throw'] as const)(
    'returns BLOCKED once when resume %s, and retries on the next unlock (BR-AU-05)',
    async (mode) => {
      const { engine, factory, diagnostics } = rig({ resume: mode });
      expect(await engine.unlock()).toEqual({ ok: false, error: 'BLOCKED' });
      expect(await engine.unlock()).toEqual({ ok: false, error: 'BLOCKED' });
      expect(diagnostics.warned.filter((c) => c === 'audio/blocked')).toHaveLength(1);
      const ctx = factory.last;
      if (ctx === null) throw new Error('no context');
      ctx.resumeMode = 'run';
      expect(await engine.unlock()).toEqual({ ok: true, value: undefined });
      expect(factory.calls).toBe(1);
    },
  );

  it('reports UNSUPPORTED when Web Audio is absent (BR-AU-06)', async () => {
    const diagnostics = recordingDiagnostics();
    const engine = createAudioEngine({ diagnostics });
    expect(engine.supported).toBe(false);
    expect(await engine.unlock()).toEqual({ ok: false, error: 'UNSUPPORTED' });
  });

  it.each([
    ['returns null', () => null],
    [
      'throws',
      () => {
        throw new Error('no audio');
      },
    ],
  ])('reports UNSUPPORTED once when the factory %s', async (_name, create) => {
    const diagnostics = recordingDiagnostics();
    let calls = 0;
    const engine = createAudioEngine({
      diagnostics,
      createContext: () => {
        calls++;
        return create();
      },
    });
    expect(await engine.unlock()).toEqual({ ok: false, error: 'UNSUPPORTED' });
    expect(await engine.unlock()).toEqual({ ok: false, error: 'UNSUPPORTED' });
    expect(calls).toBe(1);
    expect(diagnostics.warned).toEqual(['audio/unsupported']);
  });

  it('keeps one context across 50 unlocks mixed with suspend, a blocked resume and dispose (SD-AU-05)', async () => {
    const { engine, factory } = rig();
    for (let i = 0; i < 50; i++) {
      const ctx = factory.last;
      if (ctx !== null) ctx.resumeMode = i % 7 === 3 ? 'reject' : 'run';
      await engine.unlock();
      if (i % 5 === 0) engine.suspend();
      if (i === 40) engine.dispose();
    }
    expect(factory.calls).toBe(1);
    expect(await engine.unlock()).toEqual({ ok: false, error: 'BLOCKED' });
  });
});

describe('AudioEngine graph and volumes (SD-AU-01, BR-AU-20..24)', () => {
  it('builds sfx -> master -> limiter -> destination with the fixed limiter', async () => {
    const { ctx } = await running();
    const { sfx, master, limiter } = bus(ctx);
    expect(ctx.ofKind('compressor')).toHaveLength(1);
    expect(chain(sfx)).toEqual([sfx, master, limiter, ctx.destination]);
    expect(ctx.destination.inputs).toEqual([limiter]);
    expect({
      threshold: limiter.threshold.value,
      knee: limiter.knee.value,
      ratio: limiter.ratio.value,
      attack: limiter.attack.value,
      release: limiter.release.value,
    }).toEqual({ ...LIMITER });
  });

  it('applies volumes stored while locked when the graph is built', async () => {
    const r = rig();
    r.engine.setVolumes(50, 10);
    await r.engine.unlock();
    const ctx = r.factory.last;
    if (ctx === null) throw new Error('no context');
    expect(bus(ctx).master.gain.value).toBeCloseTo(0.25, 10);
    expect(bus(ctx).sfx.gain.value).toBeCloseTo(0.01, 10);
  });

  it('ramps gains with setTargetAtTime and pins a mute to exactly 0', async () => {
    const { engine, ctx } = await running();
    ctx.currentTime = 2;
    engine.setVolumes(50, 0);
    const { master, sfx } = bus(ctx);
    expect(master.gain.calls).toContainEqual(['setTargetAtTime', 0.25, 2]);
    expect(sfx.gain.calls).toContainEqual(['setTargetAtTime', 0, 2]);
    expect(sfx.gain.calls.at(-1)).toEqual(['setValueAtTime', 0, 2.12]);
  });

  it('keeps the previous value and reports a non-finite volume once', async () => {
    const { engine, ctx, diagnostics } = await running();
    engine.setVolumes(Number.NaN, 50);
    engine.setVolumes(Number.POSITIVE_INFINITY, 50);
    const targets = bus(ctx).master.gain.calls.filter((c) => c[0] === 'setTargetAtTime');
    expect(targets.every((c) => Math.abs(c[1] - 0.64) < 1e-9)).toBe(true);
    expect(targets).toHaveLength(2);
    expect(diagnostics.warned.filter((c) => c === 'audio/bad-volume')).toHaveLength(1);
  });

  it('creates zero nodes in 100 plays and UI cues when either bus is 0 (BR-AU-22)', async () => {
    for (const [m, s] of [
      [0, 100],
      [80, 0],
    ] as const) {
      const { engine, ctx } = await running();
      engine.setVolumes(m, s);
      const before = ctx.nodes.length;
      for (let i = 0; i < 100; i++) {
        engine.play([shot(0, 'rifle', 0, 0, 0, i), shot(2, 'pistol', 3, 0, 0, i)], POSE);
        engine.ui('confirm');
      }
      expect(ctx.nodes.length).toBe(before);
    }
  });

  it('routes every voice through sfx -> master -> limiter -> destination (BR-AU-23)', async () => {
    const { engine, ctx } = await running();
    engine.play(
      [
        shot(0, 'sniper'),
        shot(2, 'rifle', -10, 1.6, 0),
        shot(3, 'pistol', 0, 1.6, 10),
        damage(0, 2, false, vec3(1, 0, 0)),
        noise(4, 'footstep', 2, 0),
        phase('ended', 'victory'),
      ],
      POSE,
    );
    engine.ui('tick');
    const { sfx, master, limiter } = bus(ctx);
    const sources = ctx.sources();
    expect(sources.length).toBeGreaterThan(6);
    for (const s of sources) {
      expect(chain(s).slice(-4)).toEqual([sfx, master, limiter, ctx.destination]);
    }
  });
});

describe('AudioEngine play (Workflow 2, BR-AU-40..55)', () => {
  it('ignores game events until running, but schedules UI cues while unlocking (BR-AU-34)', async () => {
    const { engine, factory } = rig({ resume: 'hang' });
    void engine.unlock();
    const ctx = factory.last;
    if (ctx === null) throw new Error('no context');
    const before = ctx.nodes.length;
    engine.play([shot(0, 'rifle')], POSE);
    expect(ctx.nodes.length).toBe(before);
    engine.ui('confirm');
    expect(liveVoices(ctx)).toHaveLength(1);
    await Promise.resolve();
  });

  it('starts voices at ctx.currentTime with no look-ahead', async () => {
    const { engine, ctx } = await running();
    ctx.currentTime = 3.25;
    engine.play([shot(0, 'rifle')], POSE);
    const first = ctx.sources()[0];
    expect(first?.startedAt).toBe(3.25);
  });

  it('pans bot fire from the left to -1 with distance gain (scenario S5)', async () => {
    const { engine, ctx } = await running();
    engine.play([shot(2, 'rifle', -10, 1.6, 0)], POSE);
    const panner = ctx.ofKind('panner')[0] as FakePanner | undefined;
    expect(panner?.pan.value).toBeCloseTo(-1, 10);
    const out = ctx.nodes.find((n) => n instanceof FakeGain && n.outputs[0] === panner) as FakeGain;
    expect(out.gain.value).toBeCloseTo(RECIPES['bot-fire-rifle'].gain * 0.3, 10);
  });

  it('muffles bot fire from behind with a 4 kHz lowpass before the panner', async () => {
    const { engine, ctx } = await running();
    engine.play([shot(2, 'rifle', 0, 1.6, 10)], POSE);
    const lp = ctx.ofKind('biquad').find((n) => n.outputs[0]?.kind === 'panner') as
      FakeBiquad | undefined;
    expect(lp?.type).toBe('lowpass');
    expect(lp?.frequency.value).toBeCloseTo(4000, 6);
  });

  it('pans hurt from fromDir without a distance filter (BR-AU-44)', async () => {
    const { engine, ctx } = await running();
    engine.play([damage(0, 2, false, vec3(-1, 0, 0))], POSE);
    const panner = ctx.ofKind('panner')[0] as FakePanner | undefined;
    expect(panner?.pan.value).toBeCloseTo(-1, 10);
    expect(ctx.ofKind('biquad').some((n) => n.outputs[0]?.kind === 'panner')).toBe(false);
  });

  it('culls bot fire beyond 90 m and bot steps beyond their noise radius', async () => {
    const { engine, ctx } = await running();
    engine.play([shot(2, 'rifle', 100, 0, 0), noise(3, 'footstep', 11, 0, 8)], POSE);
    expect(liveVoices(ctx)).toHaveLength(0);
  });

  it('skips positional voices but plays centred ones for a non-finite listener (BR-AU-46)', async () => {
    const { engine, ctx, diagnostics } = await running();
    const bad = { pos: vec3(Number.NaN, 0, 0), yaw: 0 };
    engine.play([shot(2, 'rifle', 1, 0, 0), shot(0, 'rifle'), damage(0, 2)], bad);
    engine.play([shot(2, 'rifle', 1, 0, 0, 2)], { pos: vec3(), yaw: Number.POSITIVE_INFINITY });
    expect(liveVoices(ctx)).toHaveLength(2);
    expect(ctx.ofKind('panner')).toHaveLength(1);
    expect((ctx.ofKind('panner')[0] as FakePanner).pan.value).toBe(0);
    expect(diagnostics.warned.filter((c) => c === 'audio/bad-listener')).toHaveLength(1);
  });

  it('admits at most 12 new voices per call in priority, then distance order (BR-AU-52)', async () => {
    const { engine, ctx, diagnostics } = await running();
    const events: SimEvent[] = [
      // Six bot footsteps at 2, 4, ... 12 m, listed farthest first.
      ...[12, 10, 8, 6, 4, 2].map((d, i) => noise(i + 1, 'footstep', d, 0, 20)),
      shot(0, 'rifle', 0, 0, 0, 1),
      shot(0, 'rifle', 0, 0, 0, 2),
      damage(2, 0, false, vec3(), 1),
      damage(3, 0, false, vec3(), 1),
      damage(4, 0, false, vec3(), 1),
      weapon(0, 'reload-start', 1),
      weapon(0, 'reload-start', 2),
      weapon(0, 'switch', 1),
      weapon(0, 'switch', 2),
      noise(0, 'footstep', 0, 0, 10, 1),
      noise(0, 'footstep', 0, 0, 10, 2),
    ];
    engine.play(events, POSE);
    expect(liveVoices(ctx)).toHaveLength(12);
    const panners = ctx.ofKind('panner');
    expect(panners).toHaveLength(1);
    // The admitted bot step is the nearest: 2 m across, 1.6 m below the ear.
    const out = ctx.nodes.find(
      (n) => n instanceof FakeGain && n.outputs[0] === panners[0],
    ) as FakeGain;
    const d = Math.hypot(2, 1.6);
    expect(out.gain.value).toBeCloseTo(RECIPES['bot-step'].gain * (2 / (2 + d - 2)), 10);
    expect(diagnostics.snapshot()['audio/voice-dropped']).toBe(5);
  });

  it('caps rapid fire at 2 concurrent rifle voices and releases them on ended (scenario S3)', async () => {
    const { engine, ctx } = await running();
    for (let i = 0; i < 30; i++) {
      engine.play([shot(0, 'rifle', 0, 0, 0, i)], POSE);
      ctx.currentTime += 0.1 / 6;
    }
    expect(liveVoices(ctx).length).toBeLessThanOrEqual(2);
    ctx.endAll();
    expect(liveVoices(ctx)).toHaveLength(0);
  });

  it('leaves 0 connected voice nodes and 1 context after 1,000 plays (SEC-AU-06)', async () => {
    const { engine, ctx, factory } = await running();
    for (let i = 0; i < 1000; i++) {
      engine.play(
        [
          shot(0, 'rifle', 0, 0, 0, i),
          shot(2, 'pistol', 5, 0, 0, i),
          noise(3, 'footstep', 3, 0, 10, i),
        ],
        POSE,
      );
      ctx.currentTime += 0.05;
      if (i % 3 === 0) ctx.endAll();
    }
    ctx.currentTime += 5;
    engine.play([phase('countdown')], POSE);
    engine.ui('back');
    ctx.endAll();
    const { sfx, master, limiter } = bus(ctx);
    const busNodes = new Set<FakeNode>([sfx, master, limiter]);
    expect(ctx.nodes.filter((n) => !busNodes.has(n) && n.connected)).toEqual([]);
    expect(factory.calls).toBe(1);
  });

  it('sweeps voices whose ended event never fired (BR-AU-55)', async () => {
    const { engine, ctx } = await running();
    engine.play([shot(0, 'rifle', 0, 0, 0, 1), shot(0, 'rifle', 0, 0, 0, 2)], POSE);
    engine.play([shot(0, 'rifle', 0, 0, 0, 3)], POSE);
    expect(liveVoices(ctx)).toHaveLength(2);
    ctx.currentTime = 1;
    engine.play([shot(0, 'rifle', 0, 0, 0, 4)], POSE);
    expect(liveVoices(ctx)).toHaveLength(1);
  });

  it('copies nothing it keeps: the pose and events can be reused (SD-AU-03)', async () => {
    const { engine, ctx } = await running();
    const pose = { pos: vec3(), yaw: 0 };
    const events = [shot(2, 'rifle', -5, 0, 0)];
    engine.play(events, pose);
    pose.pos.x = 1000;
    events.length = 0;
    expect((ctx.ofKind('panner')[0] as FakePanner).pan.value).toBeCloseTo(-1, 10);
  });
});

describe('AudioEngine UI cues and lifecycle (BR-AU-07..10, 30..34)', () => {
  it('rate-limits tick to one per 60 ms of context time (BR-AU-33)', async () => {
    const { engine, ctx } = await running();
    const ticks = (): number => ctx.ofKind('oscillator').length;
    engine.ui('tick');
    engine.ui('tick');
    ctx.currentTime = 0.05;
    engine.ui('tick');
    expect(ticks()).toBe(1);
    ctx.currentTime = 0.07;
    engine.ui('tick');
    expect(ticks()).toBe(2);
  });

  it('caps UI cues at 2 and plays every UiCue', async () => {
    const { engine, ctx } = await running();
    engine.ui('confirm');
    engine.ui('back');
    engine.ui('error');
    expect(liveVoices(ctx)).toHaveLength(2);
  });

  it('ignores UI cues when locked or blocked', async () => {
    const locked = rig();
    locked.engine.ui('confirm');
    expect(locked.factory.calls).toBe(0);
    const blocked = rig({ resume: 'reject' });
    await blocked.engine.unlock();
    const ctx = blocked.factory.last;
    if (ctx === null) throw new Error('no context');
    const before = ctx.nodes.length;
    blocked.engine.ui('confirm');
    expect(ctx.nodes.length).toBe(before);
  });

  it('suspends on request, stays silent, and resumes on the next unlock (BR-AU-07)', async () => {
    const { engine, ctx, factory } = await running();
    engine.suspend();
    expect(ctx.suspendCalls).toBe(1);
    engine.play([shot(0, 'rifle')], POSE);
    engine.ui('confirm');
    expect(liveVoices(ctx)).toHaveLength(0);
    expect(await engine.unlock()).toEqual({ ok: true, value: undefined });
    engine.play([shot(0, 'rifle')], POSE);
    expect(liveVoices(ctx)).toHaveLength(1);
    expect(ctx.resumeCalls).toBe(2);
    expect(factory.calls).toBe(1);
  });

  it('treats a browser-initiated interruption as suspended (BR-AU-10)', async () => {
    const { engine, ctx } = await running();
    ctx.setStateFromBrowser('interrupted');
    engine.play([shot(0, 'rifle')], POSE);
    expect(liveVoices(ctx)).toHaveLength(0);
    await engine.unlock();
    engine.play([shot(0, 'rifle')], POSE);
    expect(liveVoices(ctx)).toHaveLength(1);
  });

  it('disposes once: closes the context, drops voices and turns every call into a no-op (BR-AU-08)', async () => {
    const { engine, ctx } = await running();
    engine.play([shot(0, 'rifle')], POSE);
    engine.dispose();
    engine.dispose();
    expect(ctx.closeCalls).toBe(1);
    expect(liveVoices(ctx)).toHaveLength(0);
    const before = ctx.nodes.length;
    engine.play([shot(0, 'rifle')], POSE);
    engine.ui('confirm');
    engine.setVolumes(10, 10);
    engine.suspend();
    expect(ctx.nodes.length).toBe(before);
    expect(await engine.unlock()).toEqual({ ok: false, error: 'BLOCKED' });
  });

  it('settles an unlock that was pending at dispose as BLOCKED', async () => {
    const { engine, factory } = rig({ resume: 'stay-suspended' });
    const p = engine.unlock();
    engine.dispose();
    expect(await p).toEqual({ ok: false, error: 'BLOCKED' });
    expect(factory.calls).toBe(1);
  });

  it('fills a deterministic 1 s noise buffer from the seed and never reads it back (BR-AU-61)', async () => {
    const a = rig({}, 99);
    const b = rig({}, 99);
    const c = rig({}, 100);
    await Promise.all([a.engine.unlock(), b.engine.unlock(), c.engine.unlock()]);
    const da = a.factory.last?.buffers[0];
    const db = b.factory.last?.buffers[0];
    const dc = c.factory.last?.buffers[0];
    expect(da?.length).toBe(4000);
    expect(Array.from(da?.data ?? [])).toEqual(Array.from(db?.data ?? []));
    expect(Array.from(da?.data ?? [])).not.toEqual(Array.from(dc?.data ?? []));
    expect((da?.data ?? []).every((v) => v >= -1 && v < 1)).toBe(true);
    a.engine.play([shot(0, 'rifle')], POSE);
    expect(da?.reads).toBe(1);
  });

  it('reports a node fault once and keeps working (BR-AU-70)', async () => {
    let fail = false;
    const { engine, ctx, diagnostics } = await running({ chaos: () => fail });
    fail = true;
    expect(() => {
      engine.play([shot(0, 'rifle')], POSE);
      engine.ui('confirm');
      engine.setVolumes(30, 30);
    }).not.toThrow();
    fail = false;
    engine.play([shot(0, 'rifle', 0, 0, 0, 9)], POSE);
    expect(liveVoices(ctx)).toHaveLength(1);
    expect(diagnostics.warned.filter((c) => c === 'audio/voice-fault')).toHaveLength(1);
    expect(ctx.sources().every((s) => s instanceof FakeSource)).toBe(true);
  });
});
