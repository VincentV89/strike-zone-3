/**
 * Pure authoring helpers for map files (business-logic-model-map-data,
 * workflow 1). Error-prone arithmetic (doorway splits, cover offsets,
 * container dimensions) lives here once and is unit-tested. Every box goes
 * through core aabb(), so an inverted box throws core/aabb-inverted at module
 * evaluation (BR-M-05).
 */
import { aabb, StrikeZoneError, vec3, type AABB, type Vec3 } from '../core';
import type { CoverHeight, CoverPoint, Ramp, RampUp, Solid, SolidKind, SpawnPoint } from './types';

export type V3 = readonly [number, number, number];

export interface Doorway {
  /** Centre of the gap along the wall's axis (world coordinate). */
  readonly at: number;
  readonly width: number;
  /** Clear height. A lintel fills the wall above it; a doorway at full wall height has none. */
  readonly height: number;
}

/** Container dimensions (ISO 20 ft and 40 ft high-side boxes, metres). */
export const CONTAINER_WIDTH = 2.44;
export const CONTAINER_HEIGHT = 2.59;
export const CRATE_SIZE = 1.25;
/** Distance from a solid's face to a cover point placed by coverAt. */
export const COVER_OFFSET = 0.6;

const v = (p: V3): Vec3 => vec3(p[0], p[1], p[2]);

/** Region helper for feature tags and exclude hints. */
export function region(min: V3, max: V3): AABB {
  return aabb(v(min), v(max));
}

/** Box from min and max corners. */
export function box(kind: SolidKind, min: V3, max: V3, material: string): Solid {
  return { kind, box: region(min, max), material };
}

/** Box from an xz centre, a size [w (x), h (y), d (z)] and a base height. */
export function block(
  kind: SolidKind,
  cx: number,
  cz: number,
  size: V3,
  baseY: number,
  material: string,
): Solid {
  const [w, h, d] = size;
  return box(kind, [cx - w / 2, baseY, cz - d / 2], [cx + w / 2, baseY + h, cz + d / 2], material);
}

/** Splits [a0, a1] around doorways; returns the solid intervals and the lintel intervals. */
function splitAround(
  a0: number,
  a1: number,
  wallHeight: number,
  doors: readonly Doorway[],
): { spans: [number, number][]; lintels: [number, number, number][] } {
  const sorted = [...doors].sort((p, q) => p.at - q.at);
  const spans: [number, number][] = [];
  const lintels: [number, number, number][] = [];
  let cursor = a0;
  for (const door of sorted) {
    const g0 = door.at - door.width / 2;
    const g1 = door.at + door.width / 2;
    if (g0 < cursor || g1 > a1) {
      throw new StrikeZoneError('maps/doorway-outside-wall', 'Doorway does not fit its wall', {
        at: door.at,
      });
    }
    if (g0 > cursor) spans.push([cursor, g0]);
    if (door.height < wallHeight) lintels.push([g0, g1, door.height]);
    cursor = g1;
  }
  if (cursor < a1) spans.push([cursor, a1]);
  return { spans, lintels };
}

/**
 * A wall along x from x0 to x1, centred on the line z, split around doorways.
 * Each doorway lower than the wall gets a lintel solid above it.
 */
export function wallAlongX(
  x0: number,
  x1: number,
  z: number,
  thick: number,
  height: number,
  material: string,
  doors: readonly Doorway[] = [],
): Solid[] {
  const z0 = z - thick / 2;
  const z1 = z + thick / 2;
  const { spans, lintels } = splitAround(x0, x1, height, doors);
  return [
    ...spans.map(([a, b]) => box('wall', [a, 0, z0], [b, height, z1], material)),
    ...lintels.map(([a, b, y]) => box('wall', [a, y, z0], [b, height, z1], material)),
  ];
}

/** A wall along z from z0 to z1, centred on the line x. See wallAlongX. */
export function wallAlongZ(
  z0: number,
  z1: number,
  x: number,
  thick: number,
  height: number,
  material: string,
  doors: readonly Doorway[] = [],
): Solid[] {
  const x0 = x - thick / 2;
  const x1 = x + thick / 2;
  const { spans, lintels } = splitAround(z0, z1, height, doors);
  return [
    ...spans.map(([a, b]) => box('wall', [x0, 0, a], [x1, height, b], material)),
    ...lintels.map(([a, b, y]) => box('wall', [x0, y, a], [x1, height, b], material)),
  ];
}

