import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/core';
import {
  ARMOR_MODEL,
  applyDamage,
  createHitboxes,
  createVitals,
  hitboxesFor,
} from '../../src/combat';
import { allObjects, recordingDiag } from '../sim/helpers';

describe('Vitals and the armor split (BR-PC-45, BR-PC-46, FD-PC-Q1)', () => {
  it('starts the player at 100/100 and bots at 100/0', () => {
    expect(createVitals('player')).toEqual({
      health: 100,
      armor: 100,
      alive: true,
      deathTick: null,
    });
    expect(createVitals('bot')).toEqual({ health: 100, armor: 0, alive: true, deathTick: null });
    expect(createVitals('bot')).not.toBe(createVitals('bot'));
  });

  it('absorbs floor(raw x 0.5) with armor and takes the rest from health', () => {
    const v = createVitals('player');
    expect({ ...applyDamage(v, 25, ARMOR_MODEL, 1) }).toEqual({
      healthLoss: 13,
      armorLoss: 12,
      died: false,
    });
    expect([v.health, v.armor]).toEqual([87, 88]);
    const noArmor = createVitals('bot');
    expect({ ...applyDamage(noArmor, 25, ARMOR_MODEL, 1) }).toEqual({
      healthLoss: 25,
      armorLoss: 0,
      died: false,
    });
  });

  it('caps absorption at the remaining armor and health at 0, with no overkill', () => {
    const v = createVitals('player');
    v.armor = 3;
    v.health = 10;
    const r = applyDamage(v, 90, ARMOR_MODEL, 7);
    expect({ ...r }).toEqual({ healthLoss: 10, armorLoss: 3, died: true });
    expect(v).toEqual({ health: 0, armor: 0, alive: false, deathTick: 7 });
  });

  it('dies once: later hits on a dead target do nothing', () => {
    const v = createVitals('bot');
    expect(applyDamage(v, 180, ARMOR_MODEL, 3).died).toBe(true);
    expect({ ...applyDamage(v, 180, ARMOR_MODEL, 4) }).toEqual({
      healthLoss: 0,
      armorLoss: 0,
      died: false,
    });
    expect(v.deathTick).toBe(3);
  });

  it('needs the documented hits to kill (business-logic-model table)', () => {
    const hitsToKill = (raw: number, kind: 'player' | 'bot'): number => {
      const v = createVitals(kind);
      let n = 0;
      while (v.alive) {
        applyDamage(v, raw, ARMOR_MODEL, n);
        n++;
      }
      return n;
    };
    expect([hitsToKill(25, 'bot'), hitsToKill(63, 'bot')]).toEqual([4, 2]);
    expect([hitsToKill(18, 'bot'), hitsToKill(45, 'bot')]).toEqual([6, 3]);
    expect([hitsToKill(90, 'bot'), hitsToKill(180, 'bot')]).toEqual([2, 1]);
    expect([hitsToKill(25, 'player'), hitsToKill(63, 'player')]).toEqual([8, 4]);
  });

  it('rejects bad raw damage with combat/bad-damage', () => {
    const diag = recordingDiag();
    const v = createVitals('player');
    for (const raw of [Number.NaN, -5, Infinity]) {
      expect(applyDamage(v, raw, ARMOR_MODEL, 0, diag).healthLoss).toBe(0);
    }
    expect([v.health, v.armor]).toEqual([100, 100]);
    expect(diag.codes).toEqual(['combat/bad-damage']);
  });

  it('freezes ARMOR_MODEL (SD-PC-08)', () => {
    for (const o of allObjects(ARMOR_MODEL)) expect(Object.isFrozen(o)).toBe(true);
    expect(ARMOR_MODEL.absorbRatio).toBe(0.5);
    expect(() => {
      (ARMOR_MODEL as { absorbRatio: number }).absorbRatio = 1;
    }).toThrow(TypeError);
  });
});

describe('hitboxesFor', () => {
  it('places head and body inside the standing and crouched capsules', () => {
    const hb = hitboxesFor(vec3(1, 2, 3), false, createHitboxes());
    expect(hb.body.min).toEqual(vec3(0.65, 2, 2.65));
    expect(hb.body.max.y).toBeCloseTo(3.45, 12);
    expect(hb.head.min.y).toBeCloseTo(2 + 1.45, 12);
    expect(hb.head.max.y).toBeCloseTo(2 + 1.79, 12);
    expect(hb.head.max.y - 2).toBeLessThan(1.8);
    const c = hitboxesFor(vec3(0, 0, 0), true, createHitboxes());
    expect(c.body.max.y).toBeCloseTo(0.85, 12);
    expect(c.head.max.y).toBeLessThan(1.2);
    for (const b of [hb.body, hb.head, c.body, c.head]) {
      expect(b.max.x - b.min.x).toBeLessThanOrEqual(0.8);
    }
  });
});
