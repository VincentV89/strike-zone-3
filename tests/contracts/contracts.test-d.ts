import { describe, expectTypeOf, it } from 'vitest';
import type { BotCount, BotView, RoundConfig, SettingsIntent, SimEvent } from '../../src/contracts';
import { BOT_COUNTS } from '../../src/contracts';
import type { EntityId } from '../../src/core';
import type { Vec3 } from '../../src/core';

describe('contracts shapes', () => {
  it('BotCount is exactly the eight selectable counts (BR-F-27)', () => {
    expectTypeOf<BotCount>().toEqualTypeOf<1 | 2 | 3 | 5 | 8 | 10 | 15 | 20>();
    expectTypeOf(BOT_COUNTS).toEqualTypeOf<readonly [1, 2, 3, 5, 8, 10, 15, 20]>();
  });

  it('SimEvent has exactly the seven tags', () => {
    expectTypeOf<SimEvent['t']>().toEqualTypeOf<
      'shot' | 'impact' | 'damage' | 'kill' | 'noise' | 'weapon' | 'phase'
    >();
  });

  it('SettingsIntent pairs each key with its own value type', () => {
    expectTypeOf<{
      type: 'set-setting';
      key: 'graphics';
      value: 'low';
    }>().toExtend<SettingsIntent>();
    expectTypeOf<{
      type: 'set-setting';
      key: 'graphics';
      value: number;
    }>().not.toExtend<SettingsIntent>();
    expectTypeOf<{
      type: 'set-setting';
      key: 'fovDeg';
      value: 'high';
    }>().not.toExtend<SettingsIntent>();
  });

  it('RoundConfig has no optional fields', () => {
    expectTypeOf<Required<RoundConfig>>().toEqualTypeOf<RoundConfig>();
  });

  it('BotView carries no AI state (BR-F-28)', () => {
    expectTypeOf<keyof BotView>().toEqualTypeOf<
      | 'id'
      | 'pos'
      | 'yaw'
      | 'pitch'
      | 'alive'
      | 'deathTick'
      | 'crouch'
      | 'moving'
      | 'lastFireTick'
      | 'weapon'
    >();
    expectTypeOf<BotView['id']>().toEqualTypeOf<EntityId>();
    expectTypeOf<BotView['pos']>().toEqualTypeOf<Vec3>();
  });
});
