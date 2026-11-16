/**
 * Synthesis recipes (BR-AU-60..65, SD-AU-02). Pure, deep-frozen data.
 *
 * Budgets checked by tests/audio/recipes.test.ts over the whole table:
 * - peak = gain × Σ layer.gain ≤ 0.5
 * - nodes per voice ≤ 6: 2 per layer + 1 per layer filter + the voice gain,
 *   plus a lowpass and a panner for positional cues, or a panner for
 *   directional ones. That budget is why positional bot cues use one layer
 *   and arpeggios step the frequency of a single oscillator.
 * - every envelope ends (delay + attack + decay + 0.01) within `duration`.
 *
 * Values are starting points to tune by ear; the structure is fixed.
 */
import type { CueId, Layer, Recipe, SpatialProfile } from './types';

const BOT_FIRE: SpatialProfile = { refDist: 3, maxDist: 90 };
/** maxDist is overridden per event with min(radius × 1.25, 25) (BR-AU-43). */
const BOT_STEP: SpatialProfile = { refDist: 2, maxDist: 25 };
const BOT_GAIN_FACTOR = 0.8;

type Base = Omit<Recipe, 'group' | 'maxConcurrent' | 'jitter' | 'placement' | 'spatial'> &
  Partial<Recipe>;

function centred(base: Base): Recipe {
  return {
    group: '',
    maxConcurrent: 2,
    jitter: 0,
    placement: 'centred',
    spatial: null,
    ...base,
  };
}

const FIRE_RIFLE_CRACK: Layer = {
  source: 'noise',
  filter: { type: 'bandpass', freq: 1800, q: 0.9 },
  gain: 0.9,
  attack: 0.001,
  decay: 0.06,
};
const FIRE_PISTOL_CRACK: Layer = {
  source: 'noise',
  filter: { type: 'highpass', freq: 2500, q: 0.7 },
  gain: 0.8,
  attack: 0.001,
  decay: 0.04,
};
const FIRE_SNIPER_CRACK: Layer = {
  source: 'noise',
  filter: { type: 'lowpass', freq: 3000, q: 0.7 },
  gain: 1,
  attack: 0.002,
  decay: 0.45,
};

const fire = {
  rifle: centred({
    layers: [
      FIRE_RIFLE_CRACK,
      { source: 'sine', freq: 110, freqEnd: 55, gain: 0.8, attack: 0.002, decay: 0.09 },
    ],
    gain: 0.28,
    duration: 0.15,
    priority: 1,
    jitter: 0.04,
  }),
  pistol: centred({
    layers: [
      FIRE_PISTOL_CRACK,
      { source: 'square', freq: 220, freqEnd: 110, gain: 0.35, attack: 0.001, decay: 0.05 },
    ],
    gain: 0.3,
    duration: 0.1,
    priority: 1,
    jitter: 0.04,
  }),
  sniper: centred({
    layers: [
      FIRE_SNIPER_CRACK,
      { source: 'sine', freq: 80, freqEnd: 40, gain: 0.9, attack: 0.003, decay: 0.3 },
    ],
    gain: 0.26,
    duration: 0.6,
    priority: 1,
    jitter: 0.02,
  }),
};

/** Bot fire: the player's crack layer at 0.8× gain, placed in the world (BR-AU-64). */
function botFire(crack: Layer, player: Recipe): Recipe {
  return {
    layers: [crack],
    gain:
      (player.gain * BOT_GAIN_FACTOR * (crack.gain + (player.layers[1]?.gain ?? 0))) / crack.gain,
    duration: player.duration,
    priority: 2,
    group: 'bot-fire',
    maxConcurrent: 6,
    jitter: player.jitter,
    placement: 'positional',
    spatial: BOT_FIRE,
  };
}

const click = (freq: number, gain: number, delay = 0): Layer => ({
  source: 'square',
  freq,
  gain,
  attack: 0.001,
  decay: 0.015,
  delay,
});

