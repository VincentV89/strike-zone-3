/**
 * bot-brain parts: scheduler (BR-AI-10/11), difficulty (BR-AI-50..54),
 * cover registry (BR-AI-28/70/71), searches (BR-AI-13/25/26/30) and the aim
 * gate (BR-AI-41..43, SD-AI-11).
 */
import { describe, expect, it } from 'vitest';
import { StrikeZoneError, createDiagnostics, createRng, vec3, type EntityId } from '../../src/core';
import type { BotIntent } from '../../src/contracts';
import {
  COVER_MAX_LOS,
  DIFFICULTY_PROFILES,
  RETREAT_PROBES,
  SEARCH_MAX_VISITED,
  collectPatrolNodes,
  createAiScheduler,
  createBotAim,
  createBrainScratch,
  createCoverRegistry,
  getDifficultyProfile,
  stepBotAim,
  type BotAimContext,
  type CoverPointLike,
} from '../../src/ai/brain';
import { checkProfileFloors } from '../../src/ai/brain/difficulty';
import { boundedBfs, findRetreatNode, findSearchNodes } from '../../src/ai/brain/search';
import { createPerceptionMemory } from '../../src/ai/perception';
import { createVitals } from '../../src/combat';
import { createWeaponTrigger } from '../../src/weapons';
import { box } from '../physics/fixtures';
import { recordingDiag, strictDiag } from '../sim/helpers';
import { countingWorld } from './counting';
import { arena, must, prepare, profileWith, seen, v } from './fixtures';

const id = (n: number): EntityId => n as EntityId;

describe('scheduler (BR-AI-10, BR-AI-11)', () => {
  it('staggers 20 bots: 20 Hz sense, 10 Hz decide, at most 7 / 4 per tick', () => {
    const s = createAiScheduler(20);
    expect(s.senseInterval).toBe(3);
    expect(s.decideInterval).toBe(6);
    for (let t = 0; t < 120; t++) {
      let senses = 0;
      let decides = 0;
      for (let b = 1; b <= 20; b++) {
        if (s.shouldSense(id(b), t)) senses++;
        if (s.shouldDecide(id(b), t)) decides++;
      }
      expect(senses).toBeLessThanOrEqual(7);
      expect(decides).toBeLessThanOrEqual(4);
    }
    let perBot = 0;
    for (let t = 0; t < 60; t++) if (s.shouldDecide(id(7), t)) perBot++;
    expect(perBot).toBe(10);
  });

  it('wake forces exactly one sense and one decide', () => {
    const s = createAiScheduler(5);
    const t = 1; // bot 1: (1 + 1) % 6 !== 0
    expect(s.shouldDecide(id(1), t)).toBe(false);
    s.wake(id(1));
    s.wake(id(99));
    expect(s.shouldSense(id(1), t)).toBe(true);
    expect(s.shouldDecide(id(1), t)).toBe(true);
    expect(s.shouldDecide(id(1), t)).toBe(false);
  });

  it('accepts other rates that divide 60 and rejects bad config', () => {
    const s = createAiScheduler(3, { senseHz: 15, decideHz: 5 });
    expect([s.senseInterval, s.decideInterval]).toEqual([4, 12]);
    for (const bad of [
      () => createAiScheduler(21),
      () => createAiScheduler(1.5),
      () => createAiScheduler(-1),
      () => createAiScheduler(3, { senseHz: 7 }),
      () => createAiScheduler(3, { senseHz: 10, decideHz: 20 }),
      () => createAiScheduler(3, { decideHz: 0 }),
    ]) {
      expect(bad).toThrow(StrikeZoneError);
    }
    expect(s.shouldSense(id(0), 3)).toBe(false);
    expect(s.shouldSense(id(1), NaN)).toBe(false);
  });
});

