/**
 * Renderer types (business-logic-model §1). GameRenderer follows
 * component-methods; stats() is the additive read-only hook for tests and
 * verification. GlHost is internal: gl-host.ts implements it over
 * WebGLRenderer, and tests inject a recording fake.
 */
import type { Camera, Object3D } from 'three';
import type { Result } from '../core';
import type { SimEvent, SimSnapshot } from '../contracts';
import type { MapId } from '../contracts';
import type { MapDefinition } from '../maps';
import type { AssetLoadReport, KitBindTarget } from './assets/types';
import type { PresetId } from './presets';

export type Unsubscribe = () => void;

export interface RenderStats {
  /** Estimated draw calls of the world and viewmodel passes (shadow pass excluded). */
  drawCalls: number;
  worldDrawCalls: number;
  vmDrawCalls: number;
  /** Triangles submitted by the two passes. */
  triangles: number;
  /** Live geometries and textures owned by the renderer. */
  geometries: number;
  textures: number;
  /** Lights with castShadow in the world scene. */
  shadowLights: number;
  /** Objects with castShadow in the world scene. */
  shadowCasters: number;
  activeFlashes: number;
  activeTracers: number;
  activeImpacts: number;
  activeParticles: number;
  /** Frames skipped by the frame guard. */
  frameFaults: number;
  contextLost: boolean;
  // Graphics uplift (domain-entities-graphics-uplift "RenderStats additions").
  /** Draw calls of objects only shadow cameras see (layer 1); not part of the world ceiling. */
  shadowOnlyCalls: number;
  /** Estimated GPU bytes of uploaded asset and procedural textures (BR-G-72). */
  textureBytesEstimate: number;
  dressingInstances: number;
  dressingBatches: number;
  skinnedBots: number;
  /** Asset keys that ended `failed` (aborts excluded), plus 1 when the kit failed. */
  assetFallbacks: number;
  envActive: boolean;
  /** Distinct WebGL formats of uploaded asset textures (e2e: no RGBA8). */
  textureFormats: number[];
}

export interface GameRenderer {
  init(canvas: HTMLCanvasElement): Result<void, 'NO_WEBGL2'>;
  buildMap(def: MapDefinition): Promise<void>;
  /**
   * Downloads and parses every asset of the map (BR-G-08) through the injected AssetPort.
   * Never rejects; makes no I/O before a successful init() (BR-G-02). `onProgress` gets 0..1.
   */
  loadAssets(map: MapId, signal: AbortSignal, onProgress: (p: number) => void): Promise<AssetLoadReport>;
  /** Applies loaded assets to the built map, falling back per item (BR-G-14). Synchronous. */
  applyAssets(): void;
  spawnActors(n: number): void;
  precompile(): Promise<void>;
  render(prev: SimSnapshot, curr: SimSnapshot, alpha: number, events: readonly SimEvent[]): void;
  setPreset(p: PresetId): void;
  /** Horizontal FOV in degrees at a 16:9 reference aspect, 70..110. */
  setFov(deg: number): void;
  resize(w: number, h: number): void;
  onContextLost(cb: () => void): Unsubscribe;
  onContextRestored(cb: () => void): Unsubscribe;
  disposeRound(): void;
  /** Refreshes and returns the renderer-owned stats object (the same object on every call). */
  stats(): RenderStats;
}

export interface GlCapabilities {
  readonly maxTextureSize: number;
  readonly maxAnisotropy: number;
}

/** The only surface game-renderer.ts uses to reach WebGL (SEC-P-04). */
export interface GlHost {
  readonly capabilities: GlCapabilities;
  /** Device pixel ratio of the canvas's document view (1 when unknown). */
  devicePixelRatio(): number;
  setPixelRatio(ratio: number): void;
  setSize(w: number, h: number): void;
  clear(): void;
  clearDepth(): void;
  render(scene: Object3D, camera: Camera): void;
  compileAsync(scene: Object3D, camera: Camera): Promise<unknown>;
  /** The host calls preventDefault on the event so a restore is possible. */
  onContextLost(cb: () => void): Unsubscribe;
  onContextRestored(cb: () => void): Unsubscribe;
  /** Hands the WebGLRenderer to the asset kit (BR-G-04); only gl-host and kit see it. */
  bindKit(kit: { bind(target: KitBindTarget): void }): void;
  /** Tone-mapping exposure (BR-G-62). */
  setExposure(x: number): void;
  dispose(): void;
}

export type GlHostFactory = (canvas: HTMLCanvasElement) => GlHost | null;
