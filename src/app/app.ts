/**
 * createApp: the composition root (business-logic-model-app-shell §1–§12,
 * frontend-components-app-shell). The only writer of AppState. It owns no
 * game rule: it feeds machine.ts events, runs the effects it returns in
 * order, then mounts the one base screen for the state. Dependencies are
 * reached only through their public index modules.
 */
import type { Settings, SimSnapshot, UiIntent } from '../contracts';
import { createFixedStepClock, type Diagnostics, type ProfileReport, type Profiler } from '../core';
import { createInputSystem, type InputSystem } from '../input';
import {
  createLocalStorageRepos,
  type HistoryRepo,
  type SettingsRepo,
  type StorageLike,
} from '../persistence';
import type { GameRenderer } from '../render';
import {
  createSettingsStore,
  validateSettings,
  type SettingKey,
  type SettingsStore,
} from '../settings';
import { prepareMapAsync } from '../sim';
import { EMPTY_SESSION, type SessionStats } from '../sim/stats';
import type { Hud } from '../ui/hud';
import {
  createBootScreen,
  createCountdownScreen,
  createEliminatedScreen,
  createEndOfRoundScreen,
  createLoadingScreen,
  createMainMenuScreen,
  createPauseScreen,
  createReadyGateScreen,
  type EndOfRoundVM,
  type Features,
  type Intent,
  type Screen,
} from '../ui/screens';
import type { AudioFeature } from './features';
import { createFrameLoop, type FrameLoop, type RequestFrame } from './frame-loop';
import { createLoader, type LoadOutcome, type Loader, type PrepareFn } from './loading';
import { scopedLookScale } from './look-scale';
import {
  INITIAL_MODEL,
  hudVisibleIn,
  inputMapFor,
  screenFor,
  transition,
  type AppEvent,
  type AppModel,
  type BaseScreen,
  type Effect,
} from './machine';
import type { BrowserCaps, PointerLockFactory, PointerLockPort, Unsubscribe } from './ports';
import {
  createRoundSession,
  discardRound,
  disposeRoundSession,
  type RoundSession,
} from './round-session';
import { createScope, type DisposableScope } from './scope';
import type { SeedSource } from './seed';
import {
  DEFAULT_SETUP,
  countdownVM,
  endOfRoundVM,
  historyEntry,
  loadingVM,
  mainMenuVM,
  pauseSummary,
  pauseVM,
  settingsVM,
} from './view-models';
import { createYield, type SchedulerLike } from './yield';

export interface AppWindow extends EventTarget {
  readonly innerWidth: number;
  readonly innerHeight: number;
}

export interface AppDeps {
  readonly doc: Document;
  readonly win: AppWindow;
  readonly caps: BrowserCaps;
  readonly renderer: GameRenderer;
  readonly hud: Hud;
  readonly audio: AudioFeature | null;
  readonly features: Features;
  readonly diag: Diagnostics;
  readonly profiler: Profiler;
  readonly storage: StorageLike | null;
  readonly lock: PointerLockFactory;
  readonly seeds: SeedSource;
  /** Slice-budget clock for the nav bake (performance.now). */
  readonly now: () => number;
  /** ISO time for history entries. */
  readonly isoNow: () => string;
  readonly scheduler: SchedulerLike | null;
  readonly requestFrame: RequestFrame;
  readonly version: string;
  /** Tests may inject a prepare function; the default is prepareMapAsync. */
  readonly prepare?: PrepareFn;
  readonly ai?: { readonly senseHz?: number; readonly decideHz?: number };
}

/** Plain copy of RenderStats for the seams. */
export type RenderStatsView = Readonly<Record<string, number | boolean | readonly number[]>>;

