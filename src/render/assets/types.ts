/**
 * Asset pipeline types (domain-entities-graphics-uplift "Presentation-3d entities").
 * Types only: entry-chunk modules import this file, never the kit modules (security-design
 * §2.1), so the lazy chunk stays lazy.
 */
import type { AnimationClip, Material, Object3D, Texture } from 'three';
import type { MapId } from '../../contracts';
import type { Diagnostics } from '../../core';
import type { MapDefinition } from '../../maps';

export type AssetKey = string;
export type AssetKind = 'model' | 'texture' | 'sky';

/** Material name -> textures. Either a PBR set key or explicit asset keys (bc required). */
export interface TextureBinding {
  readonly set?: string;
  readonly bc?: AssetKey;
  readonly n?: AssetKey;
  readonly orm?: AssetKey;
}

export interface AssetEntry {
  readonly key: AssetKey;
  /** Hashed same-origin URL from a Vite `?url` import (BR-G-05). */
  readonly url: string;
  /** Exact file size; checked against the file by a test. */
  readonly bytes: number;
  readonly kind: AssetKind;
  readonly maps: 'all' | readonly MapId[];
  readonly colour?: 'srgb' | 'linear';
  readonly maxTexturePx?: number;
  /** LOD0 triangle cap (sum over the file for packs). */
  readonly maxTriangles?: number;
  /** Characters only: LOD1 cap. */
  readonly lod1MaxTriangles?: number;
  readonly requiredNodes?: readonly string[];
  readonly requiredClips?: readonly string[];
  readonly textures?: Readonly<Record<string, TextureBinding>>;
  readonly use?: 'always' | 'detail';
}

export interface TextureSetRow {
  readonly bc: AssetKey;
  readonly n: AssetKey;
  readonly orm: AssetKey;
  readonly maps: 'all' | readonly MapId[];
}
export type TextureSetTable = Readonly<Record<string, TextureSetRow>>;

/** Injected by app-shell at construction (BR-G-01). The renderer itself does no I/O. */
export interface AssetPort {
  /** Rejects with an AbortError on abort, or another error on HTTP/network/V0 failure. */
  fetchBytes(url: string, signal: AbortSignal, onBytes: (received: number) => void): Promise<Uint8Array>;
  /** Memoised `import()` of the kit chunk (BR-G-02). */
  loadKit(): Promise<AssetKitModule>;
}

/** Closed set of failure codes (SR-G-11): codes only, never error messages. */
export type AssetFailureCode =
  | 'render/asset-fetch-failed'
  | 'render/asset-decode-failed'
  | 'render/asset-invalid'
  | 'render/asset-kit-failed'
  | 'render/asset-upload'
  | 'render/asset-memory';

/** One parsed KTX2 texture with its CPU mip chain kept (BR-G-17). */
export interface ParsedTexture {
  readonly kind: 'texture';
  readonly width: number;
  readonly height: number;
  readonly mipmaps: readonly { readonly data: ArrayBufferView; readonly width: number; readonly height: number }[];
  readonly format: number;
  readonly type: number;
  readonly srgb: boolean;
  /** Bytes held by the kept mips. */
  readonly bytes: number;
}

export interface ParsedModel {
  readonly kind: 'model';
  readonly root: Object3D;
  readonly animations: readonly AnimationClip[];
  readonly triangles: number;
}

export type ParsedAsset = ParsedTexture | ParsedModel;

/** Read access to settled library values, by key. */
export interface AssetLookup {
  texture(key: AssetKey): ParsedTexture | null;
  model(key: AssetKey): ParsedModel | null;
}

/** What the renderer gives the runtime on bind. `renderer` is the WebGLRenderer (BR-G-04). */
export interface KitBindTarget {
  readonly renderer: object;
}

export interface RuntimeDeps {
  readonly diagnostics: Diagnostics;
}

/** A texture slot on a material, re-pointed on preset re-tier (business-logic-model §7). */
export type TextureSlot = 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap';

/**
 * The kit runtime (lazy chunk, performance-design §1.2). All upload work happens in the
 * apply, preset and restore steps; render() only calls the frame hooks on built layers.
 */
