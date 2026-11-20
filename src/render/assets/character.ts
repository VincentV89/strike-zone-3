/**
 * Skinned bot characters with a direct track sampler (NFR-G-Q1 = A, TS-G-02,
 * performance-design §3.2). None of three's mixer, action or binding classes are used: each
 * clip track is bound to a bone by name once, then sampled with a cached binary search and
 * written straight into the bone's position, quaternion or scale. Lazy kit chunk.
 *
 * Clip choice reads snapshot data only (BR-G-51): speed, crouch, alive, last fire. Clips
 * cross-fade over 0.15 s, the death clip plays once and holds, and animation time is
 * quantised to the preset rate (half rate beyond 40 m) so it freezes on pause.
 */
import {
  Color,
  Group,
  MeshStandardMaterial,
  type AnimationClip,
  type Bone,
  type Material,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import type {
  AssetEntry,
  AssetLookup,
  BotCharacterPool,
  BotFrame,
  CharacterApi,
  ParsedModel,
} from './types';

export const CLIPS = [
  'idle',
  'walk',
  'run',
  'crouch-idle',
  'crouch-walk',
  'shoot',
  'death',
] as const;
export type ClipName = (typeof CLIPS)[number];
export const CROSS_FADE_SEC = 0.15;
const FAR_HALF_RATE_M = 40;
const WALK_MIN = 0.3;
const RUN_MIN = 5.2;
const SHOOT_HOLD_SEC = 0.35;
/** Source clips are authored for these speeds (m/s); playback scales with the bot's speed. */
const AUTHORED_SPEED: Readonly<Record<ClipName, number>> = {
  idle: 0,
  walk: 1.6,
  run: 5,
  'crouch-idle': 0,
  'crouch-walk': 1.2,
  shoot: 0,
  death: 0,
};

const PROP_POSITION = 0;
const PROP_QUATERNION = 1;
const PROP_SCALE = 2;

/** One clip bound to bone indices of the template (name order). */
export interface BoundClip {
  readonly name: ClipName;
  readonly duration: number;
  readonly loop: boolean;
  readonly bone: Int16Array;
  readonly prop: Uint8Array;
  readonly times: readonly Float32Array[];
  readonly values: readonly Float32Array[];
}

export function selectClip(f: Readonly<BotFrame>): ClipName {
  if (!f.alive) return 'death';
  if (f.fireAge >= 0 && f.fireAge < SHOOT_HOLD_SEC && f.speed < WALK_MIN) return 'shoot';
  if (f.crouch) return f.speed >= WALK_MIN ? 'crouch-walk' : 'crouch-idle';
  if (f.speed >= RUN_MIN) return 'run';
  if (f.speed >= WALK_MIN) return 'walk';
  return 'idle';
}

/** Binds clip tracks ("Bone.quaternion") to indices in `boneNames`; unknown bones are skipped. */
export function bindClips(
  clips: readonly AnimationClip[],
  boneNames: readonly string[],
): Map<ClipName, BoundClip> {
  const out = new Map<ClipName, BoundClip>();
  const index = new Map(boneNames.map((n, i) => [n, i] as const));
  for (const clip of clips) {
    const name = clip.name as ClipName;
    if (!(CLIPS as readonly string[]).includes(name)) continue;
    const bone: number[] = [];
    const prop: number[] = [];
    const times: Float32Array[] = [];
    const values: Float32Array[] = [];
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.');
      const node = track.name.slice(0, dot);
      const p = track.name.slice(dot + 1);
      const b = index.get(node);
      const kind =
        p === 'position'
          ? PROP_POSITION
          : p === 'quaternion'
            ? PROP_QUATERNION
            : p === 'scale'
              ? PROP_SCALE
              : -1;
      if (b === undefined || kind < 0) continue;
      bone.push(b);
      prop.push(kind);
      times.push(Float32Array.from(track.times));
      values.push(Float32Array.from(track.values));
    }
    out.set(name, {
      name,
      duration: clip.duration,
      loop: name !== 'death',
      bone: Int16Array.from(bone),
      prop: Uint8Array.from(prop),
      times,
      values,
    });
  }
  return out;
}

/** Largest key index with times[i] <= t, starting from a cached hint (O(1) when playing forward). */
export function keyIndex(times: Float32Array, t: number, hint: number): number {
  const n = times.length;
  let i = hint >= 0 && hint < n ? hint : 0;
  if ((times[i] ?? 0) > t) i = 0;
  while (i + 1 < n && (times[i + 1] ?? 0) <= t) i += 1;
  return i;
}

/** Samples component `c` (3 or 4 wide) of a track at time t into out[0..c). */
export function sampleTrack(
  times: Float32Array,
  values: Float32Array,
  width: number,
  t: number,
  hint: number,
  quat: boolean,
  out: Float32Array,
): number {
  const i = keyIndex(times, t, hint);
  const n = times.length;
  const j = Math.min(i + 1, n - 1);
  const t0 = times[i] ?? 0;
  const t1 = times[j] ?? 0;
  const a = j === i || t1 <= t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  if (quat) {
    slerpInto(values, i * 4, values, j * 4, a, out);
  } else {
    for (let c = 0; c < width; c++) {
      const v0 = values[i * width + c] ?? 0;
      const v1 = values[j * width + c] ?? 0;
      out[c] = v0 + (v1 - v0) * a;
    }
  }
  return i;
}

