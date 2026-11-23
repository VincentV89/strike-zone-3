/**
 * Prop collision and dressing assembly (BR-G-20..27, BR-G-86). Private to src/maps.
 *
 * A blocking placement's colliders come from the generated catalog (never from a .glb at
 * runtime): each model-space box is turned by the placement's quarter turn, scaled, moved
 * and appended to the map's solids with `prop` set to the placement index. The renderer
 * applies the same transform to the visual (dressing.ts), so shots and decals line up.
 */
import { aabb, StrikeZoneError, vec3, type AABB } from '../core';
import { PROP_CATALOG_DATA } from './prop-catalog.data';
import type {
  BackdropItem,
  DressingDef,
  PropCatalogEntry,
  PropKind,
  PropPlacement,
  ScatterRegion,
  Solid,
  SolidKind,
} from './types';

export const PROP_CATALOG: ReadonlyMap<string, PropCatalogEntry> = new Map(
  PROP_CATALOG_DATA.map((c) => [c.id, c] as const),
);

/** Map-space box of a model-space box under a placement (quarter turn about +Y, scale, move). */
export function placeBox(
  box: { readonly min: readonly number[]; readonly max: readonly number[] },
  p: PropPlacement,
): AABB {
  const [, x, y, z, q, s] = p;
  const xs = [box.min[0] ?? 0, box.max[0] ?? 0];
  const zs = [box.min[2] ?? 0, box.max[2] ?? 0];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  // Rotation about +Y by q·90°: x' = x cos + z sin, z' = −x sin + z cos (three.js Ry).
  const c = [1, 0, -1, 0][q] ?? 1;
  const sn = [0, 1, 0, -1][q] ?? 0;
  for (const bx of xs) {
    for (const bz of zs) {
      const rx = bx * c + bz * sn;
      const rz = -bx * sn + bz * c;
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      minZ = Math.min(minZ, rz);
      maxZ = Math.max(maxZ, rz);
    }
  }
  return aabb(
    vec3(x + minX * s, y + (box.min[1] ?? 0) * s, z + minZ * s),
    vec3(x + maxX * s, y + (box.max[1] ?? 0) * s, z + maxZ * s),
  );
}

const SOLID_KIND: Readonly<Record<Exclude<PropKind, 'visual'>, SolidKind>> = {
  rock: 'rock',
  debris: 'debris',
  vehicle: 'vehicle',
  structure: 'structure',
};

/**
 * Solids for every blocking placement, in placement order. `firstIndex` is the index the
 * first generated solid will have, so cover points keep pointing at authored solids.
 */
export function propSolids(
  placements: readonly PropPlacement[],
  materialFor: (kind: Exclude<PropKind, 'visual'>) => string,
): Solid[] {
  const out: Solid[] = [];
  placements.forEach((p, i) => {
    const c = PROP_CATALOG.get(p[0]);
    if (c === undefined) {
      throw new StrikeZoneError('maps/prop-unknown-model', 'A placement names an unknown prop', {
        index: i,
      });
    }
    if (c.kind === 'visual') return;
    for (const col of c.colliders) {
      out.push({
        kind: SOLID_KIND[c.kind],
        box: placeBox(col, p),
        material: materialFor(c.kind),
        prop: i,
      });
    }
  });
  return out;
}

/** DressingDef with the catalog subset the map uses (models of props, scatter and backdrop). */
export function dressing(
  props: readonly PropPlacement[],
  scatter: readonly ScatterRegion[],
  backdrop: readonly BackdropItem[],
): DressingDef {
  const ids = new Set<string>([
    ...props.map((p) => p[0]),
    ...scatter.map((s) => s.kind),
    ...backdrop.map((b) => b.model),
  ]);
  const catalog = [...ids].flatMap((id) => {
    const c = PROP_CATALOG.get(id);
    return c === undefined ? [] : [c];
  });
  return { props, scatter, backdrop, catalog };
}
