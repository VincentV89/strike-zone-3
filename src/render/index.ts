/**
 * renderer public surface (frontend-components-presentation-3d). app-shell
 * imports this file only; createGameRendererWith stays internal to tests.
 */
export { createGameRenderer, type RendererDeps } from './game-renderer';
export { PRESETS, DEFAULT_PRESET, type PresetId, type PresetSpec } from './presets';
export { hFovToVFov, scopedVFov } from './camera-math';
export { FOV_MIN_DEG, FOV_MAX_DEG, FOV_DEFAULT_DEG, SCOPE_ZOOM } from './constants';
export type { GameRenderer, RenderStats, Unsubscribe } from './types';
