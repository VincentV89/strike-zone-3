/**
 * Map registry (business-logic-model-map-data, workflow 2; security-design
 * SD-M-03 and SD-M-04). Definitions are deep-frozen once at module evaluation,
 * before the ReadonlyMap is built, so no consumer ever sees a mutable map.
 */
import { assertNever, StrikeZoneError } from '../core';
import type { MapId } from '../contracts';
import { DESERT_COMPOUND } from './desert-compound';
import { INDUSTRIAL_WAREHOUSE } from './industrial-warehouse';
import type { MapDefinition } from './types';

/**
 * Freezes `value` and everything reachable from it. Iterative with a visited
 * set, so deep or shared structures cannot overflow the stack or be walked
 * twice; children are frozen before their parents.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  const visited = new Set<object>();
  const order: object[] = [];
  const stack: object[] = [value];
  while (stack.length > 0) {
    const obj = stack.pop();
    if (obj === undefined || visited.has(obj) || Object.isFrozen(obj)) continue;
    visited.add(obj);
    order.push(obj);
    for (const child of Object.values(obj)) {
      if (typeof child === 'object' && child !== null) stack.push(child as object);
    }
  }
  for (let i = order.length - 1; i >= 0; i -= 1) Object.freeze(order[i]);
  return value;
}

/** Menu order. The switch makes adding a MapId without a definition a tsc error. */
const ORDER: readonly MapId[] = ['desert-compound', 'industrial-warehouse'];

function definitionFor(id: MapId): MapDefinition {
  switch (id) {
    case 'desert-compound':
      return DESERT_COMPOUND;
    case 'industrial-warehouse':
      return INDUSTRIAL_WAREHOUSE;
    default:
      return assertNever(id);
  }
}

function buildRegistry(): ReadonlyMap<MapId, MapDefinition> {
  const entries = ORDER.map((id): [MapId, MapDefinition] => {
    const def = deepFreeze(definitionFor(id));
    if (def.id !== id) {
      throw new StrikeZoneError(
        'maps/registry-mismatch',
        'Map definition id differs from its key',
        {
          key: id,
        },
      );
    }
    return [id, def];
  });
  return new Map(entries);
}

const REGISTRY = buildRegistry();
const IDS: readonly MapId[] = Object.freeze([...REGISTRY.keys()]);

/**
 * Returns the frozen definition for `id`, the same object on every call
 * (BR-M-81). Takes `string` so untyped and seam callers are checked here.
 * @throws StrikeZoneError('maps/unknown-map', ..., { id }) for any unregistered id (BR-M-82).
 */
export function getMap(id: string): MapDefinition {
  const def = REGISTRY.get(id as MapId);
  if (def === undefined) {
    throw new StrikeZoneError('maps/unknown-map', 'Unknown map id', { id });
  }
  return def;
}

/** Registry ids in menu order: ['desert-compound', 'industrial-warehouse']. */
export function mapIds(): readonly MapId[] {
  return IDS;
}
