import type { Seed } from '../core/types';
import type { SimSnapshot } from './views';

export interface SeamTarget {
  state(): string;
  snapshot(): SimSnapshot | null;
  setSeed(seed: Seed): void;
  fastForward(ticks: number): void;
}
