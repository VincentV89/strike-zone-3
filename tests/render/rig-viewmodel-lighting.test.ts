import { describe, expect, it } from 'vitest';
import { Box3, Color, DirectionalLight, Matrix4, Vector3 } from 'three';
import { createDiagnostics, TICK_DT } from '../../src/core';
import { getMap, MAP_RULES } from '../../src/maps';
import {
  botColour,
  botPartMatrices,
  BOT_COLOURS,
  BOT_PART_COUNT,
  createBotRig,
  createPoseInput,
  deathBrightness,
  toppleAngle,
} from '../../src/render/bot-rig';
import { BOT_DIMENSIONS, DEATH_BRIGHTNESS } from '../../src/render/constants';
import {
  applyLightPreset,
  capCasters,
  createMapLights,
  fitSunShadow,
} from '../../src/render/lighting';
import { PRESETS } from '../../src/render/presets';
import { makeTexture, paintFlash } from '../../src/render/textures';
import {
  createViewmodelInput,
  createViewmodelPose,
  magazineOffset,
  recoilKick,
  viewmodelPose,
  VM_KICK_M,
  VM_KICK_TAU,
  VM_RELOAD_DROP_M,
  VM_SOCKET,
} from '../../src/render/viewmodel';

const mats = Array.from({ length: BOT_PART_COUNT }, () => new Matrix4());
const muzzle = new Vector3();

/** World-space box of every visible part of a posed rig. */
function rigBounds(
  rigGeoms: readonly { boundingBox: Box3 | null; computeBoundingBox(): void }[],
): Box3 {
  const out = new Box3();
  const b = new Box3();
  for (let i = 0; i < BOT_PART_COUNT; i++) {
    const g = rigGeoms[i];
    const m = mats[i];
    if (g === undefined || m === undefined) continue;
    if (m.determinant() === 0) continue;
    g.computeBoundingBox();
    if (g.boundingBox === null) continue;
    b.copy(g.boundingBox).applyMatrix4(m);
    out.union(b);
  }
  return out;
}

