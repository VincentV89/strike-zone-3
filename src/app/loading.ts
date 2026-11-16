/**
 * Loading pipeline (business-logic-model-app-shell §5, story-loading-screen).
 * Four steps with real progress: map (geometry + renderer.buildMap), nav
 * (the nav bake), bots (simulation, stats, actors) and shaders (precompile).
 * map and nav share one prepareMapAsync call and run as one group. Each
 * step boundary is a fault boundary: a throw, a rejection or an expected
 * failure becomes `failed(step)`, never an uncaught error (RL-AS-05).
 * Retry starts at the failed step and keeps the steps already done.
 */
import type { MapId } from '../contracts';
import type { Diagnostics, Result } from '../core';
import type { GameRenderer } from '../render';
import type { PrepareOptions, PreparedMap } from '../sim';
import type { LoadingStepId } from '../ui/screens';
import { MESSAGES } from './machine';
import type { RoundSession } from './round-session';
import { createLoadingProgress, LOADING_STEPS, type LoadingProgress } from './view-models';

export type PrepareFn = (
  id: MapId,
  opts: PrepareOptions,
) => Promise<Result<PreparedMap, 'ABORTED' | 'INVALID_MAP'>>;

export interface LoaderDeps {
  readonly prepare: PrepareFn;
  readonly renderer: Pick<GameRenderer, 'buildMap' | 'precompile' | 'disposeRound'>;
  readonly createSession: (
    prepared: PreparedMap,
  ) => Result<RoundSession, 'SPAWN_ALLOCATION_FAILED'>;
  readonly disposeSession: (s: RoundSession) => void;
  readonly yieldFn: () => Promise<void>;
  readonly now: () => number;
  readonly diag: Diagnostics;
  readonly onProgress: (p: Readonly<LoadingProgress>) => void;
}

export type LoadOutcome =
  | { readonly kind: 'done'; readonly session: RoundSession }
  | { readonly kind: 'failed'; readonly step: LoadingStepId; readonly message: string }
  | { readonly kind: 'aborted' };

export interface Loader {
  /** Runs from `from` to the end. The session in a `done` outcome belongs to the caller. */
  run(map: MapId, from: LoadingStepId, signal: AbortSignal): Promise<LoadOutcome>;
  progress(): Readonly<LoadingProgress>;
  /** The step running now, or the last one that ran. */
  current(): LoadingStepId;
  /** Forgets the built scene and any half-built session (cancel, Main Menu). */
  reset(): void;
}

/** A function, so checks after an await are not narrowed away. */
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

const ABORTED: LoadOutcome = Object.freeze({ kind: 'aborted' });

export function createLoader(deps: LoaderDeps): Loader {
  let progress = createLoadingProgress();
  let prepared: PreparedMap | null = null;
  let preparedFor: MapId | null = null;
  let mapBuilt = false;
  let session: RoundSession | null = null;
  let current: LoadingStepId = 'map';

  const emit = (): void => {
    deps.onProgress(progress);
  };

  function set(step: LoadingStepId, value: number, state = progress[step].state): void {
    const p = progress[step];
    p.progress = Math.max(p.state === 'done' ? 1 : 0, value);
    p.state = state;
    emit();
  }

  function dropSession(): void {
    if (session === null) return;
    deps.disposeSession(session);
    session = null;
  }

  function dropScene(): void {
    dropSession();
    if (mapBuilt) deps.renderer.disposeRound();
    mapBuilt = false;
  }

  function fail(step: LoadingStepId, message: string, code = 'app/load-failed'): LoadOutcome {
    progress[step].state = 'failed';
    emit();
    deps.diag.warnOnce(code);
    return { kind: 'failed', step, message };
  }

  function aborted(): LoadOutcome {
    dropScene();
    return ABORTED;
  }

  async function runMapGroup(map: MapId, signal: AbortSignal): Promise<LoadOutcome | null> {
    dropScene();
    current = 'map';
    set('map', 0, 'running');
    const nav = { started: false };
    let result: Result<PreparedMap, 'ABORTED' | 'INVALID_MAP'>;
    try {
      result = await deps.prepare(map, {
        signal,
        yieldFn: deps.yieldFn,
        now: deps.now,
        diag: deps.diag,
        onProgress: (step, f) => {
          if (step === 'map-geometry') {
            set('map', 0.5 * f);
            return;
          }
          if (!nav.started) {
            nav.started = true;
            current = 'nav';
          }
          set('nav', f, f >= 1 ? 'done' : 'running');
        },
      });
    } catch {
      return fail(nav.started ? 'nav' : 'map', MESSAGES.stepFailed);
    }
    if (isAborted(signal)) return aborted();
    if (!result.ok) {
      if (result.error === 'ABORTED') return aborted();
      return fail('nav', MESSAGES.invalidMap);
    }
    prepared = result.value;
    preparedFor = map;
    set('nav', 1, 'done');
    current = 'map';
    try {
      await deps.renderer.buildMap(prepared.def);
    } catch {
      return fail('map', MESSAGES.stepFailed);
    }
    mapBuilt = true;
    if (isAborted(signal)) return aborted();
    set('map', 1, 'done');
    return null;
  }

  function runBots(): LoadOutcome | null {
    current = 'bots';
    dropSession();
    set('bots', 0, 'running');
    if (prepared === null) return fail('bots', MESSAGES.stepFailed);
    try {
      const s = deps.createSession(prepared);
      if (!s.ok) return fail('bots', MESSAGES.spawnFailed);
      session = s.value;
    } catch {
      return fail('bots', MESSAGES.stepFailed);
    }
    set('bots', 1, 'done');
    return null;
  }

  async function runShaders(signal: AbortSignal): Promise<LoadOutcome | null> {
    current = 'shaders';
    set('shaders', 0, 'running');
    try {
      await deps.renderer.precompile();
    } catch {
      return fail('shaders', MESSAGES.stepFailed);
    }
    if (isAborted(signal)) return aborted();
    set('shaders', 1, 'done');
    return null;
  }

  return {
    async run(map, from, signal) {
      if (preparedFor !== map) {
        dropScene();
        prepared = null;
        preparedFor = null;
        from = 'map';
      }
      const start = from === 'nav' ? 'map' : from;
      const startIdx = LOADING_STEPS.indexOf(start);
      for (const id of LOADING_STEPS.slice(startIdx)) {
        progress[id].progress = 0;
        progress[id].state = 'pending';
      }
      emit();
      if (isAborted(signal)) return aborted();
      if (start === 'map') {
        const r = await runMapGroup(map, signal);
        if (r !== null) return r;
      }
      if (start === 'map' || start === 'bots') {
        const r = runBots();
        if (r !== null) return r;
      }
      if (session === null) return fail('bots', MESSAGES.stepFailed);
      const r = await runShaders(signal);
      if (r !== null) return r;
      const done = session;
      session = null; // ownership moves to the caller
      return { kind: 'done', session: done };
    },
    progress: () => progress,
    current: () => current,
    reset() {
      dropScene();
      progress = createLoadingProgress();
      current = 'map';
    },
  };
}
