/** capsuleFits, sweepClear and separate (BR-CN-50..52). */
import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../../src/physics';
import { STANDING, fixtureMap, vec } from './fixtures';

const world = buildCollisionWorld(fixtureMap());

describe('capsuleFits', () => {
  it('fits on open ground and on a box top within EPS', () => {
    expect(world.capsuleFits(vec(0, 0, 0), STANDING)).toBe(true);
    expect(world.capsuleFits(vec(3, 0.35, -8), STANDING)).toBe(true);
    expect(world.capsuleFits(vec(3, 0.345, -8), STANDING)).toBe(true);
  });

  it('fails inside a wall, in the 0.7 m crate gap and under the ramp surface', () => {
    expect(world.capsuleFits(vec(-5, 0, -5), STANDING)).toBe(false);
    expect(world.capsuleFits(vec(-6.65, 0, 6.5), STANDING)).toBe(false);
    expect(world.capsuleFits(vec(5, 0, 3), STANDING)).toBe(false);
  });

  it('passes the 1.6 m doorway', () => {
    expect(world.capsuleFits(vec(-5.2, 0, 3), STANDING)).toBe(true);
  });

  it('rejects bad capsules and non-finite positions', () => {
    expect(world.capsuleFits(vec(0, 0, 0), { radius: 0, height: 1.8 })).toBe(false);
    expect(world.capsuleFits(vec(0, 0, 0), { radius: 0.4, height: 0.01 })).toBe(false);
    expect(world.capsuleFits(vec(0, Infinity, 0), STANDING)).toBe(false);
  });
});

describe('sweepClear', () => {
  it('walks open ground, through the doorway and up the ramp', () => {
    expect(world.sweepClear(vec(-3, 0, -2), vec(3, 0, -2), STANDING)).toBe(true);
    expect(world.sweepClear(vec(-5.2, 0, 1), vec(-5.2, 0, 5), STANDING)).toBe(true);
    expect(world.sweepClear(vec(0.5, 0, 3), vec(7, 2, 3), STANDING)).toBe(true);
    expect(world.sweepClear(vec(7, 2, 3), vec(0.5, 0, 3), STANDING)).toBe(true);
  });

  it('fails through a wall, through the 0.7 m gap and onto the 0.4 m barrier', () => {
    expect(world.sweepClear(vec(-5, 0, -3), vec(-5, 0, -7), STANDING)).toBe(false);
    expect(world.sweepClear(vec(-6.65, 0, 5), vec(-6.65, 0, 8), STANDING)).toBe(false);
    expect(world.sweepClear(vec(6, 0, -4), vec(6, 0.4, -8), STANDING)).toBe(false);
  });

  it('steps onto the 0.35 m kerb', () => {
    expect(world.sweepClear(vec(3, 0, -4), vec(3, 0.35, -8), STANDING)).toBe(true);
  });

  it('fails a drop off the 2 m platform edge and the 1.2 m island in both directions', () => {
    expect(world.sweepClear(vec(7, 2, 3), vec(7, 0, 6.5), STANDING)).toBe(false);
    expect(world.sweepClear(vec(-2, 1.2, 7), vec(-2, 0, 9), STANDING)).toBe(false);
    expect(world.sweepClear(vec(-2, 0, 9), vec(-2, 1.2, 7), STANDING)).toBe(false);
  });

  it('has no support at the platform edge once the axis leaves the top (centre-on-top rule)', () => {
    expect(world.sweepClear(vec(7, 2, 3), vec(7, 2, 5.3), STANDING)).toBe(false);
  });

  it('fails when the start does not fit and on non-finite input', () => {
    expect(world.sweepClear(vec(-5, 0, -5), vec(-5, 0, -2), STANDING)).toBe(false);
    expect(world.sweepClear(vec(0, 0, 0), vec(Number.NaN, 0, 0), STANDING)).toBe(false);
    expect(world.sweepClear(vec(0, 0, 0), vec(1, 0, 0), STANDING, -1)).toBe(false);
  });
});

describe('separate (BR-CN-52)', () => {
  it('pushes two overlapping actors apart by half the penetration each', () => {
    const a = vec(0, 0, 0);
    const b = vec(0.5, 0, 0);
    expect(world.separate(a, STANDING, b, STANDING)).toBe(true);
    expect(b.x - a.x).toBeCloseTo(0.79, 9);
    expect(a.x).toBeCloseTo(-0.145, 9);
    expect(a.y).toBe(0);
    expect(world.separate(a, STANDING, b, STANDING)).toBe(false);
  });

  it('pushes A to -x and B to +x when the axes coincide', () => {
    const a = vec(1, 0, 1);
    const b = vec(1, 0, 1);
    expect(world.separate(a, STANDING, b, STANDING)).toBe(true);
    expect(a.x).toBeLessThan(1);
    expect(b.x).toBeGreaterThan(1);
    expect(a.z).toBe(1);
  });

  it('does nothing for vertically disjoint actors', () => {
    const a = vec(0, 0, 0);
    const b = vec(0.2, 2, 0);
    expect(world.separate(a, STANDING, b, STANDING)).toBe(false);
  });

  it('gives the full push to the free side when one actor is against a wall', () => {
    const a = vec(-5, 0, -4.49); // flush against the 0.2 m wall face at z = -4.9
    const b = vec(-5, 0, -4.2);
    expect(world.separate(a, STANDING, b, STANDING)).toBe(true);
    expect(a.z).toBe(-4.49);
    expect(b.z).toBeCloseTo(-4.49 + 0.79, 9);
  });

  it('moves nothing when both sides are blocked', () => {
    // Two 0.5 m actors in the 1.6 m doorway, each flush with a jamb.
    const fat = { radius: 0.5, height: 1.8 };
    const a = vec(-5.505, 0, 3);
    const b = vec(-4.895, 0, 3);
    expect(world.capsuleFits(a, fat) && world.capsuleFits(b, fat)).toBe(true);
    expect(world.separate(a, fat, b, fat)).toBe(false);
    expect([a.x, b.x]).toEqual([-5.505, -4.895]);
  });

  it('caps the total push at 0.5 m and rejects non-finite input', () => {
    const a = vec(0, 0, 0);
    const b = vec(0.0001, 0, 0);
    world.separate(a, STANDING, b, STANDING);
    expect(b.x - a.x).toBeLessThanOrEqual(0.5 + 0.0001 + 1e-9);
    expect(world.separate(vec(Number.NaN, 0, 0), STANDING, b, STANDING)).toBe(false);
  });
});
