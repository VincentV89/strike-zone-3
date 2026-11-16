/** Player awareness and radar marks (BR-GS-70..73, SD-GS-02, req-radar). */
import { describe, expect, it } from 'vitest';
import { vec3, type EntityId, type Vec3 } from '../../src/core';
import type { RadarContact } from '../../src/contracts';
import { buildCollisionWorld, type CollisionWorld } from '../../src/physics';
import { createAwareness, type AwarenessTarget } from '../../src/sim/awareness';
import { fixtureMap } from '../physics/fixtures';
import { countingWorld } from '../ai/counting';
import { facingAway, hunter } from './drivers';
import { rig } from './fixtures';

const world = buildCollisionWorld(fixtureMap());
const target = (id: number, pos: Vec3, alive = true): AwarenessTarget => ({
  id: id as EntityId,
  pos,
  alive,
});
const pool = (): RadarContact[] =>
  Array.from({ length: 20 }, () => ({
    id: 0 as EntityId,
    pos: vec3(),
    kind: 'seen' as const,
    ageTicks: 0,
  }));
const YAW_PLUS_X = -Math.PI / 2; // forward = (-sin yaw, -cos yaw) = (+1, 0)

function publish(a: ReturnType<typeof createAwareness>, tick: number, bots: AwarenessTarget[]) {
  const out: RadarContact[] = [];
  a.publish(tick, bots, pool(), out);
  return out.map((c) => ({ id: c.id, kind: c.kind, age: c.ageTicks, pos: { ...c.pos } }));
}

describe('awareness seen marks', () => {
  const eye = vec3(1, 1.6, 0);

  it('marks a bot in range, in the cone and in sight, at its position at mark time', () => {
    const a = createAwareness(world, 3);
    const pos = vec3(8, 0, 0);
    const bots = [target(1, pos)];
    a.update(60, eye, YAW_PLUS_X, bots);
    pos.x = 7; // the bot moves after the mark
    expect(publish(a, 66, bots)).toEqual([
      { id: 1, kind: 'seen', age: 6, pos: { x: 8, y: 0, z: 0 } },
    ]);
  });

  it('ignores bots behind the player, behind a wall and beyond 30 m', () => {
    const a = createAwareness(world, 3);
    const behind = target(1, vec3(-4, 0, 0));
    a.update(60, eye, YAW_PLUS_X, [behind]);
    expect(publish(a, 60, [behind])).toEqual([]);
    const walled = target(2, vec3(-6, 0, -2));
    a.update(60, vec3(-6, 1.6, -8), Math.PI, [walled]); // wall at z = -5 between them
    expect(publish(a, 60, [walled])).toEqual([]);
    const open: CollisionWorld = { ...world, lineOfSight: () => true };
    const b = createAwareness(open, 3);
    const far = target(3, vec3(31.5, 0, 0));
    b.update(60, eye, YAW_PLUS_X, [far]);
    expect(publish(b, 60, [far])).toEqual([]);
  });

  it('uses at most 2 rays per bot (chest, then head only if the chest is blocked)', () => {
    const counting = countingWorld({ ...world, lineOfSight: () => false });
    const a = createAwareness(counting, 20);
    const bots = Array.from({ length: 20 }, (_, i) => target(i + 1, vec3(8, 0, (i % 5) - 2)));
    a.update(60, eye, YAW_PLUS_X, bots);
    expect(counting.counts.lineOfSight).toBe(40);
    const seeing = countingWorld({ ...world, lineOfSight: () => true });
    createAwareness(seeing, 20).update(60, eye, YAW_PLUS_X, bots);
    expect(seeing.counts.lineOfSight).toBe(20);
  });

  it('expires seen marks after 30 ticks and heard marks after 120; drops dead bots at once', () => {
    const a = createAwareness(world, 3);
    const s = target(1, vec3(8, 0, 0));
    a.update(100, eye, YAW_PLUS_X, [s]);
    expect(publish(a, 130, [s])).toHaveLength(1);
    expect(publish(a, 131, [s])).toEqual([]);
    a.markHeard(2 as EntityId, vec3(5, 1.6, 5), 100, eye);
    const h = target(2, vec3(9, 0, 9));
    expect(publish(a, 220, [h])).toEqual([
      { id: 2, kind: 'heard', age: 120, pos: { x: 5, y: 1.6, z: 5 } },
    ]);
    expect(publish(a, 221, [h])).toEqual([]);
    a.markHeard(3 as EntityId, vec3(2, 1.6, 2), 10, eye);
    expect(publish(a, 11, [target(3, vec3(), false)])).toEqual([]);
  });

  it('a heard mark never replaces a fresh seen mark; far gunfire is not heard', () => {
    const a = createAwareness(world, 3);
    const s = target(1, vec3(8, 0, 0));
    a.update(100, eye, YAW_PLUS_X, [s]);
    a.markHeard(1 as EntityId, vec3(9, 1.6, 1), 105, eye);
    expect(publish(a, 105, [s])[0]?.kind).toBe('seen');
    a.markHeard(1 as EntityId, vec3(9, 1.6, 1), 140, eye); // seen mark is stale now
    expect(publish(a, 140, [s])[0]?.kind).toBe('heard');
    a.markHeard(2 as EntityId, vec3(40, 1.6, 0), 140, eye);
    expect(publish(a, 140, [s, target(2, vec3(40, 0, 0))]).map((c) => c.id)).toEqual([1]);
    a.clear(1 as EntityId);
    a.markHeard(99 as EntityId, vec3(), 1, eye); // out-of-range ids are ignored
    expect(publish(a, 140, [s])).toEqual([]);
  });
});

