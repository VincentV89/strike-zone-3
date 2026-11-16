/**
 * StatsTracker (BR-GS-80..89, SD-GS-07). Its only input is the drained
 * event stream; it never reads the simulation. Closed after commit or
 * discard; any later call is a programmer error.
 */
import { PLAYER_ID, StrikeZoneError, assertNever } from '../../core';
import type { BotCount, SimEvent } from '../../contracts';
import type { RoundStats, SessionStats, StatsTracker } from './types';

export const EMPTY_SESSION: SessionStats = Object.freeze({ roundsWon: 0, roundsLost: 0 });

export function createStatsTracker(session: SessionStats, botCount: BotCount): StatsTracker {
  let sess: SessionStats = session;
  let closed = false;
  let endTick: number | null = null;
  const r: RoundStats = {
    kills: 0,
    deaths: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
    accuracy: 0,
    damageDealt: 0,
    damageTaken: 0,
    armorLost: 0,
    enemiesTotal: botCount,
    enemiesLeft: botCount,
    killerId: null,
    liveStartTick: -1,
    lastTick: 0,
    durationSec: 0,
    outcome: null,
  };

  const assertOpen = (): void => {
    if (closed) throw new StrikeZoneError('stats/closed', 'The stats tracker is closed');
  };

  const fold = (e: SimEvent): void => {
    if (e.tick > r.lastTick) r.lastTick = e.tick;
    switch (e.t) {
      case 'shot':
        if (e.shooter === PLAYER_ID) {
          r.shotsFired++;
          if (e.hit !== null) r.shotsHit++;
        }
        return;
      case 'damage':
        if (e.source === PLAYER_ID && e.target !== PLAYER_ID) r.damageDealt += e.amount;
        if (e.target === PLAYER_ID) {
          r.damageTaken += e.amount;
          r.armorLost += e.armorLoss;
        }
        return;
      case 'kill':
        if (e.killer === PLAYER_ID && e.victim !== PLAYER_ID) {
          r.kills++;
          r.enemiesLeft = Math.max(0, r.enemiesLeft - 1);
          if (e.headshot) r.headshots++;
        }
        if (e.victim === PLAYER_ID) {
          r.deaths++;
          r.killerId = e.killer;
        }
        return;
      case 'phase':
        if (e.phase === 'live') r.liveStartTick = e.tick;
        else if (e.phase === 'ended') endTick = e.tick;
        return;
      case 'impact':
      case 'noise':
      case 'weapon':
        return;
      default:
        assertNever(e);
    }
  };

  return {
    ingest(events) {
      assertOpen();
      for (const e of events) fold(e);
      r.accuracy = r.shotsFired > 0 ? r.shotsHit / r.shotsFired : 0;
      r.durationSec = r.liveStartTick < 0 ? 0 : ((endTick ?? r.lastTick) - r.liveStartTick) / 60;
    },
    round: () => r,
    commit(outcome) {
      assertOpen();
      closed = true;
      r.outcome = outcome;
      const won = outcome === 'victory' ? 1 : 0;
      sess = Object.freeze({
        roundsWon: sess.roundsWon + won,
        roundsLost: sess.roundsLost + (1 - won),
      });
      return sess;
    },
    discard() {
      assertOpen();
      closed = true;
    },
    session: () => sess,
  };
}
