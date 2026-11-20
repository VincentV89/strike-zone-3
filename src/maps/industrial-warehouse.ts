/**
 * Map 2: Industrial Warehouse (req-map-industrial-warehouse). 88 x 64 m,
 * origin at the centre, north is -Z. A roofed hall in the middle with a
 * mezzanine walkway, a control loft and a storage area; a container yard to
 * the north with an open patch; service corridors on both sides; a back lane
 * to the south. Five spawn zones of 7 spawns each.
 *
 * Private module: consumers import src/maps/index.ts only (SEC-M-03).
 */
import { vec3, type Vec3 } from '../core';
import {
  block,
  box,
  container,
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
  LocalLight,
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

const HX = 44;
const HZ = 32;
const TOP = 14;

const solids: Solid[] = [];
const ramps: Ramp[] = [];
const spawns: SpawnPoint[] = [];
const cover: CoverPoint[] = [];
const navHints: NavHint[] = [];
const features: MapFeatureTag[] = [];

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
type P3 = readonly [number, number, number];
const tag = (feature: MapFeatureTag['feature'], label: string, min: P3, max: P3): void => {
  features.push({ feature, label, region: region(min, max) });
};

// 1. Floor and yard wall (BR-M-10, BR-M-11): 1 m thick, 8 m high.
put(box('ground', [-HX, -1, -HZ], [HX, 0, HZ], 'floor-concrete'));
put(
  box('boundary', [-HX, 0, -HZ], [-HX + 1, 8, HZ], 'concrete-wall'),
  box('boundary', [HX - 1, 0, -HZ], [HX, 8, HZ], 'concrete-wall'),
  box('boundary', [-HX, 0, -HZ], [HX, 8, -HZ + 1], 'concrete-wall'),
  box('boundary', [-HX, 0, HZ - 1], [HX, 8, HZ], 'concrete-wall'),
);

// 2. Hall shell: walls 0.5 m thick, 10 m high, outer box x -30.5..30.5, z -8.5..26.5; roof slab at 10 m.
const loading = [-18, 0, 18].map((at) => ({ at, width: 4, height: 4.5 }));
const sideDoors = [4, 18].map((at) => ({ at, width: 2, height: 2.6 }));
put(...wallAlongX(-30.5, 30.5, -8.25, 0.5, 10, 'concrete-wall', loading));
const southWall = put(
  ...wallAlongX(-30.5, 30.5, 26.25, 0.5, 10, 'concrete-wall', [{ at: 0, width: 3, height: 3 }]),
);
put(...wallAlongZ(-8, 26, -30.25, 0.5, 10, 'concrete-wall', sideDoors));
put(...wallAlongZ(-8, 26, 30.25, 0.5, 10, 'concrete-wall', sideDoors));
put(box('roof', [-30.5, 10, -8.5], [30.5, 10.4, 26.5], 'roof-metal'));
for (const x of [-18, 0, 18]) seed(vec3(x, 0, -8.25));
seed(vec3(0, 0, 26.25));
for (const z of [4, 18]) {
  seed(vec3(-30.25, 0, z));
  seed(vec3(30.25, 0, z));
}
tag('warehouse-interior', 'Main hall', [-30.5, 0, -8.5], [30.5, 10.4, 26.5]);
// The south wall's two spans give high cover to the back lane.
cover.push(
  coverAt(solids, southWall, '+z', 'high', -10),
  coverAt(solids, southWall + 1, '+z', 'high', 10),
);

// 3. Side blocks and service corridors (2.5 m wide).
put(box('building', [-43, 0, -4], [-33, 6, 26], 'concrete-wall'));
put(box('building', [33, 0, -4], [43, 6, 26], 'concrete-wall'));
patrol(-31.75, 0, 11);
patrol(31.75, 0, 11);
tag('narrow-corridor', 'West service corridor', [-33, 0, -3], [-30.5, 3, 25]);
tag('narrow-corridor', 'East service corridor', [30.5, 0, -3], [33, 3, 25]);
tag('multiple-routes', 'West service corridor', [-33, 0, -3], [-30.5, 3, 25]);
tag('multiple-routes', 'East service corridor', [30.5, 0, -3], [33, 3, 25]);
tag('multiple-routes', 'Back lane', [-30, 0, 26.5], [30, 3, 31]);
patrol(-15, 0, 28.75);

// 4. Container yard (north) with an open patch in the middle.
const a1 = put(container(-22, -24, 'x', 12.19, 0, 'container-red'));
put(container(-22, -24, 'x', 12.19, 1, 'container-blue'));
put(container(-22, -15.5, 'x', 12.19, 0, 'container-green'));
put(container(-22, -15.5, 'x', 12.19, 1, 'container-orange'));
const b1 = put(container(22, -24, 'x', 12.19, 0, 'container-blue'));
put(container(22, -24, 'x', 12.19, 1, 'container-red'));
put(container(22, -15.5, 'x', 12.19, 0, 'container-orange'));
const a3 = put(container(-36, -16, 'z', 6.06, 0, 'container-green'));
const b3 = put(container(36, -16, 'z', 6.06, 0, 'container-red'));
const o1 = put(container(-5, -20, 'z', 6.06, 0, 'container-orange'));
const o2 = put(container(5, -20, 'z', 6.06, 0, 'container-blue'));
const openCrateS = put(crate(0, -26, 0, 'wood'));
const openCrateN = put(crate(0, -14, 0, 'wood'));
const yardCrateW = put(crate(-30, -12, 0, 'wood'));
const yardCrateE = put(crate(30, -12, 0, 'wood'));
cover.push(
  coverAt(solids, a1, '-x', 'high'),
  coverAt(solids, a3, '-z', 'high'),
  coverAt(solids, b1, '+x', 'high'),
  coverAt(solids, b3, '-z', 'high'),
  coverAt(solids, o1, '-x', 'high'),
  coverAt(solids, o2, '+x', 'high'),
  coverAt(solids, openCrateS, '-z', 'low'),
  coverAt(solids, openCrateN, '+z', 'low'),
  coverAt(solids, yardCrateW, '-z', 'low'),
  coverAt(solids, yardCrateE, '-z', 'low'),
);
patrol(-36, 0, -24);
patrol(36, 0, -24);
patrol(-22, 0, -20);
patrol(22, 0, -20);
patrol(0, 0, -20);
tag('open-area', 'North yard', [-10, 0, -30], [10, 3, -10]);
tag('shipping-containers', 'Container yard and hall rows', [-43, 0, -31], [43, 6, 26]);

// 5. Hall interior: two container rows (12.19 m, 3.3 m gaps), one double stack per row.
const c1 = put(container(-4, 3.22, 'x', 12.19, 0, 'container-red'));
const c2 = put(container(11.5, 3.22, 'x', 12.19, 0, 'container-green'));
put(container(11.5, 3.22, 'x', 12.19, 1, 'container-blue'));
const c3 = put(container(-4, 10.22, 'x', 12.19, 0, 'container-orange'));
put(container(-4, 10.22, 'x', 12.19, 1, 'container-red'));
const c4 = put(container(11.5, 10.22, 'x', 12.19, 0, 'container-blue'));
const hallCrateW = put(crate(-20, 1, 0, 'wood'));
const hallCrateN = put(crate(-15, -4, 0, 'wood'));
const hallCrateE = put(crate(24, 10, 0, 'wood'));
const hazardW = put(block('barrier', 0, 18, [3, 1.3, 0.6], 0, 'hazard'));
const hazardE = put(block('barrier', 10, 18, [3, 1.3, 0.6], 0, 'hazard'));
cover.push(
  coverAt(solids, c1, '-x', 'high'),
  coverAt(solids, c1, '-z', 'high'),
  coverAt(solids, c2, '+x', 'high'),
  coverAt(solids, c3, '-x', 'high'),
  coverAt(solids, c4, '+z', 'high', 14),
  coverAt(solids, c4, '+x', 'high'),
  coverAt(solids, hallCrateW, '-z', 'low'),
  coverAt(solids, hallCrateN, '+z', 'low'),
  coverAt(solids, hallCrateE, '-x', 'low'),
  coverAt(solids, hazardW, '-z', 'low'),
  coverAt(solids, hazardE, '-z', 'low'),
);
patrol(3, 0, 6.72);

// 6. Storage area: six racks 8 m long, 1.2 m deep, 4 m high; 2.2 m aisles.
let firstRack = -1;
for (const x of [-27, -17]) {
  for (const z of [13.5, 16.9, 20.3]) {
    const i = put(box('rack', [x, 0, z], [x + 8, 4, z + 1.2], 'steel'));
    if (firstRack < 0) firstRack = i;
  }
}
cover.push(coverAt(solids, firstRack, '-z', 'high', -23));
patrol(-23, 0, 15.8);
tag('storage-area', 'Rack storage', [-27, 0, 13.5], [-9, 5, 21.5]);

// 7. Mezzanine walkways at 4 m on pillars, the control loft and their ramps.
put(box('walkway', [-12, 3.7, 23], [30, 4.0, 26], 'steel'));
put(box('walkway', [27, 3.7, 0], [30, 4.0, 23], 'steel'));
for (const x of [-6, 0, 6, 12, 18, 24])
  put(box('pillar', [x, 0, 23], [x + 0.4, 3.7, 23.4], 'steel'));
for (const z of [6, 12, 18]) put(box('pillar', [27, 0, z], [27.4, 3.7, z + 0.4], 'steel'));
put(box('platform', [22, 3.7, -8], [30, 4.0, 0], 'steel'));
put(box('pillar', [22, 0, -7.6], [22.4, 3.7, -7.2], 'steel'));
put(box('pillar', [22, 0, -0.4], [22.4, 3.7, 0], 'steel'));
const loftRail = put(block('barrier', 22.6, -5, [0.6, 1.3, 3], 4.0, 'hazard'));
cover.push(coverAt(solids, loftRail, '+x', 'low'));
const r1 = ramp([-20, 0, 24.5], '+x', 8, 3, 4.0, 'steel');
const r2 = ramp([14, 0, -1.75], '+x', 8, 2.5, 4.0, 'steel');
ramps.push(r1, r2);
seed(rampMid(r1));
seed(rampMid(r2));
patrol(26, 4, -4);
patrol(5, 4, 24.5);
patrol(28.5, 4, 12);
tag('walkway', 'Mezzanine', [-12, 3, 0], [30, 6, 26]);
tag('elevated-platform', 'Control loft', [22, 3, -8], [30, 6, 0]);
tag('cover', 'Cover across the warehouse', [-HX, -1, -HZ], [HX, TOP, HZ]);

// 8. Spawn zones: 7 spawns each, 2 player-eligible.
const centre = { x: 0, z: 9 };
function zone(name: string, origin: Vec3, label: string, min: P3, max: P3): void {
  const mid = { x: origin.x + 3.75, z: origin.z + 1.25 };
  spawns.push(...spawnGrid(name, origin, 4, 2, 2.5, yawToward(mid, centre), [0, 5], 7));
  tag('spawn-areas', label, min, max);
}
zone('yard-w', vec3(-41.75, 0, -29), 'Yard west', [-43, 0, -31], [-33, 3, -25]);
zone('yard-e', vec3(34.25, 0, -29), 'Yard east', [33, 0, -31], [43, 3, -25]);
zone('hall-sw', vec3(-28, 0, 4.5), 'Hall south-west', [-29, 0, 4], [-20, 3, 8]);
zone('hall-se', vec3(16.25, 0, 16.5), 'Hall south-east', [16, 0, 16], [24, 3, 20]);
zone('back-lane', vec3(-3.75, 0, 27.5), 'Back lane', [-4.5, 0, 27], [4.5, 3, 30.5]);
patrol(-24, 0, 10);
patrol(20, 0, 21);

const pointLights: LocalLight[] = [-20, 0, 20].flatMap((x) =>
  [2, 18].map((z) => ({
    kind: 'point' as const,
    pos: vec3(x, 9, z),
    colour: 0xfff1d6,
    intensity: 1.2,
    range: 22,
    shadow: false,
  })),
);

const materials: MaterialHint[] = [
  {
    id: 'floor-concrete',
    pattern: 'tiles',
    base: 0x8e8b86,
    accent: 0x77746f,
    roughness: 0.9,
    metalness: 0,
    repeatM: 4,
    pbr: 'concrete-floor',
  },
  {
    id: 'concrete-wall',
    pattern: 'blocks',
    base: 0xa4a19b,
    accent: 0x86837d,
    roughness: 0.9,
    metalness: 0,
    repeatM: 3,
    pbr: 'concrete',
  },
  {
    id: 'roof-metal',
    pattern: 'corrugated',
    base: 0x6f7780,
    accent: 0x59616a,
    roughness: 0.5,
    metalness: 0.7,
    repeatM: 2,
    pbr: 'corrugated',
  },
  {
    id: 'container-red',
    pattern: 'corrugated',
    base: 0x9e3b2f,
    accent: 0x7a2c23,
    roughness: 0.6,
    metalness: 0.5,
    repeatM: 1.2,
    pbr: 'corrugated',
    pbrTint: true,
  },
  {
    id: 'container-blue',
    pattern: 'corrugated',
    base: 0x2f5a8e,
    accent: 0x23446c,
    roughness: 0.6,
    metalness: 0.5,
    repeatM: 1.2,
    pbr: 'corrugated',
    pbrTint: true,
  },
  {
    id: 'container-green',
    pattern: 'corrugated',
    base: 0x3c7a4a,
    accent: 0x2d5c38,
    roughness: 0.6,
    metalness: 0.5,
    repeatM: 1.2,
    pbr: 'corrugated',
    pbrTint: true,
  },
  {
    id: 'container-orange',
    pattern: 'corrugated',
    base: 0xc7742a,
    accent: 0x9b5920,
    roughness: 0.6,
    metalness: 0.5,
    repeatM: 1.2,
    pbr: 'corrugated',
    pbrTint: true,
  },
  {
    id: 'steel',
    pattern: 'stripes',
    base: 0x5d6670,
    accent: 0x464e57,
    roughness: 0.45,
    metalness: 0.85,
    repeatM: 1,
    pbr: 'rust-metal',
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
    id: 'hazard',
    pattern: 'stripes',
    base: 0xe8c22a,
    accent: 0x1c1c1c,
    roughness: 0.7,
    metalness: 0.1,
    repeatM: 0.8,
  },
];

// Graphics uplift dressing (BR-G-20..35). Blocking props sit at least 3 m from spawns,
// cover points, hints and ramps, in open ground, so no route narrows below 2 m.
const PROPS: PropPlacement[] = [
  ['road-barrier', -4, 0, -12, 0, 1],
  ['utility-box', 39, 0, -8, 2, 1.2],
  ['utility-box', -39, 0, -8, 2, 1.2],
  ['barrel-blue', 12, 0, -27, 0, 1.1],
  ['generator', -12, 0, -27, 1, 1.3],
  ['road-barrier', 11, 0, -12, 0, 1],
  ['barrel-rusty', -12, 0, -17, 0, 1.1],
  ['crate-military', -4, 0, -27, 0, 1.3],
  ['barrel-blue', 4, 0, -27, 0, 1.1],
  ['generator', 10, 0, -16, 0, 1.3],
  ['cardboard-box', -25.2, 0, -9.3, 0, 1],
  ['propane-tank', -9, 0, -9.3, 1, 1],
  ['wheel-rim', 9, 0, -9.3, 2, 1],
  ['tyre-old', 25.3, 0, -9.3, 3, 1],
  ['cardboard-box', 16, 0, 27.3, 0, 1],
  ['propane-tank', -30.2, 0, 26.8, 1, 1],
  ['cardboard-box', 30.3, 0, 26.8, 2, 1],
  ['propane-tank', -38, 0, -4.8, 3, 1],
  ['wheel-rim', 38, 0, -4.8, 0, 1],
  ['tyre-old', -38, 0, 26.8, 1, 1],
  ['cardboard-box', 38, 0, 26.8, 2, 1],
  ['propane-tank', -36, 0, -12.2, 3, 1],
  ['cardboard-box', 36, 0, -12.2, 0, 1],
];
solids.push(
  ...propSolids(
    PROPS,
    (kind) =>
      (
        ({
          rock: 'concrete-wall',
          debris: 'wood',
          vehicle: 'steel',
          structure: 'concrete-wall',
        }) as const
      )[kind],
  ),
);

const SCATTER: ScatterRegion[] = [
  {
    kind: 'weed-low',
    region: region([-43, 0, -31], [43, 0.6, 31]),
    count: 320,
    seed: 13,
    scale: [1, 1.5],
  },
  {
    kind: 'grass-dry',
    region: region([-43, 0, -31], [43, 0.6, 31]),
    count: 260,
    seed: 29,
    scale: [0.8, 1.3],
  },
  {
    kind: 'stones-small',
    region: region([-43, 0, -31], [43, 0.6, 31]),
    count: 160,
    seed: 31,
    scale: [0.8, 1.3],
  },
  {
    kind: 'branches-dry',
    region: region([-43, 0, -31], [43, 0.6, 31]),
    count: 60,
    seed: 47,
    scale: [0.9, 1.2],
  },
];

const BACKDROP: BackdropItem[] = [
  { model: 'cliff', pos: vec3(94.5, 0, 16.7), yaw: 1.745, scale: 3.8 },
  { model: 'cliff', pos: vec3(65.6, 0, 73.7), yaw: 2.414, scale: 3.8 },
  { model: 'cliff', pos: vec3(-19.4, 0, 81.7), yaw: 3.374, scale: 3.8 },
  { model: 'cliff', pos: vec3(-68.0, 0, 53.8), yaw: 4.043, scale: 3.8 },
  { model: 'cliff', pos: vec3(-89.3, 0, 0.0), yaw: 4.712, scale: 3.8 },
  { model: 'cliff', pos: vec3(-52.8, 0, -75.4), yaw: 5.672, scale: 3.8 },
  { model: 'cliff', pos: vec3(5.5, 0, -94.5), yaw: 0.058, scale: 3.8 },
  { model: 'cliff', pos: vec3(82.8, 0, -51.1), yaw: 1.018, scale: 3.8 },
  { model: 'mountain', pos: vec3(120.2, 0, 24.3), yaw: 1.77, scale: 6 },
  { model: 'mountain', pos: vec3(71.3, 0, 102.7), yaw: 2.535, scale: 6 },
  { model: 'mountain', pos: vec3(-59.9, 0, 112.3), yaw: 3.632, scale: 6 },
  { model: 'mountain', pos: vec3(-123.2, 0, 40.3), yaw: 4.396, scale: 6 },
  { model: 'mountain', pos: vec3(-118.9, 0, -57.3), yaw: 5.161, scale: 6 },
  { model: 'mountain', pos: vec3(-3.0, 0, -119.1), yaw: 6.258, scale: 6 },
  { model: 'mountain', pos: vec3(81.9, 0, -89.8), yaw: 0.74, scale: 6 },
];

const DRESSING = dressing(PROPS, SCATTER, BACKDROP);

export const INDUSTRIAL_WAREHOUSE: MapDefinition = {
  id: 'industrial-warehouse',
  name: 'Industrial Warehouse',
  bounds: region([-HX, -1, -HZ], [HX, TOP, HZ]),
  solids,
  ramps,
  spawns,
  cover,
  navHints,
  features,
  materials,
  dressing: DRESSING,
  lighting: {
    sunDir: unit(0.35, -0.8, 0.48),
    sunColour: 0xfff4e0,
    sunIntensity: 2.2,
    sunShadowBox: region([-HX, -1, -HZ], [HX, TOP, HZ]),
    hemiSky: 0xa9b8c8,
    hemiGround: 0x55524c,
    hemiIntensity: 0.8,
    background: 0xb7c4d0,
    fog: null,
    locals: [
      ...pointLights,
      {
        kind: 'spot',
        pos: vec3(0, 9.8, 8),
        target: vec3(0, 0, 8),
        colour: 0xffffff,
        intensity: 3,
        range: 24,
        shadow: true,
      },
    ],
    atmosphere: {
      sky: 'warehouse-storm',
      skyRotation: 2.2,
      exposure: 0.8,
      envIntensity: 0.5,
      fogExp2: { colour: 0x6c737c, density: 0.013 },
      hemiScaleWithEnv: 0.5,
      sunScale: 0.55,
    },
  },
};
