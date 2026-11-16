/** Input-command trust boundary (SD-GS-03). */
import { describe, expect, it } from 'vitest';
import type { InputCommand } from '../../src/contracts';
import { createCommand, readCommand } from '../../src/sim/command';
import { cmd } from './helpers';

describe('readCommand', () => {
  it('copies a well-formed command field by field', () => {
    const src = cmd({
      tick: 9,
      move: { x: 1, z: -1 },
      lookDx: 3,
      lookDy: -2,
      jump: true,
      sprint: true,
      crouch: true,
      fire: true,
      firePressed: true,
      scope: true,
      reload: true,
      select: 2,
      cycle: -1,
    });
    const out = readCommand(src, createCommand());
    expect(out).toEqual(src);
    expect(out.move).not.toBe(src.move);
  });

  it('later writes to the caller object do not reach the copy', () => {
    const src = cmd({ fire: true });
    const out = readCommand(src, createCommand());
    src.fire = false;
    src.move.x = 1;
    expect(out.fire).toBe(true);
    expect(out.move.x).toBe(0);
  });

  it('reads off-type booleans as false and bad select/cycle as no switch', () => {
    const hostile = {
      ...cmd(),
      tick: Number.NaN,
      jump: 'yes',
      fire: 1,
      scope: {},
      select: 3,
      cycle: 2,
    } as unknown as InputCommand;
    const out = readCommand(hostile, createCommand());
    expect(out.tick).toBe(0);
    expect(out.jump).toBe(false);
    expect(out.fire).toBe(false);
    expect(out.scope).toBe(false);
    expect(out.select).toBeNull();
    expect(out.cycle).toBe(0);
  });

  it('survives a null command and a missing move object', () => {
    const out = createCommand();
    out.fire = true;
    readCommand(null as unknown as InputCommand, out);
    expect(out.fire).toBe(false);
    expect(out.move).toEqual({ x: 0, z: 0 });
    readCommand({ ...cmd(), move: null } as unknown as InputCommand, out);
    expect(out.move).toEqual({ x: 0, z: 0 });
  });

  it('passes look and move numbers through for stepPlayer to guard', () => {
    const out = readCommand(
      {
        ...cmd(),
        lookDx: Number.POSITIVE_INFINITY,
        move: { x: 5, z: Number.NaN },
      } as unknown as InputCommand,
      createCommand(),
    );
    expect(out.lookDx).toBe(Number.POSITIVE_INFINITY);
    expect(out.move.x).toBe(5);
    expect(out.move.z).toBeNaN();
  });
});
