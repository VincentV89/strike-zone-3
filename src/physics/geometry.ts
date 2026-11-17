/**
 * Shape store and broadphase grid (LC-CN-01..03). Internal to src/physics.
 *
 * Every number is copied out of the frozen MapDefinition into the world's own
 * typed arrays (SD-CN-05). Shape ids: boxes 0..S-1, ramps S..S+R-1.
 */
import { StrikeZoneError } from '../core';
import type { MapDefinition, Ramp } from '../maps';
import { MAX_GRID_CELLS, MAX_GRID_ENTRIES, MIN_CELL_SIZE } from './constants';

/** Ramp rise direction: 0 = +x, 1 = -x, 2 = +z, 3 = -z. */
const AXIS_OF: Readonly<Record<Ramp['up'], number>> = { '+x': 0, '-x': 1, '+z': 2, '-z': 3 };

export interface Geometry {
  readonly boxCount: number;
  readonly rampCount: number;
  readonly shapeCount: number;
  readonly bMinX: Float64Array;
  readonly bMinY: Float64Array;
  readonly bMinZ: Float64Array;
  readonly bMaxX: Float64Array;
  readonly bMaxY: Float64Array;
  readonly bMaxZ: Float64Array;
  readonly rMinX: Float64Array;
  readonly rMaxX: Float64Array;
  readonly rMinZ: Float64Array;
  readonly rMaxZ: Float64Array;
  readonly rBase: Float64Array;
  readonly rTop: Float64Array;
  readonly rAxis: Uint8Array;
  /** Surface half-space a*x + y + c*z + e <= 0 is inside the wedge. */
  readonly rPA: Float64Array;
  readonly rPC: Float64Array;
  readonly rPE: Float64Array;
  readonly originX: number;
  readonly originZ: number;
  readonly cellSize: number;
  readonly nx: number;
  readonly nz: number;
  readonly cellStart: Int32Array;
  readonly cellItems: Int32Array;
  /** Per-query mailbox so a shape spanning several cells is tested once (LC-CN-12). */
  readonly stamp: Uint32Array;
  stampId: number;
  /** Scratch list of shape ids written by gatherShapes. */
  readonly gathered: Int32Array;
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly maxZ: number;
  };
}

function invalid(kind: 'solid' | 'ramp' | 'bounds', index: number): never {
  // SD-CN-07: codes, list kinds and indices only, never map strings.
  throw new StrikeZoneError('physics/invalid-geometry', 'Invalid collision geometry', {
    kind,
    index,
  });
}

const finite = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x));

function validate(def: MapDefinition): void {
  const b = def.bounds;
  if (
    !finite(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z) ||
    b.min.x > b.max.x ||
    b.min.z > b.max.z ||
    b.min.y > b.max.y
  ) {
    invalid('bounds', 0);
  }
  def.solids.forEach((s, i) => {
    const { min, max } = s.box;
    if (!finite(min.x, min.y, min.z, max.x, max.y, max.z)) invalid('solid', i);
    if (min.x > max.x || min.y > max.y || min.z > max.z) invalid('solid', i);
  });
  def.ramps.forEach((r, j) => {
    if (!finite(r.minX, r.maxX, r.minZ, r.maxZ, r.baseY, r.topY)) invalid('ramp', j);
    if (!(r.maxX > r.minX && r.maxZ > r.minZ && r.topY > r.baseY)) invalid('ramp', j);
    if (!Object.hasOwn(AXIS_OF, r.up)) invalid('ramp', j);
  });
}

