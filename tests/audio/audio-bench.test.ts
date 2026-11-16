/**
 * audio bench (tech-stack-decisions-audio). Timings go to
 * reports/audio-bench.json and only 10× ceilings are asserted; this runtime
 * is not target hardware. The heap probe is asserted.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createAudioEngine } from '../../src/audio';
import { VoiceBudget } from '../../src/audio/budget';
import { createRequestPool, mapEvents } from '../../src/audio/mapping';
import { RECIPES } from '../../src/audio/recipes';
import { spatialise } from '../../src/audio/spatial';
import type { SimEvent } from '../../src/contracts';
import { FakeAudioContext } from './fake-context';
import { damage, impact, noise, POSE, recordingDiagnostics, shot, weapon } from './fixtures';

const CORE_TARGET_MS = 0.05;
const PLAY_TARGET_MS = 0.3;
const HEAP_LIMIT_BYTES = 1024 * 1024;

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run Vitest with --expose-gc (see vitest.config.ts)');
  collect();
}

/** A 20-bot firefight frame of 40 events. */
function firefight(): SimEvent[] {
  const events: SimEvent[] = [];
  for (let b = 1; b <= 20; b++) {
    events.push(shot(b, 'rifle', b * 2 - 20, 1.6, -10 - b, 1));
    events.push(b % 2 === 0 ? noise(b, 'footstep', b - 10, -b, 12, 1) : impact(1));
  }
  events[0] = shot(0, 'rifle');
  events[1] = damage(0, 3);
  events[2] = weapon(0, 'switch');
  return events;
}

describe('audio bench', () => {
  const events = firefight();
  const pool = createRequestPool();
  const budget = new VoiceBudget();

  const coreFrame = (): number => {
    const n = Math.min(mapEvents(events, pool), pool.length);
    budget.beginCall();
    let admitted = 0;
    for (let i = 0; i < n; i++) {
      const r = pool[i];
      if (r === undefined) continue;
      const prof = RECIPES[r.cue].spatial;
      if (prof !== null) spatialise(0, 1.6, 0, 0, r.x, r.y, r.z, prof, r.spatial);
      if (budget.canAdmit(r.cue, r.source, r.tick)) admitted++;
    }
    return admitted;
  };

  it('keeps the pure core within 10× of target and allocation-free', () => {
    for (let i = 0; i < 2000; i++) coreFrame();
    const iterations = 20_000;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) coreFrame();
    const coreMs = (performance.now() - t0) / iterations;

    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100_000; i++) coreFrame();
    gc();
    const heapDelta = process.memoryUsage().heapUsed - before;

    const ctx = new FakeAudioContext();
    const engine = createAudioEngine({
      diagnostics: recordingDiagnostics(),
      createContext: () => ctx,
    });
    void engine.unlock();
    const playIterations = 2000;
    let playMs = 0;
    return Promise.resolve().then(() => {
      const p0 = performance.now();
      for (let i = 0; i < playIterations; i++) {
        engine.play(events, POSE);
        ctx.endAll();
        ctx.nodes.length = 0;
        ctx.currentTime += 1;
      }
      playMs = (performance.now() - p0) / playIterations;
      mkdirSync('reports', { recursive: true });
      writeFileSync(
        'reports/audio-bench.json',
        `${JSON.stringify({ coreMsPerFrame: coreMs, playMsPerFrame: playMs, heapDeltaBytes: heapDelta, events: events.length }, null, 2)}\n`,
      );
      expect(coreMs).toBeLessThan(CORE_TARGET_MS * 10);
      expect(playMs).toBeLessThan(PLAY_TARGET_MS * 10);
      expect(heapDelta).toBeLessThan(HEAP_LIMIT_BYTES);
    });
  });
});
