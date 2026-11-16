/**
 * Input-command trust boundary (SD-GS-03). Each step copies the adapter's
 * command into a sim-owned scratch object, so later writes to the caller's
 * object have no effect. look/move numbers are copied as-is: stepPlayer
 * guards them itself.
 */
import type { InputCommand } from '../contracts';

export function createCommand(): InputCommand {
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
  };
}

const isTrue = (x: unknown): boolean => x === true;

/** Copies `cmd` into `out`. Off-type booleans read as false; bad select/cycle read as no switch. */
export function readCommand(cmd: InputCommand, out: InputCommand): InputCommand {
  const c = cmd as unknown as Partial<Record<keyof InputCommand, unknown>> | null;
  if (typeof c !== 'object' || c === null) {
    out.move.x = 0;
    out.move.z = 0;
    out.lookDx = 0;
    out.lookDy = 0;
    out.jump = out.sprint = out.crouch = false;
    out.fire = out.firePressed = out.scope = out.reload = false;
    out.select = null;
    out.cycle = 0;
    return out;
  }
  const tick = c.tick;
  out.tick = typeof tick === 'number' && Number.isFinite(tick) ? tick : 0;
  const m = c.move as { x?: unknown; z?: unknown } | null | undefined;
  const mx = typeof m === 'object' && m !== null ? m.x : 0;
  const mz = typeof m === 'object' && m !== null ? m.z : 0;
  out.move.x = mx as InputCommand['move']['x'];
  out.move.z = mz as InputCommand['move']['z'];
  out.lookDx = c.lookDx as number;
  out.lookDy = c.lookDy as number;
  out.jump = isTrue(c.jump);
  out.sprint = isTrue(c.sprint);
  out.crouch = isTrue(c.crouch);
  out.fire = isTrue(c.fire);
  out.firePressed = isTrue(c.firePressed);
  out.scope = isTrue(c.scope);
  out.reload = isTrue(c.reload);
  const sel = c.select;
  out.select = sel === 0 || sel === 1 || sel === 2 ? sel : null;
  const cyc = c.cycle;
  out.cycle = cyc === 1 || cyc === -1 ? cyc : 0;
  return out;
}
