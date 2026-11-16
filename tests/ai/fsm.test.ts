/**
 * Brain transition table T-01..T-27, one test per row (BR-AI-20,
 * story-bots-cover-flank-retreat criterion 4), plus intents per state.
 */
import { describe, expect, it } from 'vitest';
import { createDiagnostics, type Vec3 } from '../../src/core';
import { createBotBrain } from '../../src/ai/brain';
import { box, fixtureMap } from '../physics/fixtures';
import {
  arena,
  brainRig,
  heard,
  hit,
  must,
  prepare,
  profileWith,
  seen,
  unseen,
  v,
  type BrainRig,
} from './fixtures';

// Wall A across x -12..12 at z = 0 (3 m); cover point 0 just behind it facing +z;
// cover point 1 in the open.
const prep = prepare(
  arena({
    solids: [box('wall', [-12, 0, -0.3], [12, 3, 0.3])],
    cover: [
      { pos: v(0, 0, -1.2), facing: v(0, 0, 1), height: 'low', solid: 5 },
      { pos: v(20, 0, 20), facing: v(0, 0, -1), height: 'high', solid: 5 },
    ],
  }),
);
const PLAYER = v(0, 1.25, 15);
const BOT = v(5, 0, 6);
const ALWAYS = { coverChance: 1, flankChance: 1 };
const NEVER = { coverChance: 0, flankChance: 0 };

function rig(over = {}, pos: Vec3 = BOT): BrainRig {
  return brainRig(prep, pos, over);
}

/** Engage at tick t (T-03). */
function engaged(r: BrainRig, t = 6): void {
  seen(r.mem, PLAYER, t);
  r.at(t);
  expect(r.brain.state).toBe('engage');
}

const goalOf = (r: BrainRig): Vec3 => must(r.brain.intent.goal, 'goal');
const isNode = (r: BrainRig, p: Vec3): boolean =>
  r.prep.graph.nodes.some((n) => n.pos.x === p.x && n.pos.y === p.y && n.pos.z === p.z);

describe('global rows', () => {
  it('T-01 onDeath from any live state freezes the bot and releases its claims', () => {
    const r = rig(ALWAYS);
    engaged(r);
    hit(r.mem, v(0, 0, 1), 10);
    r.at(12);
    expect(r.brain.state).toBe('take-cover');
    expect(r.ctx.cover.claimOf(r.self.id)).toBe(0);
    r.brain.onDeath(20, r.ctx.cover);
    expect(r.brain.state).toBe('dead');
    expect(r.ctx.cover.claimOf(r.self.id)).toBeNull();
    const frozen = { ...r.brain.intent };
    expect(frozen).toEqual({
      goal: null,
      avoid: null,
      speed: 'walk',
      aimAt: null,
      fire: false,
      reload: false,
      crouch: false,
    });
    seen(r.mem, PLAYER, 30);
    expect(r.at(30)).toEqual(frozen);
    r.brain.onDeath(40, r.ctx.cover);
    expect(r.brain.stats.dead).toBe(1);
    expect(r.brain.stateEnteredTick).toBe(20);
  });

  it('T-02 low health while seen or under fire retreats, at most once per 600 ticks', () => {
    const r = rig(NEVER);
    engaged(r);
    r.self.health = 20;
    r.at(12);
    expect(r.brain.state).toBe('retreat');
    const g = goalOf(r);
    const d = Math.hypot(g.x - BOT.x, g.z - BOT.z);
    expect(d).toBeGreaterThanOrEqual(12);
    expect(prep.world.lineOfSight(PLAYER, v(g.x, g.y + 1.6, g.z))).toBe(false);
    expect(r.brain.intent.fire).toBe(false);
    expect(r.brain.intent.aimAt).toBeNull();
    expect(r.brain.intent.speed).toBe('run');
    // leave retreat (T-26, cover taken by another bot) and stay low: no second retreat before 600 ticks
    r.ctx.cover.claim(9 as never, 0);
    r.self.locomotion = 'arrived';
    r.at(12 + 180);
    expect(r.brain.state).toBe('engage');
    r.at(12 + 300);
    expect(r.brain.state).toBe('engage');
    r.self.locomotion = 'moving';
    seen(r.mem, PLAYER, 12 + 620);
    r.at(12 + 620);
    expect(r.brain.state).toBe('retreat');
  });

  it('T-02 fails without a retreat node: counts ai/no-retreat and retries only on a new hit', () => {
    const island = prepare(fixtureMap());
    const counted = createDiagnostics(() => undefined);
    const r = brainRig(island, v(-2, 1.2, 7), NEVER);
    r.ctx.diag = counted;
    seen(r.mem, v(-2, 2.45, 2), 6);
    r.at(6);
    r.self.health = 10;
    hit(r.mem, v(0, 0, -1), 10);
    r.at(12);
    expect(r.brain.state).toBe('engage');
    r.at(18);
    expect(counted.snapshot()['ai/no-retreat']).toBe(1);
    hit(r.mem, v(0, 0, -1), 20);
    r.at(24);
    expect(counted.snapshot()['ai/no-retreat']).toBe(2);
  });
});

