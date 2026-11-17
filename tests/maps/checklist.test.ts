/**
 * The map-content checklist (business-logic-model-map-data, workflow 4):
 * evidence for acceptance criterion 1 of story-desert-compound-map and
 * story-industrial-warehouse-map. Prints one line per backed feature tag.
 */
import { describe, expect, it } from 'vitest';
import { getMap, mapIds, REQUIRED_FEATURES } from '../../src/maps';
import { BACKING } from '../../src/maps/checklist';
import { at, copyOf, type MutableMap } from './helpers';

describe('map-content checklist', () => {
  it.each(mapIds().map((id) => [id]))('%s has a backed tag for every required feature', (id) => {
    const def = getMap(id);
    const lines: string[] = [];
    for (const feature of REQUIRED_FEATURES[id]) {
      const tags = def.features.filter((t) => t.feature === feature);
      expect(tags.length, `${id} ${feature} has no tag`).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(BACKING[feature](def, tag), `${id} ${feature} ${tag.label}`).toBeNull();
        lines.push(`${id} ${feature} ${tag.label}: backed`);
      }
    }
    console.log(lines.join('\n'));
  });

  it('lists the features named in the requirements', () => {
    expect(REQUIRED_FEATURES['desert-compound']).toHaveLength(9);
    expect(REQUIRED_FEATURES['industrial-warehouse']).toHaveLength(9);
    expect(Object.isFrozen(REQUIRED_FEATURES['desert-compound'])).toBe(true);
  });
});

/** Backing reason for the first tag of `feature` after a mutation. */
function reason(def: MutableMap, feature: keyof typeof BACKING): string | null {
  const tag = at(
    def.features,
    def.features.findIndex((t) => t.feature === feature),
  );
  return BACKING[feature](def, tag);
}

describe('backing rules reject geometry that does not match the tag', () => {
  it('terrain needs sand under foot', () => {
    const d = copyOf('desert-compound');
    at(d.solids, 0).material = 'concrete';
    expect(reason(d, 'terrain')).toMatch(/terrain material/);
  });

  it('a narrow corridor must be clear and enclosed', () => {
    const d = copyOf('desert-compound');
    const t = at(
      d.features,
      d.features.findIndex((f) => f.feature === 'narrow-corridor'),
    );
    d.solids.push({
      kind: 'crate',
      material: 'wood',
      box: { min: { x: -29, y: 0, z: 0 }, max: { x: -28.5, y: 1, z: 1 } },
    });
    expect(BACKING['narrow-corridor'](d, t)).toMatch(/obstructed/);
    d.solids.pop();
    t.region.min.z += 6;
    t.region.max.z += 6;
    expect(BACKING['narrow-corridor'](d, t)).toMatch(/enclosed/);
  });

  it('a courtyard holds only crates and barriers', () => {
    const d = copyOf('desert-compound');
    d.solids.push({
      kind: 'building',
      material: 'plaster',
      box: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 3, z: 1 } },
    });
    expect(reason(d, 'courtyard')).toMatch(/other than crates/);
  });

  it('crates-barriers needs enough crates map-wide', () => {
    const d = copyOf('desert-compound');
    d.solids = d.solids.filter((s) => s.kind !== 'crate');
    expect(reason(d, 'crates-barriers')).toMatch(/crates/);
  });

  it('an elevated position needs a ramp up to it', () => {
    const d = copyOf('desert-compound');
    d.ramps = [];
    expect(reason(d, 'elevated-position')).toMatch(/ramp/);
  });

  it('spawn-areas needs one tag per zone', () => {
    const d = copyOf('desert-compound');
    d.features = d.features.filter((t, i) => t.feature !== 'spawn-areas' || i % 2 === 0);
    expect(reason(d, 'spawn-areas')).toMatch(/tags for/);
  });

  it('routes need two tags with patrol points', () => {
    const d = copyOf('desert-compound');
    d.navHints = d.navHints.filter((h) => h.kind !== 'patrol');
    expect(reason(d, 'interconnected-paths')).toMatch(/patrol/);
  });

  it('containers must keep ISO sizes and never float', () => {
    const d = copyOf('industrial-warehouse');
    const stacked = at(
      d.solids,
      d.solids.findIndex((s) => s.kind === 'container' && s.box.min.y > 1),
    );
    stacked.box.min.x += 3;
    stacked.box.max.x += 3;
    expect(reason(d, 'shipping-containers')).toMatch(/floating/);
    stacked.box.max.y += 1;
    expect(reason(d, 'shipping-containers')).toMatch(/ISO/);
  });

  it('storage racks need 2 m aisles', () => {
    const d = copyOf('industrial-warehouse');
    const rack = at(d.solids, d.solids.findIndex((s) => s.kind === 'rack') + 1);
    rack.box.min.z -= 1;
    rack.box.max.z -= 1;
    expect(reason(d, 'storage-area')).toMatch(/aisle/);
  });

  it('a walkway needs headroom and width', () => {
    const d = copyOf('industrial-warehouse');
    d.solids.push({
      kind: 'crate',
      material: 'wood',
      box: { min: { x: 0, y: 4, z: 24 }, max: { x: 1, y: 5, z: 25 } },
    });
    expect(reason(d, 'walkway')).toMatch(/headroom/);
  });

  it('an open area holds few low solids', () => {
    const d = copyOf('industrial-warehouse');
    d.solids.push({
      kind: 'wall',
      material: 'steel',
      box: { min: { x: 0, y: 0, z: -22 }, max: { x: 1, y: 5, z: -21 } },
    });
    expect(reason(d, 'open-area')).toMatch(/taller/);
  });

  it('the warehouse interior needs a big, high roof', () => {
    const d = copyOf('industrial-warehouse');
    d.solids = d.solids.filter((s) => s.kind !== 'roof');
    expect(reason(d, 'warehouse-interior')).toMatch(/roof/);
  });

  it('cover is tagged over the whole map', () => {
    const d = copyOf('industrial-warehouse');
    at(
      d.features,
      d.features.findIndex((t) => t.feature === 'cover'),
    ).region.max.x = 0;
    expect(reason(d, 'cover')).toMatch(/bounds/);
  });

  it('elevated-platform needs a platform at 3 m or higher', () => {
    const d = copyOf('industrial-warehouse');
    for (const s of d.solids) if (s.kind === 'platform') s.kind = 'floor';
    expect(reason(d, 'elevated-platform')).toMatch(/platform/);
  });
});
