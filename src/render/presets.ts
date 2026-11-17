/**
 * Graphics presets (req-graphics-presets, business-logic-model §4.2,
 * BR-P-20..23). The table is frozen; the README "Graphics presets" table is
 * written from these values. Low is the recommendation for 15 and 20 bots.
 *
 * three 0.187.0 removed PCFSoftShadowMap (it falls back to PCF with a warning),
 * so every preset uses PCF and High softens with a larger shadow radius.
 */
export type PresetId = 'low' | 'medium' | 'high';

export interface PresetSpec {
  readonly id: PresetId;
  /** Device-pixel-ratio cap; the effective ratio is min(dpr, dprCap) * dprScale. */
  readonly dprCap: number;
  readonly dprScale: number;
  readonly sunShadowPx: number;
  /** PCF kernel radius for the sun shadow. */
  readonly shadowRadius: number;
  /** Local lights allowed to cast shadows, on top of the sun. */
  readonly localShadowLights: number;
  readonly botsCastShadows: boolean;
  readonly maxShadowCasters: number;
  readonly anisotropy: number;
  readonly farM: number;
  readonly particleCap: number;
  readonly particlesPerBurst: number;
  readonly decalCap: number;
  readonly tracerCap: number;
  readonly flashLight: boolean;
}

function preset(spec: PresetSpec): PresetSpec {
  return Object.freeze(spec);
}

export const PRESETS: Readonly<Record<PresetId, PresetSpec>> = Object.freeze({
  low: preset({
    id: 'low',
    dprCap: 1,
    dprScale: 0.75,
    sunShadowPx: 1024,
    shadowRadius: 1,
    localShadowLights: 0,
    botsCastShadows: false,
    maxShadowCasters: 16,
    anisotropy: 1,
    farM: 150,
    particleCap: 64,
    particlesPerBurst: 6,
    decalCap: 32,
    tracerCap: 16,
    flashLight: false,
  }),
  medium: preset({
    id: 'medium',
    dprCap: 1.5,
    dprScale: 1,
    sunShadowPx: 2048,
    shadowRadius: 1,
    localShadowLights: 1,
    botsCastShadows: true,
    maxShadowCasters: 24,
    anisotropy: 4,
    farM: 200,
    particleCap: 192,
    particlesPerBurst: 8,
    decalCap: 64,
    tracerCap: 32,
    flashLight: false,
  }),
  high: preset({
    id: 'high',
    dprCap: 2,
    dprScale: 1,
    sunShadowPx: 4096,
    shadowRadius: 2,
    localShadowLights: 2,
    botsCastShadows: true,
    maxShadowCasters: 24,
    anisotropy: 8,
    farM: 300,
    particleCap: 384,
    particlesPerBurst: 12,
    decalCap: 128,
    tracerCap: 48,
    flashLight: true,
  }),
});

/** The largest caps; pools are allocated once at these sizes. */
export const MAX_PARTICLES = PRESETS.high.particleCap;
export const MAX_DECALS = PRESETS.high.decalCap;
export const MAX_TRACERS = PRESETS.high.tracerCap;

/** Settings default (BR-P-23, a recommendation to menus-settings). */
export const DEFAULT_PRESET: PresetId = 'medium';

export function isPresetId(p: unknown): p is PresetId {
  return p === 'low' || p === 'medium' || p === 'high';
}

/** Effective pixel ratio for a device pixel ratio. A bad dpr counts as 1. */
export function pixelRatioFor(p: PresetSpec, dpr: number): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(d, p.dprCap) * p.dprScale;
}
