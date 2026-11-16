/**
 * Harness scenarios on fixtures (business-logic-model-bot-ai §8): H-4..H-12,
 * the information-firewall invariance test H-INV with its divergence twin
 * (SD-AI-02), determinism, round reset and stream isolation (SD-AI-13).
 */
import { describe, expect, it } from 'vitest';
import { vec3, type Vec3 } from '../../src/core';
import { createPathService } from '../../src/nav';
import { box } from '../physics/fixtures';
import { arena, must, v } from './fixtures';
import { createHarness, prepareMap, type Harness, type HarnessOptions } from './harness';
import { scriptedBrain } from './scripted-brain';

const wallMap = prepareMap(arena({ solids: [box('wall', [-10, 0, -0.2], [10, 3, 0.2])] }));
const openMap = prepareMap(arena());

const base = (over: Partial<HarnessOptions>): HarnessOptions => ({
  map: openMap.def,
  prepared: openMap,
  bots: 1,
  difficulty: 'normal',
  seed: 42,
  player: { kind: 'absent' },
  ...over,
});

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

describe('H-4 crossing (story-bots-unstuck criterion 2)', () => {
  it('two bots swap ends of a 2.4 m corridor, both arrive, and keep > 0.5 m apart', () => {
    const corridor = prepareMap(
      arena({
        solids: [
          box('wall', [-15, 0, -1.4], [15, 3, -1.2]),
          box('wall', [-15, 0, 1.2], [15, 3, 1.4]),
        ],
      }),
    );
    const h = createHarness(
      base({
        map: corridor.def,
        prepared: corridor,
        bots: 2,
        botSpawns: [
          { pos: v(-12, 0, 0), yaw: 0 },
          { pos: v(12, 0, 0), yaw: 0 },
        ],
        brain: scriptedBrain({ 1: [v(12, 0, 0)], 2: [v(-12, 0, 0)] }),
      }),
    );
    let minSep = Infinity;
    for (let t = 0; t < 60 * 20; t++) {
      h.step();
      if (t > 60) minSep = Math.min(minSep, dist(h.bot(1).pos, h.bot(2).pos));
    }
    expect(h.bot(1).status).toBe('arrived');
    expect(h.bot(2).status).toBe('arrived');
    expect(minSep).toBeGreaterThan(0.5);
  });
});

describe('H-5 sight (story-bots-perception criterion 1)', () => {
  const sees = (player: Vec3): boolean => {
    const h = createHarness(
      base({
        map: wallMap.def,
        prepared: wallMap,
        botSpawns: [{ pos: v(0, 0, 5), yaw: 0 }],
        brain: scriptedBrain({}),
        player: { kind: 'static', pos: player },
      }),
    );
    h.step(10);
    return h.bot(1).mem.visible;
  };

  it('does not see behind a wall or behind its back, and sees in view', () => {
    expect(sees(v(0, 0, -5))).toBe(false);
    expect(sees(v(0, 0, 15))).toBe(false);
    expect(sees(v(3, 0, -2 + 4))).toBe(true);
  });
});

describe('H-6 hearing (story-bots-perception criterion 2, FD-AI-Q3)', () => {
  it('turns gunfire behind the bot into a suspected point and an investigation', () => {
    // the wall at z = 0 hides the shooter; hearing ignores walls
    const player = v(0, 0, -10);
    const h = createHarness(
      base({
        map: wallMap.def,
        prepared: wallMap,
        botSpawns: [{ pos: v(0, 0, 8), yaw: Math.PI }],
        player: { kind: 'static', pos: player, fireEvery: 20, target: 'air' },
      }),
    );
    let investigated = false;
    for (let t = 0; t < 120 && !investigated; t++) {
      h.step();
      if (h.bot(1).state === 'investigate') investigated = true;
    }
    const mem = h.bot(1).mem;
    expect(mem.visible).toBe(false);
    const s = must(mem.suspectedPos);
    const d = 18.2;
    const P = h.profile.perception;
    expect(dist(s, player)).toBeGreaterThan(0);
    expect(dist(s, player)).toBeLessThanOrEqual(
      Math.max(P.hearingErrorMin, d * P.hearingErrorFrac) + 1.5,
    );
    expect(mem.lastSeenPos).toBeNull();
    expect(investigated).toBe(true);
  });
});

