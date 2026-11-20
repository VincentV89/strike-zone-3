/**
 * Kit runtime in Node (performance-design §1.2, §3.2, §3.4; BR-G-43/50..56/70/75):
 * texture tiers by mip drop, re-tier with no fetch, PBR sets all-or-nothing, the direct track
 * sampler on the real CC0 bot, and dressing placement/LOD over the real packs.
 */
import { MeshStandardMaterial, type Object3D, Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDiagnostics } from '../../../src/core';
import { getMap } from '../../../src/maps';
import {
  bindClips,
  clipTime,
  keyIndex,
  selectClip,
  slerpInto,
  type BoundClip,
} from '../../../src/render/assets/character';
import { hash2, placementsFor, unit } from '../../../src/render/assets/dressing';
import { MANIFEST } from '../../../src/render/assets/manifest';
import { bytesPerTexel, mipDrop } from '../../../src/render/assets/runtime';
import { TEXTURE_SETS } from '../../../src/render/assets/texture-sets';
import type {
  AssetEntry,
  AssetLookup,
  BotFrame,
  ParsedAsset,
  ParsedModel,
  ParsedTexture,
} from '../../../src/render/assets/types';
import { nodeParse, nodeRuntime, readAsset } from './node-kit';

const values = new Map<string, ParsedAsset>();
const lookup: AssetLookup = {
  texture: (k) => {
    const v = values.get(k);
    return v?.kind === 'texture' ? v : null;
  },
  model: (k) => {
    const v = values.get(k);
    return v?.kind === 'model' ? v : null;
  },
};
const byKey = (k: string): AssetEntry => {
  const e = MANIFEST.find((x) => x.key === k);
  if (e === undefined) throw new Error(k);
  return e;
};
async function load(key: string): Promise<void> {
  const e = byKey(key);
  values.set(key, await nodeParse(e, readAsset(e.url)));
}

function frame(over: Partial<BotFrame> = {}): BotFrame {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    speed: 0,
    crouch: false,
    alive: true,
    deathAge: -1,
    fireAge: -1,
    bright: 1,
    flash: 0,
    visible: true,
    ...over,
  };
}

beforeAll(async () => {
  for (const e of MANIFEST) await load(e.key);
}, 60_000);

