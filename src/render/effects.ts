/**
 * Effect pools (business-logic-model §3.5, PD-P-05, PD-P-06, SC-P-02).
 * Each pool is a fixed ring allocated at the High cap with struct-of-arrays
 * columns. The preset sets the active cap; when it is full the oldest slot is
 * reused and counted as render/pool-recycled. Nothing allocates after init.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three';
import type { Diagnostics } from '../core';
import {
  DECAL_FADE_SEC,
  DECAL_LIFE_SEC,
  DECAL_OPACITY,
  DECAL_SIZE_M,
  GRAVITY,
  PARTICLE_LIFE_SEC,
  PARTICLE_SIZE_M,
  TRACER_OPACITY,
  TRACER_TICKS,
  TRACER_WIDTH_M,
} from './constants';
import { TICK_DT } from '../core';
import { MAX_DECALS, MAX_PARTICLES, MAX_TRACERS } from './presets';
import { hashUnit } from './textures';

const NEVER = -1e9;
const TRACER_LIFE_SEC = TRACER_TICKS * TICK_DT;
const ZERO = new Matrix4().makeScale(0, 0, 0);

const vA = new Vector3();
const vB = new Vector3();
const vC = new Vector3();
const vD = new Vector3();
const mTmp = new Matrix4();
const mTmpCompose = new Matrix4();
const qTmp = new Quaternion();
const Z_AXIS = new Vector3(0, 0, 1);
const cTmp = new Color();

/** Ring cursor shared by the pools. */
class Ring {
  readonly capacity: number;
  activeCap: number;
  cursor = 0;
  readonly spawn: Float64Array;
  constructor(capacity: number) {
    this.capacity = capacity;
    this.activeCap = capacity;
    this.spawn = new Float64Array(capacity).fill(NEVER);
  }
  /** Next slot; true in `recycled` when it still held a live effect. */
  take(now: number, life: number, diagnostics: Diagnostics): number {
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % this.activeCap;
    if (now - (this.spawn[slot] ?? NEVER) < life) diagnostics.count('render/pool-recycled');
    return slot;
  }
  setCap(cap: number): void {
    const c = Math.max(1, Math.min(this.capacity, cap));
    if (c === this.activeCap) return;
    this.activeCap = c;
    this.cursor = 0;
    this.spawn.fill(NEVER);
  }
  reset(): void {
    this.cursor = 0;
    this.spawn.fill(NEVER);
  }
  liveCount(now: number, life: number): number {
    let n = 0;
    for (let i = 0; i < this.activeCap; i++) {
      const age = now - (this.spawn[i] ?? NEVER);
      if (age >= 0 && age < life) n += 1;
    }
    return n;
  }
}

function upload(attr: BufferAttribute | InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count * attr.itemSize);
  attr.needsUpdate = true;
}

// ------------------------------------------------------------ tracers

export class TracerPool {
  readonly mesh: InstancedMesh;
  private readonly ring = new Ring(MAX_TRACERS);
  private readonly seg = new Float32Array(MAX_TRACERS * 6);
  private readonly diagnostics: Diagnostics;
  private lastNow = 0;
  private dirty = true;

