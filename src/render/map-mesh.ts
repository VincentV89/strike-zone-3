/**
 * Map geometry (business-logic-model §2.3, BR-P-30, TS-P-03). Solids and
 * ramps are bucketed by material and caster flag; each bucket becomes one
 * BufferGeometry written straight into typed arrays sized by a counting pass.
 * Map values are read and copied, never mutated or used as `out` (BR-P-03).
 */
import { BufferAttribute, BufferGeometry } from 'three';
import type { MapDefinition, Ramp, Solid, SolidKind } from '../maps';

/** Kinds whose meshes never enter the shadow pass (BR-P-30). */
const NON_CASTER_KINDS: ReadonlySet<SolidKind> = new Set<SolidKind>(['ground', 'floor']);

export interface BucketData {
  readonly material: string;
  readonly caster: boolean;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly triangles: number;
  /** Sum of the volumes of the items in the bucket (m³), used by the caster cap. */
  readonly volume: number;
  readonly solidCount: number;
  readonly rampCount: number;
}

interface BucketBuilder {
  material: string;
  caster: boolean;
  quads: number;
  tris: number;
  volume: number;
  solids: number;
  ramps: number;
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  idx: Uint32Array;
  v: number;
  i: number;
  repeatM: number;
}

const EPS = 1e-6;

export function isCasterSolid(s: Solid): boolean {
  return !NON_CASTER_KINDS.has(s.kind);
}

function dropsBottom(s: Solid, floorY: number): boolean {
  return Math.abs(s.box.min.y - floorY) < EPS;
}

function bucketKey(material: string, caster: boolean): string {
  return `${material}|${caster ? 'c' : 'n'}`;
}

/** Item-level face counts: quads and single triangles. */
function solidQuads(s: Solid, floorY: number): number {
  return dropsBottom(s, floorY) ? 5 : 6;
}
const RAMP_QUADS = 3; // slope, high edge, bottom
const RAMP_TRIS = 2; // two sides

function boxVolume(s: Solid): number {
  const b = s.box;
  return (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
}

function rampVolume(r: Ramp): number {
  return ((r.maxX - r.minX) * (r.maxZ - r.minZ) * (r.topY - r.baseY)) / 2;
}

// ------------------------------------------------------------ emitters

function emitVertex(
  b: BucketBuilder,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  u: number,
  v: number,
): number {
  const k = b.v;
  b.pos[k * 3] = x;
  b.pos[k * 3 + 1] = y;
  b.pos[k * 3 + 2] = z;
  b.nrm[k * 3] = nx;
  b.nrm[k * 3 + 1] = ny;
  b.nrm[k * 3 + 2] = nz;
  b.uv[k * 2] = u / b.repeatM;
  b.uv[k * 2 + 1] = v / b.repeatM;
  b.v += 1;
  return k;
}

/** World-space UV for a vertex on a face with normal n: the two axes other than the dominant one. */
function uvFor(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
): [number, number] {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) return [x, z];
  if (ax >= az) return [z, y];
  return [x, y];
}

/**
 * Emits a polygon (3 or 4 corners, coordinates flattened) with outward
 * normal n. Winding is fixed up from the geometric normal so every face is
 * counter-clockwise seen from outside.
 */
function emitPolygon(
  b: BucketBuilder,
  corners: readonly number[],
  nx: number,
  ny: number,
  nz: number,
): void {
  const count = corners.length / 3;
  const c0 = corners[0] ?? 0;
  const c1 = corners[1] ?? 0;
  const c2 = corners[2] ?? 0;
  const ax = (corners[3] ?? 0) - c0;
  const ay = (corners[4] ?? 0) - c1;
  const az = (corners[5] ?? 0) - c2;
  const bx = (corners[6] ?? 0) - c0;
  const by = (corners[7] ?? 0) - c1;
  const bz = (corners[8] ?? 0) - c2;
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  const flip = cx * nx + cy * ny + cz * nz < 0;
  const base = b.v;
  for (let c = 0; c < count; c++) {
    const x = corners[c * 3] ?? 0;
    const y = corners[c * 3 + 1] ?? 0;
    const z = corners[c * 3 + 2] ?? 0;
    const [u, v] = uvFor(x, y, z, nx, ny, nz);
    emitVertex(b, x, y, z, nx, ny, nz, u, v);
  }
  const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
  const n = count === 4 ? 6 : 3;
  for (let k = 0; k < n; k++) {
    b.idx[b.i] = base + (order[k] ?? 0);
    b.i += 1;
  }
}

