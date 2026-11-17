import { describe, expect, it } from 'vitest';
import { createRng, type Rng } from '../../src/core';
import type { SimEvent } from '../../src/contracts';
import {
  WEAPON_PROFILES,
  createFireRequest,
  createLoadout,
  createLoadoutView,
  createWeaponTrigger,
  stepWeapon,
  toLoadoutView,
  triggerFromInput,
  viewKick,
  type WeaponTrigger,
} from '../../src/weapons';
import { aim, cmd, copyingSink, id, recordingDiag, strictDiag, trig } from '../sim/helpers';

const ME = id(0);

function harness(opts: { infiniteReserve?: boolean } = {}) {
  const l = createLoadout(WEAPON_PROFILES, opts);
  const sink = copyingSink();
  const rng = createRng(42).fork('spread/0');
  const diag = strictDiag();
  const req = createFireRequest(ME);
  let tick = 0;
  const step = (t: WeaponTrigger, a = aim()) =>
    stepWeapon(l, t, a, tick++, rng, sink.emit, ME, diag, req);
  const kinds = (): string[] => sink.events.flatMap((e) => (e.t === 'weapon' ? [e.kind] : []));
  return { l, sink, step, kinds, tickNow: () => tick, setTick: (t: number) => (tick = t) };
}

/** Runs `n` ticks with the same trigger; returns how many shots fired. */
function hold(h: ReturnType<typeof harness>, t: WeaponTrigger, n: number): number {
  let shots = 0;
  for (let i = 0; i < n; i++) if (h.step(t) !== null) shots++;
  return shots;
}

describe('stepWeapon firing (BR-PC-21..24)', () => {
  it('fires the rifle once per 6 ticks while held, one round per shot', () => {
    const h = harness();
    const shots = hold(h, trig({ fire: true }), 60);
    expect(shots).toBe(10);
    expect(h.l.slots[0].mag).toBe(20);
  });

  it('returns a unit-length FireRequest with the shooter and tick', () => {
    const h = harness();
    const r = h.step(trig({ fire: true }));
    expect(r).not.toBeNull();
    expect(r?.weapon).toBe('rifle');
    expect(r?.slot).toBe(0);
    expect(r?.tick).toBe(0);
    expect(r?.shooter).toBe(ME);
    const d = r?.dir ?? { x: 0, y: 0, z: 0 };
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
    expect(d.z).toBeLessThan(-0.99); // yaw 0 faces -Z
  });

  it('fires a semi weapon once per click and drops presses during cooldown', () => {
    const h = harness();
    h.step(trig({ select: 1 }));
    for (let i = 0; i < 25; i++) h.step(trig()); // finish the 21-tick draw
    expect(h.step(trig({ fire: true, firePressed: true }))).not.toBeNull();
    // Holding fire does not fire again.
    expect(hold(h, trig({ fire: true }), 20)).toBe(0);
    h.step(trig());
    // A new press during cooldown is dropped, not buffered.
    expect(h.step(trig({ fire: true, firePressed: true }))).not.toBeNull();
    h.step(trig());
    expect(h.step(trig({ fire: true, firePressed: true }))).toBeNull();
    expect(hold(h, trig(), 12)).toBe(0);
    expect(h.l.slots[1].mag).toBe(13);
  });

  it('dry-fires on an empty magazine and never reloads by itself', () => {
    const h = harness();
    h.l.slots[0].mag = 0;
    expect(h.step(trig({ fire: true, firePressed: true }))).toBeNull();
    expect(hold(h, trig({ fire: true }), 30)).toBe(0);
    expect(h.kinds()).toEqual(['dry-fire']);
    expect(h.l.slots[0].reloadEndTick).toBe(-1);
  });

  it('cannot exceed the fire-rate caps under 1000 ticks of random input (SD-PC-09)', () => {
    for (let slot = 0; slot < 3; slot++) {
      const h = harness({ infiniteReserve: true });
      const bits = createRng(7).fork('trigger');
      h.step(trig({ select: slot as 0 | 1 | 2 }));
      h.setTick(100);
      const fired: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const fire = bits.next() < 0.8;
        const t = trig({
          fire,
          firePressed: fire && bits.next() < 0.5,
          reload: bits.next() < 0.01,
        });
        const before = h.l.slots[slot as 0 | 1 | 2].mag;
        const tick = h.tickNow();
        const seen = h.kinds().length;
        if (h.step(t) !== null) {
          fired.push(tick);
          const refilled = h.kinds().slice(seen).includes('reload-end');
          if (!refilled) expect(h.l.slots[slot as 0 | 1 | 2].mag).toBe(before - 1);
        }
      }
      const cd = WEAPON_PROFILES[slot as 0 | 1 | 2].cooldownTicks;
      for (let i = 1; i < fired.length; i++) {
        expect((fired[i] ?? 0) - (fired[i - 1] ?? 0)).toBeGreaterThanOrEqual(cd);
      }
      expect(fired.length).toBeGreaterThan(0);
    }
  });
});

