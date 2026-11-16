/**
 * The one requestAnimationFrame loop (business-logic-model-app-shell §7,
 * performance-design-app-shell PD-AS-01..08, PD-AS-14). Steps run only in
 * countdown and live; other states render the frozen last snapshot with
 * alpha = 1 and no events, so renderer animations freeze. The frame body
 * allocates nothing in steady state and is wrapped in one try/catch; 30
 * consecutive faulted frames in a round trip to loading-error (AS-T31).
 *
 * Only this module handles snapshots (SD-AS-12): prev/curr go to the
 * renderer, the snapshot goes to toHudViewModel, and audio gets a reused
 * {pos, yaw} pose built from snap.player.
 */
import type { InputCommand, RoundOutcome, SimEvent, SimSnapshot } from '../contracts';
import {
  vec3,
  type Diagnostics,
  type FixedStepClock,
  type ProfileSection,
  type Profiler,
} from '../core';
import type { InputSystem } from '../input';
import type { GameRenderer } from '../render';
import {
  createHudViewModel,
  toHudViewModel,
  type Hud,
  type HudContext,
  type HudViewModel,
} from '../ui/hud';
import type { AudioFeature, ListenerPose } from './features';
import type { AppEvent, AppStateName } from './machine';
import type { RoundSession } from './round-session';

export const FRAME_FAULT_TRIP = 30;
/** Defeat beat before S13 (AS-T22), in seconds of rAF time. */
export const ELIMINATED_BEAT_SEC = 1.5;
/** fastForward bound per call (SD-AS-04). */
export const MAX_FAST_FORWARD = 36_000;

export type RequestFrame = (cb: (t: number) => void) => void;

export const defaultRequestFrame: RequestFrame = (cb) => {
  requestAnimationFrame(cb);
};

export interface FrameHost {
  state(): AppStateName;
  rebuilding(): boolean;
  session(): RoundSession | null;
  /** True once the renderer has a built scene for the session. */
  canRender(): boolean;
  dispatch(e: AppEvent): void;
  /** S7 view update; called only when the whole-second value changes. */
  countdown(snap: Readonly<SimSnapshot>): void;
  /** Resize, applied at the start of the next frame (one per frame). */
  pendingResize(): { w: number; h: number } | null;
  /** Called after every frame (dev overlay). */
  afterFrame(): void;
}

export interface FrameDeps {
  readonly clock: FixedStepClock;
  readonly input: InputSystem;
  readonly hud: Hud;
  readonly renderer: GameRenderer;
  readonly audio: AudioFeature | null;
  readonly profiler: Profiler;
  readonly diag: Diagnostics;
  readonly requestFrame: RequestFrame;
  /** Cached scoped look factor (PD-AS-03). */
  readonly lookScale: () => number;
}

export interface FrameLoop {
  /** Starts the loop once; a second call is ignored (one loop per page). */
  start(): void;
  stop(): void;
  /** One frame body; exported for tests and the bench. */
  frame(t: number): void;
  /** Called on every entry into countdown or live: first frame gets dt = 0 (PD-AS-07). */
  resetTime(): void;
  /** Starts the 1.5 s eliminated beat. */
  startBeat(): void;
  /** Test seam: steps the live sim with a neutral command (SD-AS-04). */
  fastForward(ticks: number): void;
}

const EMPTY: readonly SimEvent[] = Object.freeze([]);

function createNeutralCommand(): InputCommand {
  return {
    tick: 0,
    move: { x: 0, z: 0 },
    lookDx: 0,
    lookDy: 0,
    jump: false,
    sprint: false,
    crouch: false,
    fire: false,
    firePressed: false,
    scope: false,
    reload: false,
    select: null,
    cycle: 0,
  };
}

