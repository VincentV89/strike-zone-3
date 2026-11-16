/**
 * HudViewModel and its pure derivation (business-logic-model-hud,
 * View-Model Derivation). toHudViewModel reads the snapshot, stats and
 * context, writes into `out` (kernel convention: hot paths pass a scratch
 * object) and has no side effects. Non-finite numbers become 0 and are
 * counted in `faults`, which the Hud reports through Diagnostics.
 */
import type { RoundPhase, SimSnapshot, WeaponId } from '../../contracts';
import { clockSeconds, clockText } from './model/format';
import { WEAPON_ORDER, weaponLabel, type WeaponPrompt } from './model/labels';
import { LOW_HEALTH_BELOW, MAX_SCOREBOARD_BOTS } from './model/timing';
import { createRadarBlips, projectRadar, type RadarBlip } from './radar/project';

/** The five round statistics the HUD reads. match-stats' RoundStats must satisfy it. */
export interface HudStats {
  kills: number;
  deaths: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
}

/** 1-based round number in the session; null hides "ROUND n". */
export interface HudContext {
  round: number | null;
}

/** One scoreboard bot row. Deliberately no position or AI state (SD-H-04). */
export interface ScoreboardBotRow {
  id: number;
  alive: boolean;
}

export interface ScoreboardVM {
  round: number | null;
  timeText: string;
  alive: number;
  total: number;
  kills: number;
  deaths: number;
  headshots: number;
  accuracyPct: number;
  /** Rows in use (at most 20). */
  botCount: number;
  bots: ScoreboardBotRow[];
  twoColumns: boolean;
}

export interface HudFaults {
  nonFinite: number;
  activeSlotMissing: boolean;
  /** bots.length when it exceeds the 20-row pool, else 0. */
  botOverflow: number;
}

export interface HudViewModel {
  tick: number;
  phase: RoundPhase;
  vitals: { health: number; armor: number; low: boolean; alive: boolean };
  weapon: {
    active: WeaponId;
    label: string;
    mag: number;
    magSize: number;
    reserve: number;
    activeSlot: 0 | 1 | 2;
    reloading: boolean;
    reloadProgress: number;
    switching: boolean;
    prompt: WeaponPrompt;
  };
  crosshair: { visible: boolean; gapPx: number };
  scoped: boolean;
  timer: {
    text: string;
    seconds: number;
    counting: boolean;
    lastTen: boolean;
    round: number | null;
  };
  enemies: { alive: number; total: number; kills: number };
  view: { yaw: number };
  /** Fixed pool of 20; `radarCount` marks the live prefix. Should: deleted with radar/. */
  radar: RadarBlip[];
  radarCount: number;
  /** Should: deleted with scoreboard/. */
  scoreboard: ScoreboardVM;
  faults: HudFaults;
}

/** A fresh scratch view model. Hot paths create one and reuse it every frame. */
export function createHudViewModel(): HudViewModel {
  return {
    tick: 0,
    phase: 'countdown',
    vitals: { health: 0, armor: 0, low: false, alive: false },
    weapon: {
      active: 'rifle',
      label: weaponLabel('rifle'),
      mag: 0,
      magSize: 0,
      reserve: 0,
      activeSlot: 0,
      reloading: false,
      reloadProgress: 0,
      switching: false,
      prompt: 'none',
    },
    crosshair: { visible: false, gapPx: 3 },
    scoped: false,
    timer: { text: clockText(0), seconds: 0, counting: false, lastTen: false, round: null },
    enemies: { alive: 0, total: 0, kills: 0 },
    view: { yaw: 0 },
    radar: createRadarBlips(),
    radarCount: 0,
    scoreboard: {
      round: null,
      timeText: clockText(0),
      alive: 0,
      total: 0,
      kills: 0,
      deaths: 0,
      headshots: 0,
      accuracyPct: 0,
      botCount: 0,
      bots: Array.from({ length: MAX_SCOREBOARD_BOTS }, () => ({ id: 0, alive: false })),
      twoColumns: false,
    },
    faults: { nonFinite: 0, activeSlotMissing: false, botOverflow: 0 },
  };
}

