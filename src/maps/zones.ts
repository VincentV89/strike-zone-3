/**
 * Spawn zones are not stored; they are the groups of spawns sharing a `zone`
 * name (domain-entities-map-data). This module derives them and evaluates the
 * zone rules BR-M-43 to BR-M-46 for both checkMapData and the spawn-areas
 * backing rule.
 */
import type { MapDataIssueCode, SpawnPoint } from './types';

export interface SpawnZone {
  /** Order of first appearance in `spawns`. */
  readonly order: number;
  /** Spawn indices, ascending. */
  readonly members: readonly number[];
  readonly cx: number;
  readonly cz: number;
  readonly players: number;
}

export interface ZoneFinding {
  readonly code: MapDataIssueCode;
  /** Spawn index the finding is about, if any. */
  readonly index?: number;
  readonly detail: string;
}

export const ZONE_LIMITS = Object.freeze({
  minZones: 4,
  maxZones: 6,
  minPerZone: 6,
  maxPerZone: 10,
  minOutsideLargest: 22,
  zoneRadius: 8,
  minCentroidGap: 20,
  minPlayerSpawns: 6,
});

/** Groups spawns by zone, skipping the indices in `skip` (non-finite ones). */
export function groupZones(
  spawns: readonly SpawnPoint[],
  skip: ReadonlySet<number> = new Set(),
): SpawnZone[] {
  const byName = new Map<string, number[]>();
  spawns.forEach((s, i) => {
    if (skip.has(i)) return;
    const list = byName.get(s.zone);
    if (list === undefined) byName.set(s.zone, [i]);
    else list.push(i);
  });
  return [...byName.values()].map((members, order) => {
    let sx = 0;
    let sz = 0;
    let players = 0;
    for (const i of members) {
      const s = spawns[i];
      if (s === undefined) continue;
      sx += s.pos.x;
      sz += s.pos.z;
      if (s.player) players += 1;
    }
    return { order, members, cx: sx / members.length, cz: sz / members.length, players };
  });
}

/** BR-M-43 to BR-M-46 as findings, in rule order. */
export function zoneFindings(
  spawns: readonly SpawnPoint[],
  zones: readonly SpawnZone[],
): ZoneFinding[] {
  const out: ZoneFinding[] = [];
  const L = ZONE_LIMITS;
  const total = zones.reduce((n, z) => n + z.members.length, 0);
  const largest = zones.reduce((n, z) => Math.max(n, z.members.length), 0);
  if (zones.length < L.minZones || zones.length > L.maxZones) {
    out.push({ code: 'maps/spawn-zones', detail: `${zones.length} zones; need 4 to 6` });
  }
  zones.forEach((z) => {
    if (z.members.length < L.minPerZone || z.members.length > L.maxPerZone) {
      out.push({
        code: 'maps/spawn-zones',
        index: z.members[0],
        detail: `zone #${z.order} has ${z.members.length} spawns; need 6 to 10`,
      });
    }
  });
  if (total - largest < L.minOutsideLargest) {
    out.push({
      code: 'maps/spawn-zones',
      detail: `${total - largest} spawns outside the largest zone; need at least 22`,
    });
  }
  for (const z of zones) {
    for (const i of z.members) {
      const s = spawns[i];
      if (s === undefined) continue;
      const d = Math.hypot(s.pos.x - z.cx, s.pos.z - z.cz);
      if (d > L.zoneRadius) {
        out.push({
          code: 'maps/spawn-zone-too-large',
          index: i,
          detail: `${d.toFixed(2)} m from its zone centroid; limit 8`,
        });
      }
    }
  }
  for (let a = 0; a < zones.length; a += 1) {
    for (let b = a + 1; b < zones.length; b += 1) {
      const za = zones[a];
      const zb = zones[b];
      if (za === undefined || zb === undefined) continue;
      const d = Math.hypot(za.cx - zb.cx, za.cz - zb.cz);
      if (d < L.minCentroidGap) {
        out.push({
          code: 'maps/spawn-zones-too-close',
          detail: `zones #${za.order} and #${zb.order} centroids ${d.toFixed(2)} m apart; need 20`,
        });
      }
    }
  }
  let players = 0;
  for (const z of zones) {
    players += z.players;
    if (z.players < 1) {
      out.push({
        code: 'maps/spawn-player-count',
        index: z.members[0],
        detail: `zone #${z.order} has no player-eligible spawn`,
      });
    }
  }
  if (players < L.minPlayerSpawns) {
    out.push({
      code: 'maps/spawn-player-count',
      detail: `${players} player-eligible spawns; need at least 6`,
    });
  }
  return out;
}
