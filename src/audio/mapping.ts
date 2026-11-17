/**
 * Pure mapping from simulation events and UI intents to sounds
 * (business-rules-audio "Event-to-Sound Mapping", BR-AU-31).
 *
 * Reads positions only from `shot.origin` and `noise.pos` (SD-AU-03), so audio
 * never reveals anything the simulation did not broadcast.
 */
import { assertNever } from '../core';
import type { SettingsIntent, SimEvent, UiIntent, WeaponId } from '../contracts';
import type { CueId, Placement, UiCue, VoiceRequest } from './types';

/** VoiceRequest pool size per play() call (business-logic-model-audio, Workflow 2). */
export const REQUEST_POOL_SIZE = 32;

const PLAYER = 0;
const FOOTSTEP_RADIUS_FACTOR = 1.25;
const FOOTSTEP_MAX_DIST = 25;

export function createRequestPool(size = REQUEST_POOL_SIZE): VoiceRequest[] {
  return Array.from({ length: size }, () => ({
    cue: 'step',
    source: -1,
    tick: -1,
    placement: 'centred',
    x: 0,
    y: 0,
    z: 0,
    maxDist: Number.NaN,
    spatial: { pan: 0, gain: 1, lowpassHz: 22000 },
    hasSpatial: false,
    skip: false,
    dist: 0,
  }));
}

function playerFire(w: WeaponId): CueId {
  switch (w) {
    case 'rifle':
      return 'fire-rifle';
    case 'pistol':
      return 'fire-pistol';
    case 'sniper':
      return 'fire-sniper';
    default:
      return assertNever(w);
  }
}

function botFire(w: WeaponId): CueId {
  switch (w) {
    case 'rifle':
      return 'bot-fire-rifle';
    case 'pistol':
      return 'bot-fire-pistol';
    case 'sniper':
      return 'bot-fire-sniper';
    default:
      return assertNever(w);
  }
}

function outcomeCue(e: Extract<SimEvent, { t: 'phase' }>): CueId | null {
  switch (e.phase) {
    case 'countdown':
      return null;
    case 'live':
      return 'round-go';
    case 'ended':
      if (e.outcome === 'victory') return 'victory';
      if (e.outcome === 'defeat') return 'defeat';
      if (e.outcome === 'time-expired') return 'time-up';
      return null;
    default:
      return assertNever(e.phase);
  }
}

function put(
  r: VoiceRequest,
  cue: CueId,
  source: number,
  tick: number,
  placement: Placement,
): VoiceRequest {
  r.cue = cue;
  r.source = source;
  r.tick = tick;
  r.placement = placement;
  r.x = 0;
  r.y = 0;
  r.z = 0;
  r.maxDist = Number.NaN;
  r.hasSpatial = false;
  r.skip = false;
  r.dist = 0;
  return r;
}

/**
 * Writes one request per sound-bearing event into `pool` (in event order) and
 * returns how many the events asked for. Requests beyond `pool.length` are not
 * written; the caller counts them as dropped. Allocates nothing.
 */
export function mapEvents(events: readonly SimEvent[], pool: VoiceRequest[]): number {
  let n = 0;
  const next = (): VoiceRequest | null => {
    const r = pool[n];
    n++;
    return r ?? null;
  };
  for (const e of events) {
    switch (e.t) {
      case 'shot': {
        const r = next();
        if (r === null) break;
        if (e.shooter === PLAYER) put(r, playerFire(e.weapon), PLAYER, e.tick, 'centred');
        else {
          put(r, botFire(e.weapon), e.shooter, e.tick, 'positional');
          r.x = e.origin.x;
          r.y = e.origin.y;
          r.z = e.origin.z;
        }
        break;
      }
      case 'damage': {
        if (e.target === PLAYER) {
          const r = next();
          if (r === null) break;
          put(r, 'hurt', e.source, e.tick, 'directional');
          r.x = e.fromDir.x;
          r.z = e.fromDir.z;
        } else if (e.source === PLAYER) {
          const r = next();
          if (r !== null) put(r, e.headshot ? 'headshot' : 'hit', e.target, e.tick, 'centred');
        }
        break;
      }
      case 'kill': {
        if (e.victim === PLAYER) break;
        const r = next();
        if (r !== null) put(r, 'enemy-down', e.victim, e.tick, 'centred');
        break;
      }
      case 'noise': {
        if (e.kind === 'gunfire') break;
        const r = next();
        if (r === null) break;
        if (e.source === PLAYER) {
          put(r, e.kind === 'footstep' ? 'step' : 'land', PLAYER, e.tick, 'centred');
        } else {
          put(r, 'bot-step', e.source, e.tick, 'positional');
          r.x = e.pos.x;
          r.y = e.pos.y;
          r.z = e.pos.z;
          r.maxDist = Math.min(e.radius * FOOTSTEP_RADIUS_FACTOR, FOOTSTEP_MAX_DIST);
        }
        break;
      }
      case 'weapon': {
        if (e.actor !== PLAYER) break;
        const r = next();
        if (r !== null) put(r, e.kind, PLAYER, e.tick, 'centred');
        break;
      }
      case 'impact':
        break;
      case 'phase': {
        const cue = outcomeCue(e);
        if (cue === null) break;
        const r = next();
        if (r !== null) put(r, cue, -1, e.tick, 'centred');
        break;
      }
      default:
        assertNever(e);
    }
  }
  return n;
}

/** UI cue for an intent app-shell dispatches (BR-AU-31). */
export function cueForIntent(intent: UiIntent | SettingsIntent): UiCue {
  switch (intent.type) {
    case 'start-game':
    case 'deploy':
    case 'resume':
    case 'play-again':
    case 'restart-confirmed':
    case 'retry-loading':
    case 'clear-history':
      return 'confirm';
    case 'main-menu':
    case 'leave-confirmed':
    case 'cancel-loading':
      return 'back';
    case 'set-setting':
      return 'tick';
    default:
      return assertNever(intent);
  }
}

/** Recipe id for a UI cue. */
export function uiRecipe(cue: UiCue): CueId {
  switch (cue) {
    case 'confirm':
      return 'ui-confirm';
    case 'back':
      return 'ui-back';
    case 'tick':
      return 'ui-tick';
    case 'error':
      return 'ui-error';
    default:
      return assertNever(cue);
  }
}
