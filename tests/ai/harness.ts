/**
 * Fixture harness (business-logic-model-bot-ai §8). It copies game-simulation
 * tick stages 4-10 for bots, because bot-ai's tests cannot use the real
 * pipeline (game-simulation depends on bot-ai). It is NOT the game-simulation
 * pipeline (BR-AI-93). Imports are restricted (BR-AI-92, SD-AI-14) and checked
 * by tests/arch/ai-surface.test.ts.
 */
import { performance } from 'node:perf_hooks';
import {
  PLAYER_ID,
  TICK_DT,
  copy,
  createDiagnostics,
  createProfiler,
  createRng,
  vec3,
  type Diagnostics,
  type EntityId,
  type Profiler,
  type Rng,
  type Seed,
  type Vec3,
} from '../../src/core';
import type { BotIntent, Difficulty, LocomotionStatus, MapId, SimEvent } from '../../src/contracts';
import {
  ARMOR_MODEL,
  applyDamage,
  createHitboxes,
  createVitals,
  executeShot,
  hitboxesFor,
  type Hitboxes,
  type ShotTarget,
  type Vitals,
} from '../../src/combat';
import { MAP_RULES, getMap, type MapDefinition } from '../../src/maps';
import { bakeNavGraph, createPathService, type NavGraph, type PathService } from '../../src/nav';
import {
  buildCollisionWorld,
  type Capsule,
  type CollisionWorld,
  type MoveResult,
} from '../../src/physics';
import {
  WEAPON_PROFILES,
  createFireRequest,
  createLoadout,
  createWeaponTrigger,
  stepWeapon,
  type AimContext,
  type FireRequest,
  type Loadout,
  type WeaponTrigger,
} from '../../src/weapons';
import {
  createAiScheduler,
  createBotAim,
  createBotBrain,
  createBrainScratch,
  createCoverRegistry,
  collectPatrolNodes,
  getDifficultyProfile,
  stepBotAim,
  type AiScheduler,
  type BotAimContext,
  type BotAimState,
  type BotBrain,
  type BotSelf,
  type BotStateName,
  type BrainContext,
  type BrainScratch,
  type CoverRegistry,
  type DifficultyProfile,
} from '../../src/ai/brain';
import {
  createBotMotion,
  releaseMotion,
  setGoal,
  stepBotMotion,
  type BotMotionState,
  type LocoContext,
  type NeighbourView,
} from '../../src/ai/locomotion';
import {
  createPerceptionMemory,
  sense,
  targetPointsFor,
  type DamageEvent,
  type NoiseEvent,
  type PerceptionMemory,
  type SenseInput,
} from '../../src/ai/perception';
import { countingPaths, countingWorld, zeroCounts, type Counts } from './counting';

export const STANDING: Capsule = Object.freeze({
  radius: MAP_RULES.agentRadius,
  height: MAP_RULES.agentHeight,
});
export const CROUCHED: Capsule = Object.freeze({
  radius: MAP_RULES.agentRadius,
  height: MAP_RULES.crouchHeight,
});
const EYE_STAND = 1.6;
const EYE_CROUCH = 1.1;

/** B4 driver: a stand-in for the FSM that returns the bot's intent each decide. */
export type ScriptedBrain = (
  id: EntityId,
  self: Readonly<BotSelf>,
  mem: Readonly<PerceptionMemory>,
  tick: number,
) => Readonly<BotIntent>;

export type PlayerScript =
  | { kind: 'absent' }
  | {
      kind: 'static';
      pos: Vec3;
      yaw?: number;
      crouch?: boolean;
      fireEvery?: number;
      /** 'bots' (default) aims at the nearest visible bot; 'air' fires upward. */
      target?: 'bots' | 'air';
    }
  | {
      kind: 'route';
      points: readonly Vec3[];
      speed: number;
      fireEvery?: number;
      target?: 'bots' | 'air';
      /** Stop at the last point instead of looping. */
      once?: boolean;
    };

