/**
 * Shared noise buffer fill (BR-AU-61, SD-AU-07). The only reader of
 * getChannelData, and only as a write target: nothing is read back.
 */
import type { Rng } from '../core';
import type { AudioBufferLike } from './context';

export function fillNoise(buffer: AudioBufferLike, rng: Rng): void {
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;
}
