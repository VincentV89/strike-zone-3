/** validateMap (BR-GS-13) and the hidden-spawn rule (BR-GS-21). */
import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/core';
import type { MapDefinition } from '../../src/maps';
import type { NavGraph } from '../../src/nav';
import type { CollisionWorld } from '../../src/physics';
import { prepareMap, validateMap } from '../../src/sim';
import { spawnCandidates } from '../../src/sim/validate';
import { copyOf } from '../maps/helpers';
import { MAPS } from './fixtures';

const codes = (r: { issues: readonly { code: string }[] }): string[] => r.issues.map((i) => i.code);

describe('validateMap on the shipped maps', () => {
  it.each(MAPS)('%s passes with every player spawn budget >= 20', (id) => {
    const m = prepareMap(id);
    const r = validateMap(m.def, m.world, m.nav);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.spawnBudget).toHaveLength(m.def.spawns.length);
    m.def.spawns.forEach((s, i) => {
      if (s.player) expect(r.spawnBudget[i]).toBeGreaterThanOrEqual(20);
      else expect(r.spawnBudget[i]).toBe(-1);
    });
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('measures the smallest budgets recorded in the design (Desert 24, Warehouse 21)', () => {
    const min = (id: (typeof MAPS)[number]): number =>
      Math.min(...prepareMap(id).validation.spawnBudget.filter((b) => b >= 0));
    expect(min('desert-compound')).toBe(24);
    expect(min('industrial-warehouse')).toBe(21);
  });

  it('candidates are >= 20 m away and hidden at every probe height', () => {
    const m = prepareMap('industrial-warehouse');
    const p = m.def.spawns.findIndex((s) => s.player);
    const ps = m.def.spawns[p] as MapDefinition['spawns'][number];
    const eye = vec3(ps.pos.x, ps.pos.y + 1.6, ps.pos.z);
    for (const i of spawnCandidates(m.def, m.world, p)) {
      const s = m.def.spawns[i] as MapDefinition['spawns'][number];
      expect(Math.hypot(s.pos.x - ps.pos.x, s.pos.z - ps.pos.z)).toBeGreaterThanOrEqual(20);
      for (const h of [0.3, 1.0, 1.6, 1.8]) {
        expect(m.world.lineOfSight(eye, vec3(s.pos.x, s.pos.y + h, s.pos.z))).toBe(false);
      }
    }
    expect(spawnCandidates(m.def, m.world, -1)).toEqual([]);
  });
});

describe('validateMap issue codes on mutated fixtures', () => {
  const base = prepareMap('desert-compound');

  it('raises sim/too-few-spawns (and the data issue) below 21 spawns', () => {
    const def = copyOf('desert-compound');
    def.spawns.splice(20);
    const r = validateMap(def, base.world, base.nav);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('sim/too-few-spawns');
  });

  it('raises sim/spawn-blocked for a spawn inside a solid', () => {
    const def = copyOf('desert-compound');
    const solid = def.solids.find((s) => s.kind === 'wall' || s.kind === 'container');
    const spawn = def.spawns[0];
    if (solid === undefined || spawn === undefined) throw new Error('fixture');
    spawn.pos = {
      x: (solid.box.min.x + solid.box.max.x) / 2,
      y: solid.box.min.y,
      z: (solid.box.min.z + solid.box.max.z) / 2,
    };
    const r = validateMap(def, base.world, base.nav);
    expect(r.issues.some((i) => i.code === 'sim/spawn-blocked' && i.index === 0)).toBe(true);
  });

  it('raises sim/nav-unattached and sim/nav-unreachable from the nav report', () => {
    const unattached: NavGraph = { ...base.nav, anchorNode: () => null };
    expect(codes(validateMap(base.def, base.world, unattached))).toContain('sim/nav-unattached');
    const split: NavGraph = {
      ...base.nav,
      reachable: () => false,
    };
    expect(codes(validateMap(base.def, base.world, split))).toContain('sim/nav-unreachable');
  });

  it('raises sim/spawn-budget when a fault makes every spawn visible', () => {
    // lineOfSight fails closed, so a fault would hide spawns; this world sees everything instead.
    const seeAll: CollisionWorld = { ...base.world, lineOfSight: () => true };
    const r = validateMap(base.def, seeAll, base.nav);
    expect(codes(r)).toContain('sim/spawn-budget');
    expect(Math.max(...r.spawnBudget)).toBe(0);
  });
});
