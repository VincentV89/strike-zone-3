/**
 * Real-map fairness sweep (SD-PC-11): for every solid kind and every ramp on
 * both maps, a bot directly behind the shape takes no damage from 100 seeded
 * shots. Plus a seeded fuzz of executeShot (LC-PC-R2).
 */
import { describe, expect, it } from 'vitest';
import { createRng, vec3, type EntityId, type Vec3 } from '../../src/core';
import type { MapId } from '../../src/contracts';
import {
  createHitboxes,
  createShotOutcome,
  createVitals,
  executeShot,
  hitboxesFor,
  resolveShot,
  type ShotTarget,
  type Vitals,
} from '../../src/combat';
import { getMap, type MapDefinition } from '../../src/maps';
import { buildCollisionWorld, type CollisionWorld } from '../../src/physics';
import { WEAPON_PROFILES, createFireRequest } from '../../src/weapons';
import { id, recordingDiag } from '../sim/helpers';

const MAPS: readonly MapId[] = ['desert-compound', 'industrial-warehouse'];
const rifle = WEAPON_PROFILES[0];

interface Case {
  name: string;
  from: Vec3;
  /** Bot feet; the ray at from.y passes through the bot's body. */
  feet: Vec3;
}

function solidCases(def: MapDefinition): Case[] {
  const seen = new Set<string>();
  const cases: Case[] = [];
  def.solids.forEach((s, i) => {
    const b = s.box;
    const h = b.max.y - b.min.y;
    if (seen.has(s.kind) || h < 0.5 || b.max.x - b.min.x < 0.1) return;
    seen.add(s.kind);
    const y = b.min.y + Math.min(0.9, h / 2);
    const cz = (b.min.z + b.max.z) / 2;
    cases.push({
      name: `solid ${i} (${s.kind})`,
      from: vec3(b.min.x - 2, y, cz),
      feet: vec3(b.max.x + 1, y - 1, cz),
    });
  });
  return cases;
}

function rampCases(def: MapDefinition): Case[] {
  return def.ramps.map((r, i) => {
    const y = r.baseY + 0.25 * (r.topY - r.baseY);
    const alongX = r.up === '+z' || r.up === '-z';
    // Cross the ramp perpendicular to its slope, near the high end where the wedge is tall.
    const hiX = r.up === '+x' ? r.maxX - 0.3 : r.minX + 0.3;
    const hiZ = r.up === '+z' ? r.maxZ - 0.3 : r.minZ + 0.3;
    return alongX
      ? { name: `ramp ${i}`, from: vec3(r.minX - 2, y, hiZ), feet: vec3(r.maxX + 1, y - 1, hiZ) }
      : { name: `ramp ${i}`, from: vec3(hiX, y, r.minZ - 2), feet: vec3(hiX, y - 1, r.maxZ + 1) };
  });
}

function sweep(world: CollisionWorld, c: Case): { damage: number; blockedFirst: boolean } {
  const bot = createVitals('bot');
  const vit = new Map<number, Vitals>([
    [0, createVitals('player')],
    [1, bot],
  ]);
  const lookup = (n: EntityId): Vitals | undefined => vit.get(n);
  const targets: ShotTarget[] = [
    { id: id(1), hitboxes: hitboxesFor(c.feet, false, createHitboxes()), damageable: true },
  ];
  const rng = createRng(42).fork(c.name);
  const req = createFireRequest(id(0));
  req.origin = vec3(c.from.x, c.from.y, c.from.z);
  const tx = c.feet.x - c.from.x;
  const tz = c.feet.z - c.from.z;
  const dist = Math.hypot(tx, tz);
  let damage = 0;
  for (let i = 0; i < 100; i++) {
    req.dir = vec3(tx / dist + rng.range(-0.01, 0.01), rng.range(-0.01, 0.01), tz / dist);
    executeShot(
      req,
      rifle,
      world,
      targets,
      lookup,
      (e) => {
        if (e.t === 'damage') damage += e.amount + e.armorLoss;
      },
      recordingDiag(),
    );
  }
  req.dir = vec3(tx / dist, 0, tz / dist);
  const o = resolveShot(req, world, [], rifle, createShotOutcome());
  return { damage, blockedFirst: o.impact !== null && o.distance < dist - 1 };
}

