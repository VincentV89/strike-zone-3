/**
 * Bot brain (tick stage 5, business-logic-model-bot-ai §3). A seven-state FSM
 * (ADR-007) driven only by BotSelf, PerceptionMemory and BrainContext
 * (BR-AI-01). Transitions happen only in decide(), except onDeath() (BR-AI-20).
 * Precedence: dead, retreat, state rows in table order, stay (BR-AI-22). Every
 * goal is a nav node position (BR-AI-23). Randomness comes only from ctx.rng
 * (BR-AI-24). Never throws, never allocates after createBotBrain (BR-AI-81).
 */
import { StrikeZoneError, clamp, copy, vec3, type EntityId, type Vec3 } from '../../core';
import type { BotIntent } from '../../contracts';
import type { NavNodeId } from '../../nav';
import type { PerceptionMemory } from '../perception';
import { freezeNested } from './freeze';
import { finite3 } from './guard';
import { MAX_BOTS } from './scheduler';
import { MAX_CANDIDATES, findRetreatNode, findSearchNodes } from './search';
import type {
  BotBrain,
  BotSelf,
  BotStateName,
  BrainContext,
  CoverPointId,
  CoverRegistry,
  DifficultyProfile,
} from './types';

export const BRAIN_TUNING = freezeNested({
  /** BR-AI-21 underFire window (ticks). */
  underFireTicks: 90,
  /** T-02: no retreat within this many ticks of the last one. */
  retreatCooldownTicks: 600,
  /** T-25/T-26: minimum time in retreat. */
  retreatMinTicks: 180,
  /** T-12: investigate timeout. */
  investigateTimeoutTicks: 720,
  /** T-16: lost sight with fresh memory for this long goes to investigate. */
  lostSightTicks: 60,
  /** T-24: flank timeout. */
  flankTimeoutTicks: 900,
  /** T-10: a new suspect this far from the target retargets (m). */
  retargetDist: 3,
  /** Patrol wait on arrival: 0..patrolWaitMax ticks. */
  patrolWaitMax: 90,
  /** Damage with no position: investigate this far along threatDir (m). */
  threatProbeDist: 15,
  /** Cover and retreat threat point along threatDir when memory is stale (m). */
  threatPointDist: 20,
  /** Engage: back off to 6-12 m, sidestep 3-8 m, aggressive step 4 m toward. */
  backOffDist: 9,
  sideMin: 3,
  sideMax: 8,
  aggressiveStep: 4,
  /** Flank point offset and avoid zone (BR-AI-29). */
  flankOffset: 12,
  flankAvoidMin: 6,
  flankAvoidMax: 15,
  flankAvoidPenalty: 4,
  /** Hold cover reload threshold (rounds). */
  coverReloadBelow: 15,
  /** T-27 side step (m). */
  unstuckMin: 3,
  unstuckMax: 6,
});

const T = BRAIN_TUNING;
const STATES: readonly BotStateName[] = [
  'patrol',
  'investigate',
  'engage',
  'take-cover',
  'flank',
  'retreat',
  'dead',
];

const distXZ = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => Math.hypot(a.x - b.x, a.z - b.z);

class Brain implements BotBrain {
  readonly id: EntityId;
  readonly profile: DifficultyProfile;
  state: BotStateName = 'patrol';
  stateEnteredTick = 0;
  readonly intent: BotIntent;
  readonly stats: Record<BotStateName, number>;
  private readonly patrolNodes: readonly NavNodeId[];
  private readonly goalStore = vec3();
  private readonly aimStore = vec3();
  private readonly avoidStore = { center: vec3(), radius: 0, penalty: 0 };
  private readonly tmp = vec3();
  private readonly tmp2 = vec3();
  private readonly eye = vec3();
  private readonly target = vec3();
  private readonly flankTarget = vec3();
  private readonly searchNodes = new Int32Array(2);
  private prevUnderFire = -1;
  private handledSuspect = -1;
  private lastRetreatTick = -1_000_000;
  private retreatBlockedHit = -2;
  private reloadRolled = false;
  // patrol
  private patrolNode = -1;
  private patrolPrev = -1;
  private waitUntil = -1;
  // investigate
  private searching = false;
  private searchCount = 0;
  private searchIdx = 0;
  // engage
  private lostSightTick = -1;
  private flankRolled = false;
  private nextRepositionTick = 0;
  // take-cover
  private coverId: CoverPointId = -1;
  private holdStart = -1;
  // flank
  private flankPhase = 0;
  // shared
  private cover: CoverRegistry | null = null;
  /** Reused per decide call (decide is not re-entrant, LC-AI-07). */
  private readonly preds: Preds = {
    seen: false,
    fresh: false,
    suspect: false,
    newSuspect: false,
    underFire: false,
    newHit: false,
    low: false,
  };