describe('difficulty (BR-AI-50..54)', () => {
  it('orders reaction, aim error and tactics easy < normal < hard', () => {
    const e = getDifficultyProfile('easy');
    const n = getDifficultyProfile('normal');
    const h = getDifficultyProfile('hard');
    expect(e.reactionTicks).toBeGreaterThan(n.reactionTicks);
    expect(n.reactionTicks).toBeGreaterThan(h.reactionTicks);
    expect(h.reactionTicks).toBeGreaterThan(0);
    const err = (p: typeof e): number => p.aimErrorRad * p.aimSettleFloor;
    expect(err(e)).toBeGreaterThan(err(n));
    expect(err(n)).toBeGreaterThan(err(h));
    expect(err(h)).toBeGreaterThan(0);
    expect(e.coverChance).toBeLessThan(n.coverChance);
    expect(n.coverChance).toBeLessThan(h.coverChance);
    expect(e.flankChance).toBeLessThan(n.flankChance);
    expect(n.flankChance).toBeLessThan(h.flankChance);
    expect([e.reactionTicks, n.reactionTicks, h.reactionTicks]).toEqual([39, 24, 13]);
  });

  it('has no health or armor field, and bot vitals do not depend on difficulty (BR-AI-50)', () => {
    for (const p of Object.values(DIFFICULTY_PROFILES)) {
      expect(
        Object.keys(p).filter((k) => /health|armor/i.test(k) && k !== 'retreatHealth'),
      ).toEqual([]);
    }
    expect(createVitals('bot')).toEqual({ health: 100, armor: 0, alive: true, deathTick: null });
  });

  it('is frozen, and the lookup rejects prototype keys and unknown levels (SD-AI-08, SD-AI-10)', () => {
    expect(Object.isFrozen(DIFFICULTY_PROFILES.hard.perception)).toBe(true);
    expect(() => {
      (DIFFICULTY_PROFILES.hard as { reactionTicks: number }).reactionTicks = 0;
    }).toThrow(TypeError);
    for (const bad of ['__proto__', 'constructor', '', 'HARD', 3]) {
      expect(() => getDifficultyProfile(bad as never)).toThrow('Unknown difficulty');
    }
  });

  it('enforces the fairness floor (SD-AI-11)', () => {
    expect(() => {
      checkProfileFloors({ x: profileWith({ reactionTicks: 0 }) });
    }).toThrow(StrikeZoneError);
    expect(() => {
      checkProfileFloors({ x: profileWith({ aimErrorRad: 0 }) });
    }).toThrow(StrikeZoneError);
  });
});

// A 2.5 m wall across x -2..2 at z = -10.2; cover point 0 hides behind it from +z threats.
const coverPrep = prepare(
  arena({
    solids: [box('wall', [-2, 0, -10.4], [2, 2.5, -10])],
    cover: [
      { pos: v(0, 0, -11), facing: v(0, 0, 1), height: 'high', solid: 5 },
      { pos: v(8, 0, -7), facing: v(0, 0, 1), height: 'low', solid: 5 },
      { pos: v(-25, 0, -25), facing: v(0, 0, 1), height: 'high', solid: 5 },
    ],
  }),
);

