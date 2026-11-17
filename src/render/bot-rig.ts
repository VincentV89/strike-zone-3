/**
 * Bot rig (business-logic-model §3.4, story-bot-death, story-visual-polish).
 * One InstancedMesh per body part (9 draw calls for every bot) plus one
 * InstancedMesh of camera-facing muzzle-flash quads (PD-P-01). The pose
 * function is pure and writes into caller-owned matrices.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Texture,
} from 'three';
import {
  DEATH_BRIGHTNESS,
  DEATH_REST_LIFT_M,
  DEATH_SIDE_LIFT_M,
  DEATH_TOPPLE_SEC,
  MAX_BOTS,
} from './constants';
import { easeOutCubic } from './camera-math';

export const BOT_PART_NAMES = [
  'bot-head',
  'bot-torso',
  'bot-hips',
  'bot-leg-l',
  'bot-leg-r',
  'bot-arms',
  'bot-gun-rifle',
  'bot-gun-pistol',
  'bot-gun-sniper',
] as const;
export const BOT_PART_COUNT = BOT_PART_NAMES.length;

const HEAD = 0;
const TORSO = 1;
const HIPS = 2;
const LEG_L = 3;
const LEG_R = 4;
const ARMS = 5;
const GUN0 = 6;

/** Rig proportions (m). Standing top = 1.8, crouched top = 1.2, half width 0.22 < radius 0.4. */
export const RIG = Object.freeze({
  legLength: 0.85,
  legX: 0.1,
  hipsHeight: 0.15,
  torsoHeight: 0.5,
  headHeight: 0.28,
  headY: 0.52,
  shoulderY: 0.4,
  crouchDrop: 0.6,
  gunLengths: [0.7, 0.25, 0.95] as const,
});

/** Leg bend that leaves 0.25 m of vertical leg when crouched. */
const CROUCH_BEND = Math.acos((RIG.legLength - RIG.crouchDrop) / RIG.legLength);
const WALK_SWING = 0.5;
const WALK_HZ = 2;

export const BOT_COLOURS = Object.freeze({
  body: new Color(0x6e7350),
  limbs: new Color(0x3f4232),
  gun: new Color(0x262626),
});

const WEAPON_INDEX = { rifle: 0, pistol: 1, sniper: 2 } as const;
export type BotWeaponIndex = 0 | 1 | 2;
export function weaponIndex(w: keyof typeof WEAPON_INDEX): BotWeaponIndex {
  return WEAPON_INDEX[w];
}

/** Mutable, reused input to botPartMatrices. */
export interface BotPoseInput {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: boolean;
  moving: boolean;
  alive: boolean;
  /** Seconds since death (≥ 0) or −1 while alive. */
  deathAge: number;
  /** Horizontal unit vector the body falls toward. */
  fallX: number;
  fallZ: number;
  t: number;
  id: number;
  weapon: BotWeaponIndex;
}

export function createPoseInput(): BotPoseInput {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    crouch: false,
    moving: false,
    alive: true,
    deathAge: -1,
    fallX: 0,
    fallZ: 1,
    t: 0,
    id: 1,
    weapon: 0,
  };
}

const ZERO = new Matrix4().makeScale(0, 0, 0);
const mRoot = new Matrix4();
const mTmp = new Matrix4();
const mTorso = new Matrix4();
const mArms = new Matrix4();
const qA = new Quaternion();
const vAxis = new Vector3();
const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

/** Topple angle in radians for an age since death. Reaches π/2 at 0.5 s and stays. */
export function toppleAngle(deathAge: number): number {
  if (deathAge < 0) return 0;
  return (Math.PI / 2) * easeOutCubic(deathAge / DEATH_TOPPLE_SEC);
}

/** Brightness factor: 1 alive, easing to 35 % over the topple. */
export function deathBrightness(deathAge: number): number {
  if (deathAge < 0) return 1;
  const e = easeOutCubic(deathAge / DEATH_TOPPLE_SEC);
  return 1 - (1 - DEATH_BRIGHTNESS) * e;
}

