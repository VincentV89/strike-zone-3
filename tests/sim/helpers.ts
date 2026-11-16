/**
 * Shared test helpers for the player-combat unit (TS-PC-08): recording and
 * strict Diagnostics, a copying emit sink, and builders for InputCommand,
 * AimContext and triggers.
 */
import {
  createDiagnostics,
  vec3,
  type Diagnostics,
  type EntityId,
  type Vec3,
} from '../../src/core';
import type { InputCommand, SimEvent } from '../../src/contracts';
import type { AimContext, WeaponTrigger } from '../../src/weapons';

export interface RecordingDiag extends Diagnostics {
  readonly codes: string[];
}

/** Records every first-time code. */
export function recordingDiag(): RecordingDiag {
  const codes: string[] = [];
  const d = createDiagnostics((code) => {
    codes.push(code);
  });
  return Object.assign(d, { codes });
}

/** Fails the test (throws) on any code: normal-input tests must report nothing. */
export function strictDiag(): Diagnostics {
  return createDiagnostics((code) => {
    throw new Error(`unexpected diagnostic ${code}`);
  });
}

/** Emit sink that deep-copies each event, as game-simulation's writer must (SD-PC-10). */
export function copyingSink(): { events: SimEvent[]; emit: (e: SimEvent) => void } {
  const events: SimEvent[] = [];
  return { events, emit: (e) => events.push(structuredClone(e)) };
}

export function cmd(over: Partial<InputCommand> = {}): InputCommand {
  return {
    tick: 0,
    move: { x: 0, z: 0 },
    lookDx: 0,
    lookDy: 0,
    jump: false,
    sprint: false,
    crouch: false,
    fire: false,
    firePressed: false,
    scope: false,
    reload: false,
    select: null,
    cycle: 0,
    ...over,
  };
}

export function aim(over: Partial<AimContext> = {}): AimContext {
  return {
    origin: vec3(0, 1.6, 0),
    yaw: 0,
    pitch: 0,
    moving: false,
    grounded: true,
    crouched: false,
    ...over,
  };
}

export function trig(over: Partial<WeaponTrigger> = {}): WeaponTrigger {
  return {
    fire: false,
    firePressed: false,
    reload: false,
    scope: false,
    select: null,
    cycle: 0,
    ...over,
  };
}

export const id = (n: number): EntityId => n as EntityId;

export function v3(x: number, y: number, z: number): Vec3 {
  return vec3(x, y, z);
}

/** Every nested object of `value` (including itself). */
export function allObjects(value: object): object[] {
  const out: object[] = [value];
  for (const child of Object.values(value) as unknown[]) {
    if (typeof child === 'object' && child !== null) out.push(...allObjects(child));
  }
  return out;
}
