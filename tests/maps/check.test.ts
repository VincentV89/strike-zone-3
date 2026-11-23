/**
 * checkMapData: both shipped maps are clean (BR-M-87), output is
 * deterministic (BR-M-86), every issue code has a negative case (BR-M-93),
 * and the checker is total and bounded (SEC-M-05).
 */
import { describe, expect, it, vi } from 'vitest';
import { checkMapData, getMap, mapIds, type MapDataIssueCode } from '../../src/maps';
import { ALL_ISSUE_CODES, at, codes, copyOf, type MutableMap } from './helpers';

describe('shipped maps', () => {
  it.each(mapIds().map((id) => [id]))('%s passes every data rule', (id) => {
    expect(checkMapData(getMap(id))).toEqual([]);
  });

  it('carries 32 to 40 spawns in 4 to 6 zones on each map', () => {
    for (const id of mapIds()) {
      const def = getMap(id);
      const zones = new Set(def.spawns.map((s) => s.zone));
      expect(def.spawns.length).toBeGreaterThanOrEqual(32);
      expect(def.spawns.length).toBeLessThanOrEqual(40);
      expect(zones.size).toBeGreaterThanOrEqual(4);
      expect(zones.size).toBeLessThanOrEqual(6);
    }
  });
});

describe('determinism (BR-M-86)', () => {
  it('returns the same issues in the same order for the same input', () => {
    const def = copyOf('desert-compound');
    at(def.spawns, 0).pos.y = 0.5;
    at(def.cover, 0).height = 'high';
    at(def.solids, 5).material = 'nope';
    const first = checkMapData(def);
    expect(first.length).toBeGreaterThan(2);
    expect(checkMapData(def)).toStrictEqual(first);
  });

  it('re-evaluating the map modules gives equal definitions and results', async () => {
    vi.resetModules();
    const again = await import('../../src/maps/index');
    for (const id of mapIds()) {
      expect(again.getMap(id)).toStrictEqual(getMap(id));
      expect(again.checkMapData(again.getMap(id))).toStrictEqual(checkMapData(getMap(id)));
    }
  });
});

type Mutation = (d: MutableMap) => void;

const patrolIndex = (d: MutableMap): number => d.navHints.findIndex((h) => h.kind === 'patrol');

