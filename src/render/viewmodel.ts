/**
 * First-person viewmodel (business-logic-model §3.3, story-weapon-feedback).
 * `viewmodelPose` is pure. The rigs are procedural box models drawn in the
 * second, depth-cleared pass with a fixed 55° camera (BR-P-43).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Sprite,
  SpriteMaterial,
  type BufferGeometry,
  type Texture,
} from 'three';
import { clamp, TICK_DT } from '../core';
import { smoothstep } from './camera-math';
import { VM_FLASH_SIZE_M } from './constants';
import type { BotWeaponIndex } from './bot-rig';

/** Rest socket in the viewmodel camera (m). */
export const VM_SOCKET = Object.freeze({ x: 0.18, y: -0.17, z: -0.38 });
/** Per weapon: rifle, pistol, sniper. */
export const VM_KICK_M = [0.035, 0.05, 0.1] as const;
export const VM_KICK_TAU = [0.06, 0.07, 0.16] as const;
export const VM_X_SHIFT = [0, 0.02, -0.01] as const;
export const VM_SWITCH_SEC = 0.12;
export const VM_SWITCH_DROP_M = 0.25;
export const VM_RELOAD_DROP_M = 0.14;
export const VM_RELOAD_ROLL = 0.45;
export const VM_MAG_DROP_M = 0.25;
const BOB_RUN_SPEED = 4.5;

export interface ViewmodelPoseInput {
  weapon: BotWeaponIndex;
  t: number;
  lastFireTick: number;
  reloading: boolean;
  reloadProgress: number;
  switching: boolean;
  /** Render time the current lower started, or −1. */
  switchStart: number;
  /** Render time the last switch finished, or −1. */
  switchEnd: number;
  speed: number;
  grounded: boolean;
  scopeBlend: number;
  alive: boolean;
  reducedMotion: boolean;
}

export interface ViewmodelPose {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
  visible: boolean;
  /** Magazine offset along y (≤ 0). */
  magOffset: number;
  /** Recoil kick distance (m), exposed for tests. */
  kick: number;
}

export function createViewmodelPose(): ViewmodelPose {
  return { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, visible: true, magOffset: 0, kick: 0 };
}

export function createViewmodelInput(): ViewmodelPoseInput {
  return {
    weapon: 0,
    t: 0,
    lastFireTick: -1,
    reloading: false,
    reloadProgress: 0,
    switching: false,
    switchStart: -1,
    switchEnd: -1,
    speed: 0,
    grounded: true,
    scopeBlend: 0,
    alive: true,
    reducedMotion: false,
  };
}

/** Recoil kick in metres at render time t (0 before the shot or when never fired). */
export function recoilKick(weapon: BotWeaponIndex, t: number, lastFireTick: number): number {
  if (!(lastFireTick >= 0)) return 0;
  const age = t - lastFireTick * TICK_DT;
  if (age < 0) return 0;
  return VM_KICK_M[weapon] * Math.exp(-age / VM_KICK_TAU[weapon]);
}

/** Magazine offset for a reload progress p in [0, 1]. */
export function magazineOffset(p: number): number {
  if (p < 0.45) return (-VM_MAG_DROP_M * p) / 0.45;
  if (p <= 0.55) return -VM_MAG_DROP_M;
  return -VM_MAG_DROP_M * (1 - (p - 0.55) / 0.45);
}

export function viewmodelPose(i: ViewmodelPoseInput, out: ViewmodelPose): ViewmodelPose {
  out.visible = i.alive && i.scopeBlend <= 0.5;
  out.x = VM_SOCKET.x + VM_X_SHIFT[i.weapon];
  out.y = VM_SOCKET.y;
  out.z = VM_SOCKET.z;
  out.pitch = 0;
  out.yaw = 0;
  out.roll = 0;
  out.magOffset = 0;

  const k = recoilKick(i.weapon, i.t, i.lastFireTick);
  out.kick = k;
  out.z += k;
  out.pitch += 4 * k;

  if (i.reloading) {
    const p = clamp(Number.isFinite(i.reloadProgress) ? i.reloadProgress : 0, 0, 1);
    const s = Math.sin(Math.PI * p);
    out.y -= VM_RELOAD_DROP_M * s;
    out.roll += VM_RELOAD_ROLL * s;
    out.magOffset = magazineOffset(p);
  }

  let lower = 0;
  if (i.switching) {
    lower = i.switchStart >= 0 ? smoothstep(0, VM_SWITCH_SEC, i.t - i.switchStart) : 1;
  } else if (i.switchEnd >= 0) {
    lower = 1 - smoothstep(0, VM_SWITCH_SEC, i.t - i.switchEnd);
  }
  out.y -= VM_SWITCH_DROP_M * lower;

  if (i.grounded && !i.reducedMotion) {
    const r = clamp((Number.isFinite(i.speed) ? i.speed : 0) / BOB_RUN_SPEED, 0, 1.5);
    out.y += 0.012 * r * Math.sin(2 * Math.PI * 1.8 * i.t);
    out.x += 0.008 * r * Math.sin(Math.PI * 1.8 * i.t);
  }
  return out;
}