describe('bot rig (story-visual-polish, story-bot-death)', () => {
  const rig = createBotRig(makeTexture(paintFlash(16), 16, { repeat: false, anisotropy: 1 }));

  it('draws every bot with 9 instanced meshes of capacity 20 and shared materials', () => {
    expect(rig.parts).toHaveLength(9);
    for (const p of rig.parts) expect(p.instanceMatrix.count).toBe(20);
    expect(new Set(rig.parts.map((p) => p.material)).size).toBe(2);
    rig.setCount(7);
    expect(rig.parts.every((p) => p.count === 7)).toBe(true);
    expect(rig.flashes.count).toBe(7);
  });

  it('copies the agent dimensions from MAP_RULES', () => {
    expect(BOT_DIMENSIONS.agentRadius).toBe(MAP_RULES.agentRadius);
    expect(BOT_DIMENSIONS.agentHeight).toBe(MAP_RULES.agentHeight);
    expect(BOT_DIMENSIONS.crouchHeight).toBe(MAP_RULES.crouchHeight);
  });

  it('fits the 1.8 m standing and 1.2 m crouched capsule', () => {
    const p = createPoseInput();
    p.moving = false;
    botPartMatrices(p, mats, muzzle);
    const stand = rigBounds(rig.geometries);
    expect(stand.max.y).toBeCloseTo(MAP_RULES.agentHeight, 2);
    expect(stand.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(Math.max(Math.abs(stand.min.x), Math.abs(stand.max.x))).toBeLessThanOrEqual(
      MAP_RULES.agentRadius,
    );
    p.crouch = true;
    botPartMatrices(p, mats, muzzle);
    expect(rigBounds(rig.geometries).max.y).toBeCloseTo(MAP_RULES.crouchHeight, 2);
  });

  it('topples to π/2 at 0.5 s, stays down and darkens to 35 %', () => {
    expect(toppleAngle(-1)).toBe(0);
    expect(toppleAngle(0.25)).toBeGreaterThan(0);
    expect(toppleAngle(0.5)).toBeCloseTo(Math.PI / 2);
    expect(toppleAngle(30)).toBeCloseTo(Math.PI / 2);
    expect(deathBrightness(-1)).toBe(1);
    expect(deathBrightness(0.5)).toBeCloseTo(DEATH_BRIGHTNESS);
    const c = botColour(BOT_COLOURS.body, deathBrightness(5), 0, new Color());
    expect(c.r).toBeCloseTo(BOT_COLOURS.body.r * 0.35);
  });

  it('falls toward fallDir, away from the killer, and lies on the floor', () => {
    const p = createPoseInput();
    p.alive = false;
    p.deathAge = 2;
    p.fallX = 1;
    p.fallZ = 0;
    botPartMatrices(p, mats, muzzle);
    const head = new Vector3().setFromMatrixPosition(mats[0] ?? new Matrix4());
    expect(head.x).toBeGreaterThan(1.2);
    expect(head.y).toBeLessThan(0.4);
    const lying = rigBounds(rig.geometries);
    expect(lying.max.y).toBeLessThan(0.6);
    expect(lying.min.y).toBeGreaterThan(-0.1);
  });

  it('swings legs only while moving and shows only the held weapon', () => {
    const p = createPoseInput();
    p.t = 0.125; // quarter cycle at 2 Hz
    p.moving = true;
    botPartMatrices(p, mats, muzzle);
    const legL = mats[3]?.elements[9] ?? 0;
    p.moving = false;
    botPartMatrices(p, mats, muzzle);
    expect(mats[3]?.elements[9]).not.toBeCloseTo(legL, 3);
    p.weapon = 2;
    botPartMatrices(p, mats, muzzle);
    expect(mats[6]?.determinant()).toBe(0);
    expect(mats[7]?.determinant()).toBe(0);
    expect(mats[8]?.determinant()).not.toBe(0);
    expect(muzzle.z).toBeLessThan(-0.9);
  });

  it('flashes toward white on hit', () => {
    const c = botColour(BOT_COLOURS.body, 1, 0.6, new Color());
    expect(c.r).toBeGreaterThan(BOT_COLOURS.body.r);
  });
});

describe('viewmodel pose (story-weapon-feedback)', () => {
  const input = createViewmodelInput();
  const out = createViewmodelPose();

  it('kicks back right after a shot and recovers within 5τ', () => {
    for (const w of [0, 1, 2] as const) {
      expect(recoilKick(w, 10 * TICK_DT, 10)).toBeCloseTo(VM_KICK_M[w]);
      const later = recoilKick(w, 10 * TICK_DT + 5 * VM_KICK_TAU[w], 10);
      expect(later).toBeLessThan(0.05 * VM_KICK_M[w]);
      expect(recoilKick(w, 9 * TICK_DT, 10)).toBe(0);
      expect(recoilKick(w, 9, -1)).toBe(0);
    }
    input.t = 1;
    input.lastFireTick = 60;
    viewmodelPose(input, out);
    expect(out.z).toBeGreaterThan(VM_SOCKET.z);
    expect(out.pitch).toBeGreaterThan(0);
  });

  it('plays the reload dip for the whole duration, following sin(πp)', () => {
    input.lastFireTick = -1;
    input.reloading = true;
    input.grounded = false;
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      input.reloadProgress = p;
      viewmodelPose(input, out);
      expect(out.y).toBeCloseTo(VM_SOCKET.y - VM_RELOAD_DROP_M * Math.sin(Math.PI * p), 6);
    }
    expect(magazineOffset(0)).toBe(-0);
    expect(magazineOffset(0.5)).toBeCloseTo(-0.25);
    expect(magazineOffset(1)).toBeCloseTo(0);
    input.reloading = false;
  });

  it('is hidden when scoped or dead', () => {
    input.scopeBlend = 0.6;
    expect(viewmodelPose(input, out).visible).toBe(false);
    input.scopeBlend = 0;
    input.alive = false;
    expect(viewmodelPose(input, out).visible).toBe(false);
    input.alive = true;
    expect(viewmodelPose(input, out).visible).toBe(true);
  });

  it('bobs while moving on the ground, never with reducedMotion', () => {
    input.grounded = true;
    input.speed = 4.5;
    input.t = 0.1;
    viewmodelPose(input, out);
    expect(out.y).not.toBeCloseTo(VM_SOCKET.y, 4);
    input.reducedMotion = true;
    viewmodelPose(input, out);
    expect(out.y).toBeCloseTo(VM_SOCKET.y, 9);
    input.reducedMotion = false;
    input.speed = 0;
  });

  it('lowers during a switch and raises after it', () => {
    input.switching = true;
    input.switchStart = 0;
    input.t = 0.2;
    viewmodelPose(input, out);
    expect(out.y).toBeCloseTo(VM_SOCKET.y - 0.25, 6);
    input.switching = false;
    input.switchStart = -1;
    input.switchEnd = 0.2;
    input.t = 0.26;
    const mid = viewmodelPose(input, out).y;
    expect(mid).toBeLessThan(VM_SOCKET.y);
    input.t = 0.5;
    expect(viewmodelPose(input, out).y).toBeCloseTo(VM_SOCKET.y, 6);
  });
});

