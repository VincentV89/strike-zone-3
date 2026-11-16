/**
 * The Web Audio surface audio uses, and the only file that reads a browser
 * global (SD-AU-04). Keep this file short so review can see every access.
 */

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(target: number, time: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface AudioNodeLike {
  connect(target: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

/** `ev: never` lets a real DOM handler type and a zero-argument handler both fit. */
export interface SourceNodeLike extends AudioNodeLike {
  onended: ((this: never, ev: never) => unknown) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export interface OscillatorNodeLike extends SourceNodeLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
}

export interface AudioBufferLike {
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceNodeLike extends SourceNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
}

export interface BiquadNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}

export interface CompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
}

/** Structural subset of AudioContext. Tests pass a recording fake. */
export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  onstatechange: ((this: never, ev: never) => unknown) | null;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBufferSource(): BufferSourceNodeLike;
  createBiquadFilter(): BiquadNodeLike;
  createStereoPanner(): StereoPannerNodeLike;
  createDynamicsCompressor(): CompressorNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
}

/** What synth.ts may use: node factories, never the destination (SD-AU-01). */
export type VoiceFactory = Pick<
  AudioContextLike,
  | 'createGain'
  | 'createOscillator'
  | 'createBufferSource'
  | 'createBiquadFilter'
  | 'createStereoPanner'
>;

export function isWebAudioSupported(): boolean {
  return 'AudioContext' in globalThis;
}

/** Creates the page's AudioContext, or null. Call only inside a user gesture. */
export function defaultContextFactory(): AudioContextLike | null {
  if (!isWebAudioSupported()) return null;
  try {
    return new globalThis.AudioContext({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}
