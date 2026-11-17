/**
 * validateMap (BR-GS-13) and the hidden-spawn candidate rule shared with
 * spawn allocation (BR-GS-21). Load-time only; allocation is fine here.
 */
import { vec3 } from '../core';
import { MAP_RULES, checkMapData, type MapDefinition } from '../maps';
import { navReport, type NavGraph } from '../nav';
import type { Capsule, CollisionWorld } from '../physics';
import { freezeNested } from './freeze';
import { SIM_TUNING } from './tuning';
import type { MapValidationIssue, MapValidationReport } from './types';

export const STANDING: Capsule = Object.freeze({
  radius: MAP_RULES.agentRadius,
  height: MAP_RULES.agentHeight,
});
export const CROUCHED: Capsule = Object.freeze({
  radius: MAP_RULES.agentRadius,
  height: MAP_RULES.crouchHeight,
});

/**
 * Spawns that may hold a bot when the player spawns at index `p`: at least
 * MAP_RULES.minPlayerBotDistance away in xz, and every probe point hidden
 * from the player's eye. Ascending index order.
 */
export function spawnCandidates(def: MapDefinition, world: CollisionWorld, p: number): number[] {
  const out: number[] = [];
  const ps = def.spawns[p];
  if (ps === undefined) return out;
  const eye = vec3(ps.pos.x, ps.pos.y + SIM_TUNING.spawnEyeHeight, ps.pos.z);
  const probe = vec3();
  const minD = MAP_RULES.minPlayerBotDistance;
  for (let i = 0; i < def.spawns.length; i++) {
    if (i === p) continue;
    const s = def.spawns[i];
    if (s === undefined) continue;
    const dx = s.pos.x - ps.pos.x;
    const dz = s.pos.z - ps.pos.z;
    if (!(dx * dx + dz * dz >= minD * minD)) continue;
    let hidden = true;
    for (const h of SIM_TUNING.spawnProbeHeights) {
      probe.x = s.pos.x;
      probe.y = s.pos.y + h;
      probe.z = s.pos.z;
      if (world.lineOfSight(eye, probe)) {
        hidden = false;
        break;
      }
    }
    if (hidden) out.push(i);
  }
  return out;
}

/** Aggregates the data, nav, capsule and spawn-budget checks into one frozen report. */
export function validateMap(
  def: MapDefinition,
  world: CollisionWorld,
  nav: NavGraph,
): MapValidationReport {
  const issues: MapValidationIssue[] = [...checkMapData(def)];
  const report = navReport(def, nav);
  for (const u of report.unattached) {
    issues.push({
      code: 'sim/nav-unattached',
      list: u.list,
      index: u.index,
      detail: `${u.list}[${u.index}] has no nav node`,
    });
  }
  for (const u of report.unreachable) {
    issues.push({
      code: 'sim/nav-unreachable',
      list: u.list,
      index: u.index,
      detail: `${u.list}[${u.index}] is unreachable from spawn ${u.fromSpawn}`,
    });
  }
  if (def.spawns.length < SIM_TUNING.minSpawns) {
    issues.push({
      code: 'sim/too-few-spawns',
      detail: `${def.spawns.length} spawns, at least ${SIM_TUNING.minSpawns} needed`,
    });
  }
  const budget: number[] = [];
  def.spawns.forEach((s, i) => {
    if (!world.capsuleFits(s.pos, STANDING)) {
      issues.push({
        code: 'sim/spawn-blocked',
        list: 'spawns',
        index: i,
        detail: `spawn ${i} does not fit a standing capsule`,
      });
    }
    budget.push(s.player ? spawnCandidates(def, world, i).length : -1);
  });
  budget.forEach((b, i) => {
    if (b >= 0 && b < SIM_TUNING.maxBots) {
      issues.push({
        code: 'sim/spawn-budget',
        list: 'spawns',
        index: i,
        detail: `player spawn ${i} has ${b} hidden bot spawns, ${SIM_TUNING.maxBots} needed`,
      });
    }
  });
  return freezeNested({ ok: issues.length === 0, issues, spawnBudget: budget });
}
