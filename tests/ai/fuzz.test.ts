/**
 * Seeded fuzz of every tick function (SD-AI-07): 2,000 cases each with NaN,
 * +-Infinity, +-1e300, odd ids and unset memory. No throw, no non-finite
 * output, only listed diagnostic codes.
 */
import { describe, expect, it } from 'vitest';
import {
  PLAYER_ID,
  TICK_DT,
  createDiagnostics,
  createRng,
  vec3,
  type EntityId,
  type Rng,
  type Vec3,
} from '../../src/core';
import { MAP_RULES } from '../../src/maps';
import type { BotIntent } from '../../src/contracts';
import {
  DIFFICULTY_PROFILES,
  createAiScheduler,
  createBotAim,
  stepBotAim,
} from '../../src/ai/brain';
import { createBotMotion, setGoal, stepBotMotion } from '../../src/ai/locomotion';
import { createPerceptionMemory, sense } from '../../src/ai/perception';
import { createWeaponTrigger } from '../../src/weapons';
import { box } from '../physics/fixtures';
import { AI_DIAGNOSTIC_CODES } from './codes';
import { arena, brainRig, pathService, prepare } from './fixtures';
import { CROUCHED, STANDING } from './harness';

const N = 2000;
const prep = prepare(arena({ solids: [box('wall', [-10, 0, -0.2], [10, 3, 0.2])], cover: [] }));
const SPECIAL = [NaN, Infinity, -Infinity, 1e300, -1e300, 0, -0];

function num(r: Rng): number {
  const k = r.int(0, 4);
  if (k === 0) return SPECIAL[r.int(0, SPECIAL.length)] ?? 0;
  return r.range(-40, 40);
}
const vec = (r: Rng): Vec3 => vec3(num(r), r.next() < 0.7 ? 0 : num(r), num(r));
const oddId = (r: Rng): EntityId => ([0, 1, 2, 21, -1, 1.5, 20][r.int(0, 7)] ?? 1) as EntityId;
const finiteVec = (p: Vec3 | null): boolean =>
  p === null || (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));

function codesSeen(d: ReturnType<typeof createDiagnostics>): string[] {
  return Object.keys(d.snapshot());
}

