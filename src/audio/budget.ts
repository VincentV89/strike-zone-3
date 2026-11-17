/**
 * Voice budget (BR-AU-50..55). Over-cap requests are dropped, never stolen
 * from a running voice. Allocates nothing on the admission path.
 */
import { capGroup, RECIPES } from './recipes';
import type { CueId } from './types';

export const MAX_LIVE_VOICES = 24;
export const MAX_NEW_PER_CALL = 12;

/** A live voice as the budget sees it. `release` runs once, on end or sweep. */
export interface BudgetVoice {
  readonly cue: CueId;
  readonly endsAt: number;
  released: boolean;
  release(): void;
}

export class VoiceBudget {
  private readonly voices: BudgetVoice[] = [];
  private readonly perGroup = new Map<string, number>();
  private callCount = 0;
  private readonly callCues: CueId[] = [];
  private readonly callSources: number[] = [];
  private readonly callTicks: number[] = [];

  get live(): number {
    return this.voices.length;
  }

  liveIn(group: string): number {
    return this.perGroup.get(group) ?? 0;
  }

  /** Starts a new play() or ui() call: clears the de-duplication keys. */
  beginCall(): void {
    this.callCount = 0;
  }

  /** True when a voice for (cue, source, tick) may start now. Does not record it. */
  canAdmit(cue: CueId, source: number, tick: number): boolean {
    if (this.voices.length >= MAX_LIVE_VOICES) return false;
    if (this.liveIn(capGroup(cue)) >= RECIPES[cue].maxConcurrent) return false;
    for (let i = 0; i < this.callCount; i++) {
      if (this.callCues[i] === cue && this.callSources[i] === source && this.callTicks[i] === tick)
        return false;
    }
    return true;
  }

  /** Records a started voice and its de-duplication key. */
  add(voice: BudgetVoice, source: number, tick: number): void {
    this.voices.push(voice);
    const g = capGroup(voice.cue);
    this.perGroup.set(g, this.liveIn(g) + 1);
    const i = this.callCount++;
    this.callCues[i] = voice.cue;
    this.callSources[i] = source;
    this.callTicks[i] = tick;
  }

  /** Removes a voice (from its `ended` event). Idempotent. */
  remove(voice: BudgetVoice): void {
    const i = this.voices.indexOf(voice);
    if (i < 0) return;
    const last = this.voices.pop();
    if (last !== undefined && last !== voice) this.voices[i] = last;
    const g = capGroup(voice.cue);
    this.perGroup.set(g, Math.max(0, this.liveIn(g) - 1));
  }

  /** Releases voices whose `endsAt` has passed (safety net, BR-AU-55). */
  sweep(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v !== undefined && v.endsAt <= now) v.release();
    }
  }

  /** Releases every voice (dispose). */
  clear(): void {
    for (let i = this.voices.length - 1; i >= 0; i--) this.voices[i]?.release();
    this.voices.length = 0;
    this.perGroup.clear();
  }
}
