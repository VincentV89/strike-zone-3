/**
 * bot-perception (story-bots-perception; BR-AI-02..09, SD-AI-03/04).
 */
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, createRng, vec3, type EntityId, type Vec3 } from '../../src/core';
import {
  MAX_SENSE_RAYS,
  PERCEPTION_TUNING,
  createPerceptionMemory,
  sense,
  targetPointsFor,
  type DamageEvent,
  type NoiseEvent,
  type SenseInput,
} from '../../src/ai/perception';
import { DIFFICULTY_PROFILES } from '../../src/ai/brain';
import { box } from '../physics/fixtures';
import { recordingDiag, strictDiag } from '../sim/helpers';
import { countingWorld } from './counting';
import { arena, must, prepare } from './fixtures';

const P = DIFFICULTY_PROFILES.normal.perception;
// A wall across x -10..10 at z = 0 (3 m high).
const prep = prepare(arena({ solids: [box('wall', [-10, 0, -0.2], [10, 3, 0.2])] }));
const BOT = 1 as EntityId;

function input(over: Partial<SenseInput> = {}): SenseInput {
  return {
    selfId: BOT,
    selfEye: vec3(0, 1.6, 10),
    selfYaw: 0, // faces -Z
    targetPoints: [],
    noises: [],
    damageTaken: [],
    tick: 10,
    ...over,
  };
}

const pts = (feet: Vec3): Vec3[] => targetPointsFor(feet, false, [vec3(), vec3(), vec3()]);

const noise = (over: Partial<NoiseEvent> = {}): NoiseEvent => ({
  t: 'noise',
  tick: 9,
  source: PLAYER_ID,
  kind: 'gunfire',
  pos: vec3(0, 1.6, 20),
  radius: 60,
  ...over,
});

const damage = (over: Partial<DamageEvent> = {}): DamageEvent => ({
  t: 'damage',
  tick: 9,
  target: BOT,
  source: PLAYER_ID,
  amount: 25,
  armorLoss: 0,
  fromDir: vec3(0, 0.2, 3),
  headshot: false,
  ...over,
});

describe('target points (BR-AI-02)', () => {
  it('builds chest, head, knees standing and crouched', () => {
    const s = targetPointsFor(vec3(1, 2, 3), false, [vec3(), vec3(), vec3()]);
    expect(s.map((p) => p.y)).toEqual([3.25, 3.6, 2.5]);
    const c = targetPointsFor(vec3(1, 2, 3), true, [vec3(), vec3(), vec3()]);
    expect(c.map((p) => p.y)).toEqual([2.8, 3.1, 2.35]);
    expect(Object.isFrozen(PERCEPTION_TUNING.standOffsets)).toBe(true);
  });
});

