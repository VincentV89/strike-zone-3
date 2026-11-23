/**
 * checkMapData: pure data checks over a MapDefinition (business-rules-map-data,
 * every rule marked [check]). It collects every issue instead of stopping at
 * the first, runs ten phases in a fixed order and walks lists in index order,
 * so the output is deterministic (BR-M-86).
 *
 * Totality (SD-M-06): no function called here throws on type-valid input; no
 * AABB is built through core constructors; elements with non-finite numbers
 * or inverted boxes are reported once and skipped by later phases; lists over
 * their BR-M-88 budget skip every later per-element and pairwise phase.
 */
import { BACKING, REQUIRED_FEATURES } from './checklist';
import {
  boxContains,
  boxFinite,
  boxInside,
  boxesOverlap,
  capsuleBlocked,
  capsuleBox,
  closestPoint,
  edgeSupported,
  rampBox,
  rampRunWidth,
  rampSurfaceY,
  rectDistance,
  rectOf,
  standsOn,
  walkableTops,
  type Box,
  type Top,
} from './geometry';
import { EPS, MAP_BUDGETS, MAP_RULES } from './rules';
import type {
  CoverPoint,
  MapDataIssue,
  MapDataIssueCode,
  MapDataList,
  MapDefinition,
} from './types';
import { groupZones, zoneFindings, type SpawnZone } from './zones';

type ListName = Exclude<MapDataList, 'lighting' | 'dressing'>;

interface Ctx {
  readonly def: MapDefinition;
  readonly issues: MapDataIssue[];
  /** Per-list indices skipped by later phases (non-finite or inverted). */
  readonly bad: Record<ListName, Set<number>>;
  /** Lists over budget (BR-M-88). */
  readonly over: Set<ListName | 'locals'>;
  boundsOk: boolean;
  lightingFinite: boolean;
  tops: Top[];
  zones: SpawnZone[];
}

function add(
  ctx: Ctx,
  code: MapDataIssueCode,
  detail: string,
  list?: MapDataList,
  index?: number,
): void {
  const issue: { code: MapDataIssueCode; detail: string; list?: MapDataList; index?: number } = {
    code,
    detail,
  };
  if (list !== undefined) issue.list = list;
  if (index !== undefined) issue.index = index;
  ctx.issues.push(issue);
}

/** True when every number reachable from `value` is finite (iterative walk). */
function numbersFinite(value: unknown): boolean {
  const stack: unknown[] = [value];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return false;
    } else if (typeof v === 'object' && v !== null && !seen.has(v)) {
      seen.add(v);
      for (const child of Object.values(v)) stack.push(child);
    }
  }
  return true;
}

const LISTS: readonly ListName[] = [
  'solids',
  'ramps',
  'spawns',
  'cover',
  'navHints',
  'features',
  'materials',
];

/** Phase 1 (BR-M-03). */
function phaseNumbers(ctx: Ctx): void {
  const { def } = ctx;
  if (!boxFinite(def.bounds) || !numbersFinite(def.bounds)) {
    ctx.boundsOk = false;
    add(ctx, 'maps/non-finite', 'bounds contain a non-finite number');
  }
  for (const list of LISTS) {
    const items: readonly unknown[] = def[list];
    items.forEach((item, i) => {
      if (!numbersFinite(item)) {
        ctx.bad[list].add(i);
        add(ctx, 'maps/non-finite', 'element contains a non-finite number', list, i);
      }
    });
  }
  if (!numbersFinite(def.lighting)) {
    ctx.lightingFinite = false;
    add(ctx, 'maps/non-finite', 'lighting contains a non-finite number', 'lighting');
  }
}

/** Phase 2 (BR-M-88). */
function phaseBudgets(ctx: Ctx): void {
  const { def } = ctx;
  for (const list of LISTS) {
    const limit = MAP_BUDGETS[list];
    if (def[list].length > limit) {
      ctx.over.add(list);
      add(ctx, 'maps/budget-exceeded', `${def[list].length} elements; budget ${limit}`, list);
    }
  }
  if (def.lighting.locals.length > MAP_BUDGETS.locals) {
    ctx.over.add('locals');
    add(
      ctx,
      'maps/budget-exceeded',
      `${def.lighting.locals.length} local lights; budget ${MAP_BUDGETS.locals}`,
      'lighting',
    );
  }
}

