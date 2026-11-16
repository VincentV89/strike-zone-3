/**
 * Audio value types (domain-entities-audio). Nothing here touches Web Audio.
 */
import type { Vec3 } from '../core';

/** UI sounds app-shell asks for (FD-AU-Q2). Declared here, not in contracts. */
export type UiCue = 'confirm' | 'back' | 'tick' | 'error';

/** The closed set of synthesised sounds. */
export type CueId =
  | 'fire-rifle'
  | 'fire-pistol'
  | 'fire-sniper'
  | 'reload-start'
  | 'reload-end'
  | 'switch'
  | 'dry-fire'
  | 'scope-in'
  | 'scope-out'
  | 'bot-fire-rifle'
  | 'bot-fire-pistol'
  | 'bot-fire-sniper'
  | 'bot-step'
  | 'step'
  | 'land'
  | 'hurt'
  | 'hit'
  | 'headshot'
  | 'enemy-down'
  | 'round-go'
  | 'victory'
  | 'defeat'
  | 'time-up'
  | 'ui-confirm'
  | 'ui-back'
  | 'ui-tick'
  | 'ui-error';

/**
 * The only listener data audio receives (SD-AU-03): a position and a yaw.
 * Never the snapshot, bots or radar, so audio cannot reveal hidden state.
 */
export interface AudioListenerPose {
  readonly pos: Vec3;
  readonly yaw: number;
}

/** How a cue is placed: on the listener, at a world position, or panned from a direction. */
export type Placement = 'centred' | 'positional' | 'directional';

export type LayerSource = 'sine' | 'square' | 'triangle' | 'sawtooth' | 'noise';

export interface LayerFilter {
  readonly type: 'lowpass' | 'highpass' | 'bandpass';
  readonly freq: number;
  readonly q: number;
}

export interface Layer {
  readonly source: LayerSource;
  /** Start frequency in Hz (oscillators only). */
  readonly freq?: number;
  /** Exponential sweep target in Hz, reached at the end of the decay. */
  readonly freqEnd?: number;
  /** Frequency steps (an arpeggio on one oscillator), each lasting `stepDur`. */
  readonly steps?: readonly number[];
  readonly stepDur?: number;
  readonly filter?: LayerFilter;
  /** Peak envelope gain of this layer. */
  readonly gain: number;
  readonly attack: number;
  readonly decay: number;
  readonly delay?: number;
}

export interface SpatialProfile {
  readonly refDist: number;
  readonly maxDist: number;
}

export interface Recipe {
  readonly layers: readonly Layer[];
  /** Voice gain applied on top of the layer gains. */
  readonly gain: number;
  /** Hard stop in seconds. */
  readonly duration: number;
  /** 0 wins (UI and round), 3 loses (bot footsteps). */
  readonly priority: 0 | 1 | 2 | 3;
  /** Cap group: cues in one group share `maxConcurrent` (BR-AU-51). */
  readonly group: string;
  readonly maxConcurrent: number;
  /** Pitch variation fraction, 0..0.05. */
  readonly jitter: number;
  readonly placement: Placement;
  /** Set only for positional cues. */
  readonly spatial: SpatialProfile | null;
}

export interface SpatialResult {
  pan: number;
  gain: number;
  lowpassHz: number;
}

/**
 * A mapped sound before it touches Web Audio. Pool entries are reused
 * every call, so no field may be kept after `play()` returns.
 */
export interface VoiceRequest {
  cue: CueId;
  /** EntityId of the source, or -1 for UI and round cues. */
  source: number;
  /** SimEvent tick, or -1 for UI cues. */
  tick: number;
  placement: Placement;
  /** World position (positional) or direction (directional). */
  x: number;
  y: number;
  z: number;
  /** Cull distance override for bot footsteps, else NaN. */
  maxDist: number;
  /** Filled by the engine. */
  readonly spatial: SpatialResult;
  hasSpatial: boolean;
  skip: boolean;
  dist: number;
}

/** Lowpass frequency that means "no filter" (BR-AU-42). */
export const NO_FILTER_HZ = 22000;