describe('H-7 engage and kill (req-bot-combat; BR-AI-44, BR-AI-45)', () => {
  it('fires only after the reaction delay, misses some shots and kills an exposed player', () => {
    const h = createHarness(
      base({
        bots: 3,
        botSpawns: [
          { pos: v(-4, 0, -10), yaw: 0 },
          { pos: v(0, 0, -10), yaw: 0 },
          { pos: v(4, 0, -10), yaw: 0 },
        ],
        player: { kind: 'static', pos: v(0, 0, 10) },
      }),
    );
    for (let t = 0; t < 60 * 30 && h.player.alive; t++) h.step();
    const shots = h.metrics.shots.reduce((a, b) => a + b, 0);
    const hits = h.metrics.hits.reduce((a, b) => a + b, 0);
    expect(h.player.alive).toBe(false);
    expect(h.metrics.reactionViolations).toBe(0);
    expect(shots).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(shots);
    for (const delay of h.metrics.firstShotDelay) {
      if (delay >= 0) expect(delay).toBeGreaterThanOrEqual(h.profile.reactionTicks);
    }
  });

  it('matches the seed-42 golden: first bot shot tick is stable', () => {
    const run = (): number => {
      const h = createHarness(
        base({
          botSpawns: [{ pos: v(0, 0, -10), yaw: 0 }],
          player: { kind: 'static', pos: v(0, 0, 10) },
        }),
      );
      h.step(240);
      return must(h.events.find((e) => e.t === 'shot')).tick;
    };
    const first = run();
    expect(run()).toBe(first);
    expect(first).toBeGreaterThanOrEqual(24);
  });
});

describe('H-8 walls block bot fire (req-bot-combat criterion 3)', () => {
  it('a bot with primed memory fires at a player behind a wall and never damages him', () => {
    const player = v(0, 0, -6);
    const h = createHarness(
      base({
        map: wallMap.def,
        prepared: wallMap,
        botSpawns: [{ pos: v(0, 0, 8), yaw: 0 }],
        playerHealth: 100_000,
        player: { kind: 'static', pos: player },
        brain: () => ({
          goal: null,
          avoid: null,
          speed: 'walk',
          aimAt: v(0, 1.25, -6),
          fire: true,
          reload: false,
          crouch: false,
        }),
      }),
    );
    const mem = h.bot(1).mem;
    for (let t = 0; t < 60 * 10; t++) {
      // memory primed every tick as if the bot could see through the wall
      mem.visible = true;
      mem.lastSeenPos = vec3(0, 1.25, -6);
      mem.lastSeenTick = h.tick;
      mem.firstSeenTick = -1000;
      h.step();
    }
    expect(h.metrics.shots[0]).toBeGreaterThan(10);
    expect(h.metrics.playerDamage).toBe(0);
    expect(h.player.health).toBe(100_000);
  });
});

describe('H-9 cover (story-bots-cover-flank-retreat criterion 1)', () => {
  it('picks a cover point the shooter cannot see', () => {
    const coverMap = prepareMap(
      arena({
        solids: [box('wall', [-3, 0, -6.4], [3, 2.5, -6])],
        cover: [
          { pos: v(0, 0, -7.2), facing: v(0, 0, 1), height: 'high', solid: 5 },
          { pos: v(6, 0, -3), facing: v(0, 0, 1), height: 'low', solid: 5 },
        ],
      }),
    );
    const player = v(0, 0, 12);
    let tookCover = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const h = createHarness(
        base({
          map: coverMap.def,
          prepared: coverMap,
          seed,
          botSpawns: [{ pos: v(4, 0, -1), yaw: Math.PI }],
          player: { kind: 'static', pos: player, fireEvery: 12 },
          profileOverride: { coverChance: 1 },
          playerHealth: 100_000,
        }),
      );
      for (let t = 0; t < 600; t++) {
        h.step();
        const claim = h.cover.claimOf(1 as never);
        if (h.bot(1).state === 'take-cover' && claim !== null) {
          tookCover++;
          const c = h.cover.point(claim);
          expect(
            coverMap.world.lineOfSight(v(0, 1.6, 12), v(c.pos.x, c.pos.y + 1.6, c.pos.z)),
          ).toBe(false);
        }
      }
    }
    expect(tookCover).toBeGreaterThan(0);
  });
});

