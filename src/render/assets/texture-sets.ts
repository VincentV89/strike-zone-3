/**
 * TEXTURE_SETS (BR-G-70): TextureSetKey -> bc, n and orm asset keys. map-data owns the
 * ids (MaterialHint.pbr); the renderer owns what they resolve to. Lazy kit chunk.
 */
import { TEXTURE_SET_DATA } from './texture-sets.data';
import type { TextureSetTable } from './types';

export const TEXTURE_SETS: TextureSetTable = Object.freeze(TEXTURE_SET_DATA);
