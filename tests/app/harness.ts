/**
 * App harness for happy-dom tests: the real createApp, the real simulation,
 * stats, screens, settings, persistence and hud, with a fake renderer, lock,
 * audio and rAF. Lives outside dom/ so it carries no environment docblock.
 */
import { createApp, type App, type AppDeps } from '../../src/app/app';
import { featureFlags } from '../../src/app/features';
import { createSeedSource } from '../../src/app/seed';
import type { StorageLike } from '../../src/persistence';
import { createHud } from '../../src/ui/hud';
import {
  fakeAudio,
  fakeLock,
  fakeRenderer,
  flush,
  manualFrames,
  recordingDiag,
  zeroProfiler,
  type FakeAudio,
  type FakeLock,
  type FakeRenderer,
  type ManualFrames,
} from './fakes';

export function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

export interface Harness {
  readonly app: App;
  readonly root: HTMLElement;
  readonly renderer: FakeRenderer;
  readonly lock: FakeLock;
  readonly audio: FakeAudio;
  readonly frames: ManualFrames;
  readonly diag: ReturnType<typeof recordingDiag>;
  readonly storage: ReturnType<typeof memoryStorage>;
  /** Clicks the element with this data-testid (dispatch depth tracked for the gesture spy). */
  click(testId: string): void;
  /** Runs frames until `pred` or `max` frames, flushing promises between. */
  until(pred: () => boolean, max?: number): Promise<void>;
  /** Start Game → loading → ready → deploy → countdown. */
  toCountdown(): Promise<void>;
  /** Countdown → live by fast-forwarding the 210-tick countdown. */
  toLive(): Promise<void>;
  q(testId: string): HTMLElement | null;
  dispose(): void;
}

export interface HarnessOptions {
  readonly deps?: Partial<AppDeps>;
  readonly audio?: FakeAudio | null;
  readonly storage?: ReturnType<typeof memoryStorage>;
}

export function createHarness(opts: HarnessOptions = {}): Harness {
  const root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  const renderer = fakeRenderer();
  const lock = fakeLock();
  const audio = opts.audio === undefined ? fakeAudio() : opts.audio;
  const frames = manualFrames();
  const diag = recordingDiag();
  const storage = opts.storage ?? memoryStorage();
  let depth = 0;
  lock.inHandler = () => depth > 0;
  let seed = 1000;
  const deps: AppDeps = {
    doc: document,
    win: window,
    caps: { webgl2: true, pointerLock: true, reducedMotion: true },
    renderer,
    hud: createHud({ diagnostics: diag, reducedMotion: true }),
    audio: audio ?? null,
    features: featureFlags(audio ?? null),
    diag,
    profiler: zeroProfiler(),
    storage,
    lock: () => lock,
    seeds: createSeedSource({
      getRandomValues: (a) => {
        a[0] = seed++;
        return a;
      },
      fallback: () => 0,
      diag,
    }),
    now: () => 0,
    isoNow: () => '2026-11-16T10:00:00.000Z',
    scheduler: { yield: () => Promise.resolve() },
    requestFrame: frames.request,
    version: '0.1.0-test',
    ...opts.deps,
  };
  const app = createApp(deps);
  app.start(root);

  const q = (id: string): HTMLElement | null => root.querySelector(`[data-testid="${id}"]`);
  const h: Harness = {
    app,
    root,
    renderer,
    lock,
    audio: audio as FakeAudio,
    frames,
    diag,
    storage,
    q,
    click(id) {
      const el = q(id);
      if (el === null) throw new Error(`no element ${id} in state ${app.state()}`);
      depth += 1;
      try {
        el.click();
      } finally {
        depth -= 1;
      }
    },
    async until(pred, max = 600) {
      for (let i = 0; i < max && !pred(); i++) {
        await flush(2);
        if (pred()) return;
        frames.advance(1);
      }
      if (!pred()) throw new Error(`condition not reached; state ${app.state()}`);
    },
    async toCountdown() {
      h.click('main-menu-start');
      await h.until(() => app.state() === 'ready');
      h.click('ready-deploy');
      await h.until(() => app.state() === 'countdown');
    },
    async toLive() {
      app.fastForward(210);
      frames.advance(1);
      await h.until(() => app.state() === 'live');
    },
    dispose() {
      app.unmount();
      root.remove();
    },
  };
  return h;
}
