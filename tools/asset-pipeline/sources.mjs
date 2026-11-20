/**
 * Source list for the offline asset pipeline. Every source is CC0:
 * Poly Haven (https://polyhaven.com/license) and Quaternius (CC0 1.0, LICENSE.txt in each pack).
 * Map ids: 'desert-compound' | 'industrial-warehouse'.
 */
const D = ['desert-compound'];
const W = ['industrial-warehouse'];
const ALL = 'all';

/** TextureSetKey -> Poly Haven texture id (BR-G-70: bc, n, orm at 1024 with full mips). */
export const TEXTURE_SETS = {
  sand: { ph: 'gravelly_sand', maps: D },
  sandstone: { ph: 'large_sandstone_blocks', maps: D },
  adobe: { ph: 'rough_plaster_brick_04', maps: D },
  'wood-planks': { ph: 'wooden_rough_planks', maps: ALL },
  concrete: { ph: 'preconcrete_wall_001', maps: ALL },
  'concrete-floor': { ph: 'worn_concrete_floor', maps: W },
  corrugated: { ph: 'corrugated_iron_02', maps: W },
  'rust-metal': { ph: 'rusty_metal_02', maps: ALL },
};

/** One tonemapped photo sky per map (FD-G-Q2). */
export const SKIES = {
  'desert-dusk': { ph: 'aarfontein_dusk', maps: D },
  'warehouse-storm': { ph: 'quarry_cloudy', maps: W },
};

/** ModelPackKey -> maps that fetch it. */
export const PACKS = {
  'props-common': { maps: ALL },
  'props-desert': { maps: D },
  'props-industrial': { maps: W },
  vegetation: { maps: ALL },
  backdrop: { maps: ALL },
};

/**
 * Props. kind 'visual' has no collision. lod0/lod1 are triangle targets. texPx is the colour
 * map size (normal and ORM ship at half). maxScale bounds placement scale (BR-G-21).
 */
export const PROPS = [
  // Blocking props (BR-G-20).
  {
    id: 'boulder-a',
    ph: 'namaqualand_boulder_02',
    pack: 'props-common',
    kind: 'rock',
    lod0: 3000,
    lod1: 600,
    texPx: 1024,
    maxScale: 2.2,
  },
  {
    id: 'boulder-b',
    ph: 'namaqualand_boulder_05',
    pack: 'props-common',
    kind: 'rock',
    lod0: 2400,
    lod1: 500,
    texPx: 1024,
    maxScale: 3,
  },
  {
    id: 'barrel-rusty',
    ph: 'Barrel_01',
    pack: 'props-common',
    kind: 'debris',
    lod0: 1200,
    lod1: 300,
    texPx: 512,
    maxScale: 1.3,
  },
  {
    id: 'barrel-blue',
    ph: 'barrel_03',
    pack: 'props-industrial',
    kind: 'debris',
    lod0: 1000,
    lod1: 250,
    texPx: 512,
    maxScale: 1.3,
  },
  {
    id: 'crate-military',
    ph: 'wooden_military_crate',
    pack: 'props-common',
    kind: 'debris',
    lod0: 1500,
    lod1: 300,
    texPx: 512,
    maxScale: 1.4,
  },
  {
    id: 'car-covered',
    ph: 'covered_car',
    pack: 'props-desert',
    kind: 'vehicle',
    lod0: 5000,
    lod1: 1200,
    texPx: 1024,
    maxScale: 1,
  },
  {
    id: 'road-barrier',
    ph: 'concrete_road_barrier_02',
    pack: 'props-industrial',
    kind: 'structure',
    lod0: 1500,
    lod1: 300,
    texPx: 512,
    maxScale: 1.2,
  },
  {
    id: 'utility-box',
    ph: 'utility_box_02',
    pack: 'props-industrial',
    kind: 'structure',
    lod0: 1200,
    lod1: 300,
    texPx: 512,
    maxScale: 1.3,
  },
  {
    id: 'generator',
    ph: 'portable_generator',
    pack: 'props-industrial',
    kind: 'debris',
    lod0: 2500,
    lod1: 600,
    texPx: 512,
    maxScale: 1.4,
  },
  {
    id: 'log-dead',
    ph: 'dead_tree_trunk_02',
    pack: 'props-desert',
    kind: 'debris',
    lod0: 2500,
    lod1: 600,
    texPx: 1024,
    maxScale: 1.2,
  },
  // Visual-only debris.
  {
    id: 'tyre-old',
    ph: 'old_tyre',
    pack: 'props-common',
    kind: 'visual',
    lod0: 600,
    lod1: 150,
    texPx: 512,
  },
  {
    id: 'cement-bag',
    ph: 'cement_bag',
    pack: 'props-common',
    kind: 'visual',
    lod0: 400,
    lod1: 100,
    texPx: 512,
  },
  {
    id: 'wheel-rim',
    ph: 'rusted_wheel_rim_01',
    pack: 'props-industrial',
    kind: 'visual',
    lod0: 500,
    lod1: 120,
    texPx: 512,
  },
  {
    id: 'cardboard-box',
    ph: 'cardboard_box_01',
    pack: 'props-industrial',
    kind: 'visual',
    lod0: 400,
    lod1: 100,
    texPx: 512,
  },
  {
    id: 'propane-tank',
    ph: 'propane_tank',
    pack: 'props-industrial',
    kind: 'visual',
    lod0: 600,
    lod1: 150,
    texPx: 512,
  },
  {
    id: 'stones-small',
    ph: 'rock_07',
    pack: 'props-common',
    kind: 'visual',
    lod0: 300,
    lod1: 80,
    texPx: 512,
    scale: 3,
  },
  // Vegetation (visual only, BR-G-30).
  {
    id: 'grass-dry',
    ph: 'grass_medium_01',
    pack: 'vegetation',
    kind: 'visual',
    lod0: 600,
    lod1: 120,
    texPx: 512,
    dryDiffuse: true,
    maxScale: 1.6,
  },
  {
    id: 'shrub-dry',
    ph: 'shrub_03',
    pack: 'vegetation',
    kind: 'visual',
    lod0: 500,
    lod1: 120,
    texPx: 512,
    maxScale: 1.4,
  },
  {
    id: 'weed-low',
    ph: 'weed_plant_02',
    pack: 'vegetation',
    kind: 'visual',
    lod0: 400,
    lod1: 100,
    texPx: 512,
    maxScale: 1.5,
  },
  {
    id: 'branches-dry',
    ph: 'dry_branches_medium_01',
    pack: 'vegetation',
    kind: 'visual',
    lod0: 500,
    lod1: 120,
    texPx: 512,
    maxScale: 1.3,
  },
  // Backdrop (outside the play space, no shadows, BR-G-33).
  {
    id: 'cliff',
    ph: 'namaqualand_cliff_02',
    pack: 'backdrop',
    kind: 'visual',
    lod0: 4000,
    lod1: 1200,
    texPx: 1024,
    maxScale: 4,
  },
  {
    id: 'mountain',
    ph: 'mountainside',
    pack: 'backdrop',
    kind: 'visual',
    lod0: 3500,
    lod1: 1000,
    texPx: 1024,
    maxScale: 6,
  },
  {
    id: 'tree-quiver',
    ph: 'quiver_tree_01',
    pack: 'backdrop',
    kind: 'visual',
    lod0: 3000,
    lod1: 800,
    texPx: 512,
    maxScale: 3,
  },
];

