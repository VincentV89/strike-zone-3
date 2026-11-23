/**
 * AppState machine (business-logic-model-app-shell §3, rows AS-T01..AS-T30,
 * plus AS-T31 from security-design-app-shell). A pure reducer: it reads no
 * DOM, timer or clock and returns effects as data, which app.ts runs in
 * order. Every row has a Node unit test in tests/app/machine.test.ts.
 *
 * Effects that release pointer lock come first in every row whose target is
 * menu, end, eliminated or loading-error (SD-AS-10), so the lock is free
 * before any screen mounts.
 */
import type { RoundOutcome, UiIntent } from '../contracts';
import type { LoadingStepId, MatchSetup } from '../ui/screens';

export type AppStateName =
  | 'boot'
  | 'unsupported'
  | 'menu'
  | 'loading'
  | 'loading-error'
  | 'ready'
  | 'countdown'
  | 'live'
  | 'paused'
  | 'eliminated'
  | 'end';

export interface AppModel {
  readonly state: AppStateName;
  /** State to return to from paused (countdown or live). */
  readonly resumeTo: 'countdown' | 'live' | null;
  /** A pointer-lock request is waiting for its answer. */
  readonly lockPending: boolean;
  /** The last request was refused (click-again hint). */
  readonly lockRefused: boolean;
  /** Pointer lock is held, as far as the machine knows. */
  readonly lockHeld: boolean;
  /** WebGL context lost in a round; Resume is ignored until restored. */
  readonly restoring: boolean;
  /** Play Again or Restart is rebuilding the round. */
  readonly rebuilding: boolean;
  readonly setup: MatchSetup | null;
  readonly failedStep: LoadingStepId | null;
  /** Step the next Retry starts from (a trip or failed rebuild re-runs the scene). */
  readonly retryFrom: LoadingStepId;
  readonly errorText: string | null;
}

export type AppEvent =
  | { readonly kind: 'boot-ok' }
  | { readonly kind: 'boot-no-webgl2' }
  | { readonly kind: 'intent'; readonly intent: UiIntent }
  | { readonly kind: 'loading-done' }
  | { readonly kind: 'loading-failed'; readonly step: LoadingStepId; readonly message: string }
  | { readonly kind: 'lock-granted' }
  | { readonly kind: 'lock-lost' }
  | { readonly kind: 'lock-error' }
  | { readonly kind: 'visibility-hidden' }
  | { readonly kind: 'sim-live' }
  | { readonly kind: 'sim-ended'; readonly outcome: RoundOutcome }
  | { readonly kind: 'eliminated-elapsed' }
  | { readonly kind: 'context-lost'; readonly step: LoadingStepId }
  | { readonly kind: 'context-restored' }
  | { readonly kind: 'rebuild-done' }
  | { readonly kind: 'rebuild-failed'; readonly step: LoadingStepId; readonly message: string }
  | { readonly kind: 'frame-faults-tripped' };

export type Effect =
  | { readonly kind: 'lock-exit' }
  | { readonly kind: 'request-lock' }
  | { readonly kind: 'audio-unlock' }
  | { readonly kind: 'audio-error' }
  | { readonly kind: 'start-loading'; readonly from: LoadingStepId }
  | { readonly kind: 'abort-loading' }
  | { readonly kind: 'dispose-session' }
  | { readonly kind: 'reset-clock' }
  | { readonly kind: 'clear-held' }
  | { readonly kind: 'focus-canvas' }
  | { readonly kind: 'commit-stats'; readonly outcome: RoundOutcome }
  | { readonly kind: 'discard-stats' }
  | { readonly kind: 'start-rebuild' }
  | { readonly kind: 'start-eliminated-beat' }
  | { readonly kind: 'ignored' };

export interface Transition {
  readonly next: AppModel;
  readonly effects: readonly Effect[];
}

export const INITIAL_MODEL: AppModel = Object.freeze({
  state: 'boot',
  resumeTo: null,
  lockPending: false,
  lockRefused: false,
  lockHeld: false,
  restoring: false,
  rebuilding: false,
  setup: null,
  failedStep: null,
  retryFrom: 'map',
  errorText: null,
});

