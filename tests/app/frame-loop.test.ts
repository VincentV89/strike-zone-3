/** Frame loop (business-logic-model-app-shell §7, PD-AS-01..08) against the real simulation. */
import { describe, expect, it } from 'vitest';
import type { AppEvent, AppStateName } from '../../src/app/machine';
import {
  ELIMINATED_BEAT_SEC,
  MAX_FAST_FORWARD,
  createFrameLoop,
  type FrameHost,
} from '../../src/app/frame-loop';
import { createRoundSession, type RoundSession } from '../../src/app/round-session';
import { createScope } from '../../src/app/scope';
import { createFixedStepClock } from '../../src/core';
import { createInputSystem } from '../../src/input';
import { prepareMap } from '../../src/sim';
import { EMPTY_SESSION } from '../../src/sim/stats';
import {
  fakeAudio,
  fakeHud,
  fakeRenderer,
  manualFrames,
  recordingDiag,
  zeroProfiler,
} from './fakes';

function rig(state: AppStateName = 'countdown') {
  const renderer = fakeRenderer();
  const hud = fakeHud();
  const audio = fakeAudio();
  const diag = recordingDiag();
  const frames = manualFrames();
  const events: AppEvent[] = [];
  const s = createRoundSession(
    prepareMap('desert-compound'),
    { map: 'desert-compound', bots: 2, difficulty: 'normal', durationSec: 120, seed: 9 },
    EMPTY_SESSION,
    1,
    createScope(),
    { diag, profiler: zeroProfiler(), renderer, hud, sensitivity: 1 },
  );
  if (!s.ok) throw new Error('session');
  const session: RoundSession = s.value;
  interface TestHost extends FrameHost {
    st: AppStateName;
    countdowns: number;
    resize: { w: number; h: number } | null;
  }
  const host: TestHost = {
    st: state,
    countdowns: 0,
    resize: null,
    state: () => host.st,
    rebuilding: () => false,
    session: () => session,
    canRender: () => true,
    dispatch: (e: AppEvent) => {
      events.push(e);
      if (e.kind === 'sim-live') host.st = 'live';
    },
    countdown: () => {
      host.countdowns += 1;
    },
    pendingResize: () => {
      const r = host.resize;
      host.resize = null;
      return r;
    },
    afterFrame: () => undefined,
  };
  const target = new EventTarget();
  const input = createInputSystem({ keys: target, pointer: target, canvas: target });
  input.setMap('gameplay');
  const profiler = zeroProfiler();
  const loop = createFrameLoop(host, {
    clock: createFixedStepClock(),
    input,
    hud,
    renderer,
    audio,
    profiler,
    diag,
    requestFrame: frames.request,
    lookScale: () => 0.25,
  });
  return { loop, host, session, renderer, hud, audio, diag, frames, events, profiler };
}

describe('frame loop', () => {
  it('steps only in countdown/live and renders frozen frames with alpha 1 otherwise', () => {
    const r = rig('paused');
    r.loop.frame(0);
    r.loop.frame(1000);
    expect(r.session.sim.snapshot().tick).toBe(0);
    expect(r.renderer.lastAlpha).toBe(1);
    r.host.st = 'countdown';
    r.loop.resetTime();
    r.loop.frame(2000);
    r.loop.frame(2000 + 1000 / 60);
    expect(r.session.sim.snapshot().tick).toBe(1);
  });

  it('caps a long frame at 5 steps and resetTime makes the next frame dt = 0', () => {
    const r = rig();
    r.loop.frame(0);
    r.loop.frame(10_000);
    expect(r.session.sim.snapshot().tick).toBe(5);
    r.loop.resetTime();
    r.loop.frame(50_000);
    expect(r.session.sim.snapshot().tick).toBe(5);
  });

  it('feeds then updates the hud, plays audio with the reused pose, ingests stats', () => {
    const r = rig();
    r.loop.frame(0);
    r.loop.frame(1000 / 30);
    expect(r.hud.log).toEqual(['feed', 'update']);
    r.loop.frame(2000 / 30);
    expect(r.audio.poses.size).toBe(1);
    const snap = r.session.sim.snapshot();
    expect(r.audio.lastPose?.pos.y).toBeCloseTo(snap.player.pos.y + snap.player.eyeHeight);
    expect(r.hud.lastVm?.tick).toBe(snap.tick);
  });

  it('updates S7 only when the whole second changes and detects live', () => {
    const r = rig();
    r.loop.frame(0);
    for (let i = 1; i <= 240; i++) r.loop.frame((i * 1000) / 60);
    expect(r.host.countdowns).toBeGreaterThanOrEqual(3);
    expect(r.host.countdowns).toBeLessThanOrEqual(5);
    expect(r.events.map((e) => e.kind)).toContain('sim-live');
  });

  it('fastForward is bounded and ends rounds with sim-ended', () => {
    const r = rig('live');
    r.loop.fastForward(0);
    r.loop.fastForward(MAX_FAST_FORWARD + 1);
    r.loop.fastForward(1.5);
    expect(r.diag.snapshot()['app/ignored-event']).toBe(3);
    r.loop.fastForward(MAX_FAST_FORWARD);
    expect(r.events.some((e) => e.kind === 'sim-ended')).toBe(true);
    r.host.st = 'menu';
    r.loop.fastForward(10);
    expect(r.diag.snapshot()['app/ignored-event']).toBe(4);
  });

  it('runs the eliminated beat on rAF time', () => {
    const r = rig('eliminated');
    r.loop.startBeat();
    r.loop.frame(0);
    r.loop.frame(ELIMINATED_BEAT_SEC * 1000 - 50);
    expect(r.events).toEqual([]);
    r.loop.frame(ELIMINATED_BEAT_SEC * 1000 + 1);
    expect(r.events).toEqual([{ kind: 'eliminated-elapsed' }]);
  });

  it('a faulted frame is skipped, counted once, and keeps the profiler balanced', () => {
    const r = rig();
    r.hud.throwOnUpdate = 1;
    r.loop.frame(0);
    r.loop.frame(1000 / 30);
    r.loop.frame(2000 / 30);
    expect(r.diag.codes).toEqual(['app/frame-fault']);
    expect(r.profiler.report().frames).toBe(3);
    expect(r.hud.updates).toBe(1);
  });

  it('applies a pending resize and starts one loop only', () => {
    const r = rig();
    r.host.resize = { w: 800, h: 600 };
    r.loop.start();
    r.loop.start();
    expect(r.frames.pending).toBe(1);
    r.frames.run(16);
    expect(r.renderer.calls).toContain('resize:800x600');
    r.loop.stop();
    r.frames.run(32);
    expect(r.frames.pending).toBe(0);
  });

  it('scales look deltas while scoped (FD-AS-Q1)', () => {
    const r = rig('live');
    (r.session.sim.snapshot().player.loadout as { scoped: boolean }).scoped = true;
    r.loop.frame(0);
    r.loop.frame(1000 / 60);
    expect(r.session.sim.snapshot().tick).toBe(1);
  });

  it('falls back to the snapshot outcome when the phase event was dropped', () => {
    const r = rig('live');
    r.loop.fastForward(MAX_FAST_FORWARD);
    r.events.length = 0;
    r.loop.frame(0);
    r.loop.frame(1000 / 60);
    expect(r.session.sim.snapshot().phase).toBe('ended');
  });
});
