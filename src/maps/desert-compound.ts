/**
 * Map 1: Desert Compound (req-map-desert-compound). An outdoor compound,
 * 96 x 96 m, origin at the centre, north is -Z. Layout follows the
 * business-logic-model-map-data plan: a walled courtyard in the middle, a
 * roofed building with a ramp to its roof (NW), three more buildings, two
 * market blocks with narrow alleys, two watchtowers, four dunes and four
 * corner spawn pockets of 8 spawns each.
 *
 * Private module: consumers import src/maps/index.ts only (SEC-M-03).
 */
import { vec3, type Vec3 } from '../core';
import {
  block,
  box,
  coverAt,
  crate,
  ramp,
  rampMid,
  region,
  spawnGrid,
  unit,
  wallAlongX,
  wallAlongZ,
  yawToward,
} from './build';
import type {
  CoverPoint,
  MapDefinition,
  MapFeatureTag,
  MaterialHint,
  NavHint,
  Ramp,
  Solid,
  SpawnPoint,
} from './types';

const HALF = 48;
const TOP = 14;

const solids: Solid[] = [];
const ramps: Ramp[] = [];
const spawns: SpawnPoint[] = [];
const cover: CoverPoint[] = [];
const navHints: NavHint[] = [];
const features: MapFeatureTag[] = [];

/** Pushes solids and returns the index of the first one. */
function put(...items: Solid[]): number {
  const first = solids.length;
  solids.push(...items);
  return first;
}

const patrol = (x: number, y: number, z: number): void => {
  navHints.push({ kind: 'patrol', pos: vec3(x, y, z) });
};
const seed = (p: Vec3): void => {
  navHints.push({ kind: 'seed', pos: p });
};
const tag = (
  feature: MapFeatureTag['feature'],
  label: string,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): void => {
  features.push({ feature, label, region: region(min, max) });
};

// 1. Base slab and perimeter (BR-M-10, BR-M-11).
put(box('ground', [-HALF, -1, -HALF], [HALF, 0, HALF], 'sand'));
put(
  box('boundary', [-HALF, 0, -HALF], [-HALF + 1, 7, HALF], 'sandstone'),
  box('boundary', [HALF - 1, 0, -HALF], [HALF, 7, HALF], 'sandstone'),
  box('boundary', [-HALF, 0, -HALF], [HALF, 7, -HALF + 1], 'sandstone'),
  box('boundary', [-HALF, 0, HALF - 1], [HALF, 7, HALF], 'sandstone'),
);

// 2. Courtyard: x, z -10..10, walls 0.6 m thick and 3.5 m high, a 3 m gate centred on each side.
const gateX = [{ at: 0, width: 3, height: 3.5 }];
put(...wallAlongX(-10.6, 10.6, -10.3, 0.6, 3.5, 'plaster', gateX));
put(...wallAlongX(-10.6, 10.6, 10.3, 0.6, 3.5, 'plaster', gateX));
put(...wallAlongZ(-10, 10, -10.3, 0.6, 3.5, 'plaster', gateX));
put(...wallAlongZ(-10, 10, 10.3, 0.6, 3.5, 'plaster', gateX));
const cCrateNW = put(crate(-4, -4, 0, 'wood'));
const cCrateSW = put(crate(-4, 4, 0, 'wood'));
const cCrateNE = put(crate(4, -4, 0, 'wood'));
put(crate(4, 4, 0, 'wood'), crate(4, 4, 1.25, 'wood'));
const cBarrierN = put(block('barrier', 0, -6, [3, 1.3, 0.6], 0, 'concrete'));
const cBarrierS = put(block('barrier', 0, 6, [3, 1.3, 0.6], 0, 'concrete'));
for (const g of [vec3(0, 0, -10.3), vec3(0, 0, 10.3), vec3(-10.3, 0, 0), vec3(10.3, 0, 0)]) seed(g);
patrol(0, 0, 0);
tag('courtyard', 'Central courtyard', [-10, 0, -10], [10, 4, 10]);
tag('crates-barriers', 'Courtyard props', [-10, 0, -10], [10, 4, 10]);
cover.push(
  coverAt(solids, cCrateNW, '-x', 'low'),
  coverAt(solids, cCrateSW, '+z', 'low'),
  coverAt(solids, cCrateNE, '+x', 'low'),
  coverAt(solids, cBarrierN, '+z', 'low'),
  coverAt(solids, cBarrierS, '-z', 'low'),
);

