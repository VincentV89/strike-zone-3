/**
 * Hand-built fixture map for collision-nav tests (BR-CN-98). It does not need
 * to pass checkMapData. Layout (x right, z down the page, +Y up):
 *
 * - ground made of two abutting slabs meeting at x = 0 (seam tests)
 * - 0.5 m boundary walls, 3 m high
 * - a 0.2 m wall at z = -5, x -9.5..-2
 * - a 0.35 m kerb (x 2..4) and a 0.40 m barrier (x 5..7), both z -9.5..-6
 * - a wall at z = 3 with a 1.6 m doorway (x -6..-4.4) under a lintel at 2.2 m
 * - two crates 0.7 m apart (narrow gap)
 * - a 30 degree ramp (+x, x 2..5.464, z 2..4) up to a 2 m platform
 * - an island: a 1.2 m high walkable block with no ramp (its own nav component)
 */
import type { MapDefinition, NavHint, Ramp, Solid, SolidKind } from '../../src/maps';

const v = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x, y, z });

export const box = (
  kind: SolidKind,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): Solid => ({ kind, box: { min: v(...min), max: v(...max) }, material: 'm' });

export const RAMP_RUN = 2 / Math.tan(Math.PI / 6); // 3.4641 m for a 2 m rise

export const FIXTURE_SOLIDS: readonly Solid[] = [
  /* 0 */ box('ground', [-10, -1, -10], [0, 0, 10]),
  /* 1 */ box('ground', [0, -1, -10], [10, 0, 10]),
  /* 2 */ box('boundary', [-10, 0, -10], [-9.5, 3, 10]),
  /* 3 */ box('boundary', [9.5, 0, -10], [10, 3, 10]),
  /* 4 */ box('boundary', [-10, 0, -10], [10, 3, -9.5]),
  /* 5 */ box('boundary', [-10, 0, 9.5], [10, 3, 10]),
  /* 6 */ box('wall', [-9.5, 0, -5.1], [-2, 3, -4.9]),
  /* 7 */ box('floor', [2, 0, -9.5], [4, 0.35, -6]),
  /* 8 */ box('barrier', [5, 0, -9.5], [7, 0.4, -6]),
  /* 9 */ box('wall', [-9.5, 0, 2.9], [-6, 3, 3.1]),
  /* 10 */ box('wall', [-4.4, 0, 2.9], [-1, 3, 3.1]),
  /* 11 */ box('wall', [-6, 2.2, 2.9], [-4.4, 3, 3.1]),
  /* 12 */ box('crate', [-8, 0, 6], [-7, 1, 7]),
  /* 13 */ box('crate', [-6.3, 0, 6], [-5.3, 1, 7]),
  /* 14 */ box('platform', [2 + RAMP_RUN, 0, 1], [8, 2, 5]),
  /* 15 */ box('floor', [-3, 0, 6], [-1, 1.2, 8]),
];

export const MAIN_RAMP: Ramp = {
  minX: 2,
  maxX: 2 + RAMP_RUN,
  minZ: 2,
  maxZ: 4,
  baseY: 0,
  topY: 2,
  up: '+x',
  material: 'm',
};

export const FIXTURE_RAMPS: readonly Ramp[] = [MAIN_RAMP];

export const STANDING = Object.freeze({ radius: 0.4, height: 1.8 });
export const CROUCHED = Object.freeze({ radius: 0.4, height: 1.2 });
export const STEP = 0.35;

export interface FixtureOptions {
  solids?: readonly Solid[];
  ramps?: readonly Ramp[];
  navHints?: readonly NavHint[];
  spawns?: MapDefinition['spawns'];
  cover?: MapDefinition['cover'];
  bounds?: MapDefinition['bounds'];
}

export function fixtureMap(opts: FixtureOptions = {}): MapDefinition {
  return {
    id: 'desert-compound',
    name: 'Fixture',
    bounds: opts.bounds ?? { min: v(-10, -1, -10), max: v(10, 6, 10) },
    solids: opts.solids ?? FIXTURE_SOLIDS,
    ramps: opts.ramps ?? FIXTURE_RAMPS,
    spawns: opts.spawns ?? [
      { pos: v(-8, 0, -8), yaw: 0, zone: 'a', player: true },
      { pos: v(8, 0, 8), yaw: 0, zone: 'b', player: false },
      { pos: v(7, 2, 3), yaw: 0, zone: 'b', player: false },
    ],
    cover: opts.cover ?? [{ pos: v(-7.5, 0, 5.4), facing: v(0, 0, 1), height: 'low', solid: 12 }],
    navHints: opts.navHints ?? [
      { kind: 'patrol', pos: v(0, 0, 0) },
      { kind: 'seed', pos: v(0, 0, 8.9) },
    ],
    features: [],
    lighting: {
      sunDir: v(0, -1, 0),
      sunColour: 0xffffff,
      sunIntensity: 1,
      sunShadowBox: { min: v(-10, -1, -10), max: v(10, 6, 10) },
      hemiSky: 0xffffff,
      hemiGround: 0,
      hemiIntensity: 1,
      background: 0,
      fog: null,
      locals: [],
    },
    materials: [
      {
        id: 'm',
        pattern: 'plain',
        base: 0,
        accent: 0,
        roughness: 1,
        metalness: 0,
        repeatM: 1,
      },
    ],
  };
}

export const vec = v;