describe('cover registry (BR-AI-28, BR-AI-70, BR-AI-71)', () => {
  const threat = v(0, 1.6, 10);

  it('returns the nearest free point whose sight line from the threat is blocked', () => {
    const reg = createCoverRegistry(coverPrep.def.cover);
    expect(reg.size).toBe(3);
    // point 1 is nearer but exposed; point 2 is beyond 25 m
    expect(reg.best(v(8, 0, -5), threat, coverPrep.world, id(1))).toBe(0);
    expect(reg.point(0).height).toBe('high');
  });

  it('skips points claimed by others, facing away or too close to the threat', () => {
    const reg = createCoverRegistry(coverPrep.def.cover);
    expect(reg.claim(id(2), 0)).toBe(true);
    expect(reg.best(v(8, 0, -5), threat, coverPrep.world, id(1))).toBeNull();
    expect(reg.best(v(8, 0, -5), threat, coverPrep.world, id(2))).toBe(0);
    expect(reg.best(v(0, 0, -5), v(0, 1.6, -30), coverPrep.world, id(3))).toBeNull(); // facing away
    expect(reg.best(v(0, 0, -5), v(0, 1.6, -8), coverPrep.world, id(3))).toBeNull(); // threat within 6 m
    expect(reg.best(v(NaN, 0, 0), threat, coverPrep.world, id(3))).toBeNull();
  });

  it('stops after 8 line-of-sight tests', () => {
    const many: CoverPointLike[] = Array.from({ length: 20 }, (_, i) => ({
      pos: v(-10 + i, 0, 0),
      facing: v(0, 0, 1),
      height: 'low' as const,
    }));
    const reg = createCoverRegistry(many);
    const w = countingWorld(coverPrep.world);
    expect(reg.best(v(0, 0, -2), v(0, 1.6, 20), w, id(1))).toBeNull();
    expect(w.counts.lineOfSight).toBe(COVER_MAX_LOS);
  });

  it('keeps claims exclusive under random claim, release and death (fuzz)', () => {
    const reg = createCoverRegistry(coverPrep.def.cover);
    const rng = createRng(9);
    for (let i = 0; i < 2000; i++) {
      const bot = id(rng.int(1, 6));
      const op = rng.int(0, 3);
      if (op === 0) reg.claim(bot, rng.int(-1, 4));
      else reg.release(bot);
      const holders = [0, 1, 2].map((p) => reg.claimedBy(p)).filter((h) => h !== null);
      expect(new Set(holders).size).toBe(holders.length);
      for (let b = 1; b <= 5; b++) {
        const c = reg.claimOf(id(b));
        if (c !== null) expect(reg.claimedBy(c)).toBe(b);
      }
    }
    expect(reg.claim(id(0), 0)).toBe(false);
    expect(reg.claimedBy(7)).toBeNull();
    expect(reg.claimOf(id(30))).toBeNull();
  });

  it('tallies flank sides per bot', () => {
    const reg = createCoverRegistry([]);
    reg.noteFlank(id(1), -1);
    reg.noteFlank(id(2), -1);
    reg.noteFlank(id(3), 1);
    expect([reg.flankCount(-1), reg.flankCount(1)]).toEqual([2, 1]);
    reg.releaseFlank(id(1));
    expect(reg.flankCount(-1)).toBe(1);
  });

  it('rejects bad cover data at setup (BR-AI-80)', () => {
    expect(() =>
      createCoverRegistry([{ pos: v(NaN, 0, 0), facing: v(0, 0, 1), height: 'low' }]),
    ).toThrow('non-finite');
    expect(() =>
      createCoverRegistry([{ pos: v(0, 0, 0), facing: v(0, 0, 1), height: 'mid' as never }]),
    ).toThrow();
    const tooMany = Array.from({ length: 81 }, () => ({
      pos: v(0, 0, 0),
      facing: v(0, 0, 1),
      height: 'low' as const,
    }));
    expect(() => createCoverRegistry(tooMany)).toThrow('Too many');
    expect(() => createCoverRegistry([]).point(0)).toThrow(StrikeZoneError);
  });
});