/**
 * Writes the world matrix of every rig part into `out` (length 9) and the
 * muzzle point into `muzzle`. Unused weapon variants get a zero-scale matrix.
 */
export function botPartMatrices(p: BotPoseInput, out: readonly Matrix4[], muzzle: Vector3): void {
  // Root: feet at pos, yaw about +Y, then the death topple about the feet.
  mRoot.makeTranslation(p.x, p.y, p.z);
  if (p.deathAge >= 0) {
    const e = easeOutCubic(p.deathAge / DEATH_TOPPLE_SEC);
    // Lift by the body's half thickness along the side that ends up facing down.
    const lx = Math.abs(p.fallX * Math.cos(p.yaw) - p.fallZ * Math.sin(p.yaw));
    const lz = Math.abs(p.fallX * Math.sin(p.yaw) + p.fallZ * Math.cos(p.yaw));
    mTmp.makeTranslation(0, (DEATH_SIDE_LIFT_M * lx + DEATH_REST_LIFT_M * lz) * e, 0);
    mRoot.multiply(mTmp);
    vAxis.set(p.fallX, 0, p.fallZ).cross(UP).negate(); // up × fall
    if (vAxis.lengthSq() < 1e-12) vAxis.set(1, 0, 0);
    vAxis.normalize();
    qA.setFromAxisAngle(vAxis, toppleAngle(p.deathAge));
    mTmp.makeRotationFromQuaternion(qA);
    mRoot.multiply(mTmp);
  }
  mTmp.makeRotationY(p.yaw);
  mRoot.multiply(mTmp);

  const drop = p.crouch ? RIG.crouchDrop : 0;
  const hipY = RIG.legLength - drop;
  const walking = p.moving && p.alive && p.deathAge < 0;
  const swing = walking ? WALK_SWING * Math.sin(2 * Math.PI * WALK_HZ * p.t + p.id * 0.37) : 0;
  const bend = p.crouch ? CROUCH_BEND : 0;

  // Legs pivot at the hip; +X rotation swings the foot forward (−Z).
  setLocal(out[LEG_L], mRoot, -RIG.legX, hipY, 0, bend + swing);
  setLocal(out[LEG_R], mRoot, RIG.legX, hipY, 0, bend - swing);
  setLocal(out[HIPS], mRoot, 0, hipY, 0, 0);

  // Torso pivots at the waist by half the pitch; head and arms take the rest.
  const waistY = hipY + RIG.hipsHeight;
  mTorso.copy(mRoot).multiply(mTmp.makeTranslation(0, waistY, 0));
  mTorso.multiply(mTmp.makeRotationAxis(X_AXIS, 0.5 * p.pitch));
  out[TORSO]?.copy(mTorso);
  setLocal(out[HEAD], mTorso, 0, RIG.headY, 0, 0.5 * p.pitch);
  mArms.copy(mTorso).multiply(mTmp.makeTranslation(0, RIG.shoulderY, 0));
  mArms.multiply(mTmp.makeRotationAxis(X_AXIS, 0.5 * p.pitch));
  out[ARMS]?.copy(mArms);

  for (let w = 0; w < 3; w++) {
    const m = out[GUN0 + w];
    if (m === undefined) continue;
    if (w === p.weapon) {
      m.copy(mArms).multiply(mTmp.makeTranslation(0.06, -0.02, -0.42));
    } else {
      m.copy(ZERO);
    }
  }
  const gun = out[GUN0 + p.weapon];
  muzzle.set(0, 0, -RIG.gunLengths[p.weapon]);
  if (gun !== undefined) muzzle.applyMatrix4(gun);
}

function setLocal(
  out: Matrix4 | undefined,
  parent: Matrix4,
  x: number,
  y: number,
  z: number,
  rotX: number,
): void {
  if (out === undefined) return;
  out.copy(parent).multiply(mTmp.makeTranslation(x, y, z));
  if (rotX !== 0) out.multiply(mTmp.makeRotationAxis(X_AXIS, rotX));
}

