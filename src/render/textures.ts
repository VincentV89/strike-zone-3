/**
 * Procedural textures (req-original-assets, business-logic-model §2.4).
 * Pixels are painted in code into RGBA Uint8Arrays and uploaded as
 * DataTextures. No image files, no canvas, no data: URLs.
 */
import {
  DataTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';
import { createRng, fnv1a32, type Rng } from '../core';
import type { MaterialHint, MaterialPattern } from '../maps';

/** Small integer hash of up to three integers, for deterministic per-event variation. */
export function hash32(a: number, b = 0, c = 0): number {
  let h =
    Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** hash32 mapped to [0, 1). */
export function hashUnit(a: number, b = 0, c = 0): number {
  return hash32(a, b, c) / 4294967296;
}

function channel(rgb: number, shift: number): number {
  return (rgb >>> shift) & 0xff;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Tileable value noise lattice. */
interface Lattice {
  readonly n: number;
  readonly values: Float32Array;
}

function lattice(rng: Rng, n: number): Lattice {
  const values = new Float32Array(n * n);
  for (let i = 0; i < values.length; i++) values[i] = rng.next();
  return { n, values };
}

function latticeAt(l: Lattice, x: number, y: number): number {
  const xi = ((x % l.n) + l.n) % l.n;
  const yi = ((y % l.n) + l.n) % l.n;
  return l.values[yi * l.n + xi] ?? 0;
}

/** Smooth value noise in [0, 1) at u, v in [0, 1), periodic over the tile. */
function valueNoise(l: Lattice, u: number, v: number): number {
  const x = u * l.n;
  const y = v * l.n;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = latticeAt(l, x0, y0);
  const b = latticeAt(l, x0 + 1, y0);
  const c = latticeAt(l, x0, y0 + 1);
  const d = latticeAt(l, x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

type Painter = (u: number, v: number) => { mix: number; shade: number };

/** Returns, per pixel, how much of `accent` to mix in and a brightness factor. */
function painterFor(pattern: MaterialPattern, rng: Rng, size: number): Painter {
  const fine = lattice(rng, 32);
  const coarse = lattice(rng, 8);
  const px = 1 / size;
  const out = { mix: 0, shade: 1 };
  const jitter = (n: number, amount: number): Float32Array => {
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) arr[i] = 1 + (rng.next() * 2 - 1) * amount;
    return arr;
  };
  switch (pattern) {
    case 'noise':
      return (u, v) => {
        const n = 0.65 * valueNoise(coarse, u, v) + 0.35 * valueNoise(fine, u, v);
        out.mix = n * 0.35 * 2;
        out.shade = 0.94 + 0.12 * valueNoise(fine, v, u);
        return out;
      };
    case 'blocks': {
      const bricks = jitter(8, 0.06);
      return (u, v) => {
        const row = Math.floor(v * 4);
        const shifted = u + (row % 2 === 1 ? 0.25 : 0);
        const col = Math.floor(shifted * 2) % 2;
        const fu = (shifted * 2) % 1;
        const fv = (v * 4) % 1;
        const mortar = fu < 2 * px * 2 || fv < 2 * px * 4;
        out.mix = mortar ? 1 : 0;
        out.shade = mortar
          ? 1
          : (bricks[row * 2 + col] ?? 1) * (0.97 + 0.06 * valueNoise(fine, u, v));
        return out;
      };
    }
    case 'planks': {
      const planks = jitter(4, 0.05);
      return (u, v) => {
        const p = Math.floor(u * 4);
        const fu = (u * 4) % 1;
        const seam = fu < 1.5 * px * 4;
        const grain = 0.5 + 0.5 * Math.sin((v * 22 + valueNoise(coarse, u, v) * 3) * Math.PI * 2);
        out.mix = seam ? 1 : grain * 0.3;
        out.shade = seam ? 0.6 : (planks[p] ?? 1);
        return out;
      };
    }
    case 'corrugated':
      return (u, v) => {
        const ridge = Math.sin(u * 8 * Math.PI * 2);
        out.mix = 0.15 * valueNoise(coarse, u, v);
        out.shade = 0.95 + 0.15 * ridge;
        return out;
      };
    case 'stripes':
      return (u, v) => {
        const s = ((u + v) * 4) % 1;
        out.mix = s < 0.5 ? 1 : 0;
        out.shade = 0.96 + 0.08 * valueNoise(fine, u, v);
        return out;
      };
    case 'tiles': {
      const tiles = jitter(16, 0.04);
      return (u, v) => {
        const tx = Math.floor(u * 4);
        const ty = Math.floor(v * 4);
        const fu = (u * 4) % 1;
        const fv = (v * 4) % 1;
        const grout = fu < px * 4 || fv < px * 4;
        out.mix = grout ? 1 : 0;
        out.shade = grout ? 1 : (tiles[ty * 4 + tx] ?? 1);
        return out;
      };
    }
    case 'plain':
      return (u, v) => {
        out.mix = 0;
        out.shade = 0.97 + 0.06 * valueNoise(fine, u, v);
        return out;
      };
  }
}

/**
 * Paints one repeat of a material recipe into an sRGB RGBA buffer of
 * size x size pixels. Deterministic: the seed is FNV-1a of `hint.id`.
 */
export function paintMaterial(hint: MaterialHint, size: number): Uint8Array {
  const rng = createRng(fnv1a32(hint.id));
  const paint = painterFor(hint.pattern, rng, size);
  const data = new Uint8Array(size * size * 4);
  const br = channel(hint.base, 16);
  const bg = channel(hint.base, 8);
  const bb = channel(hint.base, 0);
  const ar = channel(hint.accent, 16);
  const ag = channel(hint.accent, 8);
  const ab = channel(hint.accent, 0);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const s = paint(u, v);
      const m = s.mix < 0 ? 0 : s.mix > 1 ? 1 : s.mix;
      const i = (y * size + x) * 4;
      data[i] = clampByte((br + (ar - br) * m) * s.shade);
      data[i + 1] = clampByte((bg + (ag - bg) * m) * s.shade);
      data[i + 2] = clampByte((bb + (ab - bb) * m) * s.shade);
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Additive 4-point star with a warm #FFD9A0 core and radial falloff. Alpha carries intensity. */
export function paintFlash(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const star =
        Math.max(0, 1 - Math.abs(dx) * 6) * Math.max(0, 1 - Math.abs(dy) * 1.1) +
        Math.max(0, 1 - Math.abs(dy) * 6) * Math.max(0, 1 - Math.abs(dx) * 1.1);
      const core = Math.max(0, 1 - r * 1.6);
      const a = Math.min(1, core * core + star * 0.8);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = clampByte(0xd9 + (255 - 0xd9) * core);
      data[i + 2] = clampByte(0xa0 + (255 - 0xa0) * core);
      data[i + 3] = clampByte(a * 255);
    }
  }
  return data;
}

/** Bullet hole: dark disc with a soft edge. */
export function paintDecal(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = r < 0.45 ? 1 : r < 1 ? (1 - (r - 0.45) / 0.55) ** 2 : 0;
      const i = (y * size + x) * 4;
      const shade = r < 0.3 ? 12 : 28;
      data[i] = shade;
      data[i + 1] = shade;
      data[i + 2] = shade;
      data[i + 3] = clampByte(a * 255);
    }
  }
  return data;
}

/** Round soft dot for particles. */
export function paintDot(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = r < 1 ? 1 - r : 0;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = clampByte(a * a * 255);
    }
  }
  return data;
}

/** Wraps an RGBA buffer as an sRGB DataTexture. `repeat` turns on RepeatWrapping and mipmaps. */
export function makeTexture(
  data: Uint8Array,
  size: number,
  opts: { repeat: boolean; anisotropy: number },
): DataTexture {
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  if (opts.repeat) {
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
  }
  tex.anisotropy = opts.anisotropy;
  tex.needsUpdate = true;
  return tex;
}