describe('lighting (BR-P-21, BR-P-31, BR-P-32)', () => {
  it('fits the sun shadow camera around sunShadowBox', () => {
    for (const id of ['desert-compound', 'industrial-warehouse'] as const) {
      const def = getMap(id);
      const sun = new DirectionalLight();
      const b = fitSunShadow(sun, def.lighting);
      const cam = sun.shadow.camera;
      const box = def.lighting.sunShadowBox;
      const v = new Vector3();
      for (let i = 0; i < 8; i++) {
        v.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        );
        v.applyMatrix4(cam.matrixWorldInverse);
        expect(v.x).toBeGreaterThanOrEqual(b.left);
        expect(v.x).toBeLessThanOrEqual(b.right);
        expect(v.y).toBeGreaterThanOrEqual(b.bottom);
        expect(v.y).toBeLessThanOrEqual(b.top);
        expect(-v.z).toBeGreaterThanOrEqual(b.near);
        expect(-v.z).toBeLessThanOrEqual(b.far);
      }
    }
  });

  it('casts the sun on every preset and keeps shadow lights within budget', () => {
    const diag = createDiagnostics(() => undefined);
    for (const id of ['desert-compound', 'industrial-warehouse'] as const) {
      const lights = createMapLights(getMap(id));
      expect(lights.sun.castShadow).toBe(true);
      expect(applyLightPreset(lights, PRESETS.low, 8192, diag)).toBe(1);
      expect(applyLightPreset(lights, PRESETS.medium, 8192, diag)).toBeLessThanOrEqual(2);
      expect(applyLightPreset(lights, PRESETS.high, 8192, diag)).toBeLessThanOrEqual(3);
    }
    const wh = createMapLights(getMap('industrial-warehouse'));
    expect(applyLightPreset(wh, PRESETS.medium, 8192, diag)).toBe(2);
  });

  it('clamps the shadow map to the GPU limit and reports it once', () => {
    const seen: string[] = [];
    const diag = createDiagnostics((code) => seen.push(code));
    const lights = createMapLights(getMap('desert-compound'));
    applyLightPreset(lights, PRESETS.high, 2048, diag);
    applyLightPreset(lights, PRESETS.high, 2048, diag);
    expect(lights.sun.shadow.mapSize.x).toBe(2048);
    expect(seen).toEqual(['render/shadow-size-clamped']);
  });

  it('keeps the largest caster buckets under the cap', () => {
    const buckets = [
      { caster: true, volume: 5 },
      { caster: false, volume: 100 },
      { caster: true, volume: 50 },
      { caster: true, volume: 10 },
    ];
    expect(capCasters(buckets, 24, 0)).toEqual({ keep: [true, false, true, true], capped: false });
    expect(capCasters(buckets, 11, 9)).toEqual({ keep: [false, false, true, true], capped: true });
  });
});
