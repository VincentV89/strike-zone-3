/**
 * createSimulation and the 12-stage step pipeline (business-logic-model-
 * game-simulation §5-§6, BR-GS-01..51, BR-GS-94).
 *
 * All per-round state lives in this closure (BR-GS-02). The tick path never
 * throws and allocates nothing after warm-up. `senseDue` is the only function
 * that reads the live player position for bot-ai (ADR-005, SD-GS-01);
 * tests/arch/sim-firewall.test.ts checks this by function name.
 */
import {
  PLAYER_ID,
  TICK_DT,
  copy,
  createRng,
  err,
  ok,
  vec3,
  type Diagnostics,
  type EntityId,
  type Profiler,
  type Result,
  type Rng,
  type Vec3,
} from '../core';
import type { BotIntent, InputCommand, RoundConfig, RoundOutcome, SimEvent } from '../contracts';
import {
  collectPatrolNodes,
  createAiScheduler,
  createBotAim,
  createBotBrain,
  createBrainScratch,
  createCoverRegistry,
  getDifficultyProfile,
  stepBotAim,
  type BotAimContext,
  type BotAimState,
  type BotBrain,
  type BotSelf,
  type BrainContext,
} from '../ai/brain';
import {
  createBotMotion,
  releaseMotion,
  setGoal,
  stepBotMotion,
  type BotMotionState,
  type LocoContext,
} from '../ai/locomotion';
import {
  createPerceptionMemory,
  sense,
  targetPointsFor,
  type PerceptionMemory,
  type SenseInput,
} from '../ai/perception';
import { createHitboxes, createVitals, hitboxesFor, type Hitboxes, type Vitals } from '../combat';
import { MAP_RULES } from '../maps';
import { createPathService } from '../nav';
import type { Capsule } from '../physics';
import {
  PLAYER_TUNING,
  createPlayerState,
  createPlayerStepResult,
  eyePosition,
  stepPlayer,
  type PlayerState,
  type PlayerStepResult,
} from './player';
import {
  WEAPON_PROFILES,
  createFireRequest,
  createLoadout,
  createWeaponTrigger,
  stepWeapon,
  triggerFromInput,
  type AimContext,
  type FireRequest,
  type Loadout,
  type WeaponTrigger,
} from '../weapons';
import { createAwareness } from './awareness';
import { createCommand, readCommand } from './command';
import { assertRoundConfig } from './config';
import { createEventStore, createSenseWindow } from './events';
import { createShotQueue, createShotResolver, enqueueShot, roundOutcome } from './shots';
import {
  createSnapshotBuffer,
  writeBotView,
  writePlayerView,
  writeRound,
  type SnapshotBuffer,
} from './snapshot';
import { allocateSpawns } from './spawn';
import { SIM_TUNING } from './tuning';
import type { PreparedMap, Simulation, SimulationDeps } from './types';
import { CROUCHED, STANDING } from './validate';

const EMPTY_POINTS: readonly Vec3[] = Object.freeze([]);

const IDLE_INTENT: Readonly<BotIntent> = Object.freeze({
  goal: null,
  avoid: null,
  speed: 'walk',
  aimAt: null,
  fire: false,
  reload: false,
  crouch: false,
});

interface PlayerAgent {
  readonly id: EntityId;
  readonly state: PlayerState;
  readonly step: PlayerStepResult;
  readonly vitals: Vitals;
  readonly loadout: Loadout;
  readonly trigger: WeaponTrigger;
  readonly fire: FireRequest;
  readonly hitboxes: Hitboxes;
  readonly rngSpread: Rng;
  readonly aim: AimContext;
  lastFireTick: number;
}

interface BotAgent {
  readonly id: EntityId;
  alive: boolean;
  deathTick: number | null;
  readonly mem: PerceptionMemory;
  readonly motion: BotMotionState;
  /** Live feet position (motion.pos); NeighbourView and awareness read it. */
  readonly pos: Vec3;
  readonly brain: BotBrain;
  readonly aim: BotAimState;
  readonly self: BotSelf;
  intent: Readonly<BotIntent>;
  readonly vitals: Vitals;
  readonly loadout: Loadout;
  readonly trigger: WeaponTrigger;
  readonly fire: FireRequest;
  readonly hitboxes: Hitboxes;
  readonly weaponAim: AimContext;
  readonly eye: Vec3;
  readonly rngPerception: Rng;
  readonly rngAi: Rng;
  readonly rngAim: Rng;
  readonly rngSpread: Rng;
  strideAccum: number;
  lastFireTick: number;
}

