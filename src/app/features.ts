/**
 * Feature manifest (unit-of-work feature manifest, RA-05). The only file in
 * src/ that imports src/audio (BR-AU-80, tests/arch/import-graph.test.ts).
 * To cut audio: remove the import below, delete src/audio, delete the
 * app-shell → audio row and return `audio: null`; the Audio settings group
 * is then hidden because `features.audio` is false.
 */
import { createAudioEngine, cueForIntent, type AudioEngine } from '../audio';
import type { SettingsIntent, SimEvent, UiIntent } from '../contracts';
import type { Diagnostics, Vec3 } from '../core';
import type { Features } from '../ui/screens';

export interface ListenerPose {
  readonly pos: Vec3;
  readonly yaw: number;
}

/** What app-shell needs from audio. Every call is fire-and-forget. */
export interface AudioFeature {
  readonly supported: boolean;
  /** Creates or resumes the AudioContext; call inside a user gesture. Never awaited. */
  unlock(): void;
  play(events: readonly SimEvent[], pose: ListenerPose): void;
  /** UI cue for a dispatched intent. */
  cue(intent: UiIntent | SettingsIntent): void;
  error(): void;
  setVolumes(masterPct: number, sfxPct: number): void;
  suspend(): void;
  dispose(): void;
}

export function wrapAudioEngine(engine: AudioEngine, diag: Diagnostics): AudioFeature {
  return {
    supported: engine.supported,
    unlock() {
      engine.unlock().then(
        () => undefined,
        () => {
          diag.warnOnce('app/audio-unlock-failed');
        },
      );
    },
    play(events, pose) {
      engine.play(events, pose);
    },
    cue(intent) {
      engine.ui(cueForIntent(intent));
    },
    error() {
      engine.ui('error');
    },
    setVolumes(masterPct, sfxPct) {
      engine.setVolumes(masterPct, sfxPct);
    },
    suspend() {
      engine.suspend();
    },
    dispose() {
      engine.dispose();
    },
  };
}

export interface FeatureSet {
  readonly audio: AudioFeature | null;
  readonly features: Features;
}

export function featureFlags(audio: AudioFeature | null): Features {
  return Object.freeze({
    audio: audio?.supported === true,
    graphicsPresets: true,
    persistence: true,
    history: true,
  });
}

/** The B9/B10 build: every Should and Could feature is built. */
export function createFeatures(diagnostics: Diagnostics): FeatureSet {
  const audio = wrapAudioEngine(createAudioEngine({ diagnostics }), diagnostics);
  return { audio, features: featureFlags(audio) };
}
