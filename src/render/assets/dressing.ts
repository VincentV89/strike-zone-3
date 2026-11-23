/**
 * Environment dressing layer (req-gfx-environment-dressing, req-gfx-lod-instancing,
 * performance-design §3.4). Lazy kit chunk.
 *
 * One InstancedMesh per (catalog id, LOD, primitive). Placements come from map data:
 * blocking and visual props, deterministic scatter and the backdrop. Preset density and
 * cap select placements by normalised hash: keep u < density first, then the cap with the
 * smallest u (scalability-design §1). A periodic pass (every 0.25 s or 2 m of camera travel)
 * picks LOD0 / LOD1 / culled per instance with ±10 % hysteresis and compacts the visible
 * matrices to the front of each buffer. Blocking props are never distance-culled.
 */
import {
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  StaticDrawUsage,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { MapDefinition, PropCatalogEntry } from '../../maps';
import type { AssetEntry, AssetLookup, DressingApi, DressingLayer, DressingOptions } from './types';

const REFRESH_SEC = 0.25;
const REFRESH_MOVE_M = 2;

/** 32-bit integer hash of two numbers (deterministic, no Math.random). */
export function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
export const unit = (h: number): number => h / 4294967296;

export interface Placement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  /** Selection key in [0, 1); lower survives the cap. Authored props use 0 (always kept). */
  readonly u: number;
  readonly blocking: boolean;
  readonly shadow: boolean;
  /** Scatter and backdrop are optional detail; props are kept on every preset. */
  readonly optional: boolean;
}

/** Expands map dressing into placements, applying density then cap (scalability-design §1). */
export function placementsFor(
  def: MapDefinition,
  catalog: ReadonlyMap<string, PropCatalogEntry>,
  density: number,
  cap: number,
): Placement[] {
  const d = def.dressing;
  if (d === undefined) return [];
  const out: Placement[] = [];
  d.props.forEach(([id, x, y, z, q, s]) => {
    const c = catalog.get(id);
    if (c === undefined) return;
    out.push({
      id,
      x,
      y,
      z,
      yaw: (q * Math.PI) / 2,
      scale: s,
      u: 0,
      blocking: c.kind !== 'visual',
      shadow: true,
      optional: false,
    });
  });
  const optional: Placement[] = [];
  d.scatter.forEach((r, ri) => {
    const sx = r.region.max.x - r.region.min.x;
    const sz = r.region.max.z - r.region.min.z;
    for (let i = 0; i < r.count; i++) {
      const h = hash2(r.seed + ri * 7919, i);
      const u = unit(h);
      if (u >= density) continue;
      const px = r.region.min.x + unit(hash2(h, 1)) * sx;
      const pz = r.region.min.z + unit(hash2(h, 2)) * sz;
      const sc = r.scale[0] + unit(hash2(h, 3)) * (r.scale[1] - r.scale[0]);
      optional.push({
        id: r.kind,
        x: px,
        y: r.region.min.y,
        z: pz,
        yaw: unit(hash2(h, 4)) * Math.PI * 2,
        scale: sc,
        u,
        blocking: false,
        shadow: false,
        optional: true,
      });
    }
  });
  d.backdrop.forEach((b, i) => {
    optional.push({
      id: b.model,
      x: b.pos.x,
      y: b.pos.y,
      z: b.pos.z,
      yaw: b.yaw,
      scale: b.scale,
      u: unit(hash2(i, 911)) * 0.01,
      blocking: false,
      shadow: false,
      optional: true,
    });
  });
  optional.sort((a, b) => a.u - b.u);
  const room = Math.max(0, cap - out.length);
  return out.concat(optional.slice(0, room));
}

interface LodPart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /** Mesh matrix relative to the prop's top node (dequantisation scale). */
  readonly local: Matrix4;
}

interface Batch {
  readonly id: string;
  readonly meshes: [InstancedMesh[], InstancedMesh[]];
  readonly matrices: Float32Array;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly lod: Int8Array;
  readonly blocking: boolean;
  readonly optional: boolean;
  readonly lods: number;
}

