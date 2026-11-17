/**
 * Round-config gate (BR-GS-01, BR-GS-41, SD-GS-03). Runs before any agent,
 * buffer or RNG fork is created. Bad config is a programmer error.
 */
import { StrikeZoneError, TICK_HZ, isSeed } from '../core';
import { BOT_COUNTS, type RoundConfig } from '../contracts';
import { DIFFICULTY_PROFILES } from '../ai/brain';
import { SIM_TUNING } from './tuning';
import type { PreparedMap, SimulationDeps } from './types';

function bad(field: string): never {
  throw new StrikeZoneError('sim/bad-config', `Invalid round config: ${field}`, { field });
}

function validHz(hz: unknown): boolean {
  return (
    typeof hz === 'number' && Number.isInteger(hz) && hz >= 1 && hz <= TICK_HZ && TICK_HZ % hz === 0
  );
}

/**
 * @throws StrikeZoneError('sim/bad-config') naming the first bad field, or
 * StrikeZoneError('sim/invalid-map') when the map does not match or did not validate.
 */
export function assertRoundConfig(cfg: RoundConfig, map: PreparedMap, deps: SimulationDeps): void {
  if (typeof cfg !== 'object' || (cfg as unknown) === null) bad('cfg');
  if (!(BOT_COUNTS as readonly unknown[]).includes(cfg.bots)) bad('bots');
  const d: unknown = cfg.difficulty;
  if (typeof d !== 'string' || !Object.hasOwn(DIFFICULTY_PROFILES, d)) bad('difficulty');
  const dur: unknown = cfg.durationSec;
  if (
    typeof dur !== 'number' ||
    !Number.isInteger(dur) ||
    dur < 1 ||
    dur > SIM_TUNING.maxDurationSec
  ) {
    bad('durationSec');
  }
  if (!isSeed(cfg.seed)) bad('seed');
  if (cfg.map !== map.def.id || !map.validation.ok) {
    throw new StrikeZoneError(
      'sim/invalid-map',
      'Map does not match the config or failed validation',
      {
        map: cfg.map,
      },
    );
  }
  if (typeof deps !== 'object' || (deps as unknown) === null) bad('deps');
  const ai = deps.ai;
  if (ai !== undefined) {
    const sense = ai.senseHz ?? 20;
    const decide = ai.decideHz ?? 10;
    if (!validHz(sense)) bad('ai.senseHz');
    if (!validHz(decide) || decide > sense) bad('ai.decideHz');
  }
}
