import { describe, expect, it } from 'vitest';
import {
  clearKills,
  createKillFeedRing,
  expireKills,
  killRowOpacity,
  pushKill,
  rowNewestFirst,
} from '../../../src/ui/hud/kill-feed/ring';
import {
  arcOpacity,
  clearArcs,
  clearHitMarker,
  clearVignette,
  createArcPool,
  createHitMarker,
  createVignette,
  expireArcs,
  recordArc,
  triggerHitMarker,
  triggerVignette,
  visibleHitMarker,
  vignetteOpacity,
} from '../../../src/ui/hud/model/transients';

describe('hit marker', () => {
  it('shows a body marker for 9 ticks and a headshot marker for 15', () => {
    const m = createHitMarker();
    triggerHitMarker(m, 'body', 100, 1);
    expect(visibleHitMarker(m, 100)).toBe('body');
    expect(visibleHitMarker(m, 108)).toBe('body');
    expect(visibleHitMarker(m, 109)).toBeNull();
    triggerHitMarker(m, 'head', 200, 2);
    expect(visibleHitMarker(m, 214)).toBe('head');
    expect(visibleHitMarker(m, 215)).toBeNull();
  });

  it('lets a headshot win within one feed batch and restarts on a new batch', () => {
    const m = createHitMarker();
    triggerHitMarker(m, 'head', 10, 1);
    triggerHitMarker(m, 'body', 10, 1);
    expect(visibleHitMarker(m, 10)).toBe('head');
    triggerHitMarker(m, 'body', 12, 2);
    expect(visibleHitMarker(m, 12)).toBe('body');
    expect(visibleHitMarker(m, 11)).toBeNull(); // before its tick
    clearHitMarker(m);
    expect(visibleHitMarker(m, 12)).toBeNull();
  });
});

describe('damage arc pool (story-damage-direction)', () => {
  it('normalises the XZ direction and fades over 60 ticks', () => {
    const pool = createArcPool();
    expect(recordArc(pool, 1, -3, 0, 0)).toBe(true);
    const [arc] = pool;
    if (arc === undefined) throw new Error('empty pool');
    expect(arc.dirX).toBeCloseTo(-1);
    expect(arcOpacity(arc, 30)).toBeCloseTo(0.5);
    expect(arcOpacity(arc, 60)).toBe(0);
    expect(arcOpacity(arc, -1)).toBe(0);
    expireArcs(pool, 60);
    expect(arc.active).toBe(false);
  });

  it('refreshes the slot of a source that already has a live arc', () => {
    const pool = createArcPool();
    recordArc(pool, 1, 1, 0, 0);
    recordArc(pool, 1, 0, 1, 10);
    expect(pool.filter((a) => a.active)).toHaveLength(1);
    expect(pool[0]?.dirZ).toBeCloseTo(1);
    expect(pool[0]?.startTick).toBe(10);
  });

  it('keeps at most 4 arcs and replaces the oldest', () => {
    const pool = createArcPool();
    for (let s = 1; s <= 5; s++) recordArc(pool, s, 1, 0, s);
    expect(pool).toHaveLength(4);
    expect(pool.map((a) => a.sourceId).sort()).toEqual([2, 3, 4, 5]);
  });

  it('draws no arc for a vertical hit', () => {
    const pool = createArcPool();
    expect(recordArc(pool, 1, 0, 0, 0)).toBe(false);
    expect(recordArc(pool, 1, Number.NaN, 0, 0)).toBe(false);
    clearArcs(pool);
    expect(pool.every((a) => !a.active)).toBe(true);
  });
});

describe('damage vignette (WCAG 2.3.1)', () => {
  it('gives at most one rise per 20 ticks for 10 hits 1 tick apart', () => {
    const v = createVignette();
    for (let t = 0; t < 10; t++) triggerVignette(v, 20, t, t + 1);
    expect(v.rises).toBe(1);
    for (let t = 0; t < 120; t++) triggerVignette(v, 5, t, 100 + t);
    expect(v.rises).toBeLessThanOrEqual(6); // 120 ticks = 2 s, at most 3 rises per second
  });

  it('merges hits in one batch, caps the peak at 0.6 and fades over 36 ticks', () => {
    const v = createVignette();
    triggerVignette(v, 10, 50, 1);
    expect(v.peak).toBeCloseTo(0.3);
    triggerVignette(v, 30, 50, 1);
    expect(v.peak).toBeCloseTo(0.6);
    triggerVignette(v, 100, 51, 1);
    expect(v.peak).toBe(0.6);
    expect(v.rises).toBe(1);
    expect(vignetteOpacity(v, 50, false)).toBeCloseTo(0.6);
    expect(vignetteOpacity(v, 68, false)).toBeCloseTo(0.3);
    expect(vignetteOpacity(v, 86, false)).toBe(0);
    expect(vignetteOpacity(v, 68, true)).toBeCloseTo(0.6);
    expect(vignetteOpacity(v, 49, false)).toBe(0);
  });

  it('leaves the vignette unchanged for damage inside the cooldown from another batch', () => {
    const v = createVignette();
    triggerVignette(v, 0, 0, 1);
    triggerVignette(v, 40, 5, 2);
    expect(v.peak).toBeCloseTo(0.2);
    triggerVignette(v, 40, 20, 3);
    expect(v.rises).toBe(2);
    clearVignette(v);
    expect(vignetteOpacity(v, 20, false)).toBe(0);
  });
});

describe('kill-feed ring (story-kill-feed)', () => {
  it('adds a row with killer, weapon tag, headshot and victim', () => {
    const ring = createKillFeedRing();
    pushKill(ring, 0, 3, 'sniper', true, 10);
    const row = rowNewestFirst(ring, 0);
    expect(row).toMatchObject({
      active: true,
      killerLabel: 'YOU',
      weaponTag: '[SNIPER]',
      headshot: true,
      victimLabel: 'BOT 03',
      involvesPlayer: true,
    });
  });

  it('removes a row 300 ticks after it appears and fades it over the last 18 (AC2)', () => {
    const ring = createKillFeedRing();
    pushKill(ring, 1, 2, 'rifle', false, 0);
    const row = rowNewestFirst(ring, 0);
    if (row === undefined) throw new Error('no row');
    expect(row.involvesPlayer).toBe(false);
    expect(killRowOpacity(row, 281, false)).toBe(1);
    expect(killRowOpacity(row, 291, false)).toBeCloseTo(0.5);
    expect(killRowOpacity(row, 291, true)).toBe(1);
    expect(killRowOpacity(row, 300, false)).toBe(0);
    expireKills(ring, 299);
    expect(row.active).toBe(true);
    expireKills(ring, 300);
    expect(row.active).toBe(false);
  });

  it('keeps 4 rows and drops the oldest first', () => {
    const ring = createKillFeedRing();
    for (let v = 1; v <= 5; v++) pushKill(ring, 0, v, 'rifle', false, v);
    const labels = [0, 1, 2, 3].map((i) => rowNewestFirst(ring, i)?.victimLabel);
    expect(labels).toEqual(['BOT 05', 'BOT 04', 'BOT 03', 'BOT 02']);
    clearKills(ring);
    expect(ring.rows.every((r) => !r.active)).toBe(true);
  });
});
