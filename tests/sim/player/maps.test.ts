/**
 * Real-map movement (story-sprint-crouch-jump AC4) plus replay and fuzz for
 * stepPlayer (SD-PC-16, LC-PC-R2).
 */
import { describe, expect, it } from 'vitest';
import { createRng, vec3 } from '../../../src/core';
import type { MapId } from '../../../src/contracts';
import { getMap, type Ramp } from '../../../src/maps';
import { buildCollisionWorld } from '../../../src/physics';
import {
  PLAYER_TUNING,
  createPlayerState,
  createPlayerStepResult,
  stepPlayer,
} from '../../../src/sim/player';
import { cmd, recordingDiag, strictDiag } from '../helpers';

const MAPS: readonly MapId[] = ['desert-compound', 'industrial-warehouse'];

/** Start 1 m before the low edge of the ramp, facing up it. */
function rampStart(r: Ramp): { x: number; z: number; yaw: number } {
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  switch (r.up) {
    case '+x':
      return { x: r.minX - 1, z: cz, yaw: -Math.PI / 2 };
    case '-x':
      return { x: r.maxX + 1, z: cz, yaw: Math.PI / 2 };
    case '+z':
      return { x: cx, z: r.minZ - 1, yaw: Math.PI };
    case '-z':
      return { x: cx, z: r.maxZ + 1, yaw: 0 };
  }
}

describe.each(MAPS)('elevated positions on %s are reached by walking up the ramps', (mapId) => {
  const def = getMap(mapId);
  const world = buildCollisionWorld(def);

  it.each(def.ramps.map((r, i) => [i, r] as const))('ramp %i', (_i, ramp) => {
    const start = rampStart(ramp);
    const s = createPlayerState(vec3(start.x, ramp.baseY, start.z), start.yaw);
    const out = createPlayerStepResult();
    const W = cmd({ move: { x: 0, z: -1 } });
    const run = Math.max(ramp.maxX - ramp.minX, ramp.maxZ - ramp.minZ);
    let top = false;
    for (let i = 0; i < Math.ceil(((run + 2) / PLAYER_TUNING.walkSpeed) * 60) + 30 && !top; i++) {
      stepPlayer(s, W, world, PLAYER_TUNING, 1, 'live', { scoped: false }, strictDiag(), out);
      top = s.grounded && s.pos.y >= ramp.topY - 0.05;
    }
    expect(top).toBe(true);
  });
});

function script(seed: number, n: number) {
  const world = buildCollisionWorld(getMap('desert-compound'));
  const spawn = getMap('desert-compound').spawns[0];
  const s = createPlayerState(spawn?.pos ?? vec3(), spawn?.yaw ?? 0);
  const out = createPlayerStepResult();
  const bits = createRng(seed).fork('script');
  const trace: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = cmd({
      move: { x: (bits.int(0, 3) - 1) as -1 | 0 | 1, z: (bits.int(0, 3) - 1) as -1 | 0 | 1 },
      lookDx: bits.range(-20, 20),
      lookDy: bits.range(-5, 5),
      jump: bits.next() < 0.05,
      sprint: bits.next() < 0.5,
      crouch: bits.next() < 0.1,
    });
    stepPlayer(s, c, world, PLAYER_TUNING, 1, 'live', { scoped: false }, strictDiag(), out);
    trace.push(s.pos.x, s.pos.y, s.pos.z, s.yaw, s.pitch, out.footstep === null ? 0 : 1);
  }
  return trace;
}

describe('stepPlayer determinism and robustness', () => {
  it('replays a scripted 600-tick sequence exactly in one process', () => {
    expect(script(42, 600)).toEqual(script(42, 600));
  });

  it('never throws or yields NaN over 2000 hostile commands (LC-PC-R2)', () => {
    const world = buildCollisionWorld(getMap('industrial-warehouse'));
    const spawn = getMap('industrial-warehouse').spawns[0];
    const s = createPlayerState(spawn?.pos ?? vec3(), 0);
    const out = createPlayerStepResult();
    const diag = recordingDiag();
    const bits = createRng(1234).fork('fuzz');
    const nasty = [Number.NaN, Infinity, -Infinity, -0, 1e30, -1e30, 2, -7];
    const pick = (): number =>
      bits.next() < 0.25 ? (nasty[bits.int(0, nasty.length)] ?? 0) : bits.range(-1, 1);
    for (let i = 0; i < 2000; i++) {
      const c = cmd({
        move: { x: Math.round(pick()) as 0, z: Math.round(pick()) as 0 },
        lookDx: pick() * 50,
        lookDy: pick() * 50,
        jump: bits.next() < 0.1,
        sprint: bits.next() < 0.5,
        crouch: bits.next() < 0.2,
      });
      const sens = bits.next() < 0.05 ? Number.NaN : 1;
      stepPlayer(
        s,
        c,
        world,
        PLAYER_TUNING,
        sens,
        'live',
        { scoped: bits.next() < 0.1 },
        diag,
        out,
      );
      for (const v of [s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.yaw, s.pitch]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(Math.abs(s.pitch)).toBeLessThanOrEqual(PLAYER_TUNING.pitchLimit);
      expect(Math.hypot(s.vel.x, s.vel.z)).toBeLessThanOrEqual(PLAYER_TUNING.sprintSpeed + 1e-9);
      expect(s.vel.y).toBeGreaterThanOrEqual(-PLAYER_TUNING.terminalSpeed);
    }
    expect(diag.codes.every((c) => c === 'player/bad-input')).toBe(true);
  });
});
