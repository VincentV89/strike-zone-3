/**
 * Bootstrap (business-logic-model-app-shell §4, security-design-app-shell
 * SD-AS-01, SD-AS-08, SD-AS-16). The only file in src/app that reads browser
 * globals: it builds BrowserCaps, the storage handle and the seed source,
 * then calls createApp(deps).start(root). Everything else receives
 * functions, not globals.
 *
 * The test seams load only through the single guarded import below. `vite
 * build` replaces import.meta.env.MODE with "production", so the branch is
 * dead and no src/dev chunk is emitted (check:seams verifies dist/).
 */
import { createProfiler } from '../core';
import { createGameRenderer } from '../render';
import { createHud } from '../ui/hud';
import { createApp, type App, type AppDeps } from './app';
import { createAppDiagnostics } from './diagnostics';
import { createFeatures } from './features';
import { defaultRequestFrame } from './frame-loop';
import { createPointerLockPort } from './pointer-lock';
import type { BrowserCaps, PointerLockFactory } from './ports';
import { createSeedSource, type GetRandomValues } from './seed';
import type { SchedulerLike } from './yield';

const VERSION = '0.1.0';

function hasWebGl2(): boolean {
  if (typeof WebGL2RenderingContext === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (gl === null) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function readCaps(): BrowserCaps {
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    webgl2: hasWebGl2(),
    pointerLock:
      typeof HTMLElement.prototype.requestPointerLock === 'function' &&
      'pointerLockElement' in document,
    reducedMotion,
  };
}

function readStorage(diag: AppDeps['diag']): Storage | null {
  try {
    const s = window.localStorage;
    // A blocked store throws SecurityError here, not on the first write.
    return Number.isInteger(s.length) ? s : null;
  } catch {
    diag.warnOnce('app/storage-unavailable');
    return null;
  }
}

function readScheduler(): SchedulerLike | null {
  const s = (globalThis as { scheduler?: Partial<SchedulerLike> }).scheduler;
  if (s === undefined || typeof s.yield !== 'function') return null;
  const y = s.yield.bind(s);
  return { yield: () => y() };
}

function readRandom(): GetRandomValues | null {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') return null;
  return (a) => crypto.getRandomValues(a);
}

async function boot(root: HTMLElement): Promise<void> {
  const diag = createAppDiagnostics();
  const caps = readCaps();
  const { audio, features } = createFeatures(diag);
  let lock: PointerLockFactory = (scope) => createPointerLockPort(document, scope, diag);
  const afterStart: ((app: App) => void)[] = [];

  if (import.meta.env.MODE === 'test') {
    const dev = await import('../dev');
    const seams = new URLSearchParams(window.location.search).getAll('seams');
    const bypass = seams.includes('bypass-lock') ? dev.createPointerLockBypass() : null;
    if (bypass !== null) lock = () => bypass;
    afterStart.push((app) => {
      dev.installTestSeams(app, window, {
        marker: `boot-${String(Math.floor(performance.timeOrigin))}`,
        ...(bypass === null
          ? {}
          : {
              simulateLockLoss: () => {
                bypass.simulateLoss();
              },
            }),
      });
      if (seams.includes('overlay'))
        dev.mountDevOverlay(document, root, app, () => performance.now());
    });
  }

  const deps: AppDeps = {
    doc: document,
    win: window,
    caps,
    renderer: createGameRenderer({ diagnostics: diag, reducedMotion: caps.reducedMotion }),
    hud: createHud({ diagnostics: diag, reducedMotion: caps.reducedMotion }),
    audio,
    features,
    diag,
    profiler: createProfiler(() => performance.now()),
    storage: readStorage(diag),
    lock,
    seeds: createSeedSource({
      getRandomValues: readRandom(),
      fallback: () => Date.now() ^ Math.floor(performance.now() * 1000),
      diag,
    }),
    now: () => performance.now(),
    isoNow: () => new Date().toISOString(),
    scheduler: readScheduler(),
    requestFrame: defaultRequestFrame,
    version: VERSION,
  };
  const app: App = createApp(deps);
  app.start(root);

  for (const fn of afterStart) fn(app);
}

const root = document.getElementById('app');
if (root !== null) {
  boot(root).catch(() => {
    root.textContent = 'StrikeZone could not start.';
  });
}
