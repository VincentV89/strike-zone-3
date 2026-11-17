/**
 * combat public surface (src/combat). Other components import this file only;
 * damage, hitboxes, resolve and execute are private (SD-PC-04). combat reads
 * weapons only as types (component table: combat -> weapons T).
 */
export { ARMOR_MODEL, applyDamage, createVitals } from './damage';
export { createHitboxes, hitboxesFor } from './hitboxes';
export { MAX_SHOT_TARGETS, createShotOutcome, resolveShot } from './resolve';
export { executeShot } from './execute';
export type {
  ArmorModel,
  DamageResult,
  Hitboxes,
  ShotHit,
  ShotOutcome,
  ShotTarget,
  Vitals,
} from './types';