function partsOf(root: Object3D, name: string): LodPart[] {
  const node = root.getObjectByName(name);
  if (node === undefined) return [];
  const top = node.parent ?? node;
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(top.matrixWorld).invert();
  const out: LodPart[] = [];
  node.traverse((o) => {
    if (o instanceof Mesh && !Array.isArray(o.material)) {
      // Instanced props never morph; leftover shape keys would break three's morph path.
      const g = o.geometry as BufferGeometry;
      if (Object.keys(g.morphAttributes).length > 0) g.morphAttributes = {};
      out.push({
        geometry: o.geometry as BufferGeometry,
        material: o.material as Material,
        local: new Matrix4().multiplyMatrices(inv, o.matrixWorld),
      });
    }
  });
  return out;
}

const m4 = new Matrix4();
const m4b = new Matrix4();
const q4 = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const UP = new Vector3(0, 1, 0);

export interface DressingDeps {
  readonly bindTextures: (root: Object3D, entry: AssetEntry, lookup: AssetLookup) => boolean;
}

export function createDressingApi(deps: DressingDeps): DressingApi {
  return {
    build(def: MapDefinition, lookup: AssetLookup, opts: DressingOptions): DressingLayer | null {
      if (def.dressing === undefined) return null;
      const catalog = new Map(def.dressing.catalog.map((c) => [c.id, c] as const));
      const packEntries = new Map(
        opts.manifest.filter((e) => e.kind === 'model').map((e) => [e.key, e] as const),
      );
      const bound = new Set<string>();
      const placements = placementsFor(def, catalog, opts.density, opts.cap);
      const byId = new Map<string, Placement[]>();
      for (const p of placements) {
        const c = catalog.get(p.id);
        if (c === undefined || !opts.readyPacks.has(c.asset)) continue;
        let list = byId.get(p.id);
        if (list === undefined) {
          list = [];
          byId.set(p.id, list);
        }
        list.push(p);
      }
      // Batch budget: blocking props first, then visual props, then optional detail (BR-G-73).
      const ids = [...byId.keys()].sort(
        (a, b) => rank(byId.get(a)) - rank(byId.get(b)) || a.localeCompare(b),
      );
      const group = new Group();
      group.name = 'dressing';
      const batches: Batch[] = [];
      let calls = 0;
      let instances = 0;
      for (const id of ids) {
        const c = catalog.get(id);
        const list = byId.get(id);
        if (c === undefined || list === undefined) continue;
        const pack = lookup.model(c.asset);
        const entry = packEntries.get(c.asset);
        if (pack === null || entry === undefined) continue;
        if (!bound.has(c.asset)) {
          if (!deps.bindTextures(pack.root, entry, lookup)) continue;
          bound.add(c.asset);
        }
        const lod0 = partsOf(pack.root, `${id}_LOD0`);
        const lod1 = c.lods === 2 ? partsOf(pack.root, `${id}_LOD1`) : [];
        const need = lod0.length + lod1.length;
        if (lod0.length === 0 || calls + need > opts.maxBatches) continue;
        calls += need;
        const n = list.length;
        const matrices = new Float32Array(n * 16);
        const px = new Float32Array(n);
        const pz = new Float32Array(n);
        list.forEach((p, i) => {
          q4.setFromAxisAngle(UP, p.yaw);
          s3.setScalar(p.scale);
          v3.set(p.x, p.y, p.z);
          m4.compose(v3, q4, s3);
          m4.toArray(matrices, i * 16);
          px[i] = p.x;
          pz[i] = p.z;
        });
        const mk = (parts: LodPart[], lodIdx: number): InstancedMesh[] =>
          parts.map((part, pi) => {
            const geom = part.geometry;
            const mesh = new InstancedMesh(geom, part.material, n);
            mesh.name = `dressing:${id}:${String(lodIdx)}:${String(pi)}`;
            mesh.instanceMatrix.setUsage(StaticDrawUsage);
            const full = new Float32Array(n * 16);
            for (let i = 0; i < n; i++) {
              m4b.fromArray(matrices, i * 16).multiply(part.local);
              m4b.toArray(full, i * 16);
              mesh.setMatrixAt(i, m4b);
            }
            fullOf.set(mesh, full);
            mesh.computeBoundingSphere();
            mesh.count = 0;
            mesh.castShadow = false;
            mesh.receiveShadow = !list[0]?.optional;
            group.add(mesh);
            return mesh;
          });
        const blocking = list[0]?.blocking === true;
        const optional = list[0]?.optional === true;
        batches.push({
          id,
          meshes: [mk(lod0, 0), mk(lod1, 1)],
          matrices,
          px,
          pz,
          lod: new Int8Array(n).fill(-1),
          blocking,
          optional,
          lods: lod1.length > 0 ? 2 : 1,
        });
        instances += n;
      }

      let lastT = -Infinity;
      let lastX = NaN;
      let lastZ = NaN;
      const counts: [number, number] = [0, 0];

      function pass(cx: number, cz: number): void {
        for (const b of batches) {
          counts[0] = 0;
          counts[1] = 0;
          const n = b.px.length;
          for (let i = 0; i < n; i++) {
            const dx = (b.px[i] ?? 0) - cx;
            const dz = (b.pz[i] ?? 0) - cz;
            const d = Math.sqrt(dx * dx + dz * dz);
            const prev = b.lod[i] ?? -1;
            // Scatter detail drops to LOD1 at half the prop distance (triangle ceilings, BR-G-73).
            const lod0 = b.optional ? opts.lod0DistanceM * 0.5 : opts.lod0DistanceM;
            const near = prev === 0 ? lod0 * 1.1 : lod0 * 0.9;
            const far = b.blocking
              ? Infinity
              : prev >= 0
                ? opts.drawDistanceM * 1.1
                : opts.drawDistanceM * 0.9;
            let lod = d <= near ? 0 : d <= far ? 1 : -1;
            if (lod === 1 && b.lods === 1) lod = 0;
            b.lod[i] = lod;
            if (lod < 0) continue;
            const slot = counts[lod] ?? 0;
            // Visible matrices are compacted to the front from each part's full table.
            for (const mesh of b.meshes[lod === 0 ? 0 : 1]) {
              const full = fullOf.get(mesh);
              if (full === undefined) continue;
              const dst = mesh.instanceMatrix.array as Float32Array;
              const from = i * 16;
              const to = slot * 16;
              for (let e = 0; e < 16; e++) dst[to + e] = full[from + e] ?? 0;
            }
            counts[lod] = slot + 1;
          }
          for (let l = 0; l < 2; l++) {
            for (const mesh of b.meshes[l as 0 | 1]) {
              mesh.count = counts[l] ?? 0;
              mesh.instanceMatrix.clearUpdateRanges();
              mesh.instanceMatrix.addUpdateRange(0, Math.max(1, mesh.count) * 16);
              mesh.instanceMatrix.needsUpdate = true;
            }
          }
        }
      }

      return {
        group,
        instances,
        batches: calls,
        coveredSolids: new Set<number>(),
        refresh(cx, _cy, cz, t) {
          const moved =
            !Number.isFinite(lastX) || Math.hypot(cx - lastX, cz - lastZ) >= REFRESH_MOVE_M;
          if (!moved && t - lastT < REFRESH_SEC && t >= lastT) return;
          lastT = t;
          lastX = cx;
          lastZ = cz;
          pass(cx, cz);
        },
        setCastShadow(on) {
          for (const b of batches)
            for (const l of b.meshes) for (const m of l) m.castShadow = on && b.blocking;
        },
        dispose() {
          for (const b of batches) for (const l of b.meshes) for (const m of l) m.dispose();
          group.clear();
        },
      };
    },
  };
}

const fullOf = new WeakMap<InstancedMesh, Float32Array>();

function rank(list: readonly Placement[] | undefined): number {
  const p = list?.[0];
  if (p === undefined) return 3;
  return p.blocking ? 0 : p.optional ? 2 : 1;
}