function emitBox(b: BucketBuilder, s: Solid, floorY: number): void {
  const { min, max } = s.box;
  const x0 = min.x,
    y0 = min.y,
    z0 = min.z,
    x1 = max.x,
    y1 = max.y,
    z1 = max.z;
  emitPolygon(b, [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1], 1, 0, 0);
  emitPolygon(b, [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], -1, 0, 0);
  emitPolygon(b, [x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0], 0, 1, 0);
  if (!dropsBottom(s, floorY))
    emitPolygon(b, [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], 0, -1, 0);
  emitPolygon(b, [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], 0, 0, 1);
  emitPolygon(b, [x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0], 0, 0, -1);
}

/** Corner of a ramp: s = 0 low edge .. 1 high edge, c = 0..1 across. */
function rampPoint(r: Ramp, s: number, c: number, y: number, out: number[]): void {
  let x: number;
  let z: number;
  switch (r.up) {
    case '+x':
      x = s === 0 ? r.minX : r.maxX;
      z = c === 0 ? r.minZ : r.maxZ;
      break;
    case '-x':
      x = s === 0 ? r.maxX : r.minX;
      z = c === 0 ? r.minZ : r.maxZ;
      break;
    case '+z':
      z = s === 0 ? r.minZ : r.maxZ;
      x = c === 0 ? r.minX : r.maxX;
      break;
    case '-z':
      z = s === 0 ? r.maxZ : r.minZ;
      x = c === 0 ? r.minX : r.maxX;
      break;
  }
  out.push(x, y, z);
}

function upVector(r: Ramp): [number, number] {
  switch (r.up) {
    case '+x':
      return [1, 0];
    case '-x':
      return [-1, 0];
    case '+z':
      return [0, 1];
    case '-z':
      return [0, -1];
  }
}

function emitRamp(b: BucketBuilder, r: Ramp): void {
  const [ux, uz] = upVector(r);
  const run = ux !== 0 ? r.maxX - r.minX : r.maxZ - r.minZ;
  const rise = r.topY - r.baseY;
  const len = Math.hypot(run, rise);
  // Slope normal: tilted back against the up direction.
  const sn = run / len;
  const sx = (-ux * rise) / len;
  const sz = (-uz * rise) / len;
  const pts: number[] = [];
  // sloped top
  rampPoint(r, 0, 0, r.baseY, pts);
  rampPoint(r, 1, 0, r.topY, pts);
  rampPoint(r, 1, 1, r.topY, pts);
  rampPoint(r, 0, 1, r.baseY, pts);
  emitPolygon(b, pts, sx, sn, sz);
  // high edge (vertical, facing up direction)
  pts.length = 0;
  rampPoint(r, 1, 0, r.baseY, pts);
  rampPoint(r, 1, 1, r.baseY, pts);
  rampPoint(r, 1, 1, r.topY, pts);
  rampPoint(r, 1, 0, r.topY, pts);
  emitPolygon(b, pts, ux, 0, uz);
  // bottom
  pts.length = 0;
  rampPoint(r, 0, 0, r.baseY, pts);
  rampPoint(r, 1, 0, r.baseY, pts);
  rampPoint(r, 1, 1, r.baseY, pts);
  rampPoint(r, 0, 1, r.baseY, pts);
  emitPolygon(b, pts, 0, -1, 0);
  // two triangular sides; the cross axis is perpendicular to up
  const cxn = uz !== 0 ? 1 : 0;
  const czn = ux !== 0 ? 1 : 0;
  for (let c = 0; c < 2; c++) {
    pts.length = 0;
    rampPoint(r, 0, c, r.baseY, pts);
    rampPoint(r, 1, c, r.baseY, pts);
    rampPoint(r, 1, c, r.topY, pts);
    const sign = c === 0 ? -1 : 1;
    emitPolygon(b, pts, cxn * sign, 0, czn * sign);
  }
}

