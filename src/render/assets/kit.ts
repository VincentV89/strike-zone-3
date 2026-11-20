/**
 * The asset kit: the lazy chunk's entry (RA-G2, BR-G-02/03, security-design §2.2).
 * The only file that imports three/addons, limited by ESLint block C to GLTFLoader,
 * KTX2Loader, the meshopt decoder and SkeletonUtils. It is loaded by the single memoised
 * `import()` in src/app/main.ts, and the renderer calls it only after a successful init().
 *
 * Every texture is a separate KTX2 entry parsed from bytes (KTX2Loader.parse, never load),
 * so no blob: or data: URL is fetched (BR-G-18). GLBs carry no images (BR-G-06).
 */
import {
  Box3,
  PMREMGenerator,
  type CompressedTexture,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { checkGlb, checkKtx2, codedError } from './glb-check';
import { MANIFEST } from './manifest';
import { createRuntimeCore, type RuntimePlatform } from './runtime';
import { TEXTURE_SETS } from './texture-sets';
import type {
  AssetEntry,
  AssetRuntime,
  ParsedAsset,
  ParsedModel,
  ParsedTexture,
  RuntimeDeps,
} from './types';

const KTX2_WORKERS = 2;

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const b = bytes.buffer;
  if (b instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === b.byteLength)
    return b;
  return bytes.slice().buffer;
}

function lodTriangles(root: Object3D, lodSuffix: string | null): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as Partial<Mesh>;
    if (m.isMesh !== true || m.geometry === undefined) return;
    if (lodSuffix !== null) {
      let p: Object3D | null = o;
      let inLod = false;
      while (p !== null) {
        if (p.name.endsWith(lodSuffix)) inLod = true;
        p = p.parent;
      }
      if (!inLod) return;
    }
    const g = m.geometry;
    n += (g.index !== null ? g.index.count : (g.attributes['position']?.count ?? 0)) / 3;
  });
  return Math.round(n);
}

/** V4 semantic checks (BR-G-07, performance-design §3.2). */
function validateModel(
  entry: AssetEntry,
  root: Object3D,
  clips: readonly { name: string }[],
): void {
  const invalid = codedError('render/asset-invalid');
  for (const n of entry.requiredNodes ?? [])
    if (root.getObjectByName(n) === undefined) throw invalid;
  for (const c of entry.requiredClips ?? []) if (!clips.some((x) => x.name === c)) throw invalid;
  const isPack = (entry.requiredNodes ?? []).some((n) => n.endsWith('_LOD0'));
  const lod0 = lodTriangles(root, isPack ? '_LOD0' : null);
  if (entry.maxTriangles !== undefined && lod0 > entry.maxTriangles) throw invalid;
  if (entry.lod1MaxTriangles !== undefined) {
    if (lodTriangles(root, '_LOD1') > entry.lod1MaxTriangles) throw invalid;
    // Characters: each LOD is exactly one skinned primitive with one material.
    for (const suffix of ['_LOD0', '_LOD1']) {
      const node = root.getObjectByName(`${entry.key}${suffix}`);
      const skinned: SkinnedMesh[] = [];
      node?.traverse((o) => {
        if ((o as Partial<SkinnedMesh>).isSkinnedMesh === true) skinned.push(o as SkinnedMesh);
      });
      if (skinned.length !== 1 || Array.isArray(skinned[0]?.material)) throw invalid;
    }
  }
  root.traverse((o) => {
    const m = o as Partial<Mesh>;
    if (m.isMesh !== true || m.material === undefined) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (entry.textures?.[mat.name] === undefined) throw invalid;
    }
  });
  const box = new Box3().setFromObject(root);
  if (![box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)) {
    throw invalid;
  }
}

export function createAssetRuntime(deps: RuntimeDeps): AssetRuntime {
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ktx2 = new KTX2Loader().setWorkerLimit(KTX2_WORKERS);
  let gl: WebGLRenderer | null = null;
  let pmremGen: PMREMGenerator | null = null;

  async function parseModel(entry: AssetEntry, bytes: Uint8Array): Promise<ParsedModel> {
    checkGlb(bytes); // V1 + V2 before any decoder runs
    let result: Awaited<ReturnType<GLTFLoader['parseAsync']>>;
    try {
      result = await gltf.parseAsync(exactBuffer(bytes), '');
    } catch {
      throw codedError('render/asset-decode-failed');
    }
    const root = result.scene;
    const colliders: Object3D[] = [];
    root.traverse((o) => {
      if (o.name.startsWith('COL_')) colliders.push(o);
    });
    for (const c of colliders) c.removeFromParent();
    validateModel(entry, root, result.animations);
    return {
      kind: 'model',
      root,
      animations: result.animations,
      triangles: lodTriangles(root, null),
    };
  }

  async function parseTexture(entry: AssetEntry, bytes: Uint8Array): Promise<ParsedTexture> {
    const header = checkKtx2(bytes, entry.maxTexturePx ?? 2048);
    if (gl === null) throw codedError('render/asset-decode-failed');
    let tex: CompressedTexture;
    try {
      tex = await new Promise<CompressedTexture>((resolve, reject) => {
        ktx2.parse(
          exactBuffer(bytes),
          (t) => {
            resolve(t);
          },
          reject,
        );
      });
    } catch {
      throw codedError('render/asset-decode-failed');
    }
    const mips = tex.mipmaps as unknown as {
      data: ArrayBufferView;
      width: number;
      height: number;
    }[];
    const srgb = tex.colorSpace === 'srgb';
    if (mips.length !== header.levels || srgb !== (entry.colour === 'srgb')) {
      tex.dispose();
      throw codedError('render/asset-invalid');
    }
    let n = 0;
    for (const m of mips) n += m.data.byteLength;
    const parsed: ParsedTexture = {
      kind: 'texture',
      width: header.width,
      height: header.height,
      mipmaps: mips.map((m) => ({ data: m.data, width: m.width, height: m.height })),
      format: tex.format,
      type: tex.type,
      srgb,
      bytes: n,
    };
    tex.dispose(); // never uploaded; the runtime builds tiered textures from the kept mips
    return parsed;
  }

  const platform: RuntimePlatform = {
    parse(entry, bytes): Promise<ParsedAsset> {
      return entry.kind === 'model' ? parseModel(entry, bytes) : parseTexture(entry, bytes);
    },
    upload(t: Texture) {
      gl?.initTexture(t);
    },
    pmrem(sky: Texture) {
      if (pmremGen === null) return null;
      return pmremGen.fromEquirectangular(sky).texture;
    },
    clone: (o) => cloneSkinned(o),
    bind(target) {
      if (gl !== null) return;
      gl = target.renderer as WebGLRenderer;
      ktx2.detectSupport(gl);
      pmremGen = new PMREMGenerator(gl);
    },
    dispose() {
      ktx2.dispose();
      pmremGen?.dispose();
    },
  };
  return createRuntimeCore(deps, platform, MANIFEST, TEXTURE_SETS);
}