describe('sight (BR-AI-03..05)', () => {
  it('sees a player in range, in the FOV cone and in line of sight', () => {
    const mem = createPerceptionMemory();
    sense(
      mem,
      input({ targetPoints: pts(vec3(0, 0, 3)) }),
      prep.world,
      P,
      createRng(1),
      strictDiag(),
    );
    expect(mem.visible).toBe(true);
    expect(mem.lastSeenPos).toEqual({ x: 0, y: 1.25, z: 3 });
    expect(mem.lastSeenTick).toBe(10);
    expect(mem.firstSeenTick).toBe(10);
  });

  it('does not see through a wall, behind its back or beyond sight range', () => {
    const rng = createRng(1);
    const behindWall = createPerceptionMemory();
    sense(
      behindWall,
      input({ targetPoints: pts(vec3(0, 0, -5)) }),
      prep.world,
      P,
      rng,
      strictDiag(),
    );
    expect(behindWall.visible).toBe(false);
    expect(behindWall.lastSeenPos).toBeNull();

    const behindBot = createPerceptionMemory();
    sense(
      behindBot,
      input({ targetPoints: pts(vec3(0, 0, 20)) }),
      prep.world,
      P,
      rng,
      strictDiag(),
    );
    expect(behindBot.visible).toBe(false);

    const far = createPerceptionMemory();
    const narrow = { ...P, sightRange: 5 };
    sense(far, input({ targetPoints: pts(vec3(0, 0, 3)) }), prep.world, narrow, rng, strictDiag());
    expect(far.visible).toBe(false);
  });

  it('casts at most three rays and stops at the first clear one (SD-AI-03)', () => {
    const w = countingWorld(prep.world);
    const mem = createPerceptionMemory();
    const many = [...pts(vec3(0, 0, -5)), ...pts(vec3(0, 0, -6))];
    sense(mem, input({ targetPoints: many }), w, P, createRng(1), strictDiag());
    expect(w.counts.lineOfSight).toBe(MAX_SENSE_RAYS);
    w.counts.lineOfSight = 0;
    sense(
      mem,
      input({ targetPoints: pts(vec3(0, 0, 3)), tick: 11 }),
      w,
      P,
      createRng(1),
      strictDiag(),
    );
    expect(w.counts.lineOfSight).toBe(1);
  });

  it('copies lastSeenPos and keeps firstSeenTick across a short break (BR-AI-04)', () => {
    const mem = createPerceptionMemory();
    const target = pts(vec3(0, 0, 3));
    sense(
      mem,
      input({ targetPoints: target, tick: 10 }),
      prep.world,
      P,
      createRng(1),
      strictDiag(),
    );
    must(target[0]).x = 99;
    expect(mem.lastSeenPos?.x).toBe(0);
    sense(mem, input({ targetPoints: [], tick: 13 }), prep.world, P, createRng(1), strictDiag());
    expect(mem.visible).toBe(false);
    expect(mem.firstSeenTick).toBe(10);
    sense(
      mem,
      input({ targetPoints: pts(vec3(0, 0, 3)), tick: 16 }),
      prep.world,
      P,
      createRng(1),
      strictDiag(),
    );
    expect(mem.firstSeenTick).toBe(10);
    sense(mem, input({ targetPoints: [], tick: 20 }), prep.world, P, createRng(1), strictDiag());
    sense(
      mem,
      input({ targetPoints: pts(vec3(0, 0, 3)), tick: 20 + P.reacquireGraceTicks + 1 }),
      prep.world,
      P,
      createRng(1),
      strictDiag(),
    );
    expect(mem.firstSeenTick).toBe(20 + P.reacquireGraceTicks + 1);
  });

  it('treats a target straight above the eye as inside the cone', () => {
    const mem = createPerceptionMemory();
    sense(
      mem,
      input({ targetPoints: [vec3(0, 4, 10)] }),
      prep.world,
      P,
      createRng(1),
      strictDiag(),
    );
    expect(mem.visible).toBe(true);
  });
});

