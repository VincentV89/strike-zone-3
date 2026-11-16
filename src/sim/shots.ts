/**
 * Stage 9 shot resolution (BR-GS-48, BR-GS-49, FD-GS-Q1 = A) and the stage-11
 * outcome rule (BR-GS-32). Shots resolve one at a time in queue order
 * (player first, then bots by id). A shooter whose vitals died earlier in
 * the tick is skipped, so a trade with the last bot is a Victory.
 */
import { PLAYER_ID, type Diagnostics, type EntityId } from '../core';
import type { RoundOutcome, SimEvent } from '../contracts';
import { executeShot, type Hitboxes, type ShotTarget, type Vitals } from '../combat';
import type { CollisionWorld } from '../physics';
import type { FireRequest, Loadout } from '../weapons';

export interface ShotActor {
  readonly id: EntityId;
  readonly vitals: Vitals;
  readonly loadout: Loadout;
  readonly hitboxes: Hitboxes;
}

export interface ShotQueue {
  /** Preallocated, length = actor count; only the first `count` entries are live. */
  readonly reqs: (FireRequest | null)[];
  count: number;
}

export function createShotQueue(capacity: number): ShotQueue {
  const reqs: (FireRequest | null)[] = [];
  for (let i = 0; i < capacity; i++) reqs.push(null);
  return { reqs, count: 0 };
}

export function enqueueShot(q: ShotQueue, req: FireRequest): void {
  if (q.count < q.reqs.length) q.reqs[q.count++] = req;
}

export interface ShotResolver {
  /** Resolves and empties the queue. */
  resolve(q: ShotQueue): void;
}

/**
 * `actors[i]` is the actor with id i (player at 0). Target objects are
 * created here once, one per actor, and reused for every shot.
 */
export function createShotResolver(
  actors: readonly ShotActor[],
  world: CollisionWorld,
  sink: (e: SimEvent) => void,
  diag: Diagnostics,
): ShotResolver {
  const slots: ShotTarget[] = actors.map((a) => ({
    id: a.id,
    hitboxes: a.hitboxes,
    damageable: true,
  }));
  const targets: ShotTarget[] = [];
  const vitalsOf = (id: EntityId): Vitals | undefined => actors[id]?.vitals;

  const buildTargets = (shooter: EntityId): void => {
    targets.length = 0;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i] as ShotActor;
      const t = slots[i] as ShotTarget;
      if (a.id === shooter || !a.vitals.alive) continue;
      // Player shots damage bots; bot shots damage only the player, other bots block (ADR-018).
      t.damageable = shooter === PLAYER_ID || a.id === PLAYER_ID;
      targets.push(t);
    }
  };

  return {
    resolve(q) {
      for (let i = 0; i < q.count; i++) {
        const req = q.reqs[i];
        q.reqs[i] = null;
        if (req === null || req === undefined) continue;
        const shooter = actors[req.shooter];
        // FD-GS-Q1: a shooter killed earlier this tick does not fire (no shot, no noise).
        if (shooter === undefined || !shooter.vitals.alive) continue;
        buildTargets(req.shooter);
        const profile = shooter.loadout.slots[req.slot].profile;
        executeShot(req, profile, world, targets, vitalsOf, sink, diag);
      }
      q.count = 0;
    },
  };
}

/** Stage 11 in live, after the timer decrement: win, then timeout, then death (BR-GS-32, BR-GS-33). */
export function roundOutcome(
  botsAlive: number,
  remainingTicks: number,
  playerAlive: boolean,
): RoundOutcome | null {
  if (botsAlive === 0) return 'victory';
  if (remainingTicks <= 0) return 'time-expired';
  if (!playerAlive) return 'defeat';
  return null;
}