export interface HarnessOptions {
  map: MapId | MapDefinition;
  bots: number;
  difficulty: Difficulty;
  seed: Seed;
  player: PlayerScript;
  brain?: 'fsm' | ScriptedBrain;
  senseHz?: number;
  decideHz?: number;
  /** Explicit bot spawns (fixtures); otherwise the harness allocates from def.spawns. */
  botSpawns?: readonly { pos: Vec3; yaw: number }[];
  /** Player health override (scenarios that want a durable stand-in). */
  playerHealth?: number;
  /** Count world and path calls (H-14). */
  counting?: boolean;
  /** Shared baked map, to avoid re-baking in loops. */
  prepared?: PreparedMap;
  /** Bench mode: keep no event log, intent log or patrol log (heap probe). */
  lean?: boolean;
  /** Test-only tweaks to the difficulty profile (for example forcing a roll). */
  profileOverride?: Partial<DifficultyProfile>;
}

export interface PreparedMap {
  def: MapDefinition;
  world: CollisionWorld;
  graph: NavGraph;
}

export interface BotSnapshot {
  pos: Vec3;
  yaw: number;
  pitch: number;
  state: BotStateName;
  status: LocomotionStatus;
  mem: PerceptionMemory;
  health: number;
  mag: number;
  alive: boolean;
  intent: Readonly<BotIntent>;
  motion: BotMotionState;
}

export interface HarnessMetrics {
  shots: number[];
  hits: number[];
  /** Bot shots fired before the reaction delay (BR-AI-45); must stay 0. */
  reactionViolations: number;
  /** Ticks from first sight to first shot, per bot (-1 = no shot yet). */
  firstShotDelay: number[];
  /** Longest BR-AI-66 stuck span per bot (ticks). */
  maxStuckSpan: number[];
  /** Patrol goals in order, per bot (node keys). */
  patrolGoals: string[][];
  /** Bot shots that damaged the player. */
  playerDamage: number;
  /** Max LOS tests in one sense / one decide (counting mode). */
  maxLosPerSense: number;
  maxLosPerDecide: number;
  maxDecidesPerTick: number;
  maxSensesPerTick: number;
  intents: string[][];
}

export interface Harness {
  step(n?: number): void;
  readonly tick: number;
  bot(id: number): BotSnapshot;
  readonly player: Readonly<{ pos: Vec3; health: number; armor: number; alive: boolean }>;
  killBot(id: number): void;
  /** Moves the player stand-in immediately (H-INV). */
  setPlayerPos(p: Vec3): void;
  setBotHealth(id: number, health: number): void;
  readonly triggers: readonly WeaponTrigger[];
  readonly events: readonly SimEvent[];
  readonly metrics: HarnessMetrics;
  readonly profiler: Profiler;
  readonly diag: Diagnostics;
  readonly world: CollisionWorld;
  readonly graph: NavGraph;
  readonly paths: PathService;
  readonly cover: CoverRegistry;
  readonly scheduler: AiScheduler;
  readonly counts: Counts;
  readonly brains: readonly BotBrain[];
  readonly profile: DifficultyProfile;
}

interface Bot {
  id: EntityId;
  alive: boolean;
  mem: PerceptionMemory;
  motion: BotMotionState;
  brain: BotBrain | null;
  aim: BotAimState;
  trigger: WeaponTrigger;
  loadout: Loadout;
  vitals: Vitals;
  fire: FireRequest;
  hitboxes: Hitboxes;
  rngPerception: Rng;
  rngAi: Rng;
  rngAim: Rng;
  rngSpread: Rng;
  input: SenseInput;
  self: BotSelf;
  intent: Readonly<BotIntent>;
  eye: Vec3;
  stuckRef: Vec3;
  stuckRefTick: number;
  stuckStart: number;
}

const IDLE_INTENT: BotIntent = Object.freeze({
  goal: null,
  avoid: null,
  speed: 'walk',
  aimAt: null,
  fire: false,
  reload: false,
  crouch: false,
});

export function prepareMap(map: MapId | MapDefinition): PreparedMap {
  const def = typeof map === 'string' ? getMap(map) : map;
  const world = buildCollisionWorld(def);
  const graph = bakeNavGraph(def, world, { agent: STANDING });
  return { def, world, graph };
}

/** Throws on ai/bad-input (the harness sink fails on it, BR-AI-81); records everything else. */
export function harnessDiag(): Diagnostics & { codes: string[] } {
  const codes: string[] = [];
  const d = createDiagnostics((code) => {
    if (code === 'ai/bad-input') throw new Error('unexpected diagnostic ai/bad-input');
    codes.push(code);
  });
  return Object.assign(d, { codes });
}

