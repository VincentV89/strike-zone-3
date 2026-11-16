import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core';
import { panFromDirection, spatialise } from '../../src/audio/spatial';
import type { SpatialResult } from '../../src/audio/types';

const BOT_FIRE = { refDist: 3, maxDist: 90 };
const out = (): SpatialResult => ({ pan: 0, gain: 0, lowpassHz: 0 });

function at(
  yaw: number,
  dx: number,
  dy: number,
  dz: number,
  prof = BOT_FIRE,
): SpatialResult | null {
  const r = out();
  return spatialise(0, 0, 0, yaw, dx, dy, dz, prof, r) ? r : null;
}

describe('spatialise worked checks (req-spatial-audio)', () => {
  it('pans a source on the left to -1 and on the right to +1 at yaw 0', () => {
    expect(at(0, -5, 0, 0)?.pan).toBeCloseTo(-1, 10);
    expect(at(0, 5, 0, 0)?.pan).toBeCloseTo(1, 10);
  });

  it('leaves a source ahead unfiltered and muffles one behind to 4 kHz', () => {
    const ahead = at(0, 0, 0, -5);
    expect(ahead?.pan).toBeCloseTo(0, 10);
    expect(ahead?.lowpassHz).toBe(22000);
    const behind = at(0, 0, 0, 5);
    expect(behind?.pan).toBeCloseTo(0, 10);
    expect(behind?.lowpassHz).toBeCloseTo(4000, 6);
  });

  it('puts +Z on the left when facing -X (yaw π/2)', () => {
    expect(at(Math.PI / 2, 0, 0, 5)?.pan).toBeCloseTo(-1, 10);
  });

  it('culls beyond maxDist and attenuates by inverse distance', () => {
    expect(at(0, 100, 0, 0)).toBeNull();
    expect(at(0, 3, 0, 0)?.gain).toBe(1);
    expect(at(0, 33, 0, 0)?.gain).toBeCloseTo(3 / 33, 10);
    expect(at(0, -10, 0, 0)?.gain).toBeCloseTo(0.3, 10);
  });

  it('gives pan 0 for a source straight above and ignores elevation for pan', () => {
    expect(at(0, 0, 5, 0)?.pan).toBe(0);
    expect(at(0, -5, 20, 0)?.pan).toBeCloseTo(-1, 10);
  });

  it('rejects non-finite listener or source values', () => {
    expect(at(Number.NaN, 1, 0, 0)).toBeNull();
    expect(at(0, Number.NaN, 0, 0)).toBeNull();
    expect(at(0, Number.POSITIVE_INFINITY, 0, 0)).toBeNull();
  });

  it('pans with the sign of the left/right offset for any yaw (property, seeded)', () => {
    const rng = createRng(11).fork('spatial');
    for (let i = 0; i < 500; i++) {
      const yaw = rng.range(-Math.PI, Math.PI);
      const side = rng.next() < 0.5 ? -1 : 1;
      const ahead = rng.range(-10, 10);
      const across = side * rng.range(0.5, 10);
      // right = (cos y, -sin y), forward = (-sin y, -cos y) in XZ.
      const x = across * Math.cos(yaw) + ahead * -Math.sin(yaw);
      const z = across * -Math.sin(yaw) + ahead * -Math.cos(yaw);
      const r = at(yaw, x, 0, z);
      expect(Math.sign(r?.pan ?? 0)).toBe(side);
    }
  });
});

describe('panFromDirection (BR-AU-44)', () => {
  it('pans a direction to the left negative and handles zero vectors', () => {
    expect(panFromDirection(-1, 0, 0)).toBeCloseTo(-1, 10);
    expect(panFromDirection(3, 0, 0)).toBeCloseTo(1, 10);
    expect(panFromDirection(0, 0, 0)).toBe(0);
    expect(panFromDirection(Number.NaN, 0, 0)).toBe(0);
    expect(panFromDirection(0, 1, Math.PI / 2)).toBeCloseTo(-1, 10);
  });
});
