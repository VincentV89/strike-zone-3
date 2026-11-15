import { describe, expect, it } from 'vitest';
import { relativeBearing } from '../../../src/ui/hud/model/bearing';
import {
  clockCacheMisses,
  clockSeconds,
  clockText,
  degText,
  formatClock,
  intText,
  normaliseDeg,
  opacityText,
  quantiseOpacity,
} from '../../../src/ui/hud/model/format';
import { entityLabel, weaponLabel, weaponTag } from '../../../src/ui/hud/model/labels';
import {
  BODY_MARKER_TICKS,
  DAMAGE_ARC_TICKS,
  HEAD_MARKER_TICKS,
  KILL_ROW_FADE_TICKS,
  KILL_ROW_TICKS,
  RADAR_HEARD_MAX_TICKS,
  ticks,
  VIGNETTE_COOLDOWN_TICKS,
  VIGNETTE_FADE_TICKS,
} from '../../../src/ui/hud/model/timing';

describe('formatClock (m:ss, ceiling)', () => {
  it('starts a 3-minute round at 3:00 and shows 0:00 only at expiry', () => {
    expect(formatClock(180)).toBe('3:00');
    expect(formatClock(179.99)).toBe('3:00');
    expect(formatClock(59.5)).toBe('1:00');
    expect(formatClock(9.01)).toBe('0:10');
    expect(formatClock(0.001)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
  });

  it('absorbs float error from 1/60 s decrements and treats bad input as 0', () => {
    let t = 2;
    for (let i = 0; i < 60; i++) t -= 1 / 60;
    expect(formatClock(t)).toBe('0:01');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(-5)).toBe('0:00');
    expect(clockSeconds(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('builds each clock string once and returns the same object (PR-H-12)', () => {
    const before = clockCacheMisses();
    let t = 100;
    for (let i = 0; i < 600; i++) {
      formatClock(t);
      t -= 1 / 60;
    }
    const misses = clockCacheMisses() - before;
    expect(misses === 10 || misses === 11).toBe(true);
    expect(clockText(42)).toBe(clockText(42));
    expect(clockText(4000)).toBe('66:40');
  });
});

describe('string tables', () => {
  it('formats integers in range from the table and out of range with String', () => {
    expect(intText(0)).toBe('0');
    expect(intText(-1024)).toBe('-1024');
    expect(intText(4096)).toBe('4096');
    expect(intText(5000)).toBe('5000');
    expect(intText(30)).toBe(intText(30));
  });

  it('quantises opacity to 0.01 and degrees to 0..359', () => {
    expect(quantiseOpacity(0.444)).toBe(44);
    expect(quantiseOpacity(-1)).toBe(0);
    expect(quantiseOpacity(Number.NaN)).toBe(0);
    expect(quantiseOpacity(2)).toBe(100);
    expect(opacityText(44)).toBe('0.44');
    expect(opacityText(100)).toBe('1');
    expect(normaliseDeg(-90)).toBe(270);
    expect(normaliseDeg(359.6)).toBe(0);
    expect(degText(270)).toBe('270deg');
  });
});

describe('tick durations (BR-H-17)', () => {
  it('converts the design timings at 60 Hz', () => {
    expect(ticks(150)).toBe(9);
    expect([BODY_MARKER_TICKS, HEAD_MARKER_TICKS, DAMAGE_ARC_TICKS]).toEqual([9, 15, 60]);
    expect([VIGNETTE_FADE_TICKS, VIGNETTE_COOLDOWN_TICKS]).toEqual([36, 20]);
    expect([KILL_ROW_TICKS, KILL_ROW_FADE_TICKS, RADAR_HEARD_MAX_TICKS]).toEqual([300, 18, 120]);
  });
});

describe('relativeBearing (story-damage-direction)', () => {
  it('gives -PI/2 for a hit from -X at yaw 0 (left, AC1)', () => {
    expect(relativeBearing(-1, 0, 0)).toBeCloseTo(-Math.PI / 2);
    expect(relativeBearing(1, 0, 0)).toBeCloseTo(Math.PI / 2);
    expect(relativeBearing(0, -1, 0)).toBeCloseTo(0);
    expect(Math.abs(relativeBearing(0, 1, 0))).toBeCloseTo(Math.PI);
  });

  it('re-orients as the player turns: turning left by PI/2 puts a -X source ahead (AC2)', () => {
    expect(relativeBearing(-1, 0, Math.PI / 2)).toBeCloseTo(0);
    expect(relativeBearing(0, -1, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });
});

describe('labels', () => {
  it('uses fixed tables for entities and weapons', () => {
    expect(entityLabel(0)).toBe('YOU');
    expect(entityLabel(1)).toBe('BOT 01');
    expect(entityLabel(20)).toBe('BOT 20');
    expect(entityLabel(21)).toBe('BOT ??');
    expect(entityLabel(1.5)).toBe('BOT ??');
    expect(weaponLabel('sniper')).toBe('SNIPER');
    expect(weaponTag('pistol')).toBe('[PISTOL]');
    expect(weaponLabel('laser' as never)).toBe('');
    expect(weaponTag('laser' as never)).toBe('[?]');
  });
});
