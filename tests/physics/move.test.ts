import { describe, expect, it } from 'vitest';
import { createDiagnostics } from '../../src/core';
import { buildCollisionWorld, type CollisionWorld, type MoveResult } from '../../src/physics';
import { CROUCHED, STANDING, STEP, fixtureMap, vec } from './fixtures';

const DT = 1 / 60;
const G = -20;

interface Walk {
  ys: number[];
  xs: number[];
  zs: number[];
  last: MoveResult;
  allFit: boolean;
  grounded: boolean[];
}

/** Drives an actor with a constant horizontal velocity and simple gravity. */
function walk(
  world: CollisionWorld,
  start: { x: number; y: number; z: number },
  vx: number,
  vz: number,
  ticks: number,
  opts: { gravity?: boolean; capsule?: { radius: number; height: number }; vy0?: number } = {},
): Walk {
  const capsule = opts.capsule ?? STANDING;
  const pos = vec(start.x, start.y, start.z);
  const vel = vec(vx, opts.vy0 ?? 0, vz);
  const res: Walk = {
    ys: [],
    xs: [],
    zs: [],
    last: null as unknown as MoveResult,
    allFit: true,
    grounded: [],
  };
  let grounded = true;
  for (let i = 0; i < ticks; i++) {
    if (opts.gravity !== false && !grounded) vel.y += G * DT;
    const r = world.moveCapsule(pos, vel, capsule, DT, STEP);
    pos.x = r.position.x;
    pos.y = r.position.y;
    pos.z = r.position.z;
    vel.y = r.velocity.y;
    vel.x = vx;
    vel.z = vz;
    grounded = r.grounded;
    res.grounded.push(r.grounded);
    res.xs.push(pos.x);
    res.ys.push(pos.y);
    res.zs.push(pos.z);
    if (!world.capsuleFits(pos, capsule)) res.allFit = false;
    res.last = r;
  }
  return res;
}

