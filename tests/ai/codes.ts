/** The union of the three components' code lists (SD-AI-07). */
import { BRAIN_CODES } from '../../src/ai/brain';
import { LOCOMOTION_CODES } from '../../src/ai/locomotion';
import { PERCEPTION_CODES } from '../../src/ai/perception';

export const AI_DIAGNOSTIC_CODES: readonly string[] = [
  ...new Set<string>([...PERCEPTION_CODES, ...LOCOMOTION_CODES, ...BRAIN_CODES]),
];

/** Codes that are expected gameplay events, counted rather than sent to the sink. */
export const AI_COUNTED_CODES = [
  'ai/stuck-snap',
  'ai/stuck-unresolved',
  'ai/path-truncated',
  'ai/goal-off-graph',
  'ai/no-retreat',
] as const;
