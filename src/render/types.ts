/**
 * Renderer types (business-logic-model §1). GameRenderer follows
 * component-methods; stats() is the additive read-only hook for tests and
 * verification. GlHost is internal: gl-host.ts implements it over
 * WebGLRenderer, and tests inject a recording fake.
 */
import type { Camera, Object3D } from 'three';
import type { Result } from '../core';
import type { SimEvent, SimSnapshot } from '../contracts';
import type { MapDefinition } from '../maps';
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
}

export interface GameRenderer {
  init(canvas: HTMLCanvasElement): Result<void, 'NO_WEBGL2'>;
  buildMap(def: MapDefinition): Promise<void>;
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
  dispose(): void;
}

export type GlHostFactory = (canvas: HTMLCanvasElement) => GlHost | null;
