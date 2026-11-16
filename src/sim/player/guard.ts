/**
 * Input guard (SD-PC-05). Runs first in stepPlayer and copies sanitised values
 * into module scratch, so the caller's InputCommand is never written. Each bad
 * value reports `player/bad-input` once and reads as no input.
 */
import type { Diagnostics } from '../../core';
import type { InputCommand } from '../../contracts';

/** Runtime boolean check: off-type values from untrusted callers read as false. */
const isTrue = (x: unknown): boolean => x === true;

export interface SafeInput {
  lookDx: number;
  lookDy: number;
  moveX: number;
  moveZ: number;
  /** False when sensitivity is not finite and > 0: look is skipped. */
  lookOk: boolean;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
}

const BAD_INPUT = 'player/bad-input';

function finiteOr0(v: number, diag: Diagnostics): number {
  if (Number.isFinite(v)) return v;
  diag.warnOnce(BAD_INPUT);
  return 0;
}

function axisOr0(v: number, diag: Diagnostics): number {
  if (Number.isFinite(v) && v >= -1 && v <= 1) return v;
  diag.warnOnce(BAD_INPUT);
  return 0;
}

export function sanitiseInput(
  cmd: InputCommand,
  sensitivity: number,
  diag: Diagnostics,
  out: SafeInput,
): SafeInput {
  out.lookDx = finiteOr0(cmd.lookDx, diag);
  out.lookDy = finiteOr0(cmd.lookDy, diag);
  out.moveX = axisOr0(cmd.move.x, diag);
  out.moveZ = axisOr0(cmd.move.z, diag);
  out.lookOk = Number.isFinite(sensitivity) && sensitivity > 0;
  if (!out.lookOk) diag.warnOnce(BAD_INPUT);
  out.jump = isTrue(cmd.jump);
  out.crouch = isTrue(cmd.crouch);
  out.sprint = isTrue(cmd.sprint);
  return out;
}
