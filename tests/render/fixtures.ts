/**
 * Shared renderer test fixtures: a recording fake GlHost, snapshot builders
 * and a helper that brings a renderer to the live state on a real map.
 */
import type { Camera, Object3D, Scene } from 'three';
import {
  botId,
  createDiagnostics,
  PLAYER_ID,
  type Diagnostics,
  type EntityId,
} from '../../src/core';
import type { BotView, PlayerView, SimEvent, SimSnapshot, WeaponId } from '../../src/contracts';
import { getMap } from '../../src/maps';
import type { MapId } from '../../src/contracts';
import { createGameRendererWith } from '../../src/render/game-renderer';
import type { AssetPort } from '../../src/render/assets/types';
import type { GameRenderer, GlHost } from '../../src/render/types';

export interface FakeHost extends GlHost {
  readonly calls: string[];
  readonly scenes: Object3D[];
  readonly cameras: Camera[];
  pixelRatio: number;
  size: [number, number];
  compileFails: boolean;
  /** When false, frame calls are not recorded (allocation probe). */
  recording: boolean;
  dpr: number;
  exposure: number;
  loseContext(): void;
  restoreContext(): void;
  /** Scenes passed to the most recent render() pair. */
  worldScene(): Scene;
  vmScene(): Scene | null;
}

export function createFakeHost(
  opts: { maxTextureSize?: number; maxAnisotropy?: number } = {},
): FakeHost {
  const lost = new Set<() => void>();
  const restored = new Set<() => void>();
  const calls: string[] = [];
  const scenes: Object3D[] = [];
  const cameras: Camera[] = [];
  let lastWorld: Object3D | null = null;
  let lastVm: Object3D | null = null;
  let renderIndexInFrame = 0;
  const host: FakeHost = {
    calls,
    scenes,
    cameras,
    pixelRatio: 0,
    size: [0, 0],
    compileFails: false,
    recording: true,
    dpr: 1,
    capabilities: {
      maxTextureSize: opts.maxTextureSize ?? 8192,
      maxAnisotropy: opts.maxAnisotropy ?? 16,
    },
    devicePixelRatio() {
      return host.dpr;
    },
    setPixelRatio(r) {
      host.pixelRatio = r;
    },
    setSize(w, h) {
      host.size = [w, h];
    },
    clear() {
      if (host.recording) calls.push('clear');
      renderIndexInFrame = 0;
    },
    clearDepth() {
      if (host.recording) calls.push('clearDepth');
    },
    render(scene, camera) {
      if (host.recording) calls.push('render');
      if (scenes.length < 64) {
        scenes.push(scene);
        cameras.push(camera);
      }
      if (renderIndexInFrame === 0) {
        lastWorld = scene;
        lastVm = null;
      } else {
        lastVm = scene;
      }
      renderIndexInFrame += 1;
    },
    compileAsync() {
      calls.push('compile');
      return host.compileFails ? Promise.reject(new Error('compile failed')) : Promise.resolve();
    },
    onContextLost(cb) {
      lost.add(cb);
      return () => lost.delete(cb);
    },
    onContextRestored(cb) {
      restored.add(cb);
      return () => restored.delete(cb);
    },
    bindKit(kit) {
      calls.push('bindKit');
      kit.bind({ renderer: host });
    },
    setExposure(x) {
      host.exposure = x;
    },
    exposure: 1,
    dispose() {
      calls.push('dispose');
    },
    loseContext() {
      for (const cb of lost) cb();
    },
    restoreContext() {
      for (const cb of restored) cb();
    },
    worldScene() {
      if (lastWorld === null) throw new Error('nothing rendered yet');
      return lastWorld as Scene;
    },
    vmScene() {
      return lastVm as Scene | null;
    },
  };
  return host;
}

export interface Harness {
  renderer: GameRenderer;
  host: FakeHost;
  diagnostics: Diagnostics;
  sink: { code: string; detail?: unknown }[];
}