/** Normalised quaternion slerp between a[ao..] and b[bo..] into out[0..4). */
export function slerpInto(
  a: ArrayLike<number>,
  ao: number,
  b: ArrayLike<number>,
  bo: number,
  t: number,
  out: Float32Array,
): void {
  const ax = a[ao] ?? 0,
    ay = a[ao + 1] ?? 0,
    az = a[ao + 2] ?? 0,
    aw = a[ao + 3] ?? 1;
  let bx = b[bo] ?? 0,
    by = b[bo + 1] ?? 0,
    bz = b[bo + 2] ?? 0,
    bw = b[bo + 3] ?? 1;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let s0 = 1 - t;
  let s1 = t;
  if (cos < 0.9995) {
    const th = Math.acos(cos);
    const sin = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / sin;
    s1 = Math.sin(t * th) / sin;
  }
  const x = s0 * ax + s1 * bx,
    y = s0 * ay + s1 * by,
    z = s0 * az + s1 * bz,
    w = s0 * aw + s1 * bw;
  const l = Math.hypot(x, y, z, w) || 1;
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  out[3] = w / l;
}

/** Clip-local time for a clip started at `start` (render time), looping or clamped. */
export function clipTime(c: BoundClip, now: number, start: number, rate: number): number {
  const local = Math.max(0, now - start) * rate;
  if (!c.loop) return Math.min(local, c.duration);
  return c.duration > 0 ? local % c.duration : 0;
}

interface BotState {
  root: Object3D;
  bones: Bone[];
  lods: [SkinnedMesh | null, SkinnedMesh | null];
  material: MeshStandardMaterial;
  muzzle: Object3D | null;
  clip: ClipName;
  prev: ClipName;
  clipStart: number;
  prevStart: number;
  switchAt: number;
  hints: Int32Array;
  bright: number;
  flash: number;
  lod: number;
}

export interface CharacterDeps {
  /** SkeletonUtils.clone, supplied by kit.ts (the only file allowed to import addons). */
  readonly clone: (o: Object3D) => Object3D;
  readonly bindTextures: (root: Object3D, entry: AssetEntry, lookup: AssetLookup) => boolean;
}

const scratch = new Float32Array(4);
const scratchB = new Float32Array(4);
const BASE = new Color(1, 1, 1);
const FLASH = new Color(1, 0.35, 0.3);

function findLods(root: Object3D, key: string): [SkinnedMesh | null, SkinnedMesh | null] {
  const pick = (name: string): SkinnedMesh | null => {
    const n = root.getObjectByName(name);
    if (n === undefined) return null;
    let found: SkinnedMesh | null = null;
    n.traverse((o) => {
      if (found === null && (o as Partial<SkinnedMesh>).isSkinnedMesh === true)
        found = o as SkinnedMesh;
    });
    return found;
  };
  return [pick(`${key}_LOD0`), pick(`${key}_LOD1`)];
}