export function createFrameLoop(host: FrameHost, deps: FrameDeps): FrameLoop {
  const { clock, input, hud, renderer, audio, profiler, diag } = deps;
  const hudScratch: HudViewModel = createHudViewModel();
  const hudCtx: HudContext = { round: null };
  const pos = vec3();
  const pose: ListenerPose = { pos, yaw: 0 };
  const neutral = createNeutralCommand();
  let running = false;
  let stopped = false;
  let last: number | null = null;
  let consecutiveFaults = 0;
  let beat = -1;
  let lastCountdownSec = -1;

  let open: ProfileSection | null = null;

  function begin(sec: ProfileSection): void {
    open = sec;
    profiler.begin(sec);
  }

  function end(sec: ProfileSection): void {
    profiler.end(sec);
    open = null;
  }

  function writePose(snap: Readonly<SimSnapshot>): ListenerPose {
    const p = snap.player;
    pos.x = p.pos.x;
    pos.y = p.pos.y + p.eyeHeight;
    pos.z = p.pos.z;
    (pose as { yaw: number }).yaw = p.yaw;
    return pose;
  }

  /** Phase detection: one indexed scan, stop at the first phase event (PD-AS-04). */
  function detectPhase(events: readonly SimEvent[], snap: Readonly<SimSnapshot>): void {
    let ended: RoundOutcome | null = null;
    let live = false;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e === undefined || e.t !== 'phase') continue;
      if (e.phase === 'live') live = true;
      else if (e.phase === 'ended') ended = e.outcome;
    }
    if (live) host.dispatch({ kind: 'sim-live' });
    if (ended !== null) {
      host.dispatch({ kind: 'sim-ended', outcome: ended });
      return;
    }
    const s = host.state();
    if (s === 'countdown' && snap.phase === 'live' && !live) host.dispatch({ kind: 'sim-live' });
    if (snap.phase === 'ended' && snap.outcome !== null && host.state() === 'live') {
      // The phase event was dropped (buffer overflow): fall back to the snapshot.
      diag.count('app/outcome-from-snapshot');
      host.dispatch({ kind: 'sim-ended', outcome: snap.outcome });
    }
  }

  function stepFrame(session: RoundSession, dt: number): readonly SimEvent[] {
    const sim = session.sim;
    begin('sim');
    const n = clock.advance(dt);
    for (let i = 0; i < n; i++) {
      const snap = sim.snapshot();
      const cmd = input.sample(snap.tick + 1);
      if (snap.player.loadout.scoped) {
        const k = deps.lookScale();
        cmd.lookDx *= k;
        cmd.lookDy *= k;
      }
      sim.step(cmd);
    }
    end('sim');
    if (n === 0) return EMPTY;
    const events = sim.drainEvents();
    session.stats.ingest(events);
    const snap = sim.snapshot();
    begin('hud');
    hud.feed(events);
    hudCtx.round = session.round;
    hud.update(toHudViewModel(snap, session.stats.round(), hudCtx, hudScratch));
    end('hud');
    if (audio !== null) {
      begin('audio');
      audio.play(events, writePose(snap));
      end('audio');
    }
    return events;
  }

  function body(t: number): void {
    const dt = last === null ? 0 : Math.max(0, (t - last) / 1000);
    last = t;
    const resize = host.pendingResize();
    if (resize !== null) renderer.resize(resize.w, resize.h);
    const state = host.state();
    const session = host.session();
    const stepping = (state === 'countdown' || state === 'live') && !host.rebuilding();
    let events: readonly SimEvent[] = EMPTY;
    if (stepping && session !== null) events = stepFrame(session, dt);
    hud.setScoreboard(state === 'live' && input.held('scoreboard'));
    if (session !== null && host.canRender()) {
      const sim = session.sim;
      const alpha = stepping ? clock.alpha() : 1;
      begin('render-submit');
      renderer.render(sim.previousSnapshot(), sim.snapshot(), alpha, events);
      end('render-submit');
      const snap = sim.snapshot();
      if (state === 'countdown') {
        const sec = Math.ceil(snap.countdownLeftSec);
        if (sec !== lastCountdownSec) {
          lastCountdownSec = sec;
          host.countdown(snap);
        }
      } else {
        lastCountdownSec = -1;
      }
      if (stepping) detectPhase(events, snap);
    }
    if (beat >= 0 && host.state() === 'eliminated') {
      beat += dt;
      if (beat >= ELIMINATED_BEAT_SEC) {
        beat = -1;
        host.dispatch({ kind: 'eliminated-elapsed' });
      }
    }
  }

  function frame(t: number): void {
    try {
      body(t);
      consecutiveFaults = 0;
    } catch {
      // Close the section the throw left open so the profiler stays balanced.
      if (open !== null) end(open);
      diag.warnOnce('app/frame-fault');
      const s = host.state();
      const tripping = s === 'countdown' || s === 'live' || s === 'paused' || s === 'eliminated';
      consecutiveFaults = tripping ? consecutiveFaults + 1 : 0;
      if (consecutiveFaults >= FRAME_FAULT_TRIP) {
        consecutiveFaults = 0;
        diag.warnOnce('app/frame-fault-tripped');
        host.dispatch({ kind: 'frame-faults-tripped' });
      }
    }
    profiler.endFrame();
    host.afterFrame();
  }

  const tick = (t: number): void => {
    if (stopped) return;
    frame(t);
    deps.requestFrame(tick);
  };

  return {
    start() {
      if (running) {
        diag.count('app/ignored-event');
        return;
      }
      running = true;
      deps.requestFrame(tick);
    },
    stop() {
      stopped = true;
    },
    frame,
    resetTime() {
      last = null;
      clock.reset();
    },
    startBeat() {
      beat = 0;
    },
    fastForward(ticks) {
      const state = host.state();
      const session = host.session();
      if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_FAST_FORWARD) {
        diag.count('app/ignored-event');
        return;
      }
      if ((state !== 'countdown' && state !== 'live') || session === null || host.rebuilding()) {
        diag.count('app/ignored-event');
        return;
      }
      const sim = session.sim;
      for (let i = 0; i < ticks; i++) {
        neutral.tick = sim.snapshot().tick + 1;
        sim.step(neutral);
        if (sim.snapshot().phase === 'ended') break;
      }
      const events = sim.drainEvents();
      session.stats.ingest(events);
      hud.feed(events);
      detectPhase(events, sim.snapshot());
    },
  };
}
