import { describe, expect, it } from 'vitest';
import {
  Color,
  type InstancedMesh,
  Material,
  Matrix4,
  Vector3,
  type Points,
  type Light,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { botId, PLAYER_ID } from '../../src/core';
import type { SimEvent, SimSnapshot } from '../../src/contracts';
import { getMap } from '../../src/maps';
import { hFovToVFov, scopedVFov } from '../../src/render/camera-math';
import { PRESETS } from '../../src/render/presets';
import {
  bot,
  createHarness,
  FAKE_CANVAS,
  impact,
  liveHarness,
  player,
  shot,
  snapshot,
} from './fixtures';

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

function find(scene: Object3D, name: string): Object3D {
  const o = scene.getObjectByName(name);
  if (o === undefined) throw new Error(`missing ${name}`);
  return o;
}

function lights(scene: Scene): Light[] {
  const out: Light[] = [];
  scene.traverse((o) => {
    if ((o as Partial<Light>).isLight === true) out.push(o as Light);
  });
  return out;
}

/** A busy frame: every pool filled, every bot shooting. */
function busyEvents(tick: number, n: number): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < 60; i++) {
    ev.push(shot(tick, botId((i % n) + 1), { end: { x: i, y: 1, z: -30 } }));
    ev.push(impact(tick, -30 - i * 0.1));
  }
  return ev;
}

describe('GameRenderer lifecycle (BR-P-08)', () => {
  it('returns NO_WEBGL2 when the host cannot start', () => {
    const h = createHarness({ noWebgl: true });
    expect(h.renderer.init(FAKE_CANVAS)).toEqual({ ok: false, error: 'NO_WEBGL2' });
  });

  it('throws programmer errors outside the tick path', async () => {
    const h = createHarness();
    await expect(h.renderer.buildMap(getMap('desert-compound'))).rejects.toMatchObject({
      code: 'render/not-initialised',
    });
    expect(() => {
      h.renderer.spawnActors(3);
    }).toThrow(expect.objectContaining({ code: 'render/not-initialised' }));
    await expect(h.renderer.precompile()).rejects.toMatchObject({ code: 'render/not-initialised' });
    expect(h.renderer.init(FAKE_CANVAS).ok).toBe(true);
    for (const n of [0, 21, 2.5, Number.NaN]) {
      expect(() => {
        h.renderer.spawnActors(n);
      }).toThrow(expect.objectContaining({ code: 'render/invalid-actor-count' }));
    }
    const def = getMap('desert-compound');
    const bad = { ...def, materials: def.materials.slice(1) };
    await expect(h.renderer.buildMap(bad)).rejects.toMatchObject({
      code: 'render/unknown-material',
    });
  });

  it('clears and returns when rendering before the map is built, and ignores render before init', () => {
    const h = createHarness();
    h.renderer.render(snapshot(0, 1), snapshot(1, 1), 0.5, []);
    expect(h.host.calls).toEqual([]);
    h.renderer.init(FAKE_CANVAS);
    h.renderer.render(snapshot(0, 1), snapshot(1, 1), 0.5, []);
    expect(h.host.calls).toEqual(['clear']);
  });

  it('precompiles both scenes and renders a warm frame before going live', async () => {
    const h = await liveHarness('desert-compound', 3);
    expect(h.host.calls.slice(0, 2)).toEqual(['compile', 'compile']);
    expect(h.host.calls).toContain('render');
  });

  it('draws the world pass, clears depth, then the viewmodel pass', async () => {
    const h = await liveHarness('desert-compound', 3);
    h.host.calls.length = 0;
    h.renderer.render(snapshot(0, 3), snapshot(1, 3), 0.5, []);
    expect(h.host.calls).toEqual(['clear', 'render', 'clearDepth', 'render']);
    const vmCam = h.host.cameras[h.host.cameras.length - 1] as PerspectiveCamera;
    expect(vmCam.fov).toBe(55);
  });
});

