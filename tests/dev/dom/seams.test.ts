// @vitest-environment happy-dom
/** Test seams and the pointer-lock bypass (SD-AS-04, story-test-seams-inert). */
import { describe, expect, it } from 'vitest';
import { createProfiler } from '../../../src/core';
import {
  BYPASS_MARKER,
  SEAM_GLOBAL,
  createPointerLockBypass,
  installTestSeams,
  mountDevOverlay,
  type SeamHost,
} from '../../../src/dev';

function host(): SeamHost & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    state: () => 'menu',
    snapshot: () => null,
    setSeed: (s) => log.push(`seed:${String(s)}`),
    fastForward: (n) => log.push(`ff:${String(n)}`),
    diagnostics: () => ({ 'app/frame-fault': 1 }),
  };
}

describe('installTestSeams', () => {
  it('defines a frozen, non-writable, non-configurable seam object', () => {
    const win = {};
    const h = host();
    const api = installTestSeams(h, win, { marker: 'm1' });
    const desc = Object.getOwnPropertyDescriptor(win, SEAM_GLOBAL);
    expect(desc).toMatchObject({ writable: false, configurable: false });
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.keys(api).sort()).toEqual(
      ['diagnostics', 'fastForward', 'marker', 'setSeed', 'snapshot', 'state'].sort(),
    );
    api.setSeed(5);
    api.fastForward(60);
    expect(h.log).toEqual(['seed:5', 'ff:60']);
    expect(api.state()).toBe('menu');
    expect(api.snapshot()).toBeNull();
    expect(api.diagnostics()).toEqual({ 'app/frame-fault': 1 });
    expect(api.marker).toBe('m1');
    expect(() => {
      installTestSeams(h, win, { marker: 'm2' });
    }).toThrow();
  });

  it('exposes simulateLockLoss only with the bypass', () => {
    const api = installTestSeams(host(), {}, { marker: 'x', simulateLockLoss: () => undefined });
    expect(typeof api.simulateLockLoss).toBe('function');
  });
});

describe('pointer-lock bypass (SD-05)', () => {
  it('grants every request and simulates the browser releasing the lock', async () => {
    const b = createPointerLockBypass();
    const seen: boolean[] = [];
    const off = b.onChange((l) => seen.push(l));
    expect((await b.request(document.createElement('canvas'))).ok).toBe(true);
    await b.request(document.createElement('canvas'));
    expect(b.isLocked()).toBe(true);
    b.simulateLoss();
    b.exit();
    off();
    expect(seen).toEqual([true, false]);
    expect(b.marker).toBe(BYPASS_MARKER);
  });
});

describe('dev overlay', () => {
  it('shows fps and section means every 30 frames, and unmounts cleanly', () => {
    const root = document.createElement('div');
    const cbs = new Set<() => void>();
    let t = 0;
    const profiler = createProfiler(() => 0);
    const off = mountDevOverlay(
      document,
      root,
      {
        onFrame: (cb) => {
          cbs.add(cb);
          return () => cbs.delete(cb);
        },
        profilerReport: () => profiler.report(),
      },
      () => (t += 16),
    );
    for (let i = 0; i < 30; i++) for (const cb of cbs) cb();
    expect(root.textContent).toMatch(/fps \| sim 0\.00/);
    off();
    expect(root.children).toHaveLength(0);
    expect(cbs.size).toBe(0);
  });
});
