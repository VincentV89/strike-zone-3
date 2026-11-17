/**
 * Map schema owned by map-data (FD-M-01). Consumers import these types through
 * src/maps/index.ts only (SEC-M-03). All entities are immutable value data;
 * identity inside a list is the array index (solids[i] matches RayHit.solidIndex).
 */
import type { AABB, Vec3 } from '../core';
import type { MapId } from '../contracts';

/** Index into MapDefinition.solids. Equals RayHit.solidIndex. */
export type SolidIndex = number;
/** Index into MapDefinition.spawns. */
export type SpawnIndex = number;
/** Index into MapDefinition.cover. */
export type CoverIndex = number;

/**
 * What a solid is. Behaviour that depends on kind (walkable top, shadow casting,
 * which checklist features it can back) is derived from this table, never from
 * extra flags (BR-M-20).
 */
export type SolidKind =
  | 'ground' // the floor slab and terrain blocks; walkable top
  | 'floor' // a walkable slab on top of a building or inside the hall
  | 'platform' // elevated walkable slab (watchtower, control loft)
  | 'walkway' // long narrow elevated walkable slab (mezzanine)
  | 'boundary' // perimeter wall; never walkable
  | 'wall' // free-standing wall segment or lintel
  | 'building' // solid building block
  | 'roof' // warehouse roof slab; blocks sight, never walkable
  | 'pillar'
  | 'crate'
  | 'barrier' // low concrete or hazard barrier
  | 'container' // ISO shipping container
  | 'rack'; // storage rack

export interface Solid {
  readonly kind: SolidKind;
  readonly box: Readonly<AABB>;
  /** MaterialHint.id; must exist in MapDefinition.materials. */
  readonly material: string;
}

/** The horizontal direction in which the ramp surface rises. */
export type RampUp = '+x' | '-x' | '+z' | '-z';

/**
 * A solid wedge. Its footprint is the xz rectangle; the walkable surface rises
 * linearly from baseY at the low edge to topY at the high edge, which is the
 * edge facing `up`. The wedge below the surface is solid for movement, sight
 * and shots (req-collision-world).
 */
export interface Ramp {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly baseY: number;
  readonly topY: number;
  readonly up: RampUp;
  readonly material: string;
}

export interface SpawnPoint {
  /** Feet position: the bottom of the capsule, standing on a walkable top. */
  readonly pos: Readonly<Vec3>;
  /** Initial facing, radians; yaw 0 faces -Z (FD-F-10). */
  readonly yaw: number;
  /** Spawn-area name, for example 'nw' or 'yard-e'. */
  readonly zone: string;
  /** True if game-simulation may place the player here. Every spawn is bot-eligible. */
  readonly player: boolean;
}

export type CoverHeight = 'low' | 'high';

export interface CoverPoint {
  /** Feet position of a bot standing or crouching behind the cover. */
  readonly pos: Readonly<Vec3>;
  /** Unit vector in the xz plane (y = 0) from pos toward the covering solid. Threats on this side are blocked. */
  readonly facing: Readonly<Vec3>;
  /** 'low' = crouch cover (top 1.25 to 1.6 m above pos.y); 'high' = full cover (top at least 2.0 m above pos.y). */
  readonly height: CoverHeight;
  /** The solid that provides the cover. */
  readonly solid: SolidIndex;
}

export type NavHint =
  /** A patrol destination; game-simulation maps these to nav nodes for bot Patrol. */
  | { readonly kind: 'patrol'; readonly pos: Readonly<Vec3> }
  /** Forces the baker to sample a node here (ramp middles, platform tops, doorways). */
  | { readonly kind: 'seed'; readonly pos: Readonly<Vec3> }
  /** The baker creates no nodes inside this box (a walkable top that is not meant to be reached). */
  | { readonly kind: 'exclude'; readonly region: Readonly<AABB> };

export type MapFeature =
  // Desert Compound (req-map-desert-compound)
  | 'terrain'
  | 'buildings-walls'
  | 'interconnected-paths'
  | 'narrow-corridor'
  | 'courtyard'
  | 'crates-barriers'
  | 'elevated-position'
  | 'cover'
  | 'spawn-areas'
  // Industrial Warehouse (req-map-industrial-warehouse)
  | 'warehouse-interior'
  | 'shipping-containers'
  | 'storage-area'
  | 'walkway'
  | 'elevated-platform'
  | 'open-area'
  | 'multiple-routes';