  constructor(id: EntityId, profile: DifficultyProfile, patrolNodes: readonly NavNodeId[]) {
    this.id = id;
    this.profile = profile;
    this.patrolNodes = patrolNodes;
    this.intent = {
      goal: null,
      avoid: null,
      speed: 'walk',
      aimAt: null,
      fire: false,
      reload: false,
      crouch: false,
    };
    const stats = {} as Record<BotStateName, number>;
    for (const s of STATES) stats[s] = 0;
    stats.patrol = 1;
    this.stats = stats;
  }

  // ---------------------------------------------------------------- helpers

  private enter(next: BotStateName, t: number): void {
    if (this.state === 'take-cover' && this.cover !== null) this.cover.release(this.id);
    if (this.state === 'flank' && this.cover !== null) this.cover.releaseFlank(this.id);
    this.state = next;
    this.stateEnteredTick = t;
    this.stats[next]++;
    this.intent.avoid = null;
    this.intent.crouch = false;
  }

  /** BR-AI-23: snap `p` to the nearest nav node into the goal store; keeps the previous goal on failure. */
  private snapGoal(p: Readonly<Vec3>, self: Readonly<BotSelf>, ctx: BrainContext): boolean {
    const g = ctx.graph;
    let node = finite3(p) ? g.nearestNode(p) : null;
    if (node === null && finite3(p)) {
      this.tmp2.x = (p.x + self.pos.x) / 2;
      this.tmp2.y = (p.y + self.pos.y) / 2;
      this.tmp2.z = (p.z + self.pos.z) / 2;
      node = g.nearestNode(this.tmp2);
    }
    const n = node === null ? undefined : g.nodes[node];
    if (n === undefined) {
      ctx.diag.count('ai/goal-off-graph');
      return false;
    }
    copy(n.pos, this.goalStore);
    this.intent.goal = this.goalStore;
    return true;
  }

  private setAim(p: Readonly<Vec3> | null): void {
    if (p === null) {
      this.intent.aimAt = null;
      return;
    }
    copy(p, this.aimStore);
    this.intent.aimAt = this.aimStore;
  }

  private roll(chance: number, ctx: BrainContext): boolean {
    return ctx.rng.next() < chance;
  }

  /** Threat point for cover and retreat (BR-AI-28): last seen when fresh, else along threatDir. */
  private threatPoint(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    fresh: boolean,
  ): Vec3 | null {
    if (fresh && mem.lastSeenPos !== null) return copy(mem.lastSeenPos, this.tmp);
    const d = mem.threatDir;
    if (d === null) return null;
    this.tmp.x = self.pos.x + d.x * T.threatPointDist;
    this.tmp.y = self.pos.y;
    this.tmp.z = self.pos.z + d.z * T.threatPointDist;
    return this.tmp;
  }

  // ---------------------------------------------------------------- entries

  private enterPatrol(t: number): void {
    this.enter('patrol', t);
    this.patrolNode = -1;
    this.waitUntil = -1;
  }

  private enterInvestigate(
    t: number,
    p: Readonly<Vec3>,
    self: Readonly<BotSelf>,
    ctx: BrainContext,
  ): void {
    this.enter('investigate', t);
    this.searching = false;
    this.searchCount = 0;
    this.searchIdx = 0;
    if (this.snapGoal(p, self, ctx)) copy(this.goalStore, this.target);
    else copy(self.pos, this.target);
  }

  private enterEngage(t: number): void {
    this.enter('engage', t);
    this.lostSightTick = -1;
    this.flankRolled = false;
    this.nextRepositionTick = t;
    this.reloadRolled = false;
  }