describe('patrol rows', () => {
  it('T-03 patrol sees the player and engages', () => {
    const r = rig();
    r.at(0);
    expect(r.brain.state).toBe('patrol');
    expect(r.brain.intent.speed).toBe('walk');
    engaged(r);
    expect(r.brain.stats.engage).toBe(1);
  });

  it('T-04 patrol under fire takes cover when the roll passes and cover exists', () => {
    const r = rig(ALWAYS);
    r.at(0);
    hit(r.mem, v(0, 0, 1), 3);
    r.at(6);
    expect(r.brain.state).toBe('take-cover');
    expect(goalOf(r)).toEqual({ x: 0, y: 0, z: -1.2 });
    expect(r.ctx.cover.claimedBy(0)).toBe(1);
  });

  it('T-05 patrol under fire without cover investigates along the threat direction', () => {
    const r = rig(NEVER);
    r.at(0);
    hit(r.mem, v(1, 0, 0), 3);
    r.at(6);
    expect(r.brain.state).toBe('investigate');
    const g = goalOf(r);
    expect(g.x).toBeGreaterThan(BOT.x + 10);
    expect(isNode(r, g)).toBe(true);
    expect(r.brain.intent.speed).toBe('run');
  });

  it('T-06 patrol hears gunfire and investigates the suspected position', () => {
    const r = rig();
    r.at(0);
    heard(r.mem, v(-10, 0, 10), 3);
    r.at(6);
    expect(r.brain.state).toBe('investigate');
    expect(Math.hypot(goalOf(r).x + 10, goalOf(r).z - 10)).toBeLessThan(1.5);
    expect(r.brain.intent.aimAt).toEqual({ x: -10, y: 0, z: 10 });
  });

  it('T-07 patrol moves on after arriving (wait 0..90 ticks) and immediately on no-path', () => {
    const r = rig();
    r.at(0);
    const first = { ...goalOf(r) };
    r.self.locomotion = 'arrived';
    r.at(6);
    expect(goalOf(r)).toEqual(first);
    r.at(6 + 91);
    expect(goalOf(r)).not.toEqual(first);
    const second = { ...goalOf(r) };
    r.self.locomotion = 'no-path';
    r.at(200);
    expect(goalOf(r)).not.toEqual(second);
    expect(r.brain.state).toBe('patrol');
  });
});