const inverted = (b: Box): boolean => b.min.x > b.max.x || b.min.y > b.max.y || b.min.z > b.max.z;

function live(ctx: Ctx, list: ListName): boolean {
  return !ctx.over.has(list);
}

/** Phase 3 (BR-M-04, BR-M-10 to BR-M-13). */
function phaseBounds(ctx: Ctx): void {
  const { def } = ctx;
  if (!ctx.boundsOk) return;
  const b = def.bounds;
  if (inverted(b)) {
    ctx.boundsOk = false;
    add(ctx, 'maps/out-of-bounds', 'bounds are inverted');
    return;
  }
  const outside = (list: MapDataList, i: number, what: string): void => {
    add(ctx, 'maps/out-of-bounds', `${what} outside bounds`, list, i);
  };
  if (live(ctx, 'solids')) {
    def.solids.forEach((s, i) => {
      if (ctx.bad.solids.has(i)) return;
      if (inverted(s.box)) {
        ctx.bad.solids.add(i);
        add(ctx, 'maps/out-of-bounds', 'solid box is inverted', 'solids', i);
      } else if (!boxInside(s.box, b)) outside('solids', i, 'solid');
    });
  }
  if (live(ctx, 'ramps')) {
    def.ramps.forEach((r, i) => {
      if (!ctx.bad.ramps.has(i) && !boxInside(rampBox(r), b)) outside('ramps', i, 'ramp');
    });
  }
  if (live(ctx, 'spawns')) {
    def.spawns.forEach((s, i) => {
      if (!ctx.bad.spawns.has(i) && !boxContains(b, s.pos)) outside('spawns', i, 'spawn');
    });
  }
  if (live(ctx, 'cover')) {
    def.cover.forEach((c, i) => {
      if (!ctx.bad.cover.has(i) && !boxContains(b, c.pos)) outside('cover', i, 'cover point');
    });
  }
  if (live(ctx, 'navHints')) {
    def.navHints.forEach((h, i) => {
      if (ctx.bad.navHints.has(i)) return;
      const inside = h.kind === 'exclude' ? boxInside(h.region, b) : boxContains(b, h.pos);
      if (!inside) outside('navHints', i, 'nav hint');
    });
  }
  if (live(ctx, 'features')) {
    def.features.forEach((t, i) => {
      if (!ctx.bad.features.has(i) && !boxInside(t.region, b))
        outside('features', i, 'feature region');
    });
  }
  if (ctx.lightingFinite && !ctx.over.has('locals')) {
    def.lighting.locals.forEach((l, i) => {
      if (!boxContains(b, l.pos)) {
        add(ctx, 'maps/out-of-bounds', `local light ${i} outside bounds`, 'lighting');
      }
    });
  }
  if (live(ctx, 'solids')) {
    checkGround(ctx);
    checkBoundaries(ctx);
    checkHeadroom(ctx);
  }
}

/** BR-M-10. */
function checkGround(ctx: Ctx): void {
  const { def } = ctx;
  const g = def.solids[0];
  const b = def.bounds;
  const ok =
    g !== undefined &&
    !ctx.bad.solids.has(0) &&
    g.kind === 'ground' &&
    Math.abs(g.box.min.x - b.min.x) <= EPS &&
    Math.abs(g.box.max.x - b.max.x) <= EPS &&
    Math.abs(g.box.min.z - b.min.z) <= EPS &&
    Math.abs(g.box.max.z - b.max.z) <= EPS &&
    Math.abs(g.box.min.y + 1) <= EPS &&
    Math.abs(g.box.max.y) <= EPS;
  if (!ok)
    add(
      ctx,
      'maps/ground-gap',
      'solids[0] is not a ground slab covering bounds from y -1 to 0',
      'solids',
      0,
    );
}

type BoundarySide = '-x' | '+x' | '-z' | '+z';

