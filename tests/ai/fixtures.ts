/**
 * bot-ai fixtures: an open 60 x 60 m arena built on tests/physics/fixtures.ts,
 * plus builders for memory, self and brain context used by the unit tests.
 */
import { copy, createDiagnostics, createRng, vec3, type EntityId, type Vec3 } from '../../src/core';
import type { CoverPoint, MapDefinition, NavHint, Solid } from '../../src/maps';
import { bakeNavGraph, createPathService, type NavGraph } from '../../src/nav';
import { buildCollisionWorld, type CollisionWorld } from '../../src/physics';
import {
  DIFFICULTY_PROFILES,
  collectPatrolNodes,
  createBotBrain,
  createBrainScratch,
  createCoverRegistry,
  type BotBrain,
  type BotSelf,
  type BrainContext,
  type DifficultyProfile,
} from '../../src/ai/brain';
import { createPerceptionMemory, type PerceptionMemory } from '../../src/ai/perception';
import { box, fixtureMap } from '../physics/fixtures';
import { STANDING } from './harness';

const v = (x: number, y: number, z: number): Vec3 => vec3(x, y, z);

export const ARENA_HALF = 30;

export interface ArenaOptions {
  solids?: readonly Solid[];
  cover?: readonly CoverPoint[];
  patrol?: readonly Vec3[];
  spawns?: MapDefinition['spawns'];
}

/** Open ground with boundary walls; extra solids, cover and patrol hints on request. */
export function arena(o: ArenaOptions = {}): MapDefinition {
  const h = ARENA_HALF;
  const solids: Solid[] = [
    box('ground', [-h, -1, -h], [h, 0, h]),
    box('boundary', [-h, 0, -h], [-h + 0.5, 3, h]),
    box('boundary', [h - 0.5, 0, -h], [h, 3, h]),
    box('boundary', [-h, 0, -h], [h, 3, -h + 0.5]),
    box('boundary', [-h, 0, h - 0.5], [h, 3, h]),
    ...(o.solids ?? []),
  ];
  const navHints: NavHint[] = (
    o.patrol ?? [v(-15, 0, -15), v(15, 0, -15), v(15, 0, 15), v(-15, 0, 15)]
  ).map((pos) => ({ kind: 'patrol', pos }));
  return fixtureMap({
    solids,
    ramps: [],
    bounds: { min: v(-h, -1, -h), max: v(h, 6, h) },
    cover: o.cover ?? [],
    navHints,
    spawns: o.spawns ?? [
      { pos: v(0, 0, 20), yaw: 0, zone: 'a', player: true },
      { pos: v(0, 0, -20), yaw: 0, zone: 'b', player: false },
      { pos: v(-20, 0, -20), yaw: 0, zone: 'b', player: false },
      { pos: v(20, 0, -20), yaw: 0, zone: 'b', player: false },
      { pos: v(-20, 0, 0), yaw: 0, zone: 'c', player: false },
      { pos: v(20, 0, 0), yaw: 0, zone: 'c', player: false },
      { pos: v(-10, 0, -25), yaw: 0, zone: 'b', player: false },
      { pos: v(10, 0, -25), yaw: 0, zone: 'b', player: false },
    ],
  });
}

export interface Prepared {
  def: MapDefinition;
  world: CollisionWorld;
  graph: NavGraph;
}

export function prepare(def: MapDefinition): Prepared {
  const world = buildCollisionWorld(def);
  return { def, world, graph: bakeNavGraph(def, world, { agent: STANDING }) };
}

export function profileWith(over: Partial<DifficultyProfile> = {}): DifficultyProfile {
  return { ...DIFFICULTY_PROFILES.normal, ...over };
}

export function makeSelf(pos: Vec3, over: Partial<BotSelf> = {}): BotSelf {
  return {
    id: 1 as EntityId,
    pos: copy(pos, vec3()),
    yaw: 0,
    health: 100,
    armor: 0,
    mag: 30,
    reserve: 99,
    reloading: false,
    locomotion: 'moving',
    ...over,
  };
}

export function seen(mem: PerceptionMemory, p: Vec3, tick: number, first = tick): PerceptionMemory {
  mem.visible = true;
  mem.lastSeenPos = copy(p, mem.seenStore);
  mem.lastSeenTick = tick;
  mem.firstSeenTick = first;
  return mem;
}

export function unseen(mem: PerceptionMemory): PerceptionMemory {
  mem.visible = false;
  return mem;
}

export function hit(mem: PerceptionMemory, dir: Vec3, tick: number): PerceptionMemory {
  mem.underFireTick = tick;
  mem.threatDir = copy(dir, mem.threatStore);
  return mem;
}

export function heard(mem: PerceptionMemory, p: Vec3, tick: number): PerceptionMemory {
  mem.suspectedPos = copy(p, mem.suspectStore);
  mem.suspectedTick = tick;
  return mem;
}

export interface BrainRig {
  brain: BotBrain;
  ctx: BrainContext;
  mem: PerceptionMemory;
  self: BotSelf;
  prep: Prepared;
  codes: string[];
  /** Calls decide at `tick` and returns the intent. */
  at(tick: number): ReturnType<BotBrain['decide']>;
}

export function brainRig(
  prep: Prepared,
  pos: Vec3,
  over: Partial<DifficultyProfile> = {},
  seed = 1,
): BrainRig {
  const codes: string[] = [];
  const diag = createDiagnostics((c) => codes.push(c));
  const ctx: BrainContext = {
    tick: 0,
    rng: createRng(seed).fork('ai:1'),
    graph: prep.graph,
    cover: createCoverRegistry(prep.def.cover),
    world: prep.world,
    scratch: createBrainScratch(prep.graph.nodes.length),
    diag,
  };
  const brain = createBotBrain(
    1 as EntityId,
    profileWith(over),
    collectPatrolNodes(prep.graph, diag),
  );
  const mem = createPerceptionMemory();
  const self = makeSelf(pos);
  return {
    brain,
    ctx,
    mem,
    self,
    prep,
    codes,
    at(tick) {
      ctx.tick = tick;
      return brain.decide(self, mem, ctx);
    },
  };
}

export function pathService(p: Prepared): ReturnType<typeof createPathService> {
  return createPathService(p.graph, p.world);
}

export { v };

/** Non-null in tests without the `!` operator. */
export function must<T>(x: T | null | undefined, what = 'value'): T {
  if (x === null || x === undefined) throw new Error(`expected ${what}`);
  return x;
}