describe('manifest', () => {
  it('lists every committed file once with its exact size and a hashed same-origin URL', async () => {
    const { statSync } = await import('node:fs');
    const keys = new Set<string>();
    for (const e of MANIFEST) {
      expect(keys.has(e.key)).toBe(false);
      keys.add(e.key);
      expect(statSync(e.url.slice(1)).size, e.key).toBe(e.bytes);
      expect(e.key).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('every texture set and model binding names a texture entry with the right colour space', () => {
    for (const set of Object.values(TEXTURE_SETS)) {
      expect(byKey(set.bc).colour).toBe('srgb');
      expect(byKey(set.n).colour).toBe('linear');
      expect(byKey(set.orm).colour).toBe('linear');
    }
    for (const e of MANIFEST.filter((x) => x.kind === 'model')) {
      for (const b of Object.values(e.textures ?? {})) {
        for (const k of [b.bc, b.n, b.orm])
          if (k !== undefined) expect(byKey(k).kind).toBe('texture');
      }
    }
  });

  it('every map texture-set key resolves (BR-G-70)', () => {
    for (const id of ['desert-compound', 'industrial-warehouse'] as const) {
      for (const m of getMap(id).materials)
        if (m.pbr !== undefined) expect(TEXTURE_SETS[m.pbr]).toBeDefined();
    }
  });
});

describe('texture tiers (BR-G-43, BR-G-72)', () => {
  it('mipDrop picks the smallest drop that fits; bytesPerTexel follows the format family', () => {
    expect(mipDrop(2048, 2048, 12, 2048)).toBe(0);
    expect(mipDrop(2048, 2048, 12, 1024)).toBe(1);
    expect(mipDrop(2048, 1024, 12, 512)).toBe(2);
    expect(mipDrop(4, 4, 1, 1)).toBe(0);
    expect(bytesPerTexel(0x9274)).toBe(0.5);
    expect(bytesPerTexel(1023)).toBe(4);
    expect(bytesPerTexel(0x8e8c)).toBe(1);
  });

  it('re-tiers bound textures from the kept mips with no fetch and swaps the material slot', () => {
    const log = { uploads: 0, binds: 0, pmrem: 0 };
    const rt = nodeRuntime(
      createDiagnostics(() => undefined),
      log,
    );
    rt.setMaxPx(2048, lookup);
    const mat = new MeshStandardMaterial();
    expect(rt.bindSlot(mat, 'map', 'tex-vm-rifle-bc', lookup)).toBe(true);
    const bc = byKey('tex-sand-bc');
    expect(rt.bindSlot(mat, 'normalMap', bc.key, lookup)).toBe(true);
    const before = mat.normalMap;
    const bytes2k = rt.textureBytes();
    rt.setMaxPx(512, lookup);
    expect(mat.normalMap).not.toBe(before);
    expect((mat.normalMap?.image as { width: number } | undefined)?.width).toBe(512);
    expect(rt.textureBytes()).toBeLessThan(bytes2k);
    expect(rt.textureFormats()).toEqual([0x8e8c]);
    expect(rt.bindSlot(mat, 'map', 'tex-missing', lookup)).toBe(false);
    rt.restore(lookup);
    expect(rt.environment('sky-desert-dusk', lookup)).not.toBeNull();
    expect(log.pmrem).toBe(1);
    rt.dispose();
  });

  it('applies a PBR set only when all three textures are ready (BR-G-70)', () => {
    const rt = nodeRuntime(createDiagnostics(() => undefined));
    const def = getMap('desert-compound');
    const mats = new Map(def.materials.map((m) => [m.id, new MeshStandardMaterial()] as const));
    const partial: AssetLookup = {
      texture: (k) => (k === TEXTURE_SETS['sand']?.orm ? null : lookup.texture(k)),
      model: (k) => lookup.model(k),
    };
    const all = def.materials.filter((m) => m.pbr !== undefined).length;
    expect(rt.applyPbrSets(def, mats, partial)).toBe(all - 1);
    expect(mats.get('sand')?.map).toBeNull();
    expect(rt.applyPbrSets(def, mats, lookup)).toBe(all);
    expect(mats.get('sand')?.normalMap).not.toBeNull();
  });
});

describe('direct track sampler (TS-G-02, BR-G-51..53)', () => {
  it('selects clips from snapshot data only', () => {
    expect(selectClip(frame({ alive: false }))).toBe('death');
    expect(selectClip(frame({ fireAge: 0.1 }))).toBe('shoot');
    expect(selectClip(frame({ fireAge: 0.1, speed: 3 }))).toBe('walk');
    expect(selectClip(frame({ crouch: true }))).toBe('crouch-idle');
    expect(selectClip(frame({ crouch: true, speed: 1 }))).toBe('crouch-walk');
    expect(selectClip(frame({ speed: 6 }))).toBe('run');
    expect(selectClip(frame())).toBe('idle');
  });

  it('samples keys with a cached hint, slerps normalised and loops or clamps time', () => {
    const t = Float32Array.from([0, 1, 2, 3]);
    expect(keyIndex(t, 2.5, 0)).toBe(2);
    expect(keyIndex(t, 0.5, 3)).toBe(0);
    const out = new Float32Array(4);
    const q1 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.2);
    slerpInto([0, 0, 0, 1], 0, [q1.x, q1.y, q1.z, q1.w], 0, 0.5, out);
    const half = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.6);
    expect(out[1]).toBeCloseTo(half.y, 5);
    expect(Math.hypot(...out)).toBeCloseTo(1, 6);
    const c = { name: 'walk', duration: 2, loop: true } as BoundClip;
    expect(clipTime(c, 5, 0, 1)).toBeCloseTo(1, 6);
    expect(clipTime({ ...c, loop: false }, 5, 0, 1)).toBe(2);
  });

  it('binds every required clip of the CC0 bot and poses 20 bots without allocation-heavy paths', () => {
    const model = lookup.model('bot-soldier') as ParsedModel;
    expect(model).not.toBeNull();
    const rt = nodeRuntime(createDiagnostics(() => undefined));
    const pool = rt.character.createPool(model, byKey('bot-soldier'), 20, lookup);
    expect(pool).not.toBeNull();
    if (pool === null) return;
    expect(pool.count).toBe(20);
    expect(pool.triangles[0]).toBeLessThanOrEqual(5000);
    expect(pool.triangles[1]).toBeLessThanOrEqual(2000);
    const names: string[] = [];
    pool.group.traverse((o: Object3D) => names.push(o.name));
    expect(names).toContain('bot-character:20');
    pool.setQuality(25, 30, false);
    const m = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < 20; k++) {
      pool.update(
        k,
        frame({ x: k * 3, speed: k % 3 === 0 ? 0 : 3, crouch: k % 4 === 0 }),
        1.25,
        0,
        0,
      );
      pool.muzzle(k, m);
      expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
    }
    // Death clip plays once and holds: two late times give the same pose.
    pool.update(0, frame({ alive: false, deathAge: 10 }), 20, 0, 0);
    pool.update(0, frame({ alive: false, deathAge: 12 }), 22, 0, 0);
    pool.update(1, frame({ visible: false }), 22, 0, 0);
    pool.resetBot(0);
    pool.dispose();
  });

  it('bindClips skips tracks whose bone is unknown', () => {
    const model = lookup.model('bot-soldier') as ParsedModel;
    const bound = bindClips(model.animations, ['Hips']);
    const idle = bound.get('idle');
    expect(idle?.bone.every((b) => b === 0)).toBe(true);
  });

  it('a bot entry without its LODs or clips falls back (pool is null)', () => {
    const rt = nodeRuntime(createDiagnostics(() => undefined));
    const model = lookup.model('vm-rifle') as ParsedModel;
    expect(
      rt.character.createPool(
        model,
        { ...byKey('bot-soldier'), textures: byKey('vm-rifle').textures ?? {} },
        2,
        lookup,
      ),
    ).toBeNull();
  });
});