  constructor(diagnostics: Diagnostics) {
    this.diagnostics = diagnostics;
    const mat = new MeshBasicMaterial({
      color: 0xffe2a8,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, MAX_TRACERS);
    this.mesh.name = 'tracers';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < MAX_TRACERS; i++) {
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, cTmp.setRGB(0, 0, 0));
    }
    this.mesh.instanceColor?.setUsage(DynamicDrawUsage);
  }

  get activeCap(): number {
    return this.ring.activeCap;
  }

  setCap(cap: number): void {
    this.ring.setCap(cap);
    this.dirty = true;
  }

  add(
    sx: number,
    sy: number,
    sz: number,
    ex: number,
    ey: number,
    ez: number,
    spawnT: number,
  ): void {
    const s = this.ring.take(this.lastNow, TRACER_LIFE_SEC, this.diagnostics);
    const o = s * 6;
    this.seg[o] = sx;
    this.seg[o + 1] = sy;
    this.seg[o + 2] = sz;
    this.seg[o + 3] = ex;
    this.seg[o + 4] = ey;
    this.seg[o + 5] = ez;
    this.ring.spawn[s] = spawnT;
    this.dirty = true;
  }

  /** Builds camera-facing quads along each live segment and fades them out over 4 ticks. */
  update(now: number, cam: Vector3): void {
    this.lastNow = now;
    const n = this.ring.activeCap;
    let anyLive = false;
    for (let i = 0; i < n; i++) {
      const age = now - (this.ring.spawn[i] ?? NEVER);
      if (age < 0 || age >= TRACER_LIFE_SEC) {
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      anyLive = true;
      const o = i * 6;
      vA.set(this.seg[o] ?? 0, this.seg[o + 1] ?? 0, this.seg[o + 2] ?? 0);
      vB.set(this.seg[o + 3] ?? 0, this.seg[o + 4] ?? 0, this.seg[o + 5] ?? 0);
      vC.subVectors(vB, vA); // axis
      const len = vC.length();
      if (len < 1e-4) {
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      vC.multiplyScalar(1 / len);
      vB.add(vA).multiplyScalar(0.5); // midpoint
      vD.subVectors(cam, vB); // to camera
      vA.crossVectors(vC, vD); // side
      if (vA.lengthSq() < 1e-12) vA.set(1, 0, 0);
      vA.normalize();
      vD.crossVectors(vA, vC).normalize(); // quad normal
      vA.multiplyScalar(TRACER_WIDTH_M);
      vC.multiplyScalar(len);
      mTmp.makeBasis(vA, vC, vD).setPosition(vB);
      this.mesh.setMatrixAt(i, mTmp);
      const f = TRACER_OPACITY * (1 - age / TRACER_LIFE_SEC);
      this.mesh.setColorAt(i, cTmp.setRGB(f, f, f));
    }
    this.mesh.count = n;
    if (anyLive || this.dirty) {
      upload(this.mesh.instanceMatrix, n);
      if (this.mesh.instanceColor !== null) upload(this.mesh.instanceColor, n);
    }
    this.dirty = anyLive;
  }

  live(now: number): number {
    return this.ring.liveCount(now, TRACER_LIFE_SEC);
  }

  /** Spawn time of slot i (tests). */
  spawnAt(i: number): number {
    return this.ring.spawn[i] ?? NEVER;
  }

  reset(): void {
    this.ring.reset();
    for (let i = 0; i < MAX_TRACERS; i++) this.mesh.setMatrixAt(i, ZERO);
    this.dirty = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}

// ------------------------------------------------------------ decals

const DECAL_VERTEX = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
varying vec2 vUv;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;

const DECAL_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float opacity;
varying float vAlpha;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  gl_FragColor = vec4(c.rgb, c.a * opacity * vAlpha);
  #include <colorspace_fragment>
}
`;

export class DecalPool {
  readonly mesh: InstancedMesh;
  private readonly ring = new Ring(MAX_DECALS);
  private readonly alpha: InstancedBufferAttribute;
  private readonly diagnostics: Diagnostics;
  private readonly material: ShaderMaterial;
  private lastNow = 0;
  private matricesDirty = true;
  private alphaDirty = true;

  constructor(texture: Texture, diagnostics: Diagnostics) {
    this.diagnostics = diagnostics;
    const geom = new PlaneGeometry(1, 1);
    this.alpha = new InstancedBufferAttribute(new Float32Array(MAX_DECALS), 1);
    this.alpha.setUsage(DynamicDrawUsage);
    geom.setAttribute('aAlpha', this.alpha);
    this.material = new ShaderMaterial({
      uniforms: { map: { value: texture }, opacity: { value: DECAL_OPACITY } },
      vertexShader: DECAL_VERTEX,
      fragmentShader: DECAL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(geom, this.material, MAX_DECALS);
    this.mesh.name = 'decals';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    for (let i = 0; i < MAX_DECALS; i++) this.mesh.setMatrixAt(i, ZERO);
  }

  get activeCap(): number {
    return this.ring.activeCap;
  }

  setCap(cap: number): void {
    this.ring.setCap(cap);
    for (let i = 0; i < MAX_DECALS; i++) this.mesh.setMatrixAt(i, ZERO);
    this.matricesDirty = true;
  }

  /** A decal at point + 0.01 × normal, facing the normal, rotated by `seed`. */
  add(
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    spawnT: number,
    seed: number,
  ): void {
    const s = this.ring.take(this.lastNow, DECAL_LIFE_SEC, this.diagnostics);
    vA.set(nx, ny, nz);
    if (vA.lengthSq() < 1e-12) vA.set(0, 1, 0);
    vA.normalize();
    qTmp.setFromUnitVectors(Z_AXIS, vA);
    mTmp.makeRotationZ(seed * Math.PI * 2);
    vB.set(px + vA.x * 0.01, py + vA.y * 0.01, pz + vA.z * 0.01);
    vC.set(DECAL_SIZE_M, DECAL_SIZE_M, 1);
    mTmpCompose.compose(vB, qTmp, vC).multiply(mTmp);
    this.mesh.setMatrixAt(s, mTmpCompose);
    this.ring.spawn[s] = spawnT;
    this.matricesDirty = true;
  }

  update(now: number): void {
    this.lastNow = now;
    const n = this.ring.activeCap;
    let changed = false;
    const arr = this.alpha.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const age = now - (this.ring.spawn[i] ?? NEVER);
      let a = 0;
      if (age >= 0 && age < DECAL_LIFE_SEC) {
        const left = DECAL_LIFE_SEC - age;
        a = left < DECAL_FADE_SEC ? left / DECAL_FADE_SEC : 1;
      }
      if (arr[i] !== a) {
        arr[i] = a;
        changed = true;
      }
    }
    this.mesh.count = n;
    if (changed || this.alphaDirty) upload(this.alpha, n);
    if (this.matricesDirty) upload(this.mesh.instanceMatrix, n);
    this.alphaDirty = false;
    this.matricesDirty = false;
  }

  live(now: number): number {
    return this.ring.liveCount(now, DECAL_LIFE_SEC);
  }

  alphaAt(i: number): number {
    return (this.alpha.array as Float32Array)[i] ?? 0;
  }

  reset(): void {
    this.ring.reset();
    for (let i = 0; i < MAX_DECALS; i++) this.mesh.setMatrixAt(i, ZERO);
    (this.alpha.array as Float32Array).fill(0);
    this.matricesDirty = true;
    this.alphaDirty = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ------------------------------------------------------------ particles

export class ParticlePool {
  readonly points: Points;
  private readonly ring = new Ring(MAX_PARTICLES);
  /** origin xyz, velocity xyz */
  private readonly motion = new Float32Array(MAX_PARTICLES * 6);
  private readonly rgb = new Float32Array(MAX_PARTICLES * 3);
  private readonly position: BufferAttribute;
  private readonly colour: BufferAttribute;
  private readonly diagnostics: Diagnostics;
  private readonly material: PointsMaterial;
  private lastNow = 0;
  private dirty = true;
  perBurst = 8;

  constructor(texture: Texture, diagnostics: Diagnostics) {
    this.diagnostics = diagnostics;
    const geom = new BufferGeometry();
    this.position = new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.colour = new BufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4);
    this.position.setUsage(DynamicDrawUsage);
    this.colour.setUsage(DynamicDrawUsage);
    geom.setAttribute('position', this.position);
    geom.setAttribute('color', this.colour);
    this.material = new PointsMaterial({
      size: PARTICLE_SIZE_M,
      map: texture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new Points(geom, this.material);
    this.points.name = 'particles';
    this.points.frustumCulled = false;
  }

  get activeCap(): number {
    return this.ring.activeCap;
  }

  setCap(cap: number, perBurst: number): void {
    this.ring.setCap(cap);
    this.perBurst = perBurst;
    (this.colour.array as Float32Array).fill(0);
    this.dirty = true;
  }

  /**
   * Emits `perBurst` particles from p in a cone around n. Variation comes from
   * hash(tick, eventIndex, k), so a replay renders identically.
   */
  burst(
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    spawnT: number,
    tick: number,
    eventIndex: number,
    speed: number,
    colour: Color,
  ): void {
    for (let k = 0; k < this.perBurst; k++) {
      const s = this.ring.take(this.lastNow, PARTICLE_LIFE_SEC, this.diagnostics);
      const h = k * 4;
      const rx = hashUnit(tick, eventIndex, h) * 2 - 1;
      const ry = hashUnit(tick, eventIndex, h + 1) * 2 - 1;
      const rz = hashUnit(tick, eventIndex, h + 2) * 2 - 1;
      const sp = speed * (0.5 + hashUnit(tick, eventIndex, h + 3));
      vA.set(nx + rx * 0.7, ny + ry * 0.7, nz + rz * 0.7);
      if (vA.lengthSq() < 1e-8) vA.set(0, 1, 0);
      vA.normalize().multiplyScalar(sp);
      const o = s * 6;
      this.motion[o] = px;
      this.motion[o + 1] = py;
      this.motion[o + 2] = pz;
      this.motion[o + 3] = vA.x;
      this.motion[o + 4] = vA.y;
      this.motion[o + 5] = vA.z;
      this.rgb[s * 3] = colour.r;
      this.rgb[s * 3 + 1] = colour.g;
      this.rgb[s * 3 + 2] = colour.b;
      this.ring.spawn[s] = spawnT;
    }
    this.dirty = true;
  }

  update(now: number): void {
    this.lastNow = now;
    const n = this.ring.activeCap;
    const pos = this.position.array as Float32Array;
    const col = this.colour.array as Float32Array;
    let anyLive = false;
    for (let i = 0; i < n; i++) {
      const age = now - (this.ring.spawn[i] ?? NEVER);
      if (age < 0 || age >= PARTICLE_LIFE_SEC) {
        col[i * 4 + 3] = 0;
        continue;
      }
      anyLive = true;
      const o = i * 6;
      pos[i * 3] = (this.motion[o] ?? 0) + (this.motion[o + 3] ?? 0) * age;
      pos[i * 3 + 1] =
        (this.motion[o + 1] ?? 0) + (this.motion[o + 4] ?? 0) * age - 0.5 * GRAVITY * age * age;
      pos[i * 3 + 2] = (this.motion[o + 2] ?? 0) + (this.motion[o + 5] ?? 0) * age;
      col[i * 4] = this.rgb[i * 3] ?? 1;
      col[i * 4 + 1] = this.rgb[i * 3 + 1] ?? 1;
      col[i * 4 + 2] = this.rgb[i * 3 + 2] ?? 1;
      col[i * 4 + 3] = 1 - age / PARTICLE_LIFE_SEC;
    }
    this.points.geometry.setDrawRange(0, n);
    if (anyLive || this.dirty) {
      upload(this.position, n);
      upload(this.colour, n);
    }
    this.dirty = anyLive;
  }

  live(now: number): number {
    return this.ring.liveCount(now, PARTICLE_LIFE_SEC);
  }

  reset(): void {
    this.ring.reset();
    (this.colour.array as Float32Array).fill(0);
    this.dirty = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
