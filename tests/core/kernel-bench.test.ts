/**
 * Kernel allocation probe and timing report (tech-stack-decisions NFR table).
 * The heap-delta bound is asserted. Timings are written to
 * reports/kernel-bench.json as numbers for the evidence list and are never
 * asserted: this runtime is not target hardware (req-honest-verification).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  add,
  createEventBuffer,
  createFixedStepClock,
  createProfiler,
  createRng,
  dirFromYawPitch,
  vec3,
} from '../../src/core';

const CALLS = 1_000_000;
const HEAP_LIMIT_BYTES = 1024 * 1024;

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run Vitest with --expose-gc (see vitest.config.ts)');
  collect();
}

function heapDelta(body: () => void): number {
  body(); // warm up so JIT and lazily created state are not counted
  gc();
  const before = process.memoryUsage().heapUsed;
  body();
  gc();
  return process.memoryUsage().heapUsed - before;
}

function nsPerCall(body: () => void): number {
  const start = performance.now();
  body();
  return ((performance.now() - start) * 1e6) / CALLS;
}

describe('kernel hot paths', () => {
  const rng = createRng(42);
  const clock = createFixedStepClock(60, 5);
  const events = createEventBuffer<number>(4096);
  const profiler = createProfiler(() => performance.now());
  const out = vec3();
  const a = vec3(1, 2, 3);
  const b = vec3(4, 5, 6);
  let sink = 0;

  const bodies = {
    'rng.next': () => {
      for (let i = 0; i < CALLS; i++) sink += rng.next();
    },
    'clock.advance': () => {
      for (let i = 0; i < CALLS; i++) sink += clock.advance(0.004);
    },
    'events.push+drain': () => {
      for (let i = 0; i < CALLS; i++) {
        events.push(i);
        if ((i & 1023) === 1023) sink += events.drain().length;
      }
      sink += events.drain().length;
    },
    'math(out)': () => {
      for (let i = 0; i < CALLS; i++) {
        add(a, b, out);
        dirFromYawPitch(i * 1e-6, 0.1, out);
        sink += out.x;
      }
    },
    'profiler.begin/end': () => {
      for (let i = 0; i < CALLS; i++) {
        profiler.begin('sim');
        profiler.end('sim');
      }
      profiler.endFrame();
    },
  } as const;

  it('allocate under 1 MB of heap for 1e6 calls each after construction', () => {
    const deltas: Record<string, number> = {};
    for (const [name, body] of Object.entries(bodies)) deltas[name] = heapDelta(body);
    for (const [name, delta] of Object.entries(deltas)) {
      expect(delta, `${name} heap delta`).toBeLessThan(HEAP_LIMIT_BYTES);
    }

    const timings: Record<string, number> = {};
    for (const [name, body] of Object.entries(bodies)) timings[name] = nsPerCall(body);
    mkdirSync('reports', { recursive: true });
    writeFileSync(
      'reports/kernel-bench.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          note: 'Reference runtime (2 vCPU arm64 container); not target hardware. Reported, not asserted.',
          calls: CALLS,
          heapDeltaBytes: deltas,
          nsPerCall: timings,
        },
        null,
        2,
      ),
    );
    expect(Number.isFinite(sink)).toBe(true);
  });
});