describe('H-10 flank (story-bots-cover-flank-retreat criterion 2, story-bot-coordination)', () => {
  const court = prepareMap(arena({ solids: [box('wall', [-8, 0, 4.8], [8, 3, 5.2])] }));
  const flankRun = (bots: number, seed: number): Harness => {
    const spawns = [v(0, 0, -12), v(-3, 0, -12), v(3, 0, -12), v(6, 0, -12)].slice(0, bots);
    return createHarness(
      base({
        map: court.def,
        prepared: court,
        bots,
        seed,
        botSpawns: spawns.map((pos) => ({ pos, yaw: 0 })),
        // visible near z = 0, then walks round the wall end and hides behind it at z = 10
        player: {
          kind: 'route',
          points: [v(0, 0, 0), v(0, 0, 0.5), v(11, 0, 3), v(11, 0, 10), v(0, 0, 10)],
          speed: 4,
          once: true,
        },
        profileOverride: { flankChance: 1, coverChance: 0, engageMin: 2 },
        playerHealth: 100_000,
      }),
    );
  };

  it('a flanking route differs from the direct route by more than 4 m somewhere', () => {
    const h = flankRun(1, 3);
    let checked = false;
    for (let t = 0; t < 60 * 20 && !checked; t++) {
      h.step();
      const b = h.bot(1);
      const m = b.motion;
      const target = b.mem.lastSeenPos;
      if (b.state !== 'flank' || m.avoid === null || m.status !== 'moving' || target === null)
        continue;
      // the unconstrained route from the same point straight to the last-seen position
      const direct = createPathService(court.graph, court.world);
      const end = must(court.graph.nodes[must(court.graph.nearestNode(target))]).pos;
      const ticket = direct.request(9 as never, {
        from: vec3(b.pos.x, b.pos.y, b.pos.z),
        to: vec3(end.x, end.y, end.z),
      });
      direct.tick();
      const r = direct.poll(ticket);
      if (r === 'pending' || !r.ok) continue;
      let far = false;
      for (let i = m.waypoint; i < m.pathLen; i++) {
        const p = v(m.path[3 * i] ?? 0, m.path[3 * i + 1] ?? 0, m.path[3 * i + 2] ?? 0);
        if (r.value.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 4)) far = true;
      }
      expect(far).toBe(true);
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it('four bots flanking one target use both sides', () => {
    let both = false;
    for (let seed = 1; seed <= 3 && !both; seed++) {
      const h = flankRun(4, seed);
      for (let t = 0; t < 60 * 20 && !both; t++) {
        h.step();
        both = h.cover.flankCount(-1) > 0 && h.cover.flankCount(1) > 0;
      }
    }
    expect(both).toBe(true);
  });
});

describe('H-11 retreat (BR-AI-30)', () => {
  it('a hurt bot runs away from the shooter without firing', () => {
    const h = createHarness(
      base({
        map: wallMap.def,
        prepared: wallMap,
        botSpawns: [{ pos: v(0, 0, 10), yaw: Math.PI }],
        player: { kind: 'static', pos: v(0, 0, 22), fireEvery: 30 },
        playerHealth: 100_000,
        profileOverride: { coverChance: 0, flankChance: 0 },
      }),
    );
    h.setBotHealth(1, 20);
    let entered = -1;
    for (let t = 0; t < 600 && entered < 0; t++) {
      h.step();
      if (h.bot(1).state === 'retreat') entered = h.tick;
    }
    expect(entered).toBeGreaterThan(0);
    const d0 = dist(h.bot(1).pos, h.player.pos);
    const shotsBefore = h.metrics.shots[0] ?? 0;
    for (let t = 0; t < 179 && h.bot(1).state === 'retreat'; t++) h.step();
    expect(dist(h.bot(1).pos, h.player.pos)).toBeGreaterThan(d0);
    expect(h.metrics.shots[0]).toBe(shotsBefore);
  });
});

describe('H-12 death (story-bot-death criterion 1, BR-AI-31)', () => {
  it('a killed bot never moves, turns or fires again', () => {
    const h = createHarness(
      base({ bots: 3, map: openMap.def, player: { kind: 'static', pos: v(0, 0, 0) } }),
    );
    h.step(120);
    h.killBot(2);
    h.killBot(2);
    const b = h.bot(2);
    const frozen = {
      pos: { ...b.pos },
      yaw: b.yaw,
      pitch: b.pitch,
      mag: b.mag,
      shots: h.metrics.shots[1],
    };
    expect(b.state).toBe('dead');
    expect(b.alive).toBe(false);
    h.step(600);
    const a = h.bot(2);
    expect({
      pos: { ...a.pos },
      yaw: a.yaw,
      pitch: a.pitch,
      mag: a.mag,
      shots: h.metrics.shots[1],
    }).toEqual(frozen);
    expect(h.events.filter((e) => e.t === 'kill' && e.victim === 2)).toHaveLength(1);
  });
});

describe('information firewall (SD-AI-01, SD-AI-02)', () => {
  const seenLog = new Map<Harness, string>();
  const twin = (moveTick: (m: number) => number): { a: Harness; b: Harness } => {
    const opts = base({
      map: wallMap.def,
      prepared: wallMap,
      bots: 2,
      botSpawns: [
        { pos: v(-3, 0, 12), yaw: 0 },
        { pos: v(3, 0, 12), yaw: 0 },
      ],
      player: { kind: 'static', pos: v(0, 0, 3) },
      profileOverride: { coverChance: 0, flankChance: 0, reactionTicks: 1000 },
    });
    const a = createHarness(opts);
    const b = createHarness(opts);
    const m = moveTick(90);
    for (let t = 1; t <= 240; t++) {
      if (t === m) b.setPlayerPos(v(0, 0, -8)); // hidden behind the wall
      a.step();
      b.step();
      if (t === m) b.setPlayerPos(v(0, 0, 3));
      for (const h of [a, b]) {
        seenLog.set(
          h,
          `${seenLog.get(h) ?? ''}${h.bot(1).mem.visible ? 1 : 0}${h.bot(2).mem.visible ? 1 : 0}`,
        );
      }
    }
    return { a, b };
  };
  const trace = (h: Harness): string =>
    JSON.stringify([
      seenLog.get(h),
      h.metrics.intents,
      [1, 2].map((i) => [h.bot(i).pos, h.bot(i).yaw, h.bot(i).pitch]),
    ]);

  it('H-INV: moving the player on a tick where no bot senses changes no bot decision', () => {
    // bot 1 senses when (t + 1) % 3 === 0, bot 2 when (t + 2) % 3 === 0: nobody senses at t % 3 === 0
    const { a, b } = twin((m) => m - (m % 3));
    expect(trace(b)).toBe(trace(a));
  });

  it('divergence twin: the same move on a sense tick does change decisions', () => {
    const { a, b } = twin((m) => m - (m % 3) + 2);
    expect(trace(b)).not.toBe(trace(a));
  });
});

describe('determinism (SD-AI-13)', () => {
  const opts = base({
    bots: 4,
    seed: 7,
    player: { kind: 'route', points: [v(-10, 0, 10), v(10, 0, 10)], speed: 3, fireEvery: 15 },
    playerHealth: 100_000,
  });
  const run = (o: HarnessOptions): string => {
    const h = createHarness(o);
    h.step(60 * 20);
    return JSON.stringify([h.events, [1, 2, 3, 4].map((i) => h.bot(i).pos)]);
  };

  it('replays identically, also as a second round in the same process', () => {
    const first = run(opts);
    const second = run(opts);
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(1000);
  });

  it('isolates per-bot streams: bots 1..4 behave the same with a fifth bot far away', () => {
    const spawns = [v(-20, 0, -20), v(20, 0, -20), v(20, 0, 20), v(-20, 0, 20), v(0, 0, 25)].map(
      (pos) => ({
        pos,
        yaw: 0,
      }),
    );
    const four = createHarness(base({ bots: 4, botSpawns: spawns.slice(0, 4), seed: 5 }));
    const five = createHarness(
      base({ bots: 5, botSpawns: spawns, seed: 5, brain: undefined, player: { kind: 'absent' } }),
    );
    for (let t = 0; t < 60 * 5; t++) {
      four.step();
      five.step();
    }
    for (let i = 1; i <= 4; i++) {
      expect(five.metrics.intents[i - 1]).toEqual(four.metrics.intents[i - 1]);
    }
  });
});
