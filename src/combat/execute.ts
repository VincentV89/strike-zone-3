/**
 * executeShot (tick stage 9): dead-shooter skip, resolve, damage, then events
 * in the fixed order shot, impact?, damage?, kill?, noise (BR-PC-47, BR-PC-48).
 * Events are reused scratch objects (SD-PC-10).
 */
import { copy, normalize, sub, vec3, type Diagnostics, type EntityId } from '../core';
import type { SimEvent } from '../contracts';
import type { CollisionWorld } from '../physics';
import type { FireRequest, WeaponProfile } from '../weapons';
import { ARMOR_MODEL, applyDamage } from './damage';
import { createShotOutcome, resolveInto } from './resolve';
import type { ShotTarget, Vitals } from './types';

type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;

const NO_ID = 0 as EntityId;
const outcome = createShotOutcome();
const shotEv: Ev<'shot'> = {
  t: 'shot',
  tick: 0,
  shooter: NO_ID,
  weapon: 'rifle',
  origin: vec3(),
  end: vec3(),
  hit: null,
  headshot: false,
};
const impactEv: Ev<'impact'> = { t: 'impact', tick: 0, point: vec3(), normal: vec3() };
const damageEv: Ev<'damage'> = {
  t: 'damage',
  tick: 0,
  target: NO_ID,
  source: NO_ID,
  amount: 0,
  armorLoss: 0,
  fromDir: vec3(),
  headshot: false,
};
const killEv: Ev<'kill'> = {
  t: 'kill',
  tick: 0,
  victim: NO_ID,
  killer: NO_ID,
  weapon: 'rifle',
  headshot: false,
};
const noiseEv: Ev<'noise'> = {
  t: 'noise',
  tick: 0,
  source: NO_ID,
  kind: 'gunfire',
  pos: vec3(),
  radius: 0,
};

function emitNoise(req: FireRequest, profile: WeaponProfile, emit: (e: SimEvent) => void): void {
  noiseEv.tick = req.tick;
  noiseEv.source = req.shooter;
  copy(req.origin, noiseEv.pos);
  noiseEv.radius = profile.noiseRadius;
  emit(noiseEv);
}

/**
 * Resolves one queued shot and applies its damage. A no-op when the shooter is
 * dead (BR-PC-47) or the origin is non-finite (`combat/bad-ray`). Never throws.
 *
 * `emit` receives reused scratch events: the sink must copy every field it
 * keeps before returning, must not throw and must not call back into combat
 * (SD-PC-10). `vitals` should be created once per round.
 */
export function executeShot(
  req: FireRequest,
  profile: WeaponProfile,
  world: CollisionWorld,
  targets: readonly ShotTarget[],
  vitals: (id: EntityId) => Vitals | undefined,
  emit: (e: SimEvent) => void,
  diag: Diagnostics,
): void {
  const shooter = vitals(req.shooter);
  if (shooter?.alive !== true) return;
  const o = req.origin;
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.z)) {
    // No position to report: emitting NaN events would only spread the fault.
    diag.warnOnce('combat/bad-ray');
    return;
  }

  resolveInto(req, world, targets, profile, vitals, outcome, diag);
  const hit = outcome.hit;

  shotEv.tick = req.tick;
  shotEv.shooter = req.shooter;
  shotEv.weapon = profile.id;
  copy(req.origin, shotEv.origin);
  copy(outcome.end, shotEv.end);
  shotEv.hit = hit === null ? null : hit.target;
  shotEv.headshot = hit !== null && hit.headshot;
  emit(shotEv);

  if (outcome.impact !== null) {
    impactEv.tick = req.tick;
    copy(outcome.impact.point, impactEv.point);
    copy(outcome.impact.normal, impactEv.normal);
    emit(impactEv);
  }

  if (hit !== null) {
    const victim = vitals(hit.target);
    if (victim !== undefined) {
      const dr = applyDamage(victim, hit.damage, ARMOR_MODEL, req.tick, diag);
      if (dr.healthLoss + dr.armorLoss > 0) {
        damageEv.tick = req.tick;
        damageEv.target = hit.target;
        damageEv.source = req.shooter;
        damageEv.amount = dr.healthLoss;
        damageEv.armorLoss = dr.armorLoss;
        // Points from the target toward the attacker (BR-PC-49).
        normalize(sub(req.origin, hit.point, damageEv.fromDir), damageEv.fromDir);
        damageEv.headshot = hit.headshot;
        emit(damageEv);
      }
      if (dr.died) {
        killEv.tick = req.tick;
        killEv.victim = hit.target;
        killEv.killer = req.shooter;
        killEv.weapon = profile.id;
        killEv.headshot = hit.headshot;
        emit(killEv);
      }
    }
  }

  emitNoise(req, profile, emit);
}