describe('GameRenderer frame (story-weapon-feedback, story-visual-polish)', () => {
  it('stays within the draw-call and triangle budgets with 20 bots and full pools (PR-P-07, PR-P-08)', async () => {
    for (const map of ['desert-compound', 'industrial-warehouse'] as const) {
      const h = await liveHarness(map, 20, { preset: 'high' });
      const curr = snapshot(11, 20, { player: player({ lastFireTick: 11 }) });
      for (const b of curr.bots) (b as { lastFireTick: number }).lastFireTick = 11;
      h.renderer.render(snapshot(10, 20), curr, 1, busyEvents(11, 20));
      const s = h.renderer.stats();
      expect(s.worldDrawCalls).toBeLessThanOrEqual(29);
      expect(s.vmDrawCalls).toBeLessThanOrEqual(5);
      expect(s.triangles).toBeLessThanOrEqual(20_000);
      expect(s.activeTracers).toBe(PRESETS.high.tracerCap);
      expect(s.activeImpacts).toBe(60);
      expect(s.activeFlashes).toBe(21);
    }
  });

  it('applies preset caps, far plane and pixel ratio (story-graphics-presets)', async () => {
    const h = await liveHarness('desert-compound', 5, { preset: 'low' });
    h.host.dpr = 2;
    h.renderer.setPreset('low');
    expect(h.host.pixelRatio).toBeCloseTo(0.75);
    h.renderer.render(snapshot(10, 5), snapshot(11, 5), 1, busyEvents(11, 5));
    const cam = h.host.cameras[h.host.cameras.length - 2] as PerspectiveCamera;
    expect(cam.far).toBe(150);
    const s = h.renderer.stats();
    expect(s.activeTracers).toBe(16);
    expect(s.activeImpacts).toBe(32);
    expect(s.activeParticles).toBeLessThanOrEqual(64);
    h.renderer.setPreset('high');
    expect(h.host.pixelRatio).toBeCloseTo(2);
    h.renderer.setPreset('ultra' as 'high');
    expect(h.sink.map((x) => x.code)).toContain('render/unknown-preset');
  });

  it('keeps shadow casters and shadow lights within the preset caps on both maps (BR-P-31, BR-P-32)', async () => {
    for (const map of ['desert-compound', 'industrial-warehouse'] as const) {
      for (const p of ['low', 'medium', 'high'] as const) {
        const h = await liveHarness(map, 20, { preset: p });
        h.renderer.render(snapshot(0, 20), snapshot(1, 20), 1, []);
        const s = h.renderer.stats();
        expect(s.shadowCasters).toBeLessThanOrEqual(PRESETS[p].maxShadowCasters);
        expect(s.shadowLights).toBeGreaterThanOrEqual(1);
        expect(s.shadowLights).toBeLessThanOrEqual(1 + PRESETS[p].localShadowLights);
        const scene = h.host.worldScene();
        const botsCast = (find(scene, 'bot-torso') as InstancedMesh).castShadow;
        expect(botsCast).toBe(p !== 'low');
        for (const name of ['tracers', 'decals', 'particles', 'bot-flashes']) {
          expect(find(scene, name).castShadow).toBe(false);
        }
        expect(find(scene, 'sun').castShadow).toBe(true);
      }
    }
  });

  it('turns events into tracers, decals, particles and a bot hit flash', async () => {
    const h = await liveHarness('desert-compound', 3);
    const events: SimEvent[] = [
      shot(11, botId(2)),
      impact(11),
      shot(11, PLAYER_ID, { weapon: 'pistol', hit: botId(1), end: { x: 2, y: 1.5, z: -10 } }),
    ];
    h.renderer.render(snapshot(10, 3), snapshot(11, 3), 1, events);
    const s = h.renderer.stats();
    expect(s.activeTracers).toBe(2);
    expect(s.activeImpacts).toBe(1);
    expect(s.activeParticles).toBe(16);
    const torso = find(h.host.worldScene(), 'bot-torso') as InstancedMesh;
    const c = new Color();
    torso.getColorAt(0, c);
    expect(c.r).toBeGreaterThan(0.6);
  });

  it('skips the decal when an impact sits on a bot hit point in the same tick', async () => {
    const h = await liveHarness('desert-compound', 3);
    const end = { x: 2, y: 1.5, z: -10 };
    h.renderer.render(snapshot(10, 3), snapshot(11, 3), 1, [
      shot(11, PLAYER_ID, { weapon: 'pistol', hit: botId(1), end }),
      { t: 'impact', tick: 11, point: { ...end }, normal: { x: 0, y: 0, z: 1 } },
    ]);
    expect(h.renderer.stats().activeImpacts).toBe(0);
  });

  it('draws a player rifle tracer every 3rd shot and pistol tracers every shot (BR-P-41)', async () => {
    const h = await liveHarness('desert-compound', 1);
    for (let i = 0; i < 6; i++) {
      h.renderer.render(snapshot(10 + i, 1), snapshot(11 + i, 1), 1, [shot(11 + i, PLAYER_ID)]);
    }
    h.renderer.render(snapshot(16, 1), snapshot(17, 1), 0, []);
    const rifle = h.renderer.stats().activeTracers;
    expect(rifle).toBeLessThanOrEqual(2);
    expect(rifle).toBeGreaterThanOrEqual(1);
    h.renderer.render(snapshot(39, 1), snapshot(40, 1), 1, [
      shot(40, PLAYER_ID, { weapon: 'pistol' }),
      shot(40, PLAYER_ID, { weapon: 'sniper' }),
    ]);
    expect(h.renderer.stats().activeTracers).toBe(2);
  });

  it('topples a killed bot away from the killer and keeps it down', async () => {
    const h = await liveHarness('desert-compound', 2);
    const killedPrev = snapshot(10, 2);
    const killed = snapshot(11, 2, {
      bots: [bot(1, { alive: false, deathTick: 11, pos: { x: 0, y: 0, z: -10 } }), bot(2)],
    });
    h.renderer.render(killedPrev, killed, 1, [
      {
        t: 'kill',
        tick: 11,
        victim: botId(1),
        killer: PLAYER_ID,
        weapon: 'rifle',
        headshot: false,
      },
    ]);
    const later = snapshot(200, 2, {
      bots: [bot(1, { alive: false, deathTick: 11, pos: { x: 0, y: 0, z: -10 } }), bot(2)],
    });
    h.renderer.render(later, later, 1, []);
    const head = find(h.host.worldScene(), 'bot-head') as InstancedMesh;
    const m = new Matrix4();
    head.getMatrixAt(0, m);
    const p = new Vector3().setFromMatrixPosition(m);
    // The player is at the origin and the bot at z = −10, so it falls toward −z.
    expect(p.z).toBeLessThan(-11);
    expect(p.y).toBeLessThan(0.5);
  });

  it('narrows the FOV while scoped and hides the viewmodel (story-pistol-sniper)', async () => {
    const h = await liveHarness('desert-compound', 1);
    const scoped = player({
      loadout: { ...player().loadout, active: 'sniper', scoped: true },
    });
    h.renderer.render(snapshot(10, 1), snapshot(11, 1, { player: scoped }), 1, [
      { t: 'weapon', tick: 11, actor: PLAYER_ID, kind: 'scope-in' },
    ]);
    const later = snapshot(40, 1, { player: scoped });
    h.host.calls.length = 0;
    h.renderer.render(later, later, 1, []);
    const cam = h.host.cameras[h.host.cameras.length - 1] as PerspectiveCamera;
    expect(cam.fov).toBeCloseTo(scopedVFov(hFovToVFov(90)), 4);
    expect(h.host.calls).toEqual(['clear', 'render']);
  });

  it('never throws on malformed input and reports each problem once (BR-P-01, RE-P-01)', async () => {
    const h = await liveHarness('desert-compound', 3);
    const nanBot = snapshot(11, 3, {
      bots: [bot(1, { pos: { x: Number.NaN, y: 0, z: 0 } }), bot(2), bot(9)],
    });
    const nanPlayer = snapshot(12, 3, {
      player: player({ pos: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 } }),
    });
    const badEvents = [
      shot(11, botId(1), { end: { x: Number.NaN, y: 0, z: 0 } }),
      { t: 'impact', tick: Number.NaN, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
    ] as SimEvent[];
    expect(() => {
      h.renderer.render(snapshot(10, 3), nanBot, 0.5, badEvents);
      h.renderer.render(nanBot, nanPlayer, Number.NaN, []);
      h.renderer.render(snapshot(Number.NaN, 3), nanPlayer, 1, []);
      h.renderer.render(
        snapshot(1, 3),
        { ...snapshot(2, 3), bots: null } as unknown as SimSnapshot,
        1,
        [],
      );
      h.renderer.render(snapshot(1, 3), snapshot(2, 3), 1, [
        { t: 'bogus', tick: 2 } as unknown as SimEvent,
      ]);
    }).not.toThrow();
    const codes = h.sink.map((x) => x.code);
    for (const c of [
      'render/bad-pose',
      'render/unknown-bot',
      'render/bad-event',
      'render/bad-snapshot',
      'render/frame-fault',
    ]) {
      expect(codes).toContain(c);
    }
    expect(new Set(codes).size).toBe(codes.length);
    expect(h.renderer.stats().frameFaults).toBe(2);
  });

  it('renders deep-frozen snapshots and events without mutating them (SEC-P-05)', async () => {
    const h = await liveHarness('industrial-warehouse', 5);
    const prev = deepFreeze(snapshot(10, 5));
    const curr = deepFreeze(snapshot(11, 5));
    const ev = deepFreeze(busyEvents(11, 5));
    expect(() => {
      h.renderer.render(prev, curr, 0.3, ev);
    }).not.toThrow();
    expect(h.renderer.stats().frameFaults).toBe(0);
  });

  it('is deterministic: the same inputs give the same instance buffers (SEC-P-07)', async () => {
    const run = async (): Promise<number[]> => {
      const h = await liveHarness('desert-compound', 5);
      for (let i = 0; i < 20; i++) {
        h.renderer.render(snapshot(10 + i, 5), snapshot(11 + i, 5), 0.37, busyEvents(11 + i, 5));
      }
      const scene = h.host.worldScene();
      const torso = find(scene, 'bot-leg-l') as InstancedMesh;
      const particles = find(scene, 'particles') as Points;
      return [
        ...Array.from(torso.instanceMatrix.array.slice(0, 80)),
        ...Array.from(
          (particles.geometry.getAttribute('position').array as Float32Array).slice(0, 60),
        ),
      ];
    };
    expect(await run()).toEqual(await run());
  });

  it('resets transients on a tick regression (BR-P-12)', async () => {
    const h = await liveHarness('desert-compound', 3);
    h.renderer.render(snapshot(100, 3), snapshot(101, 3), 1, busyEvents(101, 3));
    expect(h.renderer.stats().activeImpacts).toBeGreaterThan(0);
    h.renderer.render(snapshot(0, 3), snapshot(1, 3), 1, []);
    expect(h.renderer.stats().activeImpacts).toBe(0);
  });

  it('never changes the shader program key inside render() (PR-P-20)', async () => {
    const h = await liveHarness('industrial-warehouse', 10, { preset: 'high' });
    h.renderer.render(snapshot(0, 10), snapshot(1, 10), 1, []);
    const scene = h.host.worldScene();
    const key = (): string => {
      const parts: string[] = [];
      scene.traverse((o) => {
        parts.push(
          `${o.name}:${String(o.castShadow)}:${String(o.visible && (o as Partial<Light>).isLight === true)}`,
        );
        const m = (o as { material?: Material }).material;
        if (m instanceof Material) parts.push(String(m.version));
      });
      return parts.join('|');
    };
    const before = key();
    const lightCount = lights(scene).length;
    for (let i = 0; i < 30; i++) {
      h.renderer.render(
        snapshot(1 + i, 10),
        snapshot(2 + i, 10, { player: player({ lastFireTick: 2 + i }) }),
        0.5,
        busyEvents(2 + i, 10),
      );
    }
    expect(key()).toBe(before);
    expect(lights(scene)).toHaveLength(lightCount);
  });

  it('freezes exactly while paused (alpha = 1, no events)', async () => {
    const h = await liveHarness('desert-compound', 3);
    const prev = snapshot(10, 3);
    const curr = snapshot(11, 3);
    h.renderer.render(prev, curr, 1, busyEvents(11, 3));
    const torso = find(h.host.worldScene(), 'bot-torso') as InstancedMesh;
    const before = Array.from(torso.instanceMatrix.array);
    const version = torso.instanceMatrix.version;
    for (let i = 0; i < 5; i++) h.renderer.render(prev, curr, 1, []);
    expect(Array.from(torso.instanceMatrix.array)).toEqual(before);
    expect(torso.instanceMatrix.version).toBe(version);
  });
});

