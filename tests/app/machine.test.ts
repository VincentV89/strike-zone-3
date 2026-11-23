/** AppState machine: one test per row AS-T01..AS-T31 plus the guards (business-logic-model-app-shell §3). */
import { describe, expect, it } from 'vitest';
import type { UiIntent } from '../../src/contracts';
import {
  INITIAL_MODEL,
  MESSAGES,
  hudVisibleIn,
  inputMapFor,
  retryStepFor,
  screenFor,
  transition,
  type AppEvent,
  type AppModel,
  type AppStateName,
} from '../../src/app/machine';

const SETUP = { map: 'desert-compound', bots: 5, difficulty: 'normal' } as const;

function model(state: AppStateName, over: Partial<AppModel> = {}): AppModel {
  return { ...INITIAL_MODEL, state, setup: SETUP, ...over };
}
const intent = (i: UiIntent): AppEvent => ({ kind: 'intent', intent: i });
const kinds = (m: AppModel, e: AppEvent): string[] => transition(m, e).effects.map((x) => x.kind);
const next = (m: AppModel, e: AppEvent): AppModel => transition(m, e).next;

describe('AppState machine rows', () => {
  it('AS-T01 boot → menu on boot-ok', () => {
    expect(next(INITIAL_MODEL, { kind: 'boot-ok' }).state).toBe('menu');
  });

  it('AS-T02 boot → unsupported on boot-no-webgl2 (terminal)', () => {
    const m = next(INITIAL_MODEL, { kind: 'boot-no-webgl2' });
    expect(m.state).toBe('unsupported');
    expect(next(m, intent({ type: 'start-game', setup: SETUP })).state).toBe('unsupported');
  });

  it('AS-T03 menu → loading on start-game, remembers the setup', () => {
    const setup = { map: 'industrial-warehouse', bots: 20, difficulty: 'hard' } as const;
    const t = transition(model('menu', { setup: null }), intent({ type: 'start-game', setup }));
    expect(t.next.state).toBe('loading');
    expect(t.next.setup).toEqual(setup);
    expect(t.effects).toEqual([{ kind: 'start-loading', from: 'map' }]);
  });

  it('AS-T04 loading → ready on loading-done', () => {
    expect(next(model('loading'), { kind: 'loading-done' }).state).toBe('ready');
  });

  it('AS-T05 loading → loading-error with the failed step and message', () => {
    const m = next(model('loading'), { kind: 'loading-failed', step: 'shaders', message: 'x' });
    expect(m).toMatchObject({
      state: 'loading-error',
      failedStep: 'shaders',
      retryFrom: 'shaders',
    });
    expect(m.errorText).toBe('x');
  });

  it('AS-T05 with step assets: the error marks assets and retry restarts at map (BR-G-14a)', () => {
    const m = next(model('loading'), { kind: 'loading-failed', step: 'assets', message: 'x' });
    expect(m).toMatchObject({ state: 'loading-error', failedStep: 'assets', retryFrom: 'map' });
    expect(retryStepFor('assets')).toBe('map');
  });

  it('AS-T06 loading → menu on cancel-loading: lock exit, abort, dispose', () => {
    const e = intent({ type: 'cancel-loading' });
    expect(next(model('loading'), e).state).toBe('menu');
    expect(kinds(model('loading'), e)).toEqual(['lock-exit', 'abort-loading', 'dispose-session']);
  });

  it('AS-T07 retry restarts at the failed step (nav restarts its map group)', () => {
    const failed = next(model('loading'), { kind: 'loading-failed', step: 'nav', message: 'x' });
    const t = transition(failed, intent({ type: 'retry-loading' }));
    expect(t.next.state).toBe('loading');
    expect(t.effects).toEqual([{ kind: 'start-loading', from: 'map' }]);
    expect(retryStepFor('bots')).toBe('bots');
  });

  it('AS-T08 loading-error → menu on main-menu', () => {
    const m = model('loading-error', { failedStep: 'bots', errorText: 'x' });
    expect(next(m, intent({ type: 'main-menu' })).state).toBe('menu');
    expect(kinds(m, intent({ type: 'main-menu' }))).toEqual(['lock-exit', 'dispose-session']);
  });

  it('AS-T09 ready + deploy requests the lock first, then unlocks audio', () => {
    const t = transition(model('ready'), intent({ type: 'deploy' }));
    expect(t.effects.map((x) => x.kind)).toEqual(['request-lock', 'audio-unlock']);
    expect(t.next).toMatchObject({ state: 'ready', lockPending: true });
  });

  it('AS-T10 ready + lock-granted → countdown with clock reset and held input cleared', () => {
    const m = model('ready', { lockPending: true });
    const t = transition(m, { kind: 'lock-granted' });
    expect(t.next).toMatchObject({ state: 'countdown', lockHeld: true, lockPending: false });
    expect(t.effects.map((x) => x.kind)).toEqual(['reset-clock', 'clear-held', 'focus-canvas']);
  });

  it('AS-T11 ready + lock-error sets the click-again hint and plays the error cue', () => {
    const t = transition(model('ready', { lockPending: true }), { kind: 'lock-error' });
    expect(t.next).toMatchObject({ state: 'ready', lockRefused: true, lockPending: false });
    expect(t.effects.map((x) => x.kind)).toEqual(['audio-error']);
  });

  it('AS-T12 countdown → live on sim-live', () => {
    expect(next(model('countdown'), { kind: 'sim-live' }).state).toBe('live');
  });

  it.each(['countdown', 'live'] as const)('AS-T13 %s + lock-lost → paused', (s) => {
    const t = transition(model(s, { lockHeld: true }), { kind: 'lock-lost' });
    expect(t.next).toMatchObject({ state: 'paused', resumeTo: s, lockHeld: false });
    expect(t.effects.map((x) => x.kind)).toEqual(['clear-held']);
  });

  it('AS-T14 visibility-hidden pauses and releases the lock', () => {
    const t = transition(model('live', { lockHeld: true }), { kind: 'visibility-hidden' });
    expect(t.next).toMatchObject({ state: 'paused', resumeTo: 'live' });
    expect(t.effects.map((x) => x.kind)).toEqual(['clear-held', 'lock-exit']);
  });

  it('AS-T15 paused + resume requests the lock', () => {
    const t = transition(model('paused', { resumeTo: 'live' }), intent({ type: 'resume' }));
    expect(t.effects.map((x) => x.kind)).toEqual(['request-lock', 'audio-unlock']);
    expect(t.next.lockPending).toBe(true);
  });

  it('AS-T16 paused + lock-granted returns to resumeTo', () => {
    const m = model('paused', { resumeTo: 'countdown', lockPending: true });
    const t = transition(m, { kind: 'lock-granted' });
    expect(t.next).toMatchObject({ state: 'countdown', resumeTo: null });
    expect(t.effects.map((x) => x.kind)).toEqual(['reset-clock', 'clear-held', 'focus-canvas']);
  });

  it('AS-T17 paused + lock-error stays paused with the refused hint', () => {
    const m = model('paused', { resumeTo: 'live', lockPending: true });
    expect(next(m, { kind: 'lock-error' })).toMatchObject({ state: 'paused', lockRefused: true });
  });

  it('AS-T18 restart-confirmed discards, requests the lock and rebuilds', () => {
    const t = transition(
      model('paused', { resumeTo: 'live' }),
      intent({ type: 'restart-confirmed' }),
    );
    expect(t.effects.map((x) => x.kind)).toEqual([
      'discard-stats',
      'request-lock',
      'audio-unlock',
      'start-rebuild',
    ]);
    expect(t.next).toMatchObject({ state: 'paused', rebuilding: true });
  });

  it('AS-T19 leave-confirmed → menu: lock exit first, discard, dispose', () => {
    const e = intent({ type: 'leave-confirmed' });
    expect(next(model('paused'), e).state).toBe('menu');
    expect(kinds(model('paused'), e)).toEqual(['lock-exit', 'discard-stats', 'dispose-session']);
  });

  it('AS-T20 live + defeat → eliminated: lock exit before commit and beat', () => {
    const e: AppEvent = { kind: 'sim-ended', outcome: 'defeat' };
    expect(next(model('live'), e).state).toBe('eliminated');
    expect(kinds(model('live'), e)).toEqual(['lock-exit', 'commit-stats', 'start-eliminated-beat']);
  });

  it.each(['victory', 'time-expired'] as const)('AS-T21 live + %s → end', (outcome) => {
    const t = transition(model('live'), { kind: 'sim-ended', outcome });
    expect(t.next.state).toBe('end');
    expect(t.effects).toEqual([{ kind: 'lock-exit' }, { kind: 'commit-stats', outcome }]);
  });

  it('AS-T22 eliminated → end after the beat', () => {
    expect(next(model('eliminated'), { kind: 'eliminated-elapsed' }).state).toBe('end');
  });

  it('AS-T23 end + play-again requests the lock and rebuilds', () => {
    const t = transition(model('end'), intent({ type: 'play-again' }));
    expect(t.effects.map((x) => x.kind)).toEqual(['request-lock', 'audio-unlock', 'start-rebuild']);
    expect(t.next.rebuilding).toBe(true);
  });

  it('AS-T24 end + main-menu → menu, setup kept', () => {
    const m = next(model('end'), intent({ type: 'main-menu' }));
    expect(m.state).toBe('menu');
    expect(m.setup).toEqual(SETUP);
  });

  it('AS-T25 rebuild-done with the lock held → countdown', () => {
    const granted = next(model('end', { rebuilding: true, lockPending: true }), {
      kind: 'lock-granted',
    });
    expect(granted).toMatchObject({ state: 'end', lockHeld: true });
    const t = transition(granted, { kind: 'rebuild-done' });
    expect(t.next).toMatchObject({ state: 'countdown', rebuilding: false });
    expect(t.effects.map((x) => x.kind)).toEqual(['reset-clock', 'clear-held', 'focus-canvas']);
  });

  it('AS-T26 rebuild-done without the lock → ready with the refused hint', () => {
    const refused = next(model('paused', { rebuilding: true, lockPending: true }), {
      kind: 'lock-error',
    });
    const m = next(refused, { kind: 'rebuild-done' });
    expect(m).toMatchObject({ state: 'ready', lockRefused: true });
    // A request still pending at rebuild-done is granted from the Ready gate (AS-T10).
    const pending = next(model('end', { rebuilding: true, lockPending: true }), {
      kind: 'rebuild-done',
    });
    expect(next(pending, { kind: 'lock-granted' }).state).toBe('countdown');
  });

  it('AS-T27 loading + context-lost → loading-error at the current step', () => {
    const m = next(model('loading'), { kind: 'context-lost', step: 'shaders' });
    expect(m).toMatchObject({ state: 'loading-error', failedStep: 'shaders' });
    expect(m.errorText).toBe(MESSAGES.graphicsReset);
  });

  it('AS-T27 with step assets: Graphics reset, retry from map (BR-G-14a)', () => {
    const m = next(model('loading'), { kind: 'context-lost', step: 'assets' });
    expect(m).toMatchObject({ state: 'loading-error', failedStep: 'assets', retryFrom: 'map' });
    expect(m.errorText).toBe(MESSAGES.graphicsReset);
  });

  it('AS-T28 live + context-lost → paused with restoring; resume ignored', () => {
    const m = next(model('live', { lockHeld: true }), { kind: 'context-lost', step: 'map' });
    expect(m).toMatchObject({ state: 'paused', restoring: true });
    expect(kinds(m, intent({ type: 'resume' }))).toEqual(['ignored']);
  });

  it('AS-T29 paused + context-restored clears restoring', () => {
    const m = next(model('paused', { restoring: true }), { kind: 'context-restored' });
    expect(m.restoring).toBe(false);
  });

  it('AS-T30 unlisted events change nothing and are counted', () => {
    const m = model('menu');
    const t = transition(m, { kind: 'sim-live' });
    expect(t.next).toBe(m);
    expect(t.effects).toEqual([{ kind: 'ignored' }]);
  });

  it.each(['countdown', 'live', 'paused', 'eliminated'] as const)(
    'AS-T31 %s + frame-faults-tripped → loading-error: lock exit, discard, error cue',
    (s) => {
      const t = transition(model(s), { kind: 'frame-faults-tripped' });
      expect(t.next).toMatchObject({
        state: 'loading-error',
        failedStep: 'bots',
        retryFrom: 'map',
      });
      expect(t.next.errorText).toBe(MESSAGES.roundFault);
      expect(t.effects.map((x) => x.kind)).toEqual([
        'lock-exit',
        'discard-stats',
        'dispose-session',
        'audio-error',
      ]);
    },
  );

  it('AS-T31 is ignored outside a round', () => {
    expect(kinds(model('menu'), { kind: 'frame-faults-tripped' })).toEqual(['ignored']);
  });

  it('a failed rebuild goes to loading-error and retries from map', () => {
    const m = next(model('end', { rebuilding: true }), {
      kind: 'rebuild-failed',
      step: 'shaders',
      message: 'x',
    });
    expect(m).toMatchObject({ state: 'loading-error', rebuilding: false, retryFrom: 'map' });
  });
});

