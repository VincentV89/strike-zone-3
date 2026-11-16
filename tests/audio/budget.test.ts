import { describe, expect, it } from 'vitest';
import { MAX_LIVE_VOICES, VoiceBudget, type BudgetVoice } from '../../src/audio/budget';
import type { CueId } from '../../src/audio/types';

function voice(budget: VoiceBudget, cue: CueId, endsAt = 1): BudgetVoice {
  const v: BudgetVoice = {
    cue,
    endsAt,
    released: false,
    release() {
      if (v.released) return;
      v.released = true;
      budget.remove(v);
    },
  };
  return v;
}

function admit(b: VoiceBudget, cue: CueId, source: number, tick: number, endsAt = 1): boolean {
  if (!b.canAdmit(cue, source, tick)) return false;
  b.add(voice(b, cue, endsAt), source, tick);
  return true;
}

describe('VoiceBudget (BR-AU-50..55)', () => {
  it('caps a cue at its maxConcurrent and drops the rest', () => {
    const b = new VoiceBudget();
    b.beginCall();
    expect([1, 2, 3].map((t) => admit(b, 'fire-rifle', 0, t))).toEqual([true, true, false]);
  });

  it('shares one cap across the bot-fire group', () => {
    const b = new VoiceBudget();
    b.beginCall();
    const cues: CueId[] = ['bot-fire-rifle', 'bot-fire-pistol', 'bot-fire-sniper'];
    const results = Array.from({ length: 8 }, (_, i) =>
      admit(b, cues[i % 3] ?? 'bot-fire-rifle', i + 1, 1),
    );
    expect(results.filter(Boolean)).toHaveLength(6);
    expect(b.liveIn('bot-fire')).toBe(6);
  });

  it('never exceeds 24 live voices', () => {
    const b = new VoiceBudget();
    const cues: CueId[] = ['bot-fire-rifle', 'bot-step', 'hit', 'step', 'land', 'hurt', 'switch'];
    let started = 0;
    for (let call = 0; call < 10; call++) {
      b.beginCall();
      for (const c of cues) for (let s = 0; s < 6; s++) if (admit(b, c, s, call)) started++;
    }
    expect(b.live).toBeLessThanOrEqual(MAX_LIVE_VOICES);
    expect(started).toBe(b.live);
  });

  it('de-duplicates (cue, source, tick) within one call only', () => {
    const b = new VoiceBudget();
    b.beginCall();
    expect(admit(b, 'hit', 2, 5)).toBe(true);
    expect(admit(b, 'hit', 2, 5)).toBe(false);
    expect(admit(b, 'hit', 3, 5)).toBe(true);
    b.beginCall();
    expect(admit(b, 'hit', 2, 5)).toBe(true);
  });

  it('sweeps ended voices and frees their cap', () => {
    const b = new VoiceBudget();
    b.beginCall();
    admit(b, 'fire-rifle', 0, 1, 0.1);
    admit(b, 'fire-rifle', 0, 2, 0.5);
    b.sweep(0.2);
    expect(b.live).toBe(1);
    b.beginCall();
    expect(admit(b, 'fire-rifle', 0, 3)).toBe(true);
    b.clear();
    expect(b.live).toBe(0);
    expect(b.liveIn('fire-rifle')).toBe(0);
  });

  it('ignores removal of an unknown voice', () => {
    const b = new VoiceBudget();
    b.remove(voice(b, 'hit'));
    expect(b.live).toBe(0);
  });
});
