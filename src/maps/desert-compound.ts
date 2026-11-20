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
import { dressing, propSolids } from './props';
import type {
  CoverPoint,
  MapDefinition,
  MapFeatureTag,
  MaterialHint,
  NavHint,
  Ramp,
  Solid,
  SpawnPoint,
  BackdropItem,
  PropPlacement,
  ScatterRegion,
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
    pbr: 'sand',
  },
  {
    id: 'sandstone',
    pattern: 'blocks',
    base: 0xc8a26e,
    accent: 0xa8834f,
    roughness: 0.9,
    metalness: 0,
    repeatM: 4,
    pbr: 'sandstone',
  },
  {
    id: 'plaster',
    pattern: 'noise',
    base: 0xe6d5b5,
    accent: 0xcdb892,
    roughness: 0.85,
    metalness: 0,
    repeatM: 3,
    pbr: 'adobe',
  },
  {
    id: 'wood',
    pattern: 'planks',
    base: 0x9a6b3d,
    accent: 0x6e4a27,
    roughness: 0.8,
    metalness: 0,
    repeatM: 1.25,
    pbr: 'wood-planks',
  },
  {
    id: 'concrete',
    pattern: 'noise',
    base: 0xb3aca1,
    accent: 0x948d83,
    roughness: 0.9,
    metalness: 0,
    repeatM: 3,
    pbr: 'concrete',
  },
  {
    id: 'metal',
    pattern: 'stripes',
    base: 0x7a7f86,
    accent: 0x5a5f66,
    roughness: 0.45,
    metalness: 0.8,
    repeatM: 1,
    pbr: 'rust-metal',
  },
];

// Graphics uplift dressing (BR-G-20..35). Blocking props sit at least 3 m from spawns,
// cover points, hints and ramps, in open ground, so no route narrows below 2 m.
const PROPS: PropPlacement[] = [
  ['car-covered', -4, 0, 0, 1, 1],
  ['boulder-a', 43, 0, -33, 0, 1.8],
  ['boulder-a', 43, 0, 33, 1, 1.6],
  ['boulder-a', -33, 0, -43, 2, 1.9],
  ['boulder-b', -33, 0, 43, 0, 2.4],
  ['boulder-b', 7, 0, -43, 1, 2.6],
  ['boulder-b', 7, 0, 43, 3, 2.2],
  ['boulder-a', -43, 0, 12, 1, 1.5],
  ['log-dead', -30, 0, -14, 1, 1],
  ['barrel-rusty', 23, 0, -12, 0, 1.2],
  ['crate-military', -10, 0, 25, 0, 1.3],
  ['boulder-a', 29, 0, 12, 2, 1.5],
  ['crate-military', -8, 0, -24, 1, 1.3],
  ['boulder-b', 9, 0, 17, 0, 2],
  ['car-covered', 23, 0, -32, 1, 1],
  ['tyre-old', -6, 0, -11.4, 0, 1],
  ['cement-bag', 6.1, 0, -11.4, 1, 1],
  ['stones-small', -6, 0, 11.4, 2, 1],
  ['tyre-old', 6.1, 0, 9.2, 3, 1],
  ['cement-bag', -19.5, 0, -15.2, 0, 1],
  ['stones-small', 20, 0, -26.8, 1, 1],
  ['tyre-old', -20, 0, 26.8, 2, 1],
  ['tyre-old', -35, 0, 8.8, 3, 1],
  ['cement-bag', -22.8, 0, -8.8, 0, 1],
  ['stones-small', 22.8, 0, 8.8, 1, 1],
  ['tyre-old', 35, 0, -8.8, 2, 1],
  ['cement-bag', 33.8, 0, 27.2, 3, 1],
  ['stones-small', -28.2, 0, -34.8, 0, 1],
  ['tyre-old', -33.8, 0, -27.2, 1, 1],
];
solids.push(
  ...propSolids(
    PROPS,
    (kind) =>
      (({ rock: 'sandstone', debris: 'wood', vehicle: 'metal', structure: 'concrete' }) as const)[
        kind
      ],
  ),
);

