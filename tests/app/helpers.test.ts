/** Pure app-shell helpers: view models, look scale, seeds, diagnostics, scope and yield. */
import { describe, expect, it, vi } from 'vitest';
import { createAppDiagnostics, APP_CODES } from '../../src/app/diagnostics';
import { featureFlags, wrapAudioEngine } from '../../src/app/features';
import { scopedLookScale } from '../../src/app/look-scale';
import { createScope } from '../../src/app/scope';
import { createSeedSource, isSeed } from '../../src/app/seed';
import {
  DEFAULT_SETUP,
  clockText,
  countdownVM,
  createLoadingProgress,
  endOfRoundVM,
  historyEntry,
  loadingComplete,
  loadingVM,
  mainMenuVM,
  pauseSummary,
  settingsVM,
} from '../../src/app/view-models';
import { createYield } from '../../src/app/yield';
import type { AudioEngine } from '../../src/audio';
import { DEFAULT_SETTINGS } from '../../src/settings';
import type { RoundStats } from '../../src/sim/stats';
import { recordingDiag } from './fakes';

const round = (over: Partial<RoundStats> = {}): RoundStats => ({
  kills: 3,
  deaths: 1,
  headshots: 1,
  shotsFired: 10,
  shotsHit: 4,
  accuracy: 0.4,
  damageDealt: 300,
  damageTaken: 200,
  armorLost: 50,
  enemiesTotal: 5,
  enemiesLeft: 2,
  killerId: 4 as RoundStats['killerId'],
  liveStartTick: 210,
  lastTick: 3000,
  durationSec: 46.5,
  outcome: 'defeat',
  ...over,
});

describe('view models', () => {
  it('loading rows keep order and labels, and complete only when all five are done', () => {
    const p = createLoadingProgress();
    const vm = loadingVM(p, null);
    expect(vm.steps.map((s) => s.id)).toEqual(['map', 'nav', 'assets', 'bots', 'shaders']);
    expect(vm.steps[0]?.label).toBe('Map geometry');
    expect(vm.steps[2]?.label).toBe('Assets');
    p.map = { progress: 1, state: 'done' };
    p.nav = { progress: 1, state: 'done' };
    p.assets = { progress: 1, state: 'done' };
    p.bots = { progress: 1, state: 'done' };
    expect(loadingComplete(p)).toBe(false);
    p.shaders = { progress: 1, state: 'done' };
    expect(loadingComplete(p)).toBe(true);
    p.map.progress = Number.NaN;
    expect(loadingVM(p, 'x').steps[0]?.progress).toBe(0);
  });

  it('pause summary uses labels and m:ss', () => {
    expect(pauseSummary(DEFAULT_SETUP, 125.2)).toBe(
      'Desert Compound · 5 bots · Normal · 2:06 left',
    );
    expect(pauseSummary({ ...DEFAULT_SETUP, bots: 1 }, -3)).toContain('1 bot ·');
    expect(clockText(Number.NaN)).toBe('0:00');
  });

  it('countdown shows whole seconds and GO at zero or live', () => {
    expect(countdownVM(2.2, false)).toEqual({ secondsLeft: 3, go: false });
    expect(countdownVM(0, false).go).toBe(true);
    expect(countdownVM(1, true).go).toBe(true);
    expect(countdownVM(Number.NaN, false).secondsLeft).toBe(0);
  });

  it('end of round maps RoundStats and SessionStats; accuracy is 0 with no shots', () => {
    const vm = endOfRoundVM(round(), 'defeat', { roundsWon: 1, roundsLost: 2 }, DEFAULT_SETUP);
    expect(vm).toMatchObject({
      outcome: 'defeat',
      botCount: 5,
      enemiesLeft: 2,
      killerId: 4,
      accuracy: 0.4,
      roundTimeSec: 46.5,
      session: { won: 1, lost: 2 },
    });
    expect(
      endOfRoundVM(
        round({ shotsFired: 0, accuracy: 0.9 }),
        'victory',
        { roundsWon: 0, roundsLost: 0 },
        DEFAULT_SETUP,
      ).accuracy,
    ).toBe(0);
  });

  it('history entry is schema version 1 from the committed round', () => {
    expect(historyEntry(round(), 'defeat', DEFAULT_SETUP, 'T')).toEqual({
      schemaVersion: 1,
      endedAt: 'T',
      map: 'desert-compound',
      bots: 5,
      difficulty: 'normal',
      outcome: 'defeat',
      kills: 3,
      accuracy: 0.4,
      durationSec: 46.5,
    });
    expect(historyEntry(round({ shotsFired: 0 }), 'victory', DEFAULT_SETUP, 'T').accuracy).toBe(0);
  });

  it('settings and menu VMs drop the storage line and history when the feature is cut', () => {
    const full = featureFlags(null);
    expect(full.audio).toBe(false);
    const cut = { ...full, persistence: false, history: false };
    expect(settingsVM(DEFAULT_SETTINGS, 'menu', cut, 'loaded').storage).toBeNull();
    expect(settingsVM(DEFAULT_SETTINGS, 'menu', full, 'loaded').storage).toBe('loaded');
    const s = settingsVM(DEFAULT_SETTINGS, 'menu', full, null);
    const history = { entries: [], status: 'fresh' as const };
    expect(mainMenuVM(DEFAULT_SETUP, full, s, history, 'v').history).toBe(history);
    expect(mainMenuVM(DEFAULT_SETUP, cut, s, history, 'v')).not.toHaveProperty('history');
  });
});

