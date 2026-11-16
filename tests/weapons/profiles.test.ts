import { describe, expect, it } from 'vitest';
import { StrikeZoneError } from '../../src/core';
import { WEAPON_PROFILES, createLoadout, headDamage, type WeaponProfile } from '../../src/weapons';
import { allObjects } from '../sim/helpers';

const [rifle, pistol, sniper] = WEAPON_PROFILES;

describe('WEAPON_PROFILES (BR-PC-36, req-weapon-set)', () => {
  it('holds rifle, pistol and sniper in slot order with the settled numbers', () => {
    expect(WEAPON_PROFILES.map((p) => p.id)).toEqual(['rifle', 'pistol', 'sniper']);
    expect([rifle.damage, pistol.damage, sniper.damage]).toEqual([25, 18, 90]);
    expect([headDamage(rifle), headDamage(pistol), headDamage(sniper)]).toEqual([63, 45, 180]);
    expect([rifle.cooldownTicks, pistol.cooldownTicks, sniper.cooldownTicks]).toEqual([6, 9, 75]);
    expect([rifle.reloadTicks, pistol.reloadTicks, sniper.reloadTicks]).toEqual([132, 84, 180]);
    expect([rifle.switchTicks, pistol.switchTicks, sniper.switchTicks]).toEqual([30, 21, 48]);
    expect([rifle.magSize, rifle.reserve, pistol.magSize, pistol.reserve]).toEqual([
      30, 180, 15, 90,
    ]);
    expect([sniper.magSize, sniper.reserve]).toEqual([5, 25]);
    expect(sniper.scope).toEqual({ zoom: 4, spreadMult: 0.02 });
    expect(sniper.spread.base * (sniper.scope?.spreadMult ?? 1)).toBeCloseTo(0.0012, 12);
  });

  it('meets the ordering rules', () => {
    expect(rifle.mode).toBe('auto');
    expect(pistol.mode).toBe('semi');
    expect(sniper.mode).toBe('semi');
    expect(sniper.magSize).toBeLessThanOrEqual(10);
    expect(sniper.damage).toBeGreaterThan(rifle.damage);
    expect(rifle.damage).toBeGreaterThan(pistol.damage);
    expect(pistol.reloadSec).toBeLessThan(Math.min(rifle.reloadSec, sniper.reloadSec));
    expect(pistol.switchSec).toBeLessThan(Math.min(rifle.switchSec, sniper.switchSec));
    expect(rifle.scope).toBeNull();
    expect(pistol.scope).toBeNull();
    expect(sniper.recoil.pitchPerShot).toBeGreaterThan(rifle.recoil.pitchPerShot);
    expect(sniper.cooldownSec).toBeGreaterThan(rifle.cooldownSec);
  });

  it('caps the fire rate at 600, 400 and 48 rounds per minute (BR-PC-23)', () => {
    const rpm = (p: WeaponProfile): number => (60 * 60) / p.cooldownTicks;
    expect([rpm(rifle), rpm(pistol), rpm(sniper)]).toEqual([600, 400, 48]);
  });

  it('is deep-frozen (SD-PC-08)', () => {
    for (const o of allObjects(WEAPON_PROFILES)) expect(Object.isFrozen(o)).toBe(true);
    expect(() => {
      (rifle as { damage: number }).damage = 1000;
    }).toThrow(TypeError);
    expect(() => {
      (rifle.spread as { base: number }).base = 0;
    }).toThrow(TypeError);
  });
});

describe('createLoadout (BR-PC-20, LC-PC-R6)', () => {
  it('starts full with the rifle active', () => {
    const l = createLoadout(WEAPON_PROFILES);
    expect(l.slots.map((s) => [s.mag, s.reserve])).toEqual([
      [30, 180],
      [15, 90],
      [5, 25],
    ]);
    expect(l.active).toBe(0);
    expect(l.scoped).toBe(false);
    expect(l.infiniteReserve).toBe(false);
    expect(l.slots.every((s) => s.reloadEndTick === -1 && s.lastFireTick === -1)).toBe(true);
    expect(createLoadout(WEAPON_PROFILES, { infiniteReserve: true }).infiniteReserve).toBe(true);
  });

  it('returns fresh objects each call (RL-PC-04)', () => {
    const a = createLoadout(WEAPON_PROFILES);
    const b = createLoadout(WEAPON_PROFILES);
    expect(a).not.toBe(b);
    expect(a.slots[0]).not.toBe(b.slots[0]);
    expect(a.slots[0].profile).toBe(b.slots[0].profile);
  });

  const code = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      return e instanceof StrikeZoneError ? e.code : 'other';
    }
    return 'none';
  };
  const tweak = (i: number, over: Record<string, unknown>): WeaponProfile[] =>
    WEAPON_PROFILES.map((p, j) => (j === i ? { ...p, ...over } : p));

  it('throws weapons/bad-loadout for a wrong slot list', () => {
    expect(code(() => createLoadout([rifle, pistol]))).toBe('weapons/bad-loadout');
    expect(code(() => createLoadout([pistol, rifle, sniper]))).toBe('weapons/bad-loadout');
    expect(code(() => createLoadout([rifle, pistol, sniper, rifle]))).toBe('weapons/bad-loadout');
  });

  it.each([
    ['non-integer mag', 0, { magSize: 30.5 }],
    ['zero cooldown', 0, { cooldownTicks: 0 }],
    ['negative reserve', 1, { reserve: -1 }],
    ['NaN damage', 2, { damage: Number.NaN }],
    ['rifle not auto', 0, { mode: 'semi' }],
    ['pistol mag', 1, { magSize: 12 }],
    ['sniper mag', 2, { magSize: 11 }],
    ['damage order', 1, { damage: 30 }],
    ['pistol reload not fastest', 1, { reloadSec: 5 }],
    ['pistol switch not fastest', 1, { switchSec: 5 }],
    ['scope on rifle', 0, { scope: { zoom: 2, spreadMult: 0.5 } }],
    ['sniper without scope', 2, { scope: null }],
    ['bad scope numbers', 2, { scope: { zoom: 0, spreadMult: 0.5 } }],
    ['scoped spread not lower', 2, { scope: { zoom: 4, spreadMult: 1 } }],
    ['sniper recoil', 2, { recoil: { ...sniper.recoil, pitchPerShot: 0.001 } }],
    ['sniper cooldown', 2, { cooldownSec: 0.05 }],
    ['max below base', 0, { spread: { ...rifle.spread, max: 0.001 } }],
  ])('throws weapons/bad-profile for %s', (_name, i, over) => {
    expect(code(() => createLoadout(tweak(i, over)))).toBe('weapons/bad-profile');
  });
});
