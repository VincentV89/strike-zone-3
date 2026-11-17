/**
 * Never-throws fuzz (SD-AU-06): 2,000 seeded cases with hostile poses,
 * volumes, events and a fake whose operations throw or reject at random.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAudioEngine } from '../../src/audio';
import { AUDIO_CODES } from '../../src/audio/diagnostics-codes';
import { createRng, vec3 } from '../../src/core';
import type { SimEvent } from '../../src/contracts';
import { FakeAudioContext, type ResumeMode } from './fake-context';
import { damage, kill, noise, phase, recordingDiagnostics, shot, weapon } from './fixtures';

const CASES = 2000;
const KNOWN = new Set<string>(Object.values(AUDIO_CODES));
const WEIRD = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  1e308,
  -1e308,
  0,
  -0,
];

describe('audio fuzz (SD-AU-06)', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };
  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
  });

  it(`survives ${CASES} hostile cases without throwing or leaking rejections`, async () => {
    const rng = createRng(7).fork('fuzz');
    const num = (): number => (rng.next() < 0.3 ? rng.pick(WEIRD) : rng.range(-200, 200));
    const modes: ResumeMode[] = ['run', 'reject', 'stay-suspended', 'throw', 'run'];
    const codes = new Set<string>();

    for (let c = 0; c < CASES; c++) {
      const failRate = rng.next() < 0.5 ? 0 : rng.range(0, 0.3);
      const chaosRng = rng.fork(`chaos-${c}`);
      const ctx = new FakeAudioContext({
        resume: rng.pick(modes),
        sampleRate: 64,
        chaos: () => chaosRng.next() < failRate,
        rejectLifecycle: rng.next() < 0.3,
      });
      const diagnostics = recordingDiagnostics();
      const engine = createAudioEngine({ diagnostics, createContext: () => ctx });
      const weaponId = (rng.next() < 0.1
        ? 'laser'
        : rng.pick(['rifle', 'pistol', 'sniper'])) as unknown as 'rifle';

      const run = async (): Promise<void> => {
        engine.setVolumes(num(), num());
        await engine.unlock();
        for (let step = 0; step < 4; step++) {
          ctx.currentTime += Math.abs(rng.range(0, 0.2));
          const events: SimEvent[] = [
            shot(rng.int(0, 4), weaponId, num(), num(), num(), step),
            damage(rng.int(0, 3), rng.int(0, 3), rng.next() < 0.5, vec3(num(), num(), num()), step),
            noise(
              rng.int(0, 4),
              rng.pick(['footstep', 'land', 'gunfire'] as const),
              num(),
              num(),
              num(),
              step,
            ),
            weapon(0, 'switch', step),
            kill(rng.int(0, 3), 1, step),
            phase(
              rng.pick(['countdown', 'live', 'ended'] as const),
              rng.pick(['victory', 'defeat', 'time-expired', null] as const),
              step,
            ),
          ];
          if (rng.next() < 0.1) events.push({ t: 'shot', tick: step } as unknown as SimEvent);
          engine.play(events, { pos: vec3(num(), num(), num()), yaw: num() });
          engine.ui(rng.pick(['confirm', 'back', 'tick', 'error'] as const));
          if (rng.next() < 0.2) ctx.endAll();
          if (rng.next() < 0.1) ctx.setStateFromBrowser('interrupted');
          if (rng.next() < 0.1) engine.suspend();
          if (rng.next() < 0.1) await engine.unlock();
        }
        if (rng.next() < 0.5) engine.dispose();
      };
      await expect(run()).resolves.toBeUndefined();
      for (const code of diagnostics.warned) codes.add(code);
      for (const code of Object.keys(diagnostics.snapshot())) codes.add(code);
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(rejections).toEqual([]);
    for (const code of codes) expect(KNOWN.has(code)).toBe(true);
  });
});