/** One mutation per issue code (BR-M-93). Desert Compound unless noted. */
const NEGATIVE: Record<MapDataIssueCode, Mutation> = {
  'maps/non-finite': (d) => {
    at(d.solids, 5).box.min.x = Number.NaN;
  },
  'maps/out-of-bounds': (d) => {
    at(d.spawns, 0).pos.x = 100;
  },
  'maps/ground-gap': (d) => {
    at(d.solids, 0).kind = 'floor';
  },
  'maps/boundary-gap': (d) => {
    at(d.solids, 1).box.max.z = 10;
  },
  'maps/boundary-too-low': (d) => {
    at(d.solids, 1).box.max.y = 5;
  },
  'maps/budget-exceeded': (d) => {
    const hint = at(d.navHints, 0);
    while (d.navHints.length <= 64) d.navHints.push(hint);
  },
  'maps/unknown-material': (d) => {
    at(d.solids, 5).material = 'unobtainium';
  },
  'maps/duplicate-material': (d) => {
    d.materials.push({ ...at(d.materials, 0) });
  },
  'maps/ramp-degenerate': (d) => {
    const r = at(d.ramps, 0);
    r.maxX = r.minX + 1.5;
  },
  'maps/ramp-too-steep': (d) => {
    at(d.ramps, 0).topY = 7;
  },
  'maps/ramp-unsupported': (d) => {
    const r = at(d.ramps, 0);
    r.minX += 5;
    r.maxX += 5;
  },
  'maps/spawn-count': (d) => {
    d.spawns.splice(30);
  },
  'maps/spawn-zones': (d) => {
    for (const s of d.spawns.slice(0, 8)) s.zone = 'ne';
  },
  'maps/spawn-zone-too-large': (d) => {
    at(d.spawns, 0).pos.z += 12;
  },
  'maps/spawn-zones-too-close': (d) => {
    for (const s of d.spawns.slice(0, 4)) s.zone = 'nw-split';
  },
  'maps/spawn-player-count': (d) => {
    for (const s of d.spawns) s.player = false;
  },
  'maps/spawn-too-close': (d) => {
    const a = at(d.spawns, 0);
    const b = at(d.spawns, 1);
    b.pos.x = a.pos.x + 1;
    b.pos.z = a.pos.z;
  },
  'maps/spawn-not-on-floor': (d) => {
    at(d.spawns, 0).pos.y = 0.5;
  },
  'maps/spawn-in-solid': (d) => {
    const crate = at(
      d.solids,
      d.solids.findIndex((s) => s.kind === 'crate'),
    );
    const s = at(d.spawns, 0);
    s.pos.x = (crate.box.min.x + crate.box.max.x) / 2;
    s.pos.z = (crate.box.min.z + crate.box.max.z) / 2;
  },
  'maps/cover-count': (d) => {
    d.cover.splice(10);
  },
  'maps/cover-not-on-floor': (d) => {
    at(d.cover, 0).pos.y = 0.3;
  },
  'maps/cover-in-solid': (d) => {
    at(d.cover, 0).pos.x += 0.4;
  },
  'maps/cover-bad-facing': (d) => {
    at(d.cover, 0).facing.y = 0.5;
  },
  'maps/cover-not-adjacent': (d) => {
    const f = at(d.cover, 0).facing;
    f.x = -f.x;
    f.z = -f.z;
  },
  'maps/cover-height-mismatch': (d) => {
    at(d.cover, 0).height = 'high';
  },
  'maps/hint-not-on-floor': (d) => {
    const h = at(d.navHints, patrolIndex(d));
    if (h.kind !== 'exclude') h.pos.y = 2;
  },
  'maps/patrol-count': (d) => {
    d.navHints = d.navHints.filter((h) => h.kind !== 'patrol');
  },
  'maps/feature-missing': (d) => {
    d.features = d.features.filter((t) => t.feature !== 'courtyard');
  },
  'maps/feature-unbacked': (d) => {
    const t = at(
      d.features,
      d.features.findIndex((f) => f.feature === 'courtyard'),
    );
    t.region.max.x = 0;
  },
  'maps/lighting-invalid': (d) => {
    d.lighting.sunDir = { x: 0, y: 1, z: 0 };
  },
  // Graphics uplift dressing (BR-G-21..33).
  'maps/prop-unknown-model': (d) => {
    const p = d.dressing?.props[0];
    if (p !== undefined) p[0] = 'no-such-prop';
  },
  'maps/prop-bad-transform': (d) => {
    const p = d.dressing?.props[0];
    if (p !== undefined) p[5] = 9;
  },
  'maps/prop-near-spawn': (d) => {
    const s = d.solids.find((x) => x.prop !== undefined);
    const sp = at(d.spawns, 0);
    if (s !== undefined)
      s.box = {
        min: { x: sp.pos.x + 0.5, y: 0, z: sp.pos.z },
        max: { x: sp.pos.x + 0.9, y: 0.5, z: sp.pos.z + 0.4 },
      };
  },
  'maps/prop-near-cover': (d) => {
    const s = d.solids.find((x) => x.prop !== undefined);
    const c = at(d.cover, 0);
    if (s !== undefined) {
      s.box = {
        min: { x: c.pos.x + 0.6, y: c.pos.y, z: c.pos.z },
        max: { x: c.pos.x + 1, y: c.pos.y + 0.5, z: c.pos.z + 0.4 },
      };
    }
  },
  'maps/prop-near-hint': (d) => {
    const s = d.solids.find((x) => x.prop !== undefined);
    const h = d.navHints.find((x) => x.kind === 'patrol');
    if (s !== undefined && h !== undefined) {
      s.box = {
        min: { x: h.pos.x + 0.5, y: h.pos.y, z: h.pos.z },
        max: { x: h.pos.x + 0.9, y: h.pos.y + 0.5, z: h.pos.z + 0.4 },
      };
    }
  },
  'maps/prop-near-ramp': (d) => {
    const s = d.solids.find((x) => x.prop !== undefined);
    const r = at(d.ramps, 0);
    if (s !== undefined)
      s.box = {
        min: { x: r.maxX + 1, y: 0, z: r.minZ },
        max: { x: r.maxX + 1.4, y: 0.5, z: r.minZ + 0.4 },
      };
  },
  'maps/tall-vegetation-in-play': (d) => {
    const r = d.dressing?.scatter[0];
    if (r !== undefined) r.scale = [1, 9];
  },
  'maps/dressing-invalid': (d) => {
    const b = d.dressing?.backdrop[0];
    if (b !== undefined) b.pos = { x: 0, y: 0, z: 0 };
  },
};