export interface AssetRuntime {
  readonly manifest: readonly AssetEntry[];
  readonly textureSets: TextureSetTable;
  bind(target: KitBindTarget): void;
  /** V1-V4 validation and parse. Rejects with an Error whose `code` is an AssetFailureCode. */
  parse(entry: AssetEntry, bytes: Uint8Array): Promise<ParsedAsset>;
  /** GPU texture for a key at the current tier (cached for the page; re-tiered by setMaxPx). */
  texture(key: AssetKey, lookup: AssetLookup): Texture | null;
  /** Points `slot` of `material` at the key's texture and keeps it bound across re-tiers. */
  bindSlot(material: Material, slot: TextureSlot, key: AssetKey, lookup: AssetLookup): boolean;
  /** Forgets slot bindings of a round (disposeRound). */
  releaseSlots(): void;
  /** Re-tiers every cached texture to the preset's limit, from the kept mips (no fetch). */
  setMaxPx(px: number, lookup: AssetLookup): void;
  /** PMREM environment from the map's sky, or null. */
  environment(skyKey: AssetKey, lookup: AssetLookup): Texture | null;
  /** Sum over cached GPU textures of uploaded bytes (BR-G-72). */
  textureBytes(): number;
  /** Formats of cached textures, for the e2e seam ("no RGBA8"). */
  textureFormats(): readonly number[];
  /** Marks every cached texture for re-upload after a context restore. */
  restore(lookup: AssetLookup): void;
  readonly character: CharacterApi;
  readonly dressing: DressingApi;
  /** Binds a loaded model's material textures from its manifest entry; false when any fails. */
  bindModelTextures(root: Object3D, entry: AssetEntry, lookup: AssetLookup): boolean;
  dispose(): void;
}

/** Bot characters (character.ts). */
export interface CharacterApi {
  createPool(model: ParsedModel, entry: AssetEntry, count: number, lookup: AssetLookup): BotCharacterPool | null;
}

export interface BotFrame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  crouch: boolean;
  alive: boolean;
  /** Seconds since death, −1 while alive. */
  deathAge: number;
  /** Seconds since the last shot, −1 for none in the window. */
  fireAge: number;
  /** 0..1 brightness multiplier (death darkening). */
  bright: number;
  /** Hit-flash strength 0..1. */
  flash: number;
  visible: boolean;
}

export interface BotCharacterPool {
  readonly group: Object3D;
  readonly count: number;
  readonly triangles: readonly [number, number];
  /** Writes pose and animation for bot k at render time t; never allocates. */
  update(k: number, f: Readonly<BotFrame>, t: number, cameraX: number, cameraZ: number): void;
  /** Muzzle world position of bot k after update(). */
  muzzle(k: number, out: { x: number; y: number; z: number }): void;
  setQuality(lod0DistanceM: number, animHz: number, reducedMotion: boolean): void;
  resetBot(k: number): void;
  dispose(): void;
}

/** Dressing layer (dressing.ts). */
export interface DressingApi {
  build(def: MapDefinition, lookup: AssetLookup, opts: DressingOptions): DressingLayer | null;
}

export interface DressingOptions {
  readonly density: number;
  readonly cap: number;
  readonly lod0DistanceM: number;
  readonly drawDistanceM: number;
  readonly maxBatches: number;
  readonly sway: boolean;
  /** Pack keys whose models are ready (others fall back to boxes or are omitted). */
  readonly readyPacks: ReadonlySet<string>;
  readonly manifest: readonly AssetEntry[];
}

export interface DressingLayer {
  readonly group: Object3D;
  readonly instances: number;
  readonly batches: number;
  /** Blocking-prop solid indices drawn by the layer (their boxes are hidden). */
  readonly coveredSolids: ReadonlySet<number>;
  /** LOD and cull pass; cheap when the camera barely moved (performance-design §3.4). */
  refresh(cameraX: number, cameraY: number, cameraZ: number, t: number): void;
  setCastShadow(on: boolean): void;
  dispose(): void;
}

export interface AssetLoadReport {
  readonly requested: number;
  readonly loaded: number;
  readonly failed: readonly AssetKey[];
  readonly aborted: number;
  readonly bytes: number;
}

/** The kit module shape returned by AssetPort.loadKit(). */
export interface AssetKitModule {
  createAssetRuntime(deps: RuntimeDeps): AssetRuntime;
}

/** An Error carrying a closed failure code. */
export interface CodedError extends Error {
  readonly code: AssetFailureCode;
}

export type LibraryState = 'absent' | 'fetching' | 'decoding' | 'ready' | 'failed';