// 3. Building A (NW) with a walkable roof reached by a ramp (elevated-position).
const bldgA = put(box('building', [-26, 0, -26], [-13, 5.7, -16], 'plaster'));
put(box('floor', [-26, 5.7, -26], [-13, 6.0, -16], 'concrete'));
const railA = put(block('barrier', -20, -24, [3, 1.3, 0.6], 6.0, 'concrete'));
const rampA = ramp([-14.25, 0, -5], '-z', 11, 2.5, 6, 'concrete');
ramps.push(rampA);
seed(rampMid(rampA));
patrol(-20, 6, -20);
cover.push(coverAt(solids, railA, '+z', 'low'), coverAt(solids, bldgA, '+z', 'high', -22));
tag('elevated-position', 'Building A roof', [-26, 5, -26], [-13, 8, -16]);

// 4. Buildings B, C, D: 12 x 10 m blocks, 4.5 m high.
const bldgB = put(block('building', 20, -21, [12, 4.5, 10], 0, 'sandstone'));
const bldgC = put(block('building', -20, 21, [12, 4.5, 10], 0, 'sandstone'));
const bldgD = put(block('building', 20, 21, [12, 4.5, 10], 0, 'plaster'));
cover.push(
  coverAt(solids, bldgB, '-x', 'high'),
  coverAt(solids, bldgC, '+x', 'high'),
  coverAt(solids, bldgD, '-z', 'high'),
);

// 5. Market blocks with a 2.4 m alley on each side (narrow-corridor).
const w1 = put(box('building', [-40, 0, -8], [-30, 4.5, 8], 'sandstone'));
put(box('building', [-27.6, 0, -8], [-18, 4.5, 8], 'plaster'));
put(box('building', [18, 0, -8], [27.6, 4.5, 8], 'plaster'));
const e2 = put(box('building', [30, 0, -8], [40, 4.5, 8], 'sandstone'));
cover.push(coverAt(solids, w1, '-z', 'high', -35), coverAt(solids, e2, '+z', 'high', 35));
patrol(-28.8, 0, 0);
patrol(28.8, 0, 0);
tag('narrow-corridor', 'West alley', [-30, 0, -8], [-27.6, 4, 8]);
tag('narrow-corridor', 'East alley', [27.6, 0, -8], [30, 4, 8]);

// 6. Watchtowers: 6 x 6 m platforms at 3.5 m on four pillars, ramp, barrier rail.
function tower(sign: 1 | -1, label: string): void {
  const x0 = sign > 0 ? 28 : -34;
  const z0 = sign > 0 ? 28 : -34;
  put(box('platform', [x0, 3.2, z0], [x0 + 6, 3.5, z0 + 6], 'concrete'));
  for (const [px, pz] of [
    [x0, z0],
    [x0 + 5.6, z0],
    [x0, z0 + 5.6],
    [x0 + 5.6, z0 + 5.6],
  ] as const) {
    put(box('pillar', [px, 0, pz], [px + 0.4, 3.2, pz + 0.4], 'metal'));
  }
  const railZ = sign > 0 ? z0 + 5.4 : z0 + 0.6;
  const rail = put(block('barrier', x0 + 3, railZ, [3, 1.3, 0.6], 3.5, 'concrete'));
  const r = ramp([sign * 20, 0, sign * 30.25], sign > 0 ? '+x' : '-x', 8, 2.5, 3.5, 'concrete');
  ramps.push(r);
  seed(rampMid(r));
  patrol(x0 + 3, 3.5, z0 + 3);
  cover.push(coverAt(solids, rail, sign > 0 ? '-z' : '+z', 'low'));
  tag('elevated-position', label, [x0, 3, z0], [x0 + 6, 6, z0 + 6]);
}
tower(1, 'SE watchtower');
tower(-1, 'NW watchtower');

