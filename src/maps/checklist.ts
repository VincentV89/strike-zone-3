/**
 * The map-content checklist (business-rules-map-data, BR-M-62 and BR-M-63).
 * A tag is a claim; its backing rule checks that the geometry exists. BACKING
 * is a Record over the whole MapFeature union, so a feature without a backing
 * rule fails tsc.
 */
import type { MapId } from '../contracts';
import {
  boxContains,
  boxesOverlap,
  centreInside,
  depth,
  edgeSupported,
  overlapLength,
  rectContainsXZ,
  rectOf,
  rectsOverlap,
  sideContact,
  walkableTops,
  width,
  type Box,
  type Side,
} from './geometry';
import { EPS } from './rules';
import type { MapDefinition, MapFeature, MapFeatureTag, Solid, SolidKind } from './types';
import { groupZones, zoneFindings } from './zones';

export const REQUIRED_FEATURES: Readonly<Record<MapId, readonly MapFeature[]>> = Object.freeze({
  'desert-compound': Object.freeze([
    'terrain',
    'buildings-walls',
    'interconnected-paths',
    'narrow-corridor',
    'courtyard',
    'crates-barriers',
    'elevated-position',
    'cover',
    'spawn-areas',
  ] as const),
  'industrial-warehouse': Object.freeze([
    'warehouse-interior',
    'shipping-containers',
    'storage-area',
    'walkway',
    'elevated-platform',
    'narrow-corridor',
    'open-area',
    'multiple-routes',
    'cover',
  ] as const),
});

/** Returns null when the tag is backed, otherwise the reason it is not. */
export type BackingRule = (def: MapDefinition, tag: MapFeatureTag) => string | null;

/** Solid kinds that can form a narrow-corridor side (BR-M-20). */
const CORRIDOR_SIDE_KINDS: ReadonlySet<SolidKind> = new Set<SolidKind>([
  'boundary',
  'wall',
  'building',
  'container',
  'rack',
]);
const TERRAIN_MATERIALS: ReadonlySet<string> = new Set(['sand']);

const height = (s: Solid): number => s.box.max.y - s.box.min.y;
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

/** Non-base solids (index > 0) whose xz centre lies in the tag region. */
function solidsIn(def: MapDefinition, region: Box, kinds?: ReadonlySet<SolidKind>): Solid[] {
  return def.solids.filter(
    (s, i) => i > 0 && (kinds === undefined || kinds.has(s.kind)) && centreInside(s.box, region),
  );
}

/** Non-base solids whose xz box strictly overlaps the region's xz rectangle. */
function solidsOverlappingXZ(def: MapDefinition, region: Box): Solid[] {
  const r = rectOf(region);
  return def.solids.filter((s, i) => i > 0 && rectsOverlap(rectOf(s.box), r));
}

function countKind(def: MapDefinition, kind: SolidKind): number {
  return def.solids.filter((s) => s.kind === kind).length;
}

function coverCountReason(def: MapDefinition): string | null {
  const low = def.cover.filter((c) => c.height === 'low').length;
  const high = def.cover.length - low;
  if (def.cover.length < 24 || low < 8 || high < 8) {
    return `cover ${def.cover.length} (low ${low}, high ${high}); need 24 with 8 low and 8 high`;
  }
  return null;
}

/** elevated-position and elevated-platform share one rule with different kinds and heights. */
function elevated(kinds: ReadonlySet<SolidKind>, minTop: number): BackingRule {
  return (def, tag) => {
    const tops = walkableTops(def.solids, new Set());
    for (const top of tops) {
      const s = def.solids[top.source];
      if (s === undefined || !kinds.has(s.kind) || top.y < minTop - EPS) continue;
      if (!centreInside(s.box, tag.region)) continue;
      const ramped = def.ramps.some((r) => edgeSupported(r, 'high', [top]));
      const covered = def.cover.some(
        (c) => near(c.pos.y, top.y, EPS) && rectContainsXZ(top, c.pos.x, c.pos.z),
      );
      if (ramped && covered) return null;
    }
    return `no ${[...kinds].join('/')} top >= ${minTop} m with a ramp and a cover point`;
  };
}

function corridor(def: MapDefinition, tag: MapFeatureTag): string | null {
  const r = rectOf(tag.region);
  const w = width(r);
  const d = depth(r);
  const short = Math.min(w, d);
  const long = Math.max(w, d);
  if (short < 2.0 - EPS || short > 3.0 + EPS) return `short side ${short.toFixed(2)} m`;
  if (long < 8 - EPS) return `long side ${long.toFixed(2)} m`;
  const clear: Box = {
    min: { x: r.minX, y: 0, z: r.minZ },
    max: { x: r.maxX, y: 2.0, z: r.maxZ },
  };
  if (def.solids.some((s, i) => i > 0 && boxesOverlap(s.box, clear))) return 'corridor obstructed';
  const sides: Side[] = w < d ? ['-x', '+x'] : ['-z', '+z'];
  const walls = def.solids.filter((s) => CORRIDOR_SIDE_KINDS.has(s.kind) && s.box.max.y >= 2.5);
  for (const side of sides) {
    const f = sideContact(r, side, walls);
    if (f < 0.8) return `side ${side} enclosed ${(f * 100).toFixed(0)} %`;
  }
  return null;
}

