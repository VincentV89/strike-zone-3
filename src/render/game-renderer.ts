/**
 * GameRenderer orchestrator (business-logic-model §2, logical-components
 * lifecycle uninit → ready → built → live, plus the lost flag).
 *
 * - Reads snapshots and events only; never writes simulation state (BR-P-02).
 * - render() never throws (frame guard, BR-P-01) and allocates nothing (BR-P-04).
 * - All visuals run on render time (§2.7); no clocks or Math.random (BR-P-06).
 */
import {
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  FogExp2,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Points,
  Quaternion,
  Scene,
  Sprite,
  Vector3,
  type BufferGeometry,
  type DataTexture,
  type InstancedMesh,
  type Light,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import {
  assertNever,
  err,
  ok,
  PLAYER_ID,
  StrikeZoneError,
  TICK_DT,
  type Diagnostics,
  type Result,
} from '../core';
import type { MapId, PlayerView, SimEvent, SimSnapshot } from '../contracts';
import type { MapDefinition } from '../maps';
import { createAssetLibrary, type AssetLibrary } from './assets/library';
import type {
  AssetEntry,
  AssetLoadReport,
  AssetPort,
  AssetRuntime,
  BotCharacterPool,
  BotFrame,
  DressingLayer,
  ParsedModel,
} from './assets/types';
import {
  dataTextureBytes,
  SHADOW_CAMERA_MASK,
  SHADOW_ONLY_LAYER,
  textureBudgetBytes,
} from './budget';
import {
  botColour,
  botPartMatrices,
  BOT_PART_COUNT,
  createBotRig,
  createPoseInput,
  deathBrightness,
  partTint,
  weaponIndex,
  ZERO_MATRIX,
  type BotRig,
  type BotWeaponIndex,
} from './bot-rig';
import {
  capWorldSize,
  clampFov,
  hFovToVFov,
  isFinite3,
  isTeleport,
  lerpAngle,
  renderTime,
  scopedVFov,
  smoothstep,
} from './camera-math';
import {
  BOT_FLASH_SIZE_M,
  BOT_TRACER_OFFSET_M,
  DEATH_TOPPLE_SEC,
  FLASH_CAP_PX_1080,
  FLASH_TICKS,
  FOV_DEFAULT_DEG,
  HIT_FLASH_STRENGTH,
  HIT_FLASH_TICKS,
  MAP_TEXTURE_SIZE,
  MAX_BOTS,
  PLAYER_TRACER_OFFSET_M,
  RIFLE_TRACER_EVERY,
  SCOPE_BLEND_SEC,
  SPRITE_TEXTURE_SIZE,
  VM_FAR_M,
  VM_FLASH_SIZE_M,
  VM_FOV_DEG,
  VM_NEAR_M,
  WORLD_NEAR_M,
} from './constants';
import { DecalPool, ParticlePool, TracerPool } from './effects';
import { createGlHost } from './gl-host';
import { applyLightPreset, capCasters, createMapLights, type MapLights } from './lighting';
import { bucketGeometry, buildBuckets, type BucketData } from './map-mesh';
import {
  DEFAULT_PRESET,
  isPresetId,
  pixelRatioFor,
  PRESETS,
  type PresetId,
  type PresetSpec,
} from './presets';
import { hashUnit, makeTexture, paintDecal, paintDot, paintFlash, paintMaterial } from './textures';
import type { GameRenderer, GlHost, GlHostFactory, RenderStats, Unsubscribe } from './types';
import {
  createViewmodelInput,
  createViewmodelPose,
  createViewmodelRigs,
  viewmodelPose,
  type ViewmodelRigs,
} from './viewmodel';

export interface RendererDeps {
  readonly diagnostics: Diagnostics;
  readonly reducedMotion?: boolean;
  /** Asset I/O from app-shell (BR-G-01). Without it the renderer stays procedural. */
  readonly assets?: AssetPort;
}

const FETCH_POOL = 4;
/** Viewmodel keys in BotWeaponIndex order (rifle, pistol, sniper). */
const VIEWMODEL_KEYS = ['vm-rifle', 'vm-pistol', 'vm-sniper'] as const;
const BOT_KEY = 'bot-soldier';
const entryOf = (rt: AssetRuntime, key: string): AssetEntry | undefined =>
  rt.manifest.find((e) => e.key === key);
const EMPTY_REPORT: AssetLoadReport = Object.freeze({
  requested: 0,
  loaded: 0,
  failed: Object.freeze([]),
  aborted: 0,
  bytes: 0,
});

export interface RendererInternals {
  readonly hostFactory: GlHostFactory;
  /** Yields between buildMap steps so the loading bar can repaint (PD-P-08). */
  readonly yieldTask: () => Promise<void>;
}

type Phase = 'uninit' | 'ready' | 'built' | 'live';

const SPARK_COLOUR = new Color(0xffc070);
const PUFF_COLOUR = new Color(0xb85040);
const SPARK_SPEED = 4;
const PUFF_SPEED = 1.5;
const FLASH_LIGHT_INTENSITY = 6;
const FLASH_LIGHT_RANGE = 8;
const HIT_DEDUP_M = 0.05;
const HIT_DEDUP_SLOTS = 32;
const VM_FLASH_DISTANCE_M = 0.75;

function defaultYield(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

const WEAPON_INDEX_BY_ID: Readonly<Record<string, BotWeaponIndex>> = {
  rifle: weaponIndex('rifle'),
  pistol: weaponIndex('pistol'),
  sniper: weaponIndex('sniper'),
};

function weaponIdx(w: unknown): BotWeaponIndex {
  return typeof w === 'string' ? (WEAPON_INDEX_BY_ID[w] ?? 0) : 0;
}

function finitePose(p: {
  pos: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
}): boolean {
  return isFinite3(p.pos.x, p.pos.y, p.pos.z) && Number.isFinite(p.yaw) && Number.isFinite(p.pitch);
}

// Module-level scratch (BR-P-04).
const partMats: Matrix4[] = Array.from({ length: BOT_PART_COUNT }, () => new Matrix4());
const muzzle = new Vector3();
const vTmp = new Vector3();
const vTmp2 = new Vector3();
const mFlash = new Matrix4();
const qRoll = new Quaternion();
const qFlash = new Quaternion();
const vScale = new Vector3();
const cTmp = new Color();
const Z_AXIS = new Vector3(0, 0, 1);

export function createGameRenderer(deps: RendererDeps): GameRenderer {
  return createGameRendererWith(deps, { hostFactory: createGlHost, yieldTask: defaultYield });
}

/** Test entry point: injects the GL host factory and the loading yield. */
export function createGameRendererWith(
  deps: RendererDeps,
  internals: RendererInternals,
): GameRenderer {
  const diagnostics = deps.diagnostics;
  const reducedMotion = deps.reducedMotion === true;

  let phase: Phase = 'uninit';
  let contextLost = false;
  let host: GlHost | null = null;
  let preset: PresetSpec = PRESETS[DEFAULT_PRESET];
  let hFov = FOV_DEFAULT_DEG;
  let vFov = hFovToVFov(hFov);
  let width = 0;
  let height = 0;
  let appliedFov = -1;
  let appliedAspect = -1;
  let vmFlashSize = VM_FLASH_SIZE_M;
  let buildToken = 0;
  let frameFaults = 0;
  const hostSubs: Unsubscribe[] = [];
  const lostCbs = new Set<() => void>();
  const restoredCbs = new Set<() => void>();

  // Resource tracking for stats().geometries / textures (SC-P-06).
  const liveGeometries = new Set<BufferGeometry>();
  const liveTextures = new Set<Texture>();

  // Session objects, created by init.
  const worldScene = new Scene();
  const vmScene = new Scene();
  const worldCam = new PerspectiveCamera(vFov, 16 / 9, WORLD_NEAR_M, preset.farM);
  worldCam.rotation.order = 'YXZ';
  const vmCam = new PerspectiveCamera(VM_FOV_DEG, 16 / 9, VM_NEAR_M, VM_FAR_M);
  const background = new Color(0x000000);
  const fog = new Fog(0x000000, 100, 200);
  worldScene.background = background;
  worldScene.fog = fog;
  let mapFog: { colour: number; near: number; far: number } | null = null;
  let flashLight: PointLight | null = null;
  let rig: BotRig | null = null;
  let vm: ViewmodelRigs | null = null;
  let tracers: TracerPool | null = null;
  let decals: DecalPool | null = null;
  let particles: ParticlePool | null = null;

  // Graphics uplift: page-lifetime asset state (BR-G-16). The library and runtime survive
  // disposeRound; only round objects built from them are disposed.
  const port = deps.assets ?? null;
  const library: AssetLibrary | null =
    port === null
      ? null
      : createAssetLibrary({ port, diagnostics, yieldTask: internals.yieldTask });
  let runtime: AssetRuntime | null = null;
  let kitFailed = false;
  let kitP: Promise<AssetRuntime | null> | null = null;
  const vmAttached = [false, false, false];

  // Round objects.
  let mapRoot: Group | null = null;
  let mapLights: MapLights | null = null;
  let buckets: Mesh[] = [];
  let bucketData: BucketData[] = [];
  const roundMaterials: Material[] = [];
  const roundTextures: DataTexture[] = [];
  let spawned = 0;
  let currentDef: MapDefinition | null = null;
  let mapMaterials = new Map<string, MeshStandardMaterial>();
  /** Fallback boxes of blocking props, per model pack (hidden once the pack is drawn). */
  let propBuckets = new Map<string, Mesh[]>();
  let outerGround: Mesh | null = null;
  let dressing: DressingLayer | null = null;
  let dressingPreset: PresetId | null = null;
  let characters: BotCharacterPool | null = null;
  let botModel: { model: ParsedModel; entry: AssetEntry } | null = null;
  let envActive = false;
  let atmosphereOn = false;
  const fogExp2 = new FogExp2(0x000000, 0.01);
  const botFrame: BotFrame = {
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
  };
  const botSpeed = new Float32Array(MAX_BOTS + 1);

  // Round transients (§2.11 step 3).
  const fallX = new Float32Array(MAX_BOTS + 1);
  const fallZ = new Float32Array(MAX_BOTS + 1);
  const hasFall = new Uint8Array(MAX_BOTS + 1);
  const hitFlashUntil = new Float64Array(MAX_BOTS + 1);
  const currIdx = new Int16Array(MAX_BOTS + 1);
  const prevIdx = new Int16Array(MAX_BOTS + 1);
  const hitEnds = new Float64Array(HIT_DEDUP_SLOTS * 4);
  let hitEndCount = 0;
  let scopeTarget = 0;
  let scopeFrom = 0;
  let scopeStartT = -1;
  let scopeBlend = 0;
  let switchStart = -1;
  let switchEnd = -1;
  let wasSwitching = false;
  let rifleShots = 0;
  let lastTick = -Infinity;
  let lastFrameKey0 = NaN;
  let lastFrameKey1 = NaN;
  let lastFrameKey2 = NaN;
  let vmVisible = false;
  let activeFlashes = 0;
  let lastT = 0;
  const pose = createPoseInput();
  const vmIn = createViewmodelInput();
  const vmOut = createViewmodelPose();

  const stats: RenderStats = {
    drawCalls: 0,
    worldDrawCalls: 0,
    vmDrawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    shadowLights: 0,
    shadowCasters: 0,
    activeFlashes: 0,
    activeTracers: 0,
    activeImpacts: 0,
    activeParticles: 0,
    frameFaults: 0,
    contextLost: false,
    shadowOnlyCalls: 0,
    textureBytesEstimate: 0,
    dressingInstances: 0,
    dressingBatches: 0,
    skinnedBots: 0,
    assetFallbacks: 0,
    envActive: false,
    textureFormats: [],
  };

  function trackGeometry(g: BufferGeometry): void {
    liveGeometries.add(g);
  }
  function trackTexture(t: Texture): void {
    liveTextures.add(t);
  }

  function requireInit(): GlHost {
    if (host === null)
      throw new StrikeZoneError('render/not-initialised', 'Call init(canvas) first');
    return host;
  }

  // ---------------------------------------------------------------- init

  function createSession(): void {
    const flashTex = makeTexture(paintFlash(SPRITE_TEXTURE_SIZE), SPRITE_TEXTURE_SIZE, {
      repeat: false,
      anisotropy: 1,
    });
    const decalTex = makeTexture(paintDecal(SPRITE_TEXTURE_SIZE), SPRITE_TEXTURE_SIZE, {
      repeat: false,
      anisotropy: 1,
    });
    const dotTex = makeTexture(paintDot(16), 16, { repeat: false, anisotropy: 1 });
    trackTexture(flashTex);
    trackTexture(decalTex);
    trackTexture(dotTex);

    rig = createBotRig(flashTex);
    for (const g of rig.geometries) trackGeometry(g);
    worldScene.add(rig.group);

    const effects = new Group();
    effects.name = 'effects';
    tracers = new TracerPool(diagnostics);
    decals = new DecalPool(decalTex, diagnostics);
    particles = new ParticlePool(dotTex, diagnostics);
    trackGeometry(tracers.mesh.geometry);
    trackGeometry(decals.mesh.geometry);
    trackGeometry(particles.points.geometry);
    effects.add(tracers.mesh, decals.mesh, particles.points);
    worldScene.add(effects);

    flashLight = new PointLight(0xffd9a0, 0, FLASH_LIGHT_RANGE, 2);
    flashLight.name = 'flash-light';
    flashLight.castShadow = false;
    worldScene.add(flashLight);

    vm = createViewmodelRigs(flashTex);
    for (const g of vm.geometries) trackGeometry(g);
    const vmSun = new DirectionalLight(0xffffff, 1.6);
    vmSun.position.set(0.5, 1, 0.8);
    vmScene.add(vmSun, new AmbientLight(0xffffff, 0.6));
    for (const r of vm.rigs) vmScene.add(r.group);
    vmScene.add(vmCam);
  }

  function init(canvas: HTMLCanvasElement): Result<void, 'NO_WEBGL2'> {
    if (host !== null) return ok(undefined);
    const h = internals.hostFactory(canvas);
    if (h === null) return err('NO_WEBGL2');
    host = h;
    createSession();
    hostSubs.push(h.onContextLost(handleContextLost));
    hostSubs.push(h.onContextRestored(handleContextRestored));
    phase = 'ready';
    applyPreset(preset);
    applyFov(hFov);
    return ok(undefined);
  }

  // ---------------------------------------------------------------- map

  async function buildMap(def: MapDefinition): Promise<void> {
    requireInit();
    if (mapRoot !== null) disposeRound();
    const known = new Map<string, MapDefinition['materials'][number]>();
    for (const m of def.materials) known.set(m.id, m);
    const used: string[] = [];
    const seen = new Set<string>();
    const use = (id: string): void => {
      if (!known.has(id)) {
        throw new StrikeZoneError(
          'render/unknown-material',
          'A solid or ramp names an unknown material',
        );
      }
      if (!seen.has(id)) {
        seen.add(id);
        used.push(id);
      }
    };
    for (const s of def.solids) use(s.material);
    for (const r of def.ramps) use(r.material);

    const token = ++buildToken;
    const root = new Group();
    root.name = 'map-root';
    const materials = new Map<string, MeshStandardMaterial>();
    const aniso = Math.min(preset.anisotropy, requireInit().capabilities.maxAnisotropy || 1);
    // Step 1: one procedural texture + material per used hint, in definition order.
    for (const hint of def.materials) {
      if (!seen.has(hint.id)) continue;
      const tex = makeTexture(paintMaterial(hint, MAP_TEXTURE_SIZE), MAP_TEXTURE_SIZE, {
        repeat: true,
        anisotropy: aniso,
      });
      trackTexture(tex);
      roundTextures.push(tex);
      const mat = new MeshStandardMaterial({
        map: tex,
        roughness: hint.roughness,
        metalness: hint.metalness,
      });
      roundMaterials.push(mat);
      materials.set(hint.id, mat);
      await internals.yieldTask();
      if (token !== buildToken) {
        abandonBuild();
        return;
      }
    }
    // Step 2: bucket geometry. Prop solids get their own buckets per model pack, so they
    // can be hidden once the pack's models draw them (business-logic-model §4).
    currentDef = def;
    mapMaterials = materials;
    const bucketMesh = (b: BucketData, tag: string): Mesh => {
      const g = bucketGeometry(b);
      trackGeometry(g);
      const mesh = new Mesh(g, materials.get(b.material));
      mesh.name = `bucket:${tag}${b.material}${b.caster ? ':caster' : ''}`;
      mesh.receiveShadow = true;
      mesh.castShadow = b.caster;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      return mesh;
    };
    const layoutSolids = def.solids.filter((x) => x.prop === undefined);
    bucketData = buildBuckets(
      layoutSolids.length === def.solids.length ? def : { ...def, solids: layoutSolids },
    );
    buckets = bucketData.map((b) => bucketMesh(b, ''));
    propBuckets = new Map();
    const dress = def.dressing;
    if (dress !== undefined) {
      const packOf = new Map(dress.catalog.map((c) => [c.id, c.asset] as const));
      const byPack = new Map<string, MapDefinition['solids'][number][]>();
      for (const x of def.solids) {
        const id = x.prop === undefined ? undefined : dress.props[x.prop]?.[0];
        const pack = id === undefined ? undefined : packOf.get(id);
        if (pack === undefined) continue;
        const list = byPack.get(pack) ?? [];
        list.push(x);
        byPack.set(pack, list);
      }
      for (const [pack, list] of byPack) {
        const data = buildBuckets({ ...def, solids: list, ramps: [] });
        const meshes = data.map((b) => bucketMesh(b, `prop:${pack}:`));
        bucketData = bucketData.concat(data);
        buckets = buckets.concat(meshes);
        propBuckets.set(pack, meshes);
      }
      if (dress.backdrop.length > 0) outerGround = createOuterGround(def, materials, root);
    }
    await internals.yieldTask();
    if (token !== buildToken) {
      abandonBuild();
      return;
    }
    // Step 3: lights and environment.
    mapLights = createMapLights(def);
    for (const o of mapLights.objects) root.add(o);
    background.setHex(def.lighting.background);
    mapFog = def.lighting.fog === null ? null : { ...def.lighting.fog };
    mapRoot = root;
    worldScene.add(root);
    phase = 'built';
    applyPreset(preset);
    resetTransients();
  }

  function abandonBuild(): void {
    // A disposeRound() or newer buildMap() ran while this one was yielding.
    disposeRoundResources();
  }

  function disposeRoundResources(): void {
    for (const m of buckets) {
      m.geometry.dispose();
      liveGeometries.delete(m.geometry);
    }
    for (const m of roundMaterials) m.dispose();
    for (const t of roundTextures) {
      t.dispose();
      liveTextures.delete(t);
    }
    if (mapLights !== null) {
      for (const l of mapLights.locals) l.shadow.map?.dispose();
      mapLights.sun.shadow.map?.dispose();
      mapLights.sun.dispose();
    }
    buckets = [];
    bucketData = [];
    roundMaterials.length = 0;
    roundTextures.length = 0;
    mapLights = null;
    disposeAppliedAssets();
    if (outerGround !== null) {
      outerGround.geometry.dispose();
      liveGeometries.delete(outerGround.geometry);
      outerGround = null;
    }
    propBuckets = new Map();
    mapMaterials = new Map();
    currentDef = null;
  }

  function createOuterGround(
    def: MapDefinition,
    materials: ReadonlyMap<string, MeshStandardMaterial>,
    root: Group,
  ): Mesh | null {
    const first = def.solids[0];
    const mat = first === undefined ? undefined : materials.get(first.material);
    if (mat === undefined) return null;
    // A ground disc under the backdrop so distant rocks do not float (BR-G-33).
    const g = new CircleGeometry(300, 48);
    const repeat = def.materials.find((m) => m.id === first?.material)?.repeatM ?? 8;
    const uv = g.attributes['uv'];
    if (uv !== undefined) {
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, (uv.getX(i) * 600) / repeat, (uv.getY(i) * 600) / repeat);
    }
    g.rotateX(-Math.PI / 2);
    g.translate(0, -0.03, 0);
    trackGeometry(g);
    const m = new Mesh(g, mat);
    m.name = 'outer-ground';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
    return m;
  }

  /** Round objects built from assets (BR-G-16: the library itself is kept). */
  function disposeAppliedAssets(): void {
    if (dressing !== null) {
      dressing.group.removeFromParent();
      dressing.dispose();
      dressing = null;
    }
    if (characters !== null) {
      characters.group.removeFromParent();
      characters.dispose();
      characters = null;
    }
    setRigLayer(false);
    runtime?.releaseSlots();
    resetAtmosphere();
  }

  function resetAtmosphere(): void {
    worldScene.background = background;
    worldScene.environment = null;
    worldScene.fog = fog;
    host?.setExposure(1);
    atmosphereOn = false;
    envActive = false;
  }

  /** The 9-part rig: visible bots (fallback) or the shadow-only proxy (performance-design §3.3). */
  function setRigLayer(proxy: boolean): void {
    if (rig === null) return;
    for (const part of rig.parts) {
      if (proxy) {
        part.layers.set(SHADOW_ONLY_LAYER);
        part.visible = preset.botShadowCasters > 0;
        part.castShadow = preset.botShadowCasters > 0;
      } else {
        part.layers.set(0);
        part.visible = true;
      }
    }
  }

  function spawnActors(n: number): void {
    requireInit();
    if (!Number.isInteger(n) || n < 1 || n > MAX_BOTS) {
      throw new StrikeZoneError(
        'render/invalid-actor-count',
        'Bot count must be an integer in 1..20',
      );
    }
    spawned = n;
    rig?.setCount(n);
    for (let id = 0; id <= MAX_BOTS; id++) {
      hasFall[id] = 0;
      hitFlashUntil[id] = -1;
    }
    // Alive pose and colour (BR-P-13) until the first frame poses them.
    if (rig !== null) {
      for (let p = 0; p < BOT_PART_COUNT; p++) {
        const mesh = rig.parts[p];
        if (mesh === undefined) continue;
        for (let k = 0; k < MAX_BOTS; k++) {
          mesh.setMatrixAt(k, ZERO_MATRIX);
          mesh.setColorAt(k, cTmp.copy(partTint(p)));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    }
    botSpeed.fill(0);
    spawnCharacters(n);
  }

  /** Skinned bots when the bot model is ready; the rig becomes the shadow proxy (BR-G-50). */
  function spawnCharacters(n: number): void {
    if (characters !== null) {
      characters.group.removeFromParent();
      characters.dispose();
      characters = null;
    }
    setRigLayer(false);
    if (runtime === null || library === null || botModel === null || mapRoot === null) return;
    const pool = runtime.character.createPool(botModel.model, botModel.entry, n, library);
    if (pool === null) {
      diagnostics.warnOnce('render/asset-invalid');
      return;
    }
    pool.setQuality(preset.botLodDistanceM, preset.botAnimHz, reducedMotion);
    characters = pool;
    mapRoot.add(pool.group);
    setRigLayer(true);
  }

  // ---------------------------------------------------------------- assets

  function loadRuntime(): Promise<AssetRuntime | null> {
    if (kitP !== null) return kitP;
    const p = port;
    const h = host;
    if (p === null || h === null) return Promise.resolve(null);
    kitP = p.loadKit().then(
      (mod) => {
        const rt = mod.createAssetRuntime({ diagnostics });
        h.bindKit(rt);
        runtime = rt;
        return rt;
      },
      () => {
        // Memoised failure for the page (BR-G-12): every asset falls back.
        kitFailed = true;
        diagnostics.warnOnce('render/asset-kit-failed');
        return null;
      },
    );
    return kitP;
  }

  async function loadAssets(
    map: MapId,
    signal: AbortSignal,
    onProgress: (p: number) => void,
  ): Promise<AssetLoadReport> {
    // Init gate (BR-G-02): no kit request and no fetch before a successful init().
    if (phase === 'uninit' || host === null || contextLost || library === null) return EMPTY_REPORT;
    const lib = library;
    const rt = await loadRuntime();
    if (rt === null || signal.aborted) {
      onProgress(1);
      return EMPTY_REPORT;
    }
    const entries = entriesForMap(rt.manifest, map);
    const total = entries.reduce((n, e) => n + e.bytes, 0) || 1;
    let settled = 0;
    let aborted = 0;
    let loaded = 0;
    let shown = 0;
    const report = (): void => {
      let received = 0;
      for (const e of entries) {
        const st = lib.state(e.key);
        received +=
          st === 'ready' || st === 'failed' ? e.bytes : Math.min(e.bytes, lib.received(e.key));
      }
      const p = 0.85 * (received / total) + 0.15 * (settled / Math.max(1, entries.length));
      shown = Math.max(shown, Math.min(1, p));
      onProgress(shown);
    };
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < entries.length) {
        const e = entries[next];
        next += 1;
        if (e === undefined) continue;
        const outcome = await lib.request(e, signal, rt, map);
        settled += 1;
        if (outcome === 'aborted') aborted += 1;
        else if (outcome === 'ready') loaded += 1;
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(FETCH_POOL, entries.length) }, worker));
    report();
    return {
      requested: entries.length,
      loaded,
      failed: entries.filter((e) => lib.state(e.key) === 'failed').map((e) => e.key),
      aborted,
      bytes: entries.reduce((n, e) => n + (lib.state(e.key) === 'ready' ? e.bytes : 0), 0),
    };
  }

  function entriesForMap(manifest: readonly AssetEntry[], map: MapId): AssetEntry[] {
    const order = (e: AssetEntry): number =>
      e.kind === 'sky'
        ? 0
        : e.key === BOT_KEY
          ? 1
          : e.key.startsWith('vm-')
            ? 2
            : e.kind === 'model'
              ? 3
              : 4;
    return manifest
      .filter((e) => e.maps === 'all' || e.maps.includes(map))
      .sort((a, b) => order(a) - order(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /**
   * Applies ready assets to the built map; every missing piece keeps its procedural
   * fallback (BR-G-14). Synchronous; uploads go through the runtime here, never in render().
   */
  function applyAssets(): void {
    const rt = runtime;
    const lib = library;
    const def = currentDef;
    if (rt === null || lib === null || def === null || mapRoot === null || host === null) return;
    disposeAppliedAssets();
    rt.setMaxPx(preset.textureMaxPx, lib);
    rt.applyPbrSets(def, mapMaterials, lib);
    applyAtmosphere(def, rt, lib);
    applyViewmodels(rt, lib);
    const bot = entryOf(rt, BOT_KEY);
    const bm = lib.model(BOT_KEY);
    botModel = bot !== undefined && bm !== null ? { model: bm, entry: bot } : null;
    buildDressing(def, rt, lib);
    checkTextureBudget(rt, lib);
    applyPreset(preset);
  }

  function applyAtmosphere(def: MapDefinition, rt: AssetRuntime, lib: AssetLibrary): void {
    const atm = def.lighting.atmosphere;
    if (atm === undefined) return;
    const skyKey = `sky-${atm.sky}`;
    const sky = rt.texture(skyKey, lib);
    if (sky === null) return; // flat background and linear fog stay (BR-G-14)
    const env = rt.environment(skyKey, lib);
    // Compressed equirect textures do not convert to a background cube in three 0.187, so the
    // PMREM environment (cube UV) is the background too (BR-G-60); blurriness 0 keeps detail.
    worldScene.background = env ?? background;
    worldScene.backgroundBlurriness = 0;
    worldScene.backgroundRotation.set(0, atm.skyRotation, 0);
    worldScene.environment = env;
    worldScene.environmentIntensity = atm.envIntensity;
    worldScene.environmentRotation.set(0, atm.skyRotation, 0);
    fogExp2.color.setHex(atm.fogExp2.colour);
    fogExp2.density = atm.fogExp2.density;
    worldScene.fog = fogExp2;
    host?.setExposure(atm.exposure);
    if (mapLights !== null) {
      mapLights.hemi.intensity =
        def.lighting.hemiIntensity * (env !== null ? atm.hemiScaleWithEnv : 1);
      mapLights.sun.intensity = def.lighting.sunIntensity * atm.sunScale;
    }
    atmosphereOn = true;
    envActive = env !== null;
  }

  function applyViewmodels(rt: AssetRuntime, lib: AssetLibrary): void {
    const v = vm;
    if (v === null) return;
    VIEWMODEL_KEYS.forEach((key, i) => {
      if (vmAttached[i] === true) return;
      const wr = v.rigs[i];
      const entry = entryOf(rt, key);
      const model = lib.model(key);
      if (wr === undefined || entry === undefined || model === null) return;
      const boxes = wr.group.children.filter((c) => c instanceof Mesh);
      if (rt.attachViewmodel(wr.group, boxes, wr.muzzle, model.root, entry, lib))
        vmAttached[i] = true;
    });
  }

  function buildDressing(def: MapDefinition, rt: AssetRuntime, lib: AssetLibrary): void {
    if (def.dressing === undefined || mapRoot === null) return;
    const ready = new Set<string>();
    for (const c of def.dressing.catalog) if (lib.model(c.asset) !== null) ready.add(c.asset);
    const layer = rt.dressing.build(def, lib, {
      density: preset.dressingDensity,
      cap: preset.dressingCap,
      lod0DistanceM: preset.propLodDistanceM,
      drawDistanceM: preset.dressingDistanceM,
      maxBatches: preset.dressingBatchCap,
      sway: false,
      readyPacks: ready,
      manifest: rt.manifest,
    });
    if (layer === null) return;
    dressing = layer;
    dressingPreset = preset.id;
    mapRoot.add(layer.group);
    // Prop boxes hide only for packs the layer actually draws.
    for (const [pack, meshes] of propBuckets) {
      const drawn = ready.has(pack);
      for (const m of meshes) {
        m.visible = !drawn;
        if (drawn) m.castShadow = false;
      }
    }
  }

  /** BR-G-72: over budget, halve the texture tier until it fits (one diagnostic). */
  function checkTextureBudget(rt: AssetRuntime, lib: AssetLibrary): void {
    const budget = textureBudgetBytes(preset);
    let px = preset.textureMaxPx;
    while (rt.textureBytes() > budget && px > 256) {
      px /= 2;
      diagnostics.warnOnce('render/texture-budget');
      rt.setMaxPx(px, lib);
    }
  }

  async function compileAll(h: GlHost): Promise<void> {
    if (vm === null || rig === null) return;
    // Every pooled object visible once so the compile set matches live play (PD-P-03).
    const vmGroups = vm.rigs.map((r) => r.group.visible);
    for (const r of vm.rigs) {
      r.group.visible = true;
      r.flash.visible = true;
    }
    await h.compileAsync(worldScene, worldCam);
    await h.compileAsync(vmScene, vmCam);
    h.clear();
    h.render(worldScene, worldCam);
    h.clearDepth();
    h.render(vmScene, vmCam);
    vm.rigs.forEach((r, i) => {
      r.group.visible = vmGroups[i] ?? false;
      r.flash.visible = false;
    });
  }

  async function precompile(): Promise<void> {
    const h = requireInit();
    await compileAll(h);
    if (mapRoot !== null) phase = 'live';
  }

  function disposeRound(): void {
    if (host === null) return;
    buildToken += 1;
    if (mapRoot !== null) worldScene.remove(mapRoot);
    mapRoot = null;
    disposeRoundResources();
    tracers?.reset();
    decals?.reset();
    particles?.reset();
    rig?.setCount(0);
    spawned = 0;
    resetTransients();
    phase = 'ready';
  }

  function resetTransients(): void {
    hasFall.fill(0);
    hitFlashUntil.fill(-1);
    scopeTarget = 0;
    scopeFrom = 0;
    scopeStartT = -1;
    scopeBlend = 0;
    switchStart = -1;
    switchEnd = -1;
    wasSwitching = false;
    rifleShots = 0;
    lastTick = -Infinity;
    lastFrameKey0 = NaN;
    tracers?.reset();
    decals?.reset();
    particles?.reset();
  }

  // ---------------------------------------------------------------- settings

  function applyPreset(p: PresetSpec): void {
    preset = p;
    if (host === null) return;
    host.setPixelRatio(pixelRatioFor(p, host.devicePixelRatio()));
    if (width > 0 && height > 0) host.setSize(width, height);
    tracers?.setCap(p.tracerCap);
    decals?.setCap(p.decalCap);
    particles?.setCap(p.particleCap, p.particlesPerBurst);
    if (flashLight !== null) flashLight.visible = p.flashLight;
    worldCam.far = p.farM;
    appliedFov = -1;
    applyEnvironment();
    rig?.setCastShadow(p.botsCastShadows);
    if (mapLights !== null)
      applyLightPreset(mapLights, p, host.capabilities.maxTextureSize, diagnostics);
    const reserved = p.botsCastShadows ? BOT_PART_COUNT : 0;
    const { keep, capped } = capCasters(bucketData, p.maxShadowCasters, reserved);
    if (capped) diagnostics.warnOnce('render/shadow-casters-capped');
    buckets.forEach((m, i) => {
      m.castShadow = keep[i] ?? false;
    });
    const aniso = Math.min(p.anisotropy, host.capabilities.maxAnisotropy || 1);
    for (const t of roundTextures) {
      if (t.anisotropy !== aniso) {
        t.anisotropy = aniso;
        t.needsUpdate = true;
      }
    }
    applyAssetPreset(p);
  }

  /** Preset steps for asset layers (business-logic-model §7): re-tier, LOD, rate, shadows. */
  function applyAssetPreset(p: PresetSpec): void {
    if (mapLights !== null) {
      // Shadow cameras also see the bot proxy layer (WebGLShadowMap uses their layers).
      mapLights.sun.shadow.camera.layers.mask = SHADOW_CAMERA_MASK;
      for (const l of mapLights.locals) l.shadow.camera.layers.mask = SHADOW_CAMERA_MASK;
    }
    if (runtime !== null && library !== null) runtime.setMaxPx(p.textureMaxPx, library);
    if (characters !== null) {
      characters.setQuality(p.botLodDistanceM, p.botAnimHz, reducedMotion);
      setRigLayer(true);
    }
    if (
      dressing !== null &&
      dressingPreset !== p.id &&
      currentDef !== null &&
      runtime !== null &&
      library !== null
    ) {
      dressing.group.removeFromParent();
      dressing.dispose();
      dressing = null;
      buildDressing(currentDef, runtime, library);
    }
    dressing?.setCastShadow(p.maxShadowCasters > 16);
  }

  function applyEnvironment(): void {
    const far = preset.farM;
    if (mapFog !== null) {
      fog.color.setHex(mapFog.colour);
      fog.near = Math.min(mapFog.near, 0.95 * far);
      fog.far = Math.min(mapFog.far, 0.95 * far);
    } else {
      fog.color.copy(background);
      fog.near = 0.6 * far;
      fog.far = 0.95 * far;
    }
  }

  function setPreset(p: PresetId): void {
    if (!isPresetId(p)) {
      diagnostics.warnOnce('render/unknown-preset');
      return;
    }
    applyPreset(PRESETS[p]);
  }

  function applyFov(h: number): void {
    hFov = h;
    vFov = hFovToVFov(h);
    appliedFov = -1;
  }

  function setFov(deg: number): void {
    const c = clampFov(deg);
    if (c !== deg) diagnostics.warnOnce('render/fov-out-of-range');
    applyFov(c);
  }

  function resize(w: number, h: number): void {
    if (!(Number.isFinite(w) && Number.isFinite(h)) || w <= 0 || h <= 0) return;
    width = Math.floor(w);
    height = Math.floor(h);
    host?.setSize(width, height);
    vmCam.aspect = width / height;
    vmCam.updateProjectionMatrix();
    appliedAspect = -1;
    const capPx = (FLASH_CAP_PX_1080 * height) / 1080;
    vmFlashSize = Math.min(
      VM_FLASH_SIZE_M,
      capWorldSize(capPx, VM_FLASH_DISTANCE_M, VM_FOV_DEG, height),
    );
  }

  // ---------------------------------------------------------------- context loss

  function handleContextLost(): void {
    contextLost = true;
    diagnostics.warnOnce('render/context-lost');
    notify(lostCbs);
  }

  function handleContextRestored(): void {
    const h = host;
    if (h === null) return;
    for (const t of liveTextures) t.needsUpdate = true;
    // Kept CPU mips re-upload with no fetch; the PMREM environment is rebuilt (BR-G-17).
    if (runtime !== null && library !== null) {
      runtime.restore(library);
      const atm = currentDef?.lighting.atmosphere;
      if (atmosphereOn && atm !== undefined) {
        const env = runtime.environment(`sky-${atm.sky}`, library);
        worldScene.environment = env;
        envActive = env !== null;
      }
    }
    applyPreset(preset);
    compileAll(h).then(
      () => {
        contextLost = false;
        notify(restoredCbs);
      },
      () => {
        diagnostics.warnOnce('render/restore-failed');
      },
    );
  }

  function notify(cbs: Set<() => void>): void {
    for (const cb of cbs) {
      try {
        cb();
      } catch {
        diagnostics.warnOnce('render/callback-fault');
      }
    }
  }

  function subscribe(set: Set<() => void>, cb: () => void): Unsubscribe {
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  // ---------------------------------------------------------------- frame

  function render(
    prev: SimSnapshot,
    curr: SimSnapshot,
    alpha: number,
    events: readonly SimEvent[],
  ): void {
    const h = host;
    if (h === null || contextLost) return;
    try {
      if (phase !== 'live') {
        h.clear();
        return;
      }
      frame(h, prev, curr, alpha, events);
    } catch {
      frameFaults += 1;
      diagnostics.warnOnce('render/frame-fault');
      try {
        h.clear();
      } catch {
        // The host is broken too; nothing more to do this frame.
      }
    }
  }

  function frame(
    h: GlHost,
    prev: SimSnapshot,
    curr: SimSnapshot,
    alphaIn: number,
    events: readonly SimEvent[],
  ): void {
    if (!Number.isFinite(curr.tick) || !Number.isFinite(prev.tick)) {
      diagnostics.warnOnce('render/bad-snapshot');
      h.clear();
      return;
    }
    const alpha = Number.isFinite(alphaIn) ? (alphaIn < 0 ? 0 : alphaIn > 1 ? 1 : alphaIn) : 1;
    const t = renderTime(prev.tick, curr.tick, alpha);
    if (curr.tick < lastTick) resetTransients();
    lastTick = curr.tick;
    // A paused frame (same ticks, same alpha, no events) changes nothing but the camera settings.
    const frozen =
      events.length === 0 &&
      prev.tick === lastFrameKey0 &&
      curr.tick === lastFrameKey1 &&
      alpha === lastFrameKey2;
    lastFrameKey0 = prev.tick;
    lastFrameKey1 = curr.tick;
    lastFrameKey2 = alpha;
    lastT = t;

    indexBots(prev, prevIdx, false);
    indexBots(curr, currIdx, true);
    if (events.length > 0) ingest(events, curr, t);
    updateScope(curr.player, t);
    updateCamera(prev.player, curr.player, alpha);
    if (!frozen) {
      updateBots(prev, curr, alpha, t);
      updateEffects(t);
    }
    dressing?.refresh(worldCam.position.x, worldCam.position.y, worldCam.position.z, t);
    updateViewmodel(prev.player, curr.player, alpha, t);

    h.clear();
    h.render(worldScene, worldCam);
    if (vmVisible) {
      h.clearDepth();
      h.render(vmScene, vmCam);
    }
  }

  function indexBots(snap: SimSnapshot, out: Int16Array, report: boolean): void {
    out.fill(-1);
    const bots = snap.bots;
    for (let i = 0; i < bots.length; i++) {
      const id = bots[i]?.id as number | undefined;
      if (id !== undefined && Number.isInteger(id) && id >= 1 && id <= spawned) {
        out[id] = i;
      } else if (report) {
        diagnostics.warnOnce('render/unknown-bot');
      }
    }
  }

  function isSpawnedBot(id: number): boolean {
    return Number.isInteger(id) && id >= 1 && id <= spawned;
  }

  function recordHitEnd(tick: number, x: number, y: number, z: number): void {
    const o = (hitEndCount % HIT_DEDUP_SLOTS) * 4;
    hitEnds[o] = tick;
    hitEnds[o + 1] = x;
    hitEnds[o + 2] = y;
    hitEnds[o + 3] = z;
    hitEndCount += 1;
  }

  function nearHitEnd(tick: number, x: number, y: number, z: number): boolean {
    const n = Math.min(hitEndCount, HIT_DEDUP_SLOTS);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (hitEnds[o] !== tick) continue;
      const dx = (hitEnds[o + 1] ?? 0) - x;
      const dy = (hitEnds[o + 2] ?? 0) - y;
      const dz = (hitEnds[o + 3] ?? 0) - z;
      if (dx * dx + dy * dy + dz * dz <= HIT_DEDUP_M * HIT_DEDUP_M) return true;
    }
    return false;
  }

  function ingest(events: readonly SimEvent[], curr: SimSnapshot, now: number): void {
    hitEndCount = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e === undefined) continue;
      if (!Number.isFinite(e.tick)) {
        diagnostics.warnOnce('render/bad-event');
        continue;
      }
      const spawnT = e.tick * TICK_DT;
      switch (e.t) {
        case 'shot':
          ingestShot(e, spawnT, i);
          break;
        case 'impact': {
          const p = e.point;
          const n = e.normal;
          if (!isFinite3(p.x, p.y, p.z) || !isFinite3(n.x, n.y, n.z)) {
            diagnostics.warnOnce('render/bad-event');
            break;
          }
          if (nearHitEnd(e.tick, p.x, p.y, p.z)) break;
          decals?.add(p.x, p.y, p.z, n.x, n.y, n.z, spawnT, hashUnit(e.tick, i, 7));
          particles?.burst(
            p.x,
            p.y,
            p.z,
            n.x,
            n.y,
            n.z,
            spawnT,
            e.tick,
            i,
            SPARK_SPEED,
            SPARK_COLOUR,
          );
          break;
        }
        case 'kill':
          ingestKill(e.victim, e.killer, curr);
          break;
        case 'weapon':
          if (e.actor !== PLAYER_ID) break;
          if (e.kind === 'scope-in') setScopeTarget(1, now);
          else if (e.kind === 'scope-out') setScopeTarget(0, now);
          else if (e.kind === 'switch') switchStart = spawnT;
          break;
        case 'damage':
        case 'noise':
        case 'phase':
          break;
        default:
          assertNever(e);
      }
    }
  }

  function ingestShot(e: Extract<SimEvent, { t: 'shot' }>, spawnT: number, index: number): void {
    const o = e.origin;
    const end = e.end;
    if (!isFinite3(o.x, o.y, o.z) || !isFinite3(end.x, end.y, end.z)) {
      diagnostics.warnOnce('render/bad-event');
      return;
    }
    vTmp.set(end.x - o.x, end.y - o.y, end.z - o.z);
    const len = vTmp.length();
    if (e.hit !== null && isSpawnedBot(e.hit)) {
      hitFlashUntil[e.hit] = (e.tick + HIT_FLASH_TICKS) * TICK_DT;
      recordHitEnd(e.tick, end.x, end.y, end.z);
      if (len > 1e-6) {
        particles?.burst(
          end.x,
          end.y,
          end.z,
          -vTmp.x / len,
          -vTmp.y / len,
          -vTmp.z / len,
          spawnT,
          e.tick,
          index,
          PUFF_SPEED,
          PUFF_COLOUR,
        );
      }
    }
    if (len < 1e-6) return;
    let offset = BOT_TRACER_OFFSET_M;
    if (e.shooter === PLAYER_ID) {
      offset = PLAYER_TRACER_OFFSET_M;
      if (e.weapon === 'rifle') {
        const draw = rifleShots % RIFLE_TRACER_EVERY === 0;
        rifleShots += 1;
        if (!draw) return;
      }
    }
    if (len <= offset) return;
    const s = offset / len;
    tracers?.add(o.x + vTmp.x * s, o.y + vTmp.y * s, o.z + vTmp.z * s, end.x, end.y, end.z, spawnT);
  }

  function ingestKill(victim: number, killer: number, curr: SimSnapshot): void {
    if (!isSpawnedBot(victim)) return;
    const vi = currIdx[victim] ?? -1;
    const vb = vi >= 0 ? curr.bots[vi] : undefined;
    if (vb === undefined) return;
    let kx: number;
    let kz: number;
    if (killer === PLAYER_ID) {
      kx = curr.player.pos.x;
      kz = curr.player.pos.z;
    } else {
      const ki = isSpawnedBot(killer) ? (currIdx[killer] ?? -1) : -1;
      const kb = ki >= 0 ? curr.bots[ki] : undefined;
      if (kb === undefined) return;
      kx = kb.pos.x;
      kz = kb.pos.z;
    }
    const dx = vb.pos.x - kx;
    const dz = vb.pos.z - kz;
    const l = Math.hypot(dx, dz);
    if (!(l > 1e-6) || !Number.isFinite(l)) return;
    fallX[victim] = dx / l;
    fallZ[victim] = dz / l;
    hasFall[victim] = 1;
  }

  function setScopeTarget(target: number, now: number): void {
    if (target === scopeTarget) return;
    scopeFrom = scopeBlend;
    scopeTarget = target;
    scopeStartT = now;
  }

  function updateScope(p: PlayerView, t: number): void {
    // The snapshot wins over events (§3.2).
    const want = p.loadout.scoped && p.loadout.active === 'sniper' ? 1 : 0;
    setScopeTarget(want, t);
    if (scopeStartT < 0) {
      scopeBlend = scopeTarget;
      return;
    }
    const k = smoothstep(0, SCOPE_BLEND_SEC, t - scopeStartT);
    scopeBlend = scopeFrom + (scopeTarget - scopeFrom) * k;
  }

  function updateCamera(p0In: PlayerView, p1: PlayerView, alpha: number): void {
    if (!finitePose(p1) || !Number.isFinite(p1.eyeHeight)) {
      diagnostics.warnOnce('render/bad-pose');
      return;
    }
    const p0 = finitePose(p0In) && Number.isFinite(p0In.eyeHeight) ? p0In : p1;
    const a = isTeleport(p0.pos.x, p0.pos.y, p0.pos.z, p1.pos.x, p1.pos.y, p1.pos.z) ? 1 : alpha;
    const eye = p0.eyeHeight + (p1.eyeHeight - p0.eyeHeight) * a;
    worldCam.position.set(
      p0.pos.x + (p1.pos.x - p0.pos.x) * a,
      p0.pos.y + (p1.pos.y - p0.pos.y) * a + eye,
      p0.pos.z + (p1.pos.z - p0.pos.z) * a,
    );
    const kp = Number.isFinite(p1.viewKick.pitch) ? p1.viewKick.pitch : 0;
    const ky = Number.isFinite(p1.viewKick.yaw) ? p1.viewKick.yaw : 0;
    worldCam.rotation.set(
      p0.pitch + (p1.pitch - p0.pitch) * a + kp,
      lerpAngle(p0.yaw, p1.yaw, a) + ky,
      0,
    );
    const v = vFov + (scopedVFov(vFov) - vFov) * scopeBlend;
    const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
    if (Math.abs(v - appliedFov) > 1e-6 || aspect !== appliedAspect) {
      worldCam.fov = v;
      worldCam.aspect = aspect;
      worldCam.updateProjectionMatrix();
      appliedFov = v;
      appliedAspect = aspect;
    }
    worldCam.updateMatrixWorld();
  }

  function updateBots(prev: SimSnapshot, curr: SimSnapshot, alpha: number, t: number): void {
    const r = rig;
    if (r === null) return;
    const heightPx = height > 0 ? height : 1080;
    const capPx = (FLASH_CAP_PX_1080 * heightPx) / 1080;
    activeFlashes = 0;
    for (let k = 0; k < spawned; k++) {
      const id = k + 1;
      const ci = currIdx[id] ?? -1;
      const b1 = ci >= 0 ? curr.bots[ci] : undefined;
      if (b1 === undefined || !finitePose(b1)) {
        if (b1 !== undefined) diagnostics.warnOnce('render/bad-pose');
        hideBot(r, k);
        continue;
      }
      const pi = prevIdx[id] ?? -1;
      const b0c = pi >= 0 ? prev.bots[pi] : undefined;
      const b0 = b0c !== undefined && finitePose(b0c) ? b0c : b1;
      const a = isTeleport(b0.pos.x, b0.pos.y, b0.pos.z, b1.pos.x, b1.pos.y, b1.pos.z) ? 1 : alpha;
      pose.x = b0.pos.x + (b1.pos.x - b0.pos.x) * a;
      pose.y = b0.pos.y + (b1.pos.y - b0.pos.y) * a;
      pose.z = b0.pos.z + (b1.pos.z - b0.pos.z) * a;
      pose.yaw = lerpAngle(b0.yaw, b1.yaw, a);
      pose.pitch = b0.pitch + (b1.pitch - b0.pitch) * a;
      pose.crouch = b1.crouch;
      pose.moving = b1.moving;
      pose.alive = b1.alive;
      pose.t = t;
      pose.id = id;
      pose.weapon = weaponIdx(b1.weapon);
      if (b1.alive) {
        pose.deathAge = -1;
      } else if (b1.deathTick !== null && Number.isFinite(b1.deathTick)) {
        const age = t - b1.deathTick * TICK_DT;
        pose.deathAge = age > 0 ? age : 0;
      } else {
        pose.deathAge = DEATH_TOPPLE_SEC;
      }
      if (hasFall[id] === 1) {
        pose.fallX = fallX[id] ?? 0;
        pose.fallZ = fallZ[id] ?? 1;
      } else {
        // Backward: forward is (−sin yaw, −cos yaw).
        pose.fallX = Math.sin(pose.yaw);
        pose.fallZ = Math.cos(pose.yaw);
      }
      botPartMatrices(pose, partMats, muzzle);
      const bright = deathBrightness(pose.deathAge);
      const flash = b1.alive && t < (hitFlashUntil[id] ?? -1) ? HIT_FLASH_STRENGTH : 0;
      if (characters !== null) {
        const dt = (curr.tick - prev.tick) * TICK_DT;
        if (dt > 0 && b0 !== b1) {
          const v = Math.hypot(b1.pos.x - b0.pos.x, b1.pos.z - b0.pos.z) / dt;
          botSpeed[id] = b1.moving && Number.isFinite(v) ? v : 0;
        } else if (!b1.moving) botSpeed[id] = 0;
        botFrame.x = pose.x;
        botFrame.y = pose.y;
        botFrame.z = pose.z;
        botFrame.yaw = pose.yaw;
        botFrame.speed = botSpeed[id] ?? 0;
        botFrame.crouch = b1.crouch;
        botFrame.alive = b1.alive;
        botFrame.deathAge = b1.alive ? -1 : pose.deathAge;
        botFrame.fireAge = b1.lastFireTick >= 0 ? t - b1.lastFireTick * TICK_DT : -1;
        botFrame.bright = bright;
        botFrame.flash = flash;
        botFrame.visible = true;
        characters.update(k, botFrame, t, worldCam.position.x, worldCam.position.z);
        characters.muzzle(k, muzzle);
      }
      for (let p = 0; p < BOT_PART_COUNT; p++) {
        const mesh = r.parts[p];
        const m = partMats[p];
        if (mesh === undefined || m === undefined) continue;
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, botColour(partTint(p), bright, flash, cTmp));
      }
      updateBotFlash(r.flashes, k, b1.alive, b1.lastFireTick, t, capPx, heightPx, id);
    }
    for (let p = 0; p < BOT_PART_COUNT; p++) {
      const mesh = r.parts[p];
      if (mesh === undefined) continue;
      uploadInstances(mesh, spawned);
    }
    uploadInstances(r.flashes, spawned);
  }

  function updateBotFlash(
    flashes: InstancedMesh,
    k: number,
    alive: boolean,
    lastFireTick: number,
    t: number,
    capPx: number,
    heightPx: number,
    id: number,
  ): void {
    const age = t - lastFireTick * TICK_DT;
    if (!alive || !(lastFireTick >= 0) || age < 0 || age >= FLASH_TICKS * TICK_DT) {
      flashes.setMatrixAt(k, ZERO_MATRIX);
      return;
    }
    const d = muzzle.distanceTo(worldCam.position);
    const size = Math.min(BOT_FLASH_SIZE_M, capWorldSize(capPx, d, worldCam.fov, heightPx));
    qRoll.setFromAxisAngle(Z_AXIS, hashUnit(lastFireTick, id) * Math.PI * 2);
    qFlash.copy(worldCam.quaternion).multiply(qRoll);
    vScale.set(size, size, 1);
    mFlash.compose(muzzle, qFlash, vScale);
    flashes.setMatrixAt(k, mFlash);
    activeFlashes += 1;
  }

  function hideBot(r: BotRig, k: number): void {
    for (let p = 0; p < BOT_PART_COUNT; p++) r.parts[p]?.setMatrixAt(k, ZERO_MATRIX);
    r.flashes.setMatrixAt(k, ZERO_MATRIX);
    if (characters !== null) {
      botFrame.visible = false;
      characters.update(k, botFrame, lastT, 0, 0);
    }
  }

  function uploadInstances(mesh: InstancedMesh, count: number): void {
    const n = count > 0 ? count : 1;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    const c = mesh.instanceColor;
    if (c !== null) {
      c.clearUpdateRanges();
      c.addUpdateRange(0, n * 3);
      c.needsUpdate = true;
    }
  }

  function updateEffects(t: number): void {
    tracers?.update(t, worldCam.position);
    decals?.update(t);
    particles?.update(t);
  }

  function updateViewmodel(p0In: PlayerView, p1: PlayerView, alpha: number, t: number): void {
    const v = vm;
    if (v === null) return;
    const lo = p1.loadout;
    const idx = weaponIdx(lo.active);
    if (lo.switching && !wasSwitching && switchStart < 0) switchStart = t;
    if (!lo.switching && wasSwitching) {
      switchEnd = t;
      switchStart = -1;
    }
    wasSwitching = lo.switching;
    const p0 = p0In.loadout;
    let progress = Number.isFinite(lo.reloadProgress) ? lo.reloadProgress : 0;
    if (
      lo.reloading &&
      p0.reloading &&
      Number.isFinite(p0.reloadProgress) &&
      p0.reloadProgress <= progress
    ) {
      progress = p0.reloadProgress + (progress - p0.reloadProgress) * alpha;
    }
    vmIn.weapon = idx;
    vmIn.t = t;
    vmIn.lastFireTick = p1.lastFireTick;
    vmIn.reloading = lo.reloading;
    vmIn.reloadProgress = progress;
    vmIn.switching = lo.switching;
    vmIn.switchStart = switchStart;
    vmIn.switchEnd = switchEnd;
    vmIn.speed =
      Number.isFinite(p1.vel.x) && Number.isFinite(p1.vel.z) ? Math.hypot(p1.vel.x, p1.vel.z) : 0;
    vmIn.grounded = p1.grounded;
    vmIn.scopeBlend = scopeBlend;
    vmIn.alive = p1.alive;
    vmIn.reducedMotion = reducedMotion;
    viewmodelPose(vmIn, vmOut);
    vmVisible = vmOut.visible;
    const age = t - p1.lastFireTick * TICK_DT;
    const flashing = vmVisible && p1.lastFireTick >= 0 && age >= 0 && age < FLASH_TICKS * TICK_DT;
    for (let i = 0; i < v.rigs.length; i++) {
      const wr = v.rigs[i];
      if (wr === undefined) continue;
      const active = i === idx;
      wr.group.visible = active;
      wr.flash.visible = active && flashing;
      if (!active) continue;
      wr.group.position.set(vmOut.x, vmOut.y, vmOut.z);
      wr.group.rotation.set(vmOut.pitch, vmOut.yaw, vmOut.roll);
      wr.magazine.position.y = wr.magRestY + vmOut.magOffset;
      if (flashing) {
        wr.flash.scale.set(vmFlashSize, vmFlashSize, 1);
        wr.flash.material.rotation = hashUnit(p1.lastFireTick) * Math.PI * 2;
      }
    }
    if (flashLight !== null) {
      const lit = flashing && preset.flashLight;
      flashLight.intensity = lit ? FLASH_LIGHT_INTENSITY : 0;
      if (lit) {
        vTmp2.set(0, 0, -0.8).applyQuaternion(worldCam.quaternion).add(worldCam.position);
        flashLight.position.copy(vTmp2);
      }
    }
    if (flashing) activeFlashes += 1;
  }

  // ---------------------------------------------------------------- stats

  function countScene(
    scene: Object3D,
    out: { calls: number; tris: number; shadowOnly: number },
    camLayers: Object3D['layers'],
  ): void {
    scene.traverseVisible((o) => {
      if (!o.layers.test(camLayers)) {
        // Shadow-only proxies (layer 1) are drawn by shadow cameras only (§3.3).
        if ((o as Partial<Mesh>).isMesh === true) out.shadowOnly += 1;
        return;
      }
      if (o instanceof Points) {
        const range = (o.geometry as BufferGeometry).drawRange.count;
        if (range > 0) out.calls += 1;
        return;
      }
      if (o instanceof Sprite) {
        out.calls += 1;
        out.tris += 2;
        return;
      }
      if (o instanceof Mesh) {
        const g = o.geometry as BufferGeometry;
        const tris =
          (g.index !== null ? g.index.count : (g.attributes['position']?.count ?? 0)) / 3;
        const inst =
          (o as Partial<InstancedMesh>).isInstancedMesh === true ? (o as InstancedMesh).count : 1;
        if (inst <= 0) return;
        out.calls += 1;
        out.tris += tris * inst;
      }
    });
  }

  function readStats(): RenderStats {
    const world = { calls: 0, tris: 0, shadowOnly: 0 };
    const vmc = { calls: 0, tris: 0, shadowOnly: 0 };
    countScene(worldScene, world, worldCam.layers);
    if (vmVisible) countScene(vmScene, vmc, vmCam.layers);
    // A texture background is drawn as one extra mesh by three.
    if (worldScene.background !== background && worldScene.background !== null) world.calls += 1;
    let casters = 0;
    let shadowLights = 0;
    worldScene.traverseVisible((o) => {
      if ((o as Partial<Light>).isLight === true) {
        if (o.castShadow) shadowLights += 1;
      } else if (o.castShadow) {
        const inst = o as Partial<InstancedMesh>;
        if (inst.isInstancedMesh === true && (inst.count ?? 0) <= 0) return;
        casters += 1;
      }
    });
    stats.worldDrawCalls = world.calls;
    stats.vmDrawCalls = vmc.calls;
    stats.drawCalls = world.calls + vmc.calls;
    stats.triangles = world.tris + vmc.tris;
    stats.geometries = liveGeometries.size;
    stats.textures = liveTextures.size;
    stats.shadowCasters = casters;
    stats.shadowLights = shadowLights;
    stats.activeFlashes = activeFlashes;
    stats.activeTracers = tracers?.live(lastT) ?? 0;
    stats.activeImpacts = decals?.live(lastT) ?? 0;
    stats.activeParticles = particles?.live(lastT) ?? 0;
    stats.frameFaults = frameFaults;
    stats.contextLost = contextLost;
    stats.shadowOnlyCalls = world.shadowOnly;
    stats.textureBytesEstimate =
      (runtime?.textureBytes() ?? 0) + roundTextures.length * dataTextureBytes(MAP_TEXTURE_SIZE);
    stats.dressingInstances = dressing?.instances ?? 0;
    stats.dressingBatches = dressing?.batches ?? 0;
    stats.skinnedBots = characters?.count ?? 0;
    stats.assetFallbacks = (library?.failedKeys().length ?? 0) + (kitFailed ? 1 : 0);
    stats.envActive = envActive;
    stats.textureFormats.length = 0;
    for (const f of runtime?.textureFormats() ?? []) stats.textureFormats.push(f);
    return stats;
  }

  return {
    init,
    buildMap,
    spawnActors,
    precompile,
    render,
    setPreset,
    setFov,
    resize,
    loadAssets,
    applyAssets,
    onContextLost: (cb) => subscribe(lostCbs, cb),
    onContextRestored: (cb) => subscribe(restoredCbs, cb),
    disposeRound,
    stats: readStats,
  };
}

/** Exposed for tests that inspect the scene graph. */
export type { Phase as RendererPhase };