describe('hearing (BR-AI-06, FD-AI-Q3)', () => {
  it('turns player gunfire into a suspected position inside the error disc, never lastSeenPos', () => {
    for (let seed = 0; seed < 50; seed++) {
      const mem = createPerceptionMemory();
      const n = noise({ pos: vec3(5, 1.6, -20) });
      sense(mem, input({ noises: [n] }), prep.world, P, createRng(seed), strictDiag());
      expect(mem.suspectedPos).not.toBeNull();
      expect(mem.lastSeenPos).toBeNull();
      const d = Math.hypot(5, 0, -30);
      const r = Math.max(P.hearingErrorMin, d * P.hearingErrorFrac);
      const off = Math.hypot(must(mem.suspectedPos).x - 5, must(mem.suspectedPos).z + 20);
      expect(off).toBeLessThanOrEqual(r + 1e-9);
      expect(mem.suspectedTick).toBe(9);
    }
  });

  it('ignores footsteps, landings, bot gunfire, old noise and noise beyond the radius', () => {
    const mem = createPerceptionMemory();
    mem.lastSenseTick = 5;
    const ignored = [
      noise({ kind: 'footstep' }),
      noise({ kind: 'land' }),
      noise({ source: 2 as EntityId }),
      noise({ tick: 5 }),
      noise({ radius: 1 }),
    ];
    sense(mem, input({ noises: ignored }), prep.world, P, createRng(1), strictDiag());
    expect(mem.suspectedPos).toBeNull();
  });

  it('lets the latest heard noise win and skips hearing while the player is visible', () => {
    const mem = createPerceptionMemory();
    sense(
      mem,
      input({
        noises: [
          noise({ tick: 8, pos: vec3(-20, 1, -20) }),
          noise({ tick: 9, pos: vec3(20, 1, -20) }),
        ],
      }),
      prep.world,
      P,
      createRng(3),
      strictDiag(),
    );
    expect(mem.suspectedTick).toBe(9);
    expect(must(mem.suspectedPos).x).toBeGreaterThan(10);
    const vis = createPerceptionMemory();
    sense(
      vis,
      input({ targetPoints: pts(vec3(0, 0, 3)), noises: [noise()] }),
      prep.world,
      P,
      createRng(3),
      strictDiag(),
    );
    expect(vis.suspectedPos).toBeNull();
  });
});

describe('damage (BR-AI-07)', () => {
  it('stores a unit xz threat direction and the tick, never a position', () => {
    const mem = createPerceptionMemory();
    sense(mem, input({ damageTaken: [damage()] }), prep.world, P, createRng(1), strictDiag());
    expect(mem.underFireTick).toBe(9);
    expect(mem.threatDir).toEqual({ x: 0, y: 0, z: 1 });
    expect(mem.lastSeenPos).toBeNull();
    expect(mem.suspectedPos).toBeNull();
  });

  it('ignores damage to other bots and already consumed events', () => {
    const mem = createPerceptionMemory();
    mem.lastSenseTick = 9;
    sense(
      mem,
      input({ damageTaken: [damage({ target: 2 as EntityId }), damage({ tick: 9 })] }),
      prep.world,
      P,
      createRng(1),
      strictDiag(),
    );
    expect(mem.underFireTick).toBe(-1);
    expect(mem.lastSenseTick).toBe(10);
  });

  it('keeps the old direction for a vertical fromDir', () => {
    const mem = createPerceptionMemory();
    sense(
      mem,
      input({ damageTaken: [damage({ fromDir: vec3(0, 1, 0) })] }),
      prep.world,
      P,
      createRng(1),
      strictDiag(),
    );
    expect(mem.underFireTick).toBe(9);
    expect(mem.threatDir).toBeNull();
  });
});

describe('bad input (BR-AI-81)', () => {
  it('reports ai/bad-input and leaves memory unchanged apart from lastSenseTick', () => {
    const diag = recordingDiag();
    const mem = createPerceptionMemory();
    sense(
      mem,
      input({ selfEye: vec3(NaN, 0, 0), targetPoints: pts(vec3(0, 0, 3)) }),
      prep.world,
      P,
      createRng(1),
      diag,
    );
    expect(mem.visible).toBe(false);
    expect(mem.lastSenseTick).toBe(10);
    sense(mem, input({ tick: NaN }), prep.world, P, createRng(1), diag);
    expect(mem.lastSenseTick).toBe(10);
    sense(
      mem,
      input({
        tick: 12,
        targetPoints: [vec3(Infinity, 0, 0)],
        noises: [noise({ pos: vec3(NaN, 0, 0) })],
        damageTaken: [damage({ fromDir: vec3(NaN, 0, 0) })],
      }),
      prep.world,
      P,
      createRng(1),
      diag,
    );
    expect(mem.visible).toBe(false);
    expect(mem.suspectedPos).toBeNull();
    expect(mem.threatDir).toBeNull();
    expect(diag.codes).toEqual(['ai/bad-input']);
  });
});
