/**
 * Stage 9 shot resolution and the stage-11 outcome rule as fixtures
 * (BR-GS-32, BR-GS-33, BR-GS-48, BR-GS-49, FD-GS-Q1 = A).
 */
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, normalize, sub, vec3, type EntityId, type Vec3 } from '../../src/core';
import type { SimEvent } from '../../src/contracts';
import { createHitboxes, createVitals, hitboxesFor } from '../../src/combat';
import { buildCollisionWorld } from '../../src/physics';
import {
  WEAPON_PROFILES,
  createFireRequest,
  createLoadout,
  type SlotIndex,
} from '../../src/weapons';
import {
  createShotQueue,
  createShotResolver,
  enqueueShot,
  roundOutcome,
  type ShotActor,
} from '../../src/sim/shots';
import { fixtureMap } from '../physics/fixtures';
import { strictDiag } from './helpers';

function actor(id: number, feet: Vec3): ShotActor & { feet: Vec3 } {
  const hitboxes = createHitboxes();
  hitboxesFor(feet, false, hitboxes);
  return {
    id: id as EntityId,
    vitals: createVitals(id === 0 ? 'player' : 'bot'),
    loadout: createLoadout(WEAPON_PROFILES, id === 0 ? {} : { infiniteReserve: true }),
    hitboxes,
    feet,
  };
}

function aimAt(shooter: number, from: Vec3, to: Vec3, slot: SlotIndex) {
  const r = createFireRequest(shooter as EntityId);
  r.origin.x = from.x;
  r.origin.y = from.y;
  r.origin.z = from.z;
  normalize(sub(to, from, vec3()), r.dir);
  r.slot = slot;
  r.weapon = WEAPON_PROFILES[slot].id;
  r.tick = 5;
  return r;
}

describe('shot resolution order (FD-GS-Q1 = A)', () => {
  const world = buildCollisionWorld(fixtureMap());
  const setup = () => {
    const player = actor(0, vec3(1, 0, 0));
    const bot = actor(1, vec3(8, 0, 0));
    const events: SimEvent[] = [];
    const resolver = createShotResolver(
      [player, bot],
      world,
      (e) => events.push(structuredClone(e)),
      strictDiag(),
    );
    return { player, bot, events, resolver, queue: createShotQueue(2) };
  };

  it('trade: the player kills the last bot first, so the bot request is skipped', () => {
    const { player, bot, events, resolver, queue } = setup();
    enqueueShot(queue, aimAt(0, vec3(1, 1.6, 0), vec3(8, 1.62, 0), 2)); // sniper headshot
    enqueueShot(queue, aimAt(1, vec3(8, 1.6, 0), vec3(1, 1.0, 0), 0)); // bot rifle body
    resolver.resolve(queue);
    expect(bot.vitals.alive).toBe(false);
    expect(player.vitals.health).toBe(100);
    expect(events.filter((e) => e.t === 'shot').map((e) => e.shooter)).toEqual([PLAYER_ID]);
    expect(events.filter((e) => e.t === 'noise').map((e) => e.source)).toEqual([PLAYER_ID]);
    expect(events.map((e) => e.t)).toEqual(['shot', 'damage', 'kill', 'noise']);
    expect(queue.count).toBe(0);
    expect(roundOutcome(0, 100, player.vitals.alive)).toBe('victory');
  });

  it('a surviving bot still fires in the same tick and damages the player', () => {
    const { player, bot, events, resolver, queue } = setup();
    enqueueShot(queue, aimAt(0, vec3(1, 1.6, 0), vec3(8, 1.0, 0), 0)); // rifle body, 25
    enqueueShot(queue, aimAt(1, vec3(8, 1.6, 0), vec3(1, 1.0, 0), 0));
    resolver.resolve(queue);
    expect(bot.vitals.health).toBe(75);
    expect(player.vitals.health + player.vitals.armor).toBeLessThan(200);
    expect(events.filter((e) => e.t === 'shot')).toHaveLength(2);
  });

  it('bot shots are blocked by other bots without damaging them (ADR-018)', () => {
    const player = actor(0, vec3(1, 0, 0));
    const shooter = actor(1, vec3(8, 0, 0));
    const blocker = actor(2, vec3(5, 0, 0));
    const events: SimEvent[] = [];
    const resolver = createShotResolver(
      [player, shooter, blocker],
      world,
      (e) => events.push(structuredClone(e)),
      strictDiag(),
    );
    const q = createShotQueue(3);
    enqueueShot(q, aimAt(1, vec3(8, 1.0, 0), vec3(1, 1.0, 0), 0));
    resolver.resolve(q);
    expect(blocker.vitals.health).toBe(100);
    expect(player.vitals.health).toBe(100);
    const s = events.find((e) => e.t === 'shot');
    expect(s?.t === 'shot' && s.hit).toBeNull();
  });

  it('dead actors are not targets: a shot passes a dead bot', () => {
    const player = actor(0, vec3(1, 0, 0));
    const dead = actor(1, vec3(5, 0, 0));
    const live = actor(2, vec3(8, 0, 0));
    dead.vitals.alive = false;
    const resolver = createShotResolver([player, dead, live], world, () => undefined, strictDiag());
    const q = createShotQueue(3);
    enqueueShot(q, aimAt(0, vec3(1, 1.0, 0), vec3(8, 1.0, 0), 0));
    resolver.resolve(q);
    expect(live.vitals.health).toBe(75);
  });
});

describe('roundOutcome (win, then timeout, then death)', () => {
  it.each([
    [0, 0, true, 'victory'], // last kill on the final timer tick
    [0, 0, false, 'victory'],
    [0, 50, true, 'victory'],
    [3, 0, true, 'time-expired'],
    [3, 0, false, 'time-expired'], // player dies on the final tick with bots alive (BR-GS-33)
    [3, 50, false, 'defeat'],
    [3, 50, true, null],
  ] as const)('botsAlive %i, remaining %i, playerAlive %s -> %s', (b, r, p, want) => {
    expect(roundOutcome(b, r, p)).toBe(want);
  });
});
