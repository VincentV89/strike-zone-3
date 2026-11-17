/**
 * Map lighting and shadow allocation (business-logic-model §2.5, BR-P-21,
 * BR-P-30..32, PD-P-03). The light set is fixed when buildMap or setPreset
 * finishes; render() never adds or removes lights or toggles castShadow.
 */
import {
  DirectionalLight,
  HemisphereLight,
  PointLight,
  SpotLight,
  Vector3,
  type Object3D,
} from 'three';
import type { Diagnostics } from '../core';
import type { LightingDef, MapDefinition } from '../maps';
import type { PresetSpec } from './presets';

const SUN_DISTANCE_M = 60;
const SHADOW_MARGIN_M = 1;
const LOCAL_SHADOW_PX = 512;
const SPOT_ANGLE = Math.PI / 4;
const SPOT_PENUMBRA = 0.4;

export interface MapLights {
  readonly hemi: HemisphereLight;
  readonly sun: DirectionalLight;
  readonly locals: readonly (PointLight | SpotLight)[];
  /** Index of each local in def order that asked for a shadow. */
  readonly shadowEligible: readonly number[];
  /** Everything to add under map-root (lights and targets). */
  readonly objects: readonly Object3D[];
}

export interface ShadowBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

const corner = new Vector3();
const centre = new Vector3();

/**
 * Places the sun at centre(box) − sunDir × 60 m aimed at the centre, and fits
 * its orthographic shadow camera to the 8 corners of the box in light space
 * plus a 1 m margin.
 */
export function fitSunShadow(sun: DirectionalLight, lighting: LightingDef): ShadowBounds {
  const box = lighting.sunShadowBox;
  centre.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
  const d = lighting.sunDir;
  sun.position.set(
    centre.x - d.x * SUN_DISTANCE_M,
    centre.y - d.y * SUN_DISTANCE_M,
    centre.z - d.z * SUN_DISTANCE_M,
  );
  sun.target.position.copy(centre);
  sun.updateMatrixWorld(true);
  sun.target.updateMatrixWorld(true);
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(centre);
  cam.updateMatrixWorld(true);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    );
    corner.applyMatrix4(cam.matrixWorldInverse);
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    minZ = Math.min(minZ, corner.z);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
    maxZ = Math.max(maxZ, corner.z);
  }
  const bounds: ShadowBounds = {
    left: minX - SHADOW_MARGIN_M,
    right: maxX + SHADOW_MARGIN_M,
    bottom: minY - SHADOW_MARGIN_M,
    top: maxY + SHADOW_MARGIN_M,
    // Camera space looks down −z.
    near: Math.max(0.1, -maxZ - SHADOW_MARGIN_M),
    far: -minZ + SHADOW_MARGIN_M,
  };
  cam.left = bounds.left;
  cam.right = bounds.right;
  cam.top = bounds.top;
  cam.bottom = bounds.bottom;
  cam.near = bounds.near;
  cam.far = bounds.far;
  cam.updateProjectionMatrix();
  return bounds;
}

export function createMapLights(def: MapDefinition): MapLights {
  const l = def.lighting;
  const hemi = new HemisphereLight(l.hemiSky, l.hemiGround, l.hemiIntensity);
  hemi.name = 'hemi';
  const sun = new DirectionalLight(l.sunColour, l.sunIntensity);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  fitSunShadow(sun, l);
  const objects: Object3D[] = [hemi, sun, sun.target];
  const locals: (PointLight | SpotLight)[] = [];
  const shadowEligible: number[] = [];
  l.locals.forEach((def, i) => {
    let light: PointLight | SpotLight;
    if (def.kind === 'spot') {
      const spot = new SpotLight(
        def.colour,
        def.intensity,
        def.range,
        SPOT_ANGLE,
        SPOT_PENUMBRA,
        2,
      );
      const t = def.target ?? { x: def.pos.x, y: 0, z: def.pos.z };
      spot.target.position.set(t.x, t.y, t.z);
      objects.push(spot.target);
      light = spot;
    } else {
      light = new PointLight(def.colour, def.intensity, def.range, 2);
    }
    light.name = `local:${String(i)}`;
    light.position.set(def.pos.x, def.pos.y, def.pos.z);
    light.shadow.mapSize.set(LOCAL_SHADOW_PX, LOCAL_SHADOW_PX);
    light.shadow.bias = -0.001;
    light.castShadow = false;
    if (def.shadow) shadowEligible.push(i);
    locals.push(light);
    objects.push(light);
  });
  return { hemi, sun, locals, shadowEligible, objects };
}

/**
 * Applies a preset to the map lights: sun shadow size (clamped to the GPU
 * limit) and which locals cast shadows (definition order until the budget is
 * used, BR-P-32). Returns the number of shadow-casting lights.
 */
export function applyLightPreset(
  lights: MapLights,
  preset: PresetSpec,
  maxTextureSize: number,
  diagnostics: Diagnostics,
): number {
  let size = preset.sunShadowPx;
  if (maxTextureSize > 0 && size > maxTextureSize) {
    size = maxTextureSize;
    diagnostics.warnOnce('render/shadow-size-clamped', {
      requested: preset.sunShadowPx,
      max: maxTextureSize,
    });
  }
  const sunShadow = lights.sun.shadow;
  if (sunShadow.mapSize.x !== size) {
    sunShadow.mapSize.set(size, size);
    // Force three to reallocate the shadow map at the new size.
    sunShadow.map?.dispose();
    sunShadow.map = null;
  }
  sunShadow.radius = preset.shadowRadius;
  let budget = preset.localShadowLights;
  const eligible = new Set(lights.shadowEligible);
  let count = 1;
  lights.locals.forEach((light, i) => {
    const cast = budget > 0 && eligible.has(i);
    if (cast) {
      budget -= 1;
      count += 1;
    }
    light.castShadow = cast;
  });
  return count;
}

/**
 * Chooses which caster buckets keep castShadow under the preset cap
 * (BR-P-31). `reserved` is the number of other casters (bot parts). Keeps
 * the largest by volume; ties keep the earlier bucket. Returns a flag per input.
 */
export function capCasters(
  buckets: readonly { caster: boolean; volume: number }[],
  cap: number,
  reserved: number,
): { keep: boolean[]; capped: boolean } {
  const casterIdx: number[] = [];
  buckets.forEach((b, i) => {
    if (b.caster) casterIdx.push(i);
  });
  const room = Math.max(0, cap - reserved);
  const keep = buckets.map((b) => b.caster);
  if (casterIdx.length <= room) return { keep, capped: false };
  const ranked = [...casterIdx].sort((a, b) => {
    const dv = (buckets[b]?.volume ?? 0) - (buckets[a]?.volume ?? 0);
    return dv !== 0 ? dv : a - b;
  });
  const kept = new Set(ranked.slice(0, room));
  for (const i of casterIdx) keep[i] = kept.has(i);
  return { keep, capped: true };
}