function createAim(): AimContext {
  return { origin: vec3(), yaw: 0, pitch: 0, moving: false, grounded: true, crouched: false };
}

/** The one SenseInput of a round (SD-GS-01); only senseDue writes targetPoints. */
function createSenseInput(
  noises: SenseInput['noises'],
  damages: SenseInput['damageTaken'],
): SenseInput {
  const input: SenseInput = {
    selfId: PLAYER_ID,
    selfEye: vec3(),
    selfYaw: 0,
    targetPoints: EMPTY_POINTS,
    noises,
    damageTaken: damages,
    tick: 0,
  };
  return input;
}

function eyeOf(m: BotMotionState, out: Vec3): Vec3 {
  out.x = m.pos.x;
  out.y = m.pos.y + (m.crouched ? PLAYER_TUNING.crouchEye : PLAYER_TUNING.standEye);
  out.z = m.pos.z;
  return out;
}

/** Stage 5 fill: the bot's own facts only (no player data, SD-GS-01). */
function fillBotSelf(b: BotAgent): BotSelf {
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
  return s;
}

/** Stage 7 fill: the bot's own eye, velocity and magazine only (SD-GS-01). */
function fillAimContext(b: BotAgent, ctx: BotAimContext): BotAimContext {
  eyeOf(b.motion, ctx.eye);
  copy(b.motion.vel, ctx.vel);
  const w = b.loadout.slots[0];
  ctx.mag = w.mag;
  ctx.reloading = w.reloadStartTick >= 0;
  ctx.rng = b.rngAim;
  return ctx;
}

/** Stage 7: the shared LocoContext carries no player field (SD-GS-01). */
function fillLocoContext(ctx: LocoContext, tick: number): LocoContext {
  ctx.tick = tick;
  return ctx;
}

/**
 * Validates the config (throws on programmer errors), allocates spawns and
 * builds every per-round object. Returns SPAWN_ALLOCATION_FAILED as a value.
 */