  /** T-04/T-09/T-13/T-14/T-25: roll (unless forced), find, claim and enter take-cover. */
  private tryCover(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
    fresh: boolean,
    rollIt: boolean,
  ): boolean {
    if (rollIt && !this.roll(this.profile.coverChance, ctx)) return false;
    const threat = this.threatPoint(self, mem, fresh);
    if (threat === null) return false;
    const p = ctx.cover.best(self.pos, threat, ctx.world, self.id);
    if (p === null || !ctx.cover.claim(self.id, p)) return false;
    this.enter('take-cover', ctx.tick);
    this.coverId = p;
    this.holdStart = -1;
    copy(ctx.cover.point(p).pos, this.goalStore); // cover points are nav anchors
    this.intent.goal = this.goalStore;
    return true;
  }

  /** T-02: retreat to a hidden node 12-30 m away. */
  private tryRetreat(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
    fresh: boolean,
  ): boolean {
    if (mem.underFireTick <= this.retreatBlockedHit) return false;
    const threat = this.threatPoint(self, mem, fresh);
    const node =
      threat === null
        ? null
        : findRetreatNode(ctx.graph, self.pos, threat, ctx.world, this.tmp2, this.eye);
    const n = node === null ? undefined : ctx.graph.nodes[node];
    if (n === undefined) {
      ctx.diag.count('ai/no-retreat');
      this.retreatBlockedHit = mem.underFireTick; // not retried until the next new hit
      return false;
    }
    this.enter('retreat', ctx.tick);
    this.lastRetreatTick = ctx.tick;
    copy(n.pos, this.goalStore);
    this.intent.goal = this.goalStore;
    return true;
  }