const SCATTER: ScatterRegion[] = [
  {
    kind: 'grass-dry',
    region: region([-46, 0, -46], [46, 0.6, 46]),
    count: 600,
    seed: 11,
    scale: [0.9, 1.5],
  },
  {
    kind: 'shrub-dry',
    region: region([-46, 0, -46], [46, 0.6, 46]),
    count: 300,
    seed: 23,
    scale: [0.9, 1.3],
  },
  {
    kind: 'weed-low',
    region: region([-46, 0, -46], [46, 0.6, 46]),
    count: 220,
    seed: 37,
    scale: [1, 1.5],
  },
  {
    kind: 'branches-dry',
    region: region([-46, 0, -46], [46, 0.6, 46]),
    count: 60,
    seed: 41,
    scale: [0.9, 1.3],
  },
  {
    kind: 'stones-small',
    region: region([-46, 0, -46], [46, 0.6, 46]),
    count: 160,
    seed: 53,
    scale: [0.8, 1.3],
  },
];

const BACKDROP: BackdropItem[] = [
  { model: 'cliff', pos: vec3(91.9, 0, 4.8), yaw: 1.622, scale: 3.5 },
  { model: 'cliff', pos: vec3(58.5, 0, 74.4), yaw: 2.476, scale: 3.5 },
  { model: 'cliff', pos: vec3(6.9, 0, 97.1), yaw: 3.07, scale: 3.5 },
  { model: 'cliff', pos: vec3(-50.0, 0, 86.6), yaw: 3.665, scale: 3.5 },
  { model: 'cliff', pos: vec3(-100.7, 0, 19.8), yaw: 4.518, scale: 3.5 },
  { model: 'cliff', pos: vec3(-81.0, 0, -34.3), yaw: 5.113, scale: 3.5 },
  { model: 'cliff', pos: vec3(-28.3, 0, -86.2), yaw: 5.966, scale: 3.5 },
  { model: 'cliff', pos: vec3(25.6, 0, -89.8), yaw: 0.278, scale: 3.5 },
  { model: 'cliff', pos: vec3(73.5, 0, -61.7), yaw: 0.873, scale: 3.5 },
  { model: 'mountain', pos: vec3(125.0, 0, 0.0), yaw: 1.571, scale: 5.5 },
  { model: 'mountain', pos: vec3(58.0, 0, 113.0), yaw: 2.668, scale: 5.5 },
  { model: 'mountain', pos: vec3(-37.0, 0, 123.6), yaw: 3.432, scale: 5.5 },
  { model: 'mountain', pos: vec3(-128.8, 0, 23.9), yaw: 4.529, scale: 5.5 },
  { model: 'mountain', pos: vec3(-100.3, 0, -65.9), yaw: 5.294, scale: 5.5 },
  { model: 'mountain', pos: vec3(-27.1, 0, -118.9), yaw: 6.059, scale: 5.5 },
  { model: 'mountain', pos: vec3(95.0, 0, -79.7), yaw: 0.872, scale: 5.5 },
  { model: 'tree-quiver', pos: vec3(73.1, 0, 11.4), yaw: 1.726, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(61.0, 0, 41.8), yaw: 2.172, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(37.0, 0, 64.1), yaw: 2.618, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(-8.6, 0, 73.5), yaw: 3.258, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(-39.4, 0, 62.6), yaw: 3.704, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(-69.0, 0, 26.7), yaw: 4.344, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(-73.8, 0, -5.7), yaw: 4.79, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(-64.1, 0, -37.0), yaw: 5.236, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(-29.3, 0, -67.9), yaw: 5.876, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(2.9, 0, -73.9), yaw: 0.039, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(46.5, 0, -57.6), yaw: 0.679, scale: 3.6 },
  { model: 'tree-quiver', pos: vec3(66.8, 0, -31.9), yaw: 1.125, scale: 3.6 },
];

const DRESSING = dressing(PROPS, SCATTER, BACKDROP);

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
  dressing: DRESSING,
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
    atmosphere: {
      sky: 'desert-dusk',
      skyRotation: 0.6,
      exposure: 0.85,
      envIntensity: 0.55,
      fogExp2: { colour: 0xa8916f, density: 0.0125 },
      hemiScaleWithEnv: 0.45,
      sunScale: 0.7,
    },
  },
};
