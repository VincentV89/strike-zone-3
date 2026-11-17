/**
 * EventStore and SenseWindow (BR-GS-43, BR-GS-60..64, SD-GS-04).
 *
 * weapons and combat emit reused scratch events, so every event is copied
 * field by field (each Vec3 too) into a pooled object before the sink
 * returns. Two pool generations alternate on drain: the objects handed out
 * by drain N stay valid until drain N+1, the lifetime the core EventBuffer
 * already promises (BR-F-14). Pools grow to their high-water mark once and
 * are reused, so the steady state allocates nothing.
 */
import {
  DEFAULT_EVENT_CAPACITY,
  PLAYER_ID,
  assertNever,
  copy,
  createEventBuffer,
  vec3,
  type Diagnostics,
} from '../core';
import type { SimEvent } from '../contracts';
import type { DamageEvent, NoiseEvent } from '../ai/perception';
import { SIM_TUNING } from './tuning';

type Ev<K extends SimEvent['t']> = Extract<SimEvent, { t: K }>;

interface Pool<E> {
  readonly items: E[];
  used: number;
  readonly make: () => E;
}

function pool<E>(make: () => E): Pool<E> {
  return { items: [], used: 0, make };
}

function take<E>(p: Pool<E>): E {
  if (p.used < p.items.length) return p.items[p.used++] as E;
  const e = p.make();
  p.items.push(e);
  p.used++;
  return e;
}

const makeShot = (): Ev<'shot'> => ({
  t: 'shot',
  tick: 0,
  shooter: PLAYER_ID,
  weapon: 'rifle',
  origin: vec3(),
  end: vec3(),
  hit: null,
  headshot: false,
});
const makeImpact = (): Ev<'impact'> => ({ t: 'impact', tick: 0, point: vec3(), normal: vec3() });
const makeDamage = (): Ev<'damage'> => ({
  t: 'damage',
  tick: 0,
  target: PLAYER_ID,
  source: PLAYER_ID,
  amount: 0,
  armorLoss: 0,
  fromDir: vec3(),
  headshot: false,
});
const makeKill = (): Ev<'kill'> => ({
  t: 'kill',
  tick: 0,
  victim: PLAYER_ID,
  killer: PLAYER_ID,
  weapon: 'rifle',
  headshot: false,
});
const makeNoise = (): Ev<'noise'> => ({
  t: 'noise',
  tick: 0,
  source: PLAYER_ID,
  kind: 'gunfire',
  pos: vec3(),
  radius: 0,
});
const makeWeapon = (): Ev<'weapon'> => ({
  t: 'weapon',
  tick: 0,
  actor: PLAYER_ID,
  kind: 'switch',
});
const makePhase = (): Ev<'phase'> => ({ t: 'phase', tick: 0, phase: 'countdown', outcome: null });

interface Generation {
  readonly shot: Pool<Ev<'shot'>>;
  readonly impact: Pool<Ev<'impact'>>;
  readonly damage: Pool<Ev<'damage'>>;
  readonly kill: Pool<Ev<'kill'>>;
  readonly noise: Pool<Ev<'noise'>>;
  readonly weapon: Pool<Ev<'weapon'>>;
  readonly phase: Pool<Ev<'phase'>>;
}

function generation(): Generation {
  return {
    shot: pool(makeShot),
    impact: pool(makeImpact),
    damage: pool(makeDamage),
    kill: pool(makeKill),
    noise: pool(makeNoise),
    weapon: pool(makeWeapon),
    phase: pool(makePhase),
  };
}

function resetGeneration(g: Generation): void {
  g.shot.used = 0;
  g.impact.used = 0;
  g.damage.used = 0;
  g.kill.used = 0;
  g.noise.used = 0;
  g.weapon.used = 0;
  g.phase.used = 0;
}

export function copyNoise(e: NoiseEvent, out: NoiseEvent): NoiseEvent {
  out.tick = e.tick;
  out.source = e.source;
  out.kind = e.kind;
  copy(e.pos, out.pos);
  out.radius = e.radius;
  return out;
}

export function copyDamage(e: DamageEvent, out: DamageEvent): DamageEvent {
  out.tick = e.tick;
  out.target = e.target;
  out.source = e.source;
  out.amount = e.amount;
  out.armorLoss = e.armorLoss;
  copy(e.fromDir, out.fromDir);
  out.headshot = e.headshot;
  return out;
}

