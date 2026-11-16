import { describe, expect, it } from 'vitest';
import { vec3, type EntityId, type Vec3 } from '../../src/core';
import type { SimEvent } from '../../src/contracts';
import {
  MAX_SHOT_TARGETS,
  createHitboxes,
  createShotOutcome,
  createVitals,
  executeShot,
  hitboxesFor,
  resolveShot,
  type ShotTarget,
  type Vitals,
} from '../../src/combat';
import { buildCollisionWorld, type CollisionWorld } from '../../src/physics';
import { WEAPON_PROFILES, createFireRequest, type FireRequest } from '../../src/weapons';
import { fixtureMap } from '../physics/fixtures';
import { copyingSink, id, recordingDiag, strictDiag } from '../sim/helpers';

const [rifle, , sniper] = WEAPON_PROFILES;
const world = buildCollisionWorld(fixtureMap());
const P = id(0);

function target(n: number, feet: Vec3, damageable = true, crouched = false): ShotTarget {
  return { id: id(n), hitboxes: hitboxesFor(feet, crouched, createHitboxes()), damageable };
}

function shot(origin: Vec3, dir: Vec3, shooter: EntityId = P): FireRequest {
  const r = createFireRequest(shooter);
  r.origin = vec3(origin.x, origin.y, origin.z);
  r.dir = vec3(dir.x, dir.y, dir.z);
  r.tick = 5;
  return r;
}

const FWD = vec3(0, 0, -1);

describe('resolveShot (BR-PC-40..44, SD-PC-11)', () => {
  it('hits the head on an eye-level ray and the body lower down', () => {
    const t = [target(1, vec3(0, 0, -6))];
    const head = resolveShot(shot(vec3(0, 1.6, 0), FWD), world, t, rifle, createShotOutcome());
    expect(head.hit).toMatchObject({ target: 1, headshot: true, damage: 63 });
    expect(head.distance).toBeCloseTo(5.85, 9);
    const body = resolveShot(shot(vec3(0, 1.0, 0), FWD), world, t, rifle, createShotOutcome());
    expect(body.hit).toMatchObject({ target: 1, headshot: false, damage: 25 });
    expect(body.end.z).toBeCloseTo(-5.65, 9);
    expect(body.impact).toBeNull();
  });

  it('stops at a wall: a target behind it is not hit (req-hitscan-damage AC1)', () => {
    const t = [target(1, vec3(-5, 0, -8))];
    const o = resolveShot(shot(vec3(-5, 1.0, 0), FWD), world, t, rifle, createShotOutcome());
    expect(o.hit).toBeNull();
    expect(o.impact).not.toBeNull();
    expect(o.distance).toBeCloseTo(4.9, 9);
    expect(o.impact?.normal).toEqual(vec3(0, 0, 1));
  });

  it('chooses the nearest of two targets and the lower index on a tie', () => {
    const near = target(2, vec3(0, 0, -4));
    const far = target(1, vec3(0, 0, -7));
    const o = resolveShot(shot(vec3(0, 1, 0), FWD), world, [far, near], rifle, createShotOutcome());
    expect(o.hit?.target).toBe(2);
    const twinA = target(3, vec3(0, 0, -4));
    const twinB = target(4, vec3(0, 0, -4));
    const tie = resolveShot(
      shot(vec3(0, 1, 0), FWD),
      world,
      [twinA, twinB],
      rifle,
      createShotOutcome(),
    );
    expect(tie.hit?.target).toBe(3);
  });

  it('lets the head win a tie with the body', () => {
    // Head and body boxes that coincide are entered at the same distance.
    const t = target(1, vec3(0, 0, -6));
    t.hitboxes.head = t.hitboxes.body;
    const o = resolveShot(shot(vec3(0, 1, 0), FWD), world, [t], rifle, createShotOutcome());
    expect(o.hit?.headshot).toBe(true);
    expect(o.hit?.damage).toBe(63);
  });

  it('stops at a non-damageable blocker and reports blockedBy (BR-PC-42)', () => {
    const ally = target(2, vec3(0, 0, -3), false);
    const player = target(0, vec3(0, 0, -8));
    const o = resolveShot(
      shot(vec3(0, 1, 0), FWD, id(1)),
      world,
      [player, ally],
      rifle,
      createShotOutcome(),
    );
    expect(o.hit).toBeNull();
    expect(o.blockedBy).toBe(2);
    expect(o.impact).toBeNull();
  });

  it("skips the shooter's own hitboxes", () => {
    const self = target(0, vec3(0, 0, 0));
    const o = resolveShot(shot(vec3(0, 1.6, 0), FWD), world, [self], rifle, createShotOutcome());
    expect(o.hit).toBeNull();
  });

  it('respects the weapon range', () => {
    const t = [target(1, vec3(0, 0, -6))];
    const short = { ...rifle, range: 3 };
    const o = resolveShot(shot(vec3(0, 1, 0), FWD), world, t, short, createShotOutcome());
    expect(o.hit).toBeNull();
    expect(o.distance).toBe(3);
  });

  it('misses at the origin on a bad ray (combat/bad-ray)', () => {
    const diag = recordingDiag();
    const t = [target(1, vec3(0, 0, -6))];
    for (const [o, d] of [
      [vec3(Number.NaN, 1, 0), FWD],
      [vec3(0, 1, 0), vec3(0, 0, 0)],
      [vec3(0, 1, 0), vec3(Infinity, 0, 0)],
    ] as const) {
      const out = resolveShot(shot(o, d), world, t, rifle, createShotOutcome(), diag);
      expect(out.hit).toBeNull();
      expect(out.distance).toBe(0);
    }
    expect(diag.codes).toEqual(['combat/bad-ray']);
  });

  it('is safe with an origin inside a wall: the shot ends at once (SD-PC-11)', () => {
    const t = [target(1, vec3(-5, 0, -7))];
    const o = resolveShot(shot(vec3(-5, 1, -5.05), FWD), world, t, rifle, createShotOutcome());
    expect(o.hit).toBeNull();
    expect(o.distance).toBeLessThan(0.2);
  });

  it(`tests at most ${MAX_SHOT_TARGETS} targets and reports combat/too-many-targets`, () => {
    const diag = recordingDiag();
    const many = Array.from({ length: 1000 }, (_, i) => target(i + 1, vec3(0, 0, -9 + i * 0.001)));
    many[500] = target(999, vec3(0, 0, -2)); // nearest, but beyond the cap
    const o = resolveShot(shot(vec3(0, 1, 0), FWD), world, many, rifle, createShotOutcome(), diag);
    expect(o.hit?.target).not.toBe(999);
    expect(diag.codes).toEqual(['combat/too-many-targets']);
  });
});