describe('graph searches (BR-AI-13, BR-AI-25, BR-AI-26, BR-AI-30)', () => {
  const wall = prepare(arena({ solids: [box('wall', [-12, 0, -0.3], [12, 3, 0.3])] }));
  const g = wall.graph;

  it('bounded BFS visits at most the cap and never twice', () => {
    const s = createBrainScratch(g.nodes.length);
    const start = must(g.nearestNode(v(0, 0, 10)));
    const n = boundedBfs(g, start, SEARCH_MAX_VISITED, s);
    expect(n).toBe(SEARCH_MAX_VISITED);
    const ids = Array.from(s.visited.slice(0, n));
    expect(new Set(ids).size).toBe(n);
    expect(boundedBfs(g, -1, 10, s)).toBe(0);
    s.generation = 0xffffffff;
    expect(boundedBfs(g, start, 5, s)).toBe(5);
    expect(s.generation).toBe(1);
  });

  it('finds a retreat node 12-30 m away that the threat cannot see, using at most 24 LOS tests', () => {
    const w = countingWorld(wall.world);
    const threat = v(0, 1.6, 15);
    const from = v(0, 0, 5);
    const node = must(findRetreatNode(g, from, threat, w, vec3(), vec3()));
    const p = must(g.nodes[node]).pos;
    const d = Math.hypot(p.x - from.x, p.z - from.z);
    expect(d).toBeGreaterThanOrEqual(12);
    expect(d).toBeLessThanOrEqual(30);
    expect(wall.world.lineOfSight(threat, v(p.x, p.y + 1.6, p.z))).toBe(false);
    expect(w.counts.lineOfSight).toBeLessThanOrEqual(RETREAT_PROBES);
  });

  it('falls back to the farthest exposed node, and to null off the graph', () => {
    const openPrep = prepare(arena());
    const node = findRetreatNode(
      openPrep.graph,
      v(0, 0, 0),
      v(0, 1.6, 5),
      openPrep.world,
      vec3(),
      vec3(),
    );
    expect(node).not.toBeNull();
    expect(
      findRetreatNode(openPrep.graph, v(500, 0, 500), v(0, 1.6, 5), openPrep.world, vec3(), vec3()),
    ).toBeNull();
  });

  it('picks up to two distinct search nodes 4-10 m from the target', () => {
    const s = createBrainScratch(g.nodes.length);
    const out = new Int32Array(2);
    const target = v(5, 0, 10);
    const n = findSearchNodes(g, target, createRng(4), s, out);
    expect(n).toBe(2);
    expect(out[0]).not.toBe(out[1]);
    for (const nid of out) {
      const p = must(g.nodes[nid]).pos;
      const d = Math.hypot(p.x - target.x, p.z - target.z);
      expect(d).toBeGreaterThanOrEqual(4);
      expect(d).toBeLessThanOrEqual(10);
    }
    expect(findSearchNodes(g, v(900, 0, 0), createRng(4), s, out)).toBe(0);
  });

  it('collects patrol hint anchors, and adds cover anchors when there are fewer than 3', () => {
    const diag = recordingDiag();
    expect(collectPatrolNodes(g, diag)).toHaveLength(4);
    expect(diag.codes).toEqual([]);
    const few = prepare(arena({ patrol: [v(5, 0, 5)], cover: coverPrep.def.cover }));
    const nodes = collectPatrolNodes(few.graph, diag);
    expect(diag.codes).toEqual(['ai/few-patrol-nodes']);
    expect(nodes.length).toBeGreaterThan(1);
    expect(Object.isFrozen(nodes)).toBe(true);
  });

  it('rejects a bad node count for the scratch', () => {
    expect(() => createBrainScratch(-1)).toThrow(StrikeZoneError);
    expect(() => createBrainScratch(8001)).toThrow(StrikeZoneError);
  });
});