describe.each(MAPS)('walls win on %s (SD-PC-11)', (mapId) => {
  const def = getMap(mapId);
  const world = buildCollisionWorld(def);
  const cases = [...solidCases(def), ...rampCases(def)];

  it('covers several solid kinds and every ramp', () => {
    expect(solidCases(def).length).toBeGreaterThanOrEqual(3);
    expect(rampCases(def)).toHaveLength(def.ramps.length);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s blocks every shot', (_n, c) => {
    const r = sweep(world, c);
    expect(r.blockedFirst).toBe(true);
    expect(r.damage).toBe(0);
  });

  it('hits the same bot when nothing is in between (control)', () => {
    const spawn = def.spawns[0];
    const p = spawn?.pos ?? vec3();
    const yaw = spawn?.yaw ?? 0;
    const c: Case = {
      name: 'open',
      from: vec3(p.x, p.y + 1, p.z),
      feet: vec3(p.x - Math.sin(yaw) * 3, p.y, p.z - Math.cos(yaw) * 3),
    };
    expect(sweep(world, c).damage).toBeGreaterThan(0);
  });
});

describe('executeShot fuzz (LC-PC-R2)', () => {
  it('never throws and keeps vitals in range over 2000 hostile shots', () => {
    const world = buildCollisionWorld(getMap('industrial-warehouse'));
    const bits = createRng(77).fork('fuzz');
    const nasty = [Number.NaN, Infinity, -Infinity, -0, 1e30, -1e30];
    const pick = (lo: number, hi: number): number =>
      bits.next() < 0.15 ? (nasty[bits.int(0, nasty.length)] ?? 0) : bits.range(lo, hi);
    const vit = new Map<number, Vitals>();
    for (let n = 0; n <= 20; n++) vit.set(n, createVitals(n === 0 ? 'player' : 'bot'));
    const deaths = new Map<number, number>();
    const lookup = (n: EntityId): Vitals | undefined => vit.get(n);
    const req = createFireRequest(id(0));
    const diag = recordingDiag();
    for (let i = 0; i < 2000; i++) {
      const targets: ShotTarget[] = [];
      const count = bits.int(0, 22);
      for (let k = 0; k < count; k++) {
        const feet = vec3(pick(-20, 20), pick(0, 2), pick(-20, 20));
        targets.push({
          id: id(bits.int(0, 25)),
          hitboxes: hitboxesFor(feet, bits.next() < 0.3, createHitboxes()),
          damageable: bits.next() < 0.7,
        });
      }
      req.shooter = id(bits.int(0, 21));
      req.origin = vec3(pick(-20, 20), pick(0, 3), pick(-20, 20));
      req.dir = vec3(pick(-1, 1), pick(-0.3, 0.3), pick(-1, 1));
      req.tick = i;
      const profile = WEAPON_PROFILES[bits.int(0, 3) as 0 | 1 | 2];
      executeShot(
        req,
        profile,
        world,
        targets,
        lookup,
        (e) => {
          if (e.t === 'shot') expect(Number.isFinite(e.end.x + e.end.y + e.end.z)).toBe(true);
          if (e.t === 'damage') expect(e.amount + e.armorLoss).toBeGreaterThan(0);
        },
        diag,
      );
      for (const [n, v] of vit) {
        expect(v.health).toBeGreaterThanOrEqual(0);
        expect(v.health).toBeLessThanOrEqual(100);
        expect(v.armor).toBeGreaterThanOrEqual(0);
        expect(v.armor).toBeLessThanOrEqual(100);
        if (v.deathTick !== null) {
          const first = deaths.get(n) ?? v.deathTick;
          deaths.set(n, first);
          expect(v.deathTick).toBe(first);
          expect(v.alive).toBe(false);
        }
      }
    }
    const allowed = ['combat/bad-ray', 'combat/unknown-target', 'physics/non-finite-input'];
    expect(diag.codes.every((c) => allowed.includes(c))).toBe(true);
  });
});