/**
 * First-person viewmodels (BR-G-40): muzzle at the rig socket (y, z) used by viewmodel.ts,
 * barrel along -z after `rot`, scaled to `length` metres along z.
 */
export const WEAPONS = [
  {
    key: 'vm-rifle',
    obj: {
      name: 'AssaultRifle_1',
      objId: '1CyEzGioyY2r7SENNA5xokzeAzj67pYn_',
      mtlId: '1q0oAOdZb2ocANLbZ6hwJdqRDt7YOoENV',
    },
    length: 0.82,
    muzzle: [0, 0.015, -0.56],
    maxTriangles: 15000,
  },
  {
    key: 'vm-pistol',
    obj: {
      name: 'Pistol_1',
      objId: '1lqYq-BW8aDEiKZHnU5YIftXHg8UUVADD',
      mtlId: '1M9Z3BexNj8tuT10ZRHmksWr03YMhedy6',
    },
    length: 0.22,
    muzzle: [0, 0.02, -0.19],
    maxTriangles: 15000,
  },
  {
    key: 'vm-sniper',
    obj: {
      name: 'SniperRifle_1',
      objId: '1HUfH1-p4b9cnofdMd6bRVRfZUS8ElLvd',
      mtlId: '1eXwBtGksdFNPE8DfSNTZUwEL0iztU8tY',
    },
    length: 1.05,
    muzzle: [0, 0.015, -0.75],
    maxTriangles: 15000,
  },
];

/** Skinned bot character (RA-G1): Quaternius Ultimate Animated Character Pack, Soldier_Male. */
export const BOT = {
  key: 'bot-soldier',
  gltf: { name: 'Soldier_Male.gltf', id: '1M8zMy1xhcy79cg2naHZ9rLH9HnokNBjd' },
  rifle: {
    name: 'AssaultRifle_1',
    objId: '1CyEzGioyY2r7SENNA5xokzeAzj67pYn_',
    mtlId: '1q0oAOdZb2ocANLbZ6hwJdqRDt7YOoENV',
  },
  heightM: 1.8,
  lod0: 5000,
  lod1: 2000,
  clips: { Idle: 'idle', Walk: 'walk', Run: 'run', Shoot_OneHanded: 'shoot', Death: 'death' },
};
