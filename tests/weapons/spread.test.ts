import { describe, expect, it } from 'vitest';
import { createRng, vec3 } from '../../src/core';
import {
  WEAPON_PROFILES,
  createFireRequest,
  createLoadout,
  stepWeapon,
  type FireRequest,
} from '../../src/weapons';
import { aim, id, recordingDiag, strictDiag, trig } from '../sim/helpers';

/** Rifle shot directions for seed 42 at yaw 0.3, pitch 0.05, standing still (BR-PC-34). */
const GOLDEN_SEED_42 = [
  [-0.29717267414461906, 0.04686814449264865, -0.9536727839115219],
  [-0.30073964302856415, 0.053520948592814435, -0.9522033265919507],
  [-0.30655201005942345, 0.077996877870122, -0.9486529144903526],
  [-0.2850590472484565, 0.07551237762150549, -0.9555308579045207],
  [-0.29138745196002236, 0.0915448464194855, -0.9522147310004602],
  [-0.31556007895677846, 0.09425668063958695, -0.9442126427471721],
  [-0.3260860474044514, 0.12132296412471964, -0.9375226013617666],
  [-0.29573351223752037, 0.16507106678065814, -0.9409002245995883],
  [-0.31606542851902497, 0.16942488696083266, -0.933486932192087],
  [-0.27418761134593944, 0.16210535023625186, -0.9479150854423565],
];

function rifleShots(seed: number, stream: string, n: number): number[][] {
  const l = createLoadout(WEAPON_PROFILES);
  const rng = createRng(seed).fork(stream);
  const req = createFireRequest(id(0));
  const a = aim({ origin: vec3(0, 1.6, 0), yaw: 0.3, pitch: 0.05 });
  const out: number[][] = [];
  for (let t = 0; out.length < n; t++) {
    const r = stepWeapon(
      l,
      trig({ fire: true }),
      a,
      t,
      rng,
      () => undefined,
      id(0),
      strictDiag(),
      req,
    );
    if (r !== null) out.push([r.dir.x, r.dir.y, r.dir.z]);
  }
  return out;
}

describe('deterministic spread (SD-PC-16)', () => {
  it('matches the seed-42 golden directions to 12 digits', () => {
    const got = rifleShots(42, 'spread/0', 10);
    got.forEach((d, i) => {
      const g = GOLDEN_SEED_42[i] ?? [];
      d.forEach((c, k) => {
        expect(c).toBeCloseTo(g[k] ?? Number.NaN, 12);
      });
    });
  });

  it('replays exactly in the same process', () => {
    expect(rifleShots(42, 'spread/0', 20)).toEqual(rifleShots(42, 'spread/0', 20));
    expect(rifleShots(43, 'spread/0', 5)).not.toEqual(rifleShots(42, 'spread/0', 5));
  });

  it('keeps the player stream independent of how many bot streams exist', () => {
    const root5 = createRng(42);
    const root20 = createRng(42);
    const bots5 = Array.from({ length: 5 }, (_, i) => root5.fork(`spread/${i + 1}`));
    const bots20 = Array.from({ length: 20 }, (_, i) => root20.fork(`spread/${i + 1}`));
    for (const b of [...bots5, ...bots20]) b.next();
    const p5 = root5.fork('spread/0');
    const p20 = root20.fork('spread/0');
    const a = Array.from({ length: 30 }, () => p5.next());
    const b = Array.from({ length: 30 }, () => p20.next());
    expect(a).toEqual(b);
  });
});

describe('weapons fuzz (LC-PC-R2)', () => {
  it('never throws, never yields NaN and keeps every invariant over 2000 hostile ticks', () => {
    const bits = createRng(99).fork('fuzz');
    const nasty = [Number.NaN, Infinity, -Infinity, -0, 1e30, -1e30];
    const pick = (): number =>
      bits.next() < 0.2 ? (nasty[bits.int(0, nasty.length)] ?? 0) : bits.range(-10, 10);
    for (const infiniteReserve of [false, true]) {
      const l = createLoadout(WEAPON_PROFILES, { infiniteReserve });
      const rng = createRng(5);
      const diag = recordingDiag();
      const req: FireRequest = createFireRequest(id(3));
      for (let tick = 0; tick < 2000; tick++) {
        const t = trig({
          fire: bits.next() < 0.5,
          firePressed: bits.next() < 0.3,
          reload: bits.next() < 0.05,
          scope: bits.next() < 0.3,
          select: bits.next() < 0.03 ? (bits.int(0, 3) as 0 | 1 | 2) : null,
          cycle: bits.next() < 0.03 ? (bits.next() < 0.5 ? 1 : -1) : 0,
        });
        const a = aim({
          origin: { x: pick(), y: pick(), z: pick() },
          yaw: pick(),
          pitch: pick(),
          moving: bits.next() < 0.5,
          grounded: bits.next() < 0.8,
          crouched: bits.next() < 0.3,
        });
        const r = stepWeapon(l, t, a, tick, rng, () => undefined, id(3), diag, req);
        if (r !== null) {
          expect(Number.isFinite(r.dir.x + r.dir.y + r.dir.z)).toBe(true);
          expect(Math.hypot(r.dir.x, r.dir.y, r.dir.z)).toBeCloseTo(1, 9);
        }
        expect(Number.isFinite(l.lastSpread)).toBe(true);
        for (const s of l.slots) {
          expect(s.mag).toBeGreaterThanOrEqual(0);
          expect(s.mag).toBeLessThanOrEqual(s.profile.magSize);
          expect(s.reserve).toBeGreaterThanOrEqual(0);
          expect(s.bloom).toBeGreaterThanOrEqual(0);
          expect(s.kickPitch).toBeLessThanOrEqual(s.profile.recoil.maxPitch + 1e-12);
          expect(Math.abs(s.kickYaw)).toBeLessThanOrEqual(2 * s.profile.recoil.yawJitter + 1e-12);
        }
      }
      expect(diag.codes).toEqual(['weapons/bad-aim']);
    }
  });
});