const DRAFT: Record<CueId, Recipe> = {
  'fire-rifle': fire.rifle,
  'fire-pistol': fire.pistol,
  'fire-sniper': fire.sniper,
  'reload-start': centred({
    layers: [
      { source: 'triangle', freq: 1200, gain: 0.6, attack: 0.001, decay: 0.03 },
      { source: 'triangle', freq: 1200, gain: 0.6, attack: 0.001, decay: 0.03, delay: 0.03 },
    ],
    gain: 0.3,
    duration: 0.12,
    priority: 1,
    jitter: 0.03,
  }),
  'reload-end': centred({
    layers: [
      { source: 'triangle', freq: 900, gain: 0.6, attack: 0.001, decay: 0.03 },
      { source: 'triangle', freq: 900, gain: 0.6, attack: 0.001, decay: 0.03, delay: 0.03 },
    ],
    gain: 0.3,
    duration: 0.12,
    priority: 1,
    jitter: 0.03,
  }),
  switch: centred({
    layers: [click(1500, 0.6)],
    gain: 0.3,
    duration: 0.05,
    priority: 1,
  }),
  'dry-fire': centred({
    layers: [click(2200, 0.6)],
    gain: 0.3,
    duration: 0.05,
    priority: 1,
  }),
  'scope-in': centred({
    layers: [{ source: 'sine', freq: 600, freqEnd: 900, gain: 0.5, attack: 0.005, decay: 0.08 }],
    gain: 0.4,
    duration: 0.1,
    priority: 1,
  }),
  'scope-out': centred({
    layers: [{ source: 'sine', freq: 900, freqEnd: 600, gain: 0.5, attack: 0.005, decay: 0.08 }],
    gain: 0.4,
    duration: 0.1,
    priority: 1,
  }),
  'bot-fire-rifle': botFire(FIRE_RIFLE_CRACK, fire.rifle),
  'bot-fire-pistol': botFire(FIRE_PISTOL_CRACK, fire.pistol),
  'bot-fire-sniper': botFire(FIRE_SNIPER_CRACK, fire.sniper),
  'bot-step': {
    layers: [
      {
        source: 'noise',
        filter: { type: 'lowpass', freq: 400, q: 0.7 },
        gain: 0.8,
        attack: 0.003,
        decay: 0.035,
      },
    ],
    gain: 0.4,
    duration: 0.06,
    priority: 3,
    group: 'bot-step',
    maxConcurrent: 6,
    jitter: 0.05,
    placement: 'positional',
    spatial: BOT_STEP,
  },
  step: centred({
    layers: [
      {
        source: 'noise',
        filter: { type: 'lowpass', freq: 400, q: 0.7 },
        gain: 0.8,
        attack: 0.003,
        decay: 0.035,
      },
    ],
    gain: 0.25,
    duration: 0.06,
    priority: 2,
    jitter: 0.05,
  }),
  land: centred({
    layers: [
      {
        source: 'noise',
        filter: { type: 'lowpass', freq: 250, q: 0.7 },
        gain: 0.8,
        attack: 0.003,
        decay: 0.09,
      },
      { source: 'sine', freq: 60, gain: 0.7, attack: 0.003, decay: 0.08 },
    ],
    gain: 0.3,
    duration: 0.12,
    priority: 2,
    jitter: 0.03,
  }),
  hurt: centred({
    layers: [
      { source: 'sine', freq: 180, freqEnd: 90, gain: 0.8, attack: 0.004, decay: 0.15 },
      { source: 'triangle', freq: 120, freqEnd: 70, gain: 0.5, attack: 0.004, decay: 0.08 },
    ],
    gain: 0.35,
    duration: 0.2,
    priority: 1,
    jitter: 0.03,
    placement: 'directional',
  }),
  hit: centred({
    layers: [{ source: 'sine', freq: 1600, gain: 0.7, attack: 0.002, decay: 0.04 }],
    gain: 0.4,
    duration: 0.08,
    priority: 1,
    group: 'hit',
    maxConcurrent: 3,
  }),
  headshot: centred({
    layers: [
      { source: 'sine', freq: 2400, gain: 0.6, attack: 0.002, decay: 0.07 },
      { source: 'sine', freq: 3200, gain: 0.5, attack: 0.002, decay: 0.07 },
    ],
    gain: 0.35,
    duration: 0.09,
    priority: 1,
    group: 'hit',
    maxConcurrent: 3,
  }),
  'enemy-down': centred({
    layers: [
      { source: 'triangle', freq: 440, freqEnd: 220, gain: 0.7, attack: 0.005, decay: 0.25 },
    ],
    gain: 0.45,
    duration: 0.3,
    priority: 1,
  }),
  'round-go': centred({
    layers: [{ source: 'square', freq: 880, gain: 0.5, attack: 0.005, decay: 0.12 }],
    gain: 0.3,
    duration: 0.15,
    priority: 0,
    maxConcurrent: 1,
  }),
  victory: centred({
    layers: [
      {
        source: 'triangle',
        freq: 523,
        steps: [523, 659, 784, 1047],
        stepDur: 0.15,
        gain: 0.8,
        attack: 0.01,
        decay: 1.1,
      },
    ],
    gain: 0.5,
    duration: 1.2,
    priority: 0,
    maxConcurrent: 1,
  }),
  defeat: centred({
    layers: [
      {
        source: 'sawtooth',
        freq: 392,
        freqEnd: 196,
        filter: { type: 'lowpass', freq: 1000, q: 0.7 },
        gain: 0.8,
        attack: 0.01,
        decay: 0.8,
      },
    ],
    gain: 0.5,
    duration: 1,
    priority: 0,
    maxConcurrent: 1,
  }),
  'time-up': centred({
    layers: [
      {
        source: 'square',
        freq: 660,
        steps: [660, 440],
        stepDur: 0.3,
        gain: 0.5,
        attack: 0.005,
        decay: 0.8,
      },
    ],
    gain: 0.4,
    duration: 1,
    priority: 0,
    maxConcurrent: 1,
  }),
  'ui-confirm': centred({
    layers: [{ source: 'sine', freq: 880, gain: 0.6, attack: 0.003, decay: 0.05 }],
    gain: 0.4,
    duration: 0.08,
    priority: 0,
    group: 'ui',
  }),
  'ui-back': centred({
    layers: [{ source: 'sine', freq: 520, gain: 0.6, attack: 0.003, decay: 0.05 }],
    gain: 0.4,
    duration: 0.08,
    priority: 0,
    group: 'ui',
  }),
  'ui-tick': centred({
    layers: [{ source: 'sine', freq: 1200, gain: 0.5, attack: 0.002, decay: 0.015 }],
    gain: 0.4,
    duration: 0.04,
    priority: 0,
    group: 'ui',
  }),
  'ui-error': centred({
    layers: [{ source: 'square', freq: 200, gain: 0.5, attack: 0.003, decay: 0.12 }],
    gain: 0.3,
    duration: 0.15,
    priority: 0,
    group: 'ui',
  }),
};

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value) as unknown[]) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Every recipe, keyed by CueId. A recipe's empty group means "its own CueId". */
export const RECIPES: Readonly<Record<CueId, Recipe>> = deepFreeze(DRAFT);

/** All CueIds, in table order. */
export const CUE_IDS = Object.freeze(Object.keys(DRAFT) as CueId[]);

/** Cap group of a cue (BR-AU-51). */
export function capGroup(cue: CueId): string {
  const g = RECIPES[cue].group;
  return g === '' ? cue : g;
}