function fin(vm: HudViewModel, x: number): number {
  if (Number.isFinite(x)) return x;
  vm.faults.nonFinite++;
  return 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Crosshair gap at the 1080p reference: 3 + 600 px/rad x spread, 3..48 (BR-H-15). */
export function crosshairGap(spread: number): number {
  return clamp(Math.round(3 + 600 * spread), 3, 48);
}

/** Accuracy as a whole percentage; 0 when no shots were fired (BR-H-16). */
export function accuracyPct(shotsHit: number, shotsFired: number): number {
  return shotsFired > 0 ? Math.round((100 * shotsHit) / shotsFired) : 0;
}

function deriveVitals(snap: Readonly<SimSnapshot>, vm: HudViewModel): void {
  const p = snap.player;
  const alive = p.alive;
  const health = alive ? Math.ceil(clamp(fin(vm, p.health), 0, 100)) : 0;
  vm.vitals.alive = alive;
  vm.vitals.health = health;
  vm.vitals.armor = Math.ceil(clamp(fin(vm, p.armor), 0, 100));
  vm.vitals.low = alive && health < LOW_HEALTH_BELOW;
}

function deriveWeapon(snap: Readonly<SimSnapshot>, vm: HudViewModel): void {
  const lo = snap.player.loadout;
  const w = vm.weapon;
  w.active = lo.active;
  w.label = weaponLabel(lo.active);
  let found = false;
  for (const slot of lo.slots) {
    if (slot.id !== lo.active) continue;
    w.mag = Math.max(0, Math.round(fin(vm, slot.mag)));
    w.magSize = Math.max(0, Math.round(fin(vm, slot.magSize)));
    w.reserve = Math.max(0, Math.round(fin(vm, slot.reserve)));
    found = true;
    break;
  }
  if (!found) {
    w.mag = 0;
    w.magSize = 0;
    w.reserve = 0;
    vm.faults.activeSlotMissing = true;
  }
  const index = WEAPON_ORDER.indexOf(lo.active);
  w.activeSlot = index === 1 ? 1 : index === 2 ? 2 : 0;
  w.reloading = lo.reloading;
  w.reloadProgress = clamp(fin(vm, lo.reloadProgress), 0, 1);
  w.switching = lo.switching;
  w.prompt = w.mag === 0 && !w.reloading ? (w.reserve > 0 ? 'reload' : 'out-of-ammo') : 'none';
  vm.scoped = lo.scoped;
  vm.crosshair.visible = vm.vitals.alive && !lo.scoped && snap.phase !== 'ended';
  vm.crosshair.gapPx = crosshairGap(fin(vm, lo.spread));
}

function deriveRound(
  snap: Readonly<SimSnapshot>,
  stats: Readonly<HudStats>,
  round: number | null,
  vm: HudViewModel,
): void {
  const timeLeft = fin(vm, snap.timeLeftSec);
  const seconds = clockSeconds(timeLeft);
  vm.timer.seconds = seconds;
  vm.timer.text = clockText(seconds);
  vm.timer.counting = snap.phase === 'live';
  vm.timer.lastTen = snap.phase === 'live' && timeLeft > 0 && timeLeft <= 10;
  vm.timer.round = round;
  const total = snap.bots.length;
  vm.enemies.total = total;
  vm.enemies.alive = clamp(Math.round(fin(vm, snap.botsAlive)), 0, total);
  vm.enemies.kills = Math.max(0, Math.round(fin(vm, stats.kills)));
}

function deriveScoreboard(
  snap: Readonly<SimSnapshot>,
  stats: Readonly<HudStats>,
  vm: HudViewModel,
): void {
  const sb = vm.scoreboard;
  sb.round = vm.timer.round;
  sb.timeText = vm.timer.text;
  sb.alive = vm.enemies.alive;
  sb.total = vm.enemies.total;
  sb.kills = vm.enemies.kills;
  sb.deaths = Math.max(0, Math.round(fin(vm, stats.deaths)));
  sb.headshots = Math.max(0, Math.round(fin(vm, stats.headshots)));
  sb.accuracyPct = clamp(accuracyPct(fin(vm, stats.shotsHit), fin(vm, stats.shotsFired)), 0, 100);
  const n = Math.min(snap.bots.length, sb.bots.length);
  vm.faults.botOverflow = snap.bots.length > sb.bots.length ? snap.bots.length : 0;
  // Rows sorted by id with a bounded insertion over the fixed pool (no sort allocation).
  let count = 0;
  for (const bot of snap.bots) {
    let at = count;
    while (at > 0 && (sb.bots[at - 1]?.id ?? 0) > bot.id) at--;
    if (at >= n) continue;
    const last = count < n ? count : n - 1;
    for (let j = last; j > at; j--) {
      const src = sb.bots[j - 1];
      const dst = sb.bots[j];
      if (src !== undefined && dst !== undefined) {
        dst.id = src.id;
        dst.alive = src.alive;
      }
    }
    const row = sb.bots[at];
    if (row === undefined) continue;
    row.id = bot.id;
    row.alive = bot.alive;
    if (count < n) count++;
  }
  sb.botCount = count;
  sb.twoColumns = snap.bots.length > 10;
}

/**
 * Projects a snapshot into the HUD view model (pure). Pass `out` on the hot
 * path; without it a fresh object is allocated.
 */
export function toHudViewModel(
  snap: Readonly<SimSnapshot>,
  stats: Readonly<HudStats>,
  ctx?: Readonly<HudContext>,
  out?: HudViewModel,
): HudViewModel {
  const vm = out ?? createHudViewModel();
  vm.faults.nonFinite = 0;
  vm.faults.activeSlotMissing = false;
  vm.faults.botOverflow = 0;
  vm.tick = Math.round(fin(vm, snap.tick));
  vm.phase = snap.phase;
  vm.view.yaw = fin(vm, snap.player.yaw);
  deriveVitals(snap, vm);
  deriveWeapon(snap, vm);
  deriveRound(snap, stats, ctx?.round ?? null, vm);
  vm.radarCount = projectRadar(snap.radar, snap.player, vm.radar);
  deriveScoreboard(snap, stats, vm);
  return vm;
}