describe('negative cases (BR-M-93)', () => {
  it('has a case for every issue code', () => {
    expect(Object.keys(NEGATIVE).sort()).toEqual([...ALL_ISSUE_CODES].sort());
  });

  it.each(ALL_ISSUE_CODES.map((c) => [c]))('%s is reported', (code) => {
    const def = copyOf('desert-compound');
    NEGATIVE[code](def);
    expect(codes(checkMapData(def))).toContain(code);
  });

  it('reports one issue for one NaN rather than a cascade', () => {
    const def = copyOf('desert-compound');
    at(def.cover, 3).pos.x = Number.NaN;
    expect(checkMapData(def)).toEqual([
      { code: 'maps/non-finite', list: 'cover', index: 3, detail: expect.any(String) as string },
    ]);
  });

  it('reports exactly the mutated element for simple data errors', () => {
    const def = copyOf('desert-compound');
    at(def.solids, 7).material = 'nope';
    expect(checkMapData(def)).toEqual([
      {
        code: 'maps/unknown-material',
        list: 'solids',
        index: 7,
        detail: expect.any(String) as string,
      },
    ]);
  });

  it('checks lighting rules on the warehouse (spot target, shadow count, fog)', () => {
    const def = copyOf('industrial-warehouse');
    for (const l of def.lighting.locals) l.shadow = true;
    const spot = at(def.lighting.locals, def.lighting.locals.length - 1);
    delete spot.target;
    def.lighting.fog = { colour: 0xffffff, near: 10, far: 50 };
    const issues = checkMapData(def).filter((i) => i.code === 'maps/lighting-invalid');
    expect(issues).toHaveLength(3);
  });

  it('flags an inverted box as an issue instead of throwing', () => {
    const def = copyOf('desert-compound');
    const b = at(def.solids, 5).box;
    [b.min.x, b.max.x] = [b.max.x, b.min.x];
    expect(checkMapData(def)).toContainEqual(
      expect.objectContaining({ code: 'maps/out-of-bounds', list: 'solids', index: 5 }),
    );
  });

  it('issue details never copy strings from the definition (SD-M-06)', () => {
    const def = copyOf('desert-compound');
    for (const t of def.features) t.label = 'LABEL-MARKER';
    for (const s of def.spawns) s.zone = s.zone + '-ZONE-MARKER';
    at(def.solids, 5).material = 'MATERIAL-MARKER';
    splitZone(def);
    const text = JSON.stringify(checkMapData(def));
    expect(text).not.toMatch(/MARKER/);
  });
});

/** Adds a spawn-zone violation so zone findings are produced as well. */
function splitZone(def: MutableMap): void {
  for (const s of def.spawns.slice(0, 4)) s.zone = 'SPLIT-MARKER';
}

describe('totality and bounds (SEC-M-05)', () => {
  it('does not throw for empty lists', () => {
    const def = copyOf('desert-compound');
    def.solids = [];
    def.ramps = [];
    def.spawns = [];
    def.cover = [];
    def.navHints = [];
    def.features = [];
    def.materials = [];
    def.lighting.locals = [];
    const issues = codes(checkMapData(def));
    expect(issues).toContain('maps/ground-gap');
    expect(issues).toContain('maps/spawn-count');
    expect(issues).toContain('maps/feature-missing');
  });

  it('finishes a 10 000-solid map quickly and skips pairwise work on over-budget lists', () => {
    const def = copyOf('desert-compound');
    const crate = at(
      def.solids,
      def.solids.findIndex((s) => s.kind === 'crate'),
    );
    while (def.solids.length < 10_000) def.solids.push(crate);
    while (def.spawns.length < 10_000) def.spawns.push(at(def.spawns, 0));
    const t0 = performance.now();
    const issues = codes(checkMapData(def));
    const ms = performance.now() - t0;
    console.log(`checkMapData on a 10k-solid, 10k-spawn fixture: ${ms.toFixed(1)} ms`);
    expect(issues.filter((c) => c === 'maps/budget-exceeded')).toHaveLength(2);
    expect(ms).toBeLessThan(200);
  });

  it('handles bounds with a non-finite number without throwing', () => {
    const def = copyOf('industrial-warehouse');
    def.bounds.max.y = Number.POSITIVE_INFINITY;
    expect(codes(checkMapData(def))).toContain('maps/non-finite');
  });
});