describe('stepWeapon reload (BR-PC-25..27)', () => {
  it('moves ammo from reserve at reload end and blocks fire meanwhile', () => {
    const h = harness();
    hold(h, trig({ fire: true }), 30); // 5 shots
    expect(h.l.slots[0].mag).toBe(25);
    h.step(trig({ reload: true }));
    expect(h.kinds()).toEqual(['reload-start']);
    expect(hold(h, trig({ fire: true }), 131)).toBe(0);
    h.step(trig()); // tick start + 132
    expect(h.kinds()).toEqual(['reload-start', 'reload-end']);
    expect(h.l.slots[0].mag).toBe(30);
    expect(h.l.slots[0].reserve).toBe(175);
  });

  it('allows a shot on the tick the reload ends', () => {
    const h = harness();
    h.l.slots[0].mag = 10;
    h.step(trig({ reload: true }));
    hold(h, trig(), 131);
    expect(h.step(trig({ fire: true }))).not.toBeNull();
    expect(h.l.slots[0].mag).toBe(29);
  });

  it('never overfills the magazine or empties the reserve below 0', () => {
    const h = harness();
    h.l.slots[0].mag = 0;
    h.l.slots[0].reserve = 7;
    h.step(trig({ reload: true }));
    hold(h, trig(), 140);
    expect(h.l.slots[0].mag).toBe(7);
    expect(h.l.slots[0].reserve).toBe(0);
    h.step(trig({ reload: true }));
    expect(h.l.slots[0].reloadEndTick).toBe(-1); // reserve empty: no reload
  });

  it('ignores R on a full magazine', () => {
    const h = harness();
    h.step(trig({ reload: true }));
    expect(h.kinds()).toEqual([]);
  });

  it('refills bots without spending reserve (FD-PC-Q2)', () => {
    const h = harness({ infiniteReserve: true });
    h.l.slots[0].mag = 0;
    h.l.slots[0].reserve = 0;
    h.step(trig({ reload: true }));
    hold(h, trig(), 140);
    expect(h.l.slots[0].mag).toBe(30);
    expect(h.l.slots[0].reserve).toBe(0);
  });
});

describe('stepWeapon switching (BR-PC-28)', () => {
  it('selects with 1/2/3, cycles with the wheel and wraps', () => {
    const h = harness();
    h.step(trig({ select: 2 }));
    expect(h.l.active).toBe(2);
    h.step(trig({ cycle: 1 }));
    expect(h.l.active).toBe(0);
    h.step(trig({ cycle: -1 }));
    expect(h.l.active).toBe(2);
    h.step(trig({ select: 2 }));
    expect(h.kinds()).toEqual(['switch', 'switch', 'switch']);
  });

  it('lets select win over cycle on the same tick', () => {
    const h = harness();
    h.step(trig({ select: 1, cycle: 1 }));
    expect(h.l.active).toBe(1);
    h.step(trig({ select: 1, cycle: 1 }));
    expect(h.l.active).toBe(1);
  });

  it('cancels a reload with the counts unchanged and blocks fire during the draw', () => {
    const h = harness();
    h.l.slots[0].mag = 10;
    h.step(trig({ reload: true }));
    h.step(trig({ select: 1 }));
    expect(h.l.slots[0].reloadEndTick).toBe(-1);
    expect([h.l.slots[0].mag, h.l.slots[0].reserve]).toEqual([10, 180]);
    expect(hold(h, trig({ fire: true, firePressed: true }), 20)).toBe(0);
    h.step(trig()); // release
    expect(h.step(trig({ fire: true, firePressed: true }))).not.toBeNull();
  });
});