const white = new Color(1, 1, 1);

/** Instance colour: tint × brightness, then a lerp toward white by `flash`. */
export function botColour(tint: Color, brightness: number, flash: number, out: Color): Color {
  out.setRGB(tint.r * brightness, tint.g * brightness, tint.b * brightness);
  if (flash > 0) out.lerp(white, flash);
  return out;
}

// ------------------------------------------------------------ meshes

export interface BotRig {
  readonly group: Group;
  readonly parts: readonly InstancedMesh[];
  readonly flashes: InstancedMesh;
  readonly geometries: readonly BufferGeometry[];
  /** Sets the drawn instance count on every part (0..20). */
  setCount(n: number): void;
  setCastShadow(cast: boolean): void;
  dispose(): void;
}

function partGeometry(i: number): BoxGeometry {
  switch (i) {
    case HEAD:
      return new BoxGeometry(0.24, RIG.headHeight, 0.24).translate(0, RIG.headHeight / 2, 0);
    case TORSO:
      return new BoxGeometry(0.44, RIG.torsoHeight, 0.26).translate(0, RIG.torsoHeight / 2, 0);
    case HIPS:
      return new BoxGeometry(0.36, RIG.hipsHeight, 0.22).translate(0, RIG.hipsHeight / 2, 0);
    case LEG_L:
    case LEG_R:
      return new BoxGeometry(0.16, RIG.legLength, 0.18).translate(0, -RIG.legLength / 2, 0);
    case ARMS:
      return new BoxGeometry(0.5, 0.12, 0.45).translate(0, -0.06, -0.2);
    default: {
      const len = RIG.gunLengths[(i - GUN0) as 0 | 1 | 2];
      return new BoxGeometry(0.06, 0.1, len).translate(0, 0, -len / 2);
    }
  }
}

function tintFor(i: number): Color {
  if (i >= GUN0) return BOT_COLOURS.gun;
  if (i === LEG_L || i === LEG_R || i === ARMS) return BOT_COLOURS.limbs;
  return BOT_COLOURS.body;
}

export function partTint(i: number): Color {
  return tintFor(i);
}

export function createBotRig(flashTexture: Texture): BotRig {
  const group = new Group();
  group.name = 'bots';
  const bodyMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  const gunMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.4 });
  const geometries: BufferGeometry[] = [];
  const parts: InstancedMesh[] = [];
  const c = new Color();
  for (let i = 0; i < BOT_PART_COUNT; i++) {
    const g = partGeometry(i);
    geometries.push(g);
    const mesh = new InstancedMesh(g, i >= GUN0 ? gunMat : bodyMat, MAX_BOTS);
    mesh.name = BOT_PART_NAMES[i] ?? 'bot-part';
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let k = 0; k < MAX_BOTS; k++) {
      mesh.setMatrixAt(k, ZERO);
      mesh.setColorAt(k, c.copy(tintFor(i)));
    }
    mesh.instanceColor?.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    parts.push(mesh);
    group.add(mesh);
  }
  const flashGeom = new PlaneGeometry(1, 1);
  geometries.push(flashGeom);
  const flashMat = new MeshBasicMaterial({
    map: flashTexture,
    color: 0xffffff,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const flashes = new InstancedMesh(flashGeom, flashMat, MAX_BOTS);
  flashes.name = 'bot-flashes';
  flashes.instanceMatrix.setUsage(DynamicDrawUsage);
  for (let k = 0; k < MAX_BOTS; k++) flashes.setMatrixAt(k, ZERO);
  flashes.frustumCulled = false;
  flashes.count = 0;
  group.add(flashes);
  return {
    group,
    parts,
    flashes,
    geometries,
    setCount(n) {
      for (const p of parts) p.count = n;
      flashes.count = n;
    },
    setCastShadow(cast) {
      for (const p of parts) p.castShadow = cast;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      bodyMat.dispose();
      gunMat.dispose();
      flashMat.dispose();
    },
  };
}

export const ZERO_MATRIX: Readonly<Matrix4> = ZERO;