export const MESSAGES = Object.freeze({
  invalidMap: 'This map failed validation.',
  spawnFailed: 'Could not place every bot on this map.',
  stepFailed: 'Loading failed.',
  graphicsReset: 'Graphics were reset.',
  roundFault: 'Something went wrong during the round.',
});

const LOCK_EXIT: Effect = { kind: 'lock-exit' };
const EFFECT = {
  requestLock: { kind: 'request-lock' },
  audioUnlock: { kind: 'audio-unlock' },
  audioError: { kind: 'audio-error' },
  abort: { kind: 'abort-loading' },
  dispose: { kind: 'dispose-session' },
  resetClock: { kind: 'reset-clock' },
  clearHeld: { kind: 'clear-held' },
  focusCanvas: { kind: 'focus-canvas' },
  discard: { kind: 'discard-stats' },
  rebuild: { kind: 'start-rebuild' },
  beat: { kind: 'start-eliminated-beat' },
} as const satisfies Record<string, Effect>;

const IGNORED: readonly Effect[] = Object.freeze([{ kind: 'ignored' }]);

function to(m: AppModel, patch: Partial<AppModel>, effects: readonly Effect[]): Transition {
  // A row that emits lock-exit leaves the lock released (SD-AS-10).
  const releases = effects.some((e) => e.kind === 'lock-exit');
  const next: AppModel = { ...m, ...patch, ...(releases ? { lockHeld: false } : {}) };
  return { next, effects };
}

function ignore(m: AppModel): Transition {
  return { next: m, effects: IGNORED };
}

const inRound = (s: AppStateName): s is 'countdown' | 'live' => s === 'countdown' || s === 'live';

/** Entering countdown or live from a granted lock (AS-T10, AS-T16, AS-T25). */
const ENTER_ROUND: readonly Effect[] = [EFFECT.resetClock, EFFECT.clearHeld, EFFECT.focusCanvas];

function onIntent(m: AppModel, intent: UiIntent): Transition {
  const s = m.state;
  switch (intent.type) {
    case 'start-game':
      // AS-T03
      if (s !== 'menu') return ignore(m);
      return to(m, { state: 'loading', setup: intent.setup, failedStep: null, errorText: null }, [
        { kind: 'start-loading', from: 'map' },
      ]);
    case 'cancel-loading':
      // AS-T06
      if (s !== 'loading') return ignore(m);
      return to(m, { state: 'menu' }, [LOCK_EXIT, EFFECT.abort, EFFECT.dispose]);
    case 'retry-loading':
      // AS-T07
      if (s !== 'loading-error') return ignore(m);
      return to(m, { state: 'loading', errorText: null, failedStep: null }, [
        { kind: 'start-loading', from: m.retryFrom },
      ]);
    case 'deploy':
      // AS-T09: the lock request runs synchronously inside the click.
      if (s !== 'ready' || m.lockPending) return ignore(m);
      return to(m, { lockPending: true, lockRefused: false }, [
        EFFECT.requestLock,
        EFFECT.audioUnlock,
      ]);
    case 'resume':
      // AS-T15
      if (s !== 'paused' || m.lockPending || m.restoring || m.rebuilding) return ignore(m);
      return to(m, { lockPending: true, lockRefused: false }, [
        EFFECT.requestLock,
        EFFECT.audioUnlock,
      ]);
    case 'restart-confirmed':
      // AS-T18: discard first, then lock inside the click, then rebuild.
      if (s !== 'paused' || m.rebuilding) return ignore(m);
      return to(m, { rebuilding: true, lockPending: true, lockRefused: false, restoring: false }, [
        EFFECT.discard,
        EFFECT.requestLock,
        EFFECT.audioUnlock,
        EFFECT.rebuild,
      ]);
    case 'leave-confirmed':
      // AS-T19
      if (s !== 'paused' || m.rebuilding) return ignore(m);
      return to(m, { state: 'menu', resumeTo: null, restoring: false, lockPending: false }, [
        LOCK_EXIT,
        EFFECT.discard,
        EFFECT.dispose,
      ]);
    case 'play-again':
      // AS-T23
      if (s !== 'end' || m.rebuilding) return ignore(m);
      return to(m, { rebuilding: true, lockPending: true, lockRefused: false }, [
        EFFECT.requestLock,
        EFFECT.audioUnlock,
        EFFECT.rebuild,
      ]);
    case 'main-menu':
      // AS-T08 (loading-error) and AS-T24 (end)
      if (s === 'loading-error' || (s === 'end' && !m.rebuilding)) {
        return to(m, { state: 'menu', errorText: null, failedStep: null }, [
          LOCK_EXIT,
          EFFECT.dispose,
        ]);
      }
      return ignore(m);
    case 'clear-history':
      // Handled by app.ts outside the machine; never a state change.
      return ignore(m);
  }
}