describe('look scale (FD-AS-Q1)', () => {
  it('is about 0.25 at FOV 90 with the 4x scope and finite across the range', () => {
    expect(scopedLookScale(90)).toBeCloseTo(0.25, 6);
    for (const f of [70, 80, 100, 110]) {
      const k = scopedLookScale(f);
      expect(k).toBeGreaterThan(0.2);
      expect(k).toBeLessThan(0.26);
    }
    expect(scopedLookScale(Number.NaN)).toBeGreaterThan(0);
  });
});

describe('seeds (FD-AS-Q2, SD-AS-14)', () => {
  it('draws a fresh seed per round and lets the seam override the next one only', () => {
    let n = 7;
    const diag = recordingDiag();
    const src = createSeedSource({
      getRandomValues: (a) => {
        a[0] = n++;
        return a;
      },
      fallback: () => 0,
      diag,
    });
    expect(src.next()).toBe(7);
    src.override(42);
    expect(src.next()).toBe(42);
    expect(src.next()).toBe(8);
    src.override(-1);
    src.override(1.5);
    src.override(2 ** 32);
    expect(src.next()).toBe(9);
    expect(diag.codes).toEqual([]);
  });

  it('falls back to wall-clock entropy and reports app/weak-seed', () => {
    const diag = recordingDiag();
    const src = createSeedSource({ getRandomValues: null, fallback: () => -5, diag });
    expect(isSeed(src.next())).toBe(true);
    expect(diag.codes).toEqual(['app/weak-seed']);
  });
});

describe('browser diagnostics (FD-AS-Q3)', () => {
  it('warns once per code, with no detail, prefixed', () => {
    const warn = vi.fn<(m: string) => void>();
    const d = createAppDiagnostics(warn);
    d.warnOnce('app/frame-fault', { n: 1 });
    d.warnOnce('app/frame-fault');
    d.count('app/ignored-event');
    expect(warn.mock.calls).toEqual([['[strikezone] app/frame-fault']]);
    expect(d.snapshot()).toEqual({ 'app/frame-fault': 2, 'app/ignored-event': 1 });
    expect(new Set(APP_CODES).size).toBe(APP_CODES.length);
  });

  it('defaults to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createAppDiagnostics().warnOnce('app/load-failed');
    expect(spy).toHaveBeenCalledWith('[strikezone] app/load-failed');
    spy.mockRestore();
  });
});

describe('DisposableScope', () => {
  it('removes listeners, cancels timers and disposes children once', async () => {
    const s = createScope();
    const target = new EventTarget();
    let hits = 0;
    s.on(
      target,
      'x',
      () => {
        hits += 1;
      },
      { capture: true },
    );
    let fired = false;
    s.timeout(() => {
      fired = true;
    }, 0);
    const cancel = s.timeout(() => {
      throw new Error('cancelled timer ran');
    }, 0);
    cancel();
    const c = s.child();
    c.add(() => {
      hits += 100;
    });
    expect(s.live()).toBe(3);
    target.dispatchEvent(new Event('x'));
    await new Promise((r) => setTimeout(r, 5));
    expect(fired).toBe(true);
    expect(s.live()).toBe(2);
    s.dispose();
    s.dispose();
    target.dispatchEvent(new Event('x'));
    expect(hits).toBe(101);
    expect(s.disposed).toBe(true);
    expect(s.live()).toBe(0);
    let late = 0;
    s.add(() => {
      late += 1;
    });
    s.on(target, 'x', () => undefined);
    const cancelLate = s.timeout(() => undefined, 0);
    cancelLate();
    expect(s.child().disposed).toBe(true);
    expect(late).toBe(1);
  });
});

describe('yield (PD-AS-10)', () => {
  it('uses scheduler.yield when present, else a scoped setTimeout(0)', async () => {
    const s = createScope();
    let used = 0;
    await createYield(
      {
        yield: () => {
          used += 1;
          return Promise.resolve();
        },
      },
      s,
    )();
    expect(used).toBe(1);
    await createYield(null, s)();
    s.dispose();
  });
});

describe('audio feature wrapper', () => {
  it('forwards calls, maps intents to cues and never lets unlock reject', async () => {
    const log: string[] = [];
    const engine: AudioEngine = {
      supported: true,
      unlock: () => Promise.reject(new Error('blocked')),
      play: () => log.push('play'),
      ui: (c) => log.push(`ui:${c}`),
      setVolumes: (m, s) => log.push(`v:${String(m)}/${String(s)}`),
      suspend: () => log.push('suspend'),
      dispose: () => log.push('dispose'),
    };
    const diag = recordingDiag();
    const a = wrapAudioEngine(engine, diag);
    a.unlock();
    await new Promise((r) => setImmediate(r));
    expect(diag.codes).toEqual(['app/audio-unlock-failed']);
    a.play([], { pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
    a.cue({ type: 'deploy' });
    a.error();
    a.setVolumes(1, 2);
    a.suspend();
    a.dispose();
    expect(log).toEqual(['play', 'ui:confirm', 'ui:error', 'v:1/2', 'suspend', 'dispose']);
    expect(featureFlags(a).audio).toBe(true);
  });
});