function courtyard(def: MapDefinition, tag: MapFeatureTag): string | null {
  const r = rectOf(tag.region);
  if (width(r) < 14 - EPS || depth(r) < 14 - EPS) return 'region smaller than 14 x 14 m';
  const inside = solidsOverlappingXZ(def, tag.region);
  if (inside.some((s) => s.kind !== 'crate' && s.kind !== 'barrier')) {
    return 'solids other than crates and barriers inside';
  }
  const area = inside.reduce((sum, s) => {
    const sr = rectOf(s.box);
    return (
      sum +
      overlapLength(sr.minX, sr.maxX, r.minX, r.maxX) *
        overlapLength(sr.minZ, sr.maxZ, r.minZ, r.maxZ)
    );
  }, 0);
  if (area > 0.25 * width(r) * depth(r)) return 'props cover more than 25 % of the area';
  const sides = def.solids.filter((s) => s.kind === 'wall' || s.kind === 'building');
  const enclosed = (['-x', '+x', '-z', '+z'] as const).filter(
    (side) => sideContact(r, side, sides) >= 0.5,
  );
  return enclosed.length >= 3 ? null : `only ${enclosed.length} sides enclosed`;
}

function routes(def: MapDefinition, tag: MapFeatureTag): string | null {
  const count = def.features.filter((t) => t.feature === tag.feature).length;
  if (count < 2) return `${count} tags; need at least 2`;
  const patrol = def.navHints.some((h) => h.kind === 'patrol' && boxContains(tag.region, h.pos));
  return patrol ? null : 'no patrol hint in the region';
}

function containerShape(s: Solid): boolean {
  const dx = s.box.max.x - s.box.min.x;
  const dz = s.box.max.z - s.box.min.z;
  const isLen = (l: number): boolean => near(l, 6.06, 0.02) || near(l, 12.19, 0.02);
  const okAxis = (near(dz, 2.44, 0.02) && isLen(dx)) || (near(dx, 2.44, 0.02) && isLen(dz));
  return near(height(s), 2.59, 0.02) && okAxis;
}

function containers(def: MapDefinition, tag: MapFeatureTag): string | null {
  const all = def.solids.filter((s) => s.kind === 'container');
  if (all.length < 16) return `${all.length} containers; need 16`;
  if (!all.some((s) => centreInside(s.box, tag.region))) return 'no container in the region';
  for (const s of all) {
    if (!containerShape(s)) return 'container with non-ISO dimensions';
    if (s.box.min.y <= EPS) continue;
    const supported = all.some(
      (o) =>
        o !== s &&
        near(o.box.max.y, s.box.min.y, 0.02) &&
        s.box.min.x >= o.box.min.x - 0.02 &&
        s.box.max.x <= o.box.max.x + 0.02 &&
        s.box.min.z >= o.box.min.z - 0.02 &&
        s.box.max.z <= o.box.max.z + 0.02,
    );
    if (!supported) return 'floating container stack';
  }
  return null;
}

function storage(def: MapDefinition, tag: MapFeatureTag): string | null {
  const racks = solidsIn(def, tag.region, new Set<SolidKind>(['rack']));
  if (racks.length < 6) return `${racks.length} racks; need 6`;
  for (let a = 0; a < racks.length; a += 1) {
    for (let b = a + 1; b < racks.length; b += 1) {
      const ra = racks[a];
      const rb = racks[b];
      if (ra === undefined || rb === undefined) continue;
      const pa = rectOf(ra.box);
      const pb = rectOf(rb.box);
      const longX = (r: typeof pa): boolean => width(r) >= depth(r);
      if (longX(pa) !== longX(pb)) continue;
      const gap = longX(pa)
        ? overlapLength(pa.minX, pa.maxX, pb.minX, pb.maxX) > 0
          ? Math.max(pb.minZ - pa.maxZ, pa.minZ - pb.maxZ)
          : Infinity
        : overlapLength(pa.minZ, pa.maxZ, pb.minZ, pb.maxZ) > 0
          ? Math.max(pb.minX - pa.maxX, pa.minX - pb.maxX)
          : Infinity;
      if (gap < 2.0 - EPS) return `aisle ${gap.toFixed(2)} m; need 2.0`;
    }
  }
  return null;
}

function walkway(def: MapDefinition, tag: MapFeatureTag): string | null {
  const ways = solidsIn(def, tag.region, new Set<SolidKind>(['walkway']));
  let total = 0;
  for (const s of ways) {
    const r = rectOf(s.box);
    const w = Math.min(width(r), depth(r));
    if (w < 2.0 - EPS || w > 3.5 + EPS) return `walkway width ${w.toFixed(2)} m`;
    if (s.box.max.y < 3.0 - EPS) return 'walkway lower than 3 m';
    const head: Box = {
      min: { x: r.minX, y: s.box.max.y, z: r.minZ },
      max: { x: r.maxX, y: s.box.max.y + 2.0, z: r.maxZ },
    };
    if (def.solids.some((o) => o !== s && boxesOverlap(o.box, head)))
      return 'walkway headroom blocked';
    total += Math.max(width(r), depth(r));
  }
  return total >= 20 - EPS ? null : `walkway length ${total.toFixed(1)} m; need 20`;
}