// ------------------------------------------------------------ build

/**
 * Builds the bucket buffers for a map. Bucket order follows the order of
 * def.materials, non-casters first, so the output is deterministic.
 */
export function buildBuckets(def: MapDefinition): BucketData[] {
  const floorY = def.bounds.min.y;
  const repeatOf = new Map<string, number>();
  for (const m of def.materials) repeatOf.set(m.id, m.repeatM > 0 ? m.repeatM : 1);
  const builders = new Map<string, BucketBuilder>();
  const get = (material: string, caster: boolean): BucketBuilder => {
    const key = bucketKey(material, caster);
    let b = builders.get(key);
    if (b === undefined) {
      b = {
        material,
        caster,
        quads: 0,
        tris: 0,
        volume: 0,
        solids: 0,
        ramps: 0,
        pos: new Float32Array(0),
        nrm: new Float32Array(0),
        uv: new Float32Array(0),
        idx: new Uint32Array(0),
        v: 0,
        i: 0,
        repeatM: repeatOf.get(material) ?? 1,
      };
      builders.set(key, b);
    }
    return b;
  };
  // Counting pass.
  for (const s of def.solids) {
    const b = get(s.material, isCasterSolid(s));
    b.quads += solidQuads(s, floorY);
    b.volume += boxVolume(s);
    b.solids += 1;
  }
  for (const r of def.ramps) {
    const b = get(r.material, true);
    b.quads += RAMP_QUADS;
    b.tris += RAMP_TRIS;
    b.volume += rampVolume(r);
    b.ramps += 1;
  }
  for (const b of builders.values()) {
    const verts = b.quads * 4 + b.tris * 3;
    b.pos = new Float32Array(verts * 3);
    b.nrm = new Float32Array(verts * 3);
    b.uv = new Float32Array(verts * 2);
    b.idx = new Uint32Array(b.quads * 6 + b.tris * 3);
  }
  // Write pass.
  for (const s of def.solids) emitBox(get(s.material, isCasterSolid(s)), s, floorY);
  for (const r of def.ramps) emitRamp(get(r.material, true), r);

  const out: BucketData[] = [];
  for (const m of def.materials) {
    for (const caster of [false, true]) {
      const b = builders.get(bucketKey(m.id, caster));
      if (b === undefined) continue;
      out.push({
        material: b.material,
        caster: b.caster,
        positions: b.pos,
        normals: b.nrm,
        uvs: b.uv,
        indices: b.idx,
        triangles: b.idx.length / 3,
        volume: b.volume,
        solidCount: b.solids,
        rampCount: b.ramps,
      });
      builders.delete(bucketKey(m.id, caster));
    }
  }
  // Any material id left over is not in def.materials; the caller reports it.
  for (const b of builders.values()) {
    out.push({
      material: b.material,
      caster: b.caster,
      positions: b.pos,
      normals: b.nrm,
      uvs: b.uv,
      indices: b.idx,
      triangles: b.idx.length / 3,
      volume: b.volume,
      solidCount: b.solids,
      rampCount: b.ramps,
    });
  }
  return out;
}

export function bucketGeometry(data: BucketData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(data.positions, 3));
  g.setAttribute('normal', new BufferAttribute(data.normals, 3));
  g.setAttribute('uv', new BufferAttribute(data.uvs, 2));
  g.setIndex(new BufferAttribute(data.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
