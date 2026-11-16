import { describe, expect, it } from 'vitest';
import { vec3, type Diagnostics } from '../../../src/core';
import type { InputCommand, RoundPhase } from '../../../src/contracts';
import { buildCollisionWorld, type CollisionWorld } from '../../../src/physics';
import {
  PLAYER_TUNING,
  createPlayerState,
  createPlayerStepResult,
  eyePosition,
  stepPlayer,
  type PlayerState,
} from '../../../src/sim/player';
import { FIXTURE_SOLIDS, box, fixtureMap } from '../../physics/fixtures';
import { cmd, recordingDiag, strictDiag } from '../helpers';

const T = PLAYER_TUNING;
const openWorld = buildCollisionWorld(fixtureMap());

function runner(
  world: CollisionWorld = openWorld,
  s: PlayerState = createPlayerState(vec3(0, 0, 0), 0),
) {
  const out = createPlayerStepResult();
  const diag: Diagnostics = strictDiag();
  const step = (
    c: InputCommand,
    opts: { phase?: RoundPhase; scoped?: boolean; sens?: number; d?: Diagnostics } = {},
  ) =>
    stepPlayer(
      s,
      c,
      world,
      T,
      opts.sens ?? 1,
      opts.phase ?? 'live',
      { scoped: opts.scoped ?? false },
      opts.d ?? diag,
      out,
    );
  const ticks = (n: number, c: InputCommand, opts?: Parameters<typeof step>[1]) => {
    for (let i = 0; i < n; i++) step(c, opts);
  };
  return { s, out, step, ticks };
}

const hspeed = (s: PlayerState): number => Math.hypot(s.vel.x, s.vel.z);
const W = cmd({ move: { x: 0, z: -1 } });

describe('look (BR-PC-01, story-mouse-look AC1/AC2)', () => {
  it('turns right on positive dx and looks down on positive dy', () => {
    const r = runner();
    r.step(cmd({ lookDx: 100, lookDy: 50 }));
    expect(r.s.yaw).toBeCloseTo(-100 * T.lookRadPerCount, 12);
    expect(r.s.pitch).toBeCloseTo(-50 * T.lookRadPerCount, 12);
  });

  it('scales with sensitivity, wraps yaw and clamps pitch', () => {
    const r = runner();
    r.step(cmd({ lookDx: 100 }), { sens: 2 });
    expect(r.s.yaw).toBeCloseTo(-200 * T.lookRadPerCount, 12);
    r.step(cmd({ lookDx: -1e6, lookDy: -1e6 }));
    expect(r.s.yaw).toBeGreaterThan(-Math.PI);
    expect(r.s.yaw).toBeLessThanOrEqual(Math.PI);
    expect(r.s.pitch).toBe(T.pitchLimit);
    r.step(cmd({ lookDy: 1e9 }));
    expect(r.s.pitch).toBe(-T.pitchLimit);
  });
});

