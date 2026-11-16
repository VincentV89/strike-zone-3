/** Diagnostic codes bot-brain reports (BR-AI-81, SD-AI-07). */
export const BRAIN_CODES = [
  'ai/bad-input',
  'ai/goal-off-graph',
  'ai/few-patrol-nodes',
  'ai/no-retreat',
] as const;
export type BrainCode = (typeof BRAIN_CODES)[number];
