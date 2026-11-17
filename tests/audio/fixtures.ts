/** Event builders and a recording Diagnostics for audio tests. */
import { createDiagnostics, vec3, type Diagnostics, type EntityId } from '../../src/core';
import type { SimEvent, WeaponId } from '../../src/contracts';

export const id = (n: number): EntityId => n as EntityId;

export function shot(shooter: number, weapon: WeaponId, x = 0, y = 1.6, z = 0, tick = 1): SimEvent {
  return {
    t: 'shot',
    tick,
    shooter: id(shooter),
    weapon,
    origin: vec3(x, y, z),
    end: vec3(x, y, z - 10),
    hit: null,
    headshot: false,
  };
}

export function damage(
  target: number,
  source: number,
  headshot = false,
  fromDir = vec3(1, 0, 0),
  tick = 1,
): SimEvent {
  return {
    t: 'damage',
    tick,
    target: id(target),
    source: id(source),
    amount: 10,
    armorLoss: 0,
    fromDir,
    headshot,
  };
}

export function kill(victim: number, killer: number, tick = 1): SimEvent {
  return {
    t: 'kill',
    tick,
    victim: id(victim),
    killer: id(killer),
    weapon: 'rifle',
    headshot: false,
  };
}

export function noise(
  source: number,
  kind: 'gunfire' | 'footstep' | 'land',
  x = 0,
  z = 0,
  radius = 12,
  tick = 1,
): SimEvent {
  return { t: 'noise', tick, source: id(source), kind, pos: vec3(x, 0, z), radius };
}

export function weapon(
  actor: number,
  kind: 'reload-start' | 'reload-end' | 'switch' | 'dry-fire' | 'scope-in' | 'scope-out',
  tick = 1,
): SimEvent {
  return { t: 'weapon', tick, actor: id(actor), kind };
}

export function phase(
  p: 'countdown' | 'live' | 'ended',
  outcome: 'victory' | 'defeat' | 'time-expired' | null = null,
  tick = 1,
): SimEvent {
  return { t: 'phase', tick, phase: p, outcome };
}

export function impact(tick = 1): SimEvent {
  return { t: 'impact', tick, point: vec3(), normal: vec3(0, 1, 0) };
}

export interface RecordingDiagnostics extends Diagnostics {
  readonly warned: string[];
}

export function recordingDiagnostics(): RecordingDiagnostics {
  const warned: string[] = [];
  const d = createDiagnostics((code) => {
    warned.push(code);
  });
  return Object.assign(d, { warned });
}

export const POSE = { pos: vec3(0, 1.6, 0), yaw: 0 };