function boundarySide(box: Box, b: Box): BoundarySide | null {
  const fullZ = box.min.z <= b.min.z + EPS && box.max.z >= b.max.z - EPS;
  const fullX = box.min.x <= b.min.x + EPS && box.max.x >= b.max.x - EPS;
  const thickX = box.max.x - box.min.x >= 0.5 - EPS;
  const thickZ = box.max.z - box.min.z >= 0.5 - EPS;
  if (fullZ && thickX && Math.abs(box.min.x - b.min.x) <= EPS) return '-x';
  if (fullZ && thickX && Math.abs(box.max.x - b.max.x) <= EPS) return '+x';
  if (fullX && thickZ && Math.abs(box.min.z - b.min.z) <= EPS) return '-z';
  if (fullX && thickZ && Math.abs(box.max.z - b.max.z) <= EPS) return '+z';
  return null;
}

/** BR-M-11 and BR-M-12. */
function checkBoundaries(ctx: Ctx): void {
  const { def } = ctx;
  const b = def.bounds;
  const found = new Map<BoundarySide, number>();
  let count = 0;
  def.solids.forEach((s, i) => {
    if (s.kind !== 'boundary' || ctx.bad.solids.has(i)) return;
    count += 1;
    const side = boundarySide(s.box, b);
    if (side === null)
      add(
        ctx,
        'maps/boundary-gap',
        'boundary does not span a full side flush with bounds',
        'solids',
        i,
      );
    else if (!found.has(side)) found.set(side, i);
  });
  if (count !== 4 || found.size !== 4) {
    add(
      ctx,
      'maps/boundary-gap',
      `${count} boundary solids covering ${found.size} sides; need exactly 4`,
    );
  }
  const tops = walkableTopsWithRamps(ctx);
  for (const [side, i] of found) {
    const s = def.solids[i];
    if (s === undefined) continue;
    const top = s.box.max.y;
    if (top < 6 - EPS) {
      add(ctx, 'maps/boundary-too-low', `boundary top ${top} m; need 6`, 'solids', i);
      continue;
    }
    const inner =
      side === '-x'
        ? s.box.max.x
        : side === '+x'
          ? s.box.min.x
          : side === '-z'
            ? s.box.max.z
            : s.box.min.z;
    const near = tops.filter((t) => {
      if (side === '-x') return t.minX - inner <= 4;
      if (side === '+x') return inner - t.maxX <= 4;
      if (side === '-z') return t.minZ - inner <= 4;
      return inner - t.maxZ <= 4;
    });
    const highest = near.reduce((m, t) => Math.max(m, t.y), Number.NEGATIVE_INFINITY);
    if (top < highest + 3 - EPS) {
      add(
        ctx,
        'maps/boundary-too-low',
        `boundary only ${(top - highest).toFixed(2)} m above a walkable top within 4 m`,
        'solids',
        i,
      );
    }
  }
}

/** Walkable solid tops plus ramp tops, for BR-M-12. */
function walkableTopsWithRamps(ctx: Ctx): Top[] {
  const tops = walkableTops(ctx.def.solids, ctx.bad.solids);
  if (live(ctx, 'ramps')) {
    ctx.def.ramps.forEach((r, i) => {
      if (!ctx.bad.ramps.has(i)) tops.push({ ...rectOf(rampBox(r)), y: r.topY, source: -1 - i });
    });
  }
  return tops;
}

/** BR-M-13: bounds.max.y at least 2 m above the highest solid top. */
function checkHeadroom(ctx: Ctx): void {
  const highest = ctx.def.solids.reduce(
    (m, s, i) => (ctx.bad.solids.has(i) ? m : Math.max(m, s.box.max.y)),
    Number.NEGATIVE_INFINITY,
  );
  if (ctx.def.bounds.max.y < highest + 2 - EPS) {
    add(ctx, 'maps/out-of-bounds', 'bounds.max.y is less than 2 m above the highest solid');
  }
}

const isColour = (c: number): boolean => Number.isInteger(c) && c >= 0 && c <= 0xffffff;