describe('ground movement (BR-PC-04..06, story-sprint-crouch-jump)', () => {
  it('accelerates to walk speed in 9 ticks and stops in 8, never instantly', () => {
    const r = runner();
    r.step(W);
    expect(hspeed(r.s)).toBeCloseTo(0.5, 9);
    r.ticks(8, W);
    expect(hspeed(r.s)).toBeCloseTo(4.5, 9);
    expect(r.s.vel.z).toBeLessThan(0); // W moves toward -Z at yaw 0
    r.ticks(7, cmd());
    expect(hspeed(r.s)).toBeGreaterThan(0);
    r.step(cmd());
    expect(hspeed(r.s)).toBe(0);
  });

  it('moves along the facing direction for every yaw', () => {
    for (const yaw of [0, Math.PI / 2, -Math.PI / 2, 2.5]) {
      const r = runner(openWorld, createPlayerState(vec3(0, 0, 0), yaw));
      r.ticks(20, W);
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      expect((r.s.vel.x * fx + r.s.vel.z * fz) / hspeed(r.s)).toBeCloseTo(1, 9);
    }
  });

  it('does not move faster diagonally', () => {
    const r = runner();
    r.ticks(30, cmd({ move: { x: 1, z: -1 } }));
    expect(hspeed(r.s)).toBeCloseTo(T.walkSpeed, 9);
  });

  it('sprints only forward and standing, and the scope slows the player', () => {
    const r = runner();
    r.ticks(30, cmd({ move: { x: 0, z: -1 }, sprint: true }));
    expect(hspeed(r.s)).toBeCloseTo(T.sprintSpeed, 9);
    const back = runner();
    back.ticks(30, cmd({ move: { x: 0, z: 1 }, sprint: true }));
    expect(hspeed(back.s)).toBeCloseTo(T.walkSpeed, 9);
    const scoped = runner();
    scoped.ticks(30, cmd({ move: { x: 0, z: -1 }, sprint: true }), { scoped: true });
    expect(hspeed(scoped.s)).toBeCloseTo(T.walkSpeed * T.scopedSpeedMult, 9);
  });

  it('crouches on C: slower, lower eye, and stands back up', () => {
    const r = runner();
    r.ticks(30, cmd({ move: { x: 0, z: -1 }, crouch: true, sprint: true }));
    expect(r.s.stance).toBe('crouch');
    expect(hspeed(r.s)).toBeCloseTo(T.crouchSpeed, 9);
    expect(r.s.eyeHeight).toBeCloseTo(T.crouchEye, 9);
    r.ticks(30, cmd());
    expect(r.s.stance).toBe('stand');
    expect(r.s.eyeHeight).toBeCloseTo(T.standEye, 9);
  });

  it('stays crouched under a low ceiling until the standing capsule fits (BR-PC-07)', () => {
    const ceiling = box('platform', [-1, 1.5, -1], [1, 2, 1]);
    const world = buildCollisionWorld(fixtureMap({ solids: [...FIXTURE_SOLIDS, ceiling] }));
    const r = runner(world);
    r.step(cmd({ crouch: true }));
    r.ticks(10, cmd());
    expect(r.s.stance).toBe('crouch');
    r.ticks(60, cmd({ move: { x: 0, z: -1 } }));
    expect(r.s.pos.z).toBeLessThan(-1.4);
    expect(r.s.stance).toBe('stand');
  });

  it('emits footsteps by stride while grounded and moving', () => {
    const r = runner();
    const kinds: string[] = [];
    for (let i = 0; i < 120; i++) {
      r.step(W);
      if (r.out.footstep !== null) kinds.push(r.out.footstep);
    }
    // ~8.4 m walked over 2 s at 4.5 m/s with 2.2 m strides.
    expect(kinds.length).toBeGreaterThanOrEqual(3);
    expect(new Set(kinds)).toEqual(new Set(['walk']));
    r.ticks(20, cmd());
    r.step(cmd());
    expect(r.out.footstep).toBeNull();
  });

  it('calls moveCapsule exactly once per live tick and never in countdown (PR-PC-08)', () => {
    let moves = 0;
    let fits = 0;
    const spy: CollisionWorld = {
      ...openWorld,
      bounds: openWorld.bounds,
      moveCapsule: (...a) => {
        moves++;
        return openWorld.moveCapsule(...a);
      },
      capsuleFits: (...a) => {
        fits++;
        return openWorld.capsuleFits(...a);
      },
    };
    const r = runner(spy);
    r.ticks(10, cmd({ move: { x: 1, z: -1 }, lookDx: 3 }), { phase: 'countdown' });
    expect(moves).toBe(0);
    expect(r.s.pos).toEqual(vec3(0, 0, 0));
    expect(r.s.yaw).not.toBe(0); // look still applies in countdown
    expect(r.out.footstep).toBeNull();
    r.ticks(10, W);
    expect(moves).toBe(10);
    r.step(cmd({ crouch: true }));
    r.step(cmd());
    expect(fits).toBe(1);
  });
});

