/**
 * Allocation probe for the render update path (BR-P-04, PR-P-14): 1e4 frames
 * at 20 bots with full pools and 8 events per frame must grow the heap by
 * less than 1 MB. Runs the real renderer against the fake host.
 */
import { describe, expect, it } from 'vitest';
import { botId, PLAYER_ID } from '../../src/core';
import type { SimEvent, SimSnapshot } from '../../src/contracts';
import { impact, liveHarness, shot, snapshot } from './fixtures';

const FRAMES = 10_000;
const HEAP_LIMIT_BYTES = 1024 * 1024;

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run Vitest with --expose-gc (see vitest.config.ts)');
  collect();
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

describe('render update path allocation (BR-P-04)', () => {
  it('stays under 1 MB of heap growth over 1e4 frames at 20 bots', async () => {
    const h = await liveHarness('desert-compound', 20, { preset: 'high' });
    h.host.recording = false;
    const prev = snapshot(0, 20) as Mutable<SimSnapshot>;
    const curr = snapshot(1, 20) as Mutable<SimSnapshot>;
    const events: Mutable<SimEvent>[] = [
      shot(1, PLAYER_ID),
      shot(1, botId(3)),
      shot(1, botId(7), { hit: PLAYER_ID }),
      shot(1, PLAYER_ID, { hit: botId(2), weapon: 'pistol', end: { x: 4, y: 1.5, z: -10 } }),
      impact(1, -20),
      impact(1, -21),
      {
        t: 'noise',
        tick: 1,
        source: botId(4),
        kind: 'gunfire',
        pos: { x: 0, y: 0, z: 0 },
        radius: 30,
      },
      {
        t: 'damage',
        tick: 1,
        target: PLAYER_ID,
        source: botId(7),
        amount: 10,
        armorLoss: 0,
        fromDir: { x: 0, y: 0, z: -1 },
        headshot: false,
      },
    ];
    const player = curr.player as Mutable<SimSnapshot['player']>;
    const step = (frames: number): void => {
      for (let i = 0; i < frames; i++) {
        const tick = prev.tick + 1;
        prev.tick = tick;
        curr.tick = tick + 1;
        player.lastFireTick = tick + 1;
        for (const e of events) (e as { tick: number }).tick = tick + 1;
        h.renderer.render(prev, curr, (i % 10) / 10, events);
      }
    };
    step(500); // warm-up: JIT, lazily created three.js state
    gc();
    const before = process.memoryUsage().heapUsed;
    step(FRAMES);
    gc();
    const delta = process.memoryUsage().heapUsed - before;
    expect(h.renderer.stats().frameFaults).toBe(0);
    expect(delta).toBeLessThan(HEAP_LIMIT_BYTES);
  });
});
