/**
 * Asset manifest (domain-entities-graphics-uplift "AssetEntry"). Lazy kit chunk: the
 * entries hold hashed `?url` strings from manifest.data.ts, which the pipeline generates.
 */
import type { MapId } from '../../contracts';
import { MANIFEST_ENTRIES } from './manifest.data';
import type { AssetEntry } from './types';

export const MANIFEST: readonly AssetEntry[] = Object.freeze(MANIFEST_ENTRIES.map((e) => Object.freeze(e)));

/** Load order (performance-design §2): sky, bot, weapons, packs, textures. */
const ORDER = (e: AssetEntry): number =>
  e.kind === 'sky' ? 0 : e.key.startsWith('bot-') ? 1 : e.key.startsWith('vm-') ? 2 : e.kind === 'model' ? 3 : 4;

/** Every entry of the map, whatever the preset (BR-G-08), in load order. */
export function entriesFor(manifest: readonly AssetEntry[], map: MapId): AssetEntry[] {
  return manifest
    .filter((e) => e.maps === 'all' || e.maps.includes(map))
    .sort((a, b) => ORDER(a) - ORDER(b) || a.key.localeCompare(b.key));
}