/** Phase 4 (BR-M-30 to BR-M-35). */
function phaseMaterialsLighting(ctx: Ctx): void {
  const { def } = ctx;
  const ids = new Set<string>();
  if (live(ctx, 'materials')) {
    def.materials.forEach((m, i) => {
      if (ids.has(m.id))
        add(ctx, 'maps/duplicate-material', 'material id repeats an earlier one', 'materials', i);
      ids.add(m.id);
      if (ctx.bad.materials.has(i)) return;
      const ok =
        m.roughness >= 0 &&
        m.roughness <= 1 &&
        m.metalness >= 0 &&
        m.metalness <= 1 &&
        m.repeatM > 0 &&
        isColour(m.base) &&
        isColour(m.accent);
      if (!ok) add(ctx, 'maps/lighting-invalid', 'material channel out of range', 'materials', i);
    });
    if (live(ctx, 'solids')) {
      def.solids.forEach((s, i) => {
        if (!ids.has(s.material))
          add(ctx, 'maps/unknown-material', 'solid material is not declared', 'solids', i);
      });
    }
    if (live(ctx, 'ramps')) {
      def.ramps.forEach((r, i) => {
        if (!ids.has(r.material))
          add(ctx, 'maps/unknown-material', 'ramp material is not declared', 'ramps', i);
      });
    }
  }
  if (ctx.lightingFinite) checkLighting(ctx);
}

function checkLighting(ctx: Ctx): void {
  const { def } = ctx;
  const L = def.lighting;
  const bad = (detail: string): void => {
    add(ctx, 'maps/lighting-invalid', detail, 'lighting');
  };
  const len = Math.hypot(L.sunDir.x, L.sunDir.y, L.sunDir.z);
  if (Math.abs(len - 1) > 1e-3 || L.sunDir.y > -0.3)
    bad('sunDir must be a unit vector with y <= -0.3');
  if (!(L.sunIntensity > 0) || !(L.hemiIntensity > 0))
    bad('sun and hemisphere intensities must be > 0');
  if (![L.sunColour, L.hemiSky, L.hemiGround, L.background].every(isColour))
    bad('colour out of range');
  if (inverted(L.sunShadowBox)) bad('sunShadowBox is inverted');
  if (!ctx.over.has('locals')) {
    const shadows = L.locals.filter((l) => l.shadow).length;
    if (shadows > 1) bad(`${shadows} shadow-casting local lights; limit 1`);
    L.locals.forEach((l, i) => {
      if (l.kind === 'spot' && l.target === undefined) bad(`spot light ${i} has no target`);
      if (!isColour(l.colour) || !(l.intensity > 0) || !(l.range > 0))
        bad(`local light ${i} is invalid`);
    });
  }
  if (L.fog !== null) {
    const b = def.bounds;
    const diag = Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z);
    if (
      !(L.fog.near > 0 && L.fog.near < L.fog.far) ||
      L.fog.far < 1.2 * diag - EPS ||
      !isColour(L.fog.colour)
    ) {
      bad('fog must have 0 < near < far and far >= 1.2 x the bounds diagonal');
    }
  }
}

/** Phase 5: the walkable index. */
function phaseWalkable(ctx: Ctx): void {
  ctx.tops = live(ctx, 'solids') ? walkableTops(ctx.def.solids, ctx.bad.solids) : [];
}

