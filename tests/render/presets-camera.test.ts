import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../../src/core';
import {
  capWorldSize,
  clampFov,
  easeOutCubic,
  hFovToVFov,
  isTeleport,
  lerpAngle,
  projectedPx,
  renderTime,
  scopedVFov,
  smoothstep,
} from '../../src/render/camera-math';
import { SCOPE_ZOOM, WORLD_NEAR_M } from '../../src/render/constants';
import { DEFAULT_PRESET, isPresetId, pixelRatioFor, PRESETS } from '../../src/render/presets';
import * as surface from '../../src/render/index';

describe('presets (story-graphics-presets, BR-P-22)', () => {
  it('holds the documented table and is frozen', () => {
    expect(Object.isFrozen(PRESETS)).toBe(true);
    expect(Object.isFrozen(PRESETS.low)).toBe(true);
    expect(PRESETS.low).toMatchObject({
      sunShadowPx: 1024,
      localShadowLights: 0,
      botsCastShadows: false,
      maxShadowCasters: 16,
      farM: 150,
      particleCap: 64,
      particlesPerBurst: 6,
      decalCap: 32,
      tracerCap: 16,
      flashLight: false,
    });
    expect(PRESETS.medium).toMatchObject({
      sunShadowPx: 2048,
      localShadowLights: 1,
      botsCastShadows: true,
      maxShadowCasters: 24,
      farM: 200,
      particleCap: 192,
      decalCap: 64,
      tracerCap: 32,
    });
    expect(PRESETS.high).toMatchObject({
      sunShadowPx: 4096,
      localShadowLights: 2,
      farM: 300,
      particleCap: 384,
      particlesPerBurst: 12,
      decalCap: 128,
      tracerCap: 48,
      flashLight: true,
    });
    expect(DEFAULT_PRESET).toBe('medium');
  });

  it('every preset keeps the sun shadow (BR-P-21) and shadow lights stay within 1 + budget (BR-P-32)', () => {
    for (const p of Object.values(PRESETS)) {
      expect(p.sunShadowPx).toBeGreaterThanOrEqual(1024);
    }
    expect(1 + PRESETS.low.localShadowLights).toBe(1);
    expect(1 + PRESETS.medium.localShadowLights).toBe(2);
    expect(1 + PRESETS.high.localShadowLights).toBe(3);
  });

  it('caps the pixel ratio per preset', () => {
    expect(pixelRatioFor(PRESETS.low, 2)).toBeCloseTo(0.75);
    expect(pixelRatioFor(PRESETS.medium, 2)).toBeCloseTo(1.5);
    expect(pixelRatioFor(PRESETS.high, 3)).toBeCloseTo(2);
    expect(pixelRatioFor(PRESETS.high, 1.25)).toBeCloseTo(1.25);
    expect(pixelRatioFor(PRESETS.medium, Number.NaN)).toBe(1);
    expect(isPresetId('ultra')).toBe(false);
  });
});

describe('camera math', () => {
  it('converts 90° horizontal at 16:9 to 58.72° vertical (BR-P-40)', () => {
    expect(hFovToVFov(90)).toBeCloseTo(58.72, 2);
    expect(hFovToVFov(70)).toBeLessThan(hFovToVFov(110));
  });

  it('clamps the FOV setting to 70..110', () => {
    expect(clampFov(60)).toBe(70);
    expect(clampFov(130)).toBe(110);
    expect(clampFov(95)).toBe(95);
    expect(clampFov(Number.NaN)).toBe(90);
  });

  it('scope zoom divides tan(v/2) by 4 (BR-P-42, story-pistol-sniper)', () => {
    const v = hFovToVFov(90);
    const s = scopedVFov(v);
    const rad = (d: number): number => (d * Math.PI) / 180;
    expect(Math.tan(rad(s) / 2)).toBeCloseTo(Math.tan(rad(v) / 2) / SCOPE_ZOOM, 9);
  });

  it('interpolates yaw along the shortest arc across ±π', () => {
    const a = Math.PI - 0.1;
    const b = -Math.PI + 0.1;
    const mid = lerpAngle(a, b, 0.5);
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9);
    expect(lerpAngle(0, 1, 0.25)).toBeCloseTo(0.25);
  });

  it('guards teleports beyond 2 m (BR-P-44)', () => {
    expect(isTeleport(0, 0, 0, 1.9, 0, 0)).toBe(false);
    expect(isTeleport(0, 0, 0, 2.1, 0, 0)).toBe(true);
  });

  it('computes render time from ticks and alpha (§2.7)', () => {
    expect(renderTime(10, 11, 0.5)).toBeCloseTo(10.5 * TICK_DT);
    expect(renderTime(10, 11, 1)).toBeCloseTo(11 * TICK_DT);
  });

  it('eases and caps sprite sizes', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(1, 1, 1)).toBe(1);
    expect(easeOutCubic(1)).toBe(1);
    const size = capWorldSize(160, 5, 58.72, 1080);
    expect(projectedPx(size, 5, 58.72, 1080)).toBeCloseTo(160);
    expect(capWorldSize(160, 5, 58, 0)).toBe(0);
  });

  it('keeps the near plane at or below 0.1 m (BR-CN-39, story-walk-with-collision)', () => {
    expect(WORLD_NEAR_M).toBeLessThanOrEqual(0.1);
  });
});

describe('public surface', () => {
  it('exports only the documented renderer API', () => {
    expect(Object.keys(surface).sort()).toEqual(
      [
        'DEFAULT_PRESET',
        'FOV_DEFAULT_DEG',
        'FOV_MAX_DEG',
        'FOV_MIN_DEG',
        'PRESETS',
        'SCOPE_ZOOM',
        'createGameRenderer',
        'hFovToVFov',
        'scopedVFov',
      ].sort(),
    );
  });
});
