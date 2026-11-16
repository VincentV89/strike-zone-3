/**
 * Fixed label tables (SD-H-01). Every string the HUD writes as a label comes
 * from here, so labels never carry free-form text from the simulation and
 * equal labels are the same string object (PD-H-03, rule 3).
 */
import type { WeaponId } from '../../../contracts';

export const PLAYER_LABEL = 'YOU';
export const UNKNOWN_LABEL = 'BOT ??';

const BOT_LABELS: readonly string[] = Array.from(
  { length: 20 },
  (_, i) => `BOT ${i + 1 < 10 ? '0' : ''}${String(i + 1)}`,
);

/** Label for an entity id: 0 is the player, 1..20 are bots. */
export function entityLabel(id: number): string {
  if (id === 0) return PLAYER_LABEL;
  if (Number.isInteger(id) && id >= 1 && id <= BOT_LABELS.length) {
    return BOT_LABELS[id - 1] ?? UNKNOWN_LABEL;
  }
  return UNKNOWN_LABEL;
}

/** Fixed slot order: rifle 1, pistol 2, sniper 3. */
export const WEAPON_ORDER: readonly WeaponId[] = ['rifle', 'pistol', 'sniper'];

const WEAPON_LABELS: ReadonlyMap<string, string> = new Map([
  ['rifle', 'RIFLE'],
  ['pistol', 'PISTOL'],
  ['sniper', 'SNIPER'],
]);

const WEAPON_TAGS: ReadonlyMap<string, string> = new Map([
  ['rifle', '[RIFLE]'],
  ['pistol', '[PISTOL]'],
  ['sniper', '[SNIPER]'],
]);

/** Upper-case weapon name. Unknown ids give an empty label. */
export function weaponLabel(id: WeaponId): string {
  return WEAPON_LABELS.get(id) ?? '';
}

/** Bracketed weapon tag for kill-feed rows. */
export function weaponTag(id: WeaponId): string {
  return WEAPON_TAGS.get(id) ?? '[?]';
}

export type WeaponPrompt = 'none' | 'reload' | 'out-of-ammo';

export const PROMPT_LABELS: Readonly<Record<WeaponPrompt, string>> = {
  none: '',
  reload: 'R TO RELOAD',
  'out-of-ammo': 'OUT OF AMMO',
};

export const ALIVE_LABEL = '● ALIVE';
export const DEAD_LABEL = '✕ DEAD';
