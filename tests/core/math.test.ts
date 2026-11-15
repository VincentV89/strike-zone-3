import { describe, expect, it } from 'vitest';
import {
  aabb,
  aabbContainsPoint,
  aabbExpand,
  aabbFromCenter,
  aabbOverlaps,
  aabbUnion,
  add,
  addScaled,
  angleDelta,
  approxEq,
  clamp,
  copy,
  cross,
  dirFromYawPitch,
  distance,
  distanceSq,
  dot,
  equalsApprox,
  length,
  lengthSq,
  lerp,
  lerpVec3,
  normalize,
  rayAabb,
  scale,
  set,
  StrikeZoneError,
  sub,
  vec3,
  wrapAngle,
} from '../../src/core';

describe('Vec3', () => {
  it('does basic arithmetic and writes into out when given (BR-F-22)', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    const out = vec3();
    expect(add(a, b, out)).toBe(out);
    expect(out).toEqual({ x: 5, y: 7, z: 9 });
    expect(sub(b, a)).toEqual({ x: 3, y: 3, z: 3 });
    expect(scale(a, 2)).toEqual({ x: 2, y: 4, z: 6 });
    expect(addScaled(a, b, 0.5)).toEqual({ x: 3, y: 4.5, z: 6 });
    expect(dot(a, b)).toBe(32);
    expect(cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual({ x: 0, y: 0, z: 1 });
    expect(lengthSq(a)).toBe(14);
    expect(length(vec3(3, 4, 0))).toBe(5);
    expect(distanceSq(a, b)).toBe(27);
    expect(distance(vec3(), vec3(0, 0, 2))).toBe(2);
    expect(copy(a)).toEqual(a);
    expect(copy(a)).not.toBe(a);
    expect(set(vec3(), 7, 8, 9)).toEqual({ x: 7, y: 8, z: 9 });
    expect(lerpVec3(vec3(), vec3(10, 0, -10), 0.25)).toEqual({ x: 2.5, y: 0, z: -2.5 });
  });

  it('normalizes and returns zero for a near-zero vector, never NaN (BR-F-21)', () => {
    expect(equalsApprox(normalize(vec3(0, 3, 4)), vec3(0, 0.6, 0.8))).toBe(true);
    expect(normalize(vec3(1e-13, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
    expect(normalize(vec3())).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('follows the yaw/pitch convention (FD-F-10, BR-F-19)', () => {
    expect(equalsApprox(dirFromYawPitch(0, 0), vec3(0, 0, -1))).toBe(true);
    // Positive yaw turns left: from facing -Z, left is -X.
    expect(equalsApprox(dirFromYawPitch(Math.PI / 2, 0), vec3(-1, 0, 0))).toBe(true);
    expect(equalsApprox(dirFromYawPitch(0, Math.PI / 2), vec3(0, 1, 0))).toBe(true);
    expect(length(dirFromYawPitch(1.234, -0.4))).toBeCloseTo(1, 12);
  });
});

describe('scalars', () => {
  it('clamps, lerps and compares approximately', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
    expect(lerp(0, 10, 0.3)).toBeCloseTo(3, 12);
    expect(approxEq(1, 1 + 1e-7)).toBe(true);
    expect(approxEq(1, 1.1)).toBe(false);
  });

  it('wraps angles into (-PI, PI] and takes the shortest delta', () => {
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(0.5)).toBe(0.5);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12);
    expect(angleDelta(0.2, -0.3)).toBeCloseTo(-0.5, 12);
  });
});

describe('AABB', () => {
  const unit = aabb(vec3(0, 0, 0), vec3(1, 1, 1));

  it('rejects an inverted box with core/aabb-inverted', () => {
    expect(() => aabb(vec3(1, 0, 0), vec3(0, 1, 1))).toThrow(StrikeZoneError);
    expect(() => aabb(vec3(0, 2, 0), vec3(1, 1, 1))).toThrow(
      expect.objectContaining({ code: 'core/aabb-inverted' }),
    );
  });

  it('treats touching faces as not overlapping and containment as inclusive (BR-F-20)', () => {
    const touching = aabb(vec3(1, 0, 0), vec3(2, 1, 1));
    const overlapping = aabb(vec3(0.5, 0.5, 0.5), vec3(2, 2, 2));
    expect(aabbOverlaps(unit, touching)).toBe(false);
    expect(aabbOverlaps(unit, overlapping)).toBe(true);
    expect(aabbContainsPoint(unit, vec3(1, 1, 1))).toBe(true);
    expect(aabbContainsPoint(unit, vec3(1.01, 0.5, 0.5))).toBe(false);
  });

  it('builds from centre, expands and unions', () => {
    const c = aabbFromCenter(vec3(0, 1, 0), vec3(0.5, 1, 0.5));
    expect(c).toEqual({ min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 2, z: 0.5 } });
    expect(aabbExpand(unit, 1)).toEqual({
      min: { x: -1, y: -1, z: -1 },
      max: { x: 2, y: 2, z: 2 },
    });
    expect(aabbUnion(unit, c)).toEqual({
      min: { x: -0.5, y: 0, z: -0.5 },
      max: { x: 1, y: 2, z: 1 },
    });
  });

  it('casts rays with the slab method', () => {
    const box = aabb(vec3(-1, -1, -6), vec3(1, 1, -4));
    expect(rayAabb(vec3(), vec3(0, 0, -1), 100, box)).toBeCloseTo(4, 12);
    expect(rayAabb(vec3(), vec3(0, 0, -1), 3, box)).toBeNull();
    expect(rayAabb(vec3(), vec3(0, 0, 1), 100, box)).toBeNull();
    expect(rayAabb(vec3(0, 0, -5), vec3(0, 0, -1), 100, box)).toBe(0);
    // Zero direction component with the origin outside that slab.
    expect(rayAabb(vec3(5, 0, 0), vec3(0, 0, -1), 100, box)).toBeNull();
    expect(rayAabb(vec3(0, 0, 0), vec3(0.1, 0, -1), 100, box)).not.toBeNull();
  });
});