export function createSimulation(
  cfg: RoundConfig,
  map: PreparedMap,
  deps: SimulationDeps,
): Result<Simulation, 'SPAWN_ALLOCATION_FAILED'> {
  assertRoundConfig(cfg, map, deps);
  const diag: Diagnostics = deps.diag;
  const profiler: Profiler = deps.profiler;
  const { def, world, nav } = map;
  const N = cfg.bots;
  const root = createRng(cfg.seed);
  const plan = allocateSpawns(map, cfg.bots, root.fork('spawn'));
  if (!plan.ok) return err(plan.error);

  // ---- player
  const ps = def.spawns[plan.value.player];
  if (ps === undefined) return err('SPAWN_ALLOCATION_FAILED');
  const player: PlayerAgent = {
    id: PLAYER_ID,
    state: createPlayerState(ps.pos, ps.yaw),
    step: createPlayerStepResult(),
    vitals: createVitals('player'),
    loadout: createLoadout(WEAPON_PROFILES),
    trigger: createWeaponTrigger(),
    fire: createFireRequest(PLAYER_ID),
    hitboxes: createHitboxes(),
    rngSpread: root.fork(`spread/${PLAYER_ID}`),
    aim: createAim(),
    lastFireTick: -1,
  };

  // ---- round services
  const profile = getDifficultyProfile(cfg.difficulty);
  const paths = createPathService(nav, world);
  const cover = createCoverRegistry(def.cover);
  const scheduler = createAiScheduler(N, {
    ...(deps.ai?.senseHz === undefined ? {} : { senseHz: deps.ai.senseHz }),
    ...(deps.ai?.decideHz === undefined ? {} : { decideHz: deps.ai.decideHz }),
  });
  const scratch = createBrainScratch(nav.nodes.length);
  const patrolNodes = collectPatrolNodes(nav, diag);

  // ---- bots (ids 1..N in spawn-shuffle order)
  const bots: BotAgent[] = [];
  for (let i = 0; i < N; i++) {
    const id = (i + 1) as EntityId;
    const sp = def.spawns[plan.value.bots[i] ?? -1];
    if (sp === undefined) return err('SPAWN_ALLOCATION_FAILED');
    const motion = createBotMotion(id, sp.pos, sp.yaw);
    bots.push({
      id,
      alive: true,
      deathTick: null,
      mem: createPerceptionMemory(),
      motion,
      pos: motion.pos,
      brain: createBotBrain(id, profile, patrolNodes),
      aim: createBotAim(sp.yaw),
      self: {
        id,
        pos: vec3(),
        yaw: 0,
        health: 0,
        armor: 0,
        mag: 0,
        reserve: 0,
        reloading: false,
        locomotion: 'idle',
      },
      intent: IDLE_INTENT,
      vitals: createVitals('bot'),
      loadout: createLoadout(WEAPON_PROFILES, { infiniteReserve: true }),
      trigger: createWeaponTrigger(),
      fire: createFireRequest(id),
      hitboxes: createHitboxes(),
      weaponAim: createAim(),
      eye: vec3(),
      rngPerception: root.fork(`perception/${id}`),
      rngAi: root.fork(`ai:${id}`),
      rngAim: root.fork(`aim/${id}`),
      rngSpread: root.fork(`spread/${id}`),
      strideAccum: 0,
      lastFireTick: -1,
    });
  }

  const brainCtx: BrainContext = { tick: 0, rng: root, graph: nav, cover, world, scratch, diag };
  const locoCtx: LocoContext = {
    tick: 0,
    dt: TICK_DT,
    world,
    paths,
    graph: nav,
    neighbours: bots,
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

  // ---- events, perception window, awareness, shots
  const store = createEventStore(diag);
  const senseWindow = createSenseWindow();
  const senseWindowTicks = SIM_TUNING.senseWindowIntervals * scheduler.senseInterval;
  const senseInput = createSenseInput(senseWindow.noises, senseWindow.damages);
  const scratchPts: Vec3[] = [vec3(), vec3(), vec3()];
  const awareness = createAwareness(world, N);
  const actors = [player, ...bots];

  // ---- round clock
  let tick = 0;
  let phase: 'countdown' | 'live' | 'ended' = 'countdown';
  let countdownLeftTicks: number = SIM_TUNING.countdownTicks;
  let remainingTicks = cfg.durationSec * 60;
  let outcome: RoundOutcome | null = null;
  let botsAlive: number = N;
  let sensitivity = 1;

  const lastFire = (id: EntityId, t: number): void => {
    const a = actors[id];
    if (a !== undefined) a.lastFireTick = t;
  };

  /** The simulation's emit sink: copy first, then side effects from the (scratch) event. */
  const sink = (e: SimEvent): void => {
    store.emit(e);
    if (e.t === 'shot') {
      lastFire(e.shooter, e.tick);
    } else if (e.t === 'noise') {
      if (e.kind !== 'gunfire') return;
      if (e.source === PLAYER_ID) senseWindow.addNoise(e);
      else awareness.markHeard(e.source, e.pos, tick, player.state.pos);
    } else if (e.t === 'damage' && e.target !== PLAYER_ID) {
      senseWindow.addDamage(e);
      scheduler.wake(e.target);
    }
  };
  const resolver = createShotResolver(actors, world, sink, diag);
  const queue = createShotQueue(actors.length);

  // Scratch events the simulation emits itself (copied by the store).
  const noiseEv: Extract<SimEvent, { t: 'noise' }> = {
    t: 'noise',
    tick: 0,
    source: PLAYER_ID,
    kind: 'footstep',
    pos: vec3(),
    radius: 0,
  };
  const phaseEv: Extract<SimEvent, { t: 'phase' }> = {
    t: 'phase',
    tick: 0,
    phase: 'live',
    outcome: null,
  };
  const emitNoise = (
    source: EntityId,
    kind: 'footstep' | 'land',
    pos: Readonly<Vec3>,
    radius: number,
  ): void => {
    noiseEv.tick = tick;
    noiseEv.source = source;
    noiseEv.kind = kind;
    copy(pos, noiseEv.pos);
    noiseEv.radius = radius;
    sink(noiseEv);
  };

  // ---- snapshots
  const botIds = bots.map((b) => b.id);
  const bufA = createSnapshotBuffer(botIds);
  const bufB = createSnapshotBuffer(botIds);
  let current: SnapshotBuffer = bufA;
  let previous: SnapshotBuffer = bufB;

  const cmd: InputCommand = createCommand();
  const scopedOpts = { scoped: false };
  const playerEye = vec3();

  const writeSnapshot = (): void => {
    const buf = current;
    writeRound({ tick, phase, countdownLeftTicks, remainingTicks, outcome, botsAlive }, buf.snap);
    writePlayerView(player, tick, buf.player, diag);
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i] as BotAgent;
      const v = buf.bots[i];
      if (v !== undefined) writeBotView(b, v, diag);
    }
    awareness.publish(tick, bots, buf.radarPool, buf.radar);
  };

  const swap = (): void => {
    const t = current;
    current = previous;
    previous = t;
  };

  // Stage 2
  const stepPlayerStage = (): void => {
    profiler.begin('player');
    if (player.vitals.alive) {
      scopedOpts.scoped = player.loadout.scoped;
      const s = player.state;
      stepPlayer(s, cmd, world, PLAYER_TUNING, sensitivity, phase, scopedOpts, diag, player.step);
      const fs = player.step.footstep;
      if (fs !== null) {
        const r =
          fs === 'crouch'
            ? SIM_TUNING.footstepRadiusCrouch
            : fs === 'sprint'
              ? SIM_TUNING.footstepRadiusRun
              : SIM_TUNING.footstepRadiusWalk;
        emitNoise(PLAYER_ID, 'footstep', s.pos, r);
      }
      if (player.step.landed) emitNoise(PLAYER_ID, 'land', s.pos, SIM_TUNING.landRadius);
    }
    profiler.end('player');
  };

  // Stage 4: the only reader of the live player position for bot-ai (ADR-005).
  function senseDue(): void {
    profiler.begin('ai-sense');
    const s = player.state;
    const pts = player.vitals.alive
      ? targetPointsFor(s.pos, s.stance === 'crouch', scratchPts)
      : EMPTY_POINTS;
    for (const b of bots) {
      if (!b.alive || !scheduler.shouldSense(b.id, tick)) continue;
      senseInput.selfId = b.id;
      eyeOf(b.motion, senseInput.selfEye);
      senseInput.selfYaw = b.aim.yaw;
      senseInput.targetPoints = pts;
      senseInput.tick = tick;
      sense(b.mem, senseInput, world, profile.perception, b.rngPerception, diag);
    }
    senseInput.targetPoints = EMPTY_POINTS;
    profiler.end('ai-sense');
  }

  // Stage 5
  const decideDue = (): void => {
    profiler.begin('ai-decide');
    brainCtx.tick = tick;
    for (const b of bots) {
      if (!b.alive || !scheduler.shouldDecide(b.id, tick)) continue;
      brainCtx.rng = b.rngAi;
      const intent = b.brain.decide(fillBotSelf(b), b.mem, brainCtx);
      b.intent = intent;
      setGoal(b.motion, intent.goal, intent.avoid, intent.speed, diag);
      b.motion.crouch = intent.crouch;
    }
    profiler.end('ai-decide');
  };

  // Stage 7
  const moveBots = (): void => {
    profiler.begin('locomotion');
    fillLocoContext(locoCtx, tick);
    aimCtx.tick = tick;
    const s = player.state;
    const playerCapsule: Capsule = s.stance === 'crouch' ? CROUCHED : STANDING;
    for (const b of bots) {
      if (!b.alive) continue;
      const m = b.motion;
      const px = m.pos.x;
      const pz = m.pos.z;
      stepBotMotion(m, locoCtx);
      const moved = Math.hypot(m.pos.x - px, m.pos.z - pz);
      if (player.vitals.alive) {
        world.separate(s.pos, playerCapsule, m.pos, m.crouched ? CROUCHED : STANDING);
      }
      if (m.grounded && Number.isFinite(moved)) {
        b.strideAccum += moved;
        const stride = m.speed === 'run' ? SIM_TUNING.strideRun : SIM_TUNING.strideWalk;
        if (b.strideAccum >= stride) {
          b.strideAccum = Math.min(b.strideAccum - stride, stride);
          const r = m.crouched
            ? SIM_TUNING.footstepRadiusCrouch
            : m.speed === 'run'
              ? SIM_TUNING.footstepRadiusRun
              : SIM_TUNING.footstepRadiusWalk;
          emitNoise(b.id, 'footstep', m.pos, r);
        }
      }
      stepBotAim(b.aim, b.intent, b.mem, fillAimContext(b, aimCtx), b.trigger);
    }
    profiler.end('locomotion');
    // Hitboxes once per tick, after movement and before weapons (BR-GS-46).
    if (player.vitals.alive) hitboxesFor(s.pos, s.stance === 'crouch', player.hitboxes);
    for (const b of bots) {
      if (b.alive) hitboxesFor(b.motion.pos, b.motion.crouched, b.hitboxes);
    }
  };

  // Stage 8
  const queueWeapons = (): void => {
    if (player.vitals.alive) {
      const s = player.state;
      triggerFromInput(cmd, player.trigger);
      const a = player.aim;
      eyePosition(s, a.origin);
      a.yaw = s.yaw;
      a.pitch = s.pitch;
      a.moving = Math.hypot(s.vel.x, s.vel.z) > SIM_TUNING.movingSpeed;
      a.grounded = s.grounded;
      a.crouched = s.stance === 'crouch';
      const req = stepWeapon(
        player.loadout,
        player.trigger,
        a,
        tick,
        player.rngSpread,
        sink,
        PLAYER_ID,
        diag,
        player.fire,
      );
      if (req !== null) enqueueShot(queue, req);
    }
    for (const b of bots) {
      if (!b.alive) continue;
      const m = b.motion;
      const a = b.weaponAim;
      eyeOf(m, a.origin);
      a.yaw = b.aim.yaw;
      a.pitch = b.aim.pitch;
      a.moving = Math.hypot(m.vel.x, m.vel.z) > SIM_TUNING.movingSpeed;
      a.grounded = m.grounded;
      a.crouched = m.crouched;
      const req = stepWeapon(b.loadout, b.trigger, a, tick, b.rngSpread, sink, b.id, diag, b.fire);
      if (req !== null) enqueueShot(queue, req);
    }
  };

  // Stage 10
  const applyDeaths = (): void => {
    for (const b of bots) {
      if (!b.alive || b.vitals.alive) continue;
      b.alive = false;
      b.deathTick = tick;
      b.brain.onDeath(tick, cover);
      releaseMotion(b.motion, { paths });
      cover.release(b.id);
      b.trigger.fire = false;
      awareness.clear(b.id);
      botsAlive -= 1;
    }
  };

  const emitPhase = (p: 'live' | 'ended', o: RoundOutcome | null): void => {
    phaseEv.tick = tick;
    phaseEv.phase = p;
    phaseEv.outcome = o;
    sink(phaseEv);
  };

  // Stage 11
  const roundChecks = (): void => {
    if (phase === 'countdown') {
      countdownLeftTicks -= 1;
      if (countdownLeftTicks <= 0) {
        countdownLeftTicks = 0;
        phase = 'live';
        remainingTicks = cfg.durationSec * 60;
        emitPhase('live', null);
      }
    } else if (phase === 'live') {
      remainingTicks = Math.max(0, remainingTicks - 1);
      const o = roundOutcome(botsAlive, remainingTicks, player.vitals.alive);
      if (o !== null) {
        phase = 'ended';
        outcome = o;
        emitPhase('ended', o);
      }
    }
  };

  // Creation state in both buffers (tick 0, countdown).
  writeSnapshot();
  swap();
  writeSnapshot();

  const sim: Simulation = {
    step(input) {
      profiler.begin('sim');
      if (phase === 'ended') {
        diag.warnOnce('sim/step-after-end');
        swap();
        writeSnapshot();
        profiler.end('sim');
        return;
      }
      swap(); // 1
      tick += 1;
      readCommand(input, cmd);
      if (phase === 'live') senseWindow.prune(tick - senseWindowTicks);
      stepPlayerStage(); // 2
      if (phase === 'live') {
        if (player.vitals.alive && tick % SIM_TUNING.awarenessInterval === 0) {
          awareness.update(tick, eyePosition(player.state, playerEye), player.state.yaw, bots); // 3
        }
        senseDue(); // 4
        decideDue(); // 5
        profiler.begin('nav');
        paths.tick(); // 6
        profiler.end('nav');
        moveBots(); // 7
        profiler.begin('combat');
        queueWeapons(); // 8
        resolver.resolve(queue); // 9
        applyDeaths(); // 10
        profiler.end('combat');
      }
      roundChecks(); // 11
      writeSnapshot(); // 12
      profiler.end('sim');
    },
    snapshot: () => current.snap,
    previousSnapshot: () => previous.snap,
    drainEvents: () => store.drain(),
    setSensitivity(v) {
      sensitivity = v;
    },
  };
  return ok(sim);
}
