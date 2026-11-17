import { describe, expect, it } from 'vitest';
import { MAP_RULES } from '../../../src/maps';
import { PLAYER_TUNING } from '../../../src/sim/player';
import { allObjects } from '../helpers';

describe('PLAYER_TUNING (BR-PC-16, BR-M-90)', () => {
  it('matches the agent dimensions the maps are built for', () => {
    expect(PLAYER_TUNING.radius).toBe(MAP_RULES.agentRadius);
    expect(PLAYER_TUNING.standHeight).toBe(MAP_RULES.agentHeight);
    expect(PLAYER_TUNING.crouchHeight).toBe(MAP_RULES.crouchHeight);
    expect(PLAYER_TUNING.standEye).toBe(MAP_RULES.standEye);
    expect(PLAYER_TUNING.stepHeight).toBe(MAP_RULES.stepHeight);
  });

  it('keeps the jump apex under MAP_RULES.jumpApexMax and the eye under the capsule top', () => {
    const apex = PLAYER_TUNING.jumpSpeed ** 2 / (2 * PLAYER_TUNING.gravity);
    expect(apex).toBeCloseTo(1.0, 12);
    expect(apex).toBeLessThan(MAP_RULES.jumpApexMax);
    expect(PLAYER_TUNING.standHeight - PLAYER_TUNING.standEye).toBeGreaterThanOrEqual(0.1 - 1e-12);
    expect(PLAYER_TUNING.crouchHeight - PLAYER_TUNING.crouchEye).toBeGreaterThanOrEqual(
      0.1 - 1e-12,
    );
  });

  it('is frozen (SD-PC-08)', () => {
    for (const o of allObjects(PLAYER_TUNING)) expect(Object.isFrozen(o)).toBe(true);
    expect(() => {
      (PLAYER_TUNING as { walkSpeed: number }).walkSpeed = 99;
    }).toThrow(TypeError);
  });
});
