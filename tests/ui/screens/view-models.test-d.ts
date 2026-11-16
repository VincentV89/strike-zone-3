import { expectTypeOf, test } from 'vitest';
import type { StorageStatus } from '../../../src/persistence';
import type { StorageStatusView } from '../../../src/ui/screens';
import type { SettingsRepo } from '../../../src/persistence';
import type { SettingsStoreRepo } from '../../../src/settings';
import type { UiIntent } from '../../../src/contracts';

test('StorageStatusView mirrors persistence StorageStatus', () => {
  expectTypeOf<StorageStatusView>().toEqualTypeOf<StorageStatus>();
});

test('a SettingsRepo satisfies the store repo port', () => {
  expectTypeOf<SettingsRepo>().toExtend<SettingsStoreRepo>();
});

test('UiIntent gained clear-history additively (FD-MS-08)', () => {
  expectTypeOf<{ type: 'clear-history' }>().toExtend<UiIntent>();
  expectTypeOf<{ type: 'main-menu' }>().toExtend<UiIntent>();
});
