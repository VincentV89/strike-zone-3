/**
 * audio: public surface (domain-entities-audio). app-shell imports only this
 * module, from src/app/features.ts (BR-AU-80).
 */
export {
  createAudioEngine,
  type AudioEngine,
  type EngineDeps,
  type EngineState,
  type UnlockError,
} from './engine';
export { cueForIntent } from './mapping';
export type { AudioContextLike } from './context';
export type { AudioListenerPose, UiCue } from './types';