export function createHarness(
  opts: {
    maxTextureSize?: number;
    reducedMotion?: boolean;
    noWebgl?: boolean;
    assets?: (d: Diagnostics) => AssetPort;
  } = {},
): Harness {
  const sink: { code: string; detail?: unknown }[] = [];
  const diagnostics = createDiagnostics((code, detail) => sink.push({ code, detail }));
  const host = createFakeHost(opts);
  const renderer = createGameRendererWith(
    {
      diagnostics,
      reducedMotion: opts.reducedMotion === true,
      ...(opts.assets === undefined ? {} : { assets: opts.assets(diagnostics) }),
    },
    {
      hostFactory: () => (opts.noWebgl === true ? null : host),
      yieldTask: () => Promise.resolve(),
    },
  );
  return { renderer, host, diagnostics, sink };
}

/** A canvas stand-in; the fake host never touches it. */
export const FAKE_CANVAS = {} as HTMLCanvasElement;

export async function liveHarness(
  map: MapId,
  bots: number,
  opts: {
    preset?: 'low' | 'medium' | 'high';
    maxTextureSize?: number;
    reducedMotion?: boolean;
  } = {},
): Promise<Harness> {
  const h = createHarness(opts);
  const r = h.renderer.init(FAKE_CANVAS);
  if (!r.ok) throw new Error('init failed');
  h.renderer.setPreset(opts.preset ?? 'medium');
  h.renderer.setFov(90);
  h.renderer.resize(1920, 1080);
  await h.renderer.buildMap(getMap(map));
  h.renderer.spawnActors(bots);
  await h.renderer.precompile();
  return h;
}

export function player(over: Partial<PlayerView> = {}): PlayerView {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.6,
    stance: 'stand',
    grounded: true,
    health: 100,
    armor: 0,
    alive: true,
    loadout: {
      active: 'rifle',
      slots: [
        { id: 'rifle', mag: 30, magSize: 30, reserve: 90 },
        { id: 'pistol', mag: 12, magSize: 12, reserve: 36 },
        { id: 'sniper', mag: 5, magSize: 5, reserve: 15 },
      ],
      reloading: false,
      reloadProgress: 0,
      switching: false,
      spread: 0,
      scoped: false,
    },
    viewKick: { pitch: 0, yaw: 0 },
    lastFireTick: -1,
    ...over,
  };
}

export function bot(n: number, over: Partial<BotView> = {}): BotView {
  return {
    id: botId(n),
    pos: { x: n * 2, y: 0, z: -10 },
    yaw: 0,
    pitch: 0,
    alive: true,
    deathTick: null,
    crouch: false,
    moving: true,
    lastFireTick: -1,
    weapon: 'rifle',
    ...over,
  };
}

export function snapshot(tick: number, bots: number, over: Partial<SimSnapshot> = {}): SimSnapshot {
  const list: BotView[] = [];
  for (let i = 1; i <= bots; i++) list.push(bot(i));
  return {
    tick,
    phase: 'live',
    countdownLeftSec: 0,
    timeLeftSec: 120,
    outcome: null,
    player: player(),
    bots: list,
    botsAlive: bots,
    radar: [],
    ...over,
  };
}

export function shot(
  tick: number,
  shooter: EntityId,
  over: Partial<Extract<SimEvent, { t: 'shot' }>> = {},
): SimEvent {
  return {
    t: 'shot',
    tick,
    shooter,
    weapon: 'rifle' as WeaponId,
    origin: { x: 0, y: 1.6, z: 0 },
    end: { x: 0, y: 1.6, z: -20 },
    hit: null,
    headshot: false,
    ...over,
  };
}

export function impact(tick: number, z = -20): SimEvent {
  return { t: 'impact', tick, point: { x: 0, y: 1.6, z }, normal: { x: 0, y: 0, z: 1 } };
}

export { PLAYER_ID };