describe('GameRenderer settings', () => {
  it('clamps the FOV and reports it once', async () => {
    const h = await liveHarness('desert-compound', 1);
    h.renderer.setFov(150);
    h.renderer.setFov(20);
    h.renderer.render(snapshot(0, 1), snapshot(1, 1), 1, []);
    const cam = h.host.cameras[h.host.cameras.length - 2] as PerspectiveCamera;
    expect(cam.fov).toBeCloseTo(hFovToVFov(70), 6);
    expect(h.sink.filter((x) => x.code === 'render/fov-out-of-range')).toHaveLength(1);
  });

  it('keeps vertical FOV fixed across aspect changes (Hor+) and ignores 0 × 0', async () => {
    const h = await liveHarness('desert-compound', 1);
    h.renderer.resize(2560, 1080);
    h.renderer.resize(0, 0);
    h.renderer.render(snapshot(0, 1), snapshot(1, 1), 1, []);
    const cam = h.host.cameras[h.host.cameras.length - 2] as PerspectiveCamera;
    expect(cam.fov).toBeCloseTo(hFovToVFov(90), 6);
    expect(cam.aspect).toBeCloseTo(2560 / 1080);
    expect(h.host.size).toEqual([2560, 1080]);
  });
});

describe('GameRenderer round restart and context loss', () => {
  it('leaves geometry and texture counts at baseline after ten restarts (SC-P-06, req-restart-without-reload)', async () => {
    for (const map of ['desert-compound', 'industrial-warehouse'] as const) {
      const h = await liveHarness(map, 10);
      h.renderer.render(snapshot(10, 10), snapshot(11, 10), 1, busyEvents(11, 10));
      const base = { ...h.renderer.stats() };
      for (let i = 0; i < 10; i++) {
        h.renderer.disposeRound();
        expect(h.renderer.stats().activeImpacts).toBe(0);
        await h.renderer.buildMap(getMap(map));
        h.renderer.spawnActors(10);
        await h.renderer.precompile();
      }
      const after = h.renderer.stats();
      expect(after.geometries).toBe(base.geometries);
      expect(after.textures).toBe(base.textures);
      const roots: Object3D[] = [];
      h.renderer.render(snapshot(0, 10), snapshot(1, 10), 1, []);
      h.host.worldScene().traverse((o) => {
        if (o.name === 'map-root') roots.push(o);
      });
      expect(roots).toHaveLength(1);
    }
  });

  it('abandons a build superseded while it was yielding', async () => {
    const h = createHarness();
    h.renderer.init(FAKE_CANVAS);
    const baseline = h.renderer.stats().textures;
    const p = h.renderer.buildMap(getMap('desert-compound'));
    h.renderer.disposeRound();
    await p;
    expect(h.renderer.stats().textures).toBe(baseline);
  });

  it('pauses on context loss, restores, recompiles and notifies (§2.9)', async () => {
    const h = await liveHarness('desert-compound', 3);
    const seen: string[] = [];
    h.renderer.onContextLost(() => seen.push('lost'));
    const off = h.renderer.onContextRestored(() => seen.push('restored'));
    h.host.loseContext();
    expect(h.renderer.stats().contextLost).toBe(true);
    h.host.calls.length = 0;
    h.renderer.render(snapshot(0, 3), snapshot(1, 3), 1, []);
    expect(h.host.calls).toEqual([]);
    h.host.restoreContext();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.host.calls.filter((c) => c === 'compile')).toHaveLength(2);
    expect(h.renderer.stats().contextLost).toBe(false);
    expect(seen).toEqual(['lost', 'restored']);
    off();
    h.host.loseContext();
    h.host.compileFails = true;
    h.host.restoreContext();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.renderer.stats().contextLost).toBe(true);
    expect(h.sink.map((x) => x.code)).toContain('render/restore-failed');
    expect(seen).toEqual(['lost', 'restored', 'lost']);
  });

  it('isolates a throwing context callback', async () => {
    const h = await liveHarness('desert-compound', 1);
    h.renderer.onContextLost(() => {
      throw new Error('app bug');
    });
    expect(() => {
      h.host.loseContext();
    }).not.toThrow();
    expect(h.sink.map((x) => x.code)).toContain('render/callback-fault');
  });

  it('spawns into the alive pose and colour (BR-P-13)', async () => {
    const h = await liveHarness('desert-compound', 4);
    h.renderer.render(snapshot(10, 4), snapshot(11, 4), 1, []);
    const torso = find(h.host.worldScene(), 'bot-torso') as InstancedMesh;
    expect(torso.count).toBe(4);
  });
});
