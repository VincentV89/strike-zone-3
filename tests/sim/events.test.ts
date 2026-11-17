/** EventStore copy-on-emit and SenseWindow (BR-GS-43, BR-GS-60..64, SD-GS-04). */
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, createDiagnostics, vec3, type EntityId } from '../../src/core';
import type { SimEvent } from '../../src/contracts';
import { createEventStore, createSenseWindow } from '../../src/sim/events';
import { rig } from './fixtures';
import { hunter } from './drivers';

type Ev<K extends SimEvent['t']> = Extract<SimEvent, { t: K }>;

const shot = (shooter: number, tick = 1): Ev<'shot'> => ({
  t: 'shot',
  tick,
  shooter: shooter as EntityId,
  weapon: 'rifle',
  origin: vec3(1, 2, 3),
  end: vec3(4, 5, 6),
  hit: null,
  headshot: false,
});
const noise = (source: number, tick: number): Ev<'noise'> => ({
  t: 'noise',
  tick,
  source: source as EntityId,
  kind: 'gunfire',
  pos: vec3(tick, 0, 0),
  radius: 40,
});
const damage = (target: number, tick: number): Ev<'damage'> => ({
  t: 'damage',
  tick,
  target: target as EntityId,
  source: PLAYER_ID,
  amount: 25,
  armorLoss: 0,
  fromDir: vec3(1, 0, 0),
  headshot: false,
});

const ALL: SimEvent[] = [
  shot(1),
  { t: 'impact', tick: 1, point: vec3(1, 1, 1), normal: vec3(0, 1, 0) },
  damage(2, 1),
  {
    t: 'kill',
    tick: 1,
    victim: 2 as EntityId,
    killer: PLAYER_ID,
    weapon: 'sniper',
    headshot: true,
  },
  noise(0, 1),
  { t: 'weapon', tick: 1, actor: PLAYER_ID, kind: 'reload-start' },
  { t: 'phase', tick: 1, phase: 'ended', outcome: 'victory' },
];

describe('EventStore', () => {
  it('copies every kind field by field, including each Vec3', () => {
    const store = createEventStore(createDiagnostics(() => undefined));
    for (const e of ALL) store.emit(e);
    const out = store.drain();
    expect(out).toEqual(ALL);
    out.forEach((e, i) => {
      expect(e).not.toBe(ALL[i]);
    });
    const s = out[0] as Ev<'shot'>;
    expect(s.origin).not.toBe((ALL[0] as Ev<'shot'>).origin);
  });

  it('gives two shots from one reused scratch object two distinct drained events (B3 handoff)', () => {
    const store = createEventStore(createDiagnostics(() => undefined));
    const scratch = shot(1);
    store.emit(scratch);
    scratch.shooter = 2 as EntityId;
    scratch.origin.x = 99;
    store.emit(scratch);
    const [a, b] = store.drain() as Ev<'shot'>[];
    expect(a).not.toBe(b);
    expect(a?.shooter).toBe(1);
    expect(a?.origin.x).toBe(1);
    expect(b?.shooter).toBe(2);
    expect(b?.origin.x).toBe(99);
  });

  it('keeps drained events valid until the next drain and reuses pool objects after two', () => {
    const store = createEventStore(createDiagnostics(() => undefined));
    store.emit(shot(1, 10));
    const first = [...store.drain()];
    store.emit(shot(2, 20));
    const second = [...store.drain()];
    expect((first[0] as Ev<'shot'>).tick).toBe(10); // untouched by the second generation
    store.emit(shot(3, 30));
    const third = store.drain();
    expect(third[0]).toBe(first[0]); // generation A reused, no new object
    expect(second[0]).not.toBe(first[0]);
    expect(store.pending).toBe(0);
  });

  it('drops the newest event at capacity, counts it and never stores a scratch object', () => {
    const diag = createDiagnostics(() => undefined);
    const store = createEventStore(diag, 4);
    const scratch = shot(1);
    for (let i = 0; i < 6; i++) store.emit(scratch);
    const out = store.drain();
    expect(out).toHaveLength(4);
    for (const e of out) expect(e).not.toBe(scratch);
    expect(diag.snapshot()['core/event-buffer-dropped']).toBe(2);
  });

  it('gives distinct drained objects for two shots in one real tick', () => {
    const { sim, map } = rig(
      { map: 'industrial-warehouse', bots: 20, difficulty: 'hard', seed: 3 },
      {
        allowed: ['ai/few-patrol-nodes'],
      },
    );
    const drive = hunter(map, { fire: true });
    let found = false;
    for (let i = 0; i < 4000 && !found && sim.snapshot().phase !== 'ended'; i++) {
      sim.step(drive(sim.snapshot()));
      const shots = sim.drainEvents().filter((e): e is Ev<'shot'> => e.t === 'shot');
      const byTick = new Map<number, Ev<'shot'>[]>();
      for (const s of shots) byTick.set(s.tick, [...(byTick.get(s.tick) ?? []), s]);
      for (const same of byTick.values()) {
        if (same.length < 2) continue;
        const [a, b] = same as [Ev<'shot'>, Ev<'shot'>];
        expect(a).not.toBe(b);
        expect(a.origin).not.toBe(b.origin);
        expect(a.shooter).not.toBe(b.shooter);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});

describe('SenseWindow', () => {
  it('keeps copies, caps the list and prunes by tick', () => {
    const w = createSenseWindow(3);
    const n = noise(0, 1);
    w.addNoise(n);
    n.pos.x = 50;
    expect(w.noises[0]?.pos.x).toBe(1);
    for (let t = 2; t <= 5; t++) w.addNoise(noise(0, t));
    expect(w.noises.map((e) => e.tick)).toEqual([3, 4, 5]);
    w.addDamage(damage(3, 2));
    w.addDamage(damage(4, 6));
    w.prune(4);
    expect(w.noises.map((e) => e.tick)).toEqual([5]);
    expect(w.damages.map((e) => e.tick)).toEqual([6]);
    w.addNoise(noise(0, 7)); // reuses a pruned object
    expect(w.noises.map((e) => e.tick)).toEqual([5, 7]);
  });
});
