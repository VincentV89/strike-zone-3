/** raycast and lineOfSight (BR-CN-40..44, FD-CN-06). */
import { describe, expect, it } from 'vitest';
import { buildCollisionWorld, type RayHit } from '../../src/physics';
import { RAMP_RUN, fixtureMap, vec } from './fixtures';

const world = buildCollisionWorld(fixtureMap());

describe('raycast', () => {
  it('hits the near face of the 0.2 m wall with a normal facing the origin', () => {
    const hit = world.raycast(vec(-5, 1, 0), vec(0, 0, -1), 50);
    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeCloseTo(4.9, 9);
    expect(hit?.normal).toEqual(vec(0, 0, 1));
    expect(hit?.solidIndex).toBe(6);
    expect(hit?.rampIndex).toBe(-1);
    expect(hit?.point.z).toBeCloseTo(-4.9, 9);
  });

  it('normalises dir and measures distance in metres', () => {
    const hit = world.raycast(vec(-5, 1, 0), vec(0, 0, -10), 50);
    expect(hit?.distance).toBeCloseTo(4.9, 9);
  });

  it('returns null beyond maxDist and for a zero or non-finite direction', () => {
    expect(world.raycast(vec(-5, 1, 0), vec(0, 0, -1), 4)).toBeNull();
    expect(world.raycast(vec(-5, 1, 0), vec(0, 0, 0), 50)).toBeNull();
    expect(world.raycast(vec(-5, 1, 0), vec(Number.NaN, 0, 0), 50)).toBeNull();
    expect(world.raycast(vec(-5, 1, 0), vec(1, 0, 0), Number.NaN)).toBeNull();
    expect(world.raycast(vec(-5, 1, 0), vec(1, 0, 0), -1)).toBeNull();
  });

  it('hits at distance 0 with normal -dir when the origin is inside a shape (BR-CN-40)', () => {
    const hit = world.raycast(vec(-5, 1, -5), vec(1, 0, 0), 10);
    expect(hit?.distance).toBe(0);
    expect(hit?.normal).toEqual(vec(-1, -0, -0));
    expect(hit?.solidIndex).toBe(6);
  });

  it('hits the ramp slope with the plane normal and reports rampIndex (FD-CN-06)', () => {
    const hit = world.raycast(vec(3, 5, 3), vec(0, -1, 0), 10);
    expect(hit?.rampIndex).toBe(0);
    expect(hit?.solidIndex).toBe(-1);
    const surface = 2 * ((3 - 2) / RAMP_RUN);
    expect(hit?.point.y).toBeCloseTo(surface, 9);
    expect(hit?.normal.y).toBeCloseTo(Math.cos(Math.PI / 6), 9);
    expect(hit?.normal.x).toBeCloseTo(-Math.sin(Math.PI / 6), 9);
  });

  it('a vertical ray tests one column and hits the ground top', () => {
    const hit = world.raycast(vec(0.5, 3, -1), vec(0, -1, 0), 10);
    expect(hit?.distance).toBeCloseTo(3, 9);
    expect(hit?.solidIndex).toBe(1);
    expect(hit?.normal).toEqual(vec(0, 1, 0));
  });

  it('reports no hit for a ray grazing the shared top face of two abutting slabs (BR-CN-21)', () => {
    expect(world.raycast(vec(-3, 0, -1), vec(1, 0, 0), 6)).toBeNull();
  });

  it('breaks ties at equal distance to the lower shape id (BR-CN-42)', () => {
    // Straight down onto the seam x = 0: both ground slabs are hit at distance 1.
    const hit = world.raycast(vec(0, 1, -1), vec(0, -1, 0), 5);
    expect(hit?.solidIndex).toBe(0);
  });

  it('crosses many cells on a long diagonal and stops at the boundary', () => {
    const hit = world.raycast(vec(-9, 1, -8), vec(1, 0, 1), 100);
    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeGreaterThan(1);
  });

  it('writes into a caller out hit (FD-CN-05)', () => {
    const out: RayHit = {
      distance: 0,
      point: vec(0, 0, 0),
      normal: vec(0, 0, 0),
      solidIndex: 0,
      rampIndex: 0,
    };
    expect(world.raycast(vec(-5, 1, 0), vec(0, 0, -1), 50, out)).toBe(out);
    expect(out.solidIndex).toBe(6);
  });

  it('clamps maxDist to 500 m', () => {
    expect(world.raycast(vec(-5, 1, 0), vec(0, 0, -1), 1e9)?.distance).toBeCloseTo(4.9, 9);
  });

  it('starts a ray from outside the grid and enters it', () => {
    const hit = world.raycast(vec(-30, 1, 0), vec(1, 0, 0), 100);
    expect(hit?.solidIndex).toBe(2);
    expect(hit?.distance).toBeCloseTo(20, 9);
    expect(world.raycast(vec(-30, 1, 0), vec(-1, 0, 0), 100)).toBeNull();
    expect(world.raycast(vec(-30, 1, 30), vec(0, 0, 1), 100)).toBeNull();
  });
});

describe('lineOfSight', () => {
  it('is false through a wall and true in the open (BR-CN-20)', () => {
    expect(world.lineOfSight(vec(-5, 1.6, -3), vec(-5, 1.6, -7))).toBe(false);
    expect(world.lineOfSight(vec(-5, 1.6, -3), vec(5, 1.6, -3))).toBe(true);
  });

  it('sees a target standing flush against a wall from the open side (BR-CN-43)', () => {
    expect(world.lineOfSight(vec(-5, 1.6, 0), vec(-5, 1.6, -4.9))).toBe(true);
  });

  it('is true for coincident points and false for non-finite input (fail closed)', () => {
    expect(world.lineOfSight(vec(1, 1, 1), vec(1, 1, 1))).toBe(true);
    expect(world.lineOfSight(vec(Number.NaN, 1, 1), vec(1, 1, 1))).toBe(false);
  });

  it('is blocked by a ramp wedge (SD-CN-17)', () => {
    expect(world.lineOfSight(vec(4, 0.5, 0.5), vec(4, 0.5, 5.5))).toBe(false);
  });

  it('a blocked ray never reports what is behind the blocker (BR-CN-44)', () => {
    const hit = world.raycast(vec(-5, 1, 0), vec(0, 0, -1), 50);
    expect(hit?.solidIndex).toBe(6);
  });
});