/** Inclusive cell index range. */
export interface CellRange {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Grid cell range covered by an xz rectangle, clamped to the grid. */
export function cellRange(
  g: Pick<Geometry, 'originX' | 'originZ' | 'cellSize' | 'nx' | 'nz'>,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  out: CellRange,
): void {
  out.x0 = clampInt(Math.floor((minX - g.originX) / g.cellSize), 0, g.nx - 1);
  out.z0 = clampInt(Math.floor((minZ - g.originZ) / g.cellSize), 0, g.nz - 1);
  out.x1 = clampInt(Math.floor((maxX - g.originX) / g.cellSize), 0, g.nx - 1);
  out.z1 = clampInt(Math.floor((maxZ - g.originZ) / g.cellSize), 0, g.nz - 1);
}

/**
 * Builds the shape store and grid. Validation runs in the SD-CN-06 order and
 * throws before any typed array is allocated.
 */
export function buildGeometry(def: MapDefinition, cellSize: number): Geometry {
  if (!Number.isFinite(cellSize) || cellSize <= MIN_CELL_SIZE) {
    throw new StrikeZoneError('physics/invalid-cell-size', 'cellSize must be finite and > 0.5', {
      cellSize,
    });
  }
  validate(def);

  const b = def.bounds;
  const nx = Math.max(1, Math.ceil((b.max.x - b.min.x) / cellSize));
  const nz = Math.max(1, Math.ceil((b.max.z - b.min.z) / cellSize));
  if (nx * nz > MAX_GRID_CELLS) {
    throw new StrikeZoneError('physics/grid-too-large', 'Too many grid cells', { cells: nx * nz });
  }
  const gridShape = { originX: b.min.x, originZ: b.min.z, cellSize, nx, nz };
  const S = def.solids.length;
  const R = def.ramps.length;
  const range: CellRange = { x0: 0, z0: 0, x1: 0, z1: 0 };
  const rectOf = (id: number): readonly [number, number, number, number] => {
    if (id < S) {
      const box = (def.solids[id] ?? invalid('solid', id)).box;
      return [box.min.x, box.min.z, box.max.x, box.max.z];
    }
    const r = def.ramps[id - S] ?? invalid('ramp', id - S);
    return [r.minX, r.minZ, r.maxX, r.maxZ];
  };

  // Pass 1: count entries without allocating the entry list (SD-CN-06 step 4).
  let entries = 0;
  for (let id = 0; id < S + R; id++) {
    const [x0, z0, x1, z1] = rectOf(id);
    cellRange(gridShape, x0, z0, x1, z1, range);
    entries += (range.x1 - range.x0 + 1) * (range.z1 - range.z0 + 1);
    if (entries > MAX_GRID_ENTRIES) {
      throw new StrikeZoneError('physics/grid-too-large', 'Too many grid entries', { entries });
    }
  }

  // Allocation, sized exactly (SD-CN-06 step 5).
  const f64 = (n: number): Float64Array => new Float64Array(n);
  const g: Geometry = {
    boxCount: S,
    rampCount: R,
    shapeCount: S + R,
    bMinX: f64(S),
    bMinY: f64(S),
    bMinZ: f64(S),
    bMaxX: f64(S),
    bMaxY: f64(S),
    bMaxZ: f64(S),
    rMinX: f64(R),
    rMaxX: f64(R),
    rMinZ: f64(R),
    rMaxZ: f64(R),
    rBase: f64(R),
    rTop: f64(R),
    rAxis: new Uint8Array(R),
    rPA: f64(R),
    rPC: f64(R),
    rPE: f64(R),
    ...gridShape,
    cellStart: new Int32Array(nx * nz + 1),
    cellItems: new Int32Array(entries),
    stamp: new Uint32Array(S + R),
    stampId: 0,
    gathered: new Int32Array(S + R),
    bounds: Object.freeze({
      minX: b.min.x,
      minY: b.min.y,
      minZ: b.min.z,
      maxX: b.max.x,
      maxY: b.max.y,
      maxZ: b.max.z,
    }),
  };

  def.solids.forEach((s, i) => {
    g.bMinX[i] = s.box.min.x;
    g.bMinY[i] = s.box.min.y;
    g.bMinZ[i] = s.box.min.z;
    g.bMaxX[i] = s.box.max.x;
    g.bMaxY[i] = s.box.max.y;
    g.bMaxZ[i] = s.box.max.z;
  });
  def.ramps.forEach((r, j) => {
    const axis = AXIS_OF[r.up];
    g.rMinX[j] = r.minX;
    g.rMaxX[j] = r.maxX;
    g.rMinZ[j] = r.minZ;
    g.rMaxZ[j] = r.maxZ;
    g.rBase[j] = r.baseY;
    g.rTop[j] = r.topY;
    g.rAxis[j] = axis;
    const rise = r.topY - r.baseY;
    const k = axis < 2 ? rise / (r.maxX - r.minX) : rise / (r.maxZ - r.minZ);
    // f(p) = y - base - k * (distance from the low edge along the up axis)
    g.rPA[j] = axis === 0 ? -k : axis === 1 ? k : 0;
    g.rPC[j] = axis === 2 ? -k : axis === 3 ? k : 0;
    g.rPE[j] =
      axis === 0
        ? -r.baseY + k * r.minX
        : axis === 1
          ? -r.baseY - k * r.maxX
          : axis === 2
            ? -r.baseY + k * r.minZ
            : -r.baseY - k * r.maxZ;
  });

  // Pass 2: CSR fill in shape-id order, so each cell's list is ascending.
  const counts = new Int32Array(nx * nz);
  for (let id = 0; id < S + R; id++) {
    const [x0, z0, x1, z1] = rectOf(id);
    cellRange(g, x0, z0, x1, z1, range);
    for (let cz = range.z0; cz <= range.z1; cz++) {
      for (let cx = range.x0; cx <= range.x1; cx++)
        counts[cz * nx + cx] = (counts[cz * nx + cx] ?? 0) + 1;
    }
  }
  for (let c = 0; c < nx * nz; c++) g.cellStart[c + 1] = (g.cellStart[c] ?? 0) + (counts[c] ?? 0);
  counts.fill(0);
  for (let id = 0; id < S + R; id++) {
    const [x0, z0, x1, z1] = rectOf(id);
    cellRange(g, x0, z0, x1, z1, range);
    for (let cz = range.z0; cz <= range.z1; cz++) {
      for (let cx = range.x0; cx <= range.x1; cx++) {
        const c = cz * nx + cx;
        g.cellItems[(g.cellStart[c] ?? 0) + (counts[c] ?? 0)] = id;
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
  }
  return g;
}

/** Starts a new dedupe query; clears the stamps when the counter wraps (LC-CN-12). */
export function nextStamp(g: Geometry): number {
  g.stampId++;
  if (g.stampId >= 0x7fffffff) {
    g.stamp.fill(0);
    g.stampId = 1;
  }
  return g.stampId;
}

const RANGE: CellRange = { x0: 0, z0: 0, x1: 0, z1: 0 };

/**
 * Writes the unique ids of shapes in the cells overlapping an xz rectangle
 * into g.gathered and returns how many. Allocates nothing.
 */
export function gatherShapes(
  g: Geometry,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): number {
  cellRange(g, minX, minZ, maxX, maxZ, RANGE);
  const id = nextStamp(g);
  let n = 0;
  const { x0, x1, z1 } = RANGE;
  for (let cz = RANGE.z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const c = cz * g.nx + cx;
      const end = g.cellStart[c + 1] ?? 0;
      for (let k = g.cellStart[c] ?? 0; k < end; k++) {
        const s = g.cellItems[k] ?? 0;
        if (g.stamp[s] === id) continue;
        g.stamp[s] = id;
        g.gathered[n++] = s;
      }
    }
  }
  return n;
}

/** Cell index for a point, clamped to the grid (BR-CN-25). */
export function cellOf(g: Geometry, x: number, z: number): number {
  const cx = clampInt(Math.floor((x - g.originX) / g.cellSize), 0, g.nx - 1);
  const cz = clampInt(Math.floor((z - g.originZ) / g.cellSize), 0, g.nz - 1);
  return cz * g.nx + cx;
}