function scene(targets: ShotTarget[], vitalsById: Map<number, Vitals>) {
  const sink = copyingSink();
  const lookup = (n: EntityId): Vitals | undefined => vitalsById.get(n);
  return { sink, lookup, targets };
}

describe('executeShot (BR-PC-47..49)', () => {
  it('emits shot, damage, kill and noise in order and applies damage once', () => {
    const bot = createVitals('bot');
    const vit = new Map<number, Vitals>([
      [0, createVitals('player')],
      [1, bot],
    ]);
    const s = scene([target(1, vec3(0, 0, -6))], vit);
    executeShot(
      shot(vec3(0, 1.6, 0), FWD),
      sniper,
      world,
      s.targets,
      s.lookup,
      s.sink.emit,
      strictDiag(),
    );
    expect(s.sink.events.map((e) => e.t)).toEqual(['shot', 'damage', 'kill', 'noise']);
    const [shotE, dmg, kill, noise] = s.sink.events as [
      Extract<SimEvent, { t: 'shot' }>,
      Extract<SimEvent, { t: 'damage' }>,
      Extract<SimEvent, { t: 'kill' }>,
      Extract<SimEvent, { t: 'noise' }>,
    ];
    expect(shotE).toMatchObject({ tick: 5, shooter: 0, weapon: 'sniper', hit: 1, headshot: true });
    expect(dmg).toMatchObject({ target: 1, source: 0, amount: 100, armorLoss: 0, headshot: true });
    // fromDir points from the target toward the attacker (+Z here).
    expect(dmg.fromDir.z).toBeCloseTo(1, 9);
    expect(kill).toMatchObject({ victim: 1, killer: 0, weapon: 'sniper', headshot: true });
    expect(noise).toMatchObject({ kind: 'gunfire', source: 0, radius: 60, pos: vec3(0, 1.6, 0) });
    expect(bot.alive).toBe(false);
  });

  it('emits shot, impact and noise when the ray ends on geometry', () => {
    const s = scene([], new Map([[0, createVitals('player')]]));
    executeShot(
      shot(vec3(-5, 1, 0), FWD),
      rifle,
      world,
      s.targets,
      s.lookup,
      s.sink.emit,
      strictDiag(),
    );
    expect(s.sink.events.map((e) => e.t)).toEqual(['shot', 'impact', 'noise']);
    expect(s.sink.events[1]).toMatchObject({ t: 'impact', normal: vec3(0, 0, 1) });
  });

  it('emits shot (hit null) and noise for a blocked bot shot, with no damage', () => {
    const player = createVitals('player');
    const vit = new Map<number, Vitals>([
      [0, player],
      [1, createVitals('bot')],
      [2, createVitals('bot')],
    ]);
    const s = scene([target(0, vec3(0, 0, -8)), target(2, vec3(0, 0, -3), false)], vit);
    executeShot(
      shot(vec3(0, 1, 0), FWD, id(1)),
      rifle,
      world,
      s.targets,
      s.lookup,
      s.sink.emit,
      strictDiag(),
    );
    expect(s.sink.events.map((e) => e.t)).toEqual(['shot', 'noise']);
    expect(s.sink.events[0]).toMatchObject({ hit: null, headshot: false });
    expect([player.health, player.armor]).toEqual([100, 100]);
  });

  it('applies the armor split on the player', () => {
    const player = createVitals('player');
    const vit = new Map<number, Vitals>([
      [0, player],
      [1, createVitals('bot')],
    ]);
    const s = scene([target(0, vec3(0, 0, -8))], vit);
    executeShot(
      shot(vec3(0, 1, 0), FWD, id(1)),
      rifle,
      world,
      s.targets,
      s.lookup,
      s.sink.emit,
      strictDiag(),
    );
    expect(s.sink.events[1]).toMatchObject({
      t: 'damage',
      amount: 13,
      armorLoss: 12,
      target: 0,
      source: 1,
    });
    expect([player.health, player.armor]).toEqual([87, 88]);
  });

  it('does nothing when the shooter is dead or unknown (BR-PC-47)', () => {
    const deadBot = createVitals('bot');
    deadBot.alive = false;
    const vit = new Map<number, Vitals>([
      [0, createVitals('player')],
      [1, deadBot],
    ]);
    const s = scene([target(0, vec3(0, 0, -8))], vit);
    executeShot(
      shot(vec3(0, 1, 0), FWD, id(1)),
      rifle,
      world,
      s.targets,
      s.lookup,
      s.sink.emit,
      strictDiag(),
    );
    executeShot(
      shot(vec3(0, 1, 0), FWD, id(7)),
      rifle,
      world,
      s.targets,
      s.lookup,
      s.sink.emit,
      strictDiag(),
    );
    expect(s.sink.events).toEqual([]);
  });

  it('skips a target that died earlier in the stage and hits the one behind', () => {
    const front = createVitals('bot');
    front.alive = false;
    const back = createVitals('bot');
    const vit = new Map<number, Vitals>([
      [0, createVitals('player')],
      [1, front],
      [2, back],
    ]);
    const s = scene([target(1, vec3(0, 0, -3)), target(2, vec3(0, 0, -7))], vit);
    executeShot(
      shot(vec3(0, 1, 0), FWD),
      rifle,
      world,
      s.targets,
      s.lookup,
      s.sink.emit,
      strictDiag(),
    );
    expect(s.sink.events[0]).toMatchObject({ t: 'shot', hit: 2 });
    expect(back.health).toBe(75);
  });

  it('fails closed: a damageable target with no Vitals blocks the shot (SD-PC-12)', () => {
    const back = createVitals('bot');
    const vit = new Map<number, Vitals>([
      [0, createVitals('player')],
      [2, back],
    ]);
    const diag = recordingDiag();
    const s = scene([target(1, vec3(0, 0, -3)), target(2, vec3(0, 0, -7))], vit);
    executeShot(shot(vec3(0, 1, 0), FWD), rifle, world, s.targets, s.lookup, s.sink.emit, diag);
    expect(s.sink.events.map((e) => e.t)).toEqual(['shot', 'noise']);
    expect(back.health).toBe(100);
    expect(diag.codes).toEqual(['combat/unknown-target']);
  });

  it('skips targets with non-finite hitboxes and reports combat/unknown-target', () => {
    const t = target(1, vec3(0, 0, -6));
    t.hitboxes.body.min.x = Number.NaN;
    const diag = recordingDiag();
    const s = scene(
      [t],
      new Map([
        [0, createVitals('player')],
        [1, createVitals('bot')],
      ]),
    );
    executeShot(shot(vec3(0, 1, 0), FWD), rifle, world, s.targets, s.lookup, s.sink.emit, diag);
    expect(s.sink.events[0]).toMatchObject({ hit: null });
    expect(diag.codes).toEqual(['combat/unknown-target']);
  });

  it('still emits shot (ending at the origin) and noise on a bad ray', () => {
    const diag = recordingDiag();
    const s = scene(
      [target(1, vec3(0, 0, -6))],
      new Map([
        [0, createVitals('player')],
        [1, createVitals('bot')],
      ]),
    );
    executeShot(
      shot(vec3(0, 1, 0), vec3(0, 0, 0)),
      rifle,
      world,
      s.targets,
      s.lookup,
      s.sink.emit,
      diag,
    );
    expect(s.sink.events.map((e) => e.t)).toEqual(['shot', 'noise']);
    expect(s.sink.events[0]).toMatchObject({ hit: null, end: vec3(0, 1, 0) });
    expect(diag.codes).toEqual(['combat/bad-ray']);
  });

  it('emits nothing for a non-finite origin rather than NaN positions', () => {
    const diag = recordingDiag();
    const s = scene([], new Map([[0, createVitals('player')]]));
    executeShot(
      shot(vec3(Number.NaN, 1, 0), FWD),
      rifle,
      world,
      s.targets,
      s.lookup,
      s.sink.emit,
      diag,
    );
    expect(s.sink.events).toEqual([]);
    expect(diag.codes).toEqual(['combat/bad-ray']);
  });

  it('casts exactly one raycast per shot (PR-PC-07)', () => {
    let rays = 0;
    const spy: CollisionWorld = {
      ...world,
      bounds: world.bounds,
      raycast: (...a) => {
        rays++;
        return world.raycast(...a);
      },
    };
    const many = Array.from({ length: 21 }, (_, i) => target(i + 1, vec3(-8 + i * 0.7, 0, -6)));
    const vit = new Map<number, Vitals>(many.map((t) => [t.id as number, createVitals('bot')]));
    vit.set(0, createVitals('player'));
    const s = scene(many, vit);
    for (let i = 0; i < 10; i++) {
      executeShot(
        shot(vec3(0, 1, 0), FWD),
        rifle,
        spy,
        s.targets,
        s.lookup,
        s.sink.emit,
        strictDiag(),
      );
    }
    expect(rays).toBe(10);
    expect(s.sink.events.length).toBeLessThanOrEqual(10 * 5);
  });

  it('reuses its scratch events, so the sink must copy (SD-PC-10)', () => {
    const kept: SimEvent[] = [];
    const vit = new Map<number, Vitals>([[0, createVitals('player')]]);
    const lookup = (n: EntityId): Vitals | undefined => vit.get(n);
    executeShot(
      shot(vec3(-5, 1, 0), FWD),
      rifle,
      world,
      [],
      lookup,
      (e) => kept.push(e),
      strictDiag(),
    );
    const firstShot = kept[0];
    const r2 = shot(vec3(0, 1, 0), vec3(0, 0, 1));
    r2.tick = 9;
    executeShot(r2, rifle, world, [], lookup, (e) => kept.push(e), strictDiag());
    const secondShot = kept.find((e, i) => i > 0 && e.t === 'shot');
    expect(secondShot).toBe(firstShot);
    expect(firstShot).toMatchObject({ tick: 9 });
  });
});
