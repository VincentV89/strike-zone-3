/** Diagnostic codes bot-perception reports (BR-AI-81, SD-AI-07). */
export const PERCEPTION_CODES = ['ai/bad-input'] as const;
export type PerceptionCode = (typeof PERCEPTION_CODES)[number];