/** Phase 6 (BR-M-38 to BR-M-41). */
function phaseRamps(ctx: Ctx): void {
  const { def } = ctx;
  if (!live(ctx, 'ramps') || !live(ctx, 'solids')) return;
  def.ramps.forEach((r, i) => {
    if (ctx.bad.ramps.has(i)) return;
    const { run, width } = rampRunWidth(r);
    if (
      !(r.minX < r.maxX && r.minZ < r.maxZ && r.topY > r.baseY) ||
      run < 1 - EPS ||
      width < 2 - EPS
    ) {
      add(
        ctx,
        'maps/ramp-degenerate',
        'ramp needs min < max, topY > baseY, run >= 1 m and width >= 2 m',
        'ramps',
        i,
      );
      return;
    }
    if ((r.topY - r.baseY) / run > MAP_RULES.maxRampSlope) {
      add(
        ctx,
        'maps/ramp-too-steep',
        `slope ${((r.topY - r.baseY) / run).toFixed(3)}; limit 0.5774`,
        'ramps',
        i,
      );
    }
    if (!edgeSupported(r, 'low', ctx.tops) || !edgeSupported(r, 'high', ctx.tops)) {
      add(ctx, 'maps/ramp-unsupported', 'ramp edge does not meet a walkable top', 'ramps', i);
      return;
    }
    const clear: Box = {
      min: { x: r.minX + EPS, y: r.baseY + EPS, z: r.minZ + EPS },
      max: { x: r.maxX - EPS, y: r.topY + MAP_RULES.agentHeight, z: r.maxZ - EPS },
    };
    const hit = def.solids.findIndex(
      (s, j) => !ctx.bad.solids.has(j) && boxesOverlap(s.box, clear),
    );
    if (hit >= 0)
      add(ctx, 'maps/ramp-unsupported', `solid ${hit} intrudes on the ramp`, 'ramps', i);
  });
}

/** Phase 7 (BR-M-42 to BR-M-49). */
function phaseSpawns(ctx: Ctx): void {
  const { def } = ctx;
  if (!live(ctx, 'spawns')) return;
  const n = def.spawns.length;
  if (n < 32 || n > 40) add(ctx, 'maps/spawn-count', `${n} spawns; need 32 to 40`, 'spawns');
  ctx.zones = groupZones(def.spawns, ctx.bad.spawns);
  for (const f of zoneFindings(def.spawns, ctx.zones))
    add(ctx, f.code, f.detail, 'spawns', f.index);
  const ok = (i: number): boolean => !ctx.bad.spawns.has(i);
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      const sa = def.spawns[a];
      const sb = def.spawns[b];
      if (sa === undefined || sb === undefined || !ok(a) || !ok(b)) continue;
      const d = Math.hypot(sa.pos.x - sb.pos.x, sa.pos.z - sb.pos.z);
      if (
        d < MAP_RULES.spawnMinGap - 1e-9 &&
        Math.abs(sa.pos.y - sb.pos.y) <= MAP_RULES.agentHeight
      ) {
        add(
          ctx,
          'maps/spawn-too-close',
          `spawns ${a} and ${b} are ${d.toFixed(2)} m apart`,
          'spawns',
          b,
        );
      }
    }
  }
  if (!live(ctx, 'solids') || !live(ctx, 'ramps')) return;
  def.spawns.forEach((s, i) => {
    if (!ok(i)) return;
    if (!standsOn(s.pos, ctx.tops, MAP_RULES.agentRadius)) {
      add(ctx, 'maps/spawn-not-on-floor', 'spawn is not on a walkable top', 'spawns', i);
    }
    const hit = capsuleBlocked(
      capsuleBox(s.pos, MAP_RULES.agentHeight),
      def.solids,
      def.ramps,
      ctx.bad.solids,
      ctx.bad.ramps,
    );
    if (hit !== null) add(ctx, 'maps/spawn-in-solid', `spawn capsule overlaps ${hit}`, 'spawns', i);
  });
}

/** Phase 8 (BR-M-52 to BR-M-58). */
function phaseCover(ctx: Ctx): void {
  const { def } = ctx;
  if (!live(ctx, 'cover')) return;
  const low = def.cover.filter((c) => c.height === 'low').length;
  const high = def.cover.length - low;
  if (def.cover.length < 24 || low < 8 || high < 8) {
    add(
      ctx,
      'maps/cover-count',
      `${def.cover.length} cover points (${low} low, ${high} high); need 24 with 8 of each`,
      'cover',
    );
  }
  if (live(ctx, 'solids') && live(ctx, 'ramps')) {
    def.cover.forEach((c, i) => {
      if (!ctx.bad.cover.has(i)) checkCoverPoint(ctx, c, i);
    });
  }
  const usable = def.cover.filter((_, i) => !ctx.bad.cover.has(i));
  for (const z of ctx.zones) {
    const nearby = usable.filter((c) => Math.hypot(c.pos.x - z.cx, c.pos.z - z.cz) <= 15).length;
    if (nearby < 2)
      add(
        ctx,
        'maps/cover-count',
        `zone #${z.order} has ${nearby} cover points within 15 m; need 2`,
        'cover',
      );
  }
  if (!live(ctx, 'features')) return;
  def.features.forEach((t, i) => {
    if (ctx.bad.features.has(i) || (t.feature !== 'courtyard' && t.feature !== 'open-area')) return;
    const inside = usable.filter((c) => boxContains(t.region, c.pos)).length;
    if (inside < 2)
      add(
        ctx,
        'maps/cover-count',
        `feature region ${i} holds ${inside} cover points; need 2`,
        'features',
        i,
      );
  });
}

