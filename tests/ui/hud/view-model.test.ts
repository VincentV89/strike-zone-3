import { describe, expect, it } from 'vitest';
import { vec3 } from '../../../src/core';
import { accuracyPct, createHudViewModel, crosshairGap, toHudViewModel } from '../../../src/ui/hud';
import { contact, makeBots, makeSnapshot, makeStats } from './fixtures';

describe('toHudViewModel: vitals and weapon (story-hud-vitals-ammo)', () => {
  it('shows ceiled health while alive, 0 when dead, and LOW below 25 (AC2)', () => {
    expect(toHudViewModel(makeSnapshot({ health: 0.4 }), makeStats()).vitals.health).toBe(1);
    const low = toHudViewModel(makeSnapshot({ health: 24 }), makeStats()).vitals;
    expect(low).toMatchObject({ health: 24, low: true });
    expect(toHudViewModel(makeSnapshot({ health: 24.2 }), makeStats()).vitals.low).toBe(false);
    const dead = toHudViewModel(makeSnapshot({ health: 10, alive: false }), makeStats()).vitals;
    expect(dead).toMatchObject({ health: 0, low: false, alive: false });
    expect(toHudViewModel(makeSnapshot({ armor: 150 }), makeStats()).vitals.armor).toBe(100);
  });

  it('reports the active slot counts, label and slot index (AC1)', () => {
    const vm = toHudViewModel(makeSnapshot({ active: 'pistol', mag: 7, reserve: 24 }), makeStats());
    expect(vm.weapon).toMatchObject({
      label: 'PISTOL',
      mag: 7,
      magSize: 12,
      reserve: 24,
      activeSlot: 1,
    });
    expect(toHudViewModel(makeSnapshot({ active: 'sniper' }), makeStats()).weapon.activeSlot).toBe(
      2,
    );
  });

  it('prompts for reload or out of ammo only when the magazine is empty and not reloading', () => {
    expect(toHudViewModel(makeSnapshot({ mag: 0, reserve: 30 }), makeStats()).weapon.prompt).toBe(
      'reload',
    );
    expect(toHudViewModel(makeSnapshot({ mag: 0, reserve: 0 }), makeStats()).weapon.prompt).toBe(
      'out-of-ammo',
    );
    expect(
      toHudViewModel(makeSnapshot({ mag: 0, reloading: true, reloadProgress: 2 }), makeStats())
        .weapon,
    ).toMatchObject({ prompt: 'none', reloadProgress: 1 });
  });

  it('reports a missing active slot and shows zeros', () => {
    const snap = makeSnapshot();
    const vm = toHudViewModel(
      { ...snap, player: { ...snap.player, loadout: { ...snap.player.loadout, slots: [] } } },
      makeStats(),
    );
    expect(vm.weapon).toMatchObject({ mag: 0, magSize: 0, reserve: 0 });
    expect(vm.faults.activeSlotMissing).toBe(true);
  });

  it('hides the crosshair while scoped, dead or ended, and widens it monotonically with spread', () => {
    expect(toHudViewModel(makeSnapshot(), makeStats()).crosshair.visible).toBe(true);
    expect(toHudViewModel(makeSnapshot({ scoped: true }), makeStats())).toMatchObject({
      scoped: true,
      crosshair: { visible: false },
    });
    expect(toHudViewModel(makeSnapshot({ alive: false }), makeStats()).crosshair.visible).toBe(
      false,
    );
    expect(toHudViewModel(makeSnapshot({ phase: 'ended' }), makeStats()).crosshair.visible).toBe(
      false,
    );
    let last = 0;
    for (let s = 0; s <= 0.1; s += 0.005) {
      const gap = crosshairGap(s);
      expect(gap).toBeGreaterThanOrEqual(last);
      last = gap;
    }
    expect(crosshairGap(0)).toBe(3);
    expect(crosshairGap(1)).toBe(48);
  });
});

