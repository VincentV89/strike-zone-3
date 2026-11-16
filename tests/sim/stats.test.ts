/** match-stats fold (BR-GS-80..89, FD-GS-Q2 = A, SD-GS-07). */
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, StrikeZoneError, vec3, type EntityId } from '../../src/core';
import type { SimEvent } from '../../src/contracts';
import { EMPTY_SESSION, createStatsTracker, type RoundStats } from '../../src/sim/stats';
import type { HudStats } from '../../src/ui/hud';
import { hunter } from './drivers';
import { rig, runToEnd } from './fixtures';

const B1 = 1 as EntityId;
const B2 = 2 as EntityId;

const phase = (tick: number, p: 'live' | 'ended'): SimEvent => ({
  t: 'phase',
  tick,
  phase: p,
  outcome: p === 'ended' ? 'victory' : null,
});
const shot = (tick: number, shooter: EntityId, hit: EntityId | null): SimEvent => ({
  t: 'shot',
  tick,
  shooter,
  weapon: 'rifle',
  origin: vec3(),
  end: vec3(),
  hit,
  headshot: false,
});
const dmg = (
  tick: number,
  target: EntityId,
  source: EntityId,
  amount: number,
  armorLoss = 0,
): SimEvent => ({
  t: 'damage',
  tick,
  target,
  source,
  amount,
  armorLoss,
  fromDir: vec3(1, 0, 0),
  headshot: false,
});
const kill = (tick: number, victim: EntityId, killer: EntityId, headshot: boolean): SimEvent => ({
  t: 'kill',
  tick,
  victim,
  killer,
  weapon: 'rifle',
  headshot,
});

describe('StatsTracker fold', () => {
  it('folds shots, damage, kills, headshots and duration from events only', () => {
    const t = createStatsTracker(EMPTY_SESSION, 3);
    t.ingest([phase(210, 'live'), shot(220, PLAYER_ID, B1), shot(221, PLAYER_ID, null)]);
    t.ingest([
      dmg(220, B1, PLAYER_ID, 63),
      kill(230, B1, PLAYER_ID, true), // headshot kill counts
      kill(240, B2, PLAYER_ID, false), // body kill does not
      shot(241, B1, PLAYER_ID), // a bot shot is not the player's
      dmg(241, PLAYER_ID, B1, 13, 12),
      { t: 'noise', tick: 242, source: PLAYER_ID, kind: 'footstep', pos: vec3(), radius: 10 },
      { t: 'impact', tick: 243, point: vec3(), normal: vec3() },
      { t: 'weapon', tick: 244, actor: PLAYER_ID, kind: 'reload-start' },
    ]);
    const r = t.round();
    expect(r).toMatchObject({
      shotsFired: 2,
      shotsHit: 1,
      accuracy: 0.5,
      damageDealt: 63,
      damageTaken: 13,
      armorLost: 12,
      kills: 2,
      headshots: 1,
      enemiesTotal: 3,
      enemiesLeft: 1,
      deaths: 0,
      killerId: null,
      liveStartTick: 210,
      lastTick: 244,
    });
    expect(r.durationSec).toBeCloseTo((244 - 210) / 60, 9);
    expect(r.headshots).toBeLessThanOrEqual(r.kills);
    t.ingest([phase(300, 'ended'), shot(310, PLAYER_ID, null)]);
    expect(t.round().durationSec).toBeCloseTo(90 / 60, 9);
    expect(t.round()).toBe(r); // same object every call (BR-GS-89)
  });

  it('records the player death and the killer', () => {
    const t = createStatsTracker(EMPTY_SESSION, 1);
    t.ingest([kill(500, PLAYER_ID, B1, false)]);
    expect(t.round().deaths).toBe(1);
    expect(t.round().killerId).toBe(B1);
    expect(t.round().durationSec).toBe(0); // never went live
    expect(t.round().accuracy).toBe(0);
  });

  it('commit returns a new frozen session; victory is a win, the rest are losses', () => {
    const s0 = Object.freeze({ roundsWon: 2, roundsLost: 1 });
    for (const [o, won, lost] of [
      ['victory', 3, 1],
      ['defeat', 2, 2],
      ['time-expired', 2, 2],
    ] as const) {
      const t = createStatsTracker(s0, 5);
      const s = t.commit(o);
      expect(s).toEqual({ roundsWon: won, roundsLost: lost });
      expect(Object.isFrozen(s)).toBe(true);
      expect(t.session()).toBe(s);
      expect(t.round().outcome).toBe(o);
      expect(s0).toEqual({ roundsWon: 2, roundsLost: 1 });
    }
  });

  it('discard leaves the session unchanged (RA-03)', () => {
    const s0 = Object.freeze({ roundsWon: 4, roundsLost: 4 });
    const t = createStatsTracker(s0, 5);
    t.ingest([phase(210, 'live'), kill(300, B1, PLAYER_ID, false)]);
    t.discard();
    expect(t.session()).toBe(s0);
  });

  it('throws stats/closed on any call after commit or discard (BR-GS-88)', () => {
    const closedBy = [
      (t: ReturnType<typeof createStatsTracker>) => t.commit('victory'),
      (t: ReturnType<typeof createStatsTracker>) => {
        t.discard();
      },
    ];
    for (const close of closedBy) {
      const t = createStatsTracker(EMPTY_SESSION, 1);
      close(t);
      for (const f of [
        () => t.commit('defeat'),
        () => {
          t.discard();
        },
        () => {
          t.ingest([]);
        },
      ]) {
        expect(f).toThrow(StrikeZoneError);
        try {
          f();
        } catch (e) {
          expect((e as StrikeZoneError).code).toBe('stats/closed');
        }
      }
    }
  });

  it('RoundStats fits the hud HudStats shape (type-level check)', () => {
    const t = createStatsTracker(EMPTY_SESSION, 1);
    const hud: HudStats = t.round();
    const rs: Readonly<RoundStats> = t.round();
    expect(hud).toBe(rs);
  });

  it('folds a real round to the counts in its event log', () => {
    const { sim, map } = rig(
      { map: 'industrial-warehouse', bots: 3, difficulty: 'normal', seed: 11, durationSec: 120 },
      { allowed: ['ai/few-patrol-nodes'] },
    );
    const t = createStatsTracker(EMPTY_SESSION, 3);
    const drive = hunter(map, { fire: true });
    const all: SimEvent[] = [];
    for (let i = 0; i < 12_000 && sim.snapshot().phase !== 'ended'; i++) {
      sim.step(drive(sim.snapshot()));
      const ev = sim.drainEvents();
      t.ingest(ev); // the live drained array, as app-shell does
      for (const e of ev) all.push(structuredClone(e));
    }
    expect(runToEnd(sim, drive, 1)).toEqual([]);
    const r = t.round();
    const playerShots = all.filter((e) => e.t === 'shot' && e.shooter === PLAYER_ID);
    const playerKills = all.filter((e) => e.t === 'kill' && e.killer === PLAYER_ID);
    expect(r.shotsFired).toBe(playerShots.length);
    expect(r.shotsHit).toBe(playerShots.filter((e) => e.t === 'shot' && e.hit !== null).length);
    expect(r.kills).toBe(playerKills.length);
    expect(r.enemiesLeft).toBe(3 - playerKills.length);
    expect(r.kills).toBe(3 - sim.snapshot().botsAlive);
    const dealt = all.reduce(
      (s, e) => s + (e.t === 'damage' && e.source === PLAYER_ID ? e.amount : 0),
      0,
    );
    expect(r.damageDealt).toBe(dealt);
    expect(r.liveStartTick).toBe(210);
  });
});
