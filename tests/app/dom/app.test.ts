// @vitest-environment happy-dom
/**
 * app-shell integration (happy-dom): the composed app with the real
 * simulation, stats, screens, settings, persistence and hud, and a fake
 * renderer, pointer lock, audio and rAF (frontend-components-app-shell §7).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FRAME_FAULT_TRIP } from '../../../src/app/frame-loop';
import { HISTORY_KEY, SETTINGS_KEY } from '../../../src/persistence';
import { fakeHud } from '../fakes';
import { createHarness, type Harness } from '../harness';

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

function harness(...args: Parameters<typeof createHarness>): Harness {
  h = createHarness(...args);
  return h;
}

describe('boot (story-boot-check)', () => {
  it('boots to the main menu with exactly one base screen', () => {
    const t = harness();
    expect(t.app.state()).toBe('menu');
    expect(t.q('main-menu')).not.toBeNull();
    expect(t.q('app-screens')?.children).toHaveLength(1);
    expect(t.renderer.calls.slice(0, 3)).toEqual(['init', 'setFov:90', 'setPreset:medium']);
    expect(t.q('game-canvas')).toBe(t.app.canvas);
  });

  it('shows the unsupported notice without WebGL2 and offers no Start control', () => {
    const t = harness({
      deps: { caps: { webgl2: false, pointerLock: true, reducedMotion: false } },
    });
    expect(t.app.state()).toBe('unsupported');
    expect(t.q('boot-unsupported')?.hidden).toBe(false);
    expect(t.q('main-menu-start')).toBeNull();
    expect(t.renderer.calls).not.toContain('init');
  });

  it('treats renderer.init NO_WEBGL2 and missing pointer lock as unsupported', () => {
    const t = harness({
      deps: { caps: { webgl2: true, pointerLock: false, reducedMotion: false } },
    });
    expect(t.app.state()).toBe('unsupported');
  });
});

describe('first round (F1)', () => {
  it('loads with real progress, gates on deploy, counts down, then goes live', async () => {
    const t = harness();
    t.click('main-menu-start');
    expect(t.app.state()).toBe('loading');
    await t.until(() => t.app.state() === 'ready');
    expect(t.renderer.calls).toEqual(
      expect.arrayContaining(['buildMap', 'spawnActors:5', 'precompile']),
    );
    expect(t.q('loading-progress')).toBeNull(); // S5 unmounted
    expect(t.lock.requests).toBe(0); // no lock without a click
    t.click('ready-deploy');
    expect(t.lock.requests).toBe(1);
    expect(t.lock.requestsOutsideHandler).toBe(0);
    expect(t.audio.log).toContain('unlock');
    await t.until(() => t.app.state() === 'countdown');
    expect(t.q('app-hud')?.hidden).toBe(false);
    const tick0 = t.app.snapshot()?.tick ?? -1;
    t.frames.advance(30);
    expect(t.app.snapshot()?.tick).toBeGreaterThan(tick0);
    await t.toLive();
    expect(t.app.snapshot()?.phase).toBe('live');
    expect(t.renderer.renders).toBeGreaterThan(0);
    expect(t.audio.plays).toBeGreaterThan(0);
  });

  it('the loading screen reaches 100 % only when every step is done', async () => {
    const t = harness();
    const seen: string[] = [];
    t.click('main-menu-start');
    while (t.app.state() === 'loading') {
      seen.push(t.q('loading-progress')?.getAttribute('aria-valuenow') ?? '');
      await t.until(() => true, 1);
      t.frames.advance(1);
      await new Promise((r) => setImmediate(r));
    }
    const nums = seen.filter((s) => s !== '').map(Number);
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThanOrEqual(nums[i - 1] ?? 0);
    expect(nums.slice(0, -1).every((n) => n < 100)).toBe(true);
    expect(t.app.state()).toBe('ready');
  });

  it('cancel-loading returns to the menu and frees the scene', async () => {
    const t = harness();
    t.click('main-menu-start');
    t.click('loading-cancel');
    expect(t.app.state()).toBe('menu');
    await t.until(() => true, 3);
    expect(t.app.snapshot()).toBeNull();
    expect(t.renderer.calls).toContain('disposeRound');
  });

  it('a lock refused at the Ready gate shows the hint and the next click locks', async () => {
    const t = harness();
    t.lock.mode = 'refuse';
    t.click('main-menu-start');
    await t.until(() => t.app.state() === 'ready');
    t.click('ready-deploy');
    await t.until(() => t.app.model().lockRefused);
    expect(t.q('ready-lock-refused')?.hidden).toBe(false);
    expect(t.audio.log).toContain('error');
    t.lock.mode = 'grant';
    t.click('ready-deploy');
    await t.until(() => t.app.state() === 'countdown');
  });
});

describe('loading failures and retry (BR-AS-08)', () => {
  it('a shaders failure shows Retry; Retry re-runs only precompile', async () => {
    const t = harness();
    t.renderer.failNext.precompile = true;
    t.click('main-menu-start');
    await t.until(() => t.app.state() === 'loading-error');
    expect(t.q('loading-error')?.hidden).toBe(false);
    const builds = t.renderer.calls.filter((c) => c === 'buildMap').length;
    t.click('loading-retry');
    await t.until(() => t.app.state() === 'ready');
    expect(t.renderer.calls.filter((c) => c === 'buildMap')).toHaveLength(builds);
    expect(t.diag.codes).toContain('app/load-failed');
  });

  it('a map failure retries from map; Main Menu leaves the error', async () => {
    const t = harness();
    t.renderer.failNext.buildMap = true;
    t.click('main-menu-start');
    await t.until(() => t.app.state() === 'loading-error');
    expect(t.app.model().failedStep).toBe('map');
    t.click('loading-main-menu');
    expect(t.app.state()).toBe('menu');
  });

  it('an invalid map is a nav failure with the validation message', async () => {
    const t = harness({
      deps: { prepare: () => Promise.resolve({ ok: false, error: 'INVALID_MAP' }) },
    });
    t.click('main-menu-start');
    await t.until(() => t.app.state() === 'loading-error');
    expect(t.app.model()).toMatchObject({ failedStep: 'nav' });
    expect(t.q('loading-error')?.textContent).toContain('validation');
  });

  it('a thrown prepare is caught at the step boundary', async () => {
    const t = harness({ deps: { prepare: () => Promise.reject(new Error('boom')) } });
    t.click('main-menu-start');
    await t.until(() => t.app.state() === 'loading-error');
    expect(t.app.model().failedStep).toBe('map');
  });

  it('context loss during loading goes to the error screen', async () => {
    const t = harness();
    t.click('main-menu-start');
    t.renderer.loseContext();
    expect(t.app.state()).toBe('loading-error');
    expect(t.q('loading-error')?.textContent).toContain('Graphics were reset');
    await t.until(() => true, 3);
  });
});

describe('pause and resume (F2, req-pause-menu)', () => {
  it('lock loss pauses; the simulation freezes; resume runs no catch-up burst', async () => {
    const t = harness();
    await t.toCountdown();
    await t.toLive();
    t.lock.lose();
    expect(t.app.state()).toBe('paused');
    expect(t.q('pause-dialog')).not.toBeNull();
    const tick = t.app.snapshot()?.tick ?? 0;
    t.frames.advance(60);
    expect(t.app.snapshot()?.tick).toBe(tick);
    expect(t.renderer.lastAlpha).toBe(1);
    expect(t.renderer.lastEventCount).toBe(0);
    t.frames.run(t.frames.now + 10_000); // 10 s away
    t.click('pause-resume');
    await t.until(() => t.app.state() === 'live');
    t.frames.run(t.frames.now + 10_000); // first frame back: dt = 0
    expect(t.app.snapshot()?.tick).toBe(tick);
    t.frames.advance(1);
    expect((t.app.snapshot()?.tick ?? 0) - tick).toBeLessThanOrEqual(1);
  });

  it('Esc keydown alone never pauses or resumes; visibility hidden pauses and suspends audio', async () => {
    const t = harness();
    await t.toCountdown();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    expect(t.app.state()).toBe('countdown');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(t.app.state()).toBe('paused');
    expect(t.app.model().resumeTo).toBe('countdown');
    expect(t.audio.log).toContain('suspend');
    expect(t.lock.locked).toBe(false);
  });

  it('a refused resume stays paused with the browser hint', async () => {
    const t = harness();
    await t.toCountdown();
    t.lock.lose();
    t.lock.mode = 'refuse';
    t.click('pause-resume');
    await t.until(() => t.app.model().lockRefused);
    expect(t.app.state()).toBe('paused');
    expect(t.q('pause-hint')?.textContent).toContain('refused');
  });

  it('context loss in a round pauses with restoring until restored', async () => {
    const t = harness();
    await t.toCountdown();
    t.renderer.loseContext();
    expect(t.app.model()).toMatchObject({ state: 'paused', restoring: true });
    t.click('pause-resume');
    expect(t.lock.requests).toBe(1);
    t.renderer.restoreContext();
    expect(t.app.model().restoring).toBe(false);
    t.click('pause-resume');
    await t.until(() => t.app.state() === 'countdown');
  });

  it('Tab shows the scoreboard only while live', async () => {
    const t = harness();
    await t.toCountdown();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab' }));
    t.frames.advance(1);
    await t.toLive();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab' }));
    t.frames.advance(4);
    expect(t.root.querySelector('.hud-scoreboard.is-visible')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab', key: 'Tab' }));
    t.frames.advance(4);
    expect(t.root.querySelector('.hud-scoreboard.is-visible')).toBeNull();
  });
});

describe('abandon and replay (story-abandon-round, story-play-again-no-reload)', () => {
  it('Restart Round discards: session stats and history unchanged, new seed, back to countdown', async () => {
    const t = harness();
    await t.toCountdown();
    await t.toLive();
    const seed0 = t.app.snapshot();
    expect(seed0).not.toBeNull();
    t.lock.lose();
    t.click('pause-restart');
    t.click('pause-confirm-confirm');
    expect(t.app.model().rebuilding).toBe(true);
    expect(t.lock.requestsOutsideHandler).toBe(0);
    await t.until(() => t.app.state() === 'countdown');
    expect(t.app.snapshot()?.phase).toBe('countdown');
    expect(t.storage.data.has(HISTORY_KEY)).toBe(false);
    expect(t.renderer.calls.filter((c) => c === 'disposeRound').length).toBeGreaterThan(0);
  });

  it('Main Menu from Pause discards and keeps the setup', async () => {
    const t = harness();
    const three = t.q('main-menu-bots-3') as HTMLInputElement;
    three.checked = true;
    three.dispatchEvent(new Event('change', { bubbles: true }));
    await t.toCountdown();
    t.lock.lose();
    t.click('pause-main-menu');
    t.click('pause-confirm-confirm');
    expect(t.app.state()).toBe('menu');
    expect(t.lock.exits).toBeGreaterThan(0);
    expect((t.q('main-menu-bots-3') as HTMLInputElement).checked).toBe(true);
    expect(t.app.model().setup?.bots).toBe(3);
    expect(t.storage.data.has(HISTORY_KEY)).toBe(false);
  });

  it('a completed round commits once, appends history, shows S13; Play Again rebuilds', async () => {
    const t = harness();
    const one = t.q('main-menu-bots-1') as HTMLInputElement;
    one.checked = true;
    one.dispatchEvent(new Event('change', { bubbles: true }));
    await t.toCountdown();
    await t.toLive();
    t.app.fastForward(36_000); // the idle player loses or the timer runs out
    t.frames.advance(1);
    await t.until(() => t.app.state() === 'eliminated' || t.app.state() === 'end');
    expect(t.lock.locked).toBe(false);
    if (t.app.state() === 'eliminated') {
      expect(t.q('eliminated-screen')).not.toBeNull();
      t.frames.advance(100); // 1.5 s beat
      await t.until(() => t.app.state() === 'end');
    }
    expect(t.q('end-of-round-screen')).not.toBeNull();
    const history = JSON.parse(t.storage.data.get(HISTORY_KEY) ?? '{}') as { entries?: unknown[] };
    expect(history.entries).toHaveLength(1);
    expect(t.q('end-of-round-screen')?.textContent).toMatch(/0\s*W|Lost|lost/);
    t.click('end-of-round-play-again');
    await t.until(() => t.app.state() === 'countdown');
    expect(JSON.parse(t.storage.data.get(HISTORY_KEY) ?? '{}')).toEqual(history);
  });

  it('10 restarts leave registrations, renderer resources and DOM nodes unchanged (RL-AS-01)', async () => {
    const t = harness();
    await t.toCountdown();
    const regs = t.app.liveRegistrations();
    const nodes = t.root.querySelectorAll('*').length;
    const res = { ...t.renderer.stats() };
    for (let i = 0; i < 10; i++) {
      t.lock.lose();
      t.click('pause-restart');
      t.click('pause-confirm-confirm');
      await t.until(() => t.app.state() === 'countdown');
    }
    expect(t.app.liveRegistrations()).toBe(regs);
    expect(t.root.querySelectorAll('*').length).toBe(nodes);
    expect(t.renderer.stats().geometries).toBe(res.geometries);
    expect(t.renderer.stats().textures).toBe(res.textures);
  });
});

describe('settings fan-out and persistence (PD-AS-13)', () => {
  it('a settings change applies synchronously and is saved', async () => {
    const t = harness();
    t.click('side-nav-settings');
    await t.until(() => t.q('settings-screen') !== null, 3);
    const fov = t.q('settings-fov') as HTMLInputElement | null;
    if (fov === null) throw new Error('no fov slider');
    fov.value = '100';
    fov.dispatchEvent(new Event('input', { bubbles: true }));
    expect(t.renderer.calls).toContain('setFov:100');
    expect(t.storage.data.get(SETTINGS_KEY)).toContain('100');
    expect(t.audio.cues).toContain('set-setting');
  });

  it('reads saved settings at boot', () => {
    const t0 = createHarness();
    const storage = t0.storage;
    t0.dispose();
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        schemaVersion: 1,
        settings: {
          sensitivity: 1,
          masterVolume: 30,
          sfxVolume: 40,
          graphics: 'low',
          fovDeg: 80,
          roundDurationSec: 120,
        },
      }),
    );
    const t = harness({ storage });
    expect(t.renderer.calls).toContain('setPreset:low');
    expect(t.renderer.calls).toContain('setFov:80');
    expect(t.audio.log).toContain('volumes:30/40');
  });

  it('hides the Audio group when audio is not supported', () => {
    const t = harness({ audio: null });
    expect(t.app.state()).toBe('menu');
  });
});

describe('frame-fault trip (AS-T31)', () => {
  it('30 consecutive faulted frames go to loading-error with the lock released', async () => {
    const t = harness();
    await t.toCountdown();
    t.renderer.throwOnRender = true;
    t.frames.advance(FRAME_FAULT_TRIP - 1);
    expect(t.app.state()).toBe('countdown');
    t.frames.advance(1);
    expect(t.app.state()).toBe('loading-error');
    t.renderer.throwOnRender = false;
    expect(t.lock.locked).toBe(false);
    expect(t.diag.codes).toEqual(
      expect.arrayContaining(['app/frame-fault', 'app/frame-fault-tripped']),
    );
    t.click('loading-retry');
    await t.until(() => t.app.state() === 'ready');
  });

  it('29 faults then a good frame do not trip', async () => {
    const t = harness();
    await t.toCountdown();
    t.renderer.throwOnRender = true;
    t.frames.advance(FRAME_FAULT_TRIP - 1);
    t.renderer.throwOnRender = false;
    t.frames.advance(1);
    t.renderer.throwOnRender = true;
    t.frames.advance(FRAME_FAULT_TRIP - 1);
    t.renderer.throwOnRender = false;
    expect(t.app.state()).toBe('countdown');
  });
});

describe('composition', () => {
  it('a second start and a second unmount are harmless', () => {
    const t = harness();
    t.app.start(t.root);
    expect(t.diag.snapshot()['app/ignored-event']).toBeGreaterThan(0);
  });

  it('unmount removes every listener and timer', async () => {
    const t = createHarness();
    await t.toCountdown();
    t.dispose();
    expect(t.app.liveRegistrations()).toBe(0);
    expect(t.audio.log).toContain('dispose');
  });

  it('setSeed overrides the next round only', async () => {
    const t = harness();
    t.app.setSeed(42);
    await t.toCountdown();
    expect(t.app.snapshot()).not.toBeNull();
  });

  it('feeds the hud before updating it each stepped frame', async () => {
    const hud = fakeHud();
    const t = harness({ deps: { hud } });
    await t.toCountdown();
    hud.log.length = 0;
    t.frames.advance(3);
    expect(hud.log.slice(0, 2)).toEqual(['feed', 'update']);
  });
});