describe('stepWeapon scope (BR-PC-29)', () => {
  it('scopes only the sniper and drops the scope on reload and switch', () => {
    const h = harness();
    h.step(trig({ scope: true }));
    expect(h.l.scoped).toBe(false);
    h.step(trig({ select: 2 }));
    hold(h, trig(), 48);
    h.step(trig({ scope: true }));
    expect(h.l.scoped).toBe(true);
    h.l.slots[2].mag = 3;
    h.step(trig({ scope: true, reload: true }));
    expect(h.l.scoped).toBe(false);
    hold(h, trig(), 181);
    h.step(trig({ scope: true }));
    expect(h.l.scoped).toBe(true);
    h.step(trig({ scope: true, select: 0 }));
    expect(h.l.scoped).toBe(false);
    expect(h.kinds()).toEqual([
      'switch',
      'scope-in',
      'scope-out',
      'reload-start',
      'reload-end',
      'scope-in',
      'scope-out',
      'switch',
    ]);
  });

  it('cuts the sniper spread to 0.0012 rad while scoped', () => {
    const h = harness();
    h.step(trig({ select: 2 }));
    hold(h, trig(), 48);
    h.step(trig());
    expect(h.l.lastSpread).toBeCloseTo(0.06, 12);
    h.step(trig({ scope: true }));
    expect(h.l.lastSpread).toBeCloseTo(0.0012, 12);
  });
});

describe('spread and recoil (BR-PC-30..34)', () => {
  it('scales spread by posture', () => {
    const h = harness();
    const base = WEAPON_PROFILES[0].spread.base;
    h.step(trig(), aim({ moving: true }));
    expect(h.l.lastSpread).toBeCloseTo(base * 1.6, 12);
    h.step(trig(), aim({ grounded: false, moving: true }));
    expect(h.l.lastSpread).toBeCloseTo(base * 3, 12);
    h.step(trig(), aim({ crouched: true }));
    expect(h.l.lastSpread).toBeCloseTo(base * 0.75, 12);
  });

  it('grows bloom and kick under sustained fire and recovers within 0.5 s', () => {
    const h = harness();
    const w = h.l.slots[0];
    const spreads: number[] = [];
    for (let i = 0; i < 60; i++) {
      h.step(trig({ fire: true }));
      spreads.push(h.l.lastSpread);
    }
    expect(spreads[59]).toBeGreaterThan(spreads[0] ?? 0);
    expect(w.kickPitch).toBeCloseTo(0.12, 12);
    expect(Math.abs(w.kickYaw)).toBeLessThanOrEqual(0.008 + 1e-12);
    expect(viewKick(h.l, { pitch: 0, yaw: 0 }).pitch).toBe(w.kickPitch);
    hold(h, trig(), 6 + 30); // recovery delay plus 0.5 s
    expect(w.bloom).toBe(0);
    expect(w.kickPitch).toBe(0);
    expect(w.kickYaw).toBe(0);
    h.step(trig());
    expect(h.l.lastSpread).toBeCloseTo(WEAPON_PROFILES[0].spread.base, 12);
  });

  it('makes the first shot the most accurate: it uses the spread from before the increment', () => {
    const h = harness();
    const r = h.step(trig({ fire: true }));
    const dir = r?.dir ?? { x: 0, y: 0, z: 0 };
    const angle = Math.acos(Math.min(1, -dir.z));
    expect(angle).toBeLessThanOrEqual(WEAPON_PROFILES[0].spread.base + 1e-12);
  });

  it('draws exactly 3 values per fired shot and 0 otherwise', () => {
    const l = createLoadout(WEAPON_PROFILES);
    const inner = createRng(42).fork('spread/0');
    let draws = 0;
    const counting: Rng = {
      next: () => {
        draws++;
        return inner.next();
      },
      range: () => 0,
      int: () => 0,
      pick: <T>(xs: readonly T[]) => xs[0] as T,
      fork: () => counting,
    };
    const req = createFireRequest(ME);
    const sink = copyingSink();
    let shots = 0;
    for (let tick = 0; tick < 100; tick++) {
      if (
        stepWeapon(
          l,
          trig({ fire: true }),
          aim(),
          tick,
          counting,
          sink.emit,
          ME,
          strictDiag(),
          req,
        ) !== null
      )
        shots++;
    }
    expect(shots).toBe(17);
    expect(draws).toBe(51);
    stepWeapon(l, trig(), aim(), 200, counting, sink.emit, ME, strictDiag(), req);
    expect(draws).toBe(51);
  });
});

