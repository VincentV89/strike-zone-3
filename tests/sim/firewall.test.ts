/**
 * Information firewall at pipeline level (ADR-005, SEC-GS-04, SD-GS-01).
 * Twins share seed and config; from tick d only twin B's player moves. Until
 * each bot's next due sense, nothing the bot does may depend on the player's
 * new position. A divergence twin proves the comparison is not vacuous.
 */
import { describe, expect, it } from 'vitest';
import type { BotView, SimSnapshot } from '../../src/contracts';
import { hunter, idle, type Driver } from './drivers';
import { COUNTDOWN, MAPS, rig } from './fixtures';
import { cmd } from './helpers';

const D = COUNTDOWN + 60;
const SENSE_INTERVAL = 3; // 20 Hz

const intentFields = (b: BotView) => ({
  pos: { ...b.pos },
  yaw: b.yaw,
  pitch: b.pitch,
  crouch: b.crouch,
  moving: b.moving,
  lastFireTick: b.lastFireTick,
});

function twins(
  map: (typeof MAPS)[number],
  seed: number,
  after: (b: ReturnType<typeof rig>) => Driver,
) {
  const a = rig({ map, bots: 5, seed, difficulty: 'normal' }, { allowed: ['ai/few-patrol-nodes'] });
  const b = rig({ map, bots: 5, seed, difficulty: 'normal' }, { allowed: ['ai/few-patrol-nodes'] });
  const bDrive = after(b);
  const views: { a: SimSnapshot['bots']; b: SimSnapshot['bots']; tick: number }[] = [];
  return {
    a,
    b,
    step(n: number) {
      for (let i = 0; i < n; i++) {
        const t = a.sim.snapshot().tick + 1;
        a.sim.step(idle(a.sim.snapshot()));
        b.sim.step(t >= D ? bDrive(b.sim.snapshot()) : idle(b.sim.snapshot()));
        a.sim.drainEvents();
        b.sim.drainEvents();
        views.push({
          tick: t,
          a: structuredClone(a.sim.snapshot().bots),
          b: structuredClone(b.sim.snapshot().bots),
        });
      }
    },
    views,
  };
}

describe('information firewall (full pipeline)', () => {
  it.each(MAPS)(
    '%s: moving the player between sense ticks changes no bot before its next sense',
    (map) => {
      const tw = twins(map, 13, () => () => cmd({ move: { x: 1, z: 0 }, sprint: true }));
      tw.step(D + 12);
      const at = tw.views.find((v) => v.tick === D - 1);
      if (at === undefined) throw new Error('no view');
      // Precondition: no bot is within separation range of the player at d (spawns are >= 20 m).
      const p = tw.a.sim.snapshot().player.pos;
      for (const bot of at.a)
        expect(Math.hypot(bot.pos.x - p.x, bot.pos.z - p.z)).toBeGreaterThan(5);
      let compared = 0;
      for (const bot of at.a) {
        let s = D;
        while ((s + bot.id) % SENSE_INTERVAL !== 0) s++;
        for (const v of tw.views) {
          if (v.tick < D || v.tick >= s) continue;
          const va = v.a.find((x) => x.id === bot.id);
          const vb = v.b.find((x) => x.id === bot.id);
          if (va === undefined || vb === undefined) throw new Error('missing bot');
          expect(intentFields(vb)).toEqual(intentFields(va));
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(0);
      // The twins' players really diverged.
      const pb = tw.b.sim.snapshot().player.pos;
      expect(Math.hypot(pb.x - p.x, pb.z - p.z)).toBeGreaterThan(0.5);
    },
  );

  it.each(MAPS)('%s: divergence twin: a player walking into view changes bot behaviour', (map) => {
    const tw = twins(map, 13, (b) => hunter(b.map, { fire: false }));
    let diverged = false;
    for (let i = 0; i < 40 && !diverged; i++) {
      tw.step(100);
      const v = tw.views[tw.views.length - 1];
      if (v === undefined) break;
      diverged = v.a.some((bot, k) => {
        const other = v.b[k];
        return (
          other !== undefined &&
          JSON.stringify(intentFields(bot)) !== JSON.stringify(intentFields(other))
        );
      });
      if (tw.b.sim.snapshot().phase === 'ended') diverged = true;
    }
    expect(diverged).toBe(true);
  });
});