// 7. Dunes: a 1 m wide ground block 1.3 m high between two ramps (terrain).
function dune(cx: number, cz: number, along: 'x' | 'z'): void {
  if (along === 'z') {
    put(box('ground', [cx - 0.5, 0, cz - 6], [cx + 0.5, 1.3, cz + 6], 'sand'));
    ramps.push(ramp([cx - 3.75, 0, cz], '+x', 3.25, 12, 1.3, 'sand'));
    ramps.push(ramp([cx + 3.75, 0, cz], '-x', 3.25, 12, 1.3, 'sand'));
  } else {
    put(box('ground', [cx - 6, 0, cz - 0.5], [cx + 6, 1.3, cz + 0.5], 'sand'));
    ramps.push(ramp([cx, 0, cz - 3.75], '+z', 3.25, 12, 1.3, 'sand'));
    ramps.push(ramp([cx, 0, cz + 3.75], '-z', 3.25, 12, 1.3, 'sand'));
  }
  const last = ramps.length;
  for (const r of ramps.slice(last - 2)) seed(rampMid(r));
}
dune(0, -38, 'z');
dune(0, 38, 'z');
dune(-38, 20, 'x');
dune(38, -20, 'x');
tag('terrain', 'Dunes', [-HALF, 0, -HALF], [HALF, 4, HALF]);

// 8. Corner spawn pockets: 8 spawns each, screened by two 3 m walls with a diagonal opening.
function pocket(zone: string, sx: 1 | -1, sz: 1 | -1): void {
  const inner = 37.3; // centre line of the screen walls
  const xs = sx > 0 ? [40, HALF - 1] : [-(HALF - 1), -40];
  const zs = sz > 0 ? [40, HALF - 1] : [-(HALF - 1), -40];
  const screenX = put(...wallAlongZ(zs[0] ?? 0, zs[1] ?? 0, sx * inner, 0.6, 3, 'sandstone'));
  const screenZ = put(...wallAlongX(xs[0] ?? 0, xs[1] ?? 0, sz * inner, 0.6, 3, 'sandstone'));
  const origin = vec3(sx > 0 ? 38.75 : -46.25, 0, sz > 0 ? 42 : -44.5);
  const centre = { x: sx * 42.5, z: sz * 43.25 };
  spawns.push(...spawnGrid(zone, origin, 4, 2, 2.5, yawToward(centre, { x: 0, z: 0 }), [1, 6]));
  cover.push(
    coverAt(solids, screenX, sx > 0 ? '+x' : '-x', 'high', sz * 44.5),
    coverAt(solids, screenZ, sz > 0 ? '+z' : '-z', 'high', sx * 44.5),
  );
  patrol(sx * 38.5, 0, sz * 38.5);
  tag(
    'spawn-areas',
    `Spawn pocket ${zone}`,
    [Math.min(sx * 37, sx * 47), 0, Math.min(sz * 37, sz * 47)],
    [Math.max(sx * 37, sx * 47), 3, Math.max(sz * 37, sz * 47)],
  );
}
pocket('nw', -1, -1);
pocket('ne', 1, -1);
pocket('sw', -1, 1);
pocket('se', 1, 1);

