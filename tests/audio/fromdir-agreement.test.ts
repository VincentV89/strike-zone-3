/**
 * hud and audio must read damage.fromDir the same way (target-to-attacker,
 * SD-AU-03). If combat flips the meaning, both readings fail together here.
 */
import { describe, expect, it } from 'vitest';
import { panFromDirection } from '../../src/audio/spatial';
import { relativeBearing } from '../../src/ui/hud/model/bearing';
import { createRng } from '../../src/core';

describe('fromDir agreement between hud and audio', () => {
  it('gives the hud bearing and the hurt pan the same left/right sign', () => {
    const rng = createRng(3).fork('fromdir');
    for (let i = 0; i < 500; i++) {
      const yaw = rng.range(-Math.PI, Math.PI);
      const x = rng.range(-1, 1);
      const z = rng.range(-1, 1);
      const pan = panFromDirection(x, z, yaw);
      const bearing = relativeBearing(x, z, yaw);
      if (Math.abs(pan) < 1e-6) continue;
      expect(Math.sign(pan)).toBe(Math.sign(Math.sin(bearing)));
    }
  });

  it('agrees on the fixture: attacker to the left of a player facing -Z', () => {
    expect(panFromDirection(-1, 0, 0)).toBeLessThan(0);
    expect(relativeBearing(-1, 0, 0)).toBeLessThan(0);
  });
});