function checkCoverPoint(ctx: Ctx, c: CoverPoint, i: number): void {
  const { def } = ctx;
  if (!standsOn(c.pos, ctx.tops, MAP_RULES.agentRadius)) {
    add(ctx, 'maps/cover-not-on-floor', 'cover point is not on a walkable top', 'cover', i);
  }
  const h = c.height === 'low' ? MAP_RULES.crouchHeight : MAP_RULES.agentHeight;
  const hit = capsuleBlocked(
    capsuleBox(c.pos, h),
    def.solids,
    def.ramps,
    ctx.bad.solids,
    ctx.bad.ramps,
  );
  if (hit !== null) add(ctx, 'maps/cover-in-solid', `cover capsule overlaps ${hit}`, 'cover', i);
  const solid = Number.isInteger(c.solid) ? def.solids[c.solid] : undefined;
  const flen = Math.hypot(c.facing.x, c.facing.y, c.facing.z);
  if (
    solid === undefined ||
    ctx.bad.solids.has(c.solid) ||
    c.facing.y !== 0 ||
    Math.abs(flen - 1) > 1e-6
  ) {
    add(
      ctx,
      'maps/cover-bad-facing',
      'facing must be a unit xz vector and solid a valid index',
      'cover',
      i,
    );
    return;
  }
  const rect = rectOf(solid.box);
  const d = rectDistance(rect, c.pos.x, c.pos.z);
  const cp = closestPoint(rect, c.pos.x, c.pos.z);
  const dot = d > 0 ? ((cp.x - c.pos.x) * c.facing.x + (cp.z - c.pos.z) * c.facing.z) / d : 0;
  if (d < 0.4 - EPS || d > 0.9 + EPS || dot < 0.9) {
    add(
      ctx,
      'maps/cover-not-adjacent',
      `cover is ${d.toFixed(2)} m from its solid (dot ${dot.toFixed(2)})`,
      'cover',
      i,
    );
  }
  const rise = solid.box.max.y - c.pos.y;
  const fits = c.height === 'low' ? rise >= 1.25 - EPS && rise <= 1.6 + EPS : rise >= 2.0 - EPS;
  if (!fits)
    add(ctx, 'maps/cover-height-mismatch', `covering solid rises ${rise.toFixed(2)} m`, 'cover', i);
}

/** Phase 9 (BR-M-59, BR-M-60). */
function phaseHints(ctx: Ctx): void {
  const { def } = ctx;
  if (!live(ctx, 'navHints')) return;
  const patrols = def.navHints.flatMap((h, i) =>
    h.kind === 'patrol' && !ctx.bad.navHints.has(i) ? [h.pos] : [],
  );
  if (patrols.length < 12)
    add(ctx, 'maps/patrol-count', `${patrols.length} patrol hints; need 12`, 'navHints');
  for (const z of ctx.zones) {
    if (!patrols.some((p) => Math.hypot(p.x - z.cx, p.z - z.cz) <= 20)) {
      add(ctx, 'maps/patrol-count', `no patrol hint within 20 m of zone #${z.order}`, 'navHints');
    }
  }
  if (live(ctx, 'features')) {
    def.features.forEach((t, i) => {
      if (
        ctx.bad.features.has(i) ||
        (t.feature !== 'elevated-position' && t.feature !== 'elevated-platform')
      )
        return;
      if (!patrols.some((p) => boxContains(t.region, p))) {
        add(ctx, 'maps/patrol-count', `no patrol hint in elevated region ${i}`, 'features', i);
      }
    });
  }
  if (!live(ctx, 'solids') || !live(ctx, 'ramps')) return;
  def.navHints.forEach((h, i) => {
    if (h.kind === 'exclude' || ctx.bad.navHints.has(i)) return;
    const onRamp = def.ramps.some((r, j) => {
      if (ctx.bad.ramps.has(j)) return false;
      const y = rampSurfaceY(r, h.pos.x, h.pos.z);
      return y !== null && Math.abs(y - h.pos.y) <= 0.05;
    });
    if (!onRamp && !standsOn(h.pos, ctx.tops, 0)) {
      add(
        ctx,
        'maps/hint-not-on-floor',
        'hint is not on a walkable top or ramp surface',
        'navHints',
        i,
      );
    }
  });
}