// 9. Lane props: crates and barriers spread over the lanes (crates-barriers, low cover).
const laneCrates = [
  [-12, -40],
  [12, -40],
  [-12, 40],
  [12, 40],
] as const;
for (const [x, z] of laneCrates) {
  const i = put(crate(x, z, 0, 'wood'));
  cover.push(coverAt(solids, i, z < 0 ? '+z' : '-z', 'low'));
}
for (const [x, z] of [
  [-43, -20],
  [43, 20],
  [-35, 11],
  [35, -11],
  [-14, 3],
  [14, -3],
  [0, -22],
  [0, 22],
] as const) {
  put(crate(x, z, 0, 'wood'));
}
const laneBarriers = [
  put(block('barrier', -20, -38, [3, 1.3, 0.6], 0, 'concrete')),
  put(block('barrier', 20, 38, [3, 1.3, 0.6], 0, 'concrete')),
  put(block('barrier', -43.5, 0, [0.6, 1.3, 3], 0, 'concrete')),
  put(block('barrier', 43.5, 0, [0.6, 1.3, 3], 0, 'concrete')),
];
cover.push(
  coverAt(solids, laneBarriers[2] ?? 0, '+x', 'low'),
  coverAt(solids, laneBarriers[3] ?? 0, '-x', 'low'),
);

// 10. Patrol routes through the lanes (interconnected-paths).
patrol(-24, 0, -42);
patrol(24, 0, 42);
patrol(-43.5, 0, -10);
patrol(43.5, 0, 10);
tag('interconnected-paths', 'North lane', [-36, 0, -47], [36, 4, -37]);
tag('interconnected-paths', 'South lane', [-36, 0, 37], [36, 4, 47]);
tag('buildings-walls', 'Compound buildings', [-HALF, 0, -HALF], [HALF, 8, HALF]);
tag('cover', 'Cover across the compound', [-HALF, -1, -HALF], [HALF, TOP, HALF]);

const materials: MaterialHint[] = [
  {
    id: 'sand',
    pattern: 'noise',
    base: 0xd8b98a,
    accent: 0xc29d68,
    roughness: 0.95,
    metalness: 0,
    repeatM: 8,
  },
  {
    id: 'sandstone',
    pattern: 'blocks',
    base: 0xc8a26e,
    accent: 0xa8834f,
    roughness: 0.9,
    metalness: 0,
    repeatM: 4,
  },
  {
    id: 'plaster',
    pattern: 'noise',
    base: 0xe6d5b5,
    accent: 0xcdb892,
    roughness: 0.85,
    metalness: 0,
    repeatM: 3,
  },
  {
    id: 'wood',
    pattern: 'planks',
    base: 0x9a6b3d,
    accent: 0x6e4a27,
    roughness: 0.8,
    metalness: 0,
    repeatM: 1.25,
  },
  {
    id: 'concrete',
    pattern: 'noise',
    base: 0xb3aca1,
    accent: 0x948d83,
    roughness: 0.9,
    metalness: 0,
    repeatM: 3,
  },
  {
    id: 'metal',
    pattern: 'stripes',
    base: 0x7a7f86,
    accent: 0x5a5f66,
    roughness: 0.45,
    metalness: 0.8,
    repeatM: 1,
  },
];

export const DESERT_COMPOUND: MapDefinition = {
  id: 'desert-compound',
  name: 'Desert Compound',
  bounds: region([-HALF, -1, -HALF], [HALF, TOP, HALF]),
  solids,
  ramps,
  spawns,
  cover,
  navHints,
  features,
  materials,
  lighting: {
    sunDir: unit(-0.45, -0.75, -0.48),
    sunColour: 0xffe8c8,
    sunIntensity: 2.6,
    sunShadowBox: region([-HALF, -1, -HALF], [HALF, TOP, HALF]),
    hemiSky: 0xbfd8f0,
    hemiGround: 0xc9a877,
    hemiIntensity: 0.9,
    background: 0xcfe2f0,
    fog: { colour: 0xe9d8b8, near: 60, far: 170 },
    locals: [],
  },
};