describe('investigate rows', () => {
  function investigating(over = {}): BrainRig {
    const r = rig(over);
    r.at(0);
    heard(r.mem, v(-10, 0, 10), 3);
    r.at(6);
    expect(r.brain.state).toBe('investigate');
    return r;
  }

  it('T-08 investigate sees the player and engages', () => {
    const r = investigating();
    engaged(r, 12);
  });

  it('T-09 investigate under fire takes cover', () => {
    const r = investigating(ALWAYS);
    hit(r.mem, v(0, 0, 1), 10);
    r.at(12);
    expect(r.brain.state).toBe('take-cover');
  });

  it('T-10 a new suspect more than 3 m away retargets; a nearby one does not', () => {
    const r = investigating();
    const g0 = { ...goalOf(r) };
    heard(r.mem, v(-9, 0, 11), 10);
    r.at(12);
    expect(goalOf(r)).toEqual(g0);
    heard(r.mem, v(15, 0, 15), 14);
    r.at(18);
    expect(r.brain.state).toBe('investigate');
    expect(goalOf(r).x).toBeGreaterThan(10);
    expect(r.brain.stats.investigate).toBe(1);
  });

  it('T-11 on arrival it searches up to two nodes 4-10 m from the target at walk speed', () => {
    const r = investigating();
    const target = { ...goalOf(r) };
    r.self.locomotion = 'arrived';
    r.at(12);
    const s1 = { ...goalOf(r) };
    const d1 = Math.hypot(s1.x - target.x, s1.z - target.z);
    expect(d1).toBeGreaterThanOrEqual(4);
    expect(d1).toBeLessThanOrEqual(10);
    expect(r.brain.intent.speed).toBe('walk');
    expect(r.brain.intent.aimAt).toBeNull();
    r.self.locomotion = 'moving';
    r.at(18);
    r.self.locomotion = 'arrived';
    r.at(24);
    expect(goalOf(r)).not.toEqual(s1);
  });

  it('T-12 search done, 720-tick timeout or no-path at search returns to patrol', () => {
    const done = investigating();
    done.self.locomotion = 'arrived';
    done.at(12);
    done.at(18);
    done.at(24);
    expect(done.brain.state).toBe('patrol');

    const late = investigating();
    late.at(6 + 720);
    expect(late.brain.state).toBe('patrol');

    const blocked = investigating();
    blocked.self.locomotion = 'arrived';
    blocked.at(12);
    blocked.self.locomotion = 'no-path';
    blocked.at(18);
    expect(blocked.brain.state).toBe('patrol');
  });
});

describe('engage rows', () => {
  it('T-13 engage under fire takes cover', () => {
    const r = rig(ALWAYS);
    engaged(r);
    hit(r.mem, v(0, 0, 1), 8);
    r.at(12);
    expect(r.brain.state).toBe('take-cover');
  });

  it('T-14 engage while reloading and seen takes cover (rolled once per reload)', () => {
    const r = rig({ coverChance: 1, flankChance: 0 });
    engaged(r);
    r.self.reloading = true;
    seen(r.mem, PLAYER, 12, 6);
    r.at(12);
    expect(r.brain.state).toBe('take-cover');
    const once = rig({ coverChance: 0 });
    engaged(once);
    once.self.reloading = true;
    seen(once.mem, PLAYER, 12, 6);
    once.at(12);
    expect(once.brain.state).toBe('engage');
  });

  it('T-15 losing sight with fresh memory flanks when the roll passes', () => {
    const r = rig(ALWAYS);
    engaged(r);
    unseen(r.mem);
    r.at(12);
    expect(r.brain.state).toBe('flank');
    const a = must(r.brain.intent.avoid);
    expect(a.radius).toBeGreaterThanOrEqual(6);
    expect(a.radius).toBeLessThanOrEqual(15);
    expect(a.penalty).toBe(4);
    expect(r.ctx.cover.flankCount(-1) + r.ctx.cover.flankCount(1)).toBe(1);
    expect(r.brain.intent.fire).toBe(false);
  });

  it('T-16 lost sight with fresh memory and no flank investigates after 60 ticks', () => {
    const r = rig(NEVER);
    engaged(r);
    unseen(r.mem);
    r.at(12);
    expect(r.brain.state).toBe('engage');
    expect(r.brain.intent.fire).toBe(false);
    expect(r.brain.intent.speed).toBe('run');
    r.at(60);
    expect(r.brain.state).toBe('engage');
    r.at(72);
    expect(r.brain.state).toBe('investigate');
  });

  it('T-17 lost sight with stale memory investigates the last-seen point', () => {
    const r = rig(NEVER);
    engaged(r);
    unseen(r.mem);
    r.at(6 + 601);
    expect(r.brain.state).toBe('investigate');
    expect(Math.hypot(goalOf(r).x - PLAYER.x, goalOf(r).z - PLAYER.z)).toBeLessThan(1.5);
  });

  it('T-18 seen: aims and fires at the last-seen point and holds the 8-30 m band', () => {
    const near = brainRig(prep, v(0, 0, 11), NEVER);
    seen(near.mem, PLAYER, 6);
    near.at(6);
    expect(near.brain.intent.fire).toBe(true);
    expect(near.brain.intent.aimAt).toEqual(PLAYER);
    expect(goalOf(near).z).toBeLessThan(11); // backs away from z = 15
    expect(near.brain.intent.speed).toBe('run');

    const far = brainRig(prep, v(5, 0, -25), NEVER);
    seen(far.mem, PLAYER, 6);
    far.at(6);
    expect(far.brain.intent.speed).toBe('run');
    expect(Math.hypot(goalOf(far).x - PLAYER.x, goalOf(far).z - PLAYER.z)).toBeLessThan(1.5);

    const band = rig(NEVER);
    engaged(band);
    const g0 = { ...goalOf(band) };
    expect(band.brain.intent.speed).toBe('walk');
    expect(Math.hypot(g0.x - BOT.x, g0.z - BOT.z)).toBeGreaterThan(2);
    seen(band.mem, PLAYER, 12, 6);
    band.at(12);
    expect(goalOf(band)).toEqual(g0); // no reposition before repositionTicks
    seen(band.mem, PLAYER, 6 + 180, 6);
    band.at(6 + 180);
    expect(goalOf(band)).not.toEqual(g0);
  });
});