describe('jump and gravity (BR-PC-09, BR-PC-10, BR-PC-13)', () => {
  it('jumps once per press to about 1 m and lands with landSpeed', () => {
    const r = runner();
    r.step(cmd({ jump: true }));
    expect(r.s.grounded).toBe(false);
    let peak = 0;
    let landed = -1;
    let landSpeed = 0;
    for (let i = 0; i < 80; i++) {
      r.step(cmd({ jump: true })); // held: must not bunny-hop
      peak = Math.max(peak, r.s.pos.y);
      if (r.out.landed && landed < 0) {
        landed = i;
        landSpeed = r.out.landSpeed;
      }
    }
    expect(peak).toBeGreaterThan(0.9);
    expect(peak).toBeLessThan(1.05);
    expect(landed).toBeGreaterThan(30);
    expect(landSpeed).toBeGreaterThan(5);
    expect(r.s.grounded).toBe(true);
    expect(r.s.pos.y).toBeCloseTo(0, 6);
    r.step(cmd());
    r.step(cmd({ jump: true }));
    expect(r.s.grounded).toBe(false);
  });

  it('cannot jump in mid-air and limits fall speed to 40 m/s', () => {
    const tall = fixtureMap({
      solids: [box('ground', [-10, -400, -10], [10, -399, 10])],
      ramps: [],
      bounds: { min: vec3(-10, -400, -10), max: vec3(10, 10, 10) },
    });
    const world = buildCollisionWorld(tall);
    const r = runner(world, createPlayerState(vec3(0, 0, 0), 0));
    r.step(cmd());
    expect(r.s.grounded).toBe(false);
    const vy = r.s.vel.y;
    r.step(cmd({ jump: true }));
    expect(r.s.vel.y).toBeLessThan(vy);
    r.ticks(200, cmd());
    expect(r.s.vel.y).toBeGreaterThanOrEqual(-T.terminalSpeed);
    expect(r.s.vel.y).toBeCloseTo(-T.terminalSpeed, 9);
  });
});

describe('guards and recovery (SD-PC-05, SD-PC-07, BR-PC-15)', () => {
  it('reads bad input as no input and reports player/bad-input once', () => {
    const diag = recordingDiag();
    const r = runner();
    r.step(cmd({ lookDx: Number.NaN, lookDy: Infinity, move: { x: 2 as 1, z: Number.NaN as 0 } }), {
      d: diag,
    });
    r.step(cmd({ lookDx: 10 }), { sens: Number.NaN, d: diag });
    r.step(cmd({ lookDx: 10 }), { sens: 0, d: diag });
    expect(r.s.yaw).toBe(0);
    expect(r.s.pitch).toBe(0);
    expect(hspeed(r.s)).toBe(0);
    expect(diag.codes).toEqual(['player/bad-input']);
    expect(diag.snapshot()['player/bad-input']).toBeGreaterThanOrEqual(4);
  });

  it('never writes the caller command and copies a frozen spawn', () => {
    const spawn = Object.freeze(vec3(1, 0, 1));
    const s = createPlayerState(spawn, 0);
    expect(s.pos).not.toBe(spawn);
    const c = Object.freeze(cmd({ move: Object.freeze({ x: 1, z: -1 }) }));
    const r = runner(openWorld, s);
    r.ticks(60, c);
    expect(s.pos.x).not.toBe(1);
  });

  it('puts the player back at the last safe position after falling out of the world', () => {
    const gap = fixtureMap({ solids: [box('ground', [-10, -1, -10], [0, 0, 10])], ramps: [] });
    const world = buildCollisionWorld(gap);
    const diag = recordingDiag();
    const r = runner(world, createPlayerState(vec3(-1, 0, 0), -Math.PI / 2)); // facing +X
    let recovered = false;
    for (let i = 0; i < 400 && !recovered; i++) {
      r.step(W, { d: diag });
      recovered = diag.codes.includes('player/out-of-world');
    }
    expect(recovered).toBe(true);
    expect(r.s.pos.y).toBeCloseTo(0, 6);
    expect(r.s.pos.x).toBeLessThanOrEqual(0.4 + 1e-6);
    expect(r.s.vel).toEqual(vec3(0, 0, 0));
  });

  it('gives the eye position from the feet', () => {
    const s = createPlayerState(vec3(2, 1, 3), 0);
    expect(eyePosition(s, vec3())).toEqual(vec3(2, 1 + T.standEye, 3));
  });
});