describe('toHudViewModel: round info (story-hud-round-info)', () => {
  it('starts with total = alive = selected bot count and kills 0 (AC1)', () => {
    for (const n of [1, 5, 10, 20]) {
      const vm = toHudViewModel(makeSnapshot({ bots: n }), makeStats());
      expect(vm.enemies).toEqual({ alive: n, total: n, kills: 0 });
    }
  });

  it('lowers alive and raises kills in the same update after a kill (AC2)', () => {
    const vm = toHudViewModel(makeSnapshot({ bots: 5, botsAlive: 4 }), makeStats({ kills: 1 }));
    expect(vm.enemies).toEqual({ alive: 4, total: 5, kills: 1 });
    expect(toHudViewModel(makeSnapshot({ bots: 2, botsAlive: 9 }), makeStats()).enemies.alive).toBe(
      2,
    );
  });

  it('shows the configured duration without counting in countdown, and counts in live (AC3)', () => {
    const cd = toHudViewModel(makeSnapshot({ phase: 'countdown', timeLeftSec: 180 }), makeStats());
    expect(cd.timer).toMatchObject({ text: '3:00', counting: false, lastTen: false });
    const live = toHudViewModel(makeSnapshot({ phase: 'live', timeLeftSec: 75.2 }), makeStats(), {
      round: 2,
    });
    expect(live.timer).toMatchObject({ text: '1:16', counting: true, round: 2 });
    expect(toHudViewModel(makeSnapshot({ timeLeftSec: 9.5 }), makeStats()).timer.lastTen).toBe(
      true,
    );
    expect(toHudViewModel(makeSnapshot({ timeLeftSec: 0 }), makeStats()).timer.lastTen).toBe(false);
    expect(toHudViewModel(makeSnapshot(), makeStats()).timer.round).toBeNull();
  });
});

describe('toHudViewModel: sanitising (BR-H-03)', () => {
  it('turns non-finite numbers into 0 and counts them', () => {
    const vm = toHudViewModel(
      makeSnapshot({
        health: Number.NaN,
        spread: Number.POSITIVE_INFINITY,
        timeLeftSec: Number.NaN,
      }),
      makeStats({ kills: Number.NaN }),
    );
    expect(vm.vitals.health).toBe(0);
    expect(vm.crosshair.gapPx).toBe(3);
    expect(vm.timer.text).toBe('0:00');
    expect(vm.enemies.kills).toBe(0);
    expect(vm.faults.nonFinite).toBe(4);
    expect(toHudViewModel(makeSnapshot(), makeStats(), undefined, vm).faults.nonFinite).toBe(0);
  });

  it('reuses the out object and its nested pools', () => {
    const out = createHudViewModel();
    const radar = out.radar;
    const bots = out.scoreboard.bots;
    const vm = toHudViewModel(makeSnapshot(), makeStats(), { round: 1 }, out);
    expect(vm).toBe(out);
    expect(vm.radar).toBe(radar);
    expect(vm.scoreboard.bots).toBe(bots);
  });
});