/** 1.25 m crate standing at baseY. */
export function crate(cx: number, cz: number, baseY: number, material: string): Solid {
  return block('crate', cx, cz, [CRATE_SIZE, CRATE_SIZE, CRATE_SIZE], baseY, material);
}

/** ISO container: 2.44 wide, 2.59 high, 6.06 or 12.19 long; level 1 sits on top of a level 0 container. */
export function container(
  cx: number,
  cz: number,
  axis: 'x' | 'z',
  length: 6.06 | 12.19,
  level: 0 | 1,
  material: string,
): Solid {
  const size: V3 =
    axis === 'x'
      ? [length, CONTAINER_HEIGHT, CONTAINER_WIDTH]
      : [CONTAINER_WIDTH, CONTAINER_HEIGHT, length];
  return block('container', cx, cz, size, level * CONTAINER_HEIGHT, material);
}

/** Ramp from its low-edge midpoint, rising toward `up` over `run` metres. */
export function ramp(
  lowEdgeMid: V3,
  up: RampUp,
  run: number,
  width: number,
  rise: number,
  material: string,
): Ramp {
  const [lx, ly, lz] = lowEdgeMid;
  const half = width / 2;
  const base = { baseY: ly, topY: ly + rise, up, material };
  switch (up) {
    case '+x':
      return { minX: lx, maxX: lx + run, minZ: lz - half, maxZ: lz + half, ...base };
    case '-x':
      return { minX: lx - run, maxX: lx, minZ: lz - half, maxZ: lz + half, ...base };
    case '+z':
      return { minX: lx - half, maxX: lx + half, minZ: lz, maxZ: lz + run, ...base };
    case '-z':
      return { minX: lx - half, maxX: lx + half, minZ: lz - run, maxZ: lz, ...base };
  }
}

/** Midpoint of a ramp's walkable surface (where its seed hint goes, BR-M-61). */
export function rampMid(r: Ramp): Vec3 {
  return vec3((r.minX + r.maxX) / 2, (r.baseY + r.topY) / 2, (r.minZ + r.maxZ) / 2);
}

/**
 * cols x rows spawns starting at origin, `spacing` apart (+x per column, +z
 * per row). `playerSlots` lists grid indices (row * cols + col) that are
 * player-eligible. `count` keeps only the first `count` grid slots.
 */
export function spawnGrid(
  zone: string,
  origin: Vec3,
  cols: number,
  rows: number,
  spacing: number,
  yaw: number,
  playerSlots: readonly number[],
  count = cols * rows,
): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  for (let i = 0; i < Math.min(count, cols * rows); i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({
      pos: vec3(origin.x + col * spacing, origin.y, origin.z + row * spacing),
      yaw,
      zone,
      player: playerSlots.includes(i),
    });
  }
  return out;
}

/**
 * A cover point 0.6 m off the given face of solids[index], centred on the face
 * (or at the world coordinate `along` on the face's axis), facing the solid.
 * It stands at the solid's base height.
 */
export function coverAt(
  solids: readonly Solid[],
  index: number,
  face: '+x' | '-x' | '+z' | '-z',
  height: CoverHeight,
  along?: number,
): CoverPoint {
  const solid = solids[index];
  if (solid === undefined) {
    throw new StrikeZoneError('maps/cover-solid-missing', 'coverAt index out of range', { index });
  }
  const { min, max } = solid.box;
  const cx = along ?? (min.x + max.x) / 2;
  const cz = along ?? (min.z + max.z) / 2;
  const y = min.y;
  switch (face) {
    case '+x':
      return cover(vec3(max.x + COVER_OFFSET, y, cz), vec3(-1, 0, 0), height, index);
    case '-x':
      return cover(vec3(min.x - COVER_OFFSET, y, cz), vec3(1, 0, 0), height, index);
    case '+z':
      return cover(vec3(cx, y, max.z + COVER_OFFSET), vec3(0, 0, -1), height, index);
    case '-z':
      return cover(vec3(cx, y, min.z - COVER_OFFSET), vec3(0, 0, 1), height, index);
  }
}

function cover(pos: Vec3, facing: Vec3, height: CoverHeight, solid: number): CoverPoint {
  return { pos, facing, height, solid };
}

/** Unit vector from components (used for sun directions). */
export function unit(x: number, y: number, z: number): Vec3 {
  const len = Math.hypot(x, y, z);
  return vec3(x / len, y / len, z / len);
}

/** Yaw that faces from `from` toward `to` in the xz plane (yaw 0 faces -Z, FD-F-10). */
export function yawToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
