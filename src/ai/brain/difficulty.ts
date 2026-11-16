/**
 * Difficulty profiles (BR-AI-51). Behaviour only: bot health is the same at
 * every level (BR-AI-50). Frozen; looked up with Object.hasOwn so prototype
 * keys throw (SD-AI-08).
 */
import { StrikeZoneError } from '../../core';
import type { Difficulty } from '../../contracts';
import { freezeNested } from './freeze';
import type { DifficultyProfile } from './types';

const deg = (d: number): number => (d * Math.PI) / 180;

export const DIFFICULTY_PROFILES: Readonly<Record<Difficulty, DifficultyProfile>> = freezeNested({
  easy: {
    level: 'easy',
    perception: {
      fovRad: deg(100),
      sightRange: 50,
      hearingMult: 0.7,
      hearingErrorFrac: 0.25,
      hearingErrorMin: 3,
      reacquireGraceTicks: 18,
      memoryTicks: 360,
      suspicionTicks: 480,
    },
    reactionTicks: 39,
    aimErrorRad: 0.09,
    aimSettleTicks: 90,
    aimSettleFloor: 0.6,
    turnRateRad: 3.0,
    burstTicks: 18,
    burstPauseTicks: 54,
    aggression: 0.3,
    repositionTicks: 240,
    coverChance: 0.25,
    flankChance: 0.1,
    coverHoldTicks: 240,
    retreatHealth: 25,
    engageMin: 8,
    engageMax: 30,
  },
  normal: {
    level: 'normal',
    perception: {
      fovRad: deg(120),
      sightRange: 70,
      hearingMult: 1.0,
      hearingErrorFrac: 0.18,
      hearingErrorMin: 2.5,
      reacquireGraceTicks: 36,
      memoryTicks: 600,
      suspicionTicks: 480,
    },
    reactionTicks: 24,
    aimErrorRad: 0.055,
    aimSettleTicks: 60,
    aimSettleFloor: 0.45,
    turnRateRad: 5.0,
    burstTicks: 30,
    burstPauseTicks: 33,
    aggression: 0.5,
    repositionTicks: 180,
    coverChance: 0.55,
    flankChance: 0.3,
    coverHoldTicks: 180,
    retreatHealth: 30,
    engageMin: 8,
    engageMax: 30,
  },
  hard: {
    level: 'hard',
    perception: {
      fovRad: deg(140),
      sightRange: 90,
      hearingMult: 1.2,
      hearingErrorFrac: 0.12,
      hearingErrorMin: 2,
      reacquireGraceTicks: 60,
      memoryTicks: 900,
      suspicionTicks: 480,
    },
    reactionTicks: 13,
    aimErrorRad: 0.035,
    aimSettleTicks: 36,
    aimSettleFloor: 0.3,
    turnRateRad: 8.0,
    burstTicks: 48,
    burstPauseTicks: 18,
    aggression: 0.7,
    repositionTicks: 120,
    coverChance: 0.85,
    flankChance: 0.55,
    coverHoldTicks: 120,
    retreatHealth: 35,
    engageMin: 8,
    engageMax: 30,
  },
});

/** SD-AI-11: every profile keeps a reaction delay and a non-zero aim error. Throws at module load otherwise. */
export function checkProfileFloors(profiles: Readonly<Record<string, DifficultyProfile>>): void {
  for (const key of Object.keys(profiles)) {
    const p = profiles[key];
    if (
      p === undefined ||
      !(p.reactionTicks >= 1) ||
      !(p.aimErrorRad > 0) ||
      !(p.aimSettleFloor > 0)
    ) {
      throw new StrikeZoneError('ai/bad-config', 'Difficulty profile below the fairness floor');
    }
  }
}

checkProfileFloors(DIFFICULTY_PROFILES);

/** @throws StrikeZoneError('ai/unknown-difficulty') for anything outside the Difficulty union. */
export function getDifficultyProfile(level: Difficulty): DifficultyProfile {
  if (typeof level !== 'string' || !Object.hasOwn(DIFFICULTY_PROFILES, level)) {
    throw new StrikeZoneError('ai/unknown-difficulty', 'Unknown difficulty');
  }
  return DIFFICULTY_PROFILES[level];
}
