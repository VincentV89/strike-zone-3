/**
 * Map preparation and the page-lifetime PreparedMap cache (BR-GS-10..14,
 * SD-GS-06). The cache holds immutable values only; a map that fails
 * validation is never cached. Time enters only through `opts.now`, which
 * sets the bake slice budget (the bake result does not depend on it).
 */
import { StrikeZoneError, err, ok, type Diagnostics, type Result } from '../core';
import type { MapId } from '../contracts';
import { getMap, type MapDefinition } from '../maps';
import { bakeNavGraph, createNavBaker } from '../nav';
import { buildCollisionWorld, type CollisionWorld } from '../physics';
import { SIM_TUNING } from './tuning';
import type { MapValidationReport, PrepareOptions, PreparedMap } from './types';
import { STANDING, validateMap } from './validate';

interface Geometry {
  readonly def: MapDefinition;
  readonly world: CollisionWorld;
}

/** Validated maps (at most one entry per MapId). */
const cache = new Map<MapId, PreparedMap>();
/** Finished collision worlds whose bake was aborted or not yet started. */
const partial = new Map<MapId, Geometry>();

/** Test-only: forget every cached map. Not exported from src/sim/index.ts. */
export function __resetPreparedMapCache(): void {
  cache.clear();
  partial.clear();
}

function geometry(id: MapId): Geometry {
  const known = partial.get(id);
  if (known !== undefined) return known;
  const def = getMap(id);
  const g: Geometry = { def, world: buildCollisionWorld(def) };
  partial.set(id, g);
  return g;
}

function report(diag: Diagnostics | undefined, validation: MapValidationReport): void {
  for (const issue of validation.issues) diag?.warnOnce(issue.code);
}

/** Validates; caches only a valid map (BR-GS-12). An invalid map's geometry is dropped too. */
function finish(id: MapId, g: Geometry, nav: PreparedMap['nav']): PreparedMap {
  const validation = validateMap(g.def, g.world, nav);
  const prepared: PreparedMap = Object.freeze({ def: g.def, world: g.world, nav, validation });
  partial.delete(id);
  if (validation.ok) cache.set(id, prepared);
  return prepared;
}

/**
 * Builds geometry, bakes the nav graph in `sliceMs` slices with a yield
 * between them, then validates. Abort keeps the finished geometry.
 */
export async function prepareMapAsync(
  id: MapId,
  opts: PrepareOptions,
): Promise<Result<PreparedMap, 'ABORTED' | 'INVALID_MAP'>> {
  const cached = cache.get(id);
  if (cached !== undefined) {
    opts.onProgress('map-geometry', 1);
    opts.onProgress('nav-data', 1);
    return ok(cached);
  }
  // A function, so the checks after each await are not narrowed away.
  const aborted = (): boolean => opts.signal.aborted;
  if (aborted()) return err('ABORTED');
  const g = geometry(id);
  opts.onProgress('map-geometry', 1);
  if (aborted()) return err('ABORTED');

  const sliceMs = opts.sliceMs ?? SIM_TUNING.defaultSliceMs;
  const baker = createNavBaker(g.def, g.world, { agent: STANDING });
  for (;;) {
    const done = baker.step(sliceMs, opts.now);
    // baker.progress() is monotonic and reaches 1 only when done (collision-nav guarantee).
    opts.onProgress('nav-data', done ? 1 : Math.min(baker.progress(), 0.999));
    if (done) break;
    await opts.yieldFn();
    if (aborted()) return err('ABORTED');
  }
  const prepared = finish(id, g, baker.result());
  if (!prepared.validation.ok) {
    report(opts.diag, prepared.validation);
    return err('INVALID_MAP');
  }
  return ok(prepared);
}

/**
 * Synchronous preparation for Node tests and benchmarks; shares the cache.
 * @throws StrikeZoneError('sim/invalid-map') when validation fails.
 */
export function prepareMap(id: MapId, diag?: Diagnostics): PreparedMap {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const g = geometry(id);
  const prepared = finish(id, g, bakeNavGraph(g.def, g.world, { agent: STANDING }));
  if (!prepared.validation.ok) {
    report(diag, prepared.validation);
    throw new StrikeZoneError('sim/invalid-map', 'Map failed validation', {
      id,
      codes: prepared.validation.issues.map((i) => i.code),
    });
  }
  return prepared;
}

/** Builds an uncached PreparedMap from any definition (fixtures and tools). */
export function prepareDefinition(def: MapDefinition): PreparedMap {
  const world = buildCollisionWorld(def);
  const nav = bakeNavGraph(def, world, { agent: STANDING });
  return Object.freeze({ def, world, nav, validation: validateMap(def, world, nav) });
}
