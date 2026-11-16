/**
 * Type-level guards (SD-H-04 and the HudStats proposal). Checked by
 * `vitest --typecheck` through tsconfig.json.
 */
import { expectTypeOf, test } from 'vitest';
import type { HudStats, ScoreboardBotRow } from '../../../src/ui/hud';

test('scoreboard rows carry no position or AI state', () => {
  expectTypeOf<keyof ScoreboardBotRow>().toEqualTypeOf<'id' | 'alive'>();
});

test('HudStats is exactly the five fields match-stats is asked to provide', () => {
  expectTypeOf<keyof HudStats>().toEqualTypeOf<
    'kills' | 'deaths' | 'headshots' | 'shotsFired' | 'shotsHit'
  >();
});
