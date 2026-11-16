/**
 * Seeded fuzz of every collision-world tick-path query (SD-CN-08..10): no
 * throw, no NaN in outputs, every moved position fits when the start fits,
 * only listed diagnostics codes, each reported once.
 */
import { describe, expect, it } from 'vitest';
import { createDiagnostics, createRng, type Rng, type Vec3 } from '../../src/core';
import { getMap } from '../../src/maps';
import { buildCollisionWorld, PHYSICS_DIAGNOSTIC_CODES } from '../../src/physics';
import { STANDING, fixtureMap } from './fixtures';

const CASES = 2000;
const SPECIAL = [Number.NaN, Infinity, -Infinity, 0, -0, 1e-300, 1e300];

function num(rng: Rng, lo: number, hi: number): number {
  return rng.next() < 0.05 ? (SPECIAL[rng.int(0, SPECIAL.length)] ?? 0) : rng.range(lo, hi);
}
function point(rng: Rng, half: number): Vec3 {
  return { x: num(rng, -half, half), y: num(rng, -1, 8), z: num(rng, -half, half) };
}
const finite = (v: Vec3): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

describe.each([
  ['fixture', fixtureMap(), 11],
  ['desert-compound', getMap('desert-compound'), 50],
  ['industrial-warehouse', getMap('industrial-warehouse'), 46],
] as const)('fuzz on %s', (_name, def, half) => {
  it('never throws, never returns NaN and keeps fitting starts fitting', () => {
    const codes: string[] = [];
    const world = buildCollisionWorld(
      def,
      4,
      createDiagnostics((c) => codes.push(c)),
    );
    const rng = createRng(42);
    for (let i = 0; i < CASES; i++) {
      const p = point(rng, half);
      const v = { x: num(rng, -60, 60), y: num(rng, -60, 60), z: num(rng, -60, 60) };
      const cap = rng.next() < 0.03 ? { radius: num(rng, -1, 1), height: 1.8 } : STANDING;
      const dt = rng.next() < 0.03 ? num(rng, -1, 1) : rng.range(1e-4, 0.1);
      const step = rng.range(0, 0.5);
      const fitsBefore = finite(p) && world.capsuleFits(p, STANDING);
      const m = world.moveCapsule(p, v, cap, dt, step);
      expect(finite(m.position) && finite(m.velocity)).toBe(true);
      if (fitsBefore && cap === STANDING && Number.isFinite(dt) && dt > 0) {
        expect(world.capsuleFits(m.position, STANDING)).toBe(true);
      }
      const q = point(rng, half);
      const hit = world.raycast(p, { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z }, num(rng, 0, 200));
      if (hit !== null) {
        expect(Number.isFinite(hit.distance) && finite(hit.point) && finite(hit.normal)).toBe(true);
      }
      expect(typeof world.lineOfSight(p, q)).toBe('boolean');
      expect(typeof world.sweepClear(p, q, cap, step)).toBe('boolean');
      const a = { ...p };
      const b = { x: p.x + rng.range(-1, 1), y: p.y, z: p.z + rng.range(-1, 1) };
      world.separate(a, STANDING, b, STANDING);
      if (finite(p)) expect(finite(a) && finite(b)).toBe(true);
    }
    const listed: readonly string[] = PHYSICS_DIAGNOSTIC_CODES;
    expect(codes.every((c) => listed.includes(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('physics/non-finite-input');
  });
});
