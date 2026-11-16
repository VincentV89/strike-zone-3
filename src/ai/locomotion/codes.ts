/** Diagnostic codes bot-locomotion reports (BR-AI-81, SD-AI-07). */
export const LOCOMOTION_CODES = [
  'ai/bad-input',
  'ai/stuck-snap',
  'ai/stuck-unresolved',
  'ai/path-truncated',
] as const;
export type LocomotionCode = (typeof LOCOMOTION_CODES)[number];
