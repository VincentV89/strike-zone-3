/** buildCollisionWorld setup validation (BR-CN-10, SD-CN-05..07). */
import { describe, expect, it } from 'vitest';
import { StrikeZoneError } from '../../src/core';
import { buildCollisionWorld } from '../../src/physics';
import { FIXTURE_RAMPS, FIXTURE_SOLIDS, MAIN_RAMP, box, fixtureMap, vec } from './fixtures';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof StrikeZoneError) return e.code;
    throw e;
  }
  return 'no-throw';
}

describe('buildCollisionWorld', () => {
  it('builds the fixture with one shape per solid and ramp and copies the bounds', () => {
    const def = fixtureMap();
    const world = buildCollisionWorld(def);
    expect(world.shapeCount).toBe(FIXTURE_SOLIDS.length + FIXTURE_RAMPS.length);
    expect(world.bounds).toEqual(def.bounds);
    expect(world.bounds).not.toBe(def.bounds);
    expect(Object.isFrozen(world)).toBe(true);
  });

  it.each([0, 0.5, -1, Number.NaN, Infinity])('rejects cell size %s', (cell) => {
    expect(codeOf(() => buildCollisionWorld(fixtureMap(), cell))).toBe('physics/invalid-cell-size');
  });

  it('rejects non-finite and inverted geometry with list kind and index only (SD-CN-07)', () => {
    const nan = fixtureMap({
      solids: [...FIXTURE_SOLIDS, box('crate', [0, 0, 0], [1, Number.NaN, 1])],
    });
    const inverted = fixtureMap({ solids: [box('crate', [1, 0, 0], [0, 1, 1])] });
    const flatRamp = fixtureMap({ ramps: [{ ...MAIN_RAMP, topY: 0 }] });
    const thinRamp = fixtureMap({ ramps: [{ ...MAIN_RAMP, maxX: 2 }] });
    const badBounds = fixtureMap({ bounds: { min: vec(0, 0, 0), max: vec(-1, 1, 1) } });
    for (const def of [nan, inverted, flatRamp, thinRamp, badBounds]) {
      expect(codeOf(() => buildCollisionWorld(def))).toBe('physics/invalid-geometry');
    }
    try {
      buildCollisionWorld(nan);
    } catch (e) {
      const err = e as StrikeZoneError;
      expect(err.detail).toEqual({ kind: 'solid', index: FIXTURE_SOLIDS.length });
      expect(err.message).not.toContain('Fixture');
    }
  });

  it('rejects a grid over 16 384 cells before allocating (SD-CN-06)', () => {
    const huge = fixtureMap({ bounds: { min: vec(-1e9, 0, -1e9), max: vec(1e9, 1, 1e9) } });
    expect(codeOf(() => buildCollisionWorld(huge))).toBe('physics/grid-too-large');
  });

  it('rejects more than 65 536 cell entries', () => {
    const big = box('ground', [-250, -1, -250], [250, 0, 250]);
    const solids = Array.from({ length: 20 }, () => big);
    const def = fixtureMap({
      solids,
      ramps: [],
      bounds: { min: vec(-250, -1, -250), max: vec(250, 5, 250) },
    });
    expect(codeOf(() => buildCollisionWorld(def, 4))).toBe('physics/grid-too-large');
  });

  it('keeps no reference to the definition: later changes to a copy do not move the world', () => {
    const solids = FIXTURE_SOLIDS.map((s) => ({
      ...s,
      box: { min: { ...s.box.min }, max: { ...s.box.max } },
    }));
    const world = buildCollisionWorld(fixtureMap({ solids }));
    const before = world.capsuleFits(vec(-5, 0, -5), { radius: 0.4, height: 1.8 });
    const wall = solids[6];
    if (wall !== undefined) wall.box.min.z = 100;
    expect(world.capsuleFits(vec(-5, 0, -5), { radius: 0.4, height: 1.8 })).toBe(before);
  });
});
