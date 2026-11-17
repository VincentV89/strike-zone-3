/**
 * Bot intent vocabulary shared by bot-brain (writer) and bot-locomotion /
 * game-simulation (readers). Types only (BR-F-24); added by bot-ai (BR-AI-90).
 * AvoidZone is a structural copy of nav's PathAvoid because contracts cannot
 * import src/nav; tests/contracts/ai.test-d.ts asserts the two stay assignable.
 */
import type { Vec3 } from '../core/math/vec3';

export interface AvoidZone {
  readonly center: Vec3;
  readonly radius: number;
  readonly penalty: number;
}

export interface BotIntent {
  /** Destination feet position (a nav node or cover pos), never a waypoint. */
  goal: Vec3 | null;
  /** Flank routing only. */
  avoid: AvoidZone | null;
  speed: 'walk' | 'run';
  /** World point to face; null = face travel direction. */
  aimAt: Vec3 | null;
  /** Permission to fire; the aim gate decides the actual trigger. */
  fire: boolean;
  reload: boolean;
  crouch: boolean;
}
