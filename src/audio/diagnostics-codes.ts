/**
 * Diagnostic codes the audio unit reports (BR-AU-72). Details are never
 * attached on the tick path (SD-AU-06).
 */
export const AUDIO_CODES = {
  unsupported: 'audio/unsupported',
  blocked: 'audio/blocked',
  badVolume: 'audio/bad-volume',
  badListener: 'audio/bad-listener',
  voiceFault: 'audio/voice-fault',
  /** Counted with Diagnostics.count, never warnOnce. */
  voiceDropped: 'audio/voice-dropped',
} as const;

export type AudioCode = (typeof AUDIO_CODES)[keyof typeof AUDIO_CODES];
