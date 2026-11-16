/**
 * AudioEngine: the audio unit's aggregate root (domain-entities-audio).
 *
 * - No AudioContext exists before `unlock()`, which app-shell calls from a
 *   user gesture; the context is built before the first await (BR-AU-01/02).
 * - One context per engine, ever (SD-AU-05).
 * - Every sound goes voice -> sfx -> master -> limiter -> destination, and
 *   buildGraph is the only reader of the destination (SD-AU-01).
 * - Public calls never throw (BR-AU-70); faults go to Diagnostics with no detail.
 */
import {
  createRng,
  err,
  ok,
  StrikeZoneError,
  type Diagnostics,
  type Result,
  type Rng,
} from '../core';
import type { SimEvent } from '../contracts';
import { MAX_NEW_PER_CALL, VoiceBudget, type BudgetVoice } from './budget';
import {
  defaultContextFactory,
  isWebAudioSupported,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioParamLike,
  type GainNodeLike,
} from './context';
import { AUDIO_CODES } from './diagnostics-codes';
import { createRequestPool, mapEvents, uiRecipe } from './mapping';
import { fillNoise } from './noise';
import { RECIPES } from './recipes';
import { panFromDirection, spatialise } from './spatial';
import { startVoice, type SynthTarget } from './synth';
import { NO_FILTER_HZ, type AudioListenerPose, type UiCue, type VoiceRequest } from './types';
import { acceptPercent, curve, GAIN_TIME_CONSTANT } from './volume';

export type UnlockError = 'BLOCKED' | 'UNSUPPORTED';

export interface AudioEngine {
  /** False when the browser has no Web Audio API; app-shell then hides the Audio group. */
  readonly supported: boolean;
  unlock(): Promise<Result<void, UnlockError>>;
  play(events: readonly SimEvent[], listener: AudioListenerPose): void;
  ui(cue: UiCue): void;
  /** Integer percents 0..100, as stored in Settings. */
  setVolumes(masterPct: number, sfxPct: number): void;
  suspend(): void;
  dispose(): void;
}

export interface EngineDeps {
  readonly diagnostics: Diagnostics;
  /** Test seam: defaults to the real AudioContext factory. */
  readonly createContext?: () => AudioContextLike | null;
  /** Seeds noise and pitch jitter. Default 0x5a17, never the simulation seed. */
  readonly seed?: number;
}

export type EngineState =
  'unsupported' | 'locked' | 'unlocking' | 'running' | 'blocked' | 'suspended' | 'disposed';

/** Limiter settings (tech-stack-decisions-audio, SD-AU-01). */
export const LIMITER = Object.freeze({
  threshold: -6,
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.25,
});

const DEFAULT_SEED = 0x5a17;
const DEFAULT_MASTER = 80;
const DEFAULT_SFX = 100;
const TICK_MIN_GAP = 0.06;
const MUTE_SETTLE = 0.12;

interface Graph {
  readonly sfx: GainNodeLike;
  readonly master: GainNodeLike;
  readonly target: SynthTarget;
}

const OK: Result<void, UnlockError> = ok(undefined);
const BLOCKED: Result<void, UnlockError> = err('BLOCKED');
const UNSUPPORTED: Result<void, UnlockError> = err('UNSUPPORTED');

/** The only code that reads ctx.destination (SD-AU-01). */
function buildGraph(ctx: AudioContextLike, noise: AudioBufferLike, jitter: Rng): Graph {
  const sfx = ctx.createGain();
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  sfx.connect(master);
  master.connect(limiter);
  limiter.connect(ctx.destination);
  return { sfx, master, target: { factory: ctx, output: sfx, noise, jitter } };
}

function rampTo(param: AudioParamLike, g: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(g, now, GAIN_TIME_CONSTANT);
  // setTargetAtTime never reaches 0 on its own; pin the mute exactly (BR-AU-21).
  if (g === 0) param.setValueAtTime(0, now + MUTE_SETTLE);
}