/** The handle main.ts and the test seams use (SeamTarget plus app-local extras). */
export interface App {
  start(root: HTMLElement): void;
  unmount(): void;
  state(): string;
  snapshot(): SimSnapshot | null;
  setSeed(seed: number): void;
  fastForward(ticks: number): void;
  diagnostics(): Readonly<Record<string, number>>;
  /** A copy of the renderer stats (e2e seam: asset fallbacks, env, skinned bots, formats). */
  renderStats(): RenderStatsView;
  profilerReport(): ProfileReport;
  onFrame(cb: () => void): Unsubscribe;
  /** Test hooks. */
  model(): AppModel;
  liveRegistrations(): number;
  readonly loop: FrameLoop;
  readonly canvas: HTMLCanvasElement;
}

type AnyScreen = Screen<unknown>;

function setSetting<K extends SettingKey>(store: SettingsStore, key: K, value: Settings[K]): void {
  store.set(key, value);
}

export function createApp(deps: AppDeps): App {
  const { doc, renderer, hud, audio, features, diag, profiler } = deps;
  const appScope = createScope();
  const canvas = doc.createElement('canvas');
  canvas.dataset['testid'] = 'game-canvas';
  canvas.tabIndex = -1;
  const hudRoot = doc.createElement('div');
  hudRoot.className = 'app-hud';
  hudRoot.dataset['testid'] = 'app-hud';
  hudRoot.hidden = true;
  const screenRoot = doc.createElement('div');
  screenRoot.className = 'app-screens';
  screenRoot.dataset['testid'] = 'app-screens';
  screenRoot.setAttribute('aria-live', 'polite');

  let repos: { settings: SettingsRepo; history: HistoryRepo } | null = null;
  let store: SettingsStore | null = null;
  let lock: PointerLockPort | null = null;
  let model: AppModel = INITIAL_MODEL;
  let session: RoundSession | null = null;
  let sessionStats: SessionStats = EMPTY_SESSION;
  let roundNo = 0;
  let sceneReady = false;
  let endVM: EndOfRoundVM | null = null;
  let killerId: number | null = null;
  let lookK = 1;
  let controller: AbortController | null = null;
  let loadToken = 0;
  let resizePending = true;
  let current: { kind: BaseScreen; screen: AnyScreen | null } = { kind: null, screen: null };
  let started = false;
  const frameListeners = new Set<() => void>();
  const queue: AppEvent[] = [];
  let draining = false;

  const clock = createFixedStepClock(undefined, undefined, diag);
  const input: InputSystem = createInputSystem({ keys: deps.win, pointer: doc, canvas });

  const loader: Loader = createLoader({
    prepare: deps.prepare ?? prepareMapAsync,
    renderer,
    createSession: (prepared) => {
      const settings = settingsNow();
      const setup = model.setup ?? DEFAULT_SETUP;
      roundNo += 1;
      const cfg = {
        ...setup,
        durationSec: settings.roundDurationSec,
        seed: deps.seeds.next(),
      };
      return createRoundSession(prepared, cfg, sessionStats, roundNo, appScope, {
        diag,
        profiler,
        renderer,
        hud,
        sensitivity: settings.sensitivity,
        ...(deps.ai === undefined ? {} : { ai: deps.ai }),
      });
    },
    disposeSession: disposeRoundSession,
    yieldFn: createYield(deps.scheduler, appScope),
    now: deps.now,
    diag,
    onProgress: () => {
      if (current.kind === 'loading') refreshView();
    },
  });

  const loop: FrameLoop = createFrameLoop(
    {
      state: () => model.state,
      rebuilding: () => model.rebuilding,
      session: () => session,
      canRender: () => sceneReady,
      dispatch,
      countdown: (snap) => {
        if (current.kind === 'countdown') updateScreen(countdownVM(snap.countdownLeftSec, false));
      },
      pendingResize: () => {
        if (!resizePending) return null;
        resizePending = false;
        return { w: deps.win.innerWidth, h: deps.win.innerHeight };
      },
      afterFrame: () => {
        for (const cb of frameListeners) cb();
      },
    },
    {
      clock,
      input,
      hud,
      renderer,
      audio,
      profiler,
      diag,
      requestFrame: deps.requestFrame,
      lookScale: () => lookK,
    },
  );

  function settingsNow(): ReturnType<SettingsStore['get']> {
    if (store === null) throw new Error('app/not-started');
    return store.get();
  }

  // ---- dispatch and effects --------------------------------------------

  function dispatch(e: AppEvent): void {
    queue.push(e);
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const t = transition(model, next);
        model = t.next;
        for (const fx of t.effects) runEffect(fx);
        syncView();
      }
    } finally {
      draining = false;
    }
  }

  function runEffect(fx: Effect): void {
    switch (fx.kind) {
      case 'lock-exit':
        lock?.exit();
        return;
      case 'request-lock':
        requestLock();
        return;
      case 'audio-unlock':
        audio?.unlock();
        return;
      case 'audio-error':
        audio?.error();
        return;
      case 'start-loading':
        startLoading(fx.from);
        return;
      case 'abort-loading':
        abortLoading();
        return;
      case 'dispose-session':
        disposeSession();
        return;
      case 'reset-clock':
        loop.resetTime();
        return;
      case 'clear-held':
        input.clearHeld();
        return;
      case 'focus-canvas':
        canvas.focus({ preventScroll: true });
        return;
      case 'commit-stats':
        commitRound(fx.outcome);
        return;
      case 'discard-stats':
        if (session !== null) discardRound(session);
        return;
      case 'start-rebuild':
        startRebuild();
        return;
      case 'start-eliminated-beat':
        loop.startBeat();
        return;
      case 'ignored':
        diag.count('app/ignored-event');
        return;
    }
  }

  function requestLock(): void {
    if (lock === null) return;
    // Called synchronously from the click/Enter handler (BR-AS-04, PD-AS-09).
    lock.request(canvas).then(
      (r) => {
        dispatch(r.ok ? { kind: 'lock-granted' } : { kind: 'lock-error' });
      },
      () => {
        dispatch({ kind: 'lock-error' });
      },
    );
  }

  function abortLoading(): void {
    controller?.abort();
    controller = null;
    loadToken += 1;
  }

  function disposeSession(): void {
    abortLoading();
    if (session !== null) disposeRoundSession(session);
    session = null;
    sceneReady = false;
    endVM = null;
    loader.reset();
    renderer.disposeRound();
  }

  function runLoader(from: Parameters<Loader['run']>[1], onDone: (o: LoadOutcome) => void): void {
    abortLoading();
    const c = new AbortController();
    controller = c;
    const token = loadToken;
    const map = (model.setup ?? DEFAULT_SETUP).map;
    sceneReady = false;
    loader.run(map, from, c.signal).then(
      (o) => {
        if (token !== loadToken) {
          if (o.kind === 'done') disposeRoundSession(o.session);
          return;
        }
        controller = null;
        onDone(o);
      },
      () => {
        if (token === loadToken) onDone({ kind: 'failed', step: loader.current(), message: '' });
      },
    );
  }

  function adopt(s: RoundSession): void {
    session = s;
    sceneReady = true;
    endVM = null;
    killerId = null;
  }

  function startLoading(from: Parameters<Loader['run']>[1]): void {
    if (session !== null && from === 'map') {
      disposeRoundSession(session);
      session = null;
    }
    runLoader(from, (o) => {
      if (o.kind === 'done') {
        adopt(o.session);
        dispatch({ kind: 'loading-done' });
      } else if (o.kind === 'failed') {
        dispatch({ kind: 'loading-failed', step: o.step, message: o.message || 'Loading failed.' });
      }
    });
  }

  function startRebuild(): void {
    // Same PreparedMap (cached by game-simulation) and setup, new seed (PD-AS-12).
    if (session !== null) disposeRoundSession(session);
    session = null;
    runLoader('map', (o) => {
      if (o.kind === 'done') {
        adopt(o.session);
        dispatch({ kind: 'rebuild-done' });
      } else if (o.kind === 'failed') {
        dispatch({
          kind: 'rebuild-failed',
          step: o.step,
          message: o.message || 'Loading failed.',
        });
      }
    });
  }

  function commitRound(outcome: Parameters<typeof endOfRoundVM>[1]): void {
    const s = session;
    if (s === null || s.settled) return;
    s.settled = true;
    const setup = model.setup ?? DEFAULT_SETUP;
    const r = s.stats.round();
    killerId = r.killerId;
    const entry = historyEntry(r, outcome, setup, deps.isoNow());
    sessionStats = s.stats.commit(outcome);
    endVM = endOfRoundVM(s.stats.round(), outcome, sessionStats, setup);
    if (features.history && repos !== null) {
      try {
        repos.history.append(entry);
      } catch {
        diag.warnOnce('app/history-write-failed');
      }
    }
  }

  // ---- intents ----------------------------------------------------------

  function emit(intent: Intent): void {
    if (intent.type === 'set-setting') {
      if (store !== null) setSetting(store, intent.key, intent.value);
      refreshView();
    } else if (intent.type === 'clear-history') {
      repos?.history.clear();
      refreshView();
    } else {
      dispatch({ kind: 'intent', intent: intent satisfies UiIntent });
    }
    audio?.cue(intent);
  }

  // ---- view ----------------------------------------------------------------

  function createScreen(kind: Exclude<BaseScreen, null>): AnyScreen {
    switch (kind) {
      case 'boot':
        return createBootScreen();
      case 'menu':
        return createMainMenuScreen();
      case 'loading':
        return createLoadingScreen();
      case 'ready':
        return createReadyGateScreen();
      case 'countdown':
        return createCountdownScreen();
      case 'pause':
        return createPauseScreen();
      case 'eliminated':
        return createEliminatedScreen();
      case 'end':
        return createEndOfRoundScreen();
    }
  }

  function settingsView(context: 'menu' | 'pause'): ReturnType<typeof settingsVM> {
    return settingsVM(settingsNow(), context, features, repos?.settings.status() ?? null);
  }

  function vmFor(kind: Exclude<BaseScreen, null>): unknown {
    const setup = model.setup ?? DEFAULT_SETUP;
    const snap = session?.sim.snapshot() ?? null;
    switch (kind) {
      case 'boot':
        return { unsupported: model.state === 'unsupported' };
      case 'menu': {
        const history =
          repos === null ? null : { entries: repos.history.list(), status: repos.history.status() };
        return mainMenuVM(setup, features, settingsView('menu'), history, deps.version);
      }
      case 'loading':
        return loadingVM(loader.progress(), model.errorText);
      case 'ready':
        return { lockRefused: model.lockRefused };
      case 'countdown':
        return countdownVM(snap?.countdownLeftSec ?? 0, false);
      case 'pause':
        return pauseVM(
          pauseSummary(setup, snap?.timeLeftSec ?? 0),
          model.lockRefused,
          model.restoring,
          settingsView('pause'),
        );
      case 'eliminated':
        return { killerId };
      case 'end':
        return endVM ?? endOfRoundVM(EMPTY_ROUND, 'defeat', sessionStats, setup);
    }
  }

  function updateScreen(vm: unknown): void {
    current.screen?.update(vm);
  }

  function refreshView(): void {
    if (current.kind !== null) updateScreen(vmFor(current.kind));
  }

  function syncView(): void {
    input.setMap(inputMapFor(model.state));
    hudRoot.hidden = !hudVisibleIn(model.state);
    const kind = screenFor(model.state);
    if (kind === current.kind) {
      refreshView();
      return;
    }
    current.screen?.unmount();
    current = { kind, screen: null };
    if (kind === null) return;
    const screen = createScreen(kind);
    current = { kind, screen: screen };
    screen.mount(screenRoot, vmFor(kind), emit);
    screen.focusFirst();
  }

  // ---- settings fan-out ------------------------------------------------------

  function applySetting(key: string): void {
    const s = settingsNow();
    switch (key) {
      case 'fovDeg':
        renderer.setFov(s.fovDeg);
        lookK = scopedLookScale(s.fovDeg);
        return;
      case 'graphics':
        renderer.setPreset(s.graphics);
        return;
      case 'sensitivity':
        session?.sim.setSensitivity(s.sensitivity);
        return;
      case 'masterVolume':
      case 'sfxVolume':
        audio?.setVolumes(s.masterVolume, s.sfxVolume);
        return;
      default:
        // roundDurationSec applies from the next round only.
        return;
    }
  }

  // ---- boot ------------------------------------------------------------------

  function boot(): void {
    if (!deps.caps.webgl2 || !deps.caps.pointerLock) {
      dispatch({ kind: 'boot-no-webgl2' });
      return;
    }
    const r = renderer.init(canvas);
    if (!r.ok) {
      dispatch({ kind: 'boot-no-webgl2' });
      return;
    }
    for (const key of ['fovDeg', 'graphics', 'masterVolume']) applySetting(key);
    loop.start();
    dispatch({ kind: 'boot-ok' });
  }

  function listen(): void {
    lock = deps.lock(appScope);
    appScope.add(
      lock.onChange((locked) => {
        if (!locked) dispatch({ kind: 'lock-lost' });
      }),
    );
    input.attach(appScope);
    // First gesture anywhere creates the AudioContext (FD-AU-Q1); never awaited.
    const unlock = (): void => {
      audio?.unlock();
    };
    appScope.on(doc, 'pointerdown', unlock, { capture: true });
    appScope.on(doc, 'keydown', unlock, { capture: true });
    appScope.on(doc, 'visibilitychange', () => {
      if (doc.visibilityState !== 'hidden') return;
      audio?.suspend();
      dispatch({ kind: 'visibility-hidden' });
    });
    appScope.on(deps.win, 'resize', () => {
      resizePending = true;
    });
    appScope.add(
      renderer.onContextLost(() => {
        dispatch({ kind: 'context-lost', step: loader.current() });
      }),
    );
    appScope.add(
      renderer.onContextRestored(() => {
        dispatch({ kind: 'context-restored' });
      }),
    );
    if (store !== null)
      appScope.add(
        store.subscribe((_s, key) => {
          applySetting(key);
        }),
      );
  }

  return {
    start(root) {
      if (started) {
        diag.count('app/ignored-event');
        return;
      }
      started = true;
      repos = createLocalStorageRepos(deps.storage, { validateSettings });
      store = createSettingsStore(repos.settings);
      root.replaceChildren(canvas, hudRoot, screenRoot);
      hud.mount(hudRoot);
      appScope.add(() => {
        hud.unmount();
      });
      listen();
      boot();
    },
    unmount() {
      loop.stop();
      current.screen?.unmount();
      current = { kind: null, screen: null };
      disposeSession();
      appScope.dispose();
      audio?.dispose();
      canvas.remove();
      hudRoot.remove();
      screenRoot.remove();
      frameListeners.clear();
    },
    state: () => model.state,
    snapshot: () => session?.sim.snapshot() ?? null,
    setSeed: (seed) => {
      deps.seeds.override(seed);
    },
    fastForward: (ticks) => {
      loop.fastForward(ticks);
    },
    diagnostics: () => diag.snapshot(),
    renderStats: () => {
      const s = renderer.stats();
      return { ...s, textureFormats: [...s.textureFormats] };
    },
    profilerReport: () => profiler.report(),
    onFrame(cb) {
      frameListeners.add(cb);
      return () => {
        frameListeners.delete(cb);
      };
    },
    model: () => model,
    liveRegistrations: () => appScope.live(),
    loop,
    canvas,
  };
}

const EMPTY_ROUND = Object.freeze({
  kills: 0,
  deaths: 0,
  headshots: 0,
  shotsFired: 0,
  shotsHit: 0,
  accuracy: 0,
  damageDealt: 0,
  damageTaken: 0,
  armorLost: 0,
  enemiesTotal: 0,
  enemiesLeft: 0,
  killerId: null,
  liveStartTick: -1,
  lastTick: 0,
  durationSec: 0,
  outcome: null,
});

export type { DisposableScope };