// ------------------------------------------------------------ rigs

export interface WeaponRig {
  readonly group: Group;
  readonly magazine: Mesh;
  readonly muzzle: Object3D;
  readonly flash: Sprite;
  readonly magRestY: number;
}

export interface ViewmodelRigs {
  readonly rigs: readonly [WeaponRig, WeaponRig, WeaponRig];
  readonly geometries: readonly BufferGeometry[];
  dispose(): void;
}

interface PartSpec {
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly mat: 0 | 1;
}

/** At most 3 body parts + magazine per weapon, so the viewmodel pass stays ≤ 5 calls with the flash. */
const RIG_SPECS: readonly { parts: readonly PartSpec[]; mag: PartSpec; muzzleZ: number }[] = [
  {
    parts: [
      { w: 0.06, h: 0.08, d: 0.42, x: 0, y: 0, z: -0.1, mat: 0 },
      { w: 0.025, h: 0.025, d: 0.24, x: 0, y: 0.015, z: -0.43, mat: 1 },
      { w: 0.05, h: 0.07, d: 0.16, x: 0, y: -0.01, z: 0.18, mat: 0 },
    ],
    mag: { w: 0.04, h: 0.12, d: 0.06, x: 0, y: -0.09, z: -0.06, mat: 1 },
    muzzleZ: -0.56,
  },
  {
    parts: [
      { w: 0.04, h: 0.045, d: 0.2, x: 0, y: 0.02, z: -0.08, mat: 1 },
      { w: 0.035, h: 0.11, d: 0.05, x: 0, y: -0.05, z: 0, mat: 0 },
    ],
    mag: { w: 0.028, h: 0.06, d: 0.035, x: 0, y: -0.1, z: 0, mat: 1 },
    muzzleZ: -0.19,
  },
  {
    parts: [
      { w: 0.06, h: 0.08, d: 0.5, x: 0, y: 0, z: -0.08, mat: 0 },
      { w: 0.025, h: 0.025, d: 0.42, x: 0, y: 0.015, z: -0.53, mat: 1 },
      { w: 0.045, h: 0.045, d: 0.22, x: 0, y: 0.075, z: -0.08, mat: 1 },
    ],
    mag: { w: 0.04, h: 0.08, d: 0.07, x: 0, y: -0.07, z: -0.02, mat: 1 },
    muzzleZ: -0.75,
  },
];

const RIG_NAMES = ['vm-rifle', 'vm-pistol', 'vm-sniper'] as const;

export function createViewmodelRigs(flashTexture: Texture): ViewmodelRigs {
  const mats = [
    new MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6, metalness: 0.3 }),
    new MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.4, metalness: 0.7 }),
  ] as const;
  const flashMat = new SpriteMaterial({
    map: flashTexture,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const geometries: BufferGeometry[] = [];
  const mesh = (s: PartSpec): Mesh => {
    const g = new BoxGeometry(s.w, s.h, s.d);
    geometries.push(g);
    const m = new Mesh(g, mats[s.mat]);
    m.position.set(s.x, s.y, s.z);
    return m;
  };
  const build = (i: 0 | 1 | 2): WeaponRig => {
    const spec = RIG_SPECS[i];
    const group = new Group();
    group.name = RIG_NAMES[i];
    for (const p of spec?.parts ?? []) group.add(mesh(p));
    const magSpec = spec?.mag ?? { w: 0.04, h: 0.1, d: 0.05, x: 0, y: -0.08, z: 0, mat: 1 };
    const magazine = mesh(magSpec);
    magazine.name = `${RIG_NAMES[i]}-mag`;
    group.add(magazine);
    const muzzle = new Object3D();
    muzzle.name = 'muzzle-socket';
    muzzle.position.set(0, 0.015, spec?.muzzleZ ?? -0.5);
    group.add(muzzle);
    const flash = new Sprite(flashMat);
    flash.name = 'vm-flash';
    flash.scale.set(VM_FLASH_SIZE_M, VM_FLASH_SIZE_M, 1);
    flash.visible = false;
    flash.renderOrder = 10;
    muzzle.add(flash);
    group.visible = i === 0;
    return { group, magazine, muzzle, flash, magRestY: magSpec.y };
  };
  return {
    rigs: [build(0), build(1), build(2)],
    geometries,
    dispose() {
      for (const g of geometries) g.dispose();
      mats[0].dispose();
      mats[1].dispose();
      flashMat.dispose();
    },
  };
}
