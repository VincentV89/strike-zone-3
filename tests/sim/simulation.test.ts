/**
 * The 12-stage pipeline at round level: creation state, countdown, phases,
 * outcomes on both maps, bot death, round end and restarts
 * (req-round-lifecycle, req-round-outcomes, story-round-timer-outcomes,
 * story-industrial-warehouse-map, story-bot-death, BR-GS-30..51).
 */
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, createDiagnostics, createProfiler } from '../../src/core';
import type { SimEvent, SimSnapshot } from '../../src/contracts';
import { createSimulation, prepareMap } from '../../src/sim';
import { hunter, idle, lookFor } from './drivers';
import { createHasher, hashTick } from './hash';
import { COUNTDOWN, allowDiag, quietProfiler, rig, roundCfg, run, runToEnd } from './fixtures';
import { cmd } from './helpers';

const ALLOWED = ['ai/few-patrol-nodes'];
const clone = (s: Readonly<SimSnapshot>): SimSnapshot => structuredClone(s);

describe('creation and countdown (BR-GS-30, BR-GS-31)', () => {
  it('writes the creation state into both buffers', () => {
    const { sim } = rig({ durationSec: 120 });
    const s = sim.snapshot();
    expect(s.tick).toBe(0);
    expect(s.phase).toBe('countdown');
    expect(s.countdownLeftSec).toBe(3.5);
    expect(s.timeLeftSec).toBe(120);
    expect(s.outcome).toBeNull();
    expect(s.player.health).toBe(100);
    expect(s.player.armor).toBe(100);
    expect(s.player.loadout.active).toBe('rifle');
    expect(clone(sim.previousSnapshot())).toEqual(clone(s));
    expect(sim.previousSnapshot()).not.toBe(s);
    expect(sim.drainEvents()).toEqual([]);
  });

  it('freezes bots for 210 ticks; the player may look but not move or fire; then emits live', () => {
    const { sim } = rig({ bots: 10, durationSec: 60 });
    const bots0 = clone(sim.snapshot()).bots;
    const pos0 = { ...sim.snapshot().player.pos };
    const yaw0 = sim.snapshot().player.yaw;
    const busy = () =>
      cmd({
        move: { x: 1, z: -1 },
        ...lookFor(0.01, 0),
        fire: true,
        firePressed: true,
        jump: true,
      });
    const events = run(sim, COUNTDOWN - 1, busy);
    let s = sim.snapshot();
    expect(s.phase).toBe('countdown');
    expect(s.tick).toBe(COUNTDOWN - 1);
    expect(s.countdownLeftSec).toBeCloseTo(1 / 60, 9);
    expect(clone(s).bots).toEqual(bots0);
    expect(s.player.pos).toEqual(pos0);
    expect(s.player.yaw).not.toBe(yaw0);
    expect(events.filter((e) => e.t !== 'noise')).toEqual([]);
    expect(events).toEqual([]);
    const last = run(sim, 1, idle);
    s = sim.snapshot();
    expect(s.phase).toBe('live');
    expect(s.tick).toBe(COUNTDOWN);
    expect(s.timeLeftSec).toBe(60);
    expect(last).toEqual([{ t: 'phase', tick: COUNTDOWN, phase: 'live', outcome: null }]);
  });

  it('keeps previousSnapshot exactly one tick older than snapshot', () => {
    const { sim } = rig();
    for (let i = 0; i < 300; i++) {
      sim.step(cmd({ move: { x: 0, z: -1 } }));
      expect(sim.previousSnapshot().tick).toBe(sim.snapshot().tick - 1);
    }
  });
});

describe('outcomes (BR-GS-32..34)', () => {
  it('Time Expired: the timer runs out with bots alive; the timer counts down per live tick', () => {
    const { sim } = rig({ bots: 1, durationSec: 2, seed: 3 }, { allowed: ALLOWED });
    run(sim, COUNTDOWN + 60, idle);
    expect(sim.snapshot().timeLeftSec).toBeCloseTo(1, 9);
    const ev = runToEnd(sim, idle, 200);
    const s = sim.snapshot();
    expect(s.phase).toBe('ended');
    expect(s.outcome).toBe('time-expired');
    expect(s.timeLeftSec).toBe(0);
    expect(s.tick).toBe(COUNTDOWN + 120);
    expect(ev.filter((e) => e.t === 'phase')).toEqual([
      { t: 'phase', tick: COUNTDOWN + 120, phase: 'ended', outcome: 'time-expired' },
    ]);
  });

  it('Victory on the Warehouse: a test-only aim driver beats 2 bots (story-industrial-warehouse-map)', () => {
    const { sim, map } = rig(
      { map: 'industrial-warehouse', bots: 2, difficulty: 'normal', seed: 1, durationSec: 300 },
      { allowed: ALLOWED },
    );
    const ev = runToEnd(sim, hunter(map, { fire: true }), 20_000);
    const s = sim.snapshot();
    expect(s.outcome).toBe('victory');
    expect(s.botsAlive).toBe(0);
    const kills = ev.filter((e): e is Extract<SimEvent, { t: 'kill' }> => e.t === 'kill');
    expect(kills.map((k) => k.killer)).toEqual([PLAYER_ID, PLAYER_ID]);
    const end = ev.find((e) => e.t === 'phase' && e.phase === 'ended');
    expect(end?.tick).toBe(kills[1]?.tick); // the round ends in the tick of the last kill
  });

  it('Defeat on the Warehouse: an exposed player who never fires loses to 5 Hard bots', () => {
    const { sim, map } = rig(
      { map: 'industrial-warehouse', bots: 5, difficulty: 'hard', seed: 1, durationSec: 300 },
      { allowed: ALLOWED },
    );
    const ev = runToEnd(sim, hunter(map, { fire: false }), 20_000);
    const s = sim.snapshot();
    expect(s.outcome).toBe('defeat');
    expect(s.player.alive).toBe(false);
    expect(s.player.health).toBe(0);
    expect(ev.some((e) => e.t === 'kill' && e.victim === PLAYER_ID)).toBe(true);
    expect(ev.some((e) => e.t === 'shot' && e.shooter === PLAYER_ID)).toBe(false);
  });

  it('after ended: step() is a no-op, emits nothing and counts sim/step-after-end once', () => {
    const { sim, diag } = rig(
      { bots: 1, durationSec: 1 },
      { allowed: [...ALLOWED, 'sim/step-after-end'] },
    );
    runToEnd(sim, idle, 1000);
    const end = clone(sim.snapshot());
    for (let i = 0; i < 5; i++) sim.step(cmd({ fire: true, move: { x: 0, z: -1 } }));
    expect(clone(sim.snapshot())).toEqual(end);
    expect(clone(sim.previousSnapshot())).toEqual(end);
    expect(sim.drainEvents()).toEqual([]);
    expect(diag.codes.filter((c) => c === 'sim/step-after-end')).toHaveLength(1);
    expect(diag.snapshot()['sim/step-after-end']).toBe(5);
  });
});