describe('take-cover rows', () => {
  function inCover(over = {}): BrainRig {
    const r = rig({ ...ALWAYS, ...over });
    engaged(r);
    hit(r.mem, v(0, 0, 1), 8);
    r.at(12);
    expect(r.brain.state).toBe('take-cover');
    return r;
  }

  it('T-19 fires while moving to cover when the player is seen', () => {
    const r = inCover();
    seen(r.mem, PLAYER, 18, 6);
    r.at(18);
    expect(r.brain.state).toBe('take-cover');
    expect(r.brain.intent.fire).toBe(true);
    expect(r.brain.intent.speed).toBe('run');
    expect(r.brain.intent.crouch).toBe(false);
  });

  it('T-20 holds, crouches at low cover, reloads, then leaves to engage or investigate', () => {
    const r = inCover({ coverHoldTicks: 60 });
    r.self.locomotion = 'arrived';
    r.self.mag = 10;
    unseen(r.mem);
    r.at(18);
    expect(r.brain.intent.crouch).toBe(true);
    expect(r.brain.intent.reload).toBe(true);
    r.at(18 + 60);
    expect(r.brain.state).toBe('engage');
    expect(r.ctx.cover.claimOf(r.self.id)).toBeNull();

    const stale = inCover({ coverHoldTicks: 60 });
    stale.self.locomotion = 'arrived';
    unseen(stale.mem);
    stale.at(18);
    stale.at(18 + 700);
    expect(stale.brain.state).toBe('investigate');
  });

  it('T-21 no path to cover goes to engage when seen or fresh, else investigate', () => {
    const r = inCover();
    r.self.locomotion = 'no-path';
    r.at(18);
    expect(r.brain.state).toBe('engage');
    const s = inCover();
    s.self.locomotion = 'stuck';
    unseen(s.mem);
    s.at(18 + 700);
    expect(s.brain.state).toBe('investigate');
  });
});

describe('flank rows', () => {
  function flanking(): BrainRig {
    const r = rig(ALWAYS);
    engaged(r);
    unseen(r.mem);
    r.at(12);
    expect(r.brain.state).toBe('flank');
    return r;
  }

  it('T-22 seeing the player during a flank engages and releases the flank side', () => {
    const r = flanking();
    seen(r.mem, PLAYER, 18, 6);
    r.at(18);
    expect(r.brain.state).toBe('engage');
    expect(r.ctx.cover.flankCount(-1) + r.ctx.cover.flankCount(1)).toBe(0);
  });

  it('T-23 arriving at the flank point heads for the last-seen point without avoid', () => {
    const r = flanking();
    r.self.locomotion = 'arrived';
    r.at(18);
    expect(r.brain.state).toBe('flank');
    expect(r.brain.intent.avoid).toBeNull();
    expect(Math.hypot(goalOf(r).x - PLAYER.x, goalOf(r).z - PLAYER.z)).toBeLessThan(1.5);
  });

  it('T-24 timeout, no-path or arriving at the last-seen point investigates', () => {
    const t = flanking();
    t.at(12 + 900);
    expect(t.brain.state).toBe('investigate');
    const n = flanking();
    n.self.locomotion = 'no-path';
    n.at(18);
    expect(n.brain.state).toBe('investigate');
    const a = flanking();
    a.self.locomotion = 'arrived';
    a.at(18);
    a.at(24);
    expect(a.brain.state).toBe('investigate');
  });
});