/** Phase 10 (BR-M-62, BR-M-63). */
function phaseFeatures(ctx: Ctx): void {
  const { def } = ctx;
  if (!live(ctx, 'features')) return;
  const required = REQUIRED_FEATURES[def.id] as readonly string[] | undefined;
  for (const feature of required ?? []) {
    if (!def.features.some((t) => t.feature === feature)) {
      add(ctx, 'maps/feature-missing', `required feature ${feature} has no tag`, 'features');
    }
  }
  if (
    !live(ctx, 'solids') ||
    !live(ctx, 'ramps') ||
    !live(ctx, 'cover') ||
    !live(ctx, 'spawns') ||
    !live(ctx, 'navHints')
  )
    return;
  def.features.forEach((t, i) => {
    if (ctx.bad.features.has(i)) return;
    const rule = Object.prototype.hasOwnProperty.call(BACKING, t.feature)
      ? BACKING[t.feature]
      : undefined;
    const reason = rule === undefined ? 'unknown feature' : rule(def, t);
    if (reason !== null)
      add(ctx, 'maps/feature-unbacked', `${t.feature}: ${reason}`, 'features', i);
  });
}

/** Dressing budgets (BR-G-26). */
export const DRESSING_BUDGETS = Object.freeze({ props: 200, scatter: 32, backdrop: 48 } as const);
/** Vegetation inside the play space stays under this height (BR-G-31). */
export const PLAY_VEGETATION_MAX_M = 0.6;
/** Backdrop sits between the bounds and this radius (BR-G-33). */
export const BACKDROP_MAX_M = 140;

function xzGap(
  b: { min: { x: number; z: number }; max: { x: number; z: number } },
  x: number,
  z: number,
): number {
  const dx = Math.max(b.min.x - x, 0, x - b.max.x);
  const dz = Math.max(b.min.z - z, 0, z - b.max.z);
  return Math.hypot(dx, dz);
}