describe('bot death and remaining enemies (BR-GS-50, BR-GS-51)', () => {
  it('drops botsAlive by one in the kill tick, freezes dead bots and keeps them dead', () => {
    const { sim, map } = rig(
      { map: 'desert-compound', bots: 3, difficulty: 'easy', seed: 4, durationSec: 300 },
      { allowed: ALLOWED },
    );
    const drive = hunter(map, { fire: true });
    let alive = 3;
    const deadAt = new Map<number, { x: number; z: number }>();
    for (let i = 0; i < 20_000 && sim.snapshot().phase !== 'ended'; i++) {
      sim.step(drive(sim.snapshot()));
      const s = sim.snapshot();
      const kills = sim.drainEvents().filter((e) => e.t === 'kill' && e.victim !== PLAYER_ID);
      alive -= kills.length;
      expect(s.botsAlive).toBe(alive);
      for (const b of s.bots) {
        const was = deadAt.get(b.id);
        if (was !== undefined) {
          expect(b.alive).toBe(false);
          expect(b.moving).toBe(false);
          expect({ x: b.pos.x, z: b.pos.z }).toEqual(was);
        } else if (!b.alive) {
          expect(b.deathTick).toBe(s.tick);
          deadAt.set(b.id, { x: b.pos.x, z: b.pos.z });
        }
      }
    }
    expect(deadAt.size).toBeGreaterThan(0);
  });
});

describe('player stage (BR-GS-44, BR-GS-62)', () => {
  it('emits player footstep noises while walking, never into perception', () => {
    const { sim } = rig({ bots: 1, seed: 2 }, { allowed: ALLOWED });
    run(sim, COUNTDOWN, idle);
    const ev = run(sim, 240, () => cmd({ move: { x: 0, z: -1 } }));
    const steps = ev.filter(
      (e) => e.t === 'noise' && e.kind === 'footstep' && e.source === PLAYER_ID,
    );
    expect(steps.length).toBeGreaterThan(2);
    for (const e of steps) if (e.t === 'noise') expect(e.radius).toBe(10);
  });

  it('applies setSensitivity to look', () => {
    const turn = (sens: number): number => {
      const { sim } = rig({ bots: 1, seed: 2 });
      sim.setSensitivity(sens);
      const y0 = sim.snapshot().player.yaw;
      run(sim, 1, () => cmd({ lookDx: 10 }));
      return Math.abs(sim.snapshot().player.yaw - y0);
    };
    expect(turn(2)).toBeCloseTo(2 * turn(1), 9);
  });
});

describe('restart isolation (BR-GS-02, SD-GS-06)', () => {
  it('ten createSimulation calls on one PreparedMap give identical replay hashes', () => {
    const map = prepareMap('desert-compound');
    const hashes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = createSimulation(roundCfg({ bots: 5, seed: 77 }), map, {
        diag: createDiagnostics(() => undefined),
        profiler: createProfiler(() => 0),
      });
      if (!r.ok) throw new Error(r.error);
      const h = createHasher();
      for (let t = 0; t < 600; t++) {
        r.value.step(cmd({ move: { x: 0, z: -1 }, fire: t % 30 === 0, firePressed: t % 30 === 0 }));
        hashTick(h, r.value.snapshot(), r.value.drainEvents());
      }
      hashes.push(h.digest);
    }
    expect(new Set(hashes).size).toBe(1);
  });

  it('two simulations side by side do not share state', () => {
    const map = prepareMap('desert-compound');
    const make = () => {
      const r = createSimulation(roundCfg({ seed: 5 }), map, {
        diag: allowDiag(ALLOWED),
        profiler: quietProfiler(),
      });
      if (!r.ok) throw new Error(r.error);
      return r.value;
    };
    const a = make();
    const b = make();
    run(a, 400, () => cmd({ move: { x: 0, z: -1 } }));
    expect(b.snapshot().tick).toBe(0);
    run(b, 400, () => cmd({ move: { x: 0, z: -1 } }));
    expect(clone(b.snapshot())).toEqual(clone(a.snapshot()));
  });
});