describe('toHudViewModel: radar (story-radar, SD-H-04)', () => {
  it('shows only snap.radar contacts; moving snap.bots changes nothing (AC1)', () => {
    const snap = makeSnapshot({ bots: 5, radar: [contact(2, 5, -5)] });
    const a = toHudViewModel(snap, makeStats());
    const moved = {
      ...snap,
      bots: makeBots(5).map((b) => ({ ...b, pos: vec3(b.pos.x + 7, 0, b.pos.z - 3) })),
    };
    const b = toHudViewModel(moved, makeStats());
    expect(a.radarCount).toBe(1);
    expect(b.radar.slice(0, b.radarCount)).toEqual(a.radar.slice(0, a.radarCount));
    expect(toHudViewModel(makeSnapshot({ bots: 5 }), makeStats()).radarCount).toBe(0);
  });

  it('keeps a heard contact aged 60 and drops one older than 120 (AC2)', () => {
    const vm = toHudViewModel(
      makeSnapshot({ radar: [contact(1, 0, -10, 'heard', 60), contact(2, 0, -5, 'heard', 121)] }),
      makeStats(),
    );
    expect(vm.radarCount).toBe(1);
    expect(vm.radar[0]).toMatchObject({ id: 1, heard: true });
    expect(vm.radar[0]?.opacity).toBeCloseTo(0.65);
  });

  it('rotates blips about the centre as the player turns (AC3)', () => {
    const ahead = toHudViewModel(makeSnapshot({ radar: [contact(1, 0, -15)] }), makeStats());
    expect(ahead.radar[0]?.x).toBeCloseTo(0);
    expect(ahead.radar[0]?.y).toBeCloseTo(-0.5);
    const turned = toHudViewModel(
      makeSnapshot({ yaw: Math.PI / 2, radar: [contact(1, 0, -15)] }),
      makeStats(),
    );
    expect(turned.radar[0]?.x).toBeCloseTo(0.5);
    expect(turned.radar[0]?.y).toBeCloseTo(0);
  });

  it('drops contacts beyond 30 m and keeps the 20 nearest', () => {
    const many = Array.from({ length: 25 }, (_, i) => contact(i + 1, 0, -(25 - i)));
    many.push(contact(30, 0, -31));
    const vm = toHudViewModel(makeSnapshot({ radar: many }), makeStats());
    expect(vm.radarCount).toBe(20);
    const dists = vm.radar.map((b) => b.dist);
    expect(dists[0]).toBeCloseTo(1);
    expect(dists[19]).toBeCloseTo(20);
    for (let i = 1; i < 20; i++) expect(dists[i] ?? 0).toBeGreaterThanOrEqual(dists[i - 1] ?? 0);
  });

  it('skips contacts with non-finite positions or ages', () => {
    const bad = [contact(1, Number.NaN, 0), contact(2, 0, -2, 'seen', Number.NaN)];
    expect(toHudViewModel(makeSnapshot({ radar: bad }), makeStats()).radarCount).toBe(0);
  });
});

describe('toHudViewModel: scoreboard (story-scoreboard-overlay)', () => {
  it('matches tracked accuracy: hits / shots, 0 when no shots (AC3)', () => {
    expect(accuracyPct(0, 0)).toBe(0);
    expect(accuracyPct(1, 3)).toBe(33);
    const vm = toHudViewModel(
      makeSnapshot({ bots: 3, botsAlive: 2 }),
      makeStats({ kills: 1, deaths: 0, headshots: 1, shotsFired: 8, shotsHit: 6 }),
      { round: 3 },
    );
    expect(vm.scoreboard).toMatchObject({
      round: 3,
      alive: 2,
      total: 3,
      kills: 1,
      headshots: 1,
      accuracyPct: 75,
      botCount: 3,
      twoColumns: false,
    });
  });

  it('lists bots sorted by id with alive state and two columns above 10 bots', () => {
    const snap = makeSnapshot({ bots: 12, botsAlive: 4 });
    const vm = toHudViewModel({ ...snap, bots: [...snap.bots].reverse() }, makeStats());
    const sb = vm.scoreboard;
    expect(sb.twoColumns).toBe(true);
    expect(sb.bots.slice(0, sb.botCount).map((b) => b.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(sb.bots[0]?.alive).toBe(true);
    expect(sb.bots[11]?.alive).toBe(false);
  });

  it('fills at most 20 rows and flags overflow while the total stays true', () => {
    const vm = toHudViewModel(makeSnapshot({ bots: 22 }), makeStats());
    expect(vm.scoreboard.botCount).toBe(20);
    expect(vm.enemies.total).toBe(22);
    expect(vm.faults.botOverflow).toBe(22);
    expect(toHudViewModel(makeSnapshot({ bots: 0 }), makeStats()).scoreboard.botCount).toBe(0);
  });
});