function openArea(def: MapDefinition, tag: MapFeatureTag): string | null {
  const r = rectOf(tag.region);
  if (width(r) < 20 - EPS || depth(r) < 20 - EPS) return 'region smaller than 20 x 20 m';
  const inside = solidsOverlappingXZ(def, tag.region);
  if (inside.length > 8) return `${inside.length} solids inside; limit 8`;
  return inside.every((s) => s.box.max.y <= 2.6 + EPS) ? null : 'solid taller than 2.6 m inside';
}

function interior(def: MapDefinition, tag: MapFeatureTag): string | null {
  const roof = def.solids.find((s) => {
    const r = rectOf(s.box);
    return (
      s.kind === 'roof' &&
      centreInside(s.box, tag.region) &&
      width(r) * depth(r) >= 1200 &&
      s.box.min.y >= 8
    );
  });
  if (roof === undefined) return 'no roof of 1200 m2 at 8 m or higher';
  const r = rectOf(tag.region);
  const walls = def.solids.filter((s) => {
    const sr = rectOf(s.box);
    const touches =
      sr.minX <= r.maxX + EPS &&
      sr.maxX >= r.minX - EPS &&
      sr.minZ <= r.maxZ + EPS &&
      sr.maxZ >= r.minZ - EPS;
    return s.kind === 'wall' && s.box.max.y >= roof.box.min.y - EPS && touches;
  });
  return walls.length >= 4 ? null : `${walls.length} full-height walls; need 4`;
}

function spawnAreas(def: MapDefinition, tag: MapFeatureTag): string | null {
  const zones = groupZones(def.spawns);
  const tags = def.features.filter((t) => t.feature === 'spawn-areas').length;
  if (tags !== zones.length) return `${tags} spawn-areas tags for ${zones.length} zones`;
  const holds = zones.some((z) =>
    z.members.every((i) => {
      const s = def.spawns[i];
      return s !== undefined && boxContains(tag.region, s.pos);
    }),
  );
  if (!holds) return 'region does not contain a whole zone';
  return zoneFindings(def.spawns, zones).length === 0 ? null : 'zone rules BR-M-43..46 fail';
}

export const BACKING: Readonly<Record<MapFeature, BackingRule>> = Object.freeze({
  terrain: (def, tag) => {
    const blocks = solidsIn(def, tag.region, new Set<SolidKind>(['ground'])).filter(
      (s) => s.box.max.y >= 0.5,
    );
    const ramps = def.ramps.filter(
      (r) =>
        r.topY >= 0.5 &&
        rectContainsXZ(rectOf(tag.region), (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2),
    );
    if (blocks.length + ramps.length < 2) return 'fewer than 2 terrain blocks or ramps';
    const base = def.solids[0];
    return base !== undefined && TERRAIN_MATERIALS.has(base.material)
      ? null
      : 'base slab is not a terrain material';
  },
  'buildings-walls': (def, tag) => {
    const b = solidsIn(def, tag.region, new Set<SolidKind>(['building'])).length;
    const w = solidsIn(def, tag.region, new Set<SolidKind>(['wall'])).length;
    return b >= 4 && w >= 8 ? null : `${b} buildings and ${w} walls; need 4 and 8`;
  },
  'interconnected-paths': routes,
  'multiple-routes': routes,
  'narrow-corridor': corridor,
  courtyard,
  'crates-barriers': (def, tag) => {
    const crates = countKind(def, 'crate');
    const barriers = countKind(def, 'barrier');
    if (crates < 12 || barriers < 6)
      return `${crates} crates and ${barriers} barriers; need 12 and 6`;
    const inside = solidsIn(def, tag.region, new Set<SolidKind>(['crate', 'barrier'])).length;
    return inside >= 4 ? null : `${inside} crates or barriers in the region; need 4`;
  },
  'elevated-position': elevated(new Set<SolidKind>(['floor', 'platform']), 2.5),
  'elevated-platform': elevated(new Set<SolidKind>(['platform', 'walkway']), 3.0),
  cover: (def, tag) => {
    const b = def.bounds;
    const same = [
      [tag.region.min, b.min],
      [tag.region.max, b.max],
    ].every(
      ([p, q]) =>
        p !== undefined &&
        q !== undefined &&
        near(p.x, q.x, EPS) &&
        near(p.y, q.y, EPS) &&
        near(p.z, q.z, EPS),
    );
    return same ? coverCountReason(def) : 'cover region is not the map bounds';
  },
  'spawn-areas': spawnAreas,
  'warehouse-interior': interior,
  'shipping-containers': containers,
  'storage-area': storage,
  walkway,
  'open-area': openArea,
});
