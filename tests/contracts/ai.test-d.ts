/**
 * Type-level checks for bot-ai (SD-AI-01, SD-AI-16, BR-AI-50): the contracts
 * AvoidZone stays assignable to nav's PathAvoid, and no brain or locomotion
 * context type carries player data.
 */
import { expectTypeOf, test } from 'vitest';
import type { AvoidZone, BotIntent } from '../../src/contracts';
import type { PathAvoid } from '../../src/nav';
import type { BotAimContext, BotSelf, BrainContext, DifficultyProfile } from '../../src/ai/brain';
import type { LocoContext } from '../../src/ai/locomotion';

type Forbidden = 'player' | 'snapshot' | 'targetPoints' | 'bots' | 'radar';

test('AvoidZone is assignable to PathAvoid and back', () => {
  expectTypeOf<AvoidZone>().toExtend<PathAvoid>();
  expectTypeOf<PathAvoid>().toExtend<AvoidZone>();
  expectTypeOf<BotIntent['avoid']>().toEqualTypeOf<AvoidZone | null>();
});

test('no context type has a player-data field', () => {
  expectTypeOf<Extract<keyof BrainContext, Forbidden>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<keyof BotSelf, Forbidden>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<keyof LocoContext, Forbidden>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<keyof BotAimContext, Forbidden>>().toEqualTypeOf<never>();
});

test('DifficultyProfile has no health or armor field (BR-AI-50)', () => {
  expectTypeOf<
    Extract<keyof DifficultyProfile, 'health' | 'armor' | 'maxHealth'>
  >().toEqualTypeOf<never>();
});