function onLockGranted(m: AppModel): Transition {
  if (!m.lockPending) return ignore(m);
  const patch = { lockPending: false, lockRefused: false, lockHeld: true };
  if (m.rebuilding) return to(m, patch, []); // AS-T25 waits for rebuild-done
  if (m.state === 'ready') return to(m, { ...patch, state: 'countdown' }, ENTER_ROUND); // AS-T10
  if (m.state === 'paused' && !m.restoring && m.resumeTo !== null) {
    // AS-T16
    return to(m, { ...patch, state: m.resumeTo, resumeTo: null }, ENTER_ROUND);
  }
  return to(m, patch, []);
}

function onLockError(m: AppModel): Transition {
  if (!m.lockPending) return ignore(m);
  // AS-T11, AS-T17; during a rebuild AS-T26 later sends the player to ready.
  if (m.state === 'ready' || m.state === 'paused' || m.rebuilding) {
    return to(m, { lockPending: false, lockRefused: true }, [EFFECT.audioError]);
  }
  return to(m, { lockPending: false }, []);
}

function pauseFromRound(m: AppModel, extra: readonly Effect[], restoring: boolean): Transition {
  const from = m.state === 'countdown' ? 'countdown' : 'live';
  return to(
    m,
    { state: 'paused', resumeTo: from, restoring, lockPending: false, lockHeld: false },
    [EFFECT.clearHeld, ...extra],
  );
}

function onRebuildDone(m: AppModel): Transition {
  if (!m.rebuilding) return ignore(m);
  if (m.lockHeld) {
    // AS-T25
    return to(
      m,
      { state: 'countdown', rebuilding: false, resumeTo: null, restoring: false },
      ENTER_ROUND,
    );
  }
  // AS-T26: a pending request may still be granted from the Ready gate (AS-T10).
  return to(m, { state: 'ready', rebuilding: false, resumeTo: null, restoring: false }, []);
}

function toLoadingError(
  m: AppModel,
  step: LoadingStepId,
  message: string,
  retryFrom: LoadingStepId,
  extra: readonly Effect[],
): Transition {
  return to(
    m,
    {
      state: 'loading-error',
      failedStep: step,
      retryFrom,
      errorText: message,
      rebuilding: false,
      lockPending: false,
      restoring: false,
      resumeTo: null,
    },
    [LOCK_EXIT, ...extra, EFFECT.audioError],
  );
}

/** Retry after a loading failure resumes at the failed step; map and nav run as one group. */
export function retryStepFor(step: LoadingStepId): LoadingStepId {
  // nav and assets restart at map (BR-G-14a): map and nav are one group, and assets are
  // re-applied from the library after the rebuild, with zero fetches for ready entries.
  return step === 'nav' || step === 'assets' ? 'map' : step;
}