describe('radar in the real pipeline', () => {
  it('publishes only bots seen from the player eye or heard firing (no wallhack)', () => {
    let seen = 0;
    let heard = 0;
    for (const [seed, fire] of [
      [21, true],
      [22, false],
    ] as const) {
      const { sim, map } = rig(
        { map: 'industrial-warehouse', bots: 10, seed, difficulty: 'normal' },
        { allowed: ['ai/few-patrol-nodes'] },
      );
      const drive = fire ? hunter(map, { fire: true }) : facingAway;
      const fired = new Map<number, Set<number>>();
      for (let i = 0; i < 8000 && sim.snapshot().phase !== 'ended'; i++) {
        sim.step(drive(sim.snapshot()));
        for (const e of sim.drainEvents()) {
          if (e.t === 'noise' && e.kind === 'gunfire' && e.source !== 0) {
            const set = fired.get(e.source) ?? new Set<number>();
            set.add(e.tick);
            fired.set(e.source, set);
          }
        }
        const s = sim.snapshot();
        const p = s.player.pos;
        const eye = vec3(p.x, p.y + s.player.eyeHeight, p.z);
        for (const c of s.radar) {
          expect(s.bots.find((x) => x.id === c.id)?.alive).toBe(true);
          if (c.kind === 'seen') {
            seen++;
            if (c.ageTicks === 0) {
              const chest = vec3(c.pos.x, c.pos.y + 1.2, c.pos.z);
              const head = vec3(c.pos.x, c.pos.y + 1.7, c.pos.z);
              expect(map.world.lineOfSight(eye, chest) || map.world.lineOfSight(eye, head)).toBe(
                true,
              );
            }
            expect(c.ageTicks).toBeLessThanOrEqual(30);
          } else {
            heard++;
            expect(fired.get(c.id)?.has(s.tick - c.ageTicks)).toBe(true);
            expect(c.ageTicks).toBeLessThanOrEqual(120);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(heard).toBeGreaterThan(0);
  });

  it('shows contacts during a fight and their positions are mark-time positions', () => {
    const { sim, map } = rig(
      { map: 'industrial-warehouse', bots: 5, difficulty: 'normal', seed: 2 },
      { allowed: ['ai/few-patrol-nodes'] },
    );
    const drive = hunter(map, { fire: true });
    let contacts = 0;
    for (let i = 0; i < 6000 && sim.snapshot().phase !== 'ended'; i++) {
      sim.step(drive(sim.snapshot()));
      sim.drainEvents();
      const s = sim.snapshot();
      const ids = s.radar.map((c) => c.id);
      expect([...ids].sort((x, y) => x - y)).toEqual(ids);
      for (const c of s.radar) {
        contacts++;
        expect(Math.hypot(c.pos.x - s.player.pos.x, c.pos.z - s.player.pos.z)).toBeLessThanOrEqual(
          30 + 8,
        );
      }
    }
    expect(contacts).toBeGreaterThan(0);
  });
});
