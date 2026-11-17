/**
 * Test-only player drivers (business-logic-model-game-simulation §9). They may
 * read the whole snapshot, which only tests may do; nothing here ships
 * (SD-GS-08). `hunter` paths to the nearest bot over the map's nav graph and,
 * when it has line of sight, turns toward it and fires.
 */
import { angleDelta, vec3, type EntityId, type Vec3 } from '../../src/core';
import type { InputCommand, SimSnapshot } from '../../src/contracts';
import { createPathService, type PathTicket } from '../../src/nav';
import type { PreparedMap } from '../../src/sim';
import { PLAYER_TUNING } from '../../src/sim/player';
import { cmd } from './helpers';

export type Driver = (s: Readonly<SimSnapshot>) => InputCommand;

/** Stands still and does nothing. */
export const idle: Driver = () => cmd();

/** lookDx/lookDy that turn the view by (dYaw, dPitch) at sensitivity 1 (yaw -= lookDx * k). */
export function lookFor(dYaw: number, dPitch: number): { lookDx: number; lookDy: number } {
  const k = PLAYER_TUNING.lookRadPerCount;
  return { lookDx: -dYaw / k, lookDy: -dPitch / k };
}

export interface HunterOptions {
  /** Fire at visible bots (false: walk into them without shooting, the "exposed" player). */
  fire: boolean;
  /** Ignore bots farther than this for shooting (m). */
  range?: number;
  /** Ticks between path requests. */
  repathTicks?: number;
}

export function hunter(map: PreparedMap, o: HunterOptions): Driver {
  const paths = createPathService(map.nav, map.world);
  const eye = vec3();
  const chest = vec3();
  const from = vec3();
  const to = vec3();
  const path: Vec3[] = [];
  let next = 0;
  let ticket: PathTicket | null = null;
  let lastReq = -1_000;
  const range = o.range ?? 60;
  const repath = o.repathTicks ?? 45;

  return (s) => {
    paths.tick();
    const p = s.player;
    const c = cmd({ tick: s.tick });
    if (!p.alive) return c;
    eye.x = p.pos.x;
    eye.y = p.pos.y + p.eyeHeight;
    eye.z = p.pos.z;
    let best: (typeof s.bots)[number] | null = null;
    let bestD = Infinity;
    for (const b of s.bots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    if (best === null) return c;
    chest.x = best.pos.x;
    chest.y = best.pos.y + (best.crouch ? 0.8 : 1.2);
    chest.z = best.pos.z;
    const visible = bestD < range && map.world.lineOfSight(eye, chest);
    if (visible) {
      const dx = chest.x - eye.x;
      const dy = chest.y - eye.y;
      const dz = chest.z - eye.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const dYaw = angleDelta(p.yaw, yaw);
      Object.assign(c, lookFor(dYaw, pitch - p.pitch));
      if (o.fire && Math.abs(dYaw) < 0.05) {
        c.fire = true;
        c.firePressed = true;
      }
      if (o.fire) {
        if (p.loadout.slots[0]?.mag === 0) c.reload = true;
        return c;
      }
    }
    // Walk the nav path toward the bot.
    if (s.tick - lastReq >= repath) {
      lastReq = s.tick;
      from.x = p.pos.x;
      from.y = p.pos.y;
      from.z = p.pos.z;
      to.x = best.pos.x;
      to.y = best.pos.y;
      to.z = best.pos.z;
      ticket = paths.request(0 as EntityId, { from, to });
    }
    if (ticket !== null) {
      const r = paths.poll(ticket);
      if (r !== 'pending') {
        ticket = null;
        path.length = 0;
        next = 0;
        if (r.ok) for (const w of r.value) path.push(vec3(w.x, w.y, w.z));
      }
    }
    while (next < path.length) {
      const w = path[next] as Vec3;
      if (Math.hypot(w.x - p.pos.x, w.z - p.pos.z) > 0.6) break;
      next++;
    }
    const w = path[next] ?? (visible ? best.pos : null);
    if (w === null) return c;
    const yaw = Math.atan2(-(w.x - p.pos.x), -(w.z - p.pos.z));
    const dYaw = angleDelta(p.yaw, yaw);
    if (!visible) Object.assign(c, lookFor(dYaw, -p.pitch));
    if (Math.abs(dYaw) < 0.6) c.move = { x: 0, z: -1 };
    return c;
  };
}

/** Stands still and keeps its back to the nearest bot, so that bot is heard, not seen. */
export const facingAway: Driver = (s) => {
  const p = s.player;
  let best: (typeof s.bots)[number] | null = null;
  let bestD = Infinity;
  for (const b of s.bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  }
  if (best === null) return cmd({ tick: s.tick });
  // Facing yaw y looks along (-sin y, -cos y); this yaw looks directly away from the bot.
  const yaw = Math.atan2(best.pos.x - p.pos.x, best.pos.z - p.pos.z);
  return cmd({ tick: s.tick, ...lookFor(angleDelta(p.yaw, yaw), 0) });
};

/** A fixed script for the golden: walk, turn and fire into the open on a schedule. */
export function scripted(): Driver {
  return (s) => {
    const t = s.tick;
    const c = cmd({ tick: t });
    const phase = Math.floor(t / 120) % 4;
    if (phase === 0) c.move = { x: 0, z: -1 };
    else if (phase === 1) c.lookDx = 6;
    else if (phase === 2) c.move = { x: 1, z: 0 };
    else c.lookDx = -6;
    if (t % 90 === 0) {
      c.fire = true;
      c.firePressed = true;
    }
    if (t % 400 === 0) c.reload = true;
    return c;
  };
}
