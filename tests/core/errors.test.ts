import { describe, expect, it } from 'vitest';
import {
  assertNever,
  botId,
  err,
  isSeed,
  ok,
  PLAYER_ID,
  StrikeZoneError,
  type Result,
} from '../../src/core';

describe('errors and results', () => {
  it('carries a code and optional detail', () => {
    const e = new StrikeZoneError('core/invalid-seed', 'bad seed', { seed: -1 });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('StrikeZoneError');
    expect(e.code).toBe('core/invalid-seed');
    expect(e.detail).toEqual({ seed: -1 });
    expect(new StrikeZoneError('a/b').message).toBe('a/b');
  });

  it('replaces a code that is not area/kebab-name', () => {
    expect(new StrikeZoneError('Bad Code').code).toBe('core/invalid-error-code');
  });

  it('builds both Result variants', () => {
    const good: Result<number, string> = ok(3);
    const bad: Result<number, string> = err('nope');
    expect(good).toEqual({ ok: true, value: 3 });
    expect(bad).toEqual({ ok: false, error: 'nope' });
  });

  it('assertNever throws core/unreachable', () => {
    expect(() => assertNever('x' as never)).toThrow(
      expect.objectContaining({ code: 'core/unreachable' }),
    );
  });
});

describe('entity ids and seeds', () => {
  it('reserves 0 for the player and accepts positive integer bot ids (BR-F-23)', () => {
    expect(PLAYER_ID).toBe(0);
    expect(botId(1)).toBe(1);
    expect(botId(20)).toBe(20);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects bot id %s', (n) => {
    expect(() => botId(n)).toThrow(expect.objectContaining({ code: 'core/invalid-bot-id' }));
  });

  it('validates seeds', () => {
    expect(isSeed(0)).toBe(true);
    expect(isSeed(0xffffffff)).toBe(true);
    expect(isSeed(2 ** 32)).toBe(false);
    expect(isSeed('1')).toBe(false);
  });
});