describe('retreat rows', () => {
  function retreating(over = {}): BrainRig {
    const r = rig({ ...NEVER, ...over });
    engaged(r);
    r.self.health = 20;
    r.at(12);
    expect(r.brain.state).toBe('retreat');
    return r;
  }

  it('T-25 after 180 ticks and arrival, takes cover when a point is free nearby', () => {
    const r = retreating();
    r.self.locomotion = 'arrived';
    r.at(100);
    expect(r.brain.state).toBe('retreat');
    r.at(12 + 180);
    expect(r.brain.state).toBe('take-cover');
  });

  it('T-26 without cover: engage when seen or fresh, else patrol', () => {
    const r = retreating();
    r.ctx.cover.claim(9 as never, 0);
    r.self.locomotion = 'arrived';
    r.at(12 + 180);
    expect(r.brain.state).toBe('engage');
    const s = retreating();
    s.ctx.cover.claim(9 as never, 0);
    s.self.locomotion = 'arrived';
    unseen(s.mem);
    s.at(12 + 700);
    expect(s.brain.state).toBe('patrol');
  });
});

describe('T-27 stuck recovery picks a different goal and keeps the state', () => {
  it('patrol picks the next node, investigate the next search node, flank and retreat step aside', () => {
    const p = rig();
    p.at(0);
    const g0 = { ...goalOf(p) };
    p.self.locomotion = 'stuck';
    p.at(6);
    expect(p.brain.state).toBe('patrol');
    expect(goalOf(p)).not.toEqual(g0);

    const f = rig(ALWAYS);
    engaged(f);
    unseen(f.mem);
    f.at(12);
    const fg = { ...goalOf(f) };
    f.self.locomotion = 'stuck';
    f.at(18);
    expect(f.brain.state).toBe('flank');
    expect(goalOf(f)).not.toEqual(fg);

    const i = rig();
    i.at(0);
    heard(i.mem, v(-10, 0, 10), 3);
    i.at(6);
    i.self.locomotion = 'stuck';
    i.at(12); // starts searching
    const s1 = { ...goalOf(i) };
    i.at(18); // stuck again: next search node
    expect(goalOf(i)).not.toEqual(s1);
  });
});

describe('decide guards and setup (BR-AI-80, BR-AI-81)', () => {
  it('keeps the previous intent on bad input and reports ai/bad-input', () => {
    const r = rig();
    r.at(0);
    const before = { ...r.brain.intent };
    r.self.pos.x = NaN;
    r.at(6);
    expect({ ...r.brain.intent }).toEqual(before);
    expect(r.codes).toEqual(['ai/bad-input']);
  });

  it('every emitted goal is a nav node position (BR-AI-23)', () => {
    const r = rig();
    for (let t = 0; t < 600; t += 6) {
      r.self.locomotion = t % 60 === 0 ? 'arrived' : 'moving';
      if (t === 120) heard(r.mem, v(-20, 0, -20), t);
      if (t === 240) seen(r.mem, PLAYER, t);
      if (t === 300) unseen(r.mem);
      r.at(t);
      if (r.brain.intent.goal !== null) expect(isNode(r, goalOf(r))).toBe(true);
    }
  });

  it('rejects bad ids and profiles', () => {
    expect(() => createBotBrain(0 as never, profileWith(), [])).toThrow('1..20');
    expect(() => createBotBrain(21 as never, profileWith(), [])).toThrow('1..20');
    expect(() => createBotBrain(1 as never, {} as never, [])).toThrow('profile');
  });

  it('a brain with no patrol nodes holds still', () => {
    const r = rig();
    const empty = createBotBrain(2 as never, profileWith(), []);
    r.ctx.tick = 0;
    expect(empty.decide(r.self, r.mem, r.ctx).goal).toBeNull();
  });
});
