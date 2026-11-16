/**
 * Voice synthesis (business-logic-model-audio "Voice Synthesis"). Builds one
 * node graph per voice from a recipe and connects it to the sfx bus. It gets a
 * VoiceFactory, which has no destination, so a voice cannot skip the buses.
 */
import type { Rng } from '../core';
import type { BudgetVoice } from './budget';
import type {
  AudioBufferLike,
  AudioNodeLike,
  OscillatorNodeLike,
  SourceNodeLike,
  VoiceFactory,
} from './context';
import { RECIPES } from './recipes';
import { NO_FILTER_HZ, type CueId, type Layer, type SpatialResult } from './types';

const FLOOR = 0.0001;
const STOP_PAD = 0.01;
const NOISE_OFFSET_SPAN = 0.9;

export interface SynthTarget {
  readonly factory: VoiceFactory;
  /** The sfx bus. */
  readonly output: AudioNodeLike;
  readonly noise: AudioBufferLike;
  readonly jitter: Rng;
}

class Voice implements BudgetVoice {
  released = false;
  private pending: number;

  constructor(
    readonly cue: CueId,
    readonly endsAt: number,
    private readonly nodes: AudioNodeLike[],
    sources: number,
    private readonly onRelease: (v: Voice) => void,
  ) {
    this.pending = sources;
  }

  sourceEnded(): void {
    this.pending--;
    if (this.pending <= 0) this.release();
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    disconnectAll(this.nodes);
    this.onRelease(this);
  }
}

function disconnectAll(nodes: readonly AudioNodeLike[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      // A node that cannot disconnect is already detached from a closed context.
    }
  }
}

function makeSource(
  t: SynthTarget,
  layer: Layer,
  pitch: number,
  t0: number,
  nodes: AudioNodeLike[],
): SourceNodeLike {
  if (layer.source === 'noise') {
    const src = t.factory.createBufferSource();
    nodes.push(src);
    src.buffer = t.noise;
    src.loop = true;
    return src;
  }
  const osc: OscillatorNodeLike = t.factory.createOscillator();
  nodes.push(osc);
  osc.type = layer.source;
  const f0 = (layer.freq ?? 440) * pitch;
  osc.frequency.setValueAtTime(f0, t0);
  if (layer.steps !== undefined) {
    const dur = layer.stepDur ?? 0.1;
    layer.steps.forEach((f, i) => osc.frequency.setValueAtTime(f * pitch, t0 + i * dur));
  } else if (layer.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      layer.freqEnd * pitch,
      t0 + layer.attack + layer.decay,
    );
  }
  return osc;
}

/**
 * Schedules `cue` at `now` and returns its voice. `spatial` is null for
 * centred cues. Throws only when a node factory throws; partial nodes are
 * disconnected first and the engine reports audio/voice-fault.
 */
export function startVoice(
  t: SynthTarget,
  cue: CueId,
  spatial: SpatialResult | null,
  now: number,
  onRelease: (v: BudgetVoice) => void,
): BudgetVoice {
  const rec = RECIPES[cue];
  const nodes: AudioNodeLike[] = [];
  const sources: SourceNodeLike[] = [];
  try {
    const out = t.factory.createGain();
    nodes.push(out);
    out.gain.value = rec.gain * (spatial?.gain ?? 1);
    let tail: AudioNodeLike = out;
    if (spatial !== null && spatial.lowpassHz < NO_FILTER_HZ) {
      const lp = t.factory.createBiquadFilter();
      nodes.push(lp);
      lp.type = 'lowpass';
      lp.frequency.value = spatial.lowpassHz;
      tail.connect(lp);
      tail = lp;
    }
    if (spatial !== null) {
      const p = t.factory.createStereoPanner();
      nodes.push(p);
      p.pan.value = spatial.pan;
      tail.connect(p);
      tail = p;
    }
    tail.connect(t.output);

    const pitch = rec.jitter > 0 ? 1 + rec.jitter * (2 * t.jitter.next() - 1) : 1;
    const hardStop = now + rec.duration;
    for (const layer of rec.layers) {
      const t0 = now + (layer.delay ?? 0);
      const end = t0 + layer.attack + layer.decay;
      const src = makeSource(t, layer, pitch, t0, nodes);
      let head: AudioNodeLike = src;
      if (layer.filter !== undefined) {
        const f = t.factory.createBiquadFilter();
        nodes.push(f);
        f.type = layer.filter.type;
        f.frequency.value = layer.filter.freq;
        f.Q.value = layer.filter.q;
        head.connect(f);
        head = f;
      }
      const env = t.factory.createGain();
      nodes.push(env);
      env.gain.setValueAtTime(FLOOR, t0);
      env.gain.exponentialRampToValueAtTime(layer.gain, t0 + layer.attack);
      env.gain.exponentialRampToValueAtTime(FLOOR, end);
      env.gain.setValueAtTime(0, end);
      head.connect(env);
      env.connect(out);
      if (layer.source === 'noise') src.start(t0, t.jitter.next() * NOISE_OFFSET_SPAN);
      else src.start(t0);
      src.stop(Math.min(end + STOP_PAD, hardStop));
      sources.push(src);
    }
  } catch (e) {
    disconnectAll(nodes);
    throw e;
  }
  const voice = new Voice(cue, now + rec.duration, nodes, sources.length, onRelease);
  for (const s of sources) {
    s.onended = () => {
      voice.sourceEnded();
    };
  }
  return voice;
}
