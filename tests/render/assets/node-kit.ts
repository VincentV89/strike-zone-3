/**
 * Node test kit for the graphics uplift: a real AssetRuntime (runtime.ts core) over a Node
 * platform. Models parse with the real GLTFLoader + meshopt decoder after the real V1/V2
 * checks; KTX2 files pass the real header checks and become a synthetic BC7 mip chain (the
 * Basis transcoder needs a Worker, which Node lacks). The port reads files from the repo:
 * under Vitest a `?url` import is the repo-relative path.
 */
import { readFileSync } from 'node:fs';
import { Texture, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Diagnostics } from '../../../src/core';
import { checkGlb, checkKtx2, codedError } from '../../../src/render/assets/glb-check';
import { MANIFEST } from '../../../src/render/assets/manifest';
import { createRuntimeCore, type RuntimePlatform } from '../../../src/render/assets/runtime';
import { TEXTURE_SETS } from '../../../src/render/assets/texture-sets';
import type {
  AssetEntry,
  AssetKitModule,
  AssetPort,
  AssetRuntime,
  ParsedAsset,
} from '../../../src/render/assets/types';

/** EXT_texture_compression_bptc RGBA_BPTC_UNORM (1 B/texel). */
export const BC7 = 0x8e8c;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export function readAsset(url: string): Uint8Array {
  return new Uint8Array(readFileSync(url.replace(/^\//, '')));
}

export async function nodeParse(entry: AssetEntry, bytes: Uint8Array): Promise<ParsedAsset> {
  if (entry.kind === 'model') {
    checkGlb(bytes);
    const g = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      '',
    );
    for (const n of entry.requiredNodes ?? []) {
      if (g.scene.getObjectByName(n) === undefined) throw codedError('render/asset-invalid');
    }
    return { kind: 'model', root: g.scene, animations: g.animations, triangles: 0 };
  }
  const h = checkKtx2(bytes, entry.maxTexturePx ?? 2048);
  const mipmaps = [];
  let total = 0;
  for (let l = 0; l < h.levels; l++) {
    const width = Math.max(1, h.width >> l);
    const height = Math.max(1, h.height >> l);
    mipmaps.push({ data: new Uint8Array(4), width, height });
    total += width * height;
  }
  return {
    kind: 'texture',
    width: h.width,
    height: h.height,
    mipmaps,
    format: BC7,
    type: 1009,
    srgb: entry.colour === 'srgb',
    bytes: total,
  };
}

export interface NodePlatformLog {
  uploads: number;
  binds: number;
  pmrem: number;
}

export function nodePlatform(log: NodePlatformLog): RuntimePlatform {
  return {
    parse: nodeParse,
    upload() {
      log.uploads += 1;
    },
    pmrem() {
      log.pmrem += 1;
      return new Texture();
    },
    clone: (o: Object3D) => clone(o),
    bind() {
      log.binds += 1;
    },
    dispose() {
      // nothing to free in Node
    },
  };
}

export function nodeRuntime(
  diagnostics: Diagnostics,
  log: NodePlatformLog = { uploads: 0, binds: 0, pmrem: 0 },
  manifest: readonly AssetEntry[] = MANIFEST,
): AssetRuntime {
  return createRuntimeCore({ diagnostics }, nodePlatform(log), manifest, TEXTURE_SETS);
}

export interface FakePort extends AssetPort {
  fetches: string[];
  kitLoads: number;
  /** URL substrings that fail with a network error. */
  failing: string[];
  kitFails: boolean;
  /** When set, fetches wait for it (abort tests). */
  gate: Promise<void> | null;
}

export function fakePort(diagnostics: Diagnostics, manifest?: readonly AssetEntry[]): FakePort {
  let kit: Promise<AssetKitModule> | null = null;
  const port: FakePort = {
    fetches: [],
    kitLoads: 0,
    failing: [],
    kitFails: false,
    gate: null,
    async fetchBytes(url, signal, onBytes) {
      port.fetches.push(url);
      if (port.gate !== null) await port.gate;
      if (signal.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      if (port.failing.some((f) => url.includes(f))) throw new Error('network');
      const b = readAsset(url);
      onBytes(b.byteLength);
      return b;
    },
    loadKit() {
      kit ??= (async () => {
        port.kitLoads += 1;
        await Promise.resolve();
        if (port.kitFails) throw new Error('chunk 404');
        return { createAssetRuntime: () => nodeRuntime(diagnostics, undefined, manifest) };
      })();
      return kit;
    },
  };
  return port;
}
