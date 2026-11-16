/**
 * player-combat bench (TS-PC-11, LC-PC-P4). Timings go to
 * reports/player-combat-bench.json and only their 10x ceilings are asserted:
 * this 2 vCPU runtime is not target hardware (req-honest-verification). The
 * heap delta over 1e5 calls of each step function is asserted (PR-PC-06).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createDiagnostics, createRng, vec3, type EntityId } from '../../src/core';
import {
  createHitboxes,
  createVitals,
  executeShot,
  hitboxesFor,
  type ShotTarget,
  type Vitals,
} from '../../src/combat';
import { getMap } from '../../src/maps';
import { buildCollisionWorld } from '../../src/physics';
import {
  PLAYER_TUNING,
  createPlayerState,
  createPlayerStepResult,
  stepPlayer,
} from '../../src/sim/player';
import { WEAPON_PROFILES, createFireRequest, createLoadout, stepWeapon } from '../../src/weapons';
import { aim, cmd, trig } from '../sim/helpers';

const HEAP_LIMIT_BYTES = 1024 * 1024;
const N = 100_000;
const report: Record<string, number> = {};

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run Vitest with --expose-gc (see vitest.config.ts)');
  collect();
}

/** Mean microseconds per call. */
function usPerCall(n: number, body: (i: number) => void): number {
  const start = performance.now();
  for (let i = 0; i < n; i++) body(i);
  return ((performance.now() - start) * 1000) / n;
}

function heapDelta(body: () => void): number {
  body(); // warm up
  gc();
  const before = process.memoryUsage().heapUsed;
  body();
  gc();
  return process.memoryUsage().heapUsed - before;
}

const diag = createDiagnostics(() => undefined);
let events = 0;
const countSink = (): void => {
  events++;
};

describe('player-combat bench', () => {
  const desert = buildCollisionWorld(getMap('desert-compound'));
  const warehouse = buildCollisionWorld(getMap('industrial-warehouse'));

  // stepPlayer on open ground with W held (PR-PC-01).
  const spawn = getMap('desert-compound').spawns[0];
  const player = createPlayerState(spawn?.pos ?? vec3(), spawn?.yaw ?? 0);
  const pOut = createPlayerStepResult();
  const walk = cmd({ move: { x: 0, z: -1 }, lookDx: 0.5 });
  const back = cmd({ move: { x: 0, z: 1 }, lookDx: -0.5 });
  const runPlayer = (i: number): void => {
    stepPlayer(
      player,
      (i >> 6) & 1 ? back : walk,
      desert,
      PLAYER_TUNING,
      1,
      'live',
      { scoped: false },
      diag,
      pOut,
    );
  };

  // stepWeapon, rifle held, bots refill forever (PR-PC-02).
  const loadout = createLoadout(WEAPON_PROFILES, { infiniteReserve: true });
  const rng = createRng(42).fork('spread/1');
  const fireReq = createFireRequest(1 as EntityId);
  const hold = trig({ fire: true, reload: true });
  const a = aim();
  const runWeapon = (i: number): void => {
    stepWeapon(loadout, hold, a, i, rng, countSink, 1 as EntityId, diag, fireReq);
  };

  // executeShot with 21 targets in a ring on the warehouse (PR-PC-03).
  const centre = getMap('industrial-warehouse').spawns[0]?.pos ?? vec3();
  const targets: ShotTarget[] = Array.from({ length: 21 }, (_, k) => {
    const ang = (k / 21) * Math.PI * 2;
    const feet = vec3(centre.x + Math.cos(ang) * 6, centre.y, centre.z + Math.sin(ang) * 6);
    return {
      id: (k + 1) as EntityId,
      hitboxes: hitboxesFor(feet, false, createHitboxes()),
      damageable: true,
    };
  });
  const vit: Vitals[] = Array.from({ length: 22 }, (_, k) =>
    createVitals(k === 0 ? 'player' : 'bot'),
  );
  const lookup = (n: EntityId): Vitals | undefined => vit[n];
  const shotReq = createFireRequest(0 as EntityId);
  shotReq.origin = vec3(centre.x, centre.y + 1, centre.z);
  const runShot = (i: number): void => {
    const ang = ((i % 64) / 64) * Math.PI * 2;
    shotReq.dir.x = Math.cos(ang);
    shotReq.dir.y = 0;
    shotReq.dir.z = Math.sin(ang);
    for (const v of vit) {
      v.health = 100;
      v.alive = true;
      v.deathTick = null;
    }
    executeShot(shotReq, WEAPON_PROFILES[0], warehouse, targets, lookup, countSink, diag);
  };

  it('runs the hot paths within 10x of the targets', () => {
    usPerCall(10_000, runPlayer);
    report.stepPlayerUs = usPerCall(N, runPlayer);
    usPerCall(10_000, runWeapon);
    report.stepWeaponUs = usPerCall(N, runWeapon);
    usPerCall(10_000, runShot);
    report.executeShotUs = usPerCall(N, runShot);
    const ticks = 2000;
    report.worstTickMs =
      usPerCall(ticks, (t) => {
        runPlayer(t);
        for (let k = 0; k < 21; k++) runWeapon(t * 21 + k);
        for (let k = 0; k < 21; k++) runShot(t * 21 + k);
      }) / 1000;
    expect(report.stepPlayerUs).toBeLessThan(50);
    expect(report.stepWeaponUs).toBeLessThan(20);
    expect(report.executeShotUs).toBeLessThan(50);
    expect(report.worstTickMs).toBeLessThan(2);
    expect(events).toBeGreaterThan(0);
  });

  it('does not grow the heap over 1e5 calls of each step function (PR-PC-06)', () => {
    report.stepPlayerHeapBytes = heapDelta(() => {
      for (let i = 0; i < N; i++) runPlayer(i);
    });
    report.stepWeaponHeapBytes = heapDelta(() => {
      for (let i = 0; i < N; i++) runWeapon(i);
    });
    report.executeShotHeapBytes = heapDelta(() => {
      for (let i = 0; i < N; i++) runShot(i);
    });
    expect(report.stepPlayerHeapBytes).toBeLessThan(HEAP_LIMIT_BYTES);
    expect(report.stepWeaponHeapBytes).toBeLessThan(HEAP_LIMIT_BYTES);
    expect(report.executeShotHeapBytes).toBeLessThan(HEAP_LIMIT_BYTES);
    mkdirSync('reports', { recursive: true });
    writeFileSync(
      'reports/player-combat-bench.json',
      `${JSON.stringify({ note: 'Node on the 2 vCPU runtime; not target hardware', ...report }, null, 2)}\n`,
    );
  });
});