describe('aim and fire gate (BR-AI-41..43, SD-AI-11)', () => {
  const intent = (over: Partial<BotIntent> = {}): BotIntent => ({
    goal: null,
    avoid: null,
    speed: 'walk',
    aimAt: null,
    fire: true,
    reload: false,
    crouch: false,
    ...over,
  });
  const ctxAt = (tick: number, over: Partial<BotAimContext> = {}): BotAimContext => ({
    tick,
    dt: 1 / 60,
    eye: v(0, 1.6, 0),
    vel: v(0, 0, 0),
    mag: 30,
    reloading: false,
    profile: DIFFICULTY_PROFILES.normal,
    rng: createRng(3).fork('aim/1'),
    diag: strictDiag(),
    ...over,
  });

  it('turns at most turnRate per tick and never fires before the reaction delay', () => {
    const D = DIFFICULTY_PROFILES.normal;
    const a = createBotAim(Math.PI); // facing +z, target at -z
    const mem = seen(createPerceptionMemory(), v(0, 1.6, -20), 0, 0);
    const out = createWeaponTrigger();
    const ctx = ctxAt(0);
    let firstFire = -1;
    let prevYaw = a.yaw;
    for (let t = 0; t < 120; t++) {
      ctx.tick = t;
      stepBotAim(a, intent(), mem, ctx, out);
      const turned = Math.abs(Math.atan2(Math.sin(a.yaw - prevYaw), Math.cos(a.yaw - prevYaw)));
      expect(turned).toBeLessThanOrEqual(D.turnRateRad / 60 + 1e-9);
      prevYaw = a.yaw;
      expect(out.select).toBeNull();
      expect(out.cycle).toBe(0);
      expect(out.scope).toBe(false);
      if (out.fire && firstFire < 0) firstFire = t;
    }
    expect(firstFire).toBeGreaterThanOrEqual(D.reactionTicks);
  });

  it('fires in bursts with pauses, and only when visible and permitted', () => {
    const D = DIFFICULTY_PROFILES.hard;
    const a = createBotAim(0);
    const mem = seen(createPerceptionMemory(), v(0, 1.6, -20), 0, -1000);
    const out = createWeaponTrigger();
    const fires: boolean[] = [];
    let pressed = 0;
    for (let t = 0; t < 300; t++) {
      stepBotAim(a, intent(), mem, ctxAt(t, { profile: D }), out);
      fires.push(out.fire);
      if (out.firePressed) pressed++;
    }
    expect(fires.some(Boolean)).toBe(true);
    expect(fires.some((f, i) => i > 60 && !f)).toBe(true);
    expect(pressed).toBeGreaterThan(1);
    stepBotAim(a, intent({ fire: false }), mem, ctxAt(301, { profile: D }), out);
    expect(out.fire).toBe(false);
    mem.visible = false;
    stepBotAim(a, intent(), mem, ctxAt(302, { profile: D }), out);
    expect(out.fire).toBe(false);
  });

  it('settles aim error toward the floor and faces travel without a target', () => {
    const a = createBotAim(0);
    const mem = createPerceptionMemory();
    const out = createWeaponTrigger();
    for (let t = 0; t < 200; t++)
      stepBotAim(a, intent({ fire: false }), mem, ctxAt(t, { vel: v(3, 0, 0) }), out);
    expect(a.yaw).toBeCloseTo(Math.atan2(-3, 0), 5);
    const still = createBotAim(1);
    stepBotAim(still, intent({ fire: false }), mem, ctxAt(0), out);
    expect(still.yaw).toBe(1);
    const aimed = createBotAim(0);
    stepBotAim(aimed, intent({ fire: false, aimAt: v(10, 1.6, 0) }), mem, ctxAt(0), out);
    expect(aimed.yaw).toBeLessThan(0);
  });

  it('reloads on an empty magazine or when the intent asks (BR-AI-43)', () => {
    const a = createBotAim(0);
    const mem = createPerceptionMemory();
    const out = createWeaponTrigger();
    stepBotAim(a, intent({ fire: false }), mem, ctxAt(0, { mag: 0 }), out);
    expect(out.reload).toBe(true);
    stepBotAim(a, intent({ fire: false }), mem, ctxAt(1, { mag: 0, reloading: true }), out);
    expect(out.reload).toBe(false);
    stepBotAim(a, intent({ fire: false, reload: true }), mem, ctxAt(2), out);
    expect(out.reload).toBe(true);
  });

  it('releases the trigger on bad input', () => {
    const diag = createDiagnostics(() => undefined);
    const a = createBotAim(0);
    const out = createWeaponTrigger();
    out.fire = true;
    stepBotAim(a, intent(), createPerceptionMemory(), ctxAt(0, { eye: v(NaN, 0, 0), diag }), out);
    expect(out.fire).toBe(false);
    expect(diag.snapshot()['ai/bad-input']).toBe(1);
    expect(createBotAim(NaN).yaw).toBe(0);
  });
});