export function createCharacterApi(deps: CharacterDeps): CharacterApi {
  return {
    createPool(model: ParsedModel, entry: AssetEntry, count: number, lookup: AssetLookup) {
      if (!deps.bindTextures(model.root, entry, lookup)) return null;
      const [l0, l1] = findLods(model.root, entry.key);
      if (l0 === null || l1 === null) return null;
      const boneNames = l0.skeleton.bones.map((b) => b.name);
      const clips = bindClips(model.animations, boneNames);
      for (const c of CLIPS) if (!clips.has(c)) return null;
      const tris = (m: SkinnedMesh): number => {
        const g = m.geometry;
        return Math.round(
          (g.index !== null ? g.index.count : (g.attributes['position']?.count ?? 0)) / 3,
        );
      };
      const group = new Group();
      group.name = 'bot-characters';
      const bots: BotState[] = [];
      for (let k = 0; k < count; k++) {
        const root = deps.clone(model.root);
        root.name = `bot-character:${String(k + 1)}`;
        const lods = findLods(root, entry.key);
        const base = lods[0]?.material as Material | undefined;
        const material =
          base instanceof MeshStandardMaterial
            ? base.clone()
            : new MeshStandardMaterial({ color: 0x777777 });
        for (const m of lods) {
          if (m === null) continue;
          m.material = material;
          m.castShadow = false; // the 9-part rig is the shadow proxy (performance-design §3.3)
          m.receiveShadow = true;
          m.frustumCulled = false;
        }
        const bones = lods[0]?.skeleton.bones ?? [];
        group.add(root);
        bots.push({
          root,
          bones,
          lods,
          material,
          muzzle: root.getObjectByName('muzzle') ?? null,
          clip: 'idle',
          prev: 'idle',
          clipStart: 0,
          prevStart: 0,
          switchAt: -Infinity,
          hints: new Int32Array(256),
          bright: -1,
          flash: -1,
          lod: -1,
        });
      }
      let lod0Dist = 25;
      let animHz = 30;
      let reduced = false;

      function apply(b: BotState, c: BoundClip, t: number, w: number): void {
        for (let i = 0; i < c.bone.length; i++) {
          const bone = b.bones[c.bone[i] ?? -1];
          const times = c.times[i];
          const values = c.values[i];
          if (bone === undefined || times === undefined || values === undefined) continue;
          const kind = c.prop[i];
          const quat = kind === PROP_QUATERNION;
          const hintAt = i & 255;
          b.hints[hintAt] = sampleTrack(
            times,
            values,
            quat ? 4 : 3,
            t,
            b.hints[hintAt] ?? 0,
            quat,
            scratch,
          );
          const target =
            kind === PROP_POSITION ? bone.position : kind === PROP_SCALE ? bone.scale : null;
          if (quat) {
            const q = bone.quaternion;
            if (w >= 1) q.set(scratch[0] ?? 0, scratch[1] ?? 0, scratch[2] ?? 0, scratch[3] ?? 1);
            else {
              scratchB[0] = q.x;
              scratchB[1] = q.y;
              scratchB[2] = q.z;
              scratchB[3] = q.w;
              slerpInto(scratchB, 0, scratch, 0, w, scratchB);
              q.set(scratchB[0], scratchB[1], scratchB[2], scratchB[3]);
            }
          } else if (target !== null) {
            const x = scratch[0] ?? 0,
              y = scratch[1] ?? 0,
              z = scratch[2] ?? 0;
            if (w >= 1) target.set(x, y, z);
            else
              target.set(
                target.x + (x - target.x) * w,
                target.y + (y - target.y) * w,
                target.z + (z - target.z) * w,
              );
          }
        }
      }

      const pool: BotCharacterPool = {
        group,
        count,
        triangles: [tris(l0), tris(l1)],
        update(k, f, t, cx, cz) {
          const b = bots[k];
          if (b === undefined) return;
          b.root.visible = f.visible;
          if (!f.visible) return;
          b.root.position.set(f.x, f.y, f.z);
          b.root.rotation.set(0, f.yaw, 0);
          const dx = f.x - cx;
          const dz = f.z - cz;
          const d = Math.sqrt(dx * dx + dz * dz);
          // LOD with ±10 % hysteresis (BR-G-56).
          const want =
            lod0Dist <= 0
              ? 1
              : b.lod === 0
                ? d > lod0Dist * 1.1
                  ? 1
                  : 0
                : d < lod0Dist * 0.9
                  ? 0
                  : 1;
          if (want !== b.lod) {
            b.lod = want;
            if (b.lods[0] !== null) b.lods[0].visible = want === 0;
            if (b.lods[1] !== null) b.lods[1].visible = want === 1;
          }
          const name = selectClip(f);
          if (name !== b.clip) {
            b.prev = b.clip;
            b.prevStart = b.clipStart;
            b.clip = name;
            b.clipStart = name === 'death' ? t - Math.max(0, f.deathAge) : t;
            b.switchAt = t;
          }
          const hz = d > FAR_HALF_RATE_M ? animHz / 2 : animHz;
          const tq = Math.floor(t * hz) / hz;
          const cur = clips.get(b.clip);
          const prv = clips.get(b.prev);
          if (cur === undefined) return;
          const fade = reduced ? 1 : Math.min(1, Math.max(0, (tq - b.switchAt) / CROSS_FADE_SEC));
          const rate = (c: BoundClip): number => {
            const a = AUTHORED_SPEED[c.name];
            return a > 0 ? Math.min(1.6, Math.max(0.6, f.speed / a)) : 1;
          };
          if (fade < 1 && prv !== undefined)
            apply(b, prv, clipTime(prv, tq, b.prevStart, rate(prv)), 1);
          apply(
            b,
            cur,
            clipTime(cur, tq, b.clipStart, rate(cur)),
            fade < 1 && prv !== undefined ? fade : 1,
          );
          if (f.bright !== b.bright || f.flash !== b.flash) {
            b.bright = f.bright;
            b.flash = f.flash;
            b.material.color.copy(BASE).multiplyScalar(f.bright).lerp(FLASH, f.flash);
          }
        },
        muzzle(k, out) {
          const b = bots[k];
          const m = b?.muzzle;
          if (b === undefined || m === null || m === undefined) return;
          b.root.updateMatrixWorld(true);
          const e = m.matrixWorld.elements;
          out.x = e[12];
          out.y = e[13];
          out.z = e[14];
        },
        setQuality(lod0DistanceM, hz, reducedMotion) {
          lod0Dist = lod0DistanceM;
          animHz = hz > 0 ? hz : 30;
          reduced = reducedMotion;
          for (const b of bots) b.lod = -1;
        },
        resetBot(k) {
          const b = bots[k];
          if (b === undefined) return;
          b.clip = 'idle';
          b.prev = 'idle';
          b.clipStart = 0;
          b.switchAt = -Infinity;
          b.hints.fill(0);
          b.bright = -1;
        },
        dispose() {
          for (const b of bots) {
            b.material.dispose();
            group.remove(b.root);
          }
          bots.length = 0;
        },
      };
      return pool;
    },
  };
}