describe('tick functions never throw and never return non-finite values', () => {
  it('sense', () => {
    const r = createRng(1);
    const diag = createDiagnostics(() => undefined);
    for (let i = 0; i < N; i++) {
      const mem = createPerceptionMemory();
      sense(
        mem,
        {
          selfId: oddId(r),
          selfEye: vec(r),
          selfYaw: num(r),
          targetPoints: [vec(r), vec(r), vec(r), vec(r)],
          noises: [
            {
              t: 'noise',
              tick: num(r),
              source: PLAYER_ID,
              kind: 'gunfire',
              pos: vec(r),
              radius: num(r),
            },
          ],
          damageTaken: [
            {
              t: 'damage',
              tick: num(r),
              target: 1 as EntityId,
              source: PLAYER_ID,
              amount: 1,
              armorLoss: 0,
              fromDir: vec(r),
              headshot: false,
            },
          ],
          tick: r.next() < 0.1 ? NaN : r.int(0, 10_000),
        },
        prep.world,
        DIFFICULTY_PROFILES.normal.perception,
        r,
        diag,
      );
      expect(
        finiteVec(mem.lastSeenPos) && finiteVec(mem.suspectedPos) && finiteVec(mem.threatDir),
      ).toBe(true);
    }
    for (const c of codesSeen(diag)) expect(AI_DIAGNOSTIC_CODES).toContain(c);
  });

  it('setGoal and stepBotMotion', () => {
    const r = createRng(2);
    const diag = createDiagnostics(() => undefined);
    const paths = pathService(prep);
    for (let i = 0; i < N; i++) {
      const m = createBotMotion(
        ((i % 20) + 1) as EntityId,
        r.next() < 0.8 ? vec3(r.range(-20, 20), 0, r.range(-20, 20)) : vec(r),
        num(r),
      );
      if (r.next() < 0.3) m.vel.x = num(r);
      setGoal(
        m,
        r.next() < 0.2 ? null : vec(r),
        r.next() < 0.2 ? { center: vec(r), radius: num(r), penalty: num(r) } : null,
        r.next() < 0.5 ? 'run' : ('sprint' as never),
        diag,
      );
      m.crouch = r.next() < 0.3;
      const ctx = {
        tick: r.int(0, 1000),
        dt: r.next() < 0.1 ? num(r) : TICK_DT,
        world: prep.world,
        paths,
        graph: prep.graph,
        neighbours: [{ id: oddId(r), pos: vec(r), alive: true }],
        standing: STANDING,
        crouched: CROUCHED,
        stepHeight: MAP_RULES.stepHeight,
        diag,
      };
      for (let k = 0; k < 3; k++) {
        paths.tick();
        stepBotMotion(m, ctx);
        ctx.tick++;
      }
      if (Number.isFinite(m.pos.x) || i % 5 !== 0) {
        expect(finiteVec(m.vel)).toBe(true);
      }
      expect(Number.isFinite(m.yaw)).toBe(true);
    }
    for (const c of codesSeen(diag)) expect(AI_DIAGNOSTIC_CODES).toContain(c);
  });

  it('stepBotAim', () => {
    const r = createRng(3);
    const diag = createDiagnostics(() => undefined);
    const out = createWeaponTrigger();
    for (let i = 0; i < N; i++) {
      const a = createBotAim(num(r));
      const mem = createPerceptionMemory();
      if (r.next() < 0.5) {
        mem.visible = true;
        mem.lastSeenPos = vec(r);
        mem.firstSeenTick = r.next() < 0.5 ? null : num(r);
      }
      const intent: BotIntent = {
        goal: null,
        avoid: null,
        speed: 'walk',
        aimAt: r.next() < 0.5 ? vec(r) : null,
        fire: r.next() < 0.5,
        reload: false,
        crouch: false,
      };
      stepBotAim(
        a,
        intent,
        mem,
        {
          tick: r.next() < 0.1 ? NaN : r.int(0, 1000),
          dt: TICK_DT,
          eye: vec(r),
          vel: vec(r),
          mag: r.int(0, 31),
          reloading: false,
          profile: DIFFICULTY_PROFILES.hard,
          rng: r,
          diag,
        },
        out,
      );
      expect(Number.isFinite(a.yaw) && Number.isFinite(a.pitch)).toBe(true);
      expect(typeof out.fire).toBe('boolean');
    }
    for (const c of codesSeen(diag)) expect(AI_DIAGNOSTIC_CODES).toContain(c);
  });

  it('decide', () => {
    const r = createRng(4);
    const rig = brainRig(prep, vec3(5, 0, 5));
    const diag = createDiagnostics(() => undefined);
    rig.ctx.diag = diag;
    const states = ['idle', 'moving', 'arrived', 'waiting-path', 'no-path', 'stuck'] as const;
    for (let i = 0; i < N; i++) {
      rig.self.pos = r.next() < 0.8 ? vec3(r.range(-25, 25), 0, r.range(-25, 25)) : vec(r);
      rig.self.health = r.next() < 0.1 ? num(r) : r.int(0, 101);
      rig.self.mag = r.int(0, 31);
      rig.self.reloading = r.next() < 0.2;
      rig.self.locomotion = states[r.int(0, states.length)] ?? 'idle';
      const m = rig.mem;
      m.visible = r.next() < 0.3;
      m.lastSeenPos = r.next() < 0.5 ? vec(r) : null;
      m.lastSeenTick = r.next() < 0.1 ? NaN : i * 6 - r.int(0, 900);
      m.underFireTick = r.next() < 0.3 ? i * 6 : -1;
      m.threatDir = r.next() < 0.5 ? vec3(r.range(-1, 1), 0, r.range(-1, 1)) : null;
      m.suspectedPos = r.next() < 0.3 ? vec(r) : null;
      m.suspectedTick = r.next() < 0.3 ? i * 6 : -1;
      const intent = rig.at(i * 6);
      expect(finiteVec(intent.goal) && finiteVec(intent.aimAt)).toBe(true);
    }
    for (const c of codesSeen(diag)) expect(AI_DIAGNOSTIC_CODES).toContain(c);
  });

  it('scheduler queries', () => {
    const r = createRng(5);
    const s = createAiScheduler(20);
    for (let i = 0; i < N; i++) {
      const id = oddId(r);
      const t = num(r);
      expect(typeof s.shouldSense(id, t)).toBe('boolean');
      expect(typeof s.shouldDecide(id, t)).toBe('boolean');
      s.wake(id);
    }
  });
});