export function transition(m: AppModel, e: AppEvent): Transition {
  const s = m.state;
  switch (e.kind) {
    case 'boot-ok':
      return s === 'boot' ? to(m, { state: 'menu' }, []) : ignore(m); // AS-T01
    case 'boot-no-webgl2':
      return s === 'boot' ? to(m, { state: 'unsupported' }, []) : ignore(m); // AS-T02
    case 'intent':
      return onIntent(m, e.intent);
    case 'loading-done':
      // AS-T04
      if (s !== 'loading') return ignore(m);
      return to(m, { state: 'ready', lockRefused: false, lockPending: false }, []);
    case 'loading-failed':
      // AS-T05
      if (s !== 'loading') return ignore(m);
      return toLoadingError(m, e.step, e.message, retryStepFor(e.step), []);
    case 'lock-granted':
      return onLockGranted(m);
    case 'lock-error':
      return onLockError(m);
    case 'lock-lost':
      // Unlock filter: only countdown and live pause (AS-T13).
      if (m.rebuilding) return to(m, { lockHeld: false }, []);
      if (inRound(s)) return pauseFromRound(m, [], false);
      return m.lockHeld ? to(m, { lockHeld: false }, []) : ignore(m);
    case 'visibility-hidden':
      // AS-T14
      if (!inRound(s) || m.rebuilding) return ignore(m);
      return pauseFromRound(m, [LOCK_EXIT], false);
    case 'sim-live':
      return s === 'countdown' ? to(m, { state: 'live' }, []) : ignore(m); // AS-T12
    case 'sim-ended':
      if (s !== 'live') return ignore(m);
      if (e.outcome === 'defeat') {
        // AS-T20
        return to(m, { state: 'eliminated' }, [
          LOCK_EXIT,
          { kind: 'commit-stats', outcome: e.outcome },
          EFFECT.beat,
        ]);
      }
      // AS-T21
      return to(m, { state: 'end' }, [LOCK_EXIT, { kind: 'commit-stats', outcome: e.outcome }]);
    case 'eliminated-elapsed':
      return s === 'eliminated' ? to(m, { state: 'end' }, [LOCK_EXIT]) : ignore(m); // AS-T22
    case 'rebuild-done':
      return onRebuildDone(m);
    case 'rebuild-failed':
      if (!m.rebuilding) return ignore(m);
      return toLoadingError(m, e.step, e.message, 'map', [EFFECT.dispose]);
    case 'context-lost':
      if (s === 'loading') {
        // AS-T27
        return toLoadingError(m, e.step, MESSAGES.graphicsReset, retryStepFor(e.step), [
          EFFECT.abort,
        ]);
      }
      if (inRound(s) && !m.rebuilding) return pauseFromRound(m, [LOCK_EXIT], true); // AS-T28
      if (s === 'paused') return to(m, { restoring: true }, []);
      return ignore(m);
    case 'context-restored':
      // AS-T29
      return s === 'paused' && m.restoring ? to(m, { restoring: false }, []) : ignore(m);
    case 'frame-faults-tripped':
      // AS-T31 (NFR-AS-D1 = A)
      if (s !== 'countdown' && s !== 'live' && s !== 'paused' && s !== 'eliminated') {
        return ignore(m);
      }
      return toLoadingError(m, 'bots', MESSAGES.roundFault, 'map', [
        EFFECT.discard,
        EFFECT.dispose,
      ]);
  }
}

/** Screens per state (frontend-components-app-shell §2). */
export type BaseScreen =
  'boot' | 'menu' | 'loading' | 'ready' | 'countdown' | 'pause' | 'eliminated' | 'end' | null;

export function screenFor(s: AppStateName): BaseScreen {
  switch (s) {
    case 'boot':
      return null;
    case 'unsupported':
      return 'boot';
    case 'menu':
      return 'menu';
    case 'loading':
    case 'loading-error':
      return 'loading';
    case 'ready':
      return 'ready';
    case 'countdown':
      return 'countdown';
    case 'live':
      return null;
    case 'paused':
      return 'pause';
    case 'eliminated':
      return 'eliminated';
    case 'end':
      return 'end';
  }
}

export type InputMapName = 'none' | 'ui' | 'look-only' | 'gameplay';

export function inputMapFor(s: AppStateName): InputMapName {
  switch (s) {
    case 'countdown':
      return 'look-only';
    case 'live':
      return 'gameplay';
    case 'boot':
    case 'unsupported':
    case 'eliminated':
      return 'none';
    default:
      return 'ui';
  }
}

/** The HUD shows in and around a round (frontend-components-app-shell §2). */
export function hudVisibleIn(s: AppStateName): boolean {
  return s === 'countdown' || s === 'live' || s === 'paused' || s === 'eliminated';
}
