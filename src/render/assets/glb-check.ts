/**
 * V1 container and V2 schema checks (security-design-graphics-uplift §3, BR-G-06).
 * Runs before any decoder sees the bytes. The only src/render file allowed JSON.parse;
 * the parsed object is read with Object.hasOwn only and never handed to a loader.
 * Lazy kit chunk.
 */
import type { AssetFailureCode, CodedError } from './types';

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_GLB_JSON_BYTES = 1024 * 1024;
export const MAX_NODES = 2048;
export const MAX_ANIMATION_CHANNELS = 4096;
const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const ALLOWED_REQUIRED = new Set(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
/** KTX2 supercompression schemes: none, BasisLZ, Zstandard. */
const SUPERCOMPRESSION = new Set([0, 1, 2]);

export function codedError(code: AssetFailureCode): CodedError {
  const e = new Error(code) as Error & { code: AssetFailureCode };
  e.code = code;
  return e;
}

function invalid(): CodedError {
  return codedError('render/asset-invalid');
}

const own = (o: unknown, k: string): unknown =>
  typeof o === 'object' && o !== null && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined;

const arr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

/** Throws render/asset-invalid unless `bytes` is a well-formed GLB that obeys BR-G-06. */
export function checkGlb(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_ASSET_BYTES || bytes.byteLength < 28) throw invalid();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC || dv.getUint32(4, true) !== 2) throw invalid();
  if (dv.getUint32(8, true) !== bytes.byteLength) throw invalid();
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== CHUNK_JSON || jsonLen % 4 !== 0) throw invalid();
  if (jsonLen > MAX_GLB_JSON_BYTES || 20 + jsonLen + 8 > bytes.byteLength) throw invalid();
  const binOffset = 20 + jsonLen;
  const binLen = dv.getUint32(binOffset, true);
  if (dv.getUint32(binOffset + 4, true) !== CHUNK_BIN || binLen % 4 !== 0) throw invalid();
  if (binOffset + 8 + binLen !== bytes.byteLength) throw invalid();
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  } catch {
    throw invalid();
  }
  checkGltfJson(json, binLen);
}

/** V2 schema rules over the parsed JSON chunk. */
export function checkGltfJson(json: unknown, binLen: number): void {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw invalid();
  for (const k of ['images', 'textures', 'samplers']) if (arr(own(json, k)).length > 0) throw invalid();
  const buffers = arr(own(json, 'buffers'));
  if (buffers.length !== 1) throw invalid();
  for (const b of buffers) {
    if (own(b, 'uri') !== undefined) throw invalid();
    const len = own(b, 'byteLength');
    if (typeof len !== 'number' || len > binLen) throw invalid();
  }
  for (const e of arr(own(json, 'extensionsRequired'))) {
    if (typeof e !== 'string' || !ALLOWED_REQUIRED.has(e)) throw invalid();
  }
  if (arr(own(json, 'nodes')).length > MAX_NODES) throw invalid();
  let channels = 0;
  for (const a of arr(own(json, 'animations'))) channels += arr(own(a, 'channels')).length;
  if (channels > MAX_ANIMATION_CHANNELS) throw invalid();
  const views = arr(own(json, 'bufferViews'));
  for (const v of views) {
    const off = own(v, 'byteOffset') ?? 0;
    const len = own(v, 'byteLength');
    if (typeof off !== 'number' || typeof len !== 'number' || off < 0 || len < 0) throw invalid();
    // meshopt-compressed views name a fallback buffer range; the real data is in the extension.
    const ext = own(own(v, 'extensions'), 'EXT_meshopt_compression');
    if (ext === undefined && off + len > binLen) throw invalid();
  }
  for (const a of arr(own(json, 'accessors'))) {
    const view = own(a, 'bufferView');
    if (view !== undefined && (typeof view !== 'number' || view < 0 || view >= views.length)) {
      throw invalid();
    }
    const count = own(a, 'count');
    if (typeof count !== 'number' || count < 0 || count > 4_000_000) throw invalid();
  }
}

export interface Ktx2Header {
  readonly width: number;
  readonly height: number;
  readonly levels: number;
}

/** V1 for KTX2: identifier, level count, dimensions, supercompression, level index bounds. */
export function checkKtx2(bytes: Uint8Array, maxPx: number): Ktx2Header {
  if (bytes.byteLength > MAX_ASSET_BYTES || bytes.byteLength < 80) throw invalid();
  for (let i = 0; i < KTX2_ID.length; i++) if (bytes[i] !== KTX2_ID[i]) throw invalid();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = dv.getUint32(20, true);
  const height = dv.getUint32(24, true);
  const levels = dv.getUint32(40, true);
  const scheme = dv.getUint32(44, true);
  if (width < 1 || height < 1 || width > maxPx || height > maxPx) throw invalid();
  if (levels < 1 || levels > 16 || !SUPERCOMPRESSION.has(scheme)) throw invalid();
  // Level index: 24 bytes per level starting at byte 80, all within the file.
  if (80 + levels * 24 > bytes.byteLength) throw invalid();
  for (let l = 0; l < levels; l++) {
    const o = 80 + l * 24;
    const off = Number(dv.getBigUint64(o, true));
    const len = Number(dv.getBigUint64(o + 8, true));
    if (off + len > bytes.byteLength) throw invalid();
  }
  // Full mip chain down to 1x1 (BR-G-07).
  const full = Math.floor(Math.log2(Math.max(width, height))) + 1;
  if (levels !== full) throw invalid();
  return { width, height, levels };
}