export interface MapFeatureTag {
  readonly feature: MapFeature;
  /** Where the feature is. The backing rules in BR-M-63 read this box. */
  readonly region: Readonly<AABB>;
  /** Short label for test output and the verification evidence list, for example 'Building A roof'. */
  readonly label: string;
}

export type MaterialPattern =
  'noise' | 'blocks' | 'planks' | 'corrugated' | 'stripes' | 'tiles' | 'plain';

/** A recipe the renderer turns into a procedural CanvasTexture. No image files exist (req-original-assets). */
export interface MaterialHint {
  readonly id: string;
  readonly pattern: MaterialPattern;
  /** 0xRRGGBB */
  readonly base: number;
  /** 0xRRGGBB, second colour for the pattern */
  readonly accent: number;
  /** 0..1 */
  readonly roughness: number;
  /** 0..1 */
  readonly metalness: number;
  /** World-space metres covered by one texture repeat. */
  readonly repeatM: number;
}

export interface LocalLight {
  readonly kind: 'point' | 'spot';
  readonly pos: Readonly<Vec3>;
  /** Spot lights only: the point the cone aims at. */
  readonly target?: Readonly<Vec3>;
  readonly colour: number;
  readonly intensity: number;
  /** metres */
  readonly range: number;
  readonly shadow: boolean;
}

export interface LightingDef {
  /** Unit vector pointing from the sun toward the scene (y < 0). */
  readonly sunDir: Readonly<Vec3>;
  readonly sunColour: number;
  readonly sunIntensity: number;
  /** Shadow camera bounds; the renderer fits the directional shadow map to this box. */
  readonly sunShadowBox: Readonly<AABB>;
  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly hemiIntensity: number;
  readonly background: number;
  readonly fog: { readonly colour: number; readonly near: number; readonly far: number } | null;
  readonly locals: readonly LocalLight[];
}

export interface MapDefinition {
  readonly id: MapId;
  /** Display name: 'Desert Compound' or 'Industrial Warehouse'. */
  readonly name: string;
  /** Encloses every solid, ramp, spawn, cover point, hint, tag and local light. */
  readonly bounds: Readonly<AABB>;
  readonly solids: readonly Solid[];
  readonly ramps: readonly Ramp[];
  readonly spawns: readonly SpawnPoint[];
  readonly cover: readonly CoverPoint[];
  readonly navHints: readonly NavHint[];
  readonly features: readonly MapFeatureTag[];
  readonly lighting: LightingDef;
  readonly materials: readonly MaterialHint[];
}

export type MapDataIssueCode =
  | 'maps/non-finite'
  | 'maps/out-of-bounds'
  | 'maps/ground-gap'
  | 'maps/boundary-gap'
  | 'maps/boundary-too-low'
  | 'maps/budget-exceeded'
  | 'maps/unknown-material'
  | 'maps/duplicate-material'
  | 'maps/ramp-degenerate'
  | 'maps/ramp-too-steep'
  | 'maps/ramp-unsupported'
  | 'maps/spawn-count'
  | 'maps/spawn-zones'
  | 'maps/spawn-zone-too-large'
  | 'maps/spawn-zones-too-close'
  | 'maps/spawn-player-count'
  | 'maps/spawn-too-close'
  | 'maps/spawn-not-on-floor'
  | 'maps/spawn-in-solid'
  | 'maps/cover-count'
  | 'maps/cover-not-on-floor'
  | 'maps/cover-in-solid'
  | 'maps/cover-bad-facing'
  | 'maps/cover-not-adjacent'
  | 'maps/cover-height-mismatch'
  | 'maps/hint-not-on-floor'
  | 'maps/patrol-count'
  | 'maps/feature-missing'
  | 'maps/feature-unbacked'
  | 'maps/lighting-invalid';

export type MapDataList =
  'solids' | 'ramps' | 'spawns' | 'cover' | 'navHints' | 'features' | 'materials' | 'lighting';

/**
 * One finding from checkMapData. `index` points into the list named by `list`.
 * `detail` is generated by the checker; it never copies strings from the
 * definition (SD-M-06).
 */
export interface MapDataIssue {
  readonly code: MapDataIssueCode;
  readonly list?: MapDataList;
  readonly index?: number;
  readonly detail: string;
}
