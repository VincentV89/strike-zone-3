import { expectTypeOf, test } from 'vitest';
import type { AudioEngine, AudioListenerPose } from '../../src/audio';

test('play() takes events and a two-field pose only (SD-AU-03)', () => {
  type Pose = Parameters<AudioEngine['play']>[1];
  expectTypeOf<keyof Pose>().toEqualTypeOf<'pos' | 'yaw'>();
  expectTypeOf<Pose>().toEqualTypeOf<AudioListenerPose>();
});
