// @vitest-environment happy-dom
/**
 * PERF-MS-01, -05, -06 (reported, 10x ceilings asserted) and PERF-MS-11
 * (heap, asserted). Timings go to reports/menus-bench.json; they come from a
 * 2-vCPU runtime and happy-dom, so they are indicative only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { setImmediate as nextTask } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createLocalStorageRepos, HISTORY_KEY, SETTINGS_KEY } from '../../../../src/persistence';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  normalise,
  validateSettings,
} from '../../../../src/settings';
import {
  createEndOfRoundScreen,
  createMainMenuScreen,
  createSettingsScreen,
  type Screen,
} from '../../../../src/ui/screens';
import { createFakeStorage, entry } from '../../../persistence/fake-storage';
import { endVM, host, mainMenuVM, recorder, settingsVM } from './fixtures';
import { SCREENS } from './sweep';

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run Vitest with --expose-gc (see vitest.config.ts)');
  collect();
}

function meanMs(n: number, fn: (i: number) => void): number {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn(i);
  return (performance.now() - t0) / n;
}

describe('menus-settings bench', () => {
  it('reports timings and stays under the 10x ceilings', () => {
    const normaliseUs = meanMs(1e5, (i) => normalise('sensitivity', (i % 500) / 100)) * 1000;
    const store = createSettingsStore(null);
    store.subscribe(() => undefined);
    const setUs = meanMs(1e5, (i) => store.set('fovDeg', 70 + (i % 41))) * 1000;

    const settingsRaw = JSON.stringify({ schemaVersion: 1, settings: DEFAULT_SETTINGS });
    const historyRaw = JSON.stringify({
      schemaVersion: 1,
      entries: Array.from({ length: 50 }, (_v, i) => entry(i)),
    });
    const st = createFakeStorage({ [SETTINGS_KEY]: settingsRaw, [HISTORY_KEY]: historyRaw });
    const loadMs = meanMs(200, () =>
      createLocalStorageRepos(st, { validateSettings }).settings.load(),
    );
    const listMs = meanMs(200, () =>
      createLocalStorageRepos(st, { validateSettings }).history.list(),
    );

    const mountMs: Record<string, number> = {};
    for (const c of SCREENS) {
      mountMs[c.name] = meanMs(20, () => {
        const root = host();
        const s = c.make();
        s.mount(root, c.vm(), recorder().emit);
        s.unmount();
        root.remove();
      });
    }

    mkdirSync('reports', { recursive: true });
    writeFileSync(
      'reports/menus-bench.json',
      `${JSON.stringify(
        {
          note: 'Indicative only: 2-vCPU arm64 runtime, happy-dom (no layout or paint). Ceilings are 10x targets.',
          normaliseMeanUs: normaliseUs,
          storeSetMeanUs: setUs,
          settingsLoadMeanMs: loadMs,
          historyList50MeanMs: listMs,
          mountMeanMs: mountMs,
        },
        null,
        2,
      )}\n`,
    );
    expect(normaliseUs).toBeLessThan(50);
    expect(setUs).toBeLessThan(50);
    expect(loadMs).toBeLessThan(10);
    expect(listMs).toBeLessThan(10);
    for (const ms of Object.values(mountMs)) expect(ms).toBeLessThan(50);
  });

  it('grows the heap by less than 1 MB over 1e3 mount/unmount cycles (PERF-MS-11)', async () => {
    const cases: [() => Screen<never>, unknown][] = [
      [createMainMenuScreen, mainMenuVM()],
      [createSettingsScreen, settingsVM()],
      [createEndOfRoundScreen, endVM()],
    ];
    const root = host();
    // happy-dom caches querySelectorAll results (run on every radio check) in
    // WeakRefs, and a WeakRef target stays alive until the current job ends.
    // Yielding between batches lets those detached trees be collected, as a
    // browser would between user actions.
    const run = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) {
        for (const [make, vm] of cases) {
          const s = make();
          s.mount(root, vm as never, () => undefined);
          s.unmount();
        }
        if (i % 50 === 49) await nextTask();
      }
      await nextTask();
    };
    await run(100); // warm-up: JIT and happy-dom internal caches
    gc();
    const before = process.memoryUsage().heapUsed;
    await run(1000);
    gc();
    await nextTask();
    gc();
    const delta = process.memoryUsage().heapUsed - before;
    expect(delta).toBeLessThan(1024 * 1024);
  });
});
