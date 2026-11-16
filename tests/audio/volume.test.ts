import { describe, expect, it } from 'vitest';
import { acceptPercent, curve } from '../../src/audio/volume';

describe('volume curve (BR-AU-21)', () => {
  it('maps percents to (p/100)² with exact end points', () => {
    expect(curve(0)).toBe(0);
    expect(curve(100)).toBe(1);
    expect(curve(80)).toBeCloseTo(0.64, 10);
    expect(curve(50)).toBeCloseTo(0.25, 10);
    expect(curve(10)).toBeCloseTo(0.01, 10);
  });

  it('rounds and clamps out-of-range input', () => {
    expect(curve(-5)).toBe(0);
    expect(curve(250)).toBe(1);
    expect(curve(49.6)).toBeCloseTo(0.25, 10);
  });
});

describe('acceptPercent (BR-AU-20)', () => {
  it('rounds and clamps finite values', () => {
    expect(acceptPercent(42.4, 80)).toBe(42);
    expect(acceptPercent(-3, 80)).toBe(0);
    expect(acceptPercent(101, 80)).toBe(100);
  });

  it('keeps the previous value for non-finite input', () => {
    expect(acceptPercent(Number.NaN, 80)).toBe(80);
    expect(acceptPercent(Number.POSITIVE_INFINITY, 30)).toBe(30);
  });
});