function allocateSpawns(
  def: MapDefinition,
  n: number,
  playerRef: Vec3,
  rng: Rng,
): { pos: Vec3; yaw: number }[] {
  const order = def.spawns
    .map((s, i) => ({ s, i, d: Math.hypot(s.pos.x - playerRef.x, s.pos.z - playerRef.z) }))
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .slice(0, n);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    const tmp = order[i];
    const other = order[j];
    if (tmp === undefined || other === undefined) continue;
    order[i] = other;
    order[j] = tmp;
  }
  return order.map((o) => ({ pos: vec3(o.s.pos.x, o.s.pos.y, o.s.pos.z), yaw: o.s.yaw }));
}

export function createHarness(o: HarnessOptions): Harness {
  const prepared = o.prepared ?? prepareMap(o.map);
  const { def, graph } = prepared;
  const counts = zeroCounts();
  const world: CollisionWorld =
    o.counting === true ? countingWorld(prepared.world, counts) : prepared.world;
  const realPaths = createPathService(graph, prepared.world);
  const paths: PathService = o.counting === true ? countingPaths(realPaths, counts) : realPaths;
  const diag = harnessDiag();
  const profile: DifficultyProfile = {
    ...getDifficultyProfile(o.difficulty),
    ...o.profileOverride,
  };
  const cover = createCoverRegistry(def.cover);
  const scheduler = createAiScheduler(o.bots, {
    ...(o.senseHz === undefined ? {} : { senseHz: o.senseHz }),
    ...(o.decideHz === undefined ? {} : { decideHz: o.decideHz }),
  });
  const scratch: BrainScratch = createBrainScratch(graph.nodes.length);
  const patrolNodes = collectPatrolNodes(graph, diag);
  const root = createRng(o.seed);
  const spawnRng = root.fork('spawn');
  const profiler = createProfiler(() => performance.now());

  // ---- player stand-in
  const firstPlayerSpawn = def.spawns.find((s) => s.player) ?? def.spawns[0];
  const playerPos =
    o.player.kind === 'static'
      ? vec3(o.player.pos.x, o.player.pos.y, o.player.pos.z)
      : o.player.kind === 'route' && o.player.points[0] !== undefined
        ? copy(o.player.points[0], vec3())
        : vec3(
            firstPlayerSpawn?.pos.x ?? 0,
            firstPlayerSpawn?.pos.y ?? 0,
            firstPlayerSpawn?.pos.z ?? 0,
          );
  const player = {
    present: o.player.kind !== 'absent',
    pos: playerPos,
    vel: vec3(),
    yaw: o.player.kind === 'static' ? (o.player.yaw ?? 0) : 0,
    crouch: o.player.kind === 'static' && o.player.crouch === true,
    vitals: createVitals('player'),
    loadout: createLoadout(WEAPON_PROFILES),
    trigger: createWeaponTrigger(),
    fire: createFireRequest(PLAYER_ID),
    hitboxes: createHitboxes(),
    rngSpread: root.fork(`spread/${PLAYER_ID}`),
    routeIdx: 1,
    move: {
      position: vec3(),
      velocity: vec3(),
      grounded: true,
      hitCeiling: false,
      landed: false,
    } as MoveResult,
    grounded: true,
  };
  if (o.playerHealth !== undefined) player.vitals.health = o.playerHealth;
  const targetPts = [vec3(), vec3(), vec3()];
  const noTargets: Vec3[] = [];

  // ---- bots
  const spawns = o.botSpawns ?? allocateSpawns(def, o.bots, playerPos, spawnRng);
  if (spawns.length < o.bots) throw new Error('not enough spawns for the harness');
  const noises: NoiseEvent[] = [];
  const damages: DamageEvent[] = [];
  const bots: Bot[] = [];
  for (let i = 0; i < o.bots; i++) {
    const id = (i + 1) as EntityId;
    const sp = spawns[i];
    if (sp === undefined) throw new Error('missing spawn');
    const mem = createPerceptionMemory();
    const eye = vec3();
    const bot: Bot = {
      id,
      alive: true,
      mem,
      motion: createBotMotion(id, sp.pos, sp.yaw),
      brain:
        o.brain === undefined || o.brain === 'fsm'
          ? createBotBrain(id, profile, patrolNodes)
          : null,
      aim: createBotAim(sp.yaw),
      trigger: createWeaponTrigger(),
      loadout: createLoadout(WEAPON_PROFILES, { infiniteReserve: true }),
      vitals: createVitals('bot'),
      fire: createFireRequest(id),
      hitboxes: createHitboxes(),
      rngPerception: root.fork(`perception/${id}`),
      rngAi: root.fork(`ai:${id}`),
      rngAim: root.fork(`aim/${id}`),
      rngSpread: root.fork(`spread/${id}`),
      input: {
        selfId: id,
        selfEye: eye,
        selfYaw: 0,
        targetPoints: noTargets,
        noises,
        damageTaken: damages,
        tick: 0,
      },
      self: {
        id,
        pos: vec3(),
        yaw: 0,
        health: 100,
        armor: 0,
        mag: 0,
        reserve: 0,
        reloading: false,
        locomotion: 'idle',
      },
      intent: IDLE_INTENT,
      eye,
      stuckRef: vec3(sp.pos.x, sp.pos.y, sp.pos.z),
      stuckRefTick: 0,
      stuckStart: -1,
    };
    bots.push(bot);
  }
  const brains = bots.flatMap((b) => (b.brain === null ? [] : [b.brain]));
  const scripted = typeof o.brain === 'function' ? o.brain : null;

  const neighbours: NeighbourView[] = bots.map((b) => ({
    get id() {
      return b.id;
    },
    get pos() {
      return b.motion.pos;
    },
    get alive() {
      return b.alive;
    },
  }));

  const events: SimEvent[] = [];
  const metrics: HarnessMetrics = {
    shots: bots.map(() => 0),
    hits: bots.map(() => 0),
    reactionViolations: 0,
    firstShotDelay: bots.map(() => -1),
    maxStuckSpan: bots.map(() => 0),
    patrolGoals: bots.map(() => []),
    playerDamage: 0,
    maxLosPerSense: 0,
    maxLosPerDecide: 0,
    maxDecidesPerTick: 0,
    maxSensesPerTick: 0,
    intents: bots.map(() => []),
  };

  let tick = 0;
  const vitalsOf = (id: EntityId): Vitals | undefined =>
    id === PLAYER_ID ? (player.present ? player.vitals : undefined) : bots[id - 1]?.vitals;

  const killBotInternal = (b: Bot): void => {
    if (!b.alive) return;
    b.alive = false;
    b.brain?.onDeath(tick, cover);
    releaseMotion(b.motion, { paths });
    cover.release(b.id);
    b.trigger.fire = false;
  };

  const emit = (e: SimEvent): void => {
    const c = structuredClone(e); // copy scratch events (SD-PC-10)
    if (o.lean !== true) events.push(c);
    if (c.t === 'noise' && c.source === PLAYER_ID && c.kind === 'gunfire') noises.push(c);
    if (c.t === 'damage') {
      if (c.target === PLAYER_ID) metrics.playerDamage += c.amount;
      else {
        damages.push(c);
        scheduler.wake(c.target);
      }
      const shooterIdx = c.source - 1;
      if (c.source !== PLAYER_ID && metrics.hits[shooterIdx] !== undefined)
        metrics.hits[shooterIdx]++;
    }
    if (c.t === 'shot' && c.shooter !== PLAYER_ID) {
      const b = bots[c.shooter - 1];
      if (b !== undefined) {
        metrics.shots[c.shooter - 1] = (metrics.shots[c.shooter - 1] ?? 0) + 1;
        const fs = b.mem.firstSeenTick;
        if (fs === null || c.tick - fs < profile.reactionTicks) metrics.reactionViolations++;
        if ((metrics.firstShotDelay[c.shooter - 1] ?? 0) < 0 && fs !== null) {
          metrics.firstShotDelay[c.shooter - 1] = c.tick - fs;
        }
      }
    }
    if (c.t === 'kill') {
      if (c.victim === PLAYER_ID) player.vitals.alive = false;
      else {
        const b = bots[c.victim - 1];
        if (b !== undefined) killBotInternal(b);
      }
    }
  };

  const pruneWindow = (): void => {
    const keep = tick - 2 * scheduler.senseInterval;
    for (const list of [noises, damages] as (NoiseEvent | DamageEvent)[][]) {
      let w = 0;
      for (const e of list) if (e.tick > keep) list[w++] = e;
      list.length = w;
    }
  };

  const movePlayer = (): void => {
    if (o.player.kind !== 'route' || !player.vitals.alive) return;
    if (o.player.once === true && player.routeIdx >= o.player.points.length) {
      player.vel.x = 0;
      player.vel.z = 0;
      return;
    }
    const target = o.player.points[player.routeIdx % o.player.points.length];
    if (target === undefined) return;
    const dx = target.x - player.pos.x;
    const dz = target.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) {
      player.routeIdx++;
      return;
    }
    player.vel.x = (dx / d) * o.player.speed;
    player.vel.z = (dz / d) * o.player.speed;
    if (!player.grounded) player.vel.y -= 18 * TICK_DT;
    const r = world.moveCapsule(
      player.pos,
      player.vel,
      STANDING,
      TICK_DT,
      MAP_RULES.stepHeight,
      player.move,
    );
    copy(r.position, player.pos);
    copy(r.velocity, player.vel);
    player.grounded = r.grounded;
    player.yaw = Math.atan2(-dx, -dz);
  };

  const playerEye = vec3();
  const playerAim: AimContext = {
    origin: playerEye,
    yaw: 0,
    pitch: 0,
    moving: false,
    grounded: true,
    crouched: false,
  };
  const botAim: AimContext = {
    origin: vec3(),
    yaw: 0,
    pitch: 0,
    moving: false,
    grounded: true,
    crouched: false,
  };
  const playerTargets: ShotTarget[] = bots.map((b) => ({
    id: b.id,
    hitboxes: b.hitboxes,
    damageable: true,
  }));
  const botTargets: ShotTarget[] = [];
  const losA = vec3();

  const playerShoot = (): void => {
    const every = o.player.kind === 'absent' ? undefined : o.player.fireEvery;
    player.trigger.fire = false;
    player.trigger.firePressed = false;
    player.trigger.reload = player.loadout.slots[0].mag === 0;
    if (every === undefined || !player.vitals.alive || tick % every !== 0) {
      player.loadout.slots[0].triggerLatched = false;
    } else {
      playerEye.x = player.pos.x;
      playerEye.y = player.pos.y + (player.crouch ? EYE_CROUCH : EYE_STAND);
      playerEye.z = player.pos.z;
      let best: Bot | null = null;
      let bestD = Infinity;
      const atBots = o.player.kind === 'absent' || o.player.target !== 'air';
      for (const b of atBots ? bots : []) {
        if (!b.alive) continue;
        losA.x = b.motion.pos.x;
        losA.y = b.motion.pos.y + 1.2;
        losA.z = b.motion.pos.z;
        const d = Math.hypot(losA.x - playerEye.x, losA.z - playerEye.z);
        if (d < bestD && prepared.world.lineOfSight(playerEye, losA)) {
          best = b;
          bestD = d;
        }
      }
      if (best === null) {
        // fire into the air so the noise still exists (hearing scenarios)
        playerAim.yaw = player.yaw;
        playerAim.pitch = 1.2;
      } else {
        const dx = best.motion.pos.x - playerEye.x;
        const dy = best.motion.pos.y + 1.2 - playerEye.y;
        const dz = best.motion.pos.z - playerEye.z;
        playerAim.yaw = Math.atan2(-dx, -dz);
        playerAim.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      }
      player.trigger.fire = true;
      player.trigger.firePressed = true;
      player.loadout.slots[0].triggerLatched = false;
    }
    const req = stepWeapon(
      player.loadout,
      player.trigger,
      playerAim,
      tick,
      player.rngSpread,
      emit,
      PLAYER_ID,
      diag,
      player.fire,
    );
    if (req !== null) {
      executeShot(req, WEAPON_PROFILES[0], prepared.world, playerTargets, vitalsOf, emit, diag);
    }
  };

  const updateStuckMetric = (b: Bot, i: number): void => {
    if (tick - b.stuckRefTick < 90) return;
    const m = b.motion;
    const active = m.goal !== null && m.status !== 'arrived' && m.status !== 'idle';
    const progress = Math.hypot(m.pos.x - b.stuckRef.x, m.pos.z - b.stuckRef.z);
    if (active && progress < 0.3) {
      if (b.stuckStart < 0) b.stuckStart = b.stuckRefTick;
      metrics.maxStuckSpan[i] = Math.max(metrics.maxStuckSpan[i] ?? 0, tick - b.stuckStart);
    } else {
      b.stuckStart = -1;
    }
    copy(m.pos, b.stuckRef);
    b.stuckRefTick = tick;
  };

  const brainCtx: BrainContext = {
    tick: 0,
    rng: root,
    graph,
    cover,
    world,
    scratch,
    diag,
  };
  const locoCtx: LocoContext = {
    tick: 0,
    dt: TICK_DT,
    world,
    paths,
    graph,
    neighbours,
    standing: STANDING,
    crouched: CROUCHED,
    stepHeight: MAP_RULES.stepHeight,
    diag,
  };
  const aimCtx: BotAimContext = {
    tick: 0,
    dt: TICK_DT,
    eye: vec3(),
    vel: vec3(),
    mag: 0,
    reloading: false,
    profile,
    rng: root,
    diag,
  };

  const stepOnce = (): void => {
    tick++;
    pruneWindow();
    movePlayer();
    const targets =
      player.present && player.vitals.alive
        ? targetPointsFor(player.pos, player.crouch, targetPts)
        : noTargets;

    // stage 4: sense
    profiler.begin('ai-sense');
    let senses = 0;
    for (const b of bots) {
      if (!b.alive || !scheduler.shouldSense(b.id, tick)) continue;
      senses++;
      const m = b.motion;
      b.eye.x = m.pos.x;
      b.eye.y = m.pos.y + (m.crouched ? EYE_CROUCH : EYE_STAND);
      b.eye.z = m.pos.z;
      b.input.selfYaw = b.aim.yaw;
      b.input.targetPoints = targets;
      b.input.tick = tick;
      const before = counts.lineOfSight;
      sense(b.mem, b.input, world, profile.perception, b.rngPerception, diag);
      metrics.maxLosPerSense = Math.max(metrics.maxLosPerSense, counts.lineOfSight - before);
    }
    metrics.maxSensesPerTick = Math.max(metrics.maxSensesPerTick, senses);
    profiler.end('ai-sense');

    // stage 5: decide
    profiler.begin('ai-decide');
    let decides = 0;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (b === undefined || !b.alive || !scheduler.shouldDecide(b.id, tick)) continue;
      decides++;
      const s = b.self;
      copy(b.motion.pos, s.pos);
      s.yaw = b.aim.yaw;
      s.health = b.vitals.health;
      s.armor = b.vitals.armor;
      const w = b.loadout.slots[0];
      s.mag = w.mag;
      s.reserve = w.reserve;
      s.reloading = w.reloadStartTick >= 0;
      s.locomotion = b.motion.status;
      const before = counts.lineOfSight;
      if (b.brain !== null) {
        brainCtx.tick = tick;
        brainCtx.rng = b.rngAi;
        b.intent = b.brain.decide(s, b.mem, brainCtx);
      } else if (scripted !== null) {
        b.intent = scripted(b.id, s, b.mem, tick);
      }
      metrics.maxLosPerDecide = Math.max(metrics.maxLosPerDecide, counts.lineOfSight - before);
      const intent = b.intent;
      setGoal(b.motion, intent.goal, intent.avoid, intent.speed, diag);
      b.motion.crouch = intent.crouch;
      const g = intent.goal;
      if (o.lean === true) continue;
      const key = g === null ? 'null' : `${g.x.toFixed(2)},${g.y.toFixed(2)},${g.z.toFixed(2)}`;
      metrics.intents[i]?.push(`${tick}:${b.brain?.state ?? 'scripted'}:${key}:${intent.fire}`);
      if (b.brain?.state === 'patrol' && g !== null) {
        const list = metrics.patrolGoals[i];
        if (list !== undefined && list[list.length - 1] !== key) list.push(key);
      }
    }
    metrics.maxDecidesPerTick = Math.max(metrics.maxDecidesPerTick, decides);
    profiler.end('ai-decide');

    // stage 6: paths
    profiler.begin('nav');
    paths.tick();
    profiler.end('nav');

    // stage 7: locomotion + aim
    profiler.begin('locomotion');
    locoCtx.tick = tick;
    aimCtx.tick = tick;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (b === undefined || !b.alive) continue;
      stepBotMotion(b.motion, locoCtx);
      if (player.present && player.vitals.alive) {
        world.separate(player.pos, STANDING, b.motion.pos, b.motion.crouched ? CROUCHED : STANDING);
      }
      const m = b.motion;
      aimCtx.eye.x = m.pos.x;
      aimCtx.eye.y = m.pos.y + (m.crouched ? EYE_CROUCH : EYE_STAND);
      aimCtx.eye.z = m.pos.z;
      copy(m.vel, aimCtx.vel);
      const w = b.loadout.slots[0];
      aimCtx.mag = w.mag;
      aimCtx.reloading = w.reloadStartTick >= 0;
      aimCtx.rng = b.rngAim;
      stepBotAim(b.aim, b.intent, b.mem, aimCtx, b.trigger);
      updateStuckMetric(b, i);
    }
    profiler.end('locomotion');

    // hitboxes once per tick
    hitboxesFor(player.pos, player.crouch, player.hitboxes);
    for (const b of bots) hitboxesFor(b.motion.pos, b.motion.crouched, b.hitboxes);

    // stages 8-9: weapons and shots (player first, then bots by id)
    profiler.begin('combat');
    if (player.present) playerShoot();
    for (const b of bots) {
      if (!b.alive) continue;
      const m = b.motion;
      botAim.origin.x = m.pos.x;
      botAim.origin.y = m.pos.y + (m.crouched ? EYE_CROUCH : EYE_STAND);
      botAim.origin.z = m.pos.z;
      botAim.yaw = b.aim.yaw;
      botAim.pitch = b.aim.pitch;
      botAim.moving = Math.hypot(m.vel.x, m.vel.z) > 0.5;
      botAim.grounded = m.grounded;
      botAim.crouched = m.crouched;
      const req = stepWeapon(
        b.loadout,
        b.trigger,
        botAim,
        tick,
        b.rngSpread,
        emit,
        b.id,
        diag,
        b.fire,
      );
      if (req === null) continue;
      botTargets.length = 0;
      if (player.present && player.vitals.alive) {
        botTargets.push({ id: PLAYER_ID, hitboxes: player.hitboxes, damageable: true });
      }
      for (const other of bots) {
        if (other !== b && other.alive) {
          botTargets.push({ id: other.id, hitboxes: other.hitboxes, damageable: false });
        }
      }
      executeShot(req, WEAPON_PROFILES[0], prepared.world, botTargets, vitalsOf, emit, diag);
    }
    profiler.end('combat');
    profiler.endFrame();
  };

  return {
    step(n = 1) {
      for (let i = 0; i < n; i++) stepOnce();
    },
    get tick() {
      return tick;
    },
    bot(id) {
      const b = bots[id - 1];
      if (b === undefined) throw new Error(`no bot ${id}`);
      return {
        pos: b.motion.pos,
        yaw: b.aim.yaw,
        pitch: b.aim.pitch,
        state: b.brain?.state ?? (b.alive ? 'patrol' : 'dead'),
        status: b.motion.status,
        mem: b.mem,
        health: b.vitals.health,
        mag: b.loadout.slots[0].mag,
        alive: b.alive,
        intent: b.intent,
        motion: b.motion,
      };
    },
    get player() {
      return {
        pos: player.pos,
        health: player.vitals.health,
        armor: player.vitals.armor,
        alive: player.vitals.alive,
      };
    },
    killBot(id) {
      const b = bots[id - 1];
      if (b === undefined || !b.alive) return;
      applyDamage(b.vitals, 10_000, ARMOR_MODEL, tick, diag);
      emit({ t: 'kill', tick, victim: b.id, killer: PLAYER_ID, weapon: 'rifle', headshot: false });
    },
    setPlayerPos(p) {
      copy(p, player.pos);
    },
    setBotHealth(id, health) {
      const b = bots[id - 1];
      if (b !== undefined) b.vitals.health = health;
    },
    triggers: bots.map((b) => b.trigger),
    events,
    metrics,
    profiler,
    diag,
    world,
    graph,
    paths,
    cover,
    scheduler,
    counts,
    brains,
    profile,
  };
}