/** Phase 11 (BR-G-20..33, graphics uplift): props, scatter and backdrop. */
function phaseDressing(ctx: Ctx): void {
  const { def } = ctx;
  const d = def.dressing;
  if (d === undefined) return;
  if (!numbersFinite(d)) {
    add(ctx, 'maps/non-finite', 'dressing has a non-finite number', 'dressing');
    return;
  }
  for (const [list, limit] of Object.entries(DRESSING_BUDGETS) as [
    keyof typeof DRESSING_BUDGETS,
    number,
  ][]) {
    if (d[list].length > limit) {
      add(
        ctx,
        'maps/budget-exceeded',
        `${d[list].length} dressing ${list}; budget ${limit}`,
        'dressing',
      );
      return;
    }
  }
  const catalog = new Map(d.catalog.map((c) => [c.id, c] as const));
  d.props.forEach((p, i) => {
    const c = catalog.get(p[0]);
    if (c === undefined) {
      add(ctx, 'maps/prop-unknown-model', `prop ${i} names an unknown model`, 'dressing', i);
      return;
    }
    const q = p[4] as number;
    const okTurn = Number.isInteger(q) && q >= 0 && q <= 3;
    const okScale = p[5] >= 0.75 && p[5] <= c.maxScale;
    if (!okTurn || (c.kind !== 'visual' && !okScale) || p[5] <= 0) {
      add(ctx, 'maps/prop-bad-transform', `prop ${i} has a bad turn or scale`, 'dressing', i);
    }
  });
  for (const r of d.scatter) {
    const c = catalog.get(r.kind);
    if (c === undefined) {
      add(ctx, 'maps/prop-unknown-model', 'scatter names an unknown model', 'dressing');
      continue;
    }
    const h = (c.visualBounds.max[1] ?? 0) * r.scale[1];
    const inPlay = boxContains(def.bounds, {
      x: (r.region.min.x + r.region.max.x) / 2,
      y: r.region.min.y,
      z: (r.region.min.z + r.region.max.z) / 2,
    });
    if (inPlay && h > PLAY_VEGETATION_MAX_M) {
      add(
        ctx,
        'maps/tall-vegetation-in-play',
        `${r.kind} reaches ${h.toFixed(2)} m in the play space`,
        'dressing',
      );
    }
  }
  d.backdrop.forEach((b, i) => {
    const r = Math.hypot(b.pos.x, b.pos.z);
    if (!catalog.has(b.model))
      add(ctx, 'maps/prop-unknown-model', `backdrop ${i} names an unknown model`, 'dressing', i);
    else if (boxContains(def.bounds, b.pos) || r > BACKDROP_MAX_M) {
      add(
        ctx,
        'maps/dressing-invalid',
        `backdrop ${i} is not between the bounds and ${BACKDROP_MAX_M} m`,
        'dressing',
        i,
      );
    }
  });
  // Prop clearance (BR-G-23): 1 m from spawns, cover and hints; 2 m from ramp footprints.
  def.solids.forEach((s, i) => {
    if (s.prop === undefined || ctx.bad.solids.has(i)) return;
    if (def.spawns.some((sp) => xzGap(s.box, sp.pos.x, sp.pos.z) < 1)) {
      add(ctx, 'maps/prop-near-spawn', `prop solid ${i} is within 1 m of a spawn`, 'solids', i);
    }
    if (def.cover.some((c) => xzGap(s.box, c.pos.x, c.pos.z) < 1)) {
      add(
        ctx,
        'maps/prop-near-cover',
        `prop solid ${i} is within 1 m of a cover point`,
        'solids',
        i,
      );
    }
    if (def.navHints.some((h) => h.kind !== 'exclude' && xzGap(s.box, h.pos.x, h.pos.z) < 1)) {
      add(ctx, 'maps/prop-near-hint', `prop solid ${i} is within 1 m of a nav hint`, 'solids', i);
    }
    const nearRamp = def.ramps.some(
      (r) =>
        s.box.min.x < r.maxX + 2 &&
        s.box.max.x > r.minX - 2 &&
        s.box.min.z < r.maxZ + 2 &&
        s.box.max.z > r.minZ - 2,
    );
    if (nearRamp)
      add(ctx, 'maps/prop-near-ramp', `prop solid ${i} is within 2 m of a ramp`, 'solids', i);
  });
}

/**
 * Pure data checks (BR-M-*). Returns [] for a valid map. Never throws for a
 * structurally typed input. Issues are ordered by phase, then list, then index.
 */
export function checkMapData(def: MapDefinition): readonly MapDataIssue[] {
  const ctx: Ctx = {
    def,
    issues: [],
    bad: {
      solids: new Set(),
      ramps: new Set(),
      spawns: new Set(),
      cover: new Set(),
      navHints: new Set(),
      features: new Set(),
      materials: new Set(),
    },
    over: new Set(),
    boundsOk: true,
    lightingFinite: true,
    tops: [],
    zones: [],
  };
  phaseNumbers(ctx);
  phaseBudgets(ctx);
  phaseBounds(ctx);
  phaseMaterialsLighting(ctx);
  phaseWalkable(ctx);
  phaseRamps(ctx);
  phaseSpawns(ctx);
  phaseCover(ctx);
  phaseHints(ctx);
  phaseFeatures(ctx);
  phaseDressing(ctx);
  return ctx.issues;
}
