/**
 * Snapshot, stats and event fixtures for hud tests. They stand in for real
 * game-simulation output until app-shell wires it (unit-of-work, hud).
 */
import {
  botId,
  createDiagnostics,
  PLAYER_ID,
  vec3,
  type Diagnostics,
  type EntityId,
} from '../../../src/core';
import type {
  BotView,
  LoadoutView,
  RadarContact,
  RoundPhase,
  SimEvent,
  SimSnapshot,
  WeaponId,
} from '../../../src/contracts';
import type { HudStats } from '../../../src/ui/hud';

export interface SnapshotOptions {
  tick?: number;
  phase?: RoundPhase;
  timeLeftSec?: number;
  bots?: number;
  botsAlive?: number;
  health?: number;
  armor?: number;
  alive?: boolean;
  yaw?: number;
  active?: WeaponId;
  mag?: number;
  reserve?: number;
  reloading?: boolean;
  reloadProgress?: number;
  switching?: boolean;
  spread?: number;
  scoped?: boolean;
  radar?: RadarContact[];
}

export function makeLoadout(o: SnapshotOptions = {}): LoadoutView {
  const active = o.active ?? 'rifle';
  const slots = (['rifle', 'pistol', 'sniper'] as const).map((id) => ({
    id,
    mag: id === active ? (o.mag ?? 30) : 10,
    magSize: id === 'rifle' ? 30 : id === 'pistol' ? 12 : 5,
    reserve: id === active ? (o.reserve ?? 90) : 20,
  }));
  return {
    active,
    slots,
    reloading: o.reloading ?? false,
    reloadProgress: o.reloadProgress ?? 0,
    switching: o.switching ?? false,
    spread: o.spread ?? 0,
    scoped: o.scoped ?? false,
  };
}

export function makeBots(n: number, alive = n): BotView[] {
  return Array.from({ length: n }, (_, i) => ({
    id: botId(i + 1),
    pos: vec3(i * 3, 0, -10),
    yaw: 0,
    pitch: 0,
    alive: i < alive,
    deathTick: i < alive ? null : 10,
    crouch: false,
    moving: false,
    lastFireTick: -1,
    weapon: 'rifle',
  }));
}

export function makeSnapshot(o: SnapshotOptions = {}): SimSnapshot {
  const bots = makeBots(o.bots ?? 5, o.botsAlive ?? o.bots ?? 5);
  return {
    tick: o.tick ?? 0,
    phase: o.phase ?? 'live',
    countdownLeftSec: 0,
    timeLeftSec: o.timeLeftSec ?? 180,
    outcome: null,
    player: {
      pos: vec3(0, 0, 0),
      vel: vec3(),
      yaw: o.yaw ?? 0,
      pitch: 0,
      eyeHeight: 1.6,
      stance: 'stand',
      grounded: true,
      health: o.health ?? 100,
      armor: o.armor ?? 50,
      alive: o.alive ?? true,
      loadout: makeLoadout(o),
      viewKick: { pitch: 0, yaw: 0 },
      lastFireTick: -1,
    },
    bots,
    botsAlive: o.botsAlive ?? bots.length,
    radar: o.radar ?? [],
  };
}

export function makeStats(o: Partial<HudStats> = {}): HudStats {
  return { kills: 0, deaths: 0, headshots: 0, shotsFired: 0, shotsHit: 0, ...o };
}

export function contact(
  id: number,
  x: number,
  z: number,
  kind: 'seen' | 'heard' = 'seen',
  ageTicks = 0,
): RadarContact {
  return { id: botId(id), pos: vec3(x, 0, z), kind, ageTicks };
}

export function damageToPlayer(
  tick: number,
  source: number,
  fromX: number,
  fromZ: number,
  amount = 20,
): SimEvent {
  return {
    t: 'damage',
    tick,
    target: PLAYER_ID,
    source: botId(source),
    amount,
    armorLoss: 0,
    fromDir: vec3(fromX, 0, fromZ),
    headshot: false,
  };
}

export function playerHit(tick: number, target: number, headshot = false): SimEvent {
  return {
    t: 'damage',
    tick,
    target: botId(target),
    source: PLAYER_ID,
    amount: 30,
    armorLoss: 0,
    fromDir: vec3(0, 0, 1),
    headshot,
  };
}

export function kill(
  tick: number,
  killer: EntityId | number,
  victim: EntityId | number,
  weapon: WeaponId = 'rifle',
  headshot = false,
): SimEvent {
  return {
    t: 'kill',
    tick,
    killer: killer as EntityId,
    victim: victim as EntityId,
    weapon,
    headshot,
  };
}

/** Diagnostics whose sink records every first report, for assertions. */
export function recordingDiagnostics(): { diagnostics: Diagnostics; reported: string[] } {
  const reported: string[] = [];
  return { diagnostics: createDiagnostics((code) => reported.push(code)), reported };
}

/** Diagnostics that fail the test on a widget or event fault (RD-H-03). */
export function strictDiagnostics(): Diagnostics {
  return createDiagnostics((code) => {
    if (code === 'hud/widget-fault' || code === 'hud/event-fault') {
      throw new Error(`unexpected ${code}`);
    }
  });
}
