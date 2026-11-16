/**
 * Snapshot buffers and the stage-12 writer (BR-GS-75..77, BR-GS-91,
 * SD-GS-04). Buffers are built once per round and only ever written; no
 * stage reads them back, so an adapter that writes into a snapshot cannot
 * change the simulation. A non-finite source value keeps the previous
 * value and reports `sim/bad-state` once, without a detail object.
 */
import { vec3, type Diagnostics, type EntityId, type Vec3 } from '../core';
import type {
  BotView,
  LoadoutView,
  PlayerView,
  RadarContact,
  RoundOutcome,
  RoundPhase,
  SimSnapshot,
} from '../contracts';
import type { BotAimState } from '../ai/brain';
import type { BotMotionState } from '../ai/locomotion';
import type { Vitals } from '../combat';
import type { PlayerState } from './player';
import { createLoadoutView, toLoadoutView, viewKick, type Loadout } from '../weapons';
import { SIM_TUNING } from './tuning';

type MutablePlayerView = Omit<PlayerView, 'loadout' | 'viewKick'> & {
  loadout: LoadoutView;
  viewKick: { pitch: number; yaw: number };
};

export interface SnapshotBuffer {
  readonly snap: SimSnapshot;
  readonly player: MutablePlayerView;
  readonly bots: BotView[];
  readonly radarPool: readonly RadarContact[];
  readonly radar: RadarContact[];
}

export interface PlayerSource {
  readonly state: PlayerState;
  readonly vitals: Vitals;
  readonly loadout: Loadout;
  readonly lastFireTick: number;
}

export interface BotSource {
  readonly id: EntityId;
  readonly alive: boolean;
  readonly deathTick: number | null;
  readonly motion: BotMotionState;
  readonly aim: BotAimState;
  readonly lastFireTick: number;
}

export interface RoundSource {
  readonly tick: number;
  readonly phase: RoundPhase;
  readonly countdownLeftTicks: number;
  /** Ticks left in live; before live this is durationSec * 60. */
  readonly remainingTicks: number;
  readonly outcome: RoundOutcome | null;
  readonly botsAlive: number;
}

export function createSnapshotBuffer(botIds: readonly EntityId[]): SnapshotBuffer {
  const player: MutablePlayerView = {
    pos: vec3(),
    vel: vec3(),
    yaw: 0,
    pitch: 0,
    eyeHeight: 0,
    stance: 'stand',
    grounded: true,
    health: 0,
    armor: 0,
    alive: true,
    loadout: createLoadoutView(),
    viewKick: { pitch: 0, yaw: 0 },
    lastFireTick: -1,
  };
  const bots: BotView[] = botIds.map((id) => ({
    id,
    pos: vec3(),
    yaw: 0,
    pitch: 0,
    alive: true,
    deathTick: null,
    crouch: false,
    moving: false,
    lastFireTick: -1,
    weapon: 'rifle',
  }));
  const radarPool: RadarContact[] = [];
  for (let i = 0; i < SIM_TUNING.maxRadarContacts; i++) {
    radarPool.push({ id: 0 as EntityId, pos: vec3(), kind: 'seen', ageTicks: 0 });
  }
  const radar: RadarContact[] = [];
  const snap: SimSnapshot = {
    tick: 0,
    phase: 'countdown',
    countdownLeftSec: 0,
    timeLeftSec: 0,
    outcome: null,
    player,
    bots,
    botsAlive: botIds.length,
    radar,
  };
  return { snap, player, bots, radarPool, radar };
}

/** Writes finite values only; keeps the previous value otherwise (BR-GS-91). */
function num(v: number, prev: number, diag: Diagnostics): number {
  if (Number.isFinite(v)) return v;
  diag.warnOnce('sim/bad-state');
  return prev;
}

function vec(src: Readonly<Vec3>, out: Vec3, diag: Diagnostics): void {
  out.x = num(src.x, out.x, diag);
  out.y = num(src.y, out.y, diag);
  out.z = num(src.z, out.z, diag);
}

export function writePlayerView(
  p: PlayerSource,
  tick: number,
  out: MutablePlayerView,
  diag: Diagnostics,
): void {
  const s = p.state;
  vec(s.pos, out.pos, diag);
  vec(s.vel, out.vel, diag);
  out.yaw = num(s.yaw, out.yaw, diag);
  out.pitch = num(s.pitch, out.pitch, diag);
  out.eyeHeight = num(s.eyeHeight, out.eyeHeight, diag);
  out.stance = s.stance;
  out.grounded = s.grounded;
  out.health = num(p.vitals.health, out.health, diag);
  out.armor = num(p.vitals.armor, out.armor, diag);
  out.alive = p.vitals.alive;
  toLoadoutView(p.loadout, tick, out.loadout);
  viewKick(p.loadout, out.viewKick);
  out.viewKick.pitch = num(out.viewKick.pitch, 0, diag);
  out.viewKick.yaw = num(out.viewKick.yaw, 0, diag);
  out.lastFireTick = p.lastFireTick;
}

export function writeBotView(b: BotSource, out: BotView, diag: Diagnostics): void {
  const m = b.motion;
  vec(m.pos, out.pos, diag);
  out.yaw = num(b.aim.yaw, out.yaw, diag);
  out.pitch = num(b.aim.pitch, out.pitch, diag);
  out.alive = b.alive;
  out.deathTick = b.deathTick;
  out.crouch = m.crouched;
  out.moving = b.alive && Math.hypot(m.vel.x, m.vel.z) > SIM_TUNING.movingSpeed;
  out.lastFireTick = b.lastFireTick;
  out.weapon = 'rifle';
}

export function writeRound(r: RoundSource, snap: SimSnapshot): void {
  snap.tick = r.tick;
  snap.phase = r.phase;
  snap.countdownLeftSec = r.countdownLeftTicks / 60;
  snap.timeLeftSec = r.remainingTicks / 60;
  snap.outcome = r.outcome;
  snap.botsAlive = r.botsAlive;
}