  /** T-15: flank point 12 m to the side of the last-seen point, reachable from the bot. */
  private tryFlank(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
  ): boolean {
    const ls = mem.lastSeenPos;
    if (ls === null) return false;
    const d = distXZ(self.pos, ls);
    if (d < 1) return false;
    const px = -(ls.z - self.pos.z) / d;
    const pz = (ls.x - self.pos.x) / d;
    const left = ctx.cover.flankCount(-1);
    const right = ctx.cover.flankCount(1);
    const first: -1 | 1 = left < right ? -1 : right < left ? 1 : ctx.rng.next() < 0.5 ? -1 : 1;
    const g = ctx.graph;
    const selfNode = g.nearestNode(self.pos);
    if (selfNode === null) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const side: -1 | 1 = attempt === 0 ? first : first === -1 ? 1 : -1;
      this.tmp.x = ls.x + px * side * T.flankOffset;
      this.tmp.y = ls.y;
      this.tmp.z = ls.z + pz * side * T.flankOffset;
      const f = g.nearestNode(this.tmp);
      const fn = f === null ? undefined : g.nodes[f];
      if (fn === undefined || f === null || !g.reachable(selfNode, f)) continue;
      this.enter('flank', ctx.tick);
      this.flankPhase = 0;
      copy(ls, this.flankTarget);
      copy(fn.pos, this.goalStore);
      this.intent.goal = this.goalStore;
      const a = this.avoidStore;
      a.center.x = (self.pos.x + ls.x) / 2;
      a.center.y = (self.pos.y + ls.y) / 2;
      a.center.z = (self.pos.z + ls.z) / 2;
      a.radius = clamp(0.4 * d, T.flankAvoidMin, T.flankAvoidMax);
      a.penalty = T.flankAvoidPenalty;
      this.intent.avoid = a;
      ctx.cover.noteFlank(self.id, side);
      return true;
    }
    return false;
  }

  /** T-27: a point 3-6 m to a random side, snapped; keeps the state. */
  private sideStep(self: Readonly<BotSelf>, ctx: BrainContext): void {
    const side = ctx.rng.next() < 0.5 ? -1 : 1;
    const dist = T.unstuckMin + (T.unstuckMax - T.unstuckMin) * ctx.rng.next();
    this.tmp.x = self.pos.x + Math.cos(self.yaw) * side * dist;
    this.tmp.y = self.pos.y;
    this.tmp.z = self.pos.z - Math.sin(self.yaw) * side * dist;
    this.snapGoal(this.tmp, self, ctx);
  }

  // ---------------------------------------------------------------- patrol

  private pickPatrol(self: Readonly<BotSelf>, ctx: BrainContext): void {
    const nodes = this.patrolNodes;
    this.waitUntil = -1;
    if (nodes.length === 0) {
      this.intent.goal = null;
      return;
    }
    const g = ctx.graph;
    const here = g.nearestNode(self.pos);
    const c = ctx.scratch.candidates;
    let m = 0;
    for (let pass = 0; pass < 2 && m < 2; pass++) {
      m = 0;
      for (let i = 0; i < nodes.length && m < MAX_CANDIDATES; i++) {
        const n = nodes[i] ?? -1;
        if (here !== null && !g.reachable(here, n)) continue;
        if (pass === 0 && (n === this.patrolNode || n === this.patrolPrev)) continue;
        c[m++] = n;
      }
    }
    const pick = m > 0 ? (c[Math.floor(ctx.rng.next() * m)] ?? -1) : (nodes[0] ?? -1);
    this.patrolPrev = this.patrolNode;
    this.patrolNode = pick;
    const node = g.nodes[pick];
    if (node === undefined) return;
    copy(node.pos, this.goalStore);
    this.intent.goal = this.goalStore;
  }

  private patrol(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
    p: Preds,
  ): void {
    const t = ctx.tick;
    if (p.seen) {
      this.enterEngage(t);
      return;
    } // T-03
    if (p.newHit) {
      if (this.tryCover(self, mem, ctx, p.fresh, true)) return; // T-04
      const d = mem.threatDir;
      if (d !== null) {
        this.tmp.x = self.pos.x + d.x * T.threatProbeDist;
        this.tmp.y = self.pos.y;
        this.tmp.z = self.pos.z + d.z * T.threatProbeDist;
        this.enterInvestigate(t, this.tmp, self, ctx); // T-05
        return;
      }
    }
    if (p.newSuspect && mem.suspectedPos !== null) {
      this.handledSuspect = mem.suspectedTick;
      this.enterInvestigate(t, mem.suspectedPos, self, ctx); // T-06
      return;
    }
    const st = self.locomotion;
    if (this.patrolNode < 0 || st === 'no-path' || st === 'stuck') {
      this.pickPatrol(self, ctx); // T-07 / T-27
    } else if (st === 'arrived') {
      if (this.waitUntil < 0)
        this.waitUntil = t + Math.floor(ctx.rng.next() * (T.patrolWaitMax + 1));
      else if (t >= this.waitUntil) this.pickPatrol(self, ctx); // T-07
    }
    this.intent.speed = 'walk';
    this.setAim(null);
    this.intent.fire = false;
  }

  // ---------------------------------------------------------------- investigate

  private investigate(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
    p: Preds,
  ): void {
    const t = ctx.tick;
    if (p.seen) {
      this.enterEngage(t);
      return;
    } // T-08
    if (p.newHit && this.tryCover(self, mem, ctx, p.fresh, true)) return; // T-09
    if (p.newSuspect && mem.suspectedPos !== null) {
      this.handledSuspect = mem.suspectedTick;
      if (distXZ(mem.suspectedPos, this.target) > T.retargetDist) {
        this.enterInvestigate(t, mem.suspectedPos, self, ctx); // T-10
        this.stats.investigate--; // a retarget is not a new entry
        return;
      }
    }
    if (t - this.stateEnteredTick >= T.investigateTimeoutTicks) {
      this.enterPatrol(t);
      return;
    } // T-12
    const st = self.locomotion;
    if (!this.searching) {
      if (st === 'arrived' || st === 'no-path' || st === 'stuck') {
        this.searching = true;
        this.searchIdx = 0;
        this.searchCount = findSearchNodes(
          ctx.graph,
          this.target,
          ctx.rng,
          ctx.scratch,
          this.searchNodes,
        );
        if (this.searchCount === 0) {
          this.enterPatrol(t);
          return;
        } // T-12
        this.goToSearchNode(ctx);
      }
    } else if (st === 'arrived' || st === 'stuck') {
      this.searchIdx++; // T-11 / T-27
      if (this.searchIdx >= this.searchCount) {
        this.enterPatrol(t);
        return;
      } // T-12
      this.goToSearchNode(ctx);
    } else if (st === 'no-path') {
      this.enterPatrol(t);
      return; // T-12
    }
    this.intent.speed = this.searching ? 'walk' : 'run';
    this.setAim(!this.searching && p.suspect ? mem.suspectedPos : null);
    this.intent.fire = false;
  }

  private goToSearchNode(ctx: BrainContext): void {
    const node = ctx.graph.nodes[this.searchNodes[this.searchIdx] ?? -1];
    if (node === undefined) return;
    copy(node.pos, this.goalStore);
    this.intent.goal = this.goalStore;
  }

  // ---------------------------------------------------------------- engage

  private engage(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
    p: Preds,
  ): void {
    const t = ctx.tick;
    const ls = mem.lastSeenPos;
    if (p.newHit && this.tryCover(self, mem, ctx, p.fresh, true)) return; // T-13
    if (ls === null) {
      this.enterPatrol(t);
      return;
    }
    if (p.seen) {
      this.lostSightTick = -1;
      this.flankRolled = false;
      if (!self.reloading) this.reloadRolled = false;
      else if (!this.reloadRolled) {
        this.reloadRolled = true;
        if (this.tryCover(self, mem, ctx, p.fresh, true)) return; // T-14
      }
      this.band(self, ls, ctx); // T-18
    } else {
      if (!p.fresh) {
        this.enterInvestigate(t, ls, self, ctx);
        return;
      } // T-17
      if (this.lostSightTick < 0) this.lostSightTick = t;
      if (!this.flankRolled) {
        this.flankRolled = true;
        if (this.roll(this.profile.flankChance, ctx) && this.tryFlank(self, mem, ctx)) return; // T-15
      }
      if (t - this.lostSightTick >= T.lostSightTicks) {
        this.enterInvestigate(t, ls, self, ctx);
        return;
      } // T-16
      this.snapGoal(ls, self, ctx);
      this.intent.speed = 'run';
    }
    this.setAim(ls);
    this.intent.fire = p.seen;
  }

  /** BR-AI-27: hold the 8-30 m band; sidestep every repositionTicks; aggression steps toward. */
  private band(self: Readonly<BotSelf>, ls: Readonly<Vec3>, ctx: BrainContext): void {
    const D = this.profile;
    const d = distXZ(self.pos, ls);
    const dx = d > 1e-6 ? (ls.x - self.pos.x) / d : 0;
    const dz = d > 1e-6 ? (ls.z - self.pos.z) / d : 0;
    if (d > D.engageMax) {
      this.snapGoal(ls, self, ctx);
      this.intent.speed = 'run';
      return;
    }
    if (d < D.engageMin) {
      this.tmp.x = self.pos.x - dx * T.backOffDist;
      this.tmp.y = self.pos.y;
      this.tmp.z = self.pos.z - dz * T.backOffDist;
      this.snapGoal(this.tmp, self, ctx);
      this.intent.speed = 'run';
      return;
    }
    this.intent.speed = 'walk';
    if (ctx.tick < this.nextRepositionTick && this.intent.goal !== null) return;
    this.nextRepositionTick = ctx.tick + D.repositionTicks;
    const side = ctx.rng.next() < 0.5 ? -1 : 1;
    const lat = T.sideMin + (T.sideMax - T.sideMin) * ctx.rng.next();
    const toward = this.roll(D.aggression, ctx) ? T.aggressiveStep : 0;
    this.tmp.x = self.pos.x - dz * side * lat + dx * toward;
    this.tmp.y = self.pos.y;
    this.tmp.z = self.pos.z + dx * side * lat + dz * toward;
    this.snapGoal(this.tmp, self, ctx);
  }

  // ---------------------------------------------------------------- take-cover

  private takeCover(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
    p: Preds,
  ): void {
    const t = ctx.tick;
    const st = self.locomotion;
    const arrived = st === 'arrived';
    if (arrived) {
      if (this.holdStart < 0) this.holdStart = t;
      else if (t - this.holdStart >= this.profile.coverHoldTicks) {
        this.leaveCover(self, mem, ctx, p, p.fresh);
        return;
      } // T-20
    } else if (st === 'no-path' || st === 'stuck') {
      this.leaveCover(self, mem, ctx, p, p.seen || p.fresh);
      return; // T-21
    }
    this.intent.speed = 'run';
    this.setAim(p.fresh ? mem.lastSeenPos : null); // T-19: fire allowed while moving
    this.intent.fire = p.seen;
    const c = this.coverId >= 0 ? ctx.cover.point(this.coverId) : null;
    this.intent.crouch = arrived && c !== null && c.height === 'low';
    this.intent.reload = self.mag === 0 || (arrived && self.mag < T.coverReloadBelow);
  }

  private leaveCover(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
    p: Preds,
    toEngage: boolean,
  ): void {
    const t = ctx.tick;
    this.coverId = -1;
    if (toEngage && mem.lastSeenPos !== null) {
      this.enterEngage(t);
      return;
    }
    this.investigateLastKnown(self, mem, ctx, p);
  }

  private investigateLastKnown(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
    p: Preds,
  ): void {
    const t = ctx.tick;
    if (mem.lastSeenPos !== null) {
      this.enterInvestigate(t, mem.lastSeenPos, self, ctx);
      return;
    }
    const threat = this.threatPoint(self, mem, p.fresh);
    if (threat !== null) {
      this.enterInvestigate(t, threat, self, ctx);
      return;
    }
    this.enterPatrol(t);
  }

  // ---------------------------------------------------------------- flank

  private flank(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
    p: Preds,
  ): void {
    const t = ctx.tick;
    const st = self.locomotion;
    if (p.seen) {
      this.enterEngage(t);
      return;
    } // T-22
    if (t - this.stateEnteredTick >= T.flankTimeoutTicks || st === 'no-path') {
      this.enterInvestigate(t, this.flankTarget, self, ctx);
      return; // T-24
    }
    if (st === 'arrived') {
      if (this.flankPhase === 0) {
        this.flankPhase = 1; // T-23
        this.intent.avoid = null;
        this.snapGoal(this.flankTarget, self, ctx);
      } else {
        this.enterInvestigate(t, this.flankTarget, self, ctx);
        return; // T-24
      }
    } else if (st === 'stuck') {
      this.sideStep(self, ctx); // T-27
    }
    this.intent.speed = 'run';
    this.setAim(null);
    this.intent.fire = false;
  }

  // ---------------------------------------------------------------- retreat

  private retreat(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
    p: Preds,
  ): void {
    const t = ctx.tick;
    const st = self.locomotion;
    const done = st === 'arrived' || st === 'no-path' || st === 'stuck';
    if (t - this.stateEnteredTick >= T.retreatMinTicks && done) {
      if (this.tryCover(self, mem, ctx, p.fresh, false)) return; // T-25
      if ((p.seen || p.fresh) && mem.lastSeenPos !== null) {
        this.enterEngage(t);
        return;
      } // T-26
      this.enterPatrol(t);
      return;
    }
    if (st === 'stuck') this.sideStep(self, ctx); // T-27
    this.intent.speed = 'run';
    this.setAim(null);
    this.intent.fire = false;
  }

  // ---------------------------------------------------------------- public

  decide(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
  ): Readonly<BotIntent> {
    if (this.state === 'dead') return this.intent;
    const t = ctx.tick;
    if (
      !Number.isFinite(t) ||
      !finite3(self.pos) ||
      !Number.isFinite(self.yaw) ||
      !Number.isFinite(self.health) ||
      !Number.isFinite(self.mag) ||
      !Number.isFinite(mem.lastSeenTick) ||
      !Number.isFinite(mem.underFireTick) ||
      !Number.isFinite(mem.suspectedTick) ||
      (mem.lastSeenPos !== null && !finite3(mem.lastSeenPos)) ||
      (mem.suspectedPos !== null && !finite3(mem.suspectedPos)) ||
      (mem.threatDir !== null && !finite3(mem.threatDir))
    ) {
      ctx.diag.warnOnce('ai/bad-input');
      return this.intent; // BR-AI-81: keep the previous intent
    }
    this.cover = ctx.cover;
    const D = this.profile;
    const P = D.perception;
    const p = this.preds;
    const before = this.state;
    p.seen = mem.visible && mem.lastSeenPos !== null;
    p.fresh =
      mem.lastSeenPos !== null && mem.lastSeenTick >= 0 && t - mem.lastSeenTick <= P.memoryTicks;
    p.suspect =
      mem.suspectedPos !== null &&
      mem.suspectedTick >= 0 &&
      t - mem.suspectedTick <= P.suspicionTicks;
    p.newSuspect = p.suspect && mem.suspectedTick > this.handledSuspect;
    p.underFire = mem.underFireTick >= 0 && t - mem.underFireTick <= T.underFireTicks;
    p.newHit = mem.underFireTick > this.prevUnderFire;
    p.low = self.health <= D.retreatHealth;
    this.prevUnderFire = mem.underFireTick;
    this.intent.reload = self.mag === 0;

    const retreatable =
      this.state !== 'retreat' &&
      p.low &&
      (p.seen || p.underFire) &&
      t - this.lastRetreatTick > T.retreatCooldownTicks;
    if (!(retreatable && this.tryRetreat(self, mem, ctx, p.fresh))) {
      switch (this.state) {
        case 'patrol':
          this.patrol(self, mem, ctx, p);
          break;
        case 'investigate':
          this.investigate(self, mem, ctx, p);
          break;
        case 'engage':
          this.engage(self, mem, ctx, p);
          break;
        case 'take-cover':
          this.takeCover(self, mem, ctx, p);
          break;
        case 'flank':
          this.flank(self, mem, ctx, p);
          break;
        case 'retreat':
          this.retreat(self, mem, ctx, p);
          break;
      }
    }
    if (this.state !== before) this.entryIntent(self, mem, ctx);
    this.finishIntent(self, mem, p);
    return this.intent;
  }

  /** Goal and speed for a state entered during this decide. */
  private entryIntent(
    self: Readonly<BotSelf>,
    mem: Readonly<PerceptionMemory>,
    ctx: BrainContext,
  ): void {
    switch (this.state) {
      case 'patrol':
        this.pickPatrol(self, ctx);
        break;
      case 'engage':
        if (mem.lastSeenPos !== null) this.band(self, mem.lastSeenPos, ctx);
        break;
      case 'investigate':
      case 'take-cover':
      case 'flank':
      case 'retreat':
      case 'dead':
        break;
    }
  }

  /** Fills the fields a transition left unset, per the "Intent per state" table. */
  private finishIntent(self: Readonly<BotSelf>, mem: Readonly<PerceptionMemory>, p: Preds): void {
    const I = this.intent;
    switch (this.state) {
      case 'patrol':
        I.speed = 'walk';
        I.aimAt = null;
        I.fire = false;
        I.crouch = false;
        break;
      case 'investigate':
        I.speed = this.searching ? 'walk' : 'run';
        this.setAim(!this.searching && p.suspect ? mem.suspectedPos : null);
        I.fire = false;
        I.crouch = false;
        break;
      case 'engage':
        if (mem.lastSeenPos !== null) this.setAim(mem.lastSeenPos);
        I.fire = p.seen;
        I.crouch = false;
        break;
      case 'take-cover':
        I.speed = 'run';
        this.setAim(p.fresh ? mem.lastSeenPos : null);
        I.fire = p.seen;
        break;
      case 'flank':
      case 'retreat':
        I.speed = 'run';
        I.aimAt = null;
        I.fire = false;
        I.crouch = false;
        break;
      case 'dead':
        break;
    }
    if (this.state !== 'flank') I.avoid = null;
    if (this.state !== 'take-cover') I.reload = self.mag === 0;
  }

  onDeath(tick: number, cover: CoverRegistry): void {
    if (this.state === 'dead') return;
    cover.release(this.id);
    cover.releaseFlank(this.id);
    this.state = 'dead';
    this.stateEnteredTick = Number.isFinite(tick) ? tick : this.stateEnteredTick;
    this.stats.dead++;
    const I = this.intent;
    I.goal = null;
    I.aimAt = null;
    I.avoid = null;
    I.fire = false;
    I.reload = false;
    I.crouch = false;
    I.speed = 'walk';
  }
}

interface Preds {
  seen: boolean;
  fresh: boolean;
  suspect: boolean;
  newSuspect: boolean;
  underFire: boolean;
  newHit: boolean;
  low: boolean;
}

/** @throws StrikeZoneError('ai/bad-config') for an id outside 1..20 or a missing profile. */
export function createBotBrain(
  id: EntityId,
  profile: DifficultyProfile,
  patrolNodes: readonly NavNodeId[],
): BotBrain {
  if (!Number.isInteger(id) || id < 1 || id > MAX_BOTS) {
    throw new StrikeZoneError('ai/bad-config', 'Bot id must be an integer in 1..20');
  }
  if (typeof profile !== 'object' || !Number.isFinite(profile.reactionTicks)) {
    throw new StrikeZoneError('ai/bad-config', 'Missing difficulty profile');
  }
  return new Brain(id, profile, patrolNodes);
}