/** A pooled, field-by-field copy of `e` from generation `g`. */
function copyInto(g: Generation, e: SimEvent): SimEvent {
  switch (e.t) {
    case 'shot': {
      const o = take(g.shot);
      o.tick = e.tick;
      o.shooter = e.shooter;
      o.weapon = e.weapon;
      copy(e.origin, o.origin);
      copy(e.end, o.end);
      o.hit = e.hit;
      o.headshot = e.headshot;
      return o;
    }
    case 'impact': {
      const o = take(g.impact);
      o.tick = e.tick;
      copy(e.point, o.point);
      copy(e.normal, o.normal);
      return o;
    }
    case 'damage':
      return copyDamage(e, take(g.damage));
    case 'kill': {
      const o = take(g.kill);
      o.tick = e.tick;
      o.victim = e.victim;
      o.killer = e.killer;
      o.weapon = e.weapon;
      o.headshot = e.headshot;
      return o;
    }
    case 'noise':
      return copyNoise(e, take(g.noise));
    case 'weapon': {
      const o = take(g.weapon);
      o.tick = e.tick;
      o.actor = e.actor;
      o.kind = e.kind;
      return o;
    }
    case 'phase': {
      const o = take(g.phase);
      o.tick = e.tick;
      o.phase = e.phase;
      o.outcome = e.outcome;
      return o;
    }
    default:
      return assertNever(e);
  }
}

export interface EventStore {
  /** Copies `e` before returning (never stores it). Bound once; safe to pass as a sink. */
  readonly emit: (e: SimEvent) => void;
  /** Sim-owned copies in push order, valid until the next drain(). */
  drain(): readonly SimEvent[];
  /** Copies made since the last drain. */
  readonly pending: number;
}

export function createEventStore(
  diag: Diagnostics,
  capacity: number = DEFAULT_EVENT_CAPACITY,
): EventStore {
  const buffer = createEventBuffer<SimEvent>(capacity, diag);
  const a = generation();
  const b = generation();
  let current = a;
  let copies = 0;
  const emit = (e: SimEvent): void => {
    if (copies >= capacity) {
      // Full: the buffer drops it and counts core/event-buffer-dropped. It is never stored.
      buffer.push(e);
      return;
    }
    copies++;
    buffer.push(copyInto(current, e));
  };
  return {
    emit,
    drain() {
      const out = buffer.drain();
      current = current === a ? b : a;
      resetGeneration(current);
      copies = 0;
      return out;
    },
    get pending() {
      return copies;
    },
  };
}

/**
 * Perception's event window: copies of player gunfire noises and of damage
 * events whose target is a bot (BR-GS-43). Footsteps never enter it.
 */
export interface SenseWindow {
  readonly noises: readonly NoiseEvent[];
  readonly damages: readonly DamageEvent[];
  addNoise(e: NoiseEvent): void;
  addDamage(e: DamageEvent): void;
  /** Keeps entries with tick > minTick. */
  prune(minTick: number): void;
}

function windowList<E extends { tick: number }>(
  make: () => E,
  copyFn: (e: E, out: E) => E,
  cap: number,
): { list: E[]; add(e: E): void; prune(minTick: number): void } {
  const list: E[] = [];
  const free: E[] = [];
  return {
    list,
    add(e) {
      if (list.length >= cap) {
        const old = list.shift();
        if (old !== undefined) free.push(old);
      }
      list.push(copyFn(e, free.pop() ?? make()));
    },
    prune(minTick) {
      let w = 0;
      for (let r = 0; r < list.length; r++) {
        const e = list[r] as E;
        if (e.tick > minTick) list[w++] = e;
        else free.push(e);
      }
      list.length = w;
    },
  };
}

export function createSenseWindow(cap: number = SIM_TUNING.senseWindowCapacity): SenseWindow {
  const noises = windowList(makeNoise, copyNoise, cap);
  const damages = windowList(makeDamage, copyDamage, cap);
  return {
    noises: noises.list,
    damages: damages.list,
    addNoise: (e) => {
      noises.add(e);
    },
    addDamage: (e) => {
      damages.add(e);
    },
    prune(minTick) {
      noises.prune(minTick);
      damages.prune(minTick);
    },
  };
}
