/**
 * Vitals and the armor split (BR-PC-45, BR-PC-46, FD-PC-Q1). applyDamage
 * returns a reused result object; read it before the next call.
 */
import type { Diagnostics } from '../core';
import { freezeNested } from './freeze';
import type { ArmorModel, DamageResult, Vitals } from './types';

export const ARMOR_MODEL: ArmorModel = freezeNested({ absorbRatio: 0.5 });

export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;

/** Player: 100 health, 100 armor. Bots: 100 health, 0 armor on every difficulty (BR-PC-50). */
export function createVitals(kind: 'player' | 'bot'): Vitals {
  return {
    health: MAX_HEALTH,
    armor: kind === 'player' ? MAX_ARMOR : 0,
    alive: true,
    deathTick: null,
  };
}

const result: DamageResult = { healthLoss: 0, armorLoss: 0, died: false };

function zero(): DamageResult {
  result.healthLoss = 0;
  result.armorLoss = 0;
  result.died = false;
  return result;
}

/**
 * Applies one hit. `absorbed = min(armor, floor(raw * absorbRatio))` while
 * armor > 0; health loses the rest, never below 0. A dead target takes
 * nothing. Non-finite or negative raw damage reports `combat/bad-damage`.
 */
export function applyDamage(
  v: Vitals,
  raw: number,
  armor: ArmorModel,
  tick: number,
  diag?: Diagnostics,
): DamageResult {
  if (!(raw >= 0) || raw === Infinity) {
    diag?.warnOnce('combat/bad-damage');
    return zero();
  }
  if (!v.alive) return zero();
  const absorbed = v.armor > 0 ? Math.min(v.armor, Math.floor(raw * armor.absorbRatio)) : 0;
  const healthLoss = Math.min(v.health, raw - absorbed);
  v.armor -= absorbed;
  v.health -= healthLoss;
  result.armorLoss = absorbed;
  result.healthLoss = healthLoss;
  result.died = v.health <= 0;
  if (result.died) {
    v.health = 0;
    v.alive = false;
    v.deathTick = tick;
  }
  return result;
}
