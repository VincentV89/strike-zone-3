/** test-seams public surface. Only main.ts imports it, behind MODE === 'test' (SD-AS-01). */
export { installTestSeams, type SeamApi, type SeamHost, type SeamOptions } from './seams';
export { createPointerLockBypass, type BypassLockPort } from './pointer-lock-bypass';
export { mountDevOverlay, type DevOverlayHost } from './overlay';
export { SEAM_GLOBAL, BYPASS_MARKER, OVERLAY_MARKER } from './markers';