export function createAudioEngine(deps: EngineDeps): AudioEngine {
  if ((deps as Partial<EngineDeps> | undefined)?.diagnostics === undefined) {
    throw new StrikeZoneError('audio/missing-diagnostics', 'createAudioEngine needs diagnostics');
  }
  const diagnostics = deps.diagnostics;
  const factory = deps.createContext ?? defaultContextFactory;
  const supported = deps.createContext !== undefined || isWebAudioSupported();
  const root = createRng(deps.seed ?? DEFAULT_SEED).fork('audio');

  let state: EngineState = supported ? 'locked' : 'unsupported';
  let ctx: AudioContextLike | null = null;
  let graph: Graph | null = null;
  let contextCreated = false;
  let pending: Promise<Result<void, UnlockError>> | null = null;
  let masterPct = DEFAULT_MASTER;
  let sfxPct = DEFAULT_SFX;
  let lastTick = Number.NEGATIVE_INFINITY;

  const budget = new VoiceBudget();
  const pool = createRequestPool();
  const order: number[] = [];
  /** Reused profile for bot footsteps, whose cull distance comes from the event. */
  const stepProfile = { refDist: 0, maxDist: 0 };
  const release = (v: BudgetVoice): void => {
    budget.remove(v);
  };

  const fault = (): void => {
    diagnostics.warnOnce(AUDIO_CODES.voiceFault);
  };
  const muted = (): boolean => curve(masterPct) * curve(sfxPct) === 0;

  const onStateChange = (): void => {
    try {
      if (state === 'running' && ctx !== null && ctx.state !== 'running') state = 'suspended';
    } catch {
      fault();
    }
  };

  const applyGains = (): void => {
    if (ctx === null || graph === null) return;
    const now = ctx.currentTime;
    rampTo(graph.master.gain, curve(masterPct), now);
    rampTo(graph.sfx.gain, curve(sfxPct), now);
  };

  /** Synchronous part of the first unlock: context, graph, noise. */
  const createContextAndGraph = (): boolean => {
    contextCreated = true;
    let c: AudioContextLike | null;
    try {
      c = factory();
    } catch {
      c = null;
    }
    if (c === null) {
      state = 'unsupported';
      diagnostics.warnOnce(AUDIO_CODES.unsupported);
      return false;
    }
    ctx = c;
    try {
      const noise = c.createBuffer(1, Math.max(1, Math.round(c.sampleRate)), c.sampleRate);
      fillNoise(noise, root.fork('noise'));
      graph = buildGraph(c, noise, root.fork('jitter'));
      graph.master.gain.value = curve(masterPct);
      graph.sfx.gain.value = curve(sfxPct);
      c.onstatechange = onStateChange;
    } catch {
      fault();
      graph = null;
      state = 'unsupported';
      c.close().then(undefined, fault);
      return false;
    }
    return true;
  };

  const resumeContext = (c: AudioContextLike): Promise<Result<void, UnlockError>> => {
    const settle = (running: boolean): Result<void, UnlockError> => {
      pending = null;
      if (state !== 'unlocking') return state === 'running' ? OK : BLOCKED;
      if (running) {
        state = 'running';
        return OK;
      }
      state = 'blocked';
      diagnostics.warnOnce(AUDIO_CODES.blocked);
      return BLOCKED;
    };
    let p: Promise<void>;
    try {
      p = c.resume();
    } catch {
      return Promise.resolve(settle(false));
    }
    return p.then(
      () => settle(c.state === 'running'),
      () => settle(false),
    );
  };

  const unlock = (): Promise<Result<void, UnlockError>> => {
    if (state === 'disposed') return Promise.resolve(BLOCKED);
    if (state === 'unsupported') return Promise.resolve(UNSUPPORTED);
    if (state === 'running') return Promise.resolve(OK);
    if (state === 'unlocking' && pending !== null) return pending;
    if (ctx === null) {
      if (contextCreated || !createContextAndGraph()) return Promise.resolve(UNSUPPORTED);
    }
    const c = ctx;
    if (c === null) return Promise.resolve(UNSUPPORTED);
    state = 'unlocking';
    // Read only while state is unlocking; a synchronous settle leaves it unused.
    pending = resumeContext(c);
    return pending;
  };

  const placeRequest = (r: VoiceRequest, pose: AudioListenerPose, listenerOk: boolean): void => {
    if (r.placement === 'positional') {
      if (!listenerOk) {
        r.skip = true;
        return;
      }
      const prof = RECIPES[r.cue].spatial;
      if (prof === null) return;
      let use = prof;
      if (!Number.isNaN(r.maxDist)) {
        stepProfile.refDist = prof.refDist;
        stepProfile.maxDist = r.maxDist;
        use = stepProfile;
      }
      const p = pose.pos;
      const placed = spatialise(p.x, p.y, p.z, pose.yaw, r.x, r.y, r.z, use, r.spatial);
      if (!placed) {
        r.skip = true;
        return;
      }
      const dx = r.x - p.x;
      const dy = r.y - p.y;
      const dz = r.z - p.z;
      r.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      r.hasSpatial = true;
    } else if (r.placement === 'directional') {
      r.spatial.pan = listenerOk ? panFromDirection(r.x, r.z, pose.yaw) : 0;
      r.spatial.gain = 1;
      r.spatial.lowpassHz = NO_FILTER_HZ;
      r.hasSpatial = true;
    }
  };

  const sortOrder = (n: number): void => {
    order.length = n;
    for (let i = 0; i < n; i++) order[i] = i;
    // Insertion sort over at most 32 entries: priority, then distance, then event order.
    for (let i = 1; i < n; i++) {
      const k = order[i] ?? 0;
      const rk = pool[k];
      if (rk === undefined) continue;
      const pk = RECIPES[rk.cue].priority;
      let j = i - 1;
      while (j >= 0) {
        const oj = order[j] ?? 0;
        const rj = pool[oj];
        if (rj === undefined) break;
        const pj = RECIPES[rj.cue].priority;
        if (pj < pk || (pj === pk && (rj.dist < rk.dist || (rj.dist === rk.dist && oj < k)))) break;
        order[j + 1] = oj;
        j--;
      }
      order[j + 1] = k;
    }
  };

  const play = (events: readonly SimEvent[], listener: AudioListenerPose): void => {
    try {
      if (state !== 'running' || ctx === null || graph === null || events.length === 0) return;
      if (muted()) return;
      const now = ctx.currentTime;
      budget.sweep(now);
      const wanted = mapEvents(events, pool);
      const n = Math.min(wanted, pool.length);
      for (let i = n; i < wanted; i++) diagnostics.count(AUDIO_CODES.voiceDropped);
      const p = listener.pos;
      const listenerOk =
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Number.isFinite(p.z) &&
        Number.isFinite(listener.yaw);
      if (!listenerOk) diagnostics.warnOnce(AUDIO_CODES.badListener);
      for (let i = 0; i < n; i++) {
        const r = pool[i];
        if (r !== undefined) placeRequest(r, listener, listenerOk);
      }
      sortOrder(n);
      budget.beginCall();
      let admitted = 0;
      for (let i = 0; i < n; i++) {
        const r = pool[order[i] ?? 0];
        if (r === undefined || r.skip) continue;
        if (admitted >= MAX_NEW_PER_CALL || !budget.canAdmit(r.cue, r.source, r.tick)) {
          diagnostics.count(AUDIO_CODES.voiceDropped);
          continue;
        }
        const v = startVoice(graph.target, r.cue, r.hasSpatial ? r.spatial : null, now, release);
        budget.add(v, r.source, r.tick);
        admitted++;
      }
    } catch {
      fault();
    }
  };

  const ui = (cue: UiCue): void => {
    try {
      if ((state !== 'running' && state !== 'unlocking') || ctx === null || graph === null) return;
      if (muted()) return;
      const now = ctx.currentTime;
      if (cue === 'tick') {
        if (now - lastTick < TICK_MIN_GAP) return;
        lastTick = now;
      }
      budget.sweep(now);
      budget.beginCall();
      const id = uiRecipe(cue);
      if (!budget.canAdmit(id, -1, -1)) {
        diagnostics.count(AUDIO_CODES.voiceDropped);
        return;
      }
      budget.add(startVoice(graph.target, id, null, now, release), -1, -1);
    } catch {
      fault();
    }
  };

  const setVolumes = (m: number, s: number): void => {
    try {
      if (!Number.isFinite(m) || !Number.isFinite(s)) diagnostics.warnOnce(AUDIO_CODES.badVolume);
      masterPct = acceptPercent(m, masterPct);
      sfxPct = acceptPercent(s, sfxPct);
      if (state !== 'disposed') applyGains();
    } catch {
      fault();
    }
  };

  const suspend = (): void => {
    try {
      if (state !== 'running' || ctx === null) return;
      state = 'suspended';
      ctx.suspend().then(undefined, fault);
    } catch {
      fault();
    }
  };

  const dispose = (): void => {
    if (state === 'disposed') return;
    state = 'disposed';
    pending = null;
    try {
      budget.clear();
      const c = ctx;
      if (c !== null) {
        c.onstatechange = null;
        c.close().then(undefined, fault);
      }
    } catch {
      fault();
    }
  };

  return { supported, unlock, play, ui, setVolumes, suspend, dispose };
}