describe('dressing (BR-G-30..35, BR-G-73/75)', () => {
  it('hash-selects scatter by density then cap, deterministically, keeping authored props', () => {
    const def = getMap('desert-compound');
    const cat = new Map((def.dressing?.catalog ?? []).map((c) => [c.id, c] as const));
    const props = def.dressing?.props.length ?? 0;
    const low = placementsFor(def, cat, 0.35, 1500);
    const high = placementsFor(def, cat, 1, 8000);
    expect(low.length).toBeLessThanOrEqual(1500);
    expect(high.length).toBeGreaterThan(low.length);
    expect(low.filter((p) => !p.optional)).toHaveLength(props);
    expect(placementsFor(def, cat, 0.35, 1500)).toEqual(low);
    expect(placementsFor(def, cat, 1, props).filter((p) => p.optional)).toHaveLength(0);
    expect(unit(hash2(1, 2))).toBeGreaterThanOrEqual(0);
    expect(unit(hash2(1, 2))).toBeLessThan(1);
    expect(placementsFor({ ...def, dressing: undefined }, cat, 1, 10)).toEqual([]);
  });

  it.each(['low', 'medium', 'high'] as const)(
    'builds the %s layer within the batch sub-cap and refreshes LODs',
    (preset) => {
      const caps = { low: [0.35, 1500, 24], medium: [0.7, 4000, 40], high: [1, 8000, 56] }[preset];
      const rt = nodeRuntime(createDiagnostics(() => undefined));
      for (const id of ['desert-compound', 'industrial-warehouse'] as const) {
        const def = getMap(id);
        const ready = new Set((def.dressing?.catalog ?? []).map((c) => c.asset));
        const layer = rt.dressing.build(def, lookup, {
          density: caps[0] ?? 1,
          cap: caps[1] ?? 1,
          lod0DistanceM: 25,
          drawDistanceM: 70,
          maxBatches: caps[2] ?? 1,
          sway: false,
          readyPacks: ready,
          manifest: MANIFEST,
        });
        expect(layer).not.toBeNull();
        if (layer === null) continue;
        expect(layer.batches).toBeLessThanOrEqual(caps[2] ?? 0);
        expect(layer.instances).toBeLessThanOrEqual(caps[1] ?? 0);
        layer.refresh(0, 1.6, 0, 0);
        let visible = 0;
        layer.group.traverse((o) => {
          const n = (o as { count?: number }).count;
          if (typeof n === 'number') visible += n;
        });
        expect(visible).toBeGreaterThan(0);
        layer.refresh(0.5, 1.6, 0, 0.1); // < 2 m and < 0.25 s: skipped
        layer.refresh(40, 1.6, 0, 1);
        layer.setCastShadow(true);
        layer.dispose();
      }
    },
  );

  it('omits packs that did not load (BR-G-14)', () => {
    const rt = nodeRuntime(createDiagnostics(() => undefined));
    const layer = rt.dressing.build(getMap('desert-compound'), lookup, {
      density: 1,
      cap: 8000,
      lod0DistanceM: 25,
      drawDistanceM: 70,
      maxBatches: 56,
      sway: false,
      readyPacks: new Set(),
      manifest: MANIFEST,
    });
    expect(layer?.instances).toBe(0);
  });
});

describe('parsed texture shape', () => {
  it('keeps the full CPU mip chain (BR-G-17)', () => {
    const t = lookup.texture('sky-desert-dusk') as ParsedTexture;
    expect(t.mipmaps.length).toBe(12);
    expect(t.srgb).toBe(true);
  });
});