describe('guards', () => {
  it('unlock filter: lock-lost outside countdown/live never pauses', () => {
    for (const s of ['menu', 'ready', 'end', 'eliminated', 'paused', 'loading'] as const) {
      expect(next(model(s), { kind: 'lock-lost' }).state).toBe(s);
    }
  });

  it('pending lock: a second deploy or resume is ignored', () => {
    expect(kinds(model('ready', { lockPending: true }), intent({ type: 'deploy' }))).toEqual([
      'ignored',
    ]);
    expect(kinds(model('paused', { lockPending: true }), intent({ type: 'resume' }))).toEqual([
      'ignored',
    ]);
  });

  it('rebuilding: intents and lock-lost do not change state', () => {
    const m = model('paused', { rebuilding: true, lockHeld: true });
    expect(kinds(m, intent({ type: 'restart-confirmed' }))).toEqual(['ignored']);
    expect(kinds(m, intent({ type: 'leave-confirmed' }))).toEqual(['ignored']);
    expect(next(m, { kind: 'lock-lost' })).toMatchObject({ state: 'paused', lockHeld: false });
    expect(kinds(model('end', { rebuilding: true }), intent({ type: 'play-again' }))).toEqual([
      'ignored',
    ]);
  });

  it('lock-granted with no pending request is ignored', () => {
    expect(kinds(model('ready'), { kind: 'lock-granted' })).toEqual(['ignored']);
    expect(kinds(model('ready'), { kind: 'lock-error' })).toEqual(['ignored']);
  });

  it('SD-AS-10: every row into menu, end, eliminated or loading-error starts with lock-exit', () => {
    const states: AppStateName[] = [
      'boot',
      'menu',
      'loading',
      'loading-error',
      'ready',
      'countdown',
      'live',
      'paused',
      'eliminated',
      'end',
    ];
    const events: AppEvent[] = [
      intent({ type: 'cancel-loading' }),
      intent({ type: 'main-menu' }),
      intent({ type: 'leave-confirmed' }),
      { kind: 'sim-ended', outcome: 'defeat' },
      { kind: 'sim-ended', outcome: 'victory' },
      { kind: 'eliminated-elapsed' },
      { kind: 'loading-failed', step: 'map', message: 'x' },
      { kind: 'context-lost', step: 'map' },
      { kind: 'frame-faults-tripped' },
      { kind: 'rebuild-failed', step: 'map', message: 'x' },
    ];
    const releasing = new Set(['menu', 'end', 'eliminated', 'loading-error']);
    let checked = 0;
    for (const s of states) {
      for (const e of events) {
        const m = model(s, { rebuilding: e.kind === 'rebuild-failed' });
        const t = transition(m, e);
        if (t.next.state === s || !releasing.has(t.next.state)) continue;
        checked += 1;
        expect(t.effects[0], `${s} --${e.kind}--> ${t.next.state}`).toEqual({ kind: 'lock-exit' });
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('Esc never resumes: no machine event requests the lock without an intent', () => {
    const nonIntent: AppEvent[] = [
      { kind: 'lock-lost' },
      { kind: 'visibility-hidden' },
      { kind: 'context-restored' },
      { kind: 'rebuild-done' },
      { kind: 'loading-done' },
    ];
    for (const e of nonIntent) {
      for (const s of ['paused', 'ready', 'live'] as const) {
        expect(kinds(model(s), e)).not.toContain('request-lock');
      }
    }
  });

  it('clear-history never changes state', () => {
    expect(next(model('menu'), intent({ type: 'clear-history' })).state).toBe('menu');
  });
});

describe('state tables', () => {
  it('maps each state to a screen, input map and HUD visibility', () => {
    expect(screenFor('live')).toBeNull();
    expect(screenFor('boot')).toBeNull();
    expect(screenFor('unsupported')).toBe('boot');
    expect(screenFor('loading-error')).toBe('loading');
    expect(screenFor('paused')).toBe('pause');
    expect(inputMapFor('countdown')).toBe('look-only');
    expect(inputMapFor('live')).toBe('gameplay');
    expect(inputMapFor('eliminated')).toBe('none');
    expect(inputMapFor('menu')).toBe('ui');
    expect(hudVisibleIn('paused')).toBe(true);
    expect(hudVisibleIn('end')).toBe(false);
  });
});