describe('moveCapsule on the fixture map (story-walk-with-collision)', () => {
  const world = buildCollisionWorld(fixtureMap());

  it('walks freely on open ground and stays grounded', () => {
    const w = walk(world, vec(0, 0, -2), 4, 0, 60);
    expect(w.allFit).toBe(true);
    expect(w.last.grounded).toBe(true);
    expect(w.last.position.x).toBeCloseTo(4, 5);
    expect(Math.max(...w.ys.map(Math.abs))).toBeLessThan(1e-9);
  });

  it('never crosses the 0.2 m wall at 6 m/s or 50 m/s (BR-CN-30, BR-CN-31)', () => {
    for (const speed of [6, 50]) {
      const w = walk(world, vec(-5, 0, -2), 0, -speed, 120);
      expect(w.allFit).toBe(true);
      // Wall face at z = -4.9: the axis stays at least r - EPS beyond it.
      expect(Math.min(...w.zs)).toBeGreaterThanOrEqual(-4.9 + 0.4 - 0.01);
      expect(w.last.velocity.z).toBe(0);
    }
  });

  it('crosses the seam between two abutting slabs without a snag (BR-CN-21)', () => {
    const w = walk(world, vec(-3, 0, -1), 6, 0, 60);
    expect(w.allFit).toBe(true);
    expect(w.ys.every((y) => y === 0)).toBe(true);
    expect(w.grounded.every(Boolean)).toBe(true);
    expect(w.last.position.x).toBeCloseTo(3, 5);
  });

  it('steps up the 0.35 m kerb and is blocked by the 0.40 m barrier (BR-CN-33)', () => {
    const kerb = walk(world, vec(3, 0, -4), 0, -4, 60);
    expect(kerb.allFit).toBe(true);
    expect(kerb.last.position.y).toBeCloseTo(0.35, 9);
    expect(kerb.last.position.z).toBeLessThan(-7);

    const barrier = walk(world, vec(6, 0, -4), 0, -4, 60);
    expect(barrier.allFit).toBe(true);
    expect(barrier.last.position.y).toBe(0);
    expect(barrier.last.position.z).toBeGreaterThanOrEqual(-6 + 0.39);
  });

  it('walks up the 30 degree ramp onto the platform and back down, staying grounded (BR-CN-34)', () => {
    const up = walk(world, vec(0.5, 0, 3), 4, 0, 90);
    expect(up.allFit).toBe(true);
    expect(up.grounded.every(Boolean)).toBe(true);
    expect(up.last.position.y).toBeCloseTo(2, 9);
    expect(up.last.position.x).toBeGreaterThan(6);

    const down = walk(world, up.last.position, -4, 0, 90);
    expect(down.allFit).toBe(true);
    expect(down.grounded.every(Boolean)).toBe(true);
    expect(down.last.position.y).toBeCloseTo(0, 9);
  });

  it('blocks the ramp side wall where it is high (BR-CN-24)', () => {
    // Walking +z into the ramp side near the high edge (surface ~1.7 m).
    const w = walk(world, vec(5, 0, 0.5), 0, 4, 60);
    expect(w.allFit).toBe(true);
    expect(w.last.position.y).toBe(0);
    expect(w.last.position.z).toBeLessThanOrEqual(2 - 0.39);
  });

  it('reports hitCeiling under the lintel and lands with landed = true (BR-CN-35, BR-CN-36)', () => {
    const pos = vec(-5.2, 0, 3);
    const vel = vec(0, 6, 0);
    const first = world.moveCapsule(pos, vel, STANDING, DT, STEP);
    expect(first.grounded).toBe(false);
    let r = first;
    let hit = false;
    let landed = false;
    const p = vec(pos.x, pos.y, pos.z);
    const v = vec(0, 6, 0);
    for (let i = 0; i < 60; i++) {
      r = world.moveCapsule(p, v, STANDING, DT, STEP);
      p.y = r.position.y;
      hit ||= r.hitCeiling;
      landed ||= r.landed;
      v.y = r.velocity.y + G * DT;
      expect(p.y + STANDING.height).toBeLessThanOrEqual(2.2 + 0.01);
    }
    expect(hit).toBe(true);
    expect(landed).toBe(true);
    expect(r.grounded).toBe(true);
  });

  it('slides along a wall when walking into it at 45 degrees (BR-CN-32)', () => {
    const w = walk(world, vec(-8, 0, -3.5), 3, -3, 60);
    expect(w.allFit).toBe(true);
    expect(w.last.position.x).toBeGreaterThan(-8 + 2);
    expect(w.last.position.z).toBeGreaterThanOrEqual(-4.9 + 0.39);
    expect(w.last.velocity.z).toBeCloseTo(0, 9);
    expect(w.last.velocity.x).toBeCloseTo(3, 9);
  });

  it('stays out of a corner pinch', () => {
    // Corner between the boundary (x = -9.5) and the 0.2 m wall (z = -4.9).
    const w = walk(world, vec(-8, 0, -3), -5, -5, 120);
    expect(w.allFit).toBe(true);
    expect(w.last.position.x).toBeGreaterThanOrEqual(-9.5 + 0.39);
    expect(w.last.position.z).toBeGreaterThanOrEqual(-4.9 + 0.39);
  });

  it('passes through the 1.6 m doorway standing', () => {
    const w = walk(world, vec(-5.2, 0, 1), 0, 4, 60);
    expect(w.allFit).toBe(true);
    expect(w.last.position.z).toBeGreaterThan(4.5);
  });

  it('depenetrates a start position inside a wall by up to 0.5 m (BR-CN-38)', () => {
    const r = world.moveCapsule(vec(-5, 0, -4.7), vec(0, 0, 0), STANDING, DT, STEP);
    expect(world.capsuleFits(r.position, STANDING)).toBe(true);
    expect(Math.abs(r.position.z - -4.7)).toBeLessThanOrEqual(0.5);
  });

  it('holds a hopelessly stuck actor in place and reports it once', () => {
    const sink: string[] = [];
    const w = buildCollisionWorld(
      fixtureMap(),
      4,
      createDiagnostics((c) => sink.push(c)),
    );
    // Feet 0.5 m deep inside the 1.2 m island, 1 m from every face: no push of 0.5 m frees it.
    const fat = STANDING;
    const r1 = w.moveCapsule(vec(-2, 0.5, 7), vec(1, 0, 0), fat, DT, STEP);
    const r2 = w.moveCapsule(vec(-2, 0.5, 7), vec(1, 0, 0), fat, DT, STEP);
    expect(r1.position).toEqual(vec(-2, 0.5, 7));
    expect(r1.velocity).toEqual(vec(0, 0, 0));
    expect(r2.grounded).toBe(false);
    expect(sink).toEqual(['physics/stuck-in-geometry']);
  });

  it('crouched actor fits under the lintel, standing does not', () => {
    expect(world.capsuleFits(vec(-5.2, 0, 3), CROUCHED)).toBe(true);
    expect(world.capsuleFits(vec(-5.2, 0, 3), STANDING)).toBe(true);
    expect(world.capsuleFits(vec(-5.2, 0.5, 3), STANDING)).toBe(false);
  });

  it('writes into a caller out object and returns it (FD-CN-05)', () => {
    const out: MoveResult = {
      position: vec(0, 0, 0),
      velocity: vec(0, 0, 0),
      grounded: false,
      hitCeiling: false,
      landed: false,
    };
    const r = world.moveCapsule(vec(0, 0, 0), vec(1, 0, 0), STANDING, DT, STEP, out);
    expect(r).toBe(out);
    expect(out.position.x).toBeCloseTo(1 / 60, 9);
  });

  it('keeps the eye inside the cylinder: at least r - EPS from any wall (BR-CN-39)', () => {
    const w = walk(world, vec(-5, 0, -2), 0, -6, 120);
    const eyeZ = w.last.position.z;
    expect(eyeZ - -4.9).toBeGreaterThanOrEqual(0.39);
  });
});
