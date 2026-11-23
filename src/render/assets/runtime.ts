/**
 * AssetRuntime core (performance-design §1.2 "Kit runtime interface"). Lazy kit chunk.
 * kit.ts supplies the real parsers and the WebGL-only pieces; tests supply fakes, so the
 * texture tiering, slot binding and model texture binding run in Node.
 *
 * Texture tiers by mip drop (BR-G-43): a GPU texture is built from `mipmaps.slice(k)`,
 * where k is the smallest drop with width ≤ maxPx. The CPU chain stays in the library, so
 * a preset change re-tiers with no download, and a context restore re-uploads.
 */
import {
  CompressedTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  NoColorSpace,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';
import type { Diagnostics } from '../../core';
import { createCharacterApi } from './character';
import { applyPbrSets, attachViewmodel } from './apply';
import { createDressingApi } from './dressing';
import type {
  AssetEntry,
  AssetKey,
  AssetLookup,
  AssetRuntime,
  KitBindTarget,
  ParsedAsset,
  ParsedTexture,
  TextureSetTable,
  TextureSlot,
} from './types';

/** Bytes per texel by WebGL compressed format family (BR-G-72 estimate). */
export function bytesPerTexel(format: number): number {
  // ETC1/ETC2 RGB, BC1/DXT1, ETC2 EAC R11: 0.5 B; everything else block-compressed: 1 B; RGBA8: 4 B.
  const half = new Set([0x8d64, 0x9274, 0x9275, 0x83f0, 0x83f1, 0x8c4c, 0x8c4d, 0x9270]);
  if (half.has(format)) return 0.5;
  if (format === 1023 /* RGBAFormat */) return 4;
  return 1;
}

/** Smallest mip drop k with (width >> k) ≤ maxPx. */
export function mipDrop(width: number, height: number, levels: number, maxPx: number): number {
  let k = 0;
  while (k + 1 < levels && Math.max(width >> k, height >> k) > maxPx) k += 1;
  return k;
}

export interface RuntimePlatform {
  /** V1-V4 + decode. Rejects with a coded error. */
  parse(entry: AssetEntry, bytes: Uint8Array): Promise<ParsedAsset>;
  /** Called once per created texture so the upload happens outside render() (BR-G-01/§3.1). */
  upload(t: Texture): void;
  /** PMREM environment from an equirect texture, or null without WebGL. */
  pmrem(sky: Texture): Texture | null;
  clone(o: Object3D): Object3D;
  bind(target: KitBindTarget): void;
  dispose(): void;
}

interface Cached {
  tex: CompressedTexture;
  drop: number;
  bytes: number;
}

export function createRuntimeCore(
  deps: { readonly diagnostics: Diagnostics },
  platform: RuntimePlatform,
  manifest: readonly AssetEntry[],
  textureSets: TextureSetTable,
): AssetRuntime {
  const cache = new Map<AssetKey, Cached>();
  const slots: { material: Material; slot: TextureSlot; key: AssetKey }[] = [];
  const envs = new Map<AssetKey, Texture>();
  let maxPx = 2048;

  function build(key: AssetKey, p: ParsedTexture, repeat: boolean): Cached {
    const drop = mipDrop(p.width, p.height, p.mipmaps.length, maxPx);
    const mips = p.mipmaps
      .slice(drop)
      .map((m) => ({ data: m.data, width: m.width, height: m.height }));
    const top = mips[0] ?? { width: 1, height: 1 };
    const tex = new CompressedTexture(
      mips as unknown as ImageData[],
      top.width,
      top.height,
      p.format as never,
      p.type as never,
    );
    tex.name = key;
    tex.colorSpace = p.srgb ? SRGBColorSpace : NoColorSpace;
    tex.minFilter = mips.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    if (repeat) {
      tex.wrapS = RepeatWrapping;
      tex.wrapT = RepeatWrapping;
    }
    tex.needsUpdate = true;
    let bytes = 0;
    for (const m of mips) bytes += m.width * m.height * bytesPerTexel(p.format);
    platform.upload(tex);
    return { tex, drop, bytes };
  }

  function texture(key: AssetKey, lookup: AssetLookup): Texture | null {
    const hit = cache.get(key);
    if (hit !== undefined) return hit.tex;
    const p = lookup.texture(key);
    if (p === null) return null;
    const c = build(key, p, !key.startsWith('sky-'));
    if (key.startsWith('sky-')) c.tex.mapping = EquirectangularReflectionMapping;
    cache.set(key, c);
    return c.tex;
  }

  function setSlot(material: Material, slot: TextureSlot, tex: Texture): void {
    const m = material as MeshStandardMaterial;
    m[slot] = tex;
    m.needsUpdate = true;
  }

  function bindSlot(
    material: Material,
    slot: TextureSlot,
    key: AssetKey,
    lookup: AssetLookup,
  ): boolean {
    const tex = texture(key, lookup);
    if (tex === null) return false;
    setSlot(material, slot, tex);
    slots.push({ material, slot, key });
    return true;
  }

  function resolve(b: { set?: string; bc?: AssetKey; n?: AssetKey; orm?: AssetKey }): {
    bc?: AssetKey;
    n?: AssetKey;
    orm?: AssetKey;
  } {
    if (b.set !== undefined) {
      const s = textureSets[b.set];
      return s === undefined ? {} : { bc: s.bc, n: s.n, orm: s.orm };
    }
    return b;
  }

  /** Binds every mesh material of a model from its entry (BR-G-07); GLB factors stay as fallback. */
  function bindModelTextures(root: Object3D, entry: AssetEntry, lookup: AssetLookup): boolean {
    const done = new Set<Material>();
    let ok = true;
    root.traverse((o) => {
      const mesh = o as Partial<Mesh>;
      if (mesh.isMesh !== true || mesh.material === undefined) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (done.has(mat)) continue;
        done.add(mat);
        const b = entry.textures?.[mat.name];
        if (b === undefined) {
          ok = false;
          continue;
        }
        const keys = resolve(b);
        if (keys.bc === undefined || lookup.texture(keys.bc) === null) continue; // GLB colour factor fallback
        const allThree = keys.n !== undefined && keys.orm !== undefined;
        if (
          allThree &&
          (lookup.texture(keys.n ?? '') === null || lookup.texture(keys.orm ?? '') === null)
        ) {
          continue; // a set applies only when all three are ready (BR-G-70)
        }
        const std = mat as MeshStandardMaterial;
        bindSlot(mat, 'map', keys.bc, lookup);
        std.color.setRGB(1, 1, 1);
        if (allThree) {
          bindSlot(mat, 'normalMap', keys.n ?? '', lookup);
          bindSlot(mat, 'roughnessMap', keys.orm ?? '', lookup);
          bindSlot(mat, 'metalnessMap', keys.orm ?? '', lookup);
          bindSlot(mat, 'aoMap', keys.orm ?? '', lookup);
          std.roughness = 1;
          std.metalness = 1;
        }
      }
    });
    return ok;
  }

  const runtime: AssetRuntime = {
    manifest,
    textureSets,
    bind: (t) => {
      platform.bind(t);
    },
    parse: (e, b) => platform.parse(e, b),
    texture,
    bindSlot,
    releaseSlots() {
      slots.length = 0;
    },
    setMaxPx(px, lookup) {
      if (!(px > 0) || px === maxPx) return;
      maxPx = px;
      for (const [key, c] of cache) {
        if (key.startsWith('sky-')) continue;
        const p = lookup.texture(key);
        if (p === null) continue;
        const drop = mipDrop(p.width, p.height, p.mipmaps.length, maxPx);
        if (drop === c.drop) continue;
        const next = build(key, p, true);
        for (const s of slots) if (s.key === key) setSlot(s.material, s.slot, next.tex);
        c.tex.dispose();
        cache.set(key, next);
      }
    },
    environment(skyKey, lookup) {
      const hit = envs.get(skyKey);
      if (hit !== undefined) return hit;
      const sky = texture(skyKey, lookup);
      if (sky === null) return null;
      const env = platform.pmrem(sky);
      if (env !== null) envs.set(skyKey, env);
      return env;
    },
    textureBytes() {
      let n = 0;
      for (const c of cache.values()) n += c.bytes;
      return n;
    },
    textureFormats() {
      return [...new Set([...cache.values()].map((c) => c.tex.format as number))];
    },
    restore() {
      for (const c of cache.values()) c.tex.needsUpdate = true;
      for (const e of envs.values()) e.dispose();
      envs.clear();
    },
    character: createCharacterApi({
      clone: (o) => platform.clone(o),
      bindTextures: (r, e, l) => bindModelTextures(r, e, l),
    }),
    dressing: createDressingApi({ bindTextures: (r, e, l) => bindModelTextures(r, e, l) }),
    bindModelTextures,
    applyPbrSets: (def, materials, lookup) => applyPbrSets(def, materials, runtime, lookup),
    attachViewmodel: (rig, hide, socket, model, entry, lookup) =>
      attachViewmodel(rig, hide, socket, model, entry, runtime, lookup),
    dispose() {
      for (const c of cache.values()) c.tex.dispose();
      for (const e of envs.values()) e.dispose();
      cache.clear();
      envs.clear();
      platform.dispose();
    },
  };
  return runtime;
}