describe('guards (SD-PC-06)', () => {
  it('skips only the fire branch on a non-finite aim', () => {
    const l = createLoadout(WEAPON_PROFILES);
    l.slots[0].mag = 10;
    const diag = recordingDiag();
    const sink = copyingSink();
    const rng = createRng(1);
    const req = createFireRequest(ME);
    const bad = aim({ yaw: Number.NaN });
    expect(
      stepWeapon(l, trig({ fire: true, reload: true }), bad, 0, rng, sink.emit, ME, diag, req),
    ).toBeNull();
    expect(l.slots[0].reloadEndTick).toBe(132);
    stepWeapon(
      l,
      trig({ select: 1 }),
      aim({ origin: { x: Infinity, y: 0, z: 0 } }),
      1,
      rng,
      sink.emit,
      ME,
      diag,
      req,
    );
    expect(l.active).toBe(1);
    expect(diag.codes).toEqual(['weapons/bad-aim']);
  });

  it('ignores off-type select and cycle values', () => {
    const l = createLoadout(WEAPON_PROFILES);
    const t = { ...trig(), select: 7, cycle: 3 } as unknown as WeaponTrigger;
    stepWeapon(
      l,
      t,
      aim(),
      0,
      createRng(1),
      () => undefined,
      ME,
      strictDiag(),
      createFireRequest(ME),
    );
    expect(l.active).toBe(0);
  });
});

describe('views (SD-PC-09)', () => {
  it('copies the loadout into the view and reports reload progress', () => {
    const h = harness();
    hold(h, trig({ fire: true }), 6);
    h.step(trig({ reload: true })); // tick 6, ends 138
    const view = createLoadoutView();
    toLoadoutView(h.l, 72, view);
    expect(view.active).toBe('rifle');
    expect(view.slots.map((s) => [s.id, s.mag, s.magSize, s.reserve])).toEqual([
      ['rifle', 29, 30, 180],
      ['pistol', 15, 15, 90],
      ['sniper', 5, 5, 25],
    ]);
    expect(view.reloading).toBe(true);
    expect(view.reloadProgress).toBeCloseTo(0.5, 12);
    expect(view.switching).toBe(false);
    expect(view.spread).toBe(h.l.lastSpread);
    toLoadoutView(h.l, 500, view);
    expect(view.reloadProgress).toBe(1);
  });

  it('never lets a view write reach the loadout', () => {
    const l = createLoadout(WEAPON_PROFILES);
    const before = structuredClone(l);
    const view = toLoadoutView(l, 0, createLoadoutView());
    const slot = view.slots[0] as { mag: number; reserve: number };
    slot.mag = 999;
    slot.reserve = -5;
    Object.assign(view, { active: 'sniper', spread: 9, scoped: true });
    expect(l).toEqual(before);
  });

  it('shows magSize x 99 for an infinite reserve', () => {
    const view = toLoadoutView(
      createLoadout(WEAPON_PROFILES, { infiniteReserve: true }),
      0,
      createLoadoutView(),
    );
    expect(view.slots[0]?.reserve).toBe(30 * 99);
  });

  it('copies the trigger from InputCommand and rejects off-type values', () => {
    const t = triggerFromInput(
      cmd({ fire: true, firePressed: true, scope: true, select: 2, cycle: -1 }),
      createWeaponTrigger(),
    );
    expect(t).toEqual({
      fire: true,
      firePressed: true,
      reload: false,
      scope: true,
      select: 2,
      cycle: -1,
    });
    const odd = cmd({ select: 5 as unknown as 0, cycle: 2 as unknown as 1 });
    expect(triggerFromInput(odd, createWeaponTrigger())).toMatchObject({ select: null, cycle: 0 });
  });
});

describe('event aliasing contract (SD-PC-10)', () => {
  it('reuses one scratch event object, so a sink that keeps references sees the last values', () => {
    const l = createLoadout(WEAPON_PROFILES);
    const kept: SimEvent[] = [];
    const req = createFireRequest(ME);
    stepWeapon(
      l,
      trig({ select: 1 }),
      aim(),
      0,
      createRng(1),
      (e) => kept.push(e),
      ME,
      strictDiag(),
      req,
    );
    l.slots[1].mag = 0;
    stepWeapon(
      l,
      trig({ firePressed: true, fire: true }),
      aim(),
      30,
      createRng(1),
      (e) => kept.push(e),
      ME,
      strictDiag(),
      req,
    );
    expect(kept).toHaveLength(2);
    expect(kept[0]).toBe(kept[1]);
    expect(kept[0]).toMatchObject({ kind: 'dry-fire', tick: 30 });
  });
});
