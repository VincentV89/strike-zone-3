/**
 * Radar projection (Should, story-radar). Information firewall (SD-H-04):
 * this module receives only the perceived contacts and the player pose,
 * never the snapshot, so it cannot read live bot positions.
 */
import type { PlayerView, RadarContact } from '../../../contracts';
import { MAX_BLIPS, RADAR_HEARD_MAX_TICKS, RADAR_RANGE_M } from '../model/timing';

export interface RadarBlip {
  id: number;
  /** -1..1, right is positive. */
  x: number;
  /** -1..1, SVG y points down; the player faces up. */
  y: number;
  opacity: number;
  heard: boolean;
  dist: number;
}

export function createRadarBlips(): RadarBlip[] {
  return Array.from({ length: MAX_BLIPS }, () => ({
    id: 0,
    x: 0,
    y: 0,
    opacity: 0,
    heard: false,
    dist: 0,
  }));
}

function copyBlip(from: RadarBlip, to: RadarBlip): void {
  to.id = from.id;
  to.x = from.x;
  to.y = from.y;
  to.opacity = from.opacity;
  to.heard = from.heard;
  to.dist = from.dist;
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Projects contacts into player space, nearest first, into the fixed `out`
 * pool. Returns the number of live blips. Contacts out of range, older than
 * 120 ticks or with non-finite positions are dropped.
 */
export function projectRadar(
  contacts: readonly RadarContact[],
  player: Readonly<Pick<PlayerView, 'pos' | 'yaw'>>,
  out: RadarBlip[],
): number {
  const yaw = finite(player.yaw);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const px = finite(player.pos.x);
  const pz = finite(player.pos.z);
  const cap = Math.min(out.length, MAX_BLIPS);
  let count = 0;

  for (const c of contacts) {
    const age = c.ageTicks;
    if (!Number.isFinite(age) || age > RADAR_HEARD_MAX_TICKS) continue;
    if (!Number.isFinite(c.pos.x) || !Number.isFinite(c.pos.z)) continue;
    const dx = c.pos.x - px;
    const dz = c.pos.z - pz;
    const f = -sin * dx - cos * dz;
    const r = cos * dx - sin * dz;
    const dist = Math.hypot(r, f);
    if (dist > RADAR_RANGE_M) continue;

    // Bounded insertion, nearest first, no sort and no allocation (PD-H-02).
    let at = count;
    while (at > 0 && (out[at - 1]?.dist ?? 0) > dist) at--;
    if (at >= cap) continue;
    const last = count < cap ? count : cap - 1;
    for (let i = last; i > at; i--) {
      const src = out[i - 1];
      const dst = out[i];
      if (src !== undefined && dst !== undefined) copyBlip(src, dst);
    }
    const blip = out[at];
    if (blip === undefined) continue;
    blip.id = c.id;
    blip.x = r / RADAR_RANGE_M;
    blip.y = -f / RADAR_RANGE_M;
    blip.opacity =
      1 - (0.7 * Math.max(0, Math.min(age, RADAR_HEARD_MAX_TICKS))) / RADAR_HEARD_MAX_TICKS;
    blip.heard = c.kind === 'heard';
    blip.dist = dist;
    if (count < cap) count++;
  }
  return count;
}
