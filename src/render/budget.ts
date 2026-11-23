/**
 * GPU budget helpers (BR-G-72/73, performance-design §3.3, §4). Entry chunk.
 */
import type { PresetSpec } from './presets';

/** Objects only shadow cameras render (the bot shadow proxy, performance-design §3.3). */
export const SHADOW_ONLY_LAYER = 1;
/** Shadow cameras see layers 0 and 1; the main camera stays on layer 0. */
export const SHADOW_CAMERA_MASK = 0b11;

export function textureBudgetBytes(p: PresetSpec): number {
  return p.textureBudgetMB * 1024 * 1024;
}

/** RGBA8 bytes of a square DataTexture with a full mip chain. */
export function dataTextureBytes(size: number): number {
  return Math.round((size * size * 4 * 4) / 3);
}

/** Highest tier that fits, halving from the preset limit down to 256 px (BR-G-72 reduction). */
export function fitTier(maxPx: number, bytesAt: (px: number) => number, budget: number): number {
  let px = maxPx;
  while (px > 256 && bytesAt(px) > budget) px /= 2;
  return px;
}
